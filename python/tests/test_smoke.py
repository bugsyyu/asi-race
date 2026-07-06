#!/usr/bin/env python3
"""End-to-end smoke test for the asirace Python SDK (needs Node.js >= 18).

Run from anywhere:  python3 python/tests/test_smoke.py   (or: npm run test:py)
No third-party dependencies — mirrors the style of test/headless.mjs.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import socket
import struct
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from asirace import BridgeError, Game, WsBridge, buildings_of, nearest, nodes_alive, units_of

FAILURES = 0


def ok(cond, msg):
    global FAILURES
    if cond:
        print("  ✓", msg)
    else:
        FAILURES += 1
        print("  ✗ FAIL:", msg)


# --- Test 1: headless loop — observe, command, step, build ---------------------
print("\n[1] Headless: fog-honest observe, commands, construction")
with Game(seed=42, faction=0) as g:
    obs = g.observe()
    ok(obs["omniscient"] is False and obs["perspective"] == 0, "observe is fog-honest for the tracked faction")
    ok(all(u["fid"] == 0 for u in obs["units"]), "no rival units at spawn")
    ok("compute" not in obs["factions"][1], "rival ledgers hidden")

    workers = units_of(obs, 0, "researcher")
    hq = buildings_of(obs, 0, "hq")[0]
    ok(g.gather(workers, nearest(nodes_alive(obs), hq["x"], hq["z"]))["ok"], "gather accepted")
    ok(g.train(hq, "researcher")["ok"], "train accepted")
    r = g.step(seconds=60, events=True)
    ok(r["time"] == 60 and len(r["events"]) > 0, f"stepped 60 s, {len(r['events'])} events drained")

    me = g.observe()["factions"][0]
    ok(me["data"] > 0 and me["compute"] > 150, f"economy ran (⚡{me['compute']:.0f} ◆{me['data']:.0f})")

    spot = g.find_spot("lab", hq["x"], hq["z"])
    ok(spot is not None, "find_spot located a lab site")
    r = g.build("lab", spot["x"], spot["z"], builders=workers[:2])
    ok(r["ok"] and isinstance(r.get("bid"), int), f"build returns the site as bid={r.get('bid')}")
    g.step(seconds=40)
    labs = buildings_of(g.observe(), 0, "lab", done=True)
    ok(len(labs) == 1, "lab finished construction")

    bad = g.build("datacenter", hq["x"], hq["z"])
    ok(bad["ok"] is False and bad.get("msg"), f"rule refusal returns msg ({bad.get('msg')})")
    try:
        g.train(hq, "not_a_unit")
        ok(False, "protocol misuse should raise BridgeError")
    except BridgeError:
        ok(True, "protocol misuse raises BridgeError")

# --- Test 2: multi-faction control & set_ai --------------------------------------
print("\n[2] Control plane: control=[...] and set_ai")
with Game(seed=5, faction=0, control=[0, 2]) as g:
    st = g.state()
    ok(st["factions"][0]["isAI"] is False and st["factions"][2]["isAI"] is False
       and st["factions"][1]["isAI"] is True, "control=[0,2] detaches exactly those factions")
    ok(g.move(units_of(st, 2, "researcher"), 0, 0, fid=2)["ok"], "commanding the second controlled faction works")
    g.set_ai(2, True)
    ok(g.state()["factions"][2]["isAI"] is True, "set_ai hands faction 2 back to the built-in AI")

# --- Test 3: reset — fast same-process episode loop --------------------------------
print("\n[3] reset: episodes reuse one node process, id-stable")
with Game(seed=42, faction=0) as g:
    g.step(seconds=30)                                  # dirty the first episode
    first = g.reset(seed=99)
    ok(g.time == 0.0 and g.over is None, "reset clears the clock and verdict")
    second = g.reset(seed=99)
    ok(json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True),
       "same seed after reset → identical initial state (id-stable)")
    with Game(seed=99, faction=0) as fresh:
        ok(json.dumps(fresh.initial_state, sort_keys=True) == json.dumps(second, sort_keys=True),
           "reset episode matches a fresh process byte-for-byte")
    r = g.step(seconds=5)
    ok(r["time"] == 5.0, "the reset game steps normally")

# --- Test 4: determinism through the SDK -------------------------------------------
print("\n[4] Determinism: same seed + same schedule → identical canonical state")
def scripted_run():
    with Game(seed=123, faction=0) as g:
        st = g.initial_state
        ids = [u["id"] for u in st["units"] if u["fid"] == 0]
        g.gather(ids, st["nodes"][1]["id"])
        g.step(seconds=45, events=False)
        g.train(st["factions"][0]["hq"], "researcher")
        g.step(seconds=45, events=False)
        return json.dumps(g.state(), sort_keys=True)

a, b = scripted_run(), scripted_run()
ok(a == b, f"two fresh processes agree byte-for-byte ({len(a)} chars)")

# --- Test 5: a full AI-vs-AI race ends -----------------------------------------------
print("\n[5] until_over: an all-AI race reaches a verdict")
with Game(seed=11, all_ai=True) as g:
    r = g.run_until_over(max_seconds=1800)
    ok(r["over"] is not None and "winner" in r["over"], f"winner={r['over'] and r['over'].get('winner')} @ {r['time']:.0f}s")
    ok("events" not in r, "until_over skips the event flood by default")

# --- Test 6: WebSocket transport, offline (a scripted fake browser) --------------------
print("\n[6] Live transport: stdlib WebSocket server vs a scripted client")
_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def _client_send(sock, obj):
    payload = json.dumps(obj).encode()
    mask = os.urandom(4)
    head = bytes([0x81])
    ln = len(payload)
    if ln < 126:
        head += bytes([0x80 | ln])
    elif ln < 65536:
        head += bytes([0x80 | 126]) + struct.pack(">H", ln)
    else:
        head += bytes([0x80 | 127]) + struct.pack(">Q", ln)
    sock.sendall(head + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(payload)))


def _client_recv(sock):
    def exact(n):
        out = b""
        while len(out) < n:
            chunk = sock.recv(n - len(out))
            if not chunk:
                raise ConnectionError("server closed")
            out += chunk
        return out
    while True:
        b0, b1 = exact(2)
        opcode, ln = b0 & 0x0F, b1 & 0x7F
        if ln == 126:
            ln = struct.unpack(">H", exact(2))[0]
        elif ln == 127:
            ln = struct.unpack(">Q", exact(8))[0]
        payload = exact(ln) if ln else b""
        if opcode == 0x9:  # server ping (unused, but be polite)
            continue
        if opcode == 0xA:
            return ("pong", None)
        if opcode == 0x8:
            return ("close", None)
        return ("msg", json.loads(payload.decode()))


def fake_browser(port, log):
    # retry-connect until the server side is listening
    for _ in range(100):
        try:
            sock = socket.create_connection(("127.0.0.1", port), timeout=5)
            break
        except OSError:
            time.sleep(0.05)
    else:
        log.append("connect-failed")
        return
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall((
        "GET / HTTP/1.1\r\nHost: t\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    ).encode())
    resp = b""
    while b"\r\n\r\n" not in resp:
        resp += sock.recv(4096)
    head = resp.decode("latin-1")
    want = base64.b64encode(hashlib.sha1((key + _GUID).encode()).digest()).decode()
    log.append("accept-ok" if ("101" in head.split("\r\n")[0] and want in head) else "accept-bad")

    _client_send(sock, {"hello": True, "live": True, "playerFaction": 2})
    # a push BEFORE any request lands in the queue
    _client_send(sock, {"push": "events", "time": 1.0, "events": [{"t": "raid"}]})
    # send a masked ping; server must pong
    sock.sendall(bytes([0x89, 0x84]) + b"\x00\x00\x00\x00" + b"ping")
    # the pong and the server's request may arrive in either order
    got_pong, request_msg = False, None
    for _ in range(6):
        kind, msg = _client_recv(sock)
        if kind == "pong":
            got_pong = True
        elif kind == "msg" and isinstance(msg, dict) and "op" in msg:
            request_msg = msg
        if got_pong and request_msg:
            break
    log.append("pong-ok" if got_pong else "pong-missing")
    if request_msg:
        _client_send(sock, {"push": "state", "state": {"time": 2.0}})
        # reply fragmented across two frames to exercise reassembly
        payload = json.dumps({"id": request_msg["id"], "ok": True, "echo": request_msg["op"]}).encode()
        half = len(payload) // 2
        m1, m2 = os.urandom(4), os.urandom(4)
        sock.sendall(bytes([0x01, 0x80 | half]) + m1 + bytes(c ^ m1[i % 4] for i, c in enumerate(payload[:half])))
        sock.sendall(bytes([0x80, 0x80 | (len(payload) - half)]) + m2 + bytes(c ^ m2[i % 4] for i, c in enumerate(payload[half:])))
        log.append("replied")
    sock.close()


probe = socket.socket()
probe.bind(("127.0.0.1", 0))
port = probe.getsockname()[1]
probe.close()

log: list = []
t = threading.Thread(target=fake_browser, args=(port, log), daemon=True)
t.start()
ws = WsBridge(port=port, accept_timeout=10, verbose=False)
ok(ws.hello == {"hello": True, "live": True, "playerFaction": 2}, "handshake + hello received")
resp = ws.request("meta")
ok(resp.get("echo") == "meta" and resp.get("ok") is True, "request matched across pushes + fragmented reply")
pushes = ws.poll(timeout=2.0)
kinds = sorted(p["push"] for p in pushes)
ok(kinds == ["events", "state"], f"both pushes queued and drained ({kinds})")
t.join(timeout=5)
ok("accept-ok" in log and "pong-ok" in log and "replied" in log, f"client saw a correct server ({log})")

# reconnect: the first tab is gone; a second scripted tab replaces it via
# wait_client(), which must drop the stale socket and serve requests again
log2: list = []
t2 = threading.Thread(target=fake_browser, args=(port, log2), daemon=True)
t2.start()
hello2 = ws.wait_client()
ok(hello2.get("playerFaction") == 2, "wait_client swaps in a reconnecting tab")
resp2 = ws.request("state")
ok(resp2.get("echo") == "state" and resp2.get("ok") is True, "requests flow again after the reconnect")
ws.close()
t2.join(timeout=5)
ok("replied" in log2, f"second client served ({log2})")

print()
print(f"{FAILURES} FAILURE(S)" if FAILURES else "All Python SDK checks passed.")
sys.exit(1 if FAILURES else 0)
