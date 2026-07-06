// ============================================================================
// Industry dynamics — the AI-race meta-economy around the battlefield.
// Stocks & indexes, secondary offerings, cloud compute sell-side, luminary
// researchers who defect / quit / found startups, startup acquisition & IPO,
// and global industry shocks (crypto runs, hardware shortages, open-source
// drops, regulatory storms). Deterministic: game.rng only. Names are parody.
// ============================================================================
import { TUNE, LUMINARIES, STARTUPS, INDUSTRY, INDUSTRY_EVENTS, MAP } from './constants.js';
import { dist, emit, unitsNear, countBuildings } from './world.js';
import { slopeAt } from '../shared/height.js';

let NEXT_SID = 90000; // startup entity ids live in their own range

export function initIndustry(game) {
  NEXT_SID = 90000; // fresh id range per game, so repeat runs in one process match
  const ind = game.industry = {
    prices: [100, 100, 100, 100], prev: [100, 100, 100, 100],
    ai: 100, hw: 100, shocks: [],       // hw shocks: { amt, until }
    startups: [],
    nextTick: 0, nextMove: INDUSTRY.moveEvery, nextEvent: 80,
    clusterBonusUntil: 0,
  };
  for (const f of game.factions) {
    f.roster = []; f.paradigms = [];
    f.cloud = false; f.raiseCd = 0; f.poachCd = 0; f.hwMult = 1;
    f.lum = { research: 1, data: 1, compute: 1, align: 1, speed: 1, dcCost: 1 };
  }
  // deal the luminaries out — two per lab, deterministic per seed
  const keys = Object.keys(LUMINARIES);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(game.rng() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  ind.lums = {};
  keys.forEach((k, i) => {
    const fid = i % 4;
    ind.lums[k] = { emp: fid };
    game.factions[fid].roster.push(k);
  });
  for (const f of game.factions) recomputeLum(game, f);
  return ind;
}

export function recomputeLum(game, f) {
  const m = { research: 1, data: 1, compute: 1, align: 1, speed: 1, dcCost: 1 };
  for (const k of f.roster) {
    const b = LUMINARIES[k].buff;
    if (b.research) m.research *= b.research;
    if (b.data) m.data *= b.data;
    if (b.compute) m.compute *= b.compute;
    if (b.align) m.align *= b.align;
    if (b.speed) m.speed *= b.speed;
  }
  for (const key of f.paradigms) {
    const b = STARTUPS[key].buff;
    if (b.research) m.research *= b.research;
    if (b.data) m.data *= b.data;
    if (b.compute) m.compute *= b.compute;
    if (b.align) m.align *= b.align;
    if (b.speed) m.speed *= b.speed;
    if (b.dcCost) m.dcCost *= b.dcCost;
  }
  f.lum = m;
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------
export function cmdRaise(game, fid) {
  const f = game.factions[fid], ind = game.industry;
  if (!f || !f.alive) return { ok: false };
  if (f.raiseCd > game.time) return { ok: false, msg: `市场消化中（${Math.ceil(f.raiseCd - game.time)}秒）` };
  const amt = Math.round(ind.prices[fid] * INDUSTRY.raiseMult);
  f.compute += amt;
  ind.prices[fid] *= INDUSTRY.raiseDip;
  f.raiseCd = game.time + INDUSTRY.raiseCd;
  emit(game, { t: 'raise', fid, amt });
  return { ok: true, amt };
}

export function cmdCloudMode(game, fid, on) {
  const f = game.factions[fid];
  if (!f || !f.alive || f.cloud === !!on) return { ok: false };
  f.cloud = !!on;
  emit(game, { t: 'cloud', fid, on: f.cloud });
  return { ok: true };
}

export function cmdPoach(game, fid, lumKey) {
  const f = game.factions[fid], ind = game.industry;
  const lum = ind.lums[lumKey];
  if (!f || !lum || typeof lum.emp !== 'number' || lum.emp === fid) return { ok: false, msg: '目标不可挖角' };
  if (f.poachCd > game.time) return { ok: false, msg: `猎头冷却（${Math.ceil(f.poachCd - game.time)}秒）` };
  const c = INDUSTRY.poachCost;
  if (f.compute < c.c || f.influence < c.i) return { ok: false, msg: `需要 ${c.c}⚡ + ${c.i}◇` };
  f.compute -= c.c; f.influence -= c.i;
  f.poachCd = game.time + INDUSTRY.poachCd;
  const victim = game.factions[lum.emp];
  const p = Math.min(0.75, Math.max(0.15, 0.35 + (f.trust - victim.trust) * 0.012));
  if (game.rng() < p) {
    moveLum(game, lumKey, f.id, 'poached');
    ind.prices[victim.id] = Math.max(12, ind.prices[victim.id] - 8);
    return { ok: true };
  }
  emit(game, { t: 'poach_fail', fid, lum: lumKey, victim: victim.id });
  return { ok: true, failed: true };
}

export function cmdAcquire(game, fid, sid) {
  const f = game.factions[fid], ind = game.industry;
  const s = ind.startups.find(x => x.id === sid);
  if (!f || !s || s.state !== 'private') return { ok: false, msg: '已不可收购' };
  // due diligence happens on site: the deal needs one of your people there
  if (!unitsNear(game, s.x, s.z, 14, u => u.faction === fid).length) {
    return { ok: false, msg: '派一个单位到园区完成尽调再签约' };
  }
  const cost = acquireCost(s);
  if (f.compute < cost.c || f.influence < cost.i) return { ok: false, msg: `需要 ${cost.c}⚡ + ${cost.i}◇` };
  f.compute -= cost.c; f.influence -= cost.i;
  s.state = 'acquired'; s.owner = fid;
  f.paradigms.push(s.key);
  const st = STARTUPS[s.key];
  if (st.buff.trust) f.trust = Math.min(100, f.trust + st.buff.trust);
  if (st.buff.riskDrop) f.risk = Math.max(0, f.risk - st.buff.riskDrop);
  const lum = ind.lums[s.lumKey];
  if (lum && lum.emp === 'startup:' + s.key) { lum.emp = fid; f.roster.push(s.lumKey); }
  recomputeLum(game, f);
  game.ents.delete(s.id);
  ind.startups = ind.startups.filter(x => x !== s);
  game.gridDirty = true;
  ind.prices[fid] += 5;
  emit(game, { t: 'acquired', fid, key: s.key, sid: s.id, x: s.x, z: s.z, cost: cost.c });
  return { ok: true };
}

export const acquireCost = (s) => ({
  c: Math.round(s.valuation * INDUSTRY.acquireC),
  i: Math.round(s.valuation * INDUSTRY.acquireI),
});

// ---------------------------------------------------------------------------
// luminary movement
// ---------------------------------------------------------------------------
function moveLum(game, key, dest, why) {
  const ind = game.industry;
  const lum = ind.lums[key];
  const fromFid = typeof lum.emp === 'number' ? lum.emp : -1;
  if (fromFid >= 0) {
    const from = game.factions[fromFid];
    from.roster = from.roster.filter(k => k !== key);
    recomputeLum(game, from);
  }
  lum.emp = dest;
  if (typeof dest === 'number') {
    const to = game.factions[dest];
    to.roster.push(key);
    recomputeLum(game, to);
    emit(game, { t: 'lum_jump', key, from: fromFid, to: dest, why });
  }
}

function departLum(game, key) {
  const ind = game.industry;
  const lum = ind.lums[key];
  const def = LUMINARIES[key];
  const fromFid = lum.emp;
  const from = game.factions[fromFid];
  // 1) the elder-statesman exit: quit the industry and warn the world
  if (game.rng() < def.quitBias) {
    from.roster = from.roster.filter(k => k !== key);
    recomputeLum(game, from);
    lum.emp = 'gone';
    from.trust = Math.max(0, from.trust - 6);
    ind.prices[fromFid] = Math.max(12, ind.prices[fromFid] - 6);
    emit(game, { t: 'lum_quit', key, from: fromFid });
    return;
  }
  // 2) found a startup in their paradigm, if that lane is still open
  const para = def.para;
  if (para && !ind.startups.some(s => s.key === para) &&
      !game.factions.some(r => r.paradigms.includes(para)) && game.rng() < 0.6) {
    const spot = findStartupSpot(game);
    if (spot) {
      from.roster = from.roster.filter(k => k !== key);
      recomputeLum(game, from);
      lum.emp = 'startup:' + para;
      const s = {
        id: NEXT_SID++, kind: 'startup', key: para, lumKey: key,
        name: STARTUPS[para].name, x: spot.x, z: spot.z, fp: 3,
        valuation: INDUSTRY.startupValuation0, foundedAt: game.time,
        state: 'private', owner: -1,
      };
      ind.startups.push(s);
      game.ents.set(s.id, s);
      game.gridDirty = true;
      from.trust = Math.max(0, from.trust - 4);
      ind.prices[fromFid] = Math.max(12, ind.prices[fromFid] - 7);
      emit(game, { t: 'lum_found', key, from: fromFid, sid: s.id, para, x: s.x, z: s.z });
      return;
    }
  }
  // 3) defect — normally to the most trusted rival; but a stage-4 emergence
  // outshines every recruiter (the calling)
  let best = null;
  for (const r of game.factions) {
    if (!r.alive || r.id === fromFid) continue;
    if (!best || r.trust > best.trust) best = r;
  }
  const grav = game.factions.find(r => r.alive && r.id !== fromFid &&
    r.asi.state === 'running' && (r.asi.stage || 0) >= 4);
  if (grav) best = grav;
  if (best) {
    from.trust = Math.max(0, from.trust - 4);
    ind.prices[fromFid] = Math.max(12, ind.prices[fromFid] - 5);
    moveLum(game, key, best.id, 'exodus');
  }
}

function findStartupSpot(game) {
  // ring of candidate campuses between the mid clusters and the capitol
  const base = game.rng() * Math.PI * 2;
  for (let k = 0; k < 12; k++) {
    const a = base + k * (Math.PI / 6);
    const r = 34 + (k % 3) * 6;
    const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
    if (slopeAt(x, z) > TUNE.buildMaxSlope) continue;
    let clear = dist({ x, z }, game.capitol) > 22;
    if (clear) for (const b of game.buildings) if (dist({ x, z }, b) < b.fp + 9) { clear = false; break; }
    if (clear) for (const n of game.nodes) if (dist({ x, z }, n) < 8) { clear = false; break; }
    if (clear) for (const c of game.clusters) if (dist({ x, z }, c) < 14) { clear = false; break; }
    if (clear) for (const s of game.industry.startups) if (dist({ x, z }, s) < 12) { clear = false; break; }
    if (clear) return { x, z };
  }
  return null;
}

export const _forceDepart = departLum; // test hook

// ---------------------------------------------------------------------------
// per-tick step
// ---------------------------------------------------------------------------
export function stepIndustry(game, dt) {
  const ind = game.industry;
  if (!ind || game.over) return;

  if (game.time >= ind.nextTick) {
    ind.nextTick = game.time + INDUSTRY.tickEvery;

    // hardware index: shocks decay away; cloud sell-side keeps supply cheap
    ind.shocks = ind.shocks.filter(s => s.until > game.time);
    let hwT = 100;
    for (const s of ind.shocks) hwT += s.amt;
    for (const f of game.factions) if (f.alive && f.cloud) hwT += INDUSTRY.cloudHw;
    ind.hw += (hwT - ind.hw) * 0.06;

    // faction stocks track fundamentals plus a seeded flutter
    let sum = 0;
    for (const f of game.factions) {
      const i = f.id;
      ind.prev[i] = ind.prices[i];
      if (!f.alive) { ind.prices[i] = Math.max(4, ind.prices[i] * 0.97); sum += ind.prices[i]; continue; }
      const fund = 58
        + Math.log(1 + Math.max(0, f.computeRate)) * 14
        + (f.gen - 1) * 22
        + (f.asi.state === 'running' ? 30 : 0)
        + f.trust * 0.35 - f.risk * 0.3
        + f.roster.length * 5 + f.paradigms.length * 6
        + (f.cloud ? 8 : 0);
      ind.prices[i] += (fund - ind.prices[i]) * 0.02 + (game.rng() - 0.5) * 1.6;
      ind.prices[i] = Math.min(420, Math.max(12, ind.prices[i]));
      sum += ind.prices[i];
      f.hwMult = Math.min(1.4, Math.max(0.7, ind.hw / 100)) * f.lum.dcCost;
      // cloud sell-side revenue scales with the halls you actually hold on
      // the map (HQ counts as one) — burn a rival's datacenters and you burn
      // their cloud business too
      if (f.cloud) {
        const halls = Math.min(5, 1 + countBuildings(game, f.id, 'datacenter'));
        f.data += INDUSTRY.cloudData * halls * INDUSTRY.tickEvery;
        f.influence += INDUSTRY.cloudInfluence * halls * INDUSTRY.tickEvery;
      }
    }
    ind.ai = sum / 4;

    // startups appreciate; unacquired ones eventually IPO
    for (const s of [...ind.startups]) {
      if (s.state !== 'private') continue;
      s.valuation += INDUSTRY.startupValuationRate;
      if (game.time - s.foundedAt >= INDUSTRY.ipoAfter) {
        s.state = 'ipo';
        const st = STARTUPS[s.key];
        if (st.ipo.align) for (const f of game.factions) if (f.alive) f.alignment = Math.min(100, f.alignment + st.ipo.align);
        if (st.ipo.data) for (const f of game.factions) if (f.alive) f.data += st.ipo.data;
        if (st.ipo.trust) for (const f of game.factions) if (f.alive) f.trust = Math.min(100, f.trust + st.ipo.trust);
        if (st.ipo.hw) ind.shocks.push({ amt: st.ipo.hw, until: game.time + 120 });
        if (st.ipo.aiIndex) for (let i = 0; i < 4; i++) ind.prices[i] += st.ipo.aiIndex * 0.5;
        emit(game, { t: 'ipo', sid: s.id, key: s.key, x: s.x, z: s.z });
      }
    }
  }

  // luminary departures — pressure builds with risk, incidents and low trust
  if (game.time >= ind.nextMove) {
    ind.nextMove = game.time + INDUSTRY.moveEvery;
    for (const key in ind.lums) {
      const lum = ind.lums[key];
      if (typeof lum.emp !== 'number') continue;
      const emp = game.factions[lum.emp];
      if (!emp.alive) { departLum(game, key); continue; }  // lab fell — everyone scatters
      const p = Math.min(0.16, Math.max(0.012,
        0.02 + (emp.risk - 42) * 0.0012 + (46 - emp.trust) * 0.0016));
      if (game.rng() < p) departLum(game, key);
    }
  }

  // global industry shocks
  if (game.time >= ind.nextEvent) {
    const [lo, hi] = INDUSTRY.eventEvery;
    ind.nextEvent = game.time + lo + game.rng() * (hi - lo);
    const keys = Object.keys(INDUSTRY_EVENTS);
    let total = 0;
    for (const k of keys) total += INDUSTRY_EVENTS[k].w;
    let roll = game.rng() * total, pick = keys[0];
    for (const k of keys) { roll -= INDUSTRY_EVENTS[k].w; if (roll <= 0) { pick = k; break; } }
    const ev = INDUSTRY_EVENTS[pick];
    if (ev.hw) ind.shocks.push({ amt: ev.hw, until: game.time + ev.dur });
    for (const f of game.factions) {
      if (!f.alive) continue;
      if (ev.data) f.data += ev.data;
      if (ev.risk) f.risk = Math.min(100, f.risk + ev.risk);
      if (ev.influence) f.influence += ev.influence;
    }
    emit(game, { t: 'industry', key: pick, msg: ev.msg });
  }
}
