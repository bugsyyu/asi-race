// ============================================================================
// Bridge protocol — the single command/observation surface exposed to external
// controllers (the Python SDK in python/asirace). Pure ES module: imports only
// the sim layer, no DOM, no three.js, so it runs identically inside
// bridge/server.mjs (headless Node) and js/bridge/live.js (browser).
//
// Message model (JSON objects):
//   request  { id?, op, ...params }
//   response { id?, ok:true, ...payload }            — op executed
//            { id?, ok:false, msg }                  — game rule said no
//            { id?, ok:false, error }                — protocol misuse / bad args
// The msg/error split is deliberate: bots retry or route around `msg`
// (insufficient resources, cooldowns); `error` means the caller has a bug.
//
// Every mutating op carries the acting faction `fid` and is validated against
// it — the sim's cmd* functions themselves are omnipotent (the built-in AI
// uses them with full trust), so ownership checks live here at the boundary.
// ============================================================================
import {
  TUNE, DIFFICULTY, FACTIONS, UNITS, BUILDINGS, GENS, MAX_GEN, ASI, TECHS,
  POLICIES, LUMINARIES, STARTUPS, INDUSTRY, INDUSTRY_EVENTS, EMERGENCE, MAP,
} from '../sim/constants.js';
import { talentUsed } from '../sim/world.js';
import {
  cmdMove, cmdStop, cmdAttack, cmdAttackMove, cmdGather, cmdBuild, cmdChannel,
  cmdBuildStart, cmdTrainUnit, cmdResearchGen, cmdResearchTech, cmdTrade,
  cmdPolicy, cmdStartASI, cmdSetRally,
  canPlace, canAfford, needsMet, buildingCost, unitCost,
} from '../sim/sim.js';
import { cmdRaise, cmdCloudMode, cmdAcquire, cmdPoach, acquireCost } from '../sim/industry.js';
import { isVisible } from '../sim/fog.js';

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const R1 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : v);
const R2 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : v);
const R3 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v);

const err = (error) => ({ ok: false, error });
const HALF = TUNE.mapSize / 2 - 1;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const coord = (v) => { const n = num(v); return n === null ? null : Math.max(-HALF, Math.min(HALF, n)); };

function factionOf(game, fid) {
  return Number.isInteger(fid) && fid >= 0 && fid < game.factions.length ? game.factions[fid] : null;
}

// Requested ids → live units owned by fid (silently drops the rest: dead ids
// are routine in a bot loop, and half-valid selections should still act).
function ownUnits(game, fid, ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  for (const raw of ids) {
    const u = game.ents.get(Number(raw));
    if (u && u.kind === 'unit' && u.faction === fid) out.push(u.id);
  }
  return out;
}

function ownBuilding(game, fid, bid) {
  const b = game.ents.get(Number(bid));
  return b && b.kind === 'building' && b.faction === fid ? b : null;
}

// Uint8Array → base64 without Buffer/btoa so it works in Node and browsers.
const B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64C[a >> 2] + B64C[((a & 3) << 4) | (b >> 4)]
      + (i + 1 < bytes.length ? B64C[((b & 15) << 2) | (c >> 6)] : '=')
      + (i + 2 < bytes.length ? B64C[c & 63] : '=');
  }
  return out;
}

// ---------------------------------------------------------------------------
// meta — static game data, sent once so clients never hardcode constants
// ---------------------------------------------------------------------------
export function metaInfo() {
  return {
    protocol: PROTOCOL_VERSION,
    tick: TUNE.tick,
    tune: TUNE,
    difficulty: Object.fromEntries(Object.entries(DIFFICULTY).map(([k, d]) => [k, d.label])),
    factions: FACTIONS.map((f, i) => ({
      id: i, key: f.key, name: f.name, tag: f.tag, css: f.css,
      bonusName: f.bonusName, bonusDesc: f.bonusDesc, bonus: f.bonus,
    })),
    units: UNITS,
    buildings: BUILDINGS,
    gens: GENS.map((g) => (g ? { name: g.name, cost: g.cost || null, time: g.time || null, risk: g.risk || null } : null)),
    maxGen: MAX_GEN,
    asi: ASI,
    techs: TECHS,
    policies: POLICIES,
    luminaries: LUMINARIES,
    startups: STARTUPS,
    industry: INDUSTRY,
    industryEvents: INDUSTRY_EVENTS,
    emergence: EMERGENCE,
    map: MAP,
    fog: { res: TUNE.fogRes, n: Math.max(1, Math.round(TUNE.mapSize / TUNE.fogRes)), half: TUNE.mapSize / 2 },
  };
}

// ---------------------------------------------------------------------------
// snapshots
// ---------------------------------------------------------------------------
function serUnit(u) {
  return {
    id: u.id, fid: u.faction, type: u.type,
    x: R2(u.x), z: R2(u.z),
    hp: R1(u.hp), maxHp: u.maxHp,
    state: u.state, order: u.order ? u.order.kind : null,
    target: u.target ?? null, node: u.gatherNode ?? null, carry: R1(u.carry),
  };
}

function serBuilding(b) {
  return {
    id: b.id, fid: b.faction, type: b.type,
    x: R2(b.x), z: R2(b.z), fp: b.fp,
    hp: R1(b.hp), maxHp: b.maxHp,
    done: b.done, progress: R3(b.progress),
    disabledUntil: R1(b.disabledUntil),
    rally: b.rally ? { x: R2(b.rally.x), z: R2(b.rally.z), target: b.rally.targetId ?? null } : null,
    tech: b.tech ? { key: b.tech.key, remain: R1(b.tech.remain), total: b.tech.total } : null,
    queue: b.queue.map((q) => ({
      unit: q.unit ?? null, gen: q.gen ?? null, asi: !!q.asi,
      remain: R1(q.remain), total: R1(q.total),
    })),
  };
}

function serFactionFull(game, f) {
  const ind = game.industry;
  return {
    id: f.id, key: f.def.key, name: f.def.name, alive: f.alive, isAI: f.isAI, hq: f.hq ?? null,
    compute: R1(f.compute), data: R1(f.data), influence: R1(f.influence),
    computeRate: R2(f.computeRate || 0), influenceRate: R2(f.influenceRate || 0),
    talentCap: f.talentCap, talentUsed: talentUsed(game, f.id),
    gen: f.gen, trust: R1(f.trust), alignment: R1(f.alignment), risk: R1(f.risk),
    asi: { state: f.asi.state, remain: R1(f.asi.remain), total: f.asi.total ?? null, stage: f.asi.stage || 0, paused: !!f.asi.paused },
    techs: Object.keys(f.techs).filter((k) => f.techs[k]),
    buffs: f.buffs.filter((b) => b.until > game.time).map((b) => ({ stat: b.stat, mult: b.mult, until: R1(b.until) })),
    policyCd: Object.fromEntries(Object.entries(f.policyCd).filter(([, t]) => t > game.time).map(([k, t]) => [k, R1(t)])),
    mktPressure: R3(f.mktPressure), cloud: !!f.cloud, hwMult: R3(f.hwMult || 1),
    raiseCd: R1(f.raiseCd || 0), poachCd: R1(f.poachCd || 0),
    roster: f.roster ? [...f.roster] : [], paradigms: f.paradigms ? [...f.paradigms] : [],
    stock: ind ? R1(ind.prices[f.id]) : null,
    kills: f.kills, losses: f.losses,
  };
}

// What a rival lab can read from the outside: demo days, the press, the
// markets. Internal ledgers (resources, risk, alignment, techs) stay hidden.
function serFactionPublic(game, f) {
  const ind = game.industry;
  return {
    id: f.id, key: f.def.key, name: f.def.name, alive: f.alive, isAI: f.isAI, hq: null,
    gen: f.gen, trust: R1(f.trust),
    asi: { state: f.asi.state, stage: f.asi.stage || 0 },
    cloud: !!f.cloud,
    roster: f.roster ? [...f.roster] : [], paradigms: f.paradigms ? [...f.paradigms] : [],
    stock: ind ? R1(ind.prices[f.id]) : null,
  };
}

function serStartup(s) {
  return {
    id: s.id, key: s.key, name: s.name, lum: s.lumKey,
    x: R2(s.x), z: R2(s.z), fp: s.fp,
    valuation: R1(s.valuation), state: s.state, owner: s.owner,
    cost: acquireCost(s),
  };
}

function serIndustry(game) {
  const ind = game.industry;
  if (!ind) return null;
  return {
    prices: ind.prices.map(R1), prev: ind.prev.map(R1),
    ai: R1(ind.ai), hw: R1(ind.hw),
    lums: Object.fromEntries(Object.entries(ind.lums).map(([k, l]) => [k, l.emp])),
  };
}

// Full, omniscient snapshot — research/tooling view of everything.
export function snapshot(game) {
  return {
    time: R2(game.time), tick: TUNE.tick, seed: game.seed,
    difficulty: game.difficulty, playerFaction: game.playerFaction,
    fogFaction: game.fog ? game.fog.fid : -1,
    over: game.over ? { ...game.over } : null,
    factions: game.factions.map((f) => serFactionFull(game, f)),
    units: game.units.map(serUnit),
    buildings: game.buildings.map(serBuilding),
    nodes: game.nodes.map((n) => ({ id: n.id, x: R2(n.x), z: R2(n.z), amount: R1(n.amount), max: n.max })),
    clusters: game.clusters.map((c) => ({ id: c.id, x: R2(c.x), z: R2(c.z), owner: c.owner, capBy: c.capBy, capProgress: R2(c.capProgress) })),
    capitol: { id: game.capitol.id, x: game.capitol.x, z: game.capitol.z },
    startups: (game.industry?.startups || []).map(serStartup),
    industry: serIndustry(game),
  };
}

// Fog-honest observation from faction `fid`'s chair. Only the perspective the
// sim tracks (game.fog.fid, i.e. the game's playerFaction) has real fog data;
// any other fid falls back to the omniscient snapshot with a warning flag, so
// agents can't silently believe they trained under fog when they didn't.
export function observe(game, fid, opts = {}) {
  const f = factionOf(game, fid);
  if (!f) return null;
  const tracked = !!game.fog && game.fog.fid === fid;
  if (!tracked) return { ...snapshot(game), perspective: fid, omniscient: true };

  const vis = (x, z) => isVisible(game, fid, x, z);
  const mem = game.fog.memory;

  const units = [];
  for (const u of game.units) {
    if (u.faction === fid || vis(u.x, u.z)) units.push(serUnit(u));
  }

  const buildings = [];
  const liveSeen = new Set();
  for (const b of game.buildings) {
    if (b.faction === fid || vis(b.x, b.z)) { buildings.push(serBuilding(b)); liveSeen.add(b.id); }
  }
  // last-seen ghosts: rival buildings remembered where the fog closed back in
  for (const [id, m] of mem) {
    if (m.kind !== 'building' || liveSeen.has(id) || vis(m.x, m.z)) continue;
    buildings.push({ id, fid: m.faction, type: m.type, x: R2(m.x), z: R2(m.z), done: m.done, ghost: true });
  }

  const nodes = [];
  for (const n of game.nodes) {
    if (vis(n.x, n.z)) nodes.push({ id: n.id, x: R2(n.x), z: R2(n.z), amount: R1(n.amount), max: n.max });
  }
  for (const [id, m] of mem) {
    if (m.kind !== 'node' || vis(m.x, m.z)) continue;
    nodes.push({ id, x: R2(m.x), z: R2(m.z), amount: R1(m.amount), ghost: true });
  }

  const clusters = [];
  for (const c of game.clusters) {
    if (vis(c.x, c.z)) clusters.push({ id: c.id, x: R2(c.x), z: R2(c.z), owner: c.owner, capBy: c.capBy, capProgress: R2(c.capProgress) });
    else {
      const m = mem.get(c.id);
      if (m) clusters.push({ id: c.id, x: R2(m.x), z: R2(m.z), owner: m.owner, ghost: true });
    }
  }

  const startups = (game.industry?.startups || []).filter((s) => vis(s.x, s.z)).map(serStartup);

  let explored = 0;
  const eg = game.fog.explored;
  for (let i = 0; i < eg.length; i++) explored += eg[i];

  const out = {
    time: R2(game.time), tick: TUNE.tick, seed: game.seed,
    difficulty: game.difficulty, playerFaction: game.playerFaction,
    perspective: fid, omniscient: false,
    over: game.over ? { ...game.over } : null,
    factions: game.factions.map((x) => (x.id === fid ? serFactionFull(game, x) : serFactionPublic(game, x))),
    units, buildings, nodes, clusters, startups,
    capitol: { id: game.capitol.id, x: game.capitol.x, z: game.capitol.z },
    industry: serIndustry(game),
    exploredFrac: R3(explored / eg.length),
  };
  if (opts.grids) {
    out.grids = { n: game.fog.n, res: game.fog.res, half: game.fog.half, visible: b64(game.fog.visible), explored: b64(game.fog.explored) };
  }
  return out;
}

// ---------------------------------------------------------------------------
// faction-aware smart command (sim's cmdSmart hardwires game.playerFaction
// for its hostility test, so the bridge re-derives intent per acting faction)
// ---------------------------------------------------------------------------
function smartFor(game, fid, ids, target, x, z) {
  const isType = (id, t) => game.ents.get(id)?.type === t;
  if (target) {
    if (target.kind === 'node') {
      const res = ids.filter((id) => isType(id, 'researcher'));
      if (res.length) cmdGather(game, res, target.id);
      const rest = ids.filter((id) => !res.includes(id));
      if (rest.length) cmdMove(game, rest, target.x, target.z);
      return { ok: true };
    }
    if (target.kind === 'capitol') {
      const lob = ids.filter((id) => isType(id, 'lobbyist'));
      if (lob.length) cmdChannel(game, lob);
      const rest = ids.filter((id) => !lob.includes(id));
      if (rest.length) cmdMove(game, rest, target.x + 10, target.z + 10);
      return { ok: true };
    }
    if (target.kind === 'building' && !target.done && target.faction === fid) {
      const res = ids.filter((id) => isType(id, 'researcher'));
      if (res.length) {
        cmdBuild(game, res, target.id);
        const rest = ids.filter((id) => !res.includes(id));
        if (rest.length) cmdMove(game, rest, x ?? target.x, z ?? target.z);
        return { ok: true };
      }
    }
    if ((target.kind === 'unit' || target.kind === 'building') && target.faction !== undefined && target.faction !== fid) {
      const mil = ids.filter((id) => UNITS[game.ents.get(id)?.type]?.dmg);
      if (mil.length) cmdAttack(game, mil, target.id);
      const rest = ids.filter((id) => !mil.includes(id));
      if (rest.length) cmdMove(game, rest, x ?? target.x, z ?? target.z);
      return { ok: true };
    }
  }
  if (x === null || z === null) return err('smart needs a target id or x/z');
  cmdMove(game, ids, x, z);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// command dispatch
// ---------------------------------------------------------------------------
export function applyCommand(game, msg) {
  if (!msg || typeof msg.op !== 'string') return err('missing op');
  const op = msg.op;

  // ---- queries --------------------------------------------------------------
  if (op === 'ping') return { ok: true, pong: true, time: R2(game.time) };
  if (op === 'meta') return { ok: true, meta: metaInfo() };
  if (op === 'state') return { ok: true, state: snapshot(game) };
  if (op === 'observe') {
    const st = observe(game, msg.fid ?? game.playerFaction, { grids: !!msg.grids });
    return st ? { ok: true, state: st } : err('bad fid');
  }

  const f = factionOf(game, msg.fid);
  if (!f) return err(`op '${op}' needs a valid fid (0-3)`);
  const fid = f.id;

  switch (op) {
    // ---- unit orders --------------------------------------------------------
    case 'move': case 'attack_move': case 'stop': case 'channel': {
      const ids = ownUnits(game, fid, msg.ids);
      if (!ids.length) return { ok: false, msg: '没有可指挥的己方单位' };
      if (op === 'stop') { cmdStop(game, ids); return { ok: true, n: ids.length }; }
      if (op === 'channel') {
        const r = cmdChannel(game, ids);
        return r.ok ? { ok: true } : { ok: false, msg: '选中的单位里没有说客' };
      }
      const x = coord(msg.x), z = coord(msg.z);
      if (x === null || z === null) return err(`${op} needs numeric x/z`);
      if (op === 'move') { cmdMove(game, ids, x, z); return { ok: true, n: ids.length }; }
      const r = cmdAttackMove(game, ids, x, z);
      return { ok: true, n: ids.length, military: !!r.ok };
    }

    case 'attack': {
      const ids = ownUnits(game, fid, msg.ids);
      if (!ids.length) return { ok: false, msg: '没有可指挥的己方单位' };
      const tgt = game.ents.get(Number(msg.target));
      if (!tgt || (tgt.kind !== 'unit' && tgt.kind !== 'building')) return { ok: false, msg: '目标已不存在或不可攻击' };
      if (tgt.faction === fid) return { ok: false, msg: '不能攻击己方目标' };
      const r = cmdAttack(game, ids, tgt.id);
      return r.ok ? { ok: true } : { ok: false, msg: '选中的单位里没有作战单位' };
    }

    case 'gather': {
      const ids = ownUnits(game, fid, msg.ids);
      if (!ids.length) return { ok: false, msg: '没有可指挥的己方单位' };
      const r = cmdGather(game, ids, Number(msg.node));
      return r.ok ? { ok: true } : { ok: false, msg: '目标不是数据节点，或选中的不是研究员' };
    }

    case 'build_join': {
      const ids = ownUnits(game, fid, msg.ids);
      if (!ids.length) return { ok: false, msg: '没有可指挥的己方单位' };
      const r = cmdBuild(game, ids, Number(msg.bid));
      return r.ok ? { ok: true } : { ok: false, msg: '目标不是己方未完工建筑，或选中的不是研究员' };
    }

    case 'smart': {
      const ids = ownUnits(game, fid, msg.ids);
      if (!ids.length) return { ok: false, msg: '没有可指挥的己方单位' };
      const target = msg.target != null ? game.ents.get(Number(msg.target)) : null;
      if (msg.target != null && !target) return { ok: false, msg: '目标已不存在' };
      return smartFor(game, fid, ids, target, coord(msg.x), coord(msg.z));
    }

    // ---- production & construction -----------------------------------------
    case 'build': {
      if (!BUILDINGS[msg.btype]) return err(`unknown building type '${msg.btype}'`);
      const x = coord(msg.x), z = coord(msg.z);
      if (x === null || z === null) return err('build needs numeric x/z');
      const builders = ownUnits(game, fid, msg.builders || []);
      const r = cmdBuildStart(game, fid, msg.btype, x, z, builders);
      // the new site id travels as `bid` — a bare `id` would collide with the
      // request-id key of the response envelope
      return r.ok ? { ok: true, bid: r.id } : r;
    }

    case 'train': {
      const b = ownBuilding(game, fid, msg.bid);
      if (!b) return { ok: false, msg: '不是己方建筑或已被摧毁' };
      if (!UNITS[msg.utype]) return err(`unknown unit type '${msg.utype}'`);
      return cmdTrainUnit(game, b.id, msg.utype);
    }

    case 'rally': {
      const b = ownBuilding(game, fid, msg.bid);
      if (!b) return { ok: false, msg: '不是己方建筑或已被摧毁' };
      const x = coord(msg.x), z = coord(msg.z);
      if (x === null || z === null) return err('rally needs numeric x/z');
      cmdSetRally(game, b.id, x, z, msg.target != null ? Number(msg.target) : null);
      return { ok: true };
    }

    case 'research_gen': return cmdResearchGen(game, fid);

    case 'research_tech': {
      const b = ownBuilding(game, fid, msg.bid);
      if (!b) return { ok: false, msg: '不是己方建筑或已被摧毁' };
      if (!TECHS[msg.key]) return err(`unknown tech '${msg.key}'`);
      return cmdResearchTech(game, b.id, msg.key);
    }

    case 'start_asi': return cmdStartASI(game, fid);

    // ---- markets, politics, industry ----------------------------------------
    case 'trade': {
      if (msg.dir !== 'c2d' && msg.dir !== 'd2c') return err("trade dir must be 'c2d' or 'd2c'");
      return cmdTrade(game, fid, msg.dir);
    }

    case 'policy': {
      if (!POLICIES[msg.pid]) return err(`unknown policy '${msg.pid}'`);
      return cmdPolicy(game, fid, msg.pid, msg.target != null ? Number(msg.target) : undefined);
    }

    case 'raise': return cmdRaise(game, fid);
    case 'cloud': return cmdCloudMode(game, fid, !!msg.on);
    case 'acquire': return cmdAcquire(game, fid, Number(msg.sid));
    case 'poach': {
      if (!LUMINARIES[msg.key]) return err(`unknown luminary '${msg.key}'`);
      return cmdPoach(game, fid, msg.key);
    }

    // ---- control-plane -------------------------------------------------------
    case 'set_ai': {
      f.isAI = !!msg.ai;
      if (!f.isAI) f.ai = null; // re-enabling later re-seats a fresh brain
      return { ok: true, fid, isAI: f.isAI };
    }

    case 'can_place': {
      if (!BUILDINGS[msg.btype]) return err(`unknown building type '${msg.btype}'`);
      const x = coord(msg.x), z = coord(msg.z);
      if (x === null || z === null) return err('can_place needs numeric x/z');
      const place = canPlace(game, fid, msg.btype, x, z);
      const cost = buildingCost(f, msg.btype);
      return {
        ok: true, place: place.ok, msg: place.msg || null,
        afford: canAfford(f, cost), needs: needsMet(game, f, BUILDINGS[msg.btype].needs || {}), cost,
      };
    }

    case 'costs': {
      const units = {}, buildings = {};
      for (const t in UNITS) units[t] = unitCost(f, t);
      for (const t in BUILDINGS) buildings[t] = buildingCost(f, t);
      return {
        ok: true, units, buildings,
        gen: f.gen < MAX_GEN ? GENS[f.gen + 1].cost : null,
        asi: ASI.cost,
        poach: INDUSTRY.poachCost,
        acquire: Object.fromEntries((game.industry?.startups || []).filter((s) => s.state === 'private').map((s) => [s.id, acquireCost(s)])),
      };
    }

    default:
      return err(`unknown op '${op}'`);
  }
}
