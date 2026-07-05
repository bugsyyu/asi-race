// ============================================================================
// AI opponents. Personality-driven, deterministic (game.rng only), throttled.
// Circular import with sim.js is intentional and safe: both modules only call
// each other's functions at runtime, never during module evaluation.
// The AI ignores fog of war (sim/fog.js) — it plays with full information,
// the classic RTS concession; fog only limits what the human player sees.
// ============================================================================
import { TUNE, BUILDINGS, GENS, MAX_GEN, ASI, POLICIES, TECHS, INDUSTRY, DIFFICULTY } from './constants.js';
import { cmdRaise, cmdCloudMode, cmdAcquire, cmdPoach, acquireCost } from './industry.js';
import { dist, nearestWhere, enemiesNear, countBuildings, emit } from './world.js';
import {
  cmdMove, cmdAttack, cmdAttackMove, cmdGather, cmdChannel, cmdBuildStart, cmdTrainUnit,
  cmdResearchGen, cmdStartASI, cmdPolicy, cmdSetRally, cmdResearchTech, cmdTrade,
  canPlace, canAfford, buildingCost, unitCost, needsMet,
} from './sim.js';

// Personalities — playful readings of each lab, mechanically distinct.
// techPrio: the order this lab buys its economy upgrades (AoE build orders).
const PERSONA = {
  openai:    { researchBuffer: 0,   dcTarget: 3, labTarget: 3, ecoTarget: 9,  milTarget: 5, institute: 'risky', raidEvery: 150, waveMin: 5, towers: 1, lobbyists: 2,
    techPrio: ['brand', 'optics', 'pipeline', 'immersion', 'drills', 'synth'] },
  anthropic: { researchBuffer: 60,  dcTarget: 2, labTarget: 3, ecoTarget: 8,  milTarget: 6, institute: 'early', raidEvery: 175, waveMin: 6, towers: 2, lobbyists: 3, waitAligned: true,
    techPrio: ['oversight', 'pipeline', 'optics', 'drills', 'revolving', 'immersion'] },
  deepmind:  { researchBuffer: 40,  dcTarget: 4, labTarget: 3, ecoTarget: 10, milTarget: 5, institute: 'mid',   raidEvery: 160, waveMin: 6, towers: 1, lobbyists: 3,
    techPrio: ['optics', 'pipeline', 'immersion', 'synth', 'brand', 'revolving'] },
  xai:       { researchBuffer: 15,  dcTarget: 3, labTarget: 2, ecoTarget: 8,  milTarget: 9, institute: 'risky', raidEvery: 100, waveMin: 4, towers: 1, lobbyists: 2,
    techPrio: ['drills', 'optics', 'brand', 'pipeline', 'immersion', 'synth'] },
};

const MIL = new Set(['secops', 'cyberops']);

export function initAI(game) {
  for (const f of game.factions) if (f.isAI && !f.ai) initFaction(game, f);
}

function initFaction(game, f) {
  const p = PERSONA[f.def.key] || PERSONA.openai;
  const aggro = DIFFICULTY[game.difficulty].aiAggro;
  f.ai = {
    p, aggro,
    nextThink: 0.5 + f.id * 0.19,
    nextRaid: (p.raidEvery * (0.9 + game.rng() * 0.3)) / aggro,
    raiders: [], raidFid: -1, raidUntil: 0,
    defendUntil: 0,
    buildCd: 0,
    clusterId: 0, clusterSquad: [],
    allIn: false,
    lastRaidedAt: -999, threatDir: null,   // remembered attack vector → tower placement
    nextEscort: 0,                         // throttle for far-node mining escorts
  };
}

export function stepAI(game, dt) {
  if (game.over) return;
  for (const f of game.factions) {
    if (!f.isAI || !f.alive) continue;
    if (!f.ai) initFaction(game, f);
    if (game.time >= f.ai.nextThink) {
      f.ai.nextThink = game.time + 0.7;
      think(game, f);
    }
  }
}

// ---------------------------------------------------------------------------
function think(game, f) {
  const ai = f.ai, p = ai.p;
  const hq = game.ents.get(f.hq);
  if (!hq) return;

  // situation ---------------------------------------------------------------
  const mine = game.units.filter(u => u.faction === f.id && u.hp > 0);
  const workers = mine.filter(u => u.type === 'researcher');
  const military = mine.filter(u => MIL.has(u.type));
  const lobbyists = mine.filter(u => u.type === 'lobbyist');
  const threats = enemiesNear(game, f.id, hq.x, hq.z, 34).filter(e => e.kind === 'unit');
  const rivals = game.factions.filter(r => r.alive && r.id !== f.id);
  const leader = topRival(rivals);
  const runner = rivals.find(r => r.asi.state === 'running');

  // 1) the race: someone else is running an ASI they may finish first --------
  ai.allIn = false;
  if (runner) {
    const myRemain = f.asi.state === 'running' ? f.asi.remain
      : f.gen === MAX_GEN ? ASI.time * (f.def.bonus.researchTime || 1) + 25
      : Infinity;
    if (myRemain > runner.asi.remain + ((runner.asi.stage || 0) >= 2 ? 12 : 4)) {
      ai.allIn = true;
      tryPolicies(game, f, rivals, leader, runner);          // probe them first
      if (f.gen === MAX_GEN && f.asi.state === 'none') cmdStartASI(game, f.id); // race anyway
      const rHq = game.ents.get(runner.hq);
      if (rHq) orderIdle(game, military.concat(ai.clusterSquad.map(id => game.ents.get(id)).filter(Boolean)),
        u => cmdAttackMove(game, [u.id], rHq.x, rHq.z)); // fight through the door
      return; // all hands on deck — skip normal routine
    }
  }

  // 2) defense ----------------------------------------------------------------
  if (threats.length) {
    ai.defendUntil = game.time + 8;
    ai.raidUntil = 0; ai.raiders = [];
    ai.lastRaidedAt = game.time;
    ai.threatDir = Math.atan2(threats[0].z - hq.z, threats[0].x - hq.x);
    const tgt = threats[0];
    orderIdle(game, military, u => cmdAttack(game, [u.id], tgt.id));
    // a serious push also recalls the cluster expedition to defend home
    if (threats.length >= 3 && ai.clusterSquad.length) {
      for (const id of ai.clusterSquad) {
        const u = game.ents.get(id);
        if (u && u.hp > 0) cmdAttackMove(game, [id], hq.x, hq.z);
      }
      ai.clusterSquad = []; ai.clusterId = 0;
    }
  }

  // 3) policy plays -----------------------------------------------------------
  tryPolicies(game, f, rivals, leader, runner);

  // 4) research ladder / ASI --------------------------------------------------
  if (f.gen < MAX_GEN) {
    const g = GENS[f.gen + 1];
    const buffer = threats.length ? p.researchBuffer + 80 : p.researchBuffer;
    if (f.compute >= (g.cost.c || 0) + buffer && f.data >= (g.cost.d || 0) && f.influence >= (g.cost.i || 0)) {
      cmdResearchGen(game, f.id);
    }
  } else if (f.asi.state === 'none') {
    const racing = rivals.some(r => r.gen >= MAX_GEN || r.asi.state !== 'none');
    const ready = !p.waitAligned || f.alignment >= TUNE.alignedThreshold || racing;
    if (ready && canAfford(f, ASI.cost)) cmdStartASI(game, f.id);
  }

  // 4.5) economy techs — buy down the persona's priority list ------------------
  buyTechs(game, f, p);

  // 4.6) spot market — cover the bottleneck resource for the next rung ---------
  useMarket(game, f);

  // 4.7) industry plays: raise capital, sell cloud compute, buy startups,
  // poach a rival's star researcher when the trust gap favors us --------------
  industryPlays(game, f, rivals);

  // 5) build one thing --------------------------------------------------------
  if (game.time >= ai.buildCd) {
    const want = chooseBuilding(game, f, p, military.length);
    if (want && canAfford(f, buildingCost(f, want)) && needsMet(game, f, BUILDINGS[want].needs)) {
      const spot = findSpot(game, f.id, want, hq, want === 'tower' ? ai.threatDir : null);
      if (spot) {
        const crew = workers.filter(u => u.state !== 'build' && u.state !== 'flee').slice(0, 2).map(u => u.id);
        const r = cmdBuildStart(game, f.id, want, spot.x, spot.z, crew);
        ai.buildCd = game.time + (r.ok ? 4 : 6);
      } else ai.buildCd = game.time + 10;
    }
  }

  // 6) training ----------------------------------------------------------------
  if (hq.done && workers.length < p.ecoTarget && hq.queue.length < 2) cmdTrainUnit(game, hq.id, 'researcher');

  const sec = game.buildings.find(b => b.faction === f.id && b.type === 'secoffice' && b.done);
  if (sec && sec.queue.length < 2) {
    const wantMil = Math.round(p.milTarget * ai.aggro) + (threats.length ? 3 : 0) + (rivals.some(r => r.gen >= 3) ? 2 : 0);
    if (military.length + sec.queue.length < wantMil) {
      cmdTrainUnit(game, sec.id, pickMilKind(game, f, leader));
    }
  }

  const desk = game.buildings.find(b => b.faction === f.id && b.type === 'policy' && b.done);
  if (desk) {
    if (!desk.rally) cmdSetRally(game, desk.id, game.capitol.x + (f.id - 1.5) * 3, game.capitol.z + (f.id % 2 ? 4 : -4));
    if (lobbyists.length < p.lobbyists && desk.queue.length < 2) cmdTrainUnit(game, desk.id, 'lobbyist');
  }

  // 7) jobs for idle hands -------------------------------------------------------
  for (const u of workers) if (u.state === 'idle' && !u.order) assignGather(game, f, u, hq);
  for (const u of lobbyists) if (u.state === 'idle' && !u.order) cmdChannel(game, [u.id]);

  // 8) GPU clusters ---------------------------------------------------------------
  manageClusters(game, f, military);

  // 9) raids ------------------------------------------------------------------------
  manageRaids(game, f, military, rivals, leader);
}

// Buy the first affordable tech on the persona's list whose home building is
// free — the AI runs the same upgrade economy the player does.
function buyTechs(game, f, p) {
  for (const key of p.techPrio) {
    if (f.techs[key]) continue;
    const t = TECHS[key];
    if (t.needs?.gen && f.gen < t.needs.gen) continue;
    if (t.needs?.tech && !f.techs[t.needs.tech]) continue;
    const home = game.buildings.find(b => b.faction === f.id && b.type === t.at && b.done && !b.tech);
    if (!home) continue;
    // keep a small cash buffer so techs never starve the build order
    if (f.compute < (t.cost.c || 0) + 60 || f.data < (t.cost.d || 0) || f.influence < (t.cost.i || 0)) continue;
    cmdResearchTech(game, home.id, key);
    return; // one per think
  }
}

// Trade toward whatever the next research rung is short of.
function useMarket(game, f) {
  if (f.mktPressure > 0.4) return;
  const goal = f.gen < MAX_GEN ? GENS[f.gen + 1].cost : ASI.cost;
  const needC = (goal.c || 0) - f.compute, needD = (goal.d || 0) - f.data;
  if (needD > 0 && needC < -(TUNE.tradeLotC + 120)) cmdTrade(game, f.id, 'c2d');
  else if (needC > 0 && needD < -(TUNE.tradeLotD + 160)) cmdTrade(game, f.id, 'd2c');
}

// Capital, cloud, M&A and headhunting — the AI plays the meta-economy too.
function industryPlays(game, f, rivals) {
  const ind = game.industry;
  if (!ind) return;
  // secondary offering when cash-starved and the stock can absorb it
  if (f.compute < 140 && ind.prices[f.id] > 85 && f.raiseCd <= game.time) cmdRaise(game, f.id);
  // cloud sell-side: rich in compute, short on data/influence → open the taps
  const wantCloud = f.computeRate > 24 && (f.data < 120 || f.influence < 50) && f.gen < MAX_GEN;
  if (wantCloud !== f.cloud) cmdCloudMode(game, f.id, wantCloud);
  // acquire a startup when its paradigm buff is affordable with a buffer
  for (const s of ind.startups) {
    if (s.state !== 'private') continue;
    const cost = acquireCost(s);
    if (f.compute > cost.c + 260 && f.influence > cost.i + 60) { cmdAcquire(game, f.id, s.id); break; }
  }
  // headhunt when influence-rich and the trust gap gives good odds
  if (f.poachCd <= game.time && f.influence > INDUSTRY.poachCost.i + 90 && f.compute > INDUSTRY.poachCost.c + 200) {
    let best = null, gap = 8;
    for (const key in ind.lums) {
      const emp = ind.lums[key].emp;
      if (typeof emp !== 'number' || emp === f.id) continue;
      const g = f.trust - game.factions[emp].trust;
      if (g > gap) { gap = g; best = key; }
    }
    if (best) cmdPoach(game, f.id, best);
  }
}

// Counter-composition: read the leading rival's army and train against it.
function pickMilKind(game, f, leader) {
  if (f.gen >= 2 && leader) {
    let melee = 0, ranged = 0;
    for (const u of game.units) {
      if (u.faction !== leader.id || u.hp <= 0) continue;
      if (u.type === 'secops') melee++;
      else if (u.type === 'cyberops') ranged++;
    }
    const total = melee + ranged;
    if (total >= 4) {
      if (melee / total > 0.6 && canAfford(f, unitCost(f, 'cyberops'))) return 'cyberops'; // kite the batons
      if (ranged / total > 0.6) return 'secops';                                           // soak the packets
    }
  }
  return f.gen >= 2 && canAfford(f, unitCost(f, 'cyberops')) && game.rng() < 0.6 ? 'cyberops' : 'secops';
}

// ---------------------------------------------------------------------------
function topRival(rivals) {
  let best = null, bs = -1;
  for (const r of rivals) {
    const s = r.gen * 100
      + (r.asi.state === 'running' ? 60 + (1 - r.asi.remain / (r.asi.total || 1)) * 40 : 0)
      + r.compute * 0.01;
    if (s > bs) { bs = s; best = r; }
  }
  return best;
}

function orderIdle(game, units, fn) {
  for (const u of units) if (u && u.hp > 0 && (u.state === 'idle' || u.state === 'move')) fn(u);
}

function chooseBuilding(game, f, p, milCount) {
  const n = (t) => countBuildings(game, f.id, t, false); // include under construction
  const done = (t) => countBuildings(game, f.id, t, true);
  const t = game.time;
  if (n('lab') < 1) return 'lab';
  if (n('datacenter') < Math.min(2, p.dcTarget)) return 'datacenter';
  const wantInst =
    (p.institute === 'early' && (t > 70 || f.gen >= 2)) ||
    (p.institute === 'mid' && (f.gen >= 2 && t > 200 || f.risk > 40)) ||
    (p.institute === 'risky' && f.risk > 45);
  if (wantInst && n('institute') < 1) return 'institute';
  if (n('secoffice') < 1 && (t > 110 / f.ai.aggro || f.gen >= 2)) return 'secoffice';
  if (f.gen >= 2 && n('policy') < 1) return 'policy';
  if (n('datacenter') < p.dcTarget) return 'datacenter';
  // recently raided labs dig in with an extra tower, facing the attack vector
  const towersWant = p.towers + (game.time - f.ai.lastRaidedAt < 150 ? 1 : 0);
  if (done('secoffice') >= 1 && n('tower') < towersWant) return 'tower';
  if (n('lab') < p.labTarget) return 'lab';
  if (f.risk > 60 && n('institute') < 2) return 'institute';
  if (t > 420 && n('datacenter') < p.dcTarget + 2) return 'datacenter';
  return null;
}

// Deterministic spiral sample around the HQ. Default bias faces the map
// center; defensive works aim down the last remembered attack vector.
function findSpot(game, fid, type, base, dirOverride = null) {
  const bias = dirOverride ?? Math.atan2(-base.z, -base.x);
  const rrange = type === 'tower' ? [11, 22] : [13, 34];
  for (let rad = rrange[0]; rad <= rrange[1]; rad += 3.5) {
    for (let k = 0; k < 10; k++) {
      const a = bias + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.62;
      const x = base.x + Math.cos(a) * rad, z = base.z + Math.sin(a) * rad;
      if (canPlace(game, fid, type, x, z).ok) return { x, z };
    }
  }
  return null;
}

function assignGather(game, f, u, hq) {
  // least-crowded live node, preferring ones near home. Once the home veins
  // run dry, expand to the rich center — and send a soldier along as escort.
  const homeDry = !game.nodes.some(n => n.amount > 0 && dist(n, hq) < 60);
  let best = null, bs = Infinity;
  for (const n of game.nodes) {
    if (n.amount <= 0) continue;
    const crowd = game.units.reduce((c, w) => c + (w.faction === f.id && w.gatherNode === n.id ? 1 : 0), 0);
    const d = dist(n, hq);
    const s = d + crowd * 9 + (!homeDry && d > 78 ? 40 : 0);
    if (s < bs) { bs = s; best = n; }
  }
  if (!best) return;
  cmdGather(game, [u.id], best.id);
  if (homeDry && dist(best, hq) > 60 && game.time >= f.ai.nextEscort) {
    const guard = game.units.find(w => w.faction === f.id && MIL.has(w.type) && w.hp > 0 &&
      (w.state === 'idle' || w.state === 'move') && !f.ai.raiders.includes(w.id) && !f.ai.clusterSquad.includes(w.id));
    if (guard) {
      cmdAttackMove(game, [guard.id], best.x, best.z);
      f.ai.nextEscort = game.time + 45;
    }
  }
}

function manageClusters(game, f, military) {
  const ai = f.ai;
  ai.clusterSquad = ai.clusterSquad.filter(id => { const u = game.ents.get(id); return u && u.hp > 0; });
  const target = game.ents.get(ai.clusterId);
  if (target && target.owner === f.id) { ai.clusterId = 0; ai.clusterSquad = []; }
  if (!ai.clusterId && military.length >= 3) {
    const hq = game.ents.get(f.hq);
    const cl = nearestWhere(game.clusters, hq.x, hq.z, c => c.owner !== f.id);
    if (cl) {
      ai.clusterId = cl.id;
      const free = military.filter(u => !ai.raiders.includes(u.id)).slice(0, 2);
      ai.clusterSquad = free.map(u => u.id);
      for (const u of free) cmdMove(game, [u.id], cl.x + (game.rng() - 0.5) * 5, cl.z + (game.rng() - 0.5) * 5);
    }
  } else if (ai.clusterId && ai.clusterSquad.length) {
    const cl = game.ents.get(ai.clusterId);
    if (cl) orderIdle(game, ai.clusterSquad.map(id => game.ents.get(id)), u => {
      if (dist(u, cl) > TUNE.captureRadius - 1) cmdMove(game, [u.id], cl.x + (game.rng() - 0.5) * 5, cl.z + (game.rng() - 0.5) * 5);
    });
  }
}

function manageRaids(game, f, military, rivals, leader) {
  const ai = f.ai, p = ai.p;
  if (game.time < ai.defendUntil) return;

  // ongoing raid: keep survivors busy, retreat once the wave is spent
  if (ai.raidUntil > game.time) {
    ai.raiders = ai.raiders.filter(id => { const u = game.ents.get(id); return u && u.hp > 0; });
    const foe = game.factions[ai.raidFid];
    if (ai.raiders.length < Math.max(2, Math.ceil(p.waveMin / 2)) || !foe || !foe.alive) {
      const hq = game.ents.get(f.hq);
      for (const id of ai.raiders) cmdMove(game, [id], hq.x + (game.rng() - 0.5) * 8, hq.z + (game.rng() - 0.5) * 8);
      ai.raidUntil = 0; ai.raiders = [];
      return;
    }
    orderIdle(game, ai.raiders.map(id => game.ents.get(id)), u => {
      const tgt = nearestEnemyEnt(game, ai.raidFid, u.x, u.z);
      if (tgt) cmdAttackMove(game, [u.id], tgt.x, tgt.z);
    });
    return;
  }

  // launch a new one — attack-move at the leader's economy, not a suicide
  // beeline: waves fight through what they meet and snipe workers en route
  if (game.time >= ai.nextRaid) {
    const free = military.filter(u => !ai.clusterSquad.includes(u.id));
    if (free.length >= p.waveMin && leader) {
      const big = free.length >= p.waveMin + 3;
      const rHq = game.ents.get(leader.hq);
      const eco = nearestWhere(game.buildings, free[0].x, free[0].z,
        b => b.faction === leader.id && (b.type === 'datacenter' || b.type === 'lab'));
      const tgt = big && rHq ? rHq : eco
        || nearestWhere(game.buildings, free[0].x, free[0].z, b => b.faction === leader.id) || rHq;
      if (tgt) {
        ai.raiders = free.map(u => u.id);
        ai.raidFid = leader.id;
        ai.raidUntil = game.time + 55;
        for (const u of free) cmdAttackMove(game, [u.id], tgt.x, tgt.z);
        emit(game, { t: 'raid', from: f.id, to: leader.id, x: tgt.x, z: tgt.z });
      }
    }
    ai.nextRaid = game.time + (p.raidEvery * (0.85 + game.rng() * 0.3)) / ai.aggro;
  }
}

function nearestEnemyEnt(game, fid, x, z) {
  return nearestWhere(game.buildings, x, z, b => b.faction === fid)
      || nearestWhere(game.units, x, z, u => u.faction === fid && u.hp > 0);
}

function tryPolicies(game, f, rivals, leader, runner) {
  if (countBuildings(game, f.id, 'policy') < 1) return;
  const can = (pid) => f.influence >= POLICIES[pid].cost && (f.policyCd[pid] || 0) <= game.time;
  if (runner && can('probe')) { cmdPolicy(game, f.id, 'probe', runner.id); return; }
  if (f.trust < 40 && can('charm')) { cmdPolicy(game, f.id, 'charm'); return; }
  if (leader && leader.gen > f.gen && can('export_controls')) { cmdPolicy(game, f.id, 'export_controls', leader.id); return; }
  if (f.gen >= 3 && can('subsidy') && f.influence > POLICIES.subsidy.cost + 60) cmdPolicy(game, f.id, 'subsidy');
}
