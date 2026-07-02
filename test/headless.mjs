// Headless verification: full AI-vs-AI games in Node, no DOM, no three.js.
// Run: node test/headless.mjs
import { createGame } from '../js/sim/world.js';
import { stepGame, cmdTrainUnit, cmdBuildStart, cmdGather } from '../js/sim/sim.js';
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

// --- Test 2: full AI-vs-AI races on several seeds -----------------------------
console.log('\n[2] Full AI-vs-AI races (4 seeds, cap 1800 sim-seconds each)');
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

// --- Test 3: determinism ------------------------------------------------------
console.log('\n[3] Determinism (same seed → identical outcome)');
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
