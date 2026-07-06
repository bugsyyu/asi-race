# Python Control Interface — Guide & Technical Notes

Languages: EN | [ZH-CN](python-bridge.zh-CN.md)

The repo ships a **Python control interface** (`python/asirace`) that can drive everything inside the game from Python: unit orders, construction and training, generation research, policy plays and the industry meta-economy, ASI runs — while reading the world through either a **fog-honest** or an **omniscient** lens. Two modes share one command protocol:

| Mode | Entry point | Who owns the clock | Typical use |
| --- | --- | --- | --- |
| **Headless** | `asirace.Game` | **Python** (lockstep, fully deterministic) | scripted bots, batch experiments, AI/RL research, regression tests |
| **Live** | `asirace.LiveGame` | the browser (realtime) | spectator tooling, sidecar assistants, demos, taking over any faction |

Requirements: Python ≥ 3.9 and Node.js ≥ 18, **no third-party packages on either side** (the Python SDK is pure stdlib; Node loads the repo's sim sources directly).

## 30-second tour

```bash
python3 - <<'PY'
import sys; sys.path.insert(0, 'python')
from asirace import Game, units_of, buildings_of, nodes_alive, nearest

with Game(seed=42, faction=0) as g:            # 0=OpenAI 1=Anthropic 2=DeepMind 3=xAI
    obs = g.observe()                          # fog-honest snapshot
    hq = buildings_of(obs, 0, 'hq')[0]
    g.gather(units_of(obs, 0, 'researcher'), nearest(nodes_alive(obs), hq['x'], hq['z']))
    g.step(seconds=60)
    print(g.observe()['factions'][0]['data'])
PY
```

```bash
# live: hand a running browser game to Python
python3 -m http.server 8000                     # terminal A
# open http://localhost:8000/?bridge=8765 and press start
python3 python/examples/live_control.py --takeover 3   # terminal B: bot plays xAI
```

More in `python/examples/`: `quickstart.py` (API tour), `scripted_bot.py` (a macro bot that plays whole games under fog), `live_control.py` (live feed + takeover). `npm run test:py` self-checks the whole chain.

## Architecture

```text
┌──────────────────────────  Python  ──────────────────────────────┐
│  asirace.Game / LiveGame (command methods, snapshot helpers)      │
│  transport.NodeBridge (subprocess stdio)  transport.WsBridge (WS) │
└──────────────┬──────────────────────────────┬────────────────────┘
        JSON Lines / stdio            WebSocket (text frames, same JSON)
┌──────────────▼──────────────┐  ┌────────────▼────────────────────┐
│ bridge/server.mjs (headless)│  │ js/bridge/live.js (in-browser)   │
│ lifecycle: new_game / step  │  │ realtime: subscribe/pause/speed  │
└──────────────┬──────────────┘  └────────────┬────────────────────┘
               └──────────┬───────────────────┘
                ┌─────────▼─────────────┐
                │ js/bridge/protocol.js │ ← shared dispatch + snapshots
                └─────────┬─────────────┘   (ownership checks live here)
                ┌─────────▼──────────┐
                │ js/sim/* (as-is)   │ ← deterministic 0.1 s fixed-step sim
                └────────────────────┘
```

### Key design decisions

1. **Zero intrusion into the sim.** `js/sim` was already DOM/three-free, seeded-RNG-driven, and the built-in AI issues the same `cmd*` functions a human does — the ideal out-of-process control surface. The only sim change the interface needed is a one-line fix (NEXT_SID, below). The bridge is a sidecar layer: game, release archives and existing tests are untouched.

2. **One protocol, two carriers.** Command dispatch, snapshots and fog observation all live in `js/bridge/protocol.js`; the headless server and the browser live bridge are thin shells around it. Test the protocol once, both modes benefit; a third carrier (say, multi-client TCP) is just another shell.

3. **Transport choice: JSON Lines over stdio + WebSocket.**
   - *Not HTTP/REST*: per-command handshakes are heavy and there is no server push (the live feed needs one).
   - *Not gRPC/protobuf*: codegen and a dependency chain against this project's founding constraint (plain ES modules, no build step).
   - *Not a Python rewrite of the sim*: dual implementations drift. Reusing the same JS sources keeps headless and browser behavior byte-identical.
   - stdio extras: process lifetime *is* session lifetime (no ports, no orphans), natural backpressure, and free parallelism (one process per `Game`).
   - JSON overhead is negligible in practice (see benchmarks); the protocol is shaped for "a batch per think", not "a message per tick".

4. **Role inversion in live mode.** Python is the WebSocket **server** (`WsBridge`, a stdlib implementation of the necessary RFC 6455 subset: upgrade handshake, masked frames, fragmentation, ping/pong, close); the page is the client and auto-reconnects every 2 s. Python scripts can start, exit and restart at any time with no page reload — and no websocket pip dependency exists anywhere.

5. **Ownership checks at the boundary.** The sim's `cmd*` functions are omnipotent (the built-in AI calls them with full trust): `cmdMove` will move anyone's units, `cmdAttack` doesn't stop friendly fire, attacking a data node would NaN its hp. The protocol layer walls this off: every command carries the acting faction `fid`, unit lists are silently filtered to living units owned by `fid`, and attack targets must be hostile units/buildings. `test/bridge.mjs` [1] covers each guard.

6. **Two error classes keep bots simple.** Game-rule refusals (cost, cooldown, bad placement, dead target) return `{ok:false, msg}` — routine in a bot loop, route around them. Protocol misuse (unknown op, unknown unit type, missing args) returns `{ok:false, error}`, which the SDK raises as `BridgeError` — that's a caller bug and should explode. Rule of thumb: anything about **dynamic entities dying or changing hands is `msg`** (defection flips ownership mid-order!); static-table mistakes are `error`.

## Determinism & reproducibility

- Fixed `0.1 s` timestep; all randomness flows from `makeRng(seed)` (mulberry32) — the sim never calls `Math.random`.
- Headless mode is **lockstep**: time moves only inside `step` requests, so `(seed, command schedule)` fully determines a run. `test/bridge.mjs` [4] and `test_smoke.py` [3] verify that two independent processes replaying the same schedule produce **byte-identical full-state JSON**.
- Commands themselves may consume RNG (e.g. `channel` placement), so replays must reproduce the **complete** schedule at the same ticks, not just the "important" orders.
- Fix: the startup-id counter `NEXT_SID` in `js/sim/industry.js` was never reset between games, so a second `new_game` in one process produced different entity ids (harmless to outcomes, fatal to snapshot-level reproducibility). It now resets in `initIndustry`; same-process `new_game` is id-stable (covered by test [3]).
- Cross-platform note: JS numbers are IEEE-754 doubles — arithmetic is portable, but transcendental functions (`Math.atan2/hypot/pow`) are not required to be correctly rounded and may differ by ULPs across engines/versions. Stable within a Node major in practice; record your Node version for strict replays.
- **The event stream is a replay tape**: `step` returns every sim event (timestamped) in the window. `seed + schedule + events` reconstructs a full match offline.

## Observation model: three lenses and "public intel"

| Call | Lens | For |
| --- | --- | --- |
| `state()` | omniscient | tooling, replays, debugging |
| `observe(fid)` for the **tracked** faction | fog-honest | training/evaluating fair agents |
| `observe(fid)` for any other faction | omniscient, flagged `omniscient: true` | multi-faction scripting, explicitly unfair |

The engine keeps a fog grid for exactly one perspective (`game.fog.fid` — the `faction` you pass to `new_game`; the built-in AI is omniscient by design, a classic RTS concession documented in `js/sim/ai.js`). So **make your agent the tracked faction** for fairness; the `omniscient` flag makes the silent failure mode ("thought I trained under fog, actually had map hacks") impossible.

Under the fog-honest lens:

- Rival **units** appear only while visible, and vanish with the fog.
- Rival **buildings / data nodes / GPU clusters** persist as last-seen snapshots with `ghost: true` once out of sight (the building may long be dead — that is what memory means).
- Rival faction entries expose **public intel only**: `gen` (demo days are headlines), `trust` (public opinion), `stock`, `cloud` (market-facing), `roster/paradigms` (industry news), `asi.state/stage` (the training beam is visible map-wide). Internal ledgers — `compute/data/influence/risk/alignment/techs` — and entity ids (e.g. the rival `hq` id) stay hidden.
- `observe(fid, grids=True)` attaches `visible/explored` grids (base64 of an n×n byte map, n=110, 2 world units per cell), row-major: index `j*n+i` ↔ world `((i+0.5)*res-half, (j+0.5)*res-half)`.
- Fairness completeness: factions handed to Python get `isAI=false`, which also removes the difficulty AI-income multiplier (`chill 0.82× / brutal 1.16×`) — identical rules to a human player.

## Protocol reference

JSON messages: one per line on stdio, one per WebSocket text frame. Requests `{id?, op, ...}`; responses echo `id` (the envelope `id` wins over any payload key — which is why `build` returns the new site as `bid`).

### Lifecycle (headless only)

| op | params | notes |
| --- | --- | --- |
| `hello` | — | health check, returns protocol version |
| `new_game` | `seed?` `faction=0` `difficulty=normal` `allAI?` `control?=[fid…]` | creates a game; `faction` also picks the fog perspective; `control` lists factions detached from the built-in AI. Returns `meta` (every static data table) + initial `state`. Calling it again replaces the game on the same process — `Game.reset()` in the SDK — which is the fast, id-stable episode loop for training |
| `step` | `ticks=1` or `seconds`; `until_over` `max_seconds=3600`; `events=true` `state?` `observe?=fid` | advances the sim and drains events; `until_over` defaults events off (full games emit hundreds of thousands); event lists cap at 20 000 newest with `eventsDropped`; `state/observe` piggyback to save a round trip |
| `quit` | — | ends the process |

### Queries

`ping`, `meta`, `state`, `observe {fid, grids?}`, `can_place {fid,btype,x,z}` (placement/afford/prereq verdicts + live cost), `costs {fid}` (prices after trust discount and hardware index).

### Commands (all require `fid`)

| op | params | sim function |
| --- | --- | --- |
| `move` / `attack_move` / `stop` | `ids` `x z` | `cmdMove / cmdAttackMove / cmdStop` |
| `attack` | `ids` `target` | `cmdAttack` (refuses friendlies & non-combat entities) |
| `gather` | `ids` `node` | `cmdGather` (researchers only) |
| `build_join` | `ids` `bid` | `cmdBuild` (join an own unfinished site) |
| `smart` | `ids` `target?` `x? z?` | protocol-level re-derivation per acting faction (the sim's `cmdSmart` hardwires the human player's perspective) |
| `channel` | `ids` | `cmdChannel` (lobbyists to the Capitol) |
| `build` | `btype` `x z` `builders?` | `cmdBuildStart`; the new site returns as `bid` |
| `train` | `bid` `utype` | `cmdTrainUnit` |
| `rally` | `bid` `x z` `target?` | `cmdSetRally` (rallying onto nodes/sites/Capitol auto-assigns work) |
| `research_gen` / `start_asi` | — | `cmdResearchGen / cmdStartASI` |
| `research_tech` | `bid` `key` | `cmdResearchTech` |
| `trade` | `dir: c2d\|d2c` | `cmdTrade` (spot market with slippage) |
| `policy` | `pid` `target?` | `cmdPolicy` |
| `raise` / `cloud` / `acquire` / `poach` | — / `on` / `sid` / `key` | industry layer `cmdRaise / cmdCloudMode / cmdAcquire / cmdPoach` |
| `set_ai` | `ai: bool` | toggle the built-in AI for a faction (off → external control; on → a fresh AI brain) |

### Live-only (handled in the browser)

`subscribe {events?, state?=seconds, fid?}` (event stream / periodic snapshots; the snapshot period counts **sim time**, so pausing pauses pushes), `pause {on}`, `speed {x:1|2}`, `select {ids}` (highlight in the player's UI), `center {x,z}` (fly the camera). Pushes arrive as `{push:'events'|'state', ...}` and queue behind `poll()`. Live mode refuses `step/new_game` — the browser owns the clock.

## Performance (measured in this container, Node v22 / Python 3.11)

| metric | measured |
| --- | --- |
| raw sim throughput (4 AIs, full-match average) | ≈ 3 200 ticks/s ≈ **320× realtime** |
| omniscient snapshot serialization (mid-game, 73 units) | 0.19 ms / ≈ 21 KB |
| fog observation serialization | 0.13 ms |
| Python lockstep single-tick round trip | ≈ 0.54 ms (≈ 1 870 ticks/s) |
| Python `observe()` round trip | ≈ 0.28 ms |
| Python batch-stepping 600 sim-seconds | 2.3 s (≈ **260× realtime**, AI opponents included) |

Guidance: for training, think once then `step(seconds=Δ, observe=fid)` to piggyback the observation — your agent will be the bottleneck. Even the extreme lockstep of observing every tick sustains ~1 000 steps/s.

## Tests & verification

- `npm test` → `test/headless.mjs` (the pre-existing 9 sim suites, untouched) + `test/bridge.mjs` (4 suites / 45 checks: protocol guards, fog observations, the stdio server, two-process determinism).
- `npm run test:py` → `python/tests/test_smoke.py` (6 suites / 29 checks: end-to-end economy loop, multi-faction control, `reset()` episode loops, determinism, a full `until_over` race, and an **offline WebSocket transport test** — a scripted "fake browser" exercises the handshake, masked/fragmented frames, ping/pong, push queuing and tab-swap reconnection without launching anything).
- The live path was verified end-to-end against real headless Chromium: Python attached to a rendering match; select/move/camera/speed/pause all reflected in the game UI, event and state pushes flowed back.

## Known limits & roadmap

- **Single fog perspective**: the engine tracks one faction's fog grid. Fair multi-agent self-play needs per-faction fog (×4 memory and recompute — feasible, but a sim-layer change; future work).
- **Commands are ownership-checked, not visibility-checked**: like the built-in AI, a controller can technically issue orders against entity ids it never scouted (the sim itself is omniscient). Honest agents should act only on what `observe()` returns; a hard visibility gate would break symmetry with the built-in opponents, so it is deliberately not imposed.
- **No save/restore**: tree search can't snapshot yet; the equivalent is `seed + command replay` (fast — see benchmarks). Event streams export fully.
- **Live mode is single-client**: one page per `WsBridge`; run more ports for more observers. The protocol is stateless, so a multi-client shell is straightforward.
- **No auth**: the bridge assumes a trusted machine; `WsBridge` binds `127.0.0.1` by default. Do not expose the port publicly.
- A **Gym-style wrapper** is the natural next step: `observe` already provides structured observations plus scalars like `exploredFrac`. Start the action space with macro actions (build-category + auto-placement, group-level attack/defend), leave per-unit micro to later experiments.
- The browser live sim is not lockstep (RAF-driven, pausable) — do **not** run reproducibility-sensitive experiments there; that's what headless mode is for.

## File map

```text
bridge/server.mjs             headless stdio server (Node)
js/bridge/protocol.js         shared protocol: dispatch + snapshots (both modes)
js/bridge/live.js             browser live bridge (lazy-loaded on ?bridge=PORT)
python/asirace/               SDK: game.py (Game/LiveGame), transport.py (stdio/WS)
python/examples/              quickstart / scripted_bot / live_control
python/tests/test_smoke.py    Python end-to-end smoke test (npm run test:py)
test/bridge.mjs               protocol & server tests (part of npm test)
```
