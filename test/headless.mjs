// Headless verification: full AI-vs-AI games in Node, no DOM, no three.js.
// Run: node test/headless.mjs
import { createGame } from '../js/sim/world.js';
import { stepGame, cmdTrainUnit, cmdBuildStart, cmdGather, cmdSmart, cmdSetRally, cmdMove, applyDamage } from '../js/sim/sim.js';
import { isVisible, isExplored } from '../js/sim/fog.js';
import { TUNE, FACTIONS } from '../js/sim/constants.js';

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

// --- Test 5: determinism ------------------------------------------------------
console.log('\n[5] Determinism (same seed → identical outcome)');
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
