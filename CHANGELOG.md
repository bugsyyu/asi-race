# Changelog

## Unreleased

### Python control interface
- New dependency-free Python SDK (`python/asirace`) that drives every in-game behavior externally, two modes over one protocol: headless lockstep games via a stdio JSON-Lines bridge (`bridge/server.mjs`, spawned per `Game`), and realtime control of a running browser match over WebSocket (open with `?bridge=PORT`; `js/bridge/live.js` auto-reconnects) — including taking factions over from the built-in AI (`set_ai`), UI courtesies (pause / speed / select / camera) and event/state push subscriptions.
- Shared protocol layer `js/bridge/protocol.js`: faction-scoped command validation at the boundary (no commanding foreign units, no friendly fire, no NaN-inducing targets), omniscient snapshots, fog-honest `observe` with last-seen ghosts and a public-intel view of rival factions, base64 fog grids, live cost/placement queries, and a game-rule-vs-protocol-error taxonomy so bots never crash on routine refusals.
- Examples (`python/examples/`): `quickstart.py` API tour, `scripted_bot.py` — a macro bot that plays whole games under fog of war (the same brain drives headless and live takeover), `live_control.py` — spectate feed or faction takeover. Architecture notes, protocol reference and benchmarks in `docs/python-bridge.md` / `docs/python-bridge.zh-CN.md`.
- Tests: `test/bridge.mjs` joins `npm test` (protocol guards, fog observations, stdio server round trips, two-process byte-level determinism); `npm run test:py` runs the Python end-to-end suite including an offline WebSocket transport check against a scripted fake browser.

### Fixes
- `js/sim/industry.js`: the startup-id counter is reset per game, so repeated games in one process reproduce identical entity ids (snapshot-level determinism; outcomes were never affected).

## v1.1.0 — 2026-07-05

A full gameplay, presentation and interface overhaul of the initial release.

### Interface
- The bottom HUD is rebuilt as a professional RTS command console: tactical-map station (corner brackets, sensor sweep), command-info station (faction nameplate, segmented health bar, build-queue cells), and an order deck of beveled command keys with hotkey caps, cost strips, lock hatching and low-resource alerts — three chamfered armor-plate stations docked on a full-width chassis rail, tinted with the player faction's livery.
- Top bar reflowed so the race tape, resource strip and meters never overlap; AI news ticker; battle feed; camera tilt controls (`[`/`]`, alt+wheel).

### World & presentation
- Fog of war with exploration memory, fogged minimap, and correct dimmed shading for scenery inside the fog.
- Two lighting modes (☀ day / 🌆 dusk), filmic grade (desaturation, vignette, grain, orange-teal split tone) and a radiant "dopamine" day look.
- Dynamic weather: drifting cloud shadows, rain showers behind a veil, golden clear-ups.
- Photo-textured terrain (Poly Haven CC0), real cut-and-fill earthworks under every site, dark machined-deck aprons with faction-lit corner bollards instead of prop bases.
- Beyond-reality architecture pass for all seven building types plus startup campuses; building skins rebuilt to the original reference footage — polished pearl-alloy panels and ribbon glass with environment reflections, no raw concrete; facades carry human-scale service details (ladders, gutters, intake grilles); two-tone material scheme, faction livery.
- Characters rebuilt at realistic adult proportions with re-seated role kits.

### Gameplay
- Terrain is a combat system: mesa walls funnel armies through GPU-cluster passes, slopes slow movement, steep ground blocks paths and construction, high ground grants sight and ~30% damage advantage.
- Age-of-Empires-style operations layer: eight one-shot economy techs researched inside buildings, plus a compute spot market with slippage at the HQ.
- Industry meta-economy anchored to the map: per-lab stock prices moved by battles and captures, secondary offerings, hardware index shocks (crypto runs, shortages, open-source drops), cloud sell-side mode billed per standing datacenter, parody star researchers who quit / defect / get poached — or found startup campuses on the map that can be acquired on site (envoy due diligence) before they IPO their paradigm to the whole field.
- The Emergence endgame: a live ASI training run wakes through five grounded stages read from your current alignment — self-improving pipelines, checkpoint commercialization, narrative engines (or published safety evals), a talent siphon with bought insiders, and a final defensive disclosure or grid-capacity squeeze; two simultaneous runs redline into competitive overclocking.
- Smarter rival AIs: personality-driven tech priorities, market trades, army-composition counters, escorted miners, retreating raids, directional tower defense, stage-aware all-ins.

### Packaging
- macOS / Windows launcher archives are rebuilt from the current source by a GitHub Actions `release` workflow (`packaging/build-zips.sh`) and published on the release.
- Both archives now bundle the Three.js engine — fully offline out of the box; the launchers' first-online-launch download remains as a repair fallback.

### Fixes
- Buildings can no longer interpenetrate (placement margin + tightened visual envelopes).
- Placement ghost honors the full placement rule set; construction-lamp emissive capture fixed; HUD top-bar overlap fixed.

## v1.0.0 — 2026-07-02

Initial public release: the original Fable-generated browser RTS with macOS / Windows launcher archives (`asi-race-mac-zh.zip`, `asi-race-win-zh.zip`).
