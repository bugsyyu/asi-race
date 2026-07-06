# ============================================================================
# Transports — how the SDK reaches the JS simulation. Standard library only.
#
#   NodeBridge  spawns `node bridge/server.mjs` and speaks JSON Lines over its
#               stdio. Headless: the Python side owns the clock (see Game).
#   WsBridge    a minimal WebSocket *server* the running browser game connects
#               to (open the game with ?bridge=PORT). Realtime (see LiveGame).
#
# Both expose the same request/poll surface, so the high-level command mixin
# in game.py is transport-agnostic.
# ============================================================================
from __future__ import annotations

import base64
import hashlib
import json
import os
import select
import socket
import subprocess
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Dict, List, Optional


class BridgeError(RuntimeError):
    """Transport failure or protocol misuse (a caller bug). In-game refusals
    (not enough resources, cooldowns, bad placement…) never raise — they come
    back as ``{"ok": False, "msg": "..."}`` for the bot to route around."""


def find_repo_root(explicit: Optional[str] = None) -> Path:
    """Locate the asi-race checkout (the directory holding bridge/server.mjs).

    Search order: explicit argument, $ASIRACE_ROOT, then upward from this file
    (which covers the in-repo python/asirace layout).
    """
    if explicit:
        p = Path(explicit).resolve()
        if (p / "bridge" / "server.mjs").is_file():
            return p
        raise BridgeError(f"no bridge/server.mjs under {p}")
    env = os.environ.get("ASIRACE_ROOT")
    if env:
        return find_repo_root(env)
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "bridge" / "server.mjs").is_file():
            return parent
    raise BridgeError(
        "could not locate the asi-race repo — set ASIRACE_ROOT or pass root=..."
    )


class _RequestMixin:
    """Shared id assignment + None-stripping on top of request_raw()."""

    _id = 0

    def request(self, op: str, **params: Any) -> Dict[str, Any]:
        clean = {k: v for k, v in params.items() if v is not None}
        return self.request_raw({"op": op, **clean})

    def _next_id(self) -> int:
        self._id += 1
        return self._id


# ---------------------------------------------------------------------------
# headless: node subprocess over stdio
# ---------------------------------------------------------------------------
class NodeBridge(_RequestMixin):
    """Owns a `node bridge/server.mjs` child process; JSON Lines over stdio."""

    def __init__(self, root: Optional[str] = None, node: str = "node") -> None:
        self.root = find_repo_root(root)
        try:
            self.proc = subprocess.Popen(
                [node, str(self.root / "bridge" / "server.mjs")],
                cwd=str(self.root),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                bufsize=1,
            )
        except FileNotFoundError as e:
            raise BridgeError(
                f"node executable not found ({node!r}) — install Node.js >= 18"
            ) from e
        self._stderr_tail: deque = deque(maxlen=60)
        threading.Thread(target=self._drain_stderr, daemon=True).start()
        hello = self._read()
        if not hello.get("ready"):
            raise BridgeError(f"unexpected greeting from bridge server: {hello}")
        self.protocol = hello.get("protocol")

    def _drain_stderr(self) -> None:
        try:
            for line in self.proc.stderr:  # type: ignore[union-attr]
                self._stderr_tail.append(line.rstrip())
        except Exception:
            pass

    def _read(self) -> Dict[str, Any]:
        line = self.proc.stdout.readline()  # type: ignore[union-attr]
        if line == "":
            err = "\n".join(self._stderr_tail) or "(no stderr)"
            raise BridgeError(
                f"bridge server exited (code {self.proc.poll()}); stderr tail:\n{err}"
            )
        try:
            return json.loads(line)
        except json.JSONDecodeError as e:
            raise BridgeError(f"bad json from bridge server: {line[:200]!r}") from e

    def request_raw(self, msg: Dict[str, Any]) -> Dict[str, Any]:
        rid = self._next_id()
        msg = {"id": rid, **msg}
        try:
            self.proc.stdin.write(json.dumps(msg) + "\n")  # type: ignore[union-attr]
            self.proc.stdin.flush()  # type: ignore[union-attr]
        except (BrokenPipeError, OSError) as e:
            err = "\n".join(self._stderr_tail) or "(no stderr)"
            raise BridgeError(f"bridge server pipe broke; stderr tail:\n{err}") from e
        while True:
            resp = self._read()
            if resp.get("id") == rid:
                if resp.get("ok") is False and "error" in resp:
                    raise BridgeError(f"{msg.get('op')}: {resp['error']}")
                return resp
            # the headless server never pushes; unmatched lines are stale noise

    def poll(self, timeout: float = 0.0) -> List[Dict[str, Any]]:
        """Headless games have no async pushes; provided for API symmetry."""
        return []

    def close(self) -> None:
        try:
            if self.proc.poll() is None:
                try:
                    self.proc.stdin.write(json.dumps({"op": "quit"}) + "\n")  # type: ignore[union-attr]
                    self.proc.stdin.flush()  # type: ignore[union-attr]
                except Exception:
                    pass
                try:
                    self.proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# live: stdlib WebSocket server, the browser is the client
# ---------------------------------------------------------------------------
_WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class WsBridge(_RequestMixin):
    """Single-client WebSocket server implementing just enough of RFC 6455 for
    the live bridge: HTTP upgrade, masked client frames, fragmentation,
    ping/pong, close. Text frames carry the same JSON messages as stdio."""

    def __init__(
        self,
        port: int = 8765,
        host: str = "127.0.0.1",
        accept_timeout: Optional[float] = None,
        verbose: bool = True,
    ) -> None:
        self.host, self.port = host, port
        self._srv = socket.create_server((host, port))
        self._srv.settimeout(accept_timeout)
        self._conn: Optional[socket.socket] = None
        self.pushes: deque = deque()
        self.hello: Optional[Dict[str, Any]] = None
        if verbose:
            print(
                f"[asirace] listening on ws://{host}:{port} — open the game with "
                f"?bridge={port} (e.g. http://localhost:8000/?bridge={port})"
            )
        self.wait_client()

    # -- connection lifecycle -------------------------------------------------
    def wait_client(self) -> Dict[str, Any]:
        """Block until a browser connects (again); returns its hello message."""
        if self._conn is not None:  # drop a stale/dead client before re-accepting
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None
        try:
            conn, _addr = self._srv.accept()
        except socket.timeout as e:
            raise BridgeError("no browser connected before accept_timeout") from e
        conn.settimeout(30.0)
        self._ws_handshake(conn)
        self._conn = conn
        first = self._read_message()
        self.hello = first if isinstance(first, dict) else None
        return self.hello or {}

    def _ws_handshake(self, conn: socket.socket) -> None:
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = conn.recv(4096)
            if not chunk:
                raise BridgeError("browser closed during websocket handshake")
            data += chunk
            if len(data) > 65536:
                raise BridgeError("oversized websocket handshake")
        head = data.split(b"\r\n\r\n", 1)[0].decode("latin-1")
        key = None
        for line in head.split("\r\n")[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                if k.strip().lower() == "sec-websocket-key":
                    key = v.strip()
        if not key:
            raise BridgeError("not a websocket handshake (no Sec-WebSocket-Key)")
        accept = base64.b64encode(
            hashlib.sha1((key + _WS_GUID).encode()).digest()
        ).decode()
        conn.sendall(
            (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
            ).encode()
        )

    # -- framing ----------------------------------------------------------------
    def _recv_exact(self, n: int) -> bytes:
        out = b""
        while len(out) < n:
            chunk = self._conn.recv(n - len(out))  # type: ignore[union-attr]
            if not chunk:
                raise BridgeError("browser connection closed")
            out += chunk
        return out

    def _read_frame(self):
        b0, b1 = self._recv_exact(2)
        fin, opcode = b0 >> 7, b0 & 0x0F
        masked, ln = b1 >> 7, b1 & 0x7F
        if ln == 126:
            ln = int.from_bytes(self._recv_exact(2), "big")
        elif ln == 127:
            ln = int.from_bytes(self._recv_exact(8), "big")
        mask = self._recv_exact(4) if masked else None
        payload = self._recv_exact(ln) if ln else b""
        if mask:
            payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
        return fin, opcode, payload

    def _read_message(self) -> Optional[Dict[str, Any]]:
        parts: List[bytes] = []
        kind = 0x1
        while True:
            fin, opcode, payload = self._read_frame()
            if opcode == 0x9:  # ping → pong, transparently
                self._send_frame(payload, 0xA)
                continue
            if opcode == 0xA:  # stray pong
                continue
            if opcode == 0x8:  # close
                try:
                    self._send_frame(payload[:2], 0x8)
                except Exception:
                    pass
                raise BridgeError("browser closed the live connection")
            if opcode in (0x1, 0x2):
                kind = opcode
            parts.append(payload)
            if fin:
                break
        if kind != 0x1:
            return None  # protocol is text-only; ignore binary
        try:
            return json.loads(b"".join(parts).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None

    def _send_frame(self, payload, opcode: int = 0x1) -> None:
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        ln = len(payload)
        head = bytes([0x80 | opcode])
        if ln < 126:
            head += bytes([ln])
        elif ln < 65536:
            head += bytes([126]) + ln.to_bytes(2, "big")
        else:
            head += bytes([127]) + ln.to_bytes(8, "big")
        self._conn.sendall(head + payload)  # type: ignore[union-attr]

    # -- request/poll -------------------------------------------------------------
    def request_raw(self, msg: Dict[str, Any], timeout: float = 10.0) -> Dict[str, Any]:
        if self._conn is None:
            raise BridgeError("no browser connected — call wait_client() first")
        rid = self._next_id()
        old = self._conn.gettimeout()
        try:
            self._send_frame(json.dumps({"id": rid, **msg}))
            self._conn.settimeout(timeout)
            while True:
                resp = self._read_message()
                if not isinstance(resp, dict):
                    continue
                if "push" in resp:
                    self.pushes.append(resp)
                    continue
                if resp.get("id") == rid:
                    break
        except socket.timeout as e:
            raise BridgeError(f"{msg.get('op')}: no reply within {timeout}s") from e
        except OSError as e:
            # reset / broken pipe mid-request — mark the client dead so the
            # caller can wait_client() for the auto-reconnecting page instead
            # of hitting raw socket errors on a corpse
            self._drop_client()
            raise BridgeError(f"{msg.get('op')}: browser connection lost ({e})") from e
        except BridgeError:
            # _read_message saw a close frame / EOF — same story
            self._drop_client()
            raise
        finally:
            if self._conn is not None:
                self._conn.settimeout(old)
        # a protocol refusal comes from a perfectly healthy connection —
        # raise it only after the socket bookkeeping above is settled
        if resp.get("ok") is False and "error" in resp:
            raise BridgeError(f"{msg.get('op')}: {resp['error']}")
        return resp

    def _drop_client(self) -> None:
        try:
            if self._conn is not None:
                self._conn.close()
        except Exception:
            pass
        self._conn = None

    def poll(self, timeout: float = 0.0) -> List[Dict[str, Any]]:
        """Return queued push messages (events / state subscriptions), waiting
        up to `timeout` seconds for the first if none are pending."""
        out: List[Dict[str, Any]] = list(self.pushes)
        self.pushes.clear()
        if self._conn is None:
            return out
        deadline = time.monotonic() + max(0.0, timeout)
        old = self._conn.gettimeout()
        try:
            while True:
                wait = 0.0 if out else max(0.0, deadline - time.monotonic())
                ready, _, _ = select.select([self._conn], [], [], wait)
                if not ready:
                    break
                # a frame is in flight — finish it with a real timeout so a
                # half-delivered frame can't wedge us in non-blocking mode
                self._conn.settimeout(5.0)
                msg = self._read_message()
                if isinstance(msg, dict) and "push" in msg:
                    out.append(msg)
        except socket.timeout:
            pass
        except (BridgeError, OSError):
            # the tab hung up mid-drain — hand over what arrived; the next
            # request or wait_client() surfaces the disconnect explicitly
            self._drop_client()
        finally:
            if self._conn is not None:
                self._conn.settimeout(old)
        return out

    def close(self) -> None:
        try:
            if self._conn is not None:
                try:
                    self._send_frame(b"", 0x8)
                except Exception:
                    pass
                self._conn.close()
        finally:
            self._conn = None
            try:
                self._srv.close()
            except Exception:
                pass
