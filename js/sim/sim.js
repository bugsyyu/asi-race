// ============================================================================
// Simulation core. Fixed-timestep, deterministic (seeded rng), zero DOM/three.
// The view layer consumes `game.events` and reads entity state; it never writes.
// ============================================================================
import { TUNE, UNITS, BUILDINGS, GENS, MAX_GEN, ASI, POLICIES, DIFFICULTY } from './constants.js';
import {
  emit, addUnit, addBuilding, removeEnt, applyTalentCap, dist, dist2,
  nearestWhere, nearestDropoff, enemiesNear, talentUsed, countBuildings,
} from './world.js';
import { findPath, isBlocked } from './pathfind.js';
import { stepAI } from './ai.js';
import { updateFog } from './fog.js';

// ---------------------------------------------------------------------------
// Affordability & payment
// ---------------------------------------------------------------------------
export function hireMult(f) { return Math.max(0.7, 1.25 - TUNE.hireCostSlope * f.trust); }

export function unitCost(f, type) {
  const c = UNITS[type].cost;
  return { c: Math.round((c.c || 0) * hireMult(f)), d: c.d || 0, i: c.i || 0 };
}
export function buildingCost(f, type) {
  const c = BUILDINGS[type].cost;
  let cc = c.c || 0;
  if (type === 'datacenter' && f.def.bonus.dcCost) cc = Math.round(cc * f.def.bonus.dcCost);
  return { c: cc, d: c.d || 0, i: c.i || 0 };
}
export function canAfford(f, cost) {
  return f.compute >= (cost.c || 0) && f.data >= (cost.d || 0) && f.influence >= (cost.i || 0);
}
function pay(f, cost) {
  f.compute -= cost.c || 0; f.data -= cost.d || 0; f.influence -= cost.i || 0;
}
export function needsMet(game, f, needs) {
  if (!needs) return true;
  if (needs.gen && f.gen < needs.gen) return false;
  if (needs.building && countBuildings(game, f.id, needs.building) < 1) return false;
  return true;
}
export function needsLabel(needs) {
  if (!needs) return '';
  const p = [];
  if (needs.gen) p.push(`Gen-${needs.gen}`);
  if (needs.building) p.push(BUILDINGS[needs.building].name);
  return p.join(' + ');
}
function halted(game, f) {
  return f.buffs.some(b => b.stat === 'halt' && b.until > game.time);
}
export function buffMult(game, f, stat) {
  let m = 1;
  for (const b of f.buffs) if (b.stat === stat && b.until > game.time) m *= b.mult;
  return m;
}

// ---------------------------------------------------------------------------
// Commands (used by both the player UI and the AI)
// ---------------------------------------------------------------------------
function setOrder(game, u, order) {
  u.order = order;
  u.path = null; u.pathI = 0;
  u.anchorX = u.x; u.anchorZ = u.z;
  const tx = order.x ?? u.x, tz = order.z ?? u.z;
  // Path only when a straight line is obstructed.
  const steps = Math.ceil(dist({ x: u.x, z: u.z }, { x: tx, z: tz }) / 3);
  let blocked = false;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isBlocked(game, u.x + (tx - u.x) * t, u.z + (tz - u.z) * t)) { blocked = true; break; }
  }
  if (blocked) u.path = findPath(game, u.x, u.z, tx, tz);
}

export function cmdMove(game, ids, x, z) {
  const n = ids.length, ring = Math.max(1, Math.ceil(Math.sqrt(n)));
  ids.forEach((id, i) => {
    const u = game.ents.get(id); if (!u || u.kind !== 'unit') return;
    const a = (i / n) * Math.PI * 2, r = i === 0 ? 0 : 1.1 * (1 + Math.floor(i / 7)) * ring * 0.6;
    u.state = 'move'; u.target = null;
    setOrder(game, u, { kind: 'move', x: x + Math.cos(a) * r, z: z + Math.sin(a) * r });
  });
  if (n) emit(game, { t: 'ping', x, z, col: 'move' });
}

export function cmdStop(game, ids) {
  for (const id of ids) {
    const u = game.ents.get(id); if (!u || u.kind !== 'unit') continue;
    u.state = 'idle'; u.order = null; u.target = null; u.path = null;
  }
}

// Attack-move: march to a point, engaging anything hostile on the way, then
// resume the march once the lane is clear. Civilians just move.
export function cmdAttackMove(game, ids, x, z) {
  const mil = [], rest = [];
  for (const id of ids) {
    const u = game.ents.get(id);
    if (!u || u.kind !== 'unit') continue;
    (UNITS[u.type].dmg ? mil : rest).push(u);
  }
  mil.forEach((u, i) => {
    const a = (i / Math.max(1, mil.length)) * Math.PI * 2;
    const r = i === 0 ? 0 : 1.2 * (1 + Math.floor(i / 7));
    u.state = 'move'; u.target = null;
    setOrder(game, u, { kind: 'amove', x: x + Math.cos(a) * r, z: z + Math.sin(a) * r });
  });
  if (rest.length) cmdMove(game, rest.map(u => u.id), x, z);
  if (mil.length) emit(game, { t: 'ping', x, z, col: 'attack' });
  return { ok: mil.length > 0 };
}

export function cmdGather(game, ids, nodeId) {
  const node = game.ents.get(nodeId);
  if (!node || node.kind !== 'node') return { ok: false };
  let any = false;
  for (const id of ids) {
    const u = game.ents.get(id);
    if (!u || u.kind !== 'unit' || u.type !== 'researcher') continue;
    u.state = 'gather'; u.gatherNode = nodeId; u.target = null;
    setOrder(game, u, { kind: 'gather', nodeId, x: node.x, z: node.z });
    any = true;
  }
  if (any) emit(game, { t: 'ping', x: node.x, z: node.z, col: 'gather' });
  return { ok: any };
}

// Send researchers to (re)join an unfinished building of their own faction.
export function cmdBuild(game, ids, buildingId) {
  const b = game.ents.get(buildingId);
  if (!b || b.kind !== 'building' || b.done) return { ok: false };
  let any = false;
  for (const id of ids) {
    const u = game.ents.get(id);
    if (!u || u.kind !== 'unit' || u.type !== 'researcher' || u.faction !== b.faction) continue;
    u.state = 'build'; u.target = b.id;
    setOrder(game, u, { kind: 'build', buildingId: b.id, x: b.x, z: b.z });
    any = true;
  }
  if (any) emit(game, { t: 'ping', x: b.x, z: b.z, col: 'move' });
  return { ok: any };
}

export function cmdAttack(game, ids, targetId) {
  const tgt = game.ents.get(targetId); if (!tgt) return { ok: false };
  let any = false;
  for (const id of ids) {
    const u = game.ents.get(id);
    if (!u || u.kind !== 'unit') continue;
    if (!UNITS[u.type].dmg) continue; // civilians don't attack
    u.state = 'attack'; u.target = targetId;
    setOrder(game, u, { kind: 'attack', targetId, x: tgt.x, z: tgt.z });
    any = true;
  }
  if (any) emit(game, { t: 'ping', x: tgt.x, z: tgt.z, col: 'attack' });
  return { ok: any };
}

export function cmdChannel(game, ids) {
  const cap = game.capitol;
  let any = false;
  for (const id of ids) {
    const u = game.ents.get(id);
    if (!u || u.kind !== 'unit' || u.type !== 'lobbyist') continue;
    const a = game.rng() * Math.PI * 2;
    u.state = 'move';
    setOrder(game, u, { kind: 'channel', x: cap.x + Math.cos(a) * (cap.fp + 2.5), z: cap.z + Math.sin(a) * (cap.fp + 2.5) });
    any = true;
  }
  if (any) emit(game, { t: 'ping', x: cap.x, z: cap.z, col: 'move' });
  return { ok: any };
}

// Smart right-click: figure out intent from the clicked entity.
export function cmdSmart(game, ids, target, x, z) {
  if (!ids.length) return;
  if (target) {
    if (target.kind === 'node') {
      const res = ids.filter(id => game.ents.get(id)?.type === 'researcher');
      if (res.length) { cmdGather(game, res, target.id); }
      const rest = ids.filter(id => !res.includes(id));
      if (rest.length) cmdMove(game, rest, target.x, target.z);
      return;
    }
    if (target.kind === 'capitol') {
      const lob = ids.filter(id => game.ents.get(id)?.type === 'lobbyist');
      if (lob.length) cmdChannel(game, lob);
      const rest = ids.filter(id => !lob.includes(id));
      if (rest.length) cmdMove(game, rest, target.x + 10, target.z + 10);
      return;
    }
    if (target.kind === 'building' && !target.done) {
      // friendly construction site → researchers lend a hand
      const res = ids.filter(id => {
        const u = game.ents.get(id);
        return u && u.type === 'researcher' && u.faction === target.faction;
      });
      if (res.length) {
        cmdBuild(game, res, target.id);
        const rest = ids.filter(id => !res.includes(id));
        if (rest.length) cmdMove(game, rest, x, z);
        return;
      }
    }
    const pf = game.playerFaction;
    if ((target.kind === 'unit' || target.kind === 'building') && target.faction !== undefined && target.faction !== pf) {
      const mil = ids.filter(id => UNITS[game.ents.get(id)?.type]?.dmg);
      if (mil.length) cmdAttack(game, mil, target.id);
      const rest = ids.filter(id => !mil.includes(id));
      if (rest.length) cmdMove(game, rest, x, z);
      return;
    }
  }
  cmdMove(game, ids, x, z);
}

export function canPlace(game, fid, type, x, z) {
  const def = BUILDINGS[type];
  const HALFM = TUNE.mapSize / 2 - 6;
  if (Math.abs(x) > HALFM || Math.abs(z) > HALFM) return { ok: false, msg: '超出地图范围' };
  const clearOf = (e, extra = 1.5) => dist({ x, z }, e) >= def.fp + (e.fp || 1) + extra;
  for (const b of game.buildings) if (!clearOf(b)) return { ok: false, msg: '离其他建筑太近' };
  for (const c of game.clusters) if (!clearOf(c)) return { ok: false, msg: '离 GPU 集群太近' };
  for (const n of game.nodes) if (!clearOf(n, 1)) return { ok: false, msg: '离数据节点太近' };
  if (!clearOf(game.capitol, 2)) return { ok: false, msg: '国会草坪禁止施工' };
  let near = false;
  for (const b of game.buildings) if (b.faction === fid && dist({ x, z }, b) < 48) { near = true; break; }
  if (!near) return { ok: false, msg: '只能在己方园区 48 单位范围内建造' };
  return { ok: true };
}

export function cmdBuildStart(game, fid, type, x, z, builderIds) {
  const f = game.factions[fid];
  const def = BUILDINGS[type];
  if (!def) return { ok: false, msg: '未知建筑' };
  if (halted(game, f)) return { ok: false, msg: '监管调查：施工被冻结' };
  if (!needsMet(game, f, def.needs)) return { ok: false, msg: `需要 ${needsLabel(def.needs)}` };
  const place = canPlace(game, fid, type, x, z);
  if (!place.ok) return place;
  const cost = buildingCost(f, type);
  if (!canAfford(f, cost)) return { ok: false, msg: `资源不足 — ${fmtNeed(f, cost)}` };
  pay(f, cost);
  const b = addBuilding(game, fid, type, x, z, false);
  emit(game, { t: 'build_start', id: b.id });
  if (builderIds && builderIds.length) cmdBuild(game, builderIds, b.id);
  return { ok: true, id: b.id };
}

function fmtNeed(f, cost) {
  const p = [];
  if ((cost.c || 0) > f.compute) p.push(`还差 ${Math.ceil(cost.c - f.compute)}⚡`);
  if ((cost.d || 0) > f.data) p.push(`还差 ${Math.ceil(cost.d - f.data)}◆`);
  if ((cost.i || 0) > f.influence) p.push(`还差 ${Math.ceil(cost.i - f.influence)}◇`);
  return p.join('，') || '资源';
}

export function cmdTrainUnit(game, buildingId, type) {
  const b = game.ents.get(buildingId);
  if (!b || b.kind !== 'building' || !b.done) return { ok: false, msg: '建筑尚未就绪' };
  const f = game.factions[b.faction];
  const udef = UNITS[type];
  if (!udef) return { ok: false };
  if (!(BUILDINGS[b.type].trains || []).includes(type)) return { ok: false };
  if (halted(game, f)) return { ok: false, msg: '监管调查：招聘被冻结' };
  if (!needsMet(game, f, udef.needs)) return { ok: false, msg: `需要 ${needsLabel(udef.needs)}` };
  if (b.queue.length >= 5) return { ok: false, msg: '队列已满' };
  if (talentUsed(game, f.id) + udef.talent > f.talentCap)
    return { ok: false, msg: '人才上限已满 — 建造实验楼或数据中心' };
  const cost = unitCost(f, type);
  if (!canAfford(f, cost)) return { ok: false, msg: `资源不足 — ${fmtNeed(f, cost)}` };
  pay(f, cost);
  b.queue.push({ unit: type, remain: udef.time, total: udef.time });
  return { ok: true };
}

export function cmdResearchGen(game, fid) {
  const f = game.factions[fid];
  const next = f.gen + 1;
  if (next > MAX_GEN) return { ok: false, msg: '已是 AGI — 该启动 ASI 训练了' };
  const hq = game.ents.get(f.hq);
  if (!hq) return { ok: false };
  if (halted(game, f)) return { ok: false, msg: '监管调查：训练被冻结' };
  if (hq.queue.some(q => q.gen || q.asi)) return { ok: false, msg: '已有一次训练在排队' };
  const g = GENS[next];
  if (!canAfford(f, g.cost)) return { ok: false, msg: `资源不足 — ${fmtNeed(f, g.cost)}` };
  pay(f, g.cost);
  const time = g.time * (f.def.bonus.researchTime || 1);
  hq.queue.push({ gen: next, remain: time, total: time });
  emit(game, { t: 'gen_start', fid, gen: next });
  return { ok: true };
}

export function cmdStartASI(game, fid) {
  const f = game.factions[fid];
  if (f.gen < MAX_GEN) return { ok: false, msg: '需要 Gen-4（AGI）' };
  if (f.asi.state !== 'none') return { ok: false, msg: 'ASI 训练已经开始' };
  const hq = game.ents.get(f.hq);
  if (!hq) return { ok: false };
  if (halted(game, f)) return { ok: false, msg: '监管调查：训练被冻结' };
  if (hq.queue.some(q => q.gen || q.asi)) return { ok: false, msg: '总部正在进行训练' };
  if (!canAfford(f, ASI.cost)) return { ok: false, msg: `资源不足 — ${fmtNeed(f, ASI.cost)}` };
  pay(f, ASI.cost);
  const time = ASI.time * (f.def.bonus.researchTime || 1);
  hq.queue.push({ asi: true, remain: time, total: time });
  f.asi = { state: 'running', remain: time, total: time, paused: false, halfNoted: false };
  emit(game, { t: 'asi_start', fid });
  if (f.trust < TUNE.scrutinyTrust) {
    for (const r of game.factions) if (r.alive && r.id !== fid) r.influence += TUNE.scrutinyInfluence;
    emit(game, { t: 'toast', cls: 'warn', msg: `${f.def.name} 在公众信任低迷时启动 ASI 训练 — 监管者向其对手各发放 +${TUNE.scrutinyInfluence}◇` });
  }
  return { ok: true };
}

export function cmdPolicy(game, fid, pid, targetFid) {
  const f = game.factions[fid];
  const p = POLICIES[pid];
  if (!p) return { ok: false };
  if (countBuildings(game, fid, 'policy') < 1) return { ok: false, msg: '需要政策办公室' };
  if ((f.policyCd[pid] || 0) > game.time) return { ok: false, msg: `冷却中（${Math.ceil(f.policyCd[pid] - game.time)}秒）` };
  if (f.influence < p.cost) return { ok: false, msg: `Needs ${Math.ceil(p.cost - f.influence)} more ◇` };
  let tgt = f;
  if (p.target === 'rival') {
    tgt = game.factions[targetFid];
    if (!tgt || !tgt.alive || tgt.id === fid) return { ok: false, msg: '请选择一个对手' };
  }
  f.influence -= p.cost;
  f.policyCd[pid] = game.time + p.cd;
  if (pid === 'export_controls') tgt.buffs.push({ stat: 'compute', mult: 0.6, until: game.time + p.dur });
  if (pid === 'subsidy') tgt.buffs.push({ stat: 'compute', mult: 1.4, until: game.time + p.dur });
  if (pid === 'probe') tgt.buffs.push({ stat: 'halt', mult: 0, until: game.time + p.dur });
  if (pid === 'charm') f.trust = Math.min(100, f.trust + 12);
  emit(game, { t: 'policy', fid, pid, target: tgt.id });
  return { ok: true };
}

export function cmdSetRally(game, buildingId, x, z, targetId = null) {
  const b = game.ents.get(buildingId);
  if (b && b.kind === 'building') { b.rally = { x, z, targetId }; emit(game, { t: 'ping', x, z, col: 'move' }); }
}

// Fresh units head for the rally point — or straight to work when it was set
// on a data node, an unfinished friendly building, or the Capitol.
function applyRally(game, b, u) {
  const r = b.rally;
  const tgt = r.targetId != null ? game.ents.get(r.targetId) : null;
  if (u.type === 'researcher' && tgt) {
    if (tgt.kind === 'node' && cmdGather(game, [u.id], tgt.id).ok) return;
    if (tgt.kind === 'building' && cmdBuild(game, [u.id], tgt.id).ok) return;
  }
  if (u.type === 'lobbyist' && (tgt?.kind === 'capitol' || dist(r, game.capitol) < 12)) { cmdChannel(game, [u.id]); return; }
  cmdMove(game, [u.id], r.x + (game.rng() - 0.5) * 3, r.z + (game.rng() - 0.5) * 3);
}

// ---------------------------------------------------------------------------
// Damage & death
// ---------------------------------------------------------------------------
export function applyDamage(game, ent, amt, srcFid) {
  if (!game.ents.has(ent.id)) return;
  ent.hp -= amt;
  emit(game, { t: 'damaged', id: ent.id, amt });
  const f = ent.faction >= 0 ? game.factions[ent.faction] : null;
  if (f) {
    if (ent.kind === 'building') {
      if (ent.type === 'hq') f.hqDamagedUntil = game.time + TUNE.asiPauseOnHqDamage;
      if (game.time - f.underAttackAlertAt > 8) {
        f.underAttackAlertAt = game.time;
        emit(game, { t: 'alert', fid: f.id, x: ent.x, z: ent.z, msg: `${f.def.name} 园区遭到攻击` });
      }
    } else if ((ent.type === 'researcher' || ent.type === 'lobbyist') && ent.hp > 0) {
      // civilians run home
      const hq = game.ents.get(f.hq);
      if (hq) {
        ent.state = 'flee'; ent.fleeUntil = game.time + 4; ent.target = null;
        setOrder(game, ent, { kind: 'flee', x: hq.x + 6, z: hq.z + 6 });
      }
    }
  }
  if (ent.hp <= 0) killEntity(game, ent, srcFid);
}

function killEntity(game, ent, srcFid) {
  if (srcFid !== undefined && srcFid >= 0) game.factions[srcFid].kills++;
  if (ent.faction >= 0) game.factions[ent.faction].losses++;
  if (ent.kind === 'unit') {
    emit(game, { t: 'unit_died', id: ent.id, x: ent.x, z: ent.z, faction: ent.faction, utype: ent.type });
    removeEnt(game, ent);
  } else if (ent.kind === 'building') {
    emit(game, { t: 'building_died', id: ent.id, x: ent.x, z: ent.z, faction: ent.faction, btype: ent.type });
    const wasHq = ent.type === 'hq';
    const fid = ent.faction;
    removeEnt(game, ent);
    if (wasHq) eliminate(game, fid, srcFid);
  }
}

function eliminate(game, fid, srcFid) {
  const f = game.factions[fid];
  if (!f.alive) return;
  f.alive = false;
  if (f.asi.state === 'running') f.asi.state = 'none';
  emit(game, { t: 'elim', fid, by: srcFid });
  // The campus goes dark: everything they own collapses.
  for (const u of [...game.units]) if (u.faction === fid) killEntity(game, u, srcFid);
  for (const b of [...game.buildings]) if (b.faction === fid) {
    emit(game, { t: 'building_died', id: b.id, x: b.x, z: b.z, faction: fid, btype: b.type });
    removeEnt(game, b);
  }
  for (const c of game.clusters) if (c.owner === fid) { c.owner = -1; c.capProgress = 0; }
  const alive = game.factions.filter(x => x.alive);
  if (alive.length === 1 && !game.over) {
    game.over = { winner: alive[0].id, military: true, aligned: alive[0].alignment >= TUNE.alignedThreshold };
    emit(game, { t: 'victory', ...game.over });
  }
}

// ---------------------------------------------------------------------------
// Per-tick systems
// ---------------------------------------------------------------------------
function economy(game, dt) {
  const diff = DIFFICULTY[game.difficulty];
  // count channeling lobbyists per faction (ranked effectiveness)
  const lobby = [0, 0, 0, 0];
  for (const u of game.units) if (u.type === 'lobbyist' && u.state === 'channel') lobby[u.faction]++;

  for (const f of game.factions) {
    if (!f.alive) continue;
    const genMult = 1 + TUNE.genIncomePerLevel * (f.gen - 1);
    const aiMult = f.isAI ? diff.aiIncome : 1;
    const compMult = buffMult(game, f, 'compute') * genMult * aiMult;
    let rate = 0;
    for (const b of game.buildings) {
      if (b.faction !== f.id || !b.done || b.disabledUntil > game.time) continue;
      if (b.type === 'hq') rate += TUNE.hqComputeRate;
      if (b.type === 'datacenter') rate += TUNE.dcComputeRate * (f.def.bonus.dcOutput || 1);
      if (b.type === 'lab' && f.gen >= 3) f.data += TUNE.synthDataRate * genMult * aiMult * dt;
    }
    for (const c of game.clusters) if (c.owner === f.id) rate += TUNE.clusterComputeRate;
    f.computeRate = rate * compMult;
    f.compute += f.computeRate * dt;

    const trustMult = 0.5 + f.trust / 100;
    const nL = lobby[f.id];
    const eff = Math.min(nL, TUNE.lobbyEffectiveCap) + Math.max(0, nL - TUNE.lobbyEffectiveCap) * TUNE.lobbyOverflowEff;
    f.influenceRate = eff * TUNE.lobbyRate * trustMult * aiMult;
    f.influence += f.influenceRate * dt;

    f.talentUsed = talentUsed(game, f.id);
  }
}

function meters(game, dt) {
  for (const f of game.factions) {
    if (!f.alive) continue;
    // trust drifts back to 50
    f.trust += Math.sign(50 - f.trust) * Math.min(Math.abs(50 - f.trust), TUNE.trustDrift * dt);
    // institutes
    let inst = 0;
    for (const b of game.buildings)
      if (b.faction === f.id && b.type === 'institute' && b.done && b.disabledUntil <= game.time) inst++;
    if (inst > 0) {
      let effTotal = 0;
      for (let i = 0; i < inst; i++) effTotal += Math.pow(TUNE.instituteStack, i);
      const aMult = f.def.bonus.alignRate || 1;
      f.alignment = Math.min(100, f.alignment + TUNE.institueAlignRate * aMult * effTotal * dt);
      f.risk = Math.max(0, f.risk - TUNE.instituteRiskRate * effTotal * dt);
      f.trust = Math.min(100, f.trust + TUNE.instituteTrustRate * effTotal * dt);
    }
    // incidents
    if (game.time - f.lastIncidentRoll >= TUNE.incidentPeriod) {
      f.lastIncidentRoll = game.time;
      const p = Math.max(0, f.risk - TUNE.incidentRiskFloor) / TUNE.incidentDivisor;
      if (game.rng() < p) {
        const mine = game.buildings.filter(b => b.faction === f.id && b.done);
        if (mine.length) {
          const b = mine[Math.floor(game.rng() * mine.length)];
          b.disabledUntil = game.time + TUNE.incidentDisable;
          f.trust = Math.max(0, f.trust + TUNE.trustIncidentHit);
          f.risk = Math.max(0, f.risk - 10);
          emit(game, { t: 'incident', fid: f.id, bid: b.id, x: b.x, z: b.z });
        }
      }
    }
  }
  // defections: researchers walk out of low-trust labs into high-trust ones
  for (const victim of game.factions) {
    if (!victim.alive || game.time - victim.lastDefectRoll < TUNE.defectPeriod) continue;
    victim.lastDefectRoll = game.time;
    if (victim.defectionsSuffered >= TUNE.defectMaxPerVictim) continue;
    let poacher = null;
    for (const p of game.factions) {
      if (!p.alive || p.id === victim.id) continue;
      if (p.trust - victim.trust >= TUNE.defectTrustGap &&
          p.talentUsed + 1 <= p.talentCap &&
          (!poacher || p.trust > poacher.trust)) poacher = p;
    }
    if (!poacher || game.rng() >= TUNE.defectChance) continue;
    const r = game.units.find(u => u.faction === victim.id && u.type === 'researcher');
    if (!r) continue;
    victim.defectionsSuffered++;
    r.faction = poacher.id;
    r.state = 'idle'; r.order = null; r.target = null; r.gatherNode = null; r.carry = 0;
    emit(game, { t: 'defect', id: r.id, from: victim.id, to: poacher.id, x: r.x, z: r.z });
  }
}

function buildingsTick(game, dt) {
  for (const b of [...game.buildings]) {
    const f = game.factions[b.faction];
    if (!f || !f.alive) continue;
    const frozen = halted(game, f) || b.disabledUntil > game.time;

    // production / research queues
    if (b.done && b.queue.length && !frozen) {
      const q = b.queue[0];
      if (q.asi && (f.hqDamagedUntil > game.time)) {
        if (!f.asi.paused) { f.asi.paused = true; emit(game, { t: 'asi_paused', fid: f.id }); }
      } else {
        if (q.asi) f.asi.paused = false;
        q.remain -= dt;
        if (q.asi) {
          f.asi.remain = q.remain;
          if (!f.asi.halfNoted && q.remain <= q.total / 2) {
            f.asi.halfNoted = true;
            emit(game, { t: 'asi_half', fid: f.id });
          }
        }
        if (q.remain <= 0) {
          b.queue.shift();
          if (q.unit) {
            const a = game.rng() * Math.PI * 2;
            const u = addUnit(game, b.faction, q.unit, b.x + Math.cos(a) * (b.fp + 1.5), b.z + Math.sin(a) * (b.fp + 1.5));
            emit(game, { t: 'trained', id: u.id, fid: b.faction });
            if (b.rally) applyRally(game, b, u);
          } else if (q.gen) {
            f.gen = q.gen;
            f.gensAt[q.gen] = game.time;
            const riskMult = f.def.bonus.riskRate || 1;
            f.risk = Math.min(100, f.risk + GENS[q.gen].risk * riskMult);
            f.trust = Math.min(100, f.trust + TUNE.trustGenBonus);
            emit(game, { t: 'gen_done', fid: f.id, gen: q.gen });
          } else if (q.asi) {
            f.asi.state = 'done';
            const aligned = f.alignment >= TUNE.alignedThreshold;
            game.over = { winner: f.id, aligned, military: false };
            emit(game, { t: 'asi_done', fid: f.id, aligned });
            emit(game, { t: 'victory', ...game.over });
          }
        }
      }
    }

    // firewall towers
    if (b.type === 'tower' && b.done && !frozen) {
      b.cd -= dt;
      if (b.cd <= 0) {
        const def = BUILDINGS.tower;
        const es = enemiesNear(game, b.faction, b.x, b.z, def.range).filter(e => e.kind === 'unit');
        if (es.length) {
          const tgt = es[0];
          b.cd = def.cooldown;
          emit(game, { t: 'shot', fx: b.x, fz: b.z, fy: 6.2, tx: tgt.x, tz: tgt.z, fid: b.faction });
          applyDamage(game, tgt, def.dmg, b.faction);
        }
      }
    }
  }
}

function captureTick(game, dt) {
  for (const c of game.clusters) {
    const counts = [0, 0, 0, 0];
    for (const u of game.units) {
      if (dist2(u, c) <= TUNE.captureRadius * TUNE.captureRadius) counts[u.faction]++;
    }
    let top = -1, topN = 0, secN = 0;
    for (let i = 0; i < 4; i++) {
      if (counts[i] > topN) { secN = topN; topN = counts[i]; top = i; }
      else if (counts[i] > secN) secN = counts[i];
    }
    if (top >= 0 && topN > secN && top !== c.owner) {
      if (c.capBy !== top) {
        c.capBy = top; c.capProgress = 0;
        emit(game, { t: 'capture_start', cid: c.id, fid: top, owner: c.owner, x: c.x, z: c.z });
      }
      c.capProgress += dt * (1 + 0.15 * Math.min(4, topN - secN - 1));
      if (c.capProgress >= TUNE.captureTime) {
        c.owner = top; c.capProgress = 0; c.capBy = -1;
        emit(game, { t: 'capture', cid: c.id, fid: top, x: c.x, z: c.z });
      }
    } else {
      c.capProgress = Math.max(0, c.capProgress - dt * 0.7);
      if (c.capProgress === 0) c.capBy = -1;
    }
  }
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------
function moveToward(game, u, tx, tz, dt, arrive = 0.5) {
  const def = UNITS[u.type];
  // arrival is always measured against the true destination …
  if (Math.hypot(tx - u.x, tz - u.z) < arrive) { u.path = null; return true; }
  // … waypoints are pure steering
  if (u.path && u.pathI < u.path.length) {
    const wp = u.path[u.pathI];
    if (dist({ x: u.x, z: u.z }, wp) < 1.4) u.pathI++;
    if (u.pathI < u.path.length) { tx = u.path[u.pathI].x; tz = u.path[u.pathI].z; }
  }
  const dx = tx - u.x, dz = tz - u.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) { if (u.path && u.pathI < u.path.length) u.pathI++; return false; }
  const step = Math.min(d, def.speed * dt);
  u.x += (dx / d) * step; u.z += (dz / d) * step;
  u.facing = Math.atan2(dx, dz);
  return false;
}

function stuckCheck(game, u, dt) {
  // if a unit with a destination barely moves, try repathing
  u._mv = (u._mv || 0) + Math.hypot(u.x - u.px, u.z - u.pz);
  u._mvT = (u._mvT || 0) + dt;
  if (u._mvT >= 1.5) {
    if (u._mv < 0.6 && u.order && u.order.x !== undefined && game.time > u.repathAt) {
      u.repathAt = game.time + 2;
      u.path = findPath(game, u.x, u.z, u.order.x, u.order.z);
      u.pathI = 0;
    }
    u._mv = 0; u._mvT = 0;
  }
}

function unitTick(game, u, dt) {
  const def = UNITS[u.type];
  u.cd = Math.max(0, u.cd - dt);

  // auto-aggro for idle military
  if (def.dmg && (u.state === 'idle' || (u.state === 'move' && !u.order))) {
    const es = enemiesNear(game, u.faction, u.x, u.z, TUNE.aggroRadius);
    if (es.length) { u.state = 'attack'; u.target = es[0].id; }
  }

  switch (u.state) {
    case 'idle': u.anim = 'idle'; break;

    case 'move': {
      u.anim = 'walk';
      const o = u.order;
      if (!o) { u.state = 'idle'; break; }
      // attack-movers engage whatever crosses their path (order is kept, so
      // the attack state hands control back here once the threat is gone)
      if (o.kind === 'amove' && def.dmg) {
        const es = enemiesNear(game, u.faction, u.x, u.z, TUNE.aggroRadius);
        if (es.length) { u.state = 'attack'; u.target = es[0].id; break; }
      }
      if (moveToward(game, u, o.x, o.z, dt)) {
        if (o.kind === 'channel') { u.state = 'channel'; }
        else { u.state = 'idle'; u.order = null; }
      }
      break;
    }

    case 'flee': {
      u.anim = 'walk';
      const o = u.order;
      if (!o || (moveToward(game, u, o.x, o.z, dt, 2) && game.time > u.fleeUntil)) {
        u.state = u.gatherNode ? 'gather' : 'idle';
        if (u.state === 'gather') {
          const n = game.ents.get(u.gatherNode);
          if (n) setOrder(game, u, { kind: 'gather', nodeId: n.id, x: n.x, z: n.z });
          else u.state = 'idle';
        }
      }
      break;
    }

    case 'gather': {
      const node = game.ents.get(u.gatherNode);
      if (!node || node.amount <= 0) {
        const nn = nearestWhere(game.nodes, u.x, u.z, n => n.amount > 0, 70);
        if (nn) { u.gatherNode = nn.id; setOrder(game, u, { kind: 'gather', nodeId: nn.id, x: nn.x, z: nn.z }); }
        else {
          u.state = u.carry > 4 ? 'return' : 'idle';
          const f = game.factions[u.faction];
          if (!f._dataOutToast && !f.isAI && f.gen < 3) {
            f._dataOutToast = true;
            emit(game, { t: 'toast', cls: 'warn', msg: '附近的公开数据已挖空 — 升到 Gen-3 产出合成数据，或去争夺地图中央的富矿' });
          }
        }
        break;
      }
      if (dist(u, node) > node.fp + 1.3) { u.anim = 'walk'; moveToward(game, u, node.x, node.z, dt, node.fp + 1.1); }
      else {
        u.anim = 'work'; u.facing = Math.atan2(node.x - u.x, node.z - u.z);
        const take = Math.min(TUNE.gatherRate * dt, node.amount, TUNE.carryCap - u.carry);
        node.amount -= take; u.carry += take;
        if (game.rng() < dt * 1.5) emit(game, { t: 'gather_fx', x: node.x, z: node.z });
        if (node.amount <= 0) emit(game, { t: 'node_empty', id: node.id, x: node.x, z: node.z });
        if (u.carry >= TUNE.carryCap - 1e-6) u.state = 'return';
      }
      break;
    }

    case 'return': {
      const drop = nearestDropoff(game, u.faction, u.x, u.z);
      if (!drop) { u.state = 'idle'; break; }
      u.anim = 'walk';
      if (moveToward(game, u, drop.x, drop.z, dt, drop.fp + 1.2)) {
        const f = game.factions[u.faction];
        f.data += u.carry;
        if (u.carry >= TUNE.popupMinDeposit)
          emit(game, { t: 'deposit', fid: u.faction, amt: Math.round(u.carry), x: drop.x, z: drop.z });
        u.carry = 0;
        const node = game.ents.get(u.gatherNode);
        if (node && node.amount > 0) { u.state = 'gather'; setOrder(game, u, { kind: 'gather', nodeId: node.id, x: node.x, z: node.z }); }
        else { u.gatherNode = null; u.state = 'gather'; } // gather state will re-target or idle out
      }
      break;
    }

    case 'build': {
      const b = game.ents.get(u.target);
      if (!b || b.kind !== 'building' || b.done) {
        u.state = 'idle'; u.target = null;
        // QoL: freed builders drift to the nearest live node
        const nn = nearestWhere(game.nodes, u.x, u.z, n => n.amount > 0, 30);
        if (nn && u.type === 'researcher') { u.state = 'gather'; u.gatherNode = nn.id; setOrder(game, u, { kind: 'gather', nodeId: nn.id, x: nn.x, z: nn.z }); }
        break;
      }
      if (dist(u, b) > b.fp + 1.6) { u.anim = 'walk'; moveToward(game, u, b.x, b.z, dt, b.fp + 1.4); }
      else { u.anim = 'work'; u.facing = Math.atan2(b.x - u.x, b.z - u.z); }
      break;
    }

    case 'channel': {
      u.anim = 'channel';
      u.facing = Math.atan2(game.capitol.x - u.x, game.capitol.z - u.z);
      if (dist(u, game.capitol) > game.capitol.fp + 5) { u.state = 'move'; setOrder(game, u, { kind: 'channel', x: u.order?.x ?? game.capitol.x + 9, z: u.order?.z ?? game.capitol.z }); }
      break;
    }

    case 'attack': {
      const tgt = game.ents.get(u.target);
      if (!tgt) {
        u.target = null;
        if (u.order && u.order.kind === 'amove') u.state = 'move'; // resume the march
        else { u.state = 'idle'; u.order = null; }
        break;
      }
      const reach = def.range + (tgt.fp || UNITS[tgt.type]?.radius || 0.5);
      const d = dist(u, tgt);
      if (d > reach) {
        // leash back if we chased too far from our post
        if (!u.order && Math.hypot(u.x - u.anchorX, u.z - u.anchorZ) > TUNE.leashRadius) {
          u.state = 'move'; u.target = null;
          setOrder(game, u, { kind: 'move', x: u.anchorX, z: u.anchorZ });
          break;
        }
        u.anim = 'walk'; moveToward(game, u, tgt.x, tgt.z, dt, reach * 0.9);
      } else {
        u.anim = 'attack';
        u.facing = Math.atan2(tgt.x - u.x, tgt.z - u.z);
        if (u.cd <= 0) {
          u.cd = def.cooldown;
          const f = game.factions[u.faction];
          const dmg = def.dmg * (f.gen >= 4 ? 1.15 : 1);
          if (def.ranged) emit(game, { t: 'shot', fx: u.x, fz: u.z, fy: 1.6, tx: tgt.x, tz: tgt.z, fid: u.faction });
          else emit(game, { t: 'melee', id: u.id, x: tgt.x, z: tgt.z });
          applyDamage(game, tgt, dmg, u.faction);
        }
      }
      break;
    }
  }
  stuckCheck(game, u, dt);
}

function construction(game, dt) {
  // count builders per site
  const builders = new Map();
  for (const u of game.units) {
    if (u.state !== 'build') continue;
    const b = game.ents.get(u.target);
    if (!b || b.done) continue;
    if (dist(u, b) <= b.fp + 1.8) builders.set(b.id, (builders.get(b.id) || 0) + 1);
  }
  for (const b of game.buildings) {
    if (b.done || !builders.has(b.id)) continue;
    const n = Math.min(3, builders.get(b.id));
    const factor = [0, 1, 1.7, 2.2][n];
    const f = game.factions[b.faction];
    const speed = (f.def.bonus.buildSpeed || 1);
    b.progress += (factor * speed / BUILDINGS[b.type].time) * dt;
    b.hp = Math.min(b.maxHp, Math.max(b.hp, b.progress * b.maxHp));
    if (game.rng() < dt * 2.2) emit(game, { t: 'build_fx', x: b.x, z: b.z, fp: b.fp });
    if (b.progress >= 1) {
      b.progress = 1; b.done = true; b.hp = b.maxHp;
      applyTalentCap(game, b, +1);
      emit(game, { t: 'build_done', id: b.id, fid: b.faction, btype: b.type, x: b.x, z: b.z });
    }
  }
}

function separation(game) {
  const us = game.units;
  for (let i = 0; i < us.length; i++) {
    const a = us[i];
    for (let j = i + 1; j < us.length; j++) {
      const b = us[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      const min = 1.15;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2), push = (min - d) * 0.35;
        const nx = dx / d, nz = dz / d;
        a.x -= nx * push; a.z -= nz * push;
        b.x += nx * push; b.z += nz * push;
      } else if (d2 <= 1e-6) {
        a.x += (game.rng() - 0.5) * 0.2; b.z += (game.rng() - 0.5) * 0.2;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main step
// ---------------------------------------------------------------------------
export function stepGame(game, dt) {
  if (game.over && game.over.winner !== undefined) return;
  game.time += dt;

  for (const f of game.factions) f.buffs = f.buffs.filter(b => b.until > game.time);

  for (const u of game.units) { u.px = u.x; u.pz = u.z; }

  economy(game, dt);
  construction(game, dt);
  buildingsTick(game, dt);
  for (const u of [...game.units]) {
    if (game.ents.has(u.id)) unitTick(game, u, dt);
  }
  separation(game);
  captureTick(game, dt);
  meters(game, dt);
  stepAI(game, dt);
  updateFog(game);
}
