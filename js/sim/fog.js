// ============================================================================
// Fog of war. A visibility + explored grid for the player's faction, plus a
// "last seen" memory of static entities (rival buildings, data nodes, GPU
// clusters). Pure data, deterministic, no DOM/three.
//
// Only the perspective faction (game.playerFaction) is tracked: the fog is an
// information layer for the human — the sim itself stays omniscient and the
// AI keeps full knowledge (the classic RTS concession). With no perspective
// (all-AI/headless games) every query answers "visible".
// ============================================================================
import { TUNE, UNITS, BUILDINGS } from './constants.js';
import { groundHeight } from '../shared/height.js';

export function initFog(game) {
  const res = TUNE.fogRes;
  const n = Math.max(1, Math.round(TUNE.mapSize / res));
  game.fog = {
    fid: game.playerFaction,       // tracked perspective (-1 = none)
    res, n,
    half: TUNE.mapSize / 2,
    visible: new Uint8Array(n * n),   // recomputed every tick
    explored: new Uint8Array(n * n),  // sticks forever
    memory: new Map(),                // ent id -> last-seen snapshot
    stamp: 0,                         // bumped on every recompute
  };
  updateFog(game);
}

const cellOf = (fog, w) => Math.max(0, Math.min(fog.n - 1, Math.floor((w + fog.half) / fog.res)));
const cellVis = (fog, x, z) => fog.visible[cellOf(fog, z) * fog.n + cellOf(fog, x)] === 1;

function stampSight(fog, x, z, r) {
  const { res, n, half, visible } = fog;
  const ci = cellOf(fog, x), cj = cellOf(fog, z);
  const cr = Math.ceil(r / res), r2 = r * r;
  const i0 = Math.max(0, ci - cr), i1 = Math.min(n - 1, ci + cr);
  const j0 = Math.max(0, cj - cr), j1 = Math.min(n - 1, cj + cr);
  for (let j = j0; j <= j1; j++) {
    const dz = (j + 0.5) * res - half - z;
    for (let i = i0; i <= i1; i++) {
      const dx = (i + 0.5) * res - half - x;
      if (dx * dx + dz * dz <= r2) visible[j * n + i] = 1;
    }
  }
}

export function updateFog(game) {
  const fog = game.fog;
  if (!fog || fog.fid < 0) return;
  const fid = fog.fid;
  fog.stamp++;
  fog.visible.fill(0);

  for (const u of game.units) {
    if (u.faction !== fid) continue;
    // uplands are watchtowers: standing high extends a unit's sight
    const lift = groundHeight(u.x, u.z) >= TUNE.uplandHeight ? TUNE.highSightBonus : 0;
    stampSight(fog, u.x, u.z, (UNITS[u.type].sight || TUNE.sightUnit) + lift);
  }
  for (const b of game.buildings) {
    if (b.faction === fid) stampSight(fog, b.x, b.z, BUILDINGS[b.type].sight || TUNE.sightBuilding);
  }
  for (const c of game.clusters) {
    if (c.owner === fid) stampSight(fog, c.x, c.z, TUNE.sightCluster);
  }

  const { visible, explored } = fog;
  for (let k = 0; k < visible.length; k++) if (visible[k]) explored[k] = 1;

  // Last-seen snapshots of statics. While something sits in view its snapshot
  // refreshes every tick; once it slips into fog the snapshot freezes, and
  // seeing the (now empty) ground again deletes it.
  const mem = fog.memory;
  for (const b of game.buildings) {
    if (b.faction !== fid && cellVis(fog, b.x, b.z)) {
      mem.set(b.id, { kind: 'building', type: b.type, faction: b.faction, x: b.x, z: b.z, done: b.done });
    }
  }
  for (const nd of game.nodes) {
    if (cellVis(fog, nd.x, nd.z)) mem.set(nd.id, { kind: 'node', x: nd.x, z: nd.z, amount: nd.amount });
  }
  for (const c of game.clusters) {
    if (cellVis(fog, c.x, c.z)) mem.set(c.id, { kind: 'cluster', x: c.x, z: c.z, owner: c.owner });
  }
  for (const [id, m] of mem) {
    if (!game.ents.has(id) && cellVis(fog, m.x, m.z)) mem.delete(id);
  }
}

// Queries answer for the tracked perspective only; any other faction id (or a
// game without fog) is treated as all-seeing.
export function isVisible(game, fid, x, z) {
  const fog = game.fog;
  if (!fog || fid < 0 || fid !== fog.fid) return true;
  return cellVis(fog, x, z);
}

export function isExplored(game, fid, x, z) {
  const fog = game.fog;
  if (!fog || fid < 0 || fid !== fog.fid) return true;
  return fog.explored[cellOf(fog, z) * fog.n + cellOf(fog, x)] === 1;
}
