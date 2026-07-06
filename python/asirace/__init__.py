"""asirace — the Python control interface for the ASI-Race RTS simulation.

Headless (Python owns the clock, fully deterministic)::

    from asirace import Game

    with Game(seed=42, faction=0) as g:
        obs = g.observe()                       # fog-honest snapshot
        g.step(seconds=30)                      # advance the sim

Live (drive the game rendering in a browser tab opened with ?bridge=8765)::

    from asirace import LiveGame

    g = LiveGame(port=8765)
    g.subscribe(events=True)
    print(g.poll(timeout=5))

See docs/python-bridge.md (EN) / docs/python-bridge.zh-CN.md (中文) for the
architecture notes and the full protocol reference. Standard library only —
the only external requirement is Node.js >= 18 for the headless simulator.
"""
from .transport import BridgeError, NodeBridge, WsBridge, find_repo_root
from .game import (
    Game,
    LiveGame,
    buildings_of,
    faction_of,
    nearest,
    nodes_alive,
    units_of,
)

__version__ = "1.0.0"
__all__ = [
    "BridgeError",
    "Game",
    "LiveGame",
    "NodeBridge",
    "WsBridge",
    "find_repo_root",
    "units_of",
    "buildings_of",
    "faction_of",
    "nodes_alive",
    "nearest",
    "__version__",
]
