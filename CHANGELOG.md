# Changelog

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
