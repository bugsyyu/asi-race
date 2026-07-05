// Headless verification: full AI-vs-AI games in Node, no DOM, no three.js.
// Run: node test/headless.mjs
import { createGame, addUnit, addBuilding } from '../js/sim/world.js';
import {
  stepGame, cmdTrainUnit, cmdBuildStart, cmdGather, cmdSmart, cmdSetRally, cmdMove, cmdAttackMove,
  applyDamage, canPlace, cmdResearchTech, cmdTrade, terrainSpeed,
} from '../js/sim/sim.js';
import { isVisible, isExplored } from '../js/sim/fog.js';
import { isBlocked } from '../js/sim/pathfind.js';
import { cmdRaise, cmdCloudMode, cmdAcquire, _forceDepart } from '../js/sim/industry.js';
import { TUNE, FACTIONS, TECHS, UNITS, LUMINARIES } from '../js/sim/constants.js';
import { buildingCost, cmdStartASI } from '../js/sim/sim.js';
import { groundHeight, slopeAt } from '../js/shared/height.js';

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  ✓', msg);
  else { failures++; console.error('  ✗ FAIL:', msg); }
};

function checkSane(game, tag) {
  for (const f of game.factions) {
    for (const k of ['compute', 'data', 'influence', 'trust', 'alignment', 'risk']) {
      const v = f[k];
      if (!Number.isFinite(v)) { failures++; console.error(`  ✗ ${tag}: ${f.def.key}.${k} is ${v}`); }
      if (v < -0.01) { failures++; console.error(`  ✗ ${tag}: ${f.def.key}.${k} negative (${v.toFixed(2)})`); }
    }
  }
  for (const u of game.units) {
    if (!Number.isFinite(u.x) || !Number.isFinite(u.z)) { failures++; console.error(`  ✗ ${tag}: unit ${u.id} NaN position`); }
  }
}

// --- Test 1: basic economy & commands ---------------------------------------
console.log('\n[1] Economy, gathering, building, training (240 sim-seconds)');
{
  const g = createGame({ seed: 7, allAI: false, playerFaction: 0 });
  // player faction 0 is human — drive it manually a little
  const f = g.factions[0];
  const workers = g.units.filter(u => u.faction === 0);
  const node = g.nodes[0];
  cmdGather(g, workers.map(u => u.id), node.id);
  let built = false, trained = false;
  for (let t = 0; t < 2400; t++) {
    stepGame(g, TUNE.tick);
    if (!trained && f.compute >= 80) { trained = cmdTrainUnit(g, f.hq, 'researcher').ok; }
    if (!built && f.compute >= 200) {
      const hq = g.ents.get(f.hq);
      built = cmdBuildStart(g, 0, 'lab', hq.x + 20, hq.z - 14, [workers[0].id]).ok;
    }
    if (t % 300 === 0) checkSane(g, `t=${(t / 10).toFixed(0)}s`);
  }
  ok(f.compute > 0, `compute flows (⚡ ${f.compute.toFixed(0)})`);
  ok(f.data > 0 || node.amount < node.max, `data was gathered (◆ ${f.data.toFixed(0)}, node ${node.amount.toFixed(0)}/${node.max})`);
  ok(trained, 'trained a researcher');
  ok(built, 'placed and paid for a lab');
  ok(g.buildings.some(b => b.faction === 0 && b.type === 'lab' && b.done), 'lab finished construction');
  ok(g.units.filter(u => u.faction === 0).length > 3, 'population grew');
  checkSane(g, 'end');
}

// --- Test 2: joining construction & rally-to-work ------------------------------
console.log('\n[2] Smart command onto construction sites; rally onto nodes/sites');
{
  const g = createGame({ seed: 5, allAI: false, playerFaction: 0 });
  const f = g.factions[0];
  const hq = g.ents.get(f.hq);
  const workers = g.units.filter(u => u.faction === 0);
  f.compute = 2000;

  // one researcher starts a lab, the other two are right-clicked onto the site
  const r1 = cmdBuildStart(g, 0, 'lab', hq.x + 20, hq.z - 14, [workers[0].id]);
  ok(r1.ok, 'lab site placed with a single builder');
  const site = g.ents.get(r1.id);
  cmdSmart(g, [workers[1].id, workers[2].id], site, site.x, site.z);
  ok(workers[1].state === 'build' && workers[1].target === site.id &&
     workers[2].state === 'build' && workers[2].target === site.id,
     'smart command sends researchers to help an unfinished friendly building');
  let ticks = 0;
  while (!site.done && ticks++ < 4000) stepGame(g, TUNE.tick);
  ok(site.done && ticks * TUNE.tick < 16, `3-crew lab done in ${(ticks * TUNE.tick).toFixed(1)}s (< solo 16s)`);

  // rally the HQ onto a data node → newborn researcher goes straight to mining
  const node = g.nodes[0];
  cmdSetRally(g, f.hq, node.x, node.z, node.id);
  ok(hq.rally && hq.rally.targetId === node.id, 'rally stores its target entity');
  const known = new Set(g.units.map(u => u.id));
  ok(cmdTrainUnit(g, f.hq, 'researcher').ok, 'queued a researcher');
  let fresh = null;
  for (let t = 0; t < 200 && !fresh; t++) { stepGame(g, TUNE.tick); fresh = g.units.find(u => u.faction === 0 && !known.has(u.id)); }
  ok(!!fresh, 'researcher spawned');
  ok(fresh.state === 'gather' && fresh.gatherNode === node.id, 'rally on a node → newborn starts gathering it');

  // rally the HQ onto an unfinished building → newborn joins the crew
  const r2 = cmdBuildStart(g, 0, 'datacenter', hq.x - 20, hq.z + 14, []);
  ok(r2.ok, 'crewless datacenter site placed');
  const site2 = g.ents.get(r2.id);
  cmdSetRally(g, f.hq, site2.x, site2.z, site2.id);
  const known2 = new Set(g.units.map(u => u.id));
  ok(cmdTrainUnit(g, f.hq, 'researcher').ok, 'queued another researcher');
  let fresh2 = null;
  for (let t = 0; t < 200 && !fresh2; t++) { stepGame(g, TUNE.tick); fresh2 = g.units.find(u => u.faction === 0 && !known2.has(u.id)); }
  ok(!!fresh2, 'second researcher spawned');
  ok(fresh2.state === 'build' && fresh2.target === site2.id, 'rally on a site → newborn joins construction');
  const p0 = site2.progress;
  for (let t = 0; t < 600; t++) stepGame(g, TUNE.tick);
  ok(site2.progress > p0, `rallied builder advances the site (${(site2.progress * 100).toFixed(0)}%)`);
  checkSane(g, 'rally/build end');
}

// --- Test 3: full AI-vs-AI races on several seeds -----------------------------
console.log('\n[3] Full AI-vs-AI races (4 seeds, cap 1800 sim-seconds each)');
const MAXT = 1800;
let totalRaids = 0, totalAsiHalf = 0;
for (const seed of [11, 42, 77, 1234]) {
  const g = createGame({ seed, allAI: true });
  let steps = 0, combat = false, gens = 0, policies = 0, incidents = 0, captures = 0;
  while (!g.over && g.time < MAXT) {
    stepGame(g, TUNE.tick);
    steps++;
    for (const ev of g.events) {
      if (ev.t === 'shot' || ev.t === 'melee') combat = true;
      if (ev.t === 'gen_done') gens++;
      if (ev.t === 'policy') policies++;
      if (ev.t === 'incident') incidents++;
      if (ev.t === 'capture') captures++;
      if (ev.t === 'raid') totalRaids++;
      if (ev.t === 'asi_half') totalAsiHalf++;
    }
    g.events.length = 0; // the view would drain these
    if (steps % 3000 === 0) checkSane(g, `seed ${seed} t=${g.time.toFixed(0)}s`);
  }
  const w = g.over && g.over.winner != null ? g.over : null;
  console.log(`  seed ${seed}: ${g.time.toFixed(0)}s, gens=${gens}, policies=${policies}, incidents=${incidents}, captures=${captures}` +
    (w ? `, winner=${FACTIONS[w.winner].key} (${w.military ? 'military' : w.aligned ? 'aligned ASI' : 'rogue ASI'})` : ', no winner'));
  ok(g.over, `seed ${seed}: game ended (${g.time.toFixed(0)}s < ${MAXT}s)`);
  ok(combat, `seed ${seed}: combat occurred`);
  ok(gens >= 3, `seed ${seed}: research ladder climbed (${gens} generations)`);
  checkSane(g, `seed ${seed} final`);
}
ok(totalRaids > 0, `raid announcements fired across the races (${totalRaids})`);
ok(totalAsiHalf > 0, `ASI halfway announcements fired (${totalAsiHalf})`);

// --- Test 4: fog of war ---------------------------------------------------------
console.log('\n[4] Fog of war: vision, exploration, last-seen memory');
{
  const g = createGame({ seed: 9, allAI: false, playerFaction: 0 });
  const hq0 = g.ents.get(g.factions[0].hq), hq1 = g.ents.get(g.factions[1].hq);
  ok(isVisible(g, 0, hq0.x, hq0.z) && isExplored(g, 0, hq0.x, hq0.z), 'own campus starts visible');
  ok(g.nodes.slice(0, 3).every(n => isVisible(g, 0, n.x, n.z)), 'starter nodes sit inside HQ sight');
  ok(!isVisible(g, 0, hq1.x, hq1.z) && !isExplored(g, 0, hq1.x, hq1.z), 'rival campus starts dark');
  ok(!g.fog.memory.has(hq1.id), 'no memory of the rival HQ yet');
  ok(isVisible(g, 2, hq0.x, hq0.z), 'untracked factions are treated as all-seeing');

  // scout: march a researcher across the map into the rival campus
  const scout = g.units.find(u => u.faction === 0);
  let t = 0;
  cmdMove(g, [scout.id], hq1.x, hq1.z);
  while (t++ < 6000 && !isVisible(g, 0, hq1.x, hq1.z)) {
    if (t % 200 === 0) cmdMove(g, [scout.id], hq1.x, hq1.z); // recover from flee interrupts
    stepGame(g, TUNE.tick);
  }
  ok(isVisible(g, 0, hq1.x, hq1.z), `scout revealed the rival campus (${(t * TUNE.tick).toFixed(0)}s)`);
  ok(g.fog.memory.get(hq1.id)?.kind === 'building', 'rival HQ recorded in last-seen memory');

  // walk home: visibility fades, exploration and memory persist
  cmdMove(g, [scout.id], hq0.x, hq0.z);
  for (let i = 0; i < 400; i++) stepGame(g, TUNE.tick);
  ok(!isVisible(g, 0, hq1.x, hq1.z), 'rival campus fades back into fog');
  ok(isExplored(g, 0, hq1.x, hq1.z), 'explored ground stays explored');
  ok(g.fog.memory.has(hq1.id), 'memory survives losing sight');

  // the rival HQ dies unseen → the ghost lingers until we look again
  applyDamage(g, hq1, 1e6, 2);
  stepGame(g, TUNE.tick);
  ok(!g.ents.has(hq1.id), 'rival HQ destroyed while unseen');
  ok(g.fog.memory.has(hq1.id), 'ghost persists while the lot is out of sight');
  t = 0;
  cmdMove(g, [scout.id], hq1.x, hq1.z);
  while (t++ < 6000 && g.fog.memory.has(hq1.id)) {
    if (t % 200 === 0) cmdMove(g, [scout.id], hq1.x, hq1.z);
    stepGame(g, TUNE.tick);
  }
  ok(!g.fog.memory.has(hq1.id), 'seeing the empty lot clears the memory');
  checkSane(g, 'fog end');
}

// --- Test 5: attack-move --------------------------------------------------------
console.log('\n[5] Attack-move: engage whatever blocks the lane, then resume');
{
  const g = createGame({ seed: 21, allAI: false, playerFaction: 0 });
  const sec = addUnit(g, 0, 'secops', -40, 0);
  const lab = addBuilding(g, 1, 'lab', -20, 0, true); // rival outpost in the lane
  const r = cmdAttackMove(g, [sec.id], 30, 0);
  ok(r.ok, 'attack-move order accepted');
  ok(sec.order && sec.order.kind === 'amove', 'order stored as attack-move');
  let engaged = false, t = 0;
  while (t++ < 6000 && g.ents.has(lab.id)) {
    stepGame(g, TUNE.tick);
    if (sec.state === 'attack' && sec.target === lab.id) engaged = true;
  }
  ok(engaged, 'engaged the rival building on the way');
  ok(!g.ents.has(lab.id), `cleared the obstacle (${(t * TUNE.tick).toFixed(0)}s)`);
  t = 0;
  while (t++ < 2500 && Math.hypot(sec.x - 30, sec.z) > 3) stepGame(g, TUNE.tick);
  ok(Math.hypot(sec.x - 30, sec.z) <= 3, 'resumed the march to the ordered point');
  checkSane(g, 'attack-move end');
}

// --- Test 6: terrain is a gameplay system --------------------------------------
console.log('\n[6] Terrain: mesas block, slopes slow, high ground hits harder');
{
  const g = createGame({ seed: 7 });
  // the east mesa wall stands across the edge lane
  ok(groundHeight(94, 0) > 3.5, `mesa summit is high ground (h=${groundHeight(94, 0).toFixed(1)})`);
  // find a genuinely steep sample on the flank
  let steepX = 0, steepS = 0;
  for (let x = 78; x <= 102; x += 0.5) {   // stay inside buildable map bounds
    const s = slopeAt(x, 6); if (s > steepS) { steepS = s; steepX = x; }
  }
  ok(steepS > TUNE.steepBlock, `mesa flank is steep (slope=${steepS.toFixed(2)} at x=${steepX})`);
  ok(isBlocked(g, steepX, 6), 'pathfinder treats the flank as a wall');
  ok(terrainSpeed(steepX, 6) < 0.55, `climbing there is slow (×${terrainSpeed(steepX, 6).toFixed(2)})`);
  ok(terrainSpeed(-78, -78) > 0.9, 'the HQ pad stays fast');
  const deny = canPlace(g, 0, 'datacenter', steepX, 6);
  ok(!deny.ok && deny.msg.includes('陡'), 'construction rejected on the flank');
  // high ground: a cyberops shooting down from a knoll hits ~30% harder
  const up = addUnit(g, 0, 'cyberops', 31, 31);          // knoll crown, h≈3.3
  const low = addUnit(g, 1, 'secops', 31, 42.5);         // at the foot
  low.hp = low.maxHp = 1000;
  const before = low.hp;
  let t = 0;
  const r = cmdAttackMove(g, [up.id], 31, 42.5);
  ok(r.ok, 'attacker ordered downhill');
  while (t++ < 400 && low.hp === before) stepGame(g, TUNE.tick);
  const hit = before - low.hp;
  const base = UNITS.cyberops.dmg;
  ok(hit > base * 1.2 && hit <= base * 1.45, `downhill shot lands amplified (${hit.toFixed(1)} vs base ${base})`);
}

// --- Test 7: AoE-style economy — techs and the spot market ---------------------
console.log('\n[7] Economy techs + compute market');
{
  const g = createGame({ seed: 11 });
  const f = g.factions[0];
  const hq = g.ents.get(f.hq);
  f.compute = 5000; f.data = 1000;
  const r = cmdResearchTech(g, hq.id, 'brand');
  ok(r.ok, 'brand research starts at the HQ');
  ok(!cmdResearchTech(g, hq.id, 'brand').ok, 'no double-booking the same building');
  for (let t = 0; t < TECHS.brand.time / TUNE.tick + 9; t++) stepGame(g, TUNE.tick);
  ok(f.techs.brand === true, 'brand completes');
  cmdTrainUnit(g, hq.id, 'researcher');
  const q = hq.queue[hq.queue.length - 1];
  ok(Math.abs(q.total - UNITS.researcher.time * 0.8) < 1e-6, 'training runs 20% faster after brand');
  // market: slippage makes the second trade pay less, then pressure decays
  const d0 = f.data;
  cmdTrade(g, 0, 'c2d');
  const gain1 = f.data - d0;
  cmdTrade(g, 0, 'c2d');
  const gain2 = f.data - d0 - gain1;
  ok(gain1 > gain2, `slippage: ${gain1.toFixed(0)}◆ then ${gain2.toFixed(0)}◆`);
  const p0 = f.mktPressure;
  for (let t = 0; t < 200; t++) stepGame(g, TUNE.tick);
  ok(f.mktPressure < p0, 'market pressure recovers over time');
  checkSane(g, 'econ end');
}

// --- Test 8: the industry layer -------------------------------------------------
console.log('\n[8] Industry: luminaries, startups, capital, the ASI era');
{
  const g = createGame({ seed: 5 });
  const rosters = g.factions.map(f => f.roster.length);
  ok(rosters.every(n => n === 2), `each lab signs two luminaries (${rosters.join(',')})`);
  ok(g.factions.some(f => f.lum.research < 1 || f.lum.data > 1 || f.lum.compute > 1),
    'luminary buffs land on faction multipliers');
  const f0 = g.factions[0];
  const p0 = g.industry.prices[0], c0 = f0.compute;
  ok(cmdRaise(g, 0).ok, 'secondary offering accepted');
  ok(f0.compute > c0 && g.industry.prices[0] < p0, 'raise adds compute and dilutes the stock');
  cmdCloudMode(g, 0, true);
  const d0 = f0.data;
  for (let t = 0; t < 40; t++) stepGame(g, TUNE.tick);
  ok(f0.cloud && f0.data > d0, 'cloud sell-side trickles data in exchange for compute');
  g.industry.shocks.push({ amt: 30, until: g.time + 60 });
  for (let t = 0; t < 30; t++) stepGame(g, TUNE.tick);
  ok(f0.hwMult > 1.02, `hardware shock inflates the index (×${f0.hwMult.toFixed(2)})`);
  ok(buildingCost(f0, 'datacenter').c > 245, 'datacenters get pricier in a shortage');
  for (const k in LUMINARIES) LUMINARIES[k].quitBias = 0;  // pin the dice
  let founded = null;
  for (const k of Object.keys(g.industry.lums)) {
    if (typeof g.industry.lums[k].emp !== 'number') continue;
    _forceDepart(g, k);
    founded = g.industry.startups[0];
    if (founded) break;
  }
  ok(!!founded, `a departing luminary founds a startup (${founded ? founded.name : '—'})`);
  if (founded) {
    ok(!canPlace(g, 0, 'tower', founded.x, founded.z).ok, 'the campus blocks construction around it');
    f0.compute = 99999; f0.influence = 9999;
    ok(cmdAcquire(g, 0, founded.id).ok, 'acquisition accepted');
    ok(f0.paradigms.length === 1 && g.industry.startups.every(s => s.id !== founded.id),
      'paradigm absorbed, campus folds into the buyer');
  }
  // the Emergence: a live run wakes in stages whose temperament reads alignment
  const g2 = createGame({ seed: 9 });
  const fa = g2.factions[0];
  const hqA = g2.ents.get(fa.hq);
  fa.gen = 4; fa.compute = 99999; fa.data = 99999;
  ok(cmdStartASI(g2, 0).ok, 'final training run starts');
  fa.alignment = 0;                                   // raising it hungry
  const q = hqA.queue.find(x => x.asi);
  q.remain = q.total * 0.55; fa.asi.remain = q.remain; // drop into the storm
  addUnit(g2, 1, 'secops', hqA.x + 8, hqA.z);
  let maxStage = 0, insider = false, squeeze = false;
  const t0 = g2.time;
  for (let t = 0; t < 800 && !g2.over; t++) {
    fa.hqDamagedUntil = 0; // assume a perfectly defended campus — rivals DO all-in it
    stepGame(g2, TUNE.tick);
    for (const ev of g2.events) {
      if (ev.t === 'emerge') maxStage = Math.max(maxStage, ev.stage);
      if (ev.t === 'convert') insider = true;
      if (ev.t === 'brownout') squeeze = true;
    }
    g2.events.length = 0;
  }
  ok(maxStage >= 5, `emergence climbed the ladder (stage ${maxStage})`);
  ok(insider, 'an unaligned run buys a rival insider');
  ok(squeeze, 'the grid squeeze swept the rivals');
  ok(g2.over?.winner === 0, 'the accelerating run finished the race');
  ok(g2.time - t0 < q.total * 0.55 - 3, `self-improvement beat the clock (${(g2.time - t0).toFixed(0)}s < ${(q.total * 0.55).toFixed(0)}s)`);
}

// --- Test 9: determinism ------------------------------------------------------
console.log('\n[9] Determinism (same seed → identical outcome)');
{
  const run = (seed) => {
    const g = createGame({ seed, allAI: true });
    while (!g.over && g.time < MAXT) { stepGame(g, TUNE.tick); g.events.length = 0; }
    return `${g.over?.winner}|${g.time.toFixed(1)}|${g.units.length}|${g.buildings.length}`;
  };
  const a = run(42), b = run(42);
  ok(a === b, `two runs of seed 42 match (${a})`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll headless checks passed.');
process.exit(failures ? 1 : 0);
