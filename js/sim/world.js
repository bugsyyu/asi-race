// World state and entity helpers. Pure data — no DOM, no three.js.
import { FACTIONS, UNITS, BUILDINGS, MAP, TUNE, DIFFICULTY } from './constants.js';
import { makeRng } from './rng.js';
import { initFog } from './fog.js';

let NEXT_ID = 1;

export function createGame({ playerFaction = 0, seed = 42, difficulty = 'normal', allAI = false } = {}) {
  NEXT_ID = 1;
  const game = {
    time: 0,
    seed,
    rng: makeRng(seed),
    difficulty: DIFFICULTY[difficulty] ? difficulty : 'normal',
    playerFaction: allAI ? -1 : playerFaction,
    ents: new Map(),
    units: [],
    buildings: [],
    nodes: [],
    clusters: [],
    factions: [],
    events: [],
    over: null,          // { winner, aligned, military } | { defeatOnly:true }
    grid: null,          // pathfinding grid, rebuilt when buildings change
    gridDirty: true,
  };

  for (let i = 0; i < 4; i++) {
    const def = FACTIONS[i];
    const f = {
      id: i, def,
      alive: true,
      isAI: allAI || i !== playerFaction,
      compute: 150 + (def.bonus.startCompute || 0),
      data: 0,
      influence: 0,
      talentCap: 0,
      gen: 1,
      trust: TUNE.trustStart + (def.bonus.trust || 0),
      alignment: 5,
      risk: 0,
      buffs: [],               // { stat:'compute'|'prodHalt', mult, until }
      policyCd: {},            // policyId -> time available again
      asi: { state: 'none', remain: 0, paused: false },
      hqDamagedUntil: 0,
      underAttackAlertAt: -99,
      lastIncidentRoll: 0,
      lastDefectRoll: 0,
      defectionsSuffered: 0,
      kills: 0, losses: 0, gensAt: {},
      ai: null,                // filled by ai.js
    };
    game.factions.push(f);
  }

  // Neutral map features -----------------------------------------------------
  for (const n of MAP.nodes) {
    const node = { id: NEXT_ID++, kind: 'node', x: n.x, z: n.z, amount: n.amount, max: n.amount, fp: 2.5 };
    game.nodes.push(node); game.ents.set(node.id, node);
  }
  for (const c of MAP.clusters) {
    const cl = { id: NEXT_ID++, kind: 'cluster', x: c.x, z: c.z, owner: -1, capProgress: 0, capBy: -1, fp: 6 };
    game.clusters.push(cl); game.ents.set(cl.id, cl);
  }
  game.capitol = { id: NEXT_ID++, kind: 'capitol', x: MAP.capitol.x, z: MAP.capitol.z, fp: 8 };
  game.ents.set(game.capitol.id, game.capitol);

  // Starting kit --------------------------------------------------------------
  for (let i = 0; i < 4; i++) {
    const p = MAP.hqPos[i];
    const hq = addBuilding(game, i, 'hq', p.x, p.z, true);
    game.factions[i].hq = hq.id;
    const toC = Math.atan2(-p.z, -p.x);
    for (let k = 0; k < 3; k++) {
      const a = toC + (k - 1) * 0.5;
      addUnit(game, i, 'researcher', p.x + Math.cos(a) * 10, p.z + Math.sin(a) * 10);
    }
  }
  initFog(game);
  return game;
}

export function emit(game, ev) { ev.time = game.time; game.events.push(ev); }

export function addUnit(game, faction, type, x, z) {
  const def = UNITS[type];
  const u = {
    id: NEXT_ID++, kind: 'unit', type, faction,
    x, z, px: x, pz: z, facing: 0,
    hp: def.hp, maxHp: def.hp,
    state: 'idle', order: null, path: null, pathI: 0,
    target: null, tx: x, tz: z, anchorX: x, anchorZ: z,
    carry: 0, gatherNode: null, cd: 0, fleeUntil: 0, repathAt: 0,
    anim: 'idle',
  };
  game.units.push(u); game.ents.set(u.id, u);
  emit(game, { t: 'spawn_unit', id: u.id });
  return u;
}

export function addBuilding(game, faction, type, x, z, complete = false) {
  const def = BUILDINGS[type];
  const b = {
    id: NEXT_ID++, kind: 'building', type, faction,
    x, z, fp: def.fp,
    hp: complete ? def.hp : Math.max(40, def.hp * 0.1), maxHp: def.hp,
    progress: complete ? 1 : 0, done: complete,
    disabledUntil: 0, queue: [], rally: null, cd: 0,
  };
  game.buildings.push(b); game.ents.set(b.id, b);
  if (complete) applyTalentCap(game, b, +1);
  emit(game, { t: 'spawn_building', id: b.id });
  game.gridDirty = true;
  return b;
}

export function applyTalentCap(game, b, sign) {
  const cap = BUILDINGS[b.type].talentCap || 0;
  if (cap) game.factions[b.faction].talentCap += sign * cap;
}

export function removeEnt(game, ent) {
  game.ents.delete(ent.id);
  if (ent.kind === 'unit') {
    const i = game.units.indexOf(ent); if (i >= 0) game.units.splice(i, 1);
  } else if (ent.kind === 'building') {
    const i = game.buildings.indexOf(ent); if (i >= 0) game.buildings.splice(i, 1);
    if (ent.done) applyTalentCap(game, ent, -1);
    game.gridDirty = true;
  } else if (ent.kind === 'node') {
    const i = game.nodes.indexOf(ent); if (i >= 0) game.nodes.splice(i, 1);
  }
}

export const dist2 = (a, b) => { const dx = a.x - b.x, dz = a.z - b.z; return dx * dx + dz * dz; };
export const dist = (a, b) => Math.sqrt(dist2(a, b));

export function talentUsed(game, fid) {
  let n = 0;
  for (const u of game.units) if (u.faction === fid) n += UNITS[u.type].talent;
  for (const b of game.buildings) if (b.faction === fid) {
    for (const q of b.queue) if (q.unit) n += UNITS[q.unit].talent;
  }
  return n;
}

export function nearestWhere(list, x, z, pred, maxD = Infinity) {
  let best = null, bd = maxD * maxD;
  for (const e of list) {
    if (!pred(e)) continue;
    const dx = e.x - x, dz = e.z - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

export function nearestDropoff(game, fid, x, z) {
  return nearestWhere(game.buildings, x, z,
    b => b.faction === fid && b.done && (b.type === 'hq' || b.type === 'lab'));
}

export function unitsNear(game, x, z, r, pred = () => true) {
  const out = [], r2 = r * r;
  for (const u of game.units) {
    const dx = u.x - x, dz = u.z - z;
    if (dx * dx + dz * dz <= r2 && pred(u)) out.push(u);
  }
  return out;
}

export function enemiesNear(game, fid, x, z, r) {
  const out = [], r2 = r * r;
  for (const u of game.units) {
    if (u.faction === fid) continue;
    const dx = u.x - x, dz = u.z - z;
    if (dx * dx + dz * dz <= r2) out.push(u);
  }
  for (const b of game.buildings) {
    if (b.faction === fid) continue;
    const dx = b.x - x, dz = b.z - z, rr = r + b.fp;
    if (dx * dx + dz * dz <= rr * rr) out.push(b);
  }
  return out;
}

export function countBuildings(game, fid, type, doneOnly = true) {
  let n = 0;
  for (const b of game.buildings)
    if (b.faction === fid && b.type === type && (!doneOnly || b.done)) n++;
  return n;
}
export function countUnits(game, fid, type) {
  let n = 0;
  for (const u of game.units) if (u.faction === fid && (!type || u.type === type)) n++;
  return n;
}
