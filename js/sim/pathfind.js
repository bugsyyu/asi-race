// Coarse grid A* around building footprints. Cells of 4 world units over ±110.
// The static heightfield contributes too: steep cells are walls, sloped cells
// cost extra, so armies route through the mesa passes instead of up cliffs.
import { slopeAt } from '../shared/height.js';
import { TUNE } from './constants.js';
const CELL = 4, HALF = 110, N = Math.floor((HALF * 2) / CELL); // 55x55

let SLOPES = null; // terrain is immutable — sample once
function slopeGrid() {
  if (SLOPES) return SLOPES;
  SLOPES = new Float32Array(N * N);
  for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
    SLOPES[cz * N + cx] = slopeAt(cx * CELL - HALF + CELL / 2, cz * CELL - HALF + CELL / 2);
  }
  return SLOPES;
}

export function rebuildGrid(game) {
  const g = new Uint8Array(N * N); // 0 free, 1 blocked
  const sl = slopeGrid();
  for (let i = 0; i < N * N; i++) if (sl[i] > TUNE.steepBlock) g[i] = 1;
  const blockCircle = (x, z, r) => {
    const x0 = Math.max(0, Math.floor((x - r + HALF) / CELL)), x1 = Math.min(N - 1, Math.floor((x + r + HALF) / CELL));
    const z0 = Math.max(0, Math.floor((z - r + HALF) / CELL)), z1 = Math.min(N - 1, Math.floor((z + r + HALF) / CELL));
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const wx = cx * CELL - HALF + CELL / 2, wz = cz * CELL - HALF + CELL / 2;
      if ((wx - x) ** 2 + (wz - z) ** 2 < r * r) g[cz * N + cx] = 1;
    }
  };
  for (const b of game.buildings) blockCircle(b.x, b.z, b.fp + 0.6);
  for (const c of game.clusters) blockCircle(c.x, c.z, c.fp - 1.5);
  for (const s of (game.industry?.startups || [])) blockCircle(s.x, s.z, s.fp + 0.6);
  blockCircle(game.capitol.x, game.capitol.z, game.capitol.fp - 2);
  game.grid = g;
  game.gridDirty = false;
}

const toCell = v => Math.max(0, Math.min(N - 1, Math.floor((v + HALF) / CELL)));
const toWorld = c => c * CELL - HALF + CELL / 2;

export function findPath(game, x0, z0, x1, z1) {
  if (game.gridDirty || !game.grid) rebuildGrid(game);
  const g = game.grid;
  const sx = toCell(x0), sz = toCell(z0);
  let ex = toCell(x1), ez = toCell(z1);
  // If the goal cell is blocked (clicked on a building), walk toward nearest free ring cell.
  if (g[ez * N + ex]) {
    outer: for (let r = 1; r < 6; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const cx = ex + dx, cz = ez + dz;
        if (cx < 0 || cz < 0 || cx >= N || cz >= N) continue;
        if (!g[cz * N + cx]) { ex = cx; ez = cz; break outer; }
      }
    }
  }
  if (sx === ex && sz === ez) return null;

  const open = [{ x: sx, z: sz, f: 0 }];
  const came = new Int32Array(N * N).fill(-1);
  const gs = new Float32Array(N * N).fill(Infinity);
  const closed = new Uint8Array(N * N);
  gs[sz * N + sx] = 0;
  const h = (x, z) => Math.hypot(x - ex, z - ez);
  let guard = 0;

  while (open.length && guard++ < 4000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ci = cur.z * N + cur.x;
    if (closed[ci]) continue;
    closed[ci] = 1;
    if (cur.x === ex && cur.z === ez) {
      const pts = [];
      let i = ci;
      while (i !== -1 && !(toCellIdx(i).x === sx && toCellIdx(i).z === sz)) {
        const { x, z } = toCellIdx(i);
        pts.push({ x: toWorld(x), z: toWorld(z) });
        i = came[i];
      }
      pts.reverse();
      if (pts.length) { pts[pts.length - 1] = { x: x1, z: z1 }; }
      return pts;
    }
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cur.x + dx, nz = cur.z + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const ni = nz * N + nx;
      if (g[ni] || closed[ni]) continue;
      if (dx && dz && (g[cur.z * N + nx] || g[nz * N + cur.x])) continue; // no corner cutting
      const cost = gs[ci] + (dx && dz ? 1.4142 : 1) * (1 + slopeGrid()[ni] * 1.5); // climbs cost extra
      if (cost < gs[ni]) {
        gs[ni] = cost; came[ni] = ci;
        open.push({ x: nx, z: nz, f: cost + h(nx, nz) });
      }
    }
  }
  return null; // fall back to direct steering
}
function toCellIdx(i) { return { x: i % N, z: Math.floor(i / N) }; }

export function isBlocked(game, x, z) {
  if (game.gridDirty || !game.grid) rebuildGrid(game);
  return !!game.grid[toCell(z) * N + toCell(x)];
}
