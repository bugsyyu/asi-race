# ASI Race

![ASI Race gameplay screenshot](docs/screenshots/gameplay.png)

Languages: [EN](README.md) | [JA](README.ja.md) | [FR](README.fr.md) | [ZH-CN](README.zh-CN.md) | [ZH-TW](README.zh-TW.md)

ASI Race is a browser-based 3D real-time strategy game about the race to superintelligence. Four AI-lab-inspired factions compete for compute, data, talent, government favor, public trust, risk control, and alignment. The match ends when one faction completes ASI training first, or when every rival headquarters is destroyed.

> This is an unofficial parody project. It is not affiliated with, endorsed by, or sponsored by OpenAI, Anthropic, Google DeepMind, xAI, or any real lab. The faction identities are playful game abstractions based on public impressions and do not depict real people.

## Run From Source

This repository contains the shared browser game source extracted from the Fable-generated packages. `vendor/three.module.js` is included, so the source version runs directly from any local static server.

```bash
python3 -m http.server 8000
# Open http://localhost:8000
```

Run the headless simulation checks with:

```bash
npm test
# Runs node test/headless.mjs and node test/bridge.mjs
```

## Python Control Interface

The repo ships a dependency-free Python SDK (`python/asirace`) that can drive every behavior in the game from Python: lockstep-drive the deterministic simulation headlessly (scripted bots, AI experiments), or open a running browser match with `?bridge=8765` and command it in realtime — up to taking any faction over from the built-in AI.

```python
import sys; sys.path.insert(0, 'python')
from asirace import Game

with Game(seed=42, faction=0) as g:      # requires Node.js >= 18
    g.step(seconds=60)
    print(g.observe()['factions'][0]['compute'])
```

Examples live in `python/examples/` (`quickstart.py` API tour, `scripted_bot.py` — plays whole games under fog of war, `live_control.py` — spectate or take over a browser match). Architecture decisions, the protocol reference and benchmarks: [docs/python-bridge.md](docs/python-bridge.md). `npm run test:py` runs the Python end-to-end checks.

## Release Downloads

GitHub Release `v1.1.0` ships the two platform archives, rebuilt from the current source by the `release` GitHub Actions workflow (`packaging/build-zips.sh`) with everything in [CHANGELOG.md](CHANGELOG.md):

- `asi-race-mac-zh.zip`: macOS package with an app bundle and launcher script.
- `asi-race-win-zh.zip`: Windows package with a command launcher and a PowerShell local-server launcher.

Both archives bundle the Three.js engine, so they run fully offline out of the box; if the file is ever removed, the launchers can still fetch it during an online launch. Release `v1.0.0` keeps the original initial-build archives.

## Controls

| Input | Action |
| --- | --- |
| Two-finger swipe | Pan camera |
| Pinch / ctrl+wheel | Zoom |
| Two-finger tap / right click | Smart command: move, gather, attack, rally |
| Click / drag box / shift | Select, box select, add to selection |
| Q / E, WASD / arrow keys, H | Rotate, pan, center on headquarters |
| [ / ] or alt+wheel | Tilt the camera — dip to a near-horizon battle shot or back to bird's-eye |
| ctrl+1-4 / 1-4 | Save / recall control groups |
| A + click | Attack-move: the squad clears everything hostile on the way |
| Tab | Cycle idle researchers (and jump the camera) |
| Space | Jump to the most recent attack |
| P, F, M, Esc, ? / F1 | Pause, 2x speed, mute, cancel, manual |

The in-game field manual has five pages covering goals, controls, economy, politics and trust, and endings.

## Gameplay

- Compute comes from headquarters, data centers, and capturable GPU clusters.
- Data is gathered by researchers from map nodes; later labs generate synthetic data automatically.
- Influence is produced by lobbying at the capitol and spent on export controls, compute subsidies, regulatory investigations, and PR campaigns.
- Talent sets the population cap; trust affects hiring cost and poaching risk.
- Rushing research increases risk, while alignment research lowers accident pressure and affects the ending.
- Two battlefield lighting modes are selectable at start: ☀ day (sun-baked golden grassland in a dark void, white campuses) and 🌆 dusk (the original twilight look).
- The presentation aims for cinematic stylized realism: filmic grading (desaturation, vignette, grain), photo-textured terrain with real cut-and-fill earthworks graded under every building site, dark machined-deck aprons with faction-lit corner bollards instead of prop bases, building skins rebuilt to the original reference footage — polished pearl-alloy panels and ribbon glass with environment reflections, no more raw concrete — facades carrying human-scale service details (access ladders, gutters, intake grilles), a near-future architecture vocabulary composited from many real tech-campus references and pushed beyond them, and skeletally animated characters at adult proportions.
- Dynamic weather drifts over the battlefield: cloud shadows sweep the ground, showers dim the sun behind a rain veil, then the golden light returns; the day grade is tuned radiant — warm key light, orange-teal split toning, shimmering highlights.
- The bottom HUD is a professional RTS command console: a tactical-map station with corner brackets and a sensor sweep, a command-info station with a faction nameplate, segmented health readout and build-queue cells, and an order deck of beveled command keys with hotkey caps, cost strips and lock/alert states — three chamfered armor-plate stations riveted onto a full-width chassis rail, all tinted with your faction's livery.
- Terrain is a gameplay system: mesa walls cut the outer lanes so armies funnel through the GPU-cluster passes, slopes slow movement, steep flanks refuse both paths and construction, and units on high ground see farther and hit ~30% harder (attacking uphill hits softer).
- An Age-of-Empires-style operations layer: one-shot economy techs researched inside each building (optical interconnect, data pipelines, red-team drills, process oversight…), plus a compute spot market with slippage at the HQ for emergency resource swaps.
- Rival AIs run the same playbook: they buy techs on personality-driven priorities, trade on the market, read your army and train counters, escort miners to far nodes, retreat spent raids, and dig in with firewall towers facing the direction you last attacked from.
- An industry meta-economy runs alongside the war: per-lab stock prices and secondary offerings, a hardware index moved by crypto runs / shortages / open-source drops, cloud sell-side mode (rent out compute for data + influence and depress hardware prices for everyone), and parody star researchers who quit, defect, get headhunted — or found startups on the map that anyone can acquire before they IPO their paradigm to the whole field.
- The endgame is the Emergence: a live training run wakes in five grounded stages whose temperament reads your current alignment — recursive self-improvement melts the clock, checkpoint commercialization funds the lab and undercuts rivals' compute resale, scaled narrative campaigns (or published safety evals) bend trust, a winner-takes-all talent rush (plus bought insiders) drains rivals, and the final act is either defensive disclosure or a legal-but-ruthless grid-capacity squeeze; two simultaneous runs redline into competitive overclocking.
- Fog of war covers the battlefield: units and buildings provide sight, explored ground dims to a memory that only keeps the last-seen state of enemy structures, and the minimap follows the fog — only the light pillar of an ASI training run is visible from anywhere.
- Victory can come through the Gen-2, Gen-3, Gen-4 / AGI, and ASI training ladder, or by destroying all rival headquarters.

The playable factions are inspired by OpenAI, Anthropic, Google DeepMind, and xAI, each with a distinct economic or safety-oriented bonus.

## Project Layout

```text
index.html            Browser entry point
css/                  HUD, start screen, and battlefield overlay styles
js/sim/               Deterministic simulation layer, independent of DOM and three.js
js/view/              three.js presentation layer, terrain, buildings, characters, effects
js/ui/                HUD and in-game tutorial
js/audio/             WebAudio effects and ambient music
js/shared/            Functions shared by simulation and rendering
js/bridge/            External-control protocol + in-browser live bridge (?bridge=PORT)
bridge/               Headless bridge server (Node, JSON Lines over stdio)
python/               Python SDK (asirace), example bots and smoke tests
docs/                 Screenshots and the Python-interface technical notes
test/headless.mjs     Node simulation test suite
test/bridge.mjs       Bridge protocol & server tests
vendor/               Vendored three.js v0.170.0
packaging/            Launcher sources extracted from macOS and Windows packages
```

The simulation advances in fixed 0.1-second ticks. Rendering reads state and plays interpolated visual feedback. AI players use the same command API as the human player.

## Original Prompt

```text
Build me a playable 3D real-time strategy game in the browser — Age of
Empires-style gameplay from a bird's-eye view — as a metaphor for the AI race
to superintelligence. The factions are OpenAI, Anthropic, Google DeepMind, and
xAI, each with brand-inspired identity and a bonus matching their personality.
Don't just reskin an RTS: invent the mechanics from the metaphor — think about
what these labs actually compete over (compute, data, talent, government favor,
public perception) and turn those into the economy, the tech progression, and
the win condition. Rival labs should be real AI opponents racing you, and the
whole thing should end with someone reaching superintelligence first.
Use Three.js (plain ES modules, no build step, local static server), built entirely
from real downloaded assets — high quality ones, never AI-generated.
Characters should be rigged models that genuinely walk, work, and fight with
skeletal animations. Make it cinematic and juicy — dramatic lighting, real
shadows, feedback effects on every action — and give it a full soundscape: real
sound effects for combat, building, and alerts, with quiet background music
underneath. Trackpad-first controls, a clean overlay HUD, and an in-game how-
to-play guide. Keep the simulation separate from the rendering, and verify each
system live in the browser as you build rather than at the end.
```

## Asset Note

The original prompt requested real downloaded assets. The current Fable output actually depends only on the downloaded Three.js module; buildings, character geometry, skeletal animation poses, textures, sound effects, and ambient music are generated procedurally by the project code. On top of that state, the repository now bundles two real CC0 terrain texture sets from Poly Haven under `assets/textures/` (aerial grass/rock diffuse + normal, dry mud diffuse) used by the ground renderer; all other art remains procedural. This repository preserves that implementation state and pins Three.js to `0.170.0` so the source version runs directly.
