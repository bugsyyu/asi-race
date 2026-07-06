# ============================================================================
# High-level control surface.
#
#   Game      — headless simulation. Python owns the clock: nothing moves
#               until you call step()/run(), so agents may think arbitrarily
#               long between ticks and runs replay exactly from (seed, orders).
#   LiveGame  — a real browser session (open the game with ?bridge=PORT).
#               Realtime: commands apply within a frame, step() is refused.
#
# Both speak the identical op set (see docs/python-bridge.md for the protocol
# reference); every command returns the sim's own {"ok": ..., "msg": ...}
# verdict as a plain dict — game refusals never raise.
# ============================================================================
from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List, Optional, Sequence, Union

from .transport import BridgeError, NodeBridge, WsBridge

_UNSET = object()

IdLike = Union[int, Dict[str, Any]]


def _ids(ids: Union[IdLike, Sequence[IdLike]]) -> List[int]:
    """Accept an id, an entity dict, or any sequence of either."""
    if isinstance(ids, int):
        return [ids]
    if isinstance(ids, dict):
        return [int(ids["id"])]
    out: List[int] = []
    for u in ids:
        out.append(int(u["id"]) if isinstance(u, dict) else int(u))
    return out


# ---------------------------------------------------------------------------
# snapshot helpers — snapshots are plain dicts; these keep bot code short
# ---------------------------------------------------------------------------
def units_of(state: Dict[str, Any], fid: int, utype: Optional[str] = None) -> List[Dict[str, Any]]:
    return [u for u in state["units"] if u["fid"] == fid and (utype is None or u["type"] == utype)]


def buildings_of(
    state: Dict[str, Any], fid: int, btype: Optional[str] = None, done: Optional[bool] = None
) -> List[Dict[str, Any]]:
    out = []
    for b in state["buildings"]:
        if b.get("ghost") or b["fid"] != fid:
            continue
        if btype is not None and b["type"] != btype:
            continue
        if done is not None and b.get("done") != done:
            continue
        out.append(b)
    return out


def faction_of(state: Dict[str, Any], fid: int) -> Dict[str, Any]:
    return state["factions"][fid]


def nodes_alive(state: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [n for n in state["nodes"] if not n.get("ghost") and n.get("amount", 0) > 0]


def nearest(items: Iterable[Dict[str, Any]], x: float, z: float) -> Optional[Dict[str, Any]]:
    best, bd = None, float("inf")
    for it in items:
        d = (it["x"] - x) ** 2 + (it["z"] - z) ** 2
        if d < bd:
            bd, best = d, it
    return best


# ---------------------------------------------------------------------------
# the shared command surface
# ---------------------------------------------------------------------------
class _Commands:
    """Every protocol op as a method. `fid=None` means self.faction."""

    faction: int = 0
    _t: Any  # transport

    def _call(self, op: str, **kw: Any) -> Dict[str, Any]:
        return self._t.request(op, **kw)

    def _fid(self, fid: Optional[int]) -> int:
        return self.faction if fid is None else int(fid)

    # -- queries ---------------------------------------------------------------
    def state(self) -> Dict[str, Any]:
        """Full omniscient snapshot (tooling / research view)."""
        return self._call("state")["state"]

    def observe(self, fid: Optional[int] = None, grids: bool = False) -> Dict[str, Any]:
        """Fog-honest snapshot from `fid`'s chair. Only the game's tracked
        perspective (its playerFaction) has real fog data — anything else
        comes back flagged ``omniscient: True``."""
        r = self._call("observe", fid=self._fid(fid), grids=True if grids else None)
        return r["state"]

    def costs(self, fid: Optional[int] = None) -> Dict[str, Any]:
        return self._call("costs", fid=self._fid(fid))

    def can_place(self, btype: str, x: float, z: float, fid: Optional[int] = None) -> Dict[str, Any]:
        return self._call("can_place", fid=self._fid(fid), btype=btype, x=x, z=z)

    # -- unit orders --------------------------------------------------------------
    def move(self, ids, x: float, z: float, fid: Optional[int] = None) -> Dict[str, Any]:
        return self._call("move", fid=self._fid(fid), ids=_ids(ids), x=x, z=z)

    def stop(self, ids, fid: Optional[int] = None) -> Dict[str, Any]:
        return self._call("stop", fid=self._fid(fid), ids=_ids(ids))

    def attack(self, ids, target: IdLike, fid: Optional[int] = None) -> Dict[str, Any]:
        return self._call("attack", fid=self._fid(fid), ids=_ids(ids), target=_ids(target)[0])

    def attack_move(self, ids, x: float, z: float, fid: Optional[int] = None) -> Dict[str, Any]:
        return self._call("attack_move", fid=self._fid(fid), ids=_ids(ids), x=x, z=z)

    def gather(self, ids, node: IdLike, fid: Optional[int] = None) -> Dict[str, Any]:
        return self._call("gather", fid=self._fid(fid), ids=_ids(ids), node=_ids(node)[0])

    def build_join(self, ids, bid: IdLike, fid: Optional[int] = None) -> Dict[str, Any]:
        """Send researchers to help an unfinished friendly building."""
        return self._call("build_join", fid=self._fid(fid), ids=_ids(ids), bid=_ids(bid)[0])

    def smart(self, ids, target: Optional[IdLike] = None, x: Optional[float] = None,
              z: Optional[float] = None, fid: Optional[int] = None) -> Dict[str, Any]:
        """The right-click: gather / help build / attack / move by target kind."""
        return self._call(
            "smart", fid=self._fid(fid), ids=_ids(ids),
            target=_ids(target)[0] if target is not None else None, x=x, z=z,
        )

    def channel(self, ids, fid: Optional[int] = None) -> Dict[str, Any]:
        """Send lobbyists to the Capitol to generate influence."""
        return self._call("channel", fid=self._fid(fid), ids=_ids(ids))

    # -- construction & production ---------------------------------------------------
    def build(self, btype: str, x: float, z: float, builders=None, fid: Optional[int] = None) -> Dict[str, Any]:
        return self._call(
            "build", fid=self._fid(fid), btype=btype, x=x, z=z,
            builders=_ids(builders) if builders is not None else None,
        )

    def train(self, bid: IdLike, utype: str, fid: Optional[int] = None) -> Dict[str, Any]:
        return self._call("train", fid=self._fid(fid), bid=_ids(bid)[0], utype=utype)

    def rally(self, bid: IdLike, x: float, z: float, target: Optional[IdLike] = None,
              fid: Optional[int] = None) -> Dict[str, Any]:
        return self._call(
            "rally", fid=self._fid(fid), bid=_ids(bid)[0], x=x, z=z,
            target=_ids(target)[0] if target is not None else None,
        )

    def research_gen(self, fid: Optional[int] = None) -> Dict[str, Any]:
        return self._call("research_gen", fid=self._fid(fid))

    def research_tech(self, bid: IdLike, key: str, fid: Optional[int] = None) -> Dict[str, Any]:
        return self._call("research_tech", fid=self._fid(fid), bid=_ids(bid)[0], key=key)

    def start_asi(self, fid: Optional[int] = None) -> Dict[str, Any]:
        return self._call("start_asi", fid=self._fid(fid))

    # -- markets, politics, industry ---------------------------------------------------
    def trade(self, direction: str, fid: Optional[int] = None) -> Dict[str, Any]:
        """'c2d' sells compute for data; 'd2c' the reverse (slippage applies)."""
        return self._call("trade", fid=self._fid(fid), dir=direction)

    def policy(self, pid: str, target: Optional[int] = None, fid: Optional[int] = None) -> Dict[str, Any]:
        return self._call("policy", fid=self._fid(fid), pid=pid, target=target)

    def raise_capital(self, fid: Optional[int] = None) -> Dict[str, Any]:
        return self._call("raise", fid=self._fid(fid))

    def cloud(self, on: bool = True, fid: Optional[int] = None) -> Dict[str, Any]:
        return self._call("cloud", fid=self._fid(fid), on=bool(on))

    def acquire(self, sid: IdLike, fid: Optional[int] = None) -> Dict[str, Any]:
        return self._call("acquire", fid=self._fid(fid), sid=_ids(sid)[0])

    def poach(self, key: str, fid: Optional[int] = None) -> Dict[str, Any]:
        return self._call("poach", fid=self._fid(fid), key=key)

    # -- control plane -------------------------------------------------------------------
    def set_ai(self, fid: int, on: bool) -> Dict[str, Any]:
        """Hand a faction to (on=True) or take it from (on=False) the built-in AI."""
        return self._call("set_ai", fid=int(fid), ai=bool(on))

    # -- convenience -----------------------------------------------------------------------
    def find_spot(self, btype: str, near_x: float, near_z: float, r0: float = 12.0,
                  r1: float = 36.0, step: float = 3.5, fid: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """Spiral outward from (near_x, near_z) until can_place accepts —
        the same search the built-in AI uses. Returns {'x','z',...} or None."""
        bias = math.atan2(-near_z, -near_x)  # face the map center, like the AI
        r = r0
        while r <= r1:
            for k in range(10):
                a = bias + (1 if k % 2 else -1) * ((k + 1) // 2) * 0.62
                x, z = near_x + math.cos(a) * r, near_z + math.sin(a) * r
                res = self.can_place(btype, x, z, fid=fid)
                if res.get("place"):
                    return {"x": round(x, 2), "z": round(z, 2), **res}
            r += step
        return None


# ---------------------------------------------------------------------------
# headless
# ---------------------------------------------------------------------------
class Game(_Commands):
    """A headless deterministic game driven entirely from Python.

    >>> with Game(seed=42, faction=0) as g:
    ...     me = g.observe()
    ...     g.step(seconds=30)
    """

    def __init__(
        self,
        seed: Optional[int] = None,
        faction: int = 0,
        difficulty: str = "normal",
        all_ai: bool = False,
        control: Optional[List[int]] = None,
        root: Optional[str] = None,
        node: str = "node",
    ) -> None:
        self._t = NodeBridge(root=root, node=node)
        try:
            resp = self._t.request(
                "new_game",
                seed=seed, faction=faction, difficulty=difficulty,
                allAI=True if all_ai else None, control=control,
            )
        except BridgeError:
            self._t.close()
            raise
        self.faction = faction
        self.meta: Dict[str, Any] = resp["meta"]
        self.initial_state: Dict[str, Any] = resp["state"]
        self.seed: int = resp["state"]["seed"]
        self.time: float = 0.0
        self.over: Optional[Dict[str, Any]] = None

    # -- time control ---------------------------------------------------------
    def step(self, ticks: Optional[int] = None, seconds: Optional[float] = None,
             events: bool = True, state: bool = False,
             observe: Optional[int] = None) -> Dict[str, Any]:
        """Advance the sim (default one 0.1 s tick). Returns time/over plus the
        events drained during the window; optionally a snapshot in the same
        round trip (state=True or observe=<fid>)."""
        r = self._call(
            "step", ticks=ticks, seconds=seconds,
            events=False if not events else None,
            state=True if state else None, observe=observe,
        )
        self.time, self.over = r["time"], r["over"]
        return r

    def run(self, seconds: float, **kw: Any) -> Dict[str, Any]:
        return self.step(seconds=seconds, **kw)

    def run_until_over(self, max_seconds: float = 3600.0, events: bool = False) -> Dict[str, Any]:
        """Let the race finish (or the cap expire). Event collection is off by
        default — full games generate hundreds of thousands of events."""
        r = self._call("step", until_over=True, max_seconds=max_seconds,
                       events=True if events else None)
        self.time, self.over = r["time"], r["over"]
        return r

    # -- lifecycle ---------------------------------------------------------------
    def close(self) -> None:
        self._t.close()

    def __enter__(self) -> "Game":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


# ---------------------------------------------------------------------------
# live browser session
# ---------------------------------------------------------------------------
class LiveGame(_Commands):
    """Drive a game already running in a browser tab.

    Start the page with ``?bridge=8765`` (any port), then:

    >>> g = LiveGame(port=8765)          # blocks until the tab connects
    >>> g.subscribe(events=True)
    >>> for push in g.poll(timeout=5):   # incoming sim events
    ...     print(push)
    """

    def __init__(
        self,
        port: int = 8765,
        host: str = "127.0.0.1",
        faction: Optional[int] = None,
        accept_timeout: Optional[float] = None,
        verbose: bool = True,
    ) -> None:
        self._t = WsBridge(port=port, host=host, accept_timeout=accept_timeout, verbose=verbose)
        hello = self._t.hello or {}
        pf = hello.get("playerFaction", -1)
        self.faction = faction if faction is not None else (pf if isinstance(pf, int) and pf >= 0 else 0)
        self._meta: Optional[Dict[str, Any]] = None

    @property
    def meta(self) -> Dict[str, Any]:
        if self._meta is None:
            self._meta = self._call("meta")["meta"]
        return self._meta

    # -- live-only surface -------------------------------------------------------
    def subscribe(self, events: Optional[bool] = None, state: Optional[float] = None,
                  fid: Any = _UNSET) -> Dict[str, Any]:
        """events=True streams sim events; state=N pushes a snapshot every N sim
        seconds (0 stops); fid=<int> makes those snapshots fog-filtered,
        fid=None omniscient."""
        msg: Dict[str, Any] = {"op": "subscribe"}
        if events is not None:
            msg["events"] = bool(events)
        if state is not None:
            msg["state"] = float(state)
        if fid is not _UNSET:
            msg["fid"] = fid
        return self._t.request_raw(msg)

    def poll(self, timeout: float = 0.0) -> List[Dict[str, Any]]:
        """Drain pending pushes ({'push':'events'|'state', ...})."""
        return self._t.poll(timeout)

    def pause(self, on: bool = True) -> Dict[str, Any]:
        return self._call("pause", on=bool(on))

    def resume(self) -> Dict[str, Any]:
        return self._call("pause", on=False)

    def speed(self, x: int = 1) -> Dict[str, Any]:
        return self._call("speed", x=x)

    def select(self, ids) -> Dict[str, Any]:
        """Highlight units in the player's UI (visual only)."""
        return self._call("select", ids=_ids(ids))

    def center(self, x: float, z: float) -> Dict[str, Any]:
        """Fly the player's camera to (x, z)."""
        return self._call("center", x=x, z=z)

    def wait_client(self) -> Dict[str, Any]:
        """Block for a (re)connecting browser tab after a disconnect."""
        return self._t.wait_client()

    # -- lifecycle ------------------------------------------------------------------
    def close(self) -> None:
        self._t.close()

    def __enter__(self) -> "LiveGame":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()
