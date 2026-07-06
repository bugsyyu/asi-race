// Bridge verification: the external-control protocol (js/bridge/protocol.js)
// and the headless stdio server (bridge/server.mjs) that python/asirace talks
// to. Run: node test/bridge.mjs
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createGame } from '../js/sim/world.js';
import { stepGame } from '../js/sim/sim.js';
import { TUNE, MAP } from '../js/sim/constants.js';
import { applyCommand, snapshot, observe, metaInfo, PROTOCOL_VERSION } from '../js/bridge/protocol.js';

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  ✓', msg);
  else { failures++; console.error('  ✗ FAIL:', msg); }
};
const step = (g, n) => { for (let i = 0; i < n; i++) stepGame(g, TUNE.tick); g.events.length = 0; };

// --- Test 1: protocol dispatch, ownership walls, rule-vs-protocol errors ------
console.log('\n[1] Protocol: dispatch, ownership validation, error taxonomy');
{
  const g = createGame({ seed: 7, allAI: false, playerFaction: 0 });
  const meta = metaInfo();
  ok(meta.protocol === PROTOCOL_VERSION && meta.tick === TUNE.tick, 'meta carries protocol + tick');
  ok(meta.factions.length === 4 && meta.units.researcher && meta.buildings.hq, 'meta carries the data tables');
  ok(JSON.parse(JSON.stringify(meta)).map.nodes.length === MAP.nodes.length, 'meta survives a JSON round trip');

  const mine = g.units.filter(u => u.faction === 0).map(u => u.id);
  const theirs = g.units.filter(u => u.faction === 1).map(u => u.id);

  let r = applyCommand(g, { op: 'move', fid: 0, ids: [...mine, ...theirs], x: 0, z: 0 });
  ok(r.ok && r.n === mine.length, `move drops foreign ids silently (${r.n}/${mine.length + theirs.length})`);
  r = applyCommand(g, { op: 'move', fid: 0, ids: theirs, x: 0, z: 0 });
  ok(!r.ok && r.msg && !r.error, 'moving only rival units → rule refusal, not protocol error');
  r = applyCommand(g, { op: 'attack', fid: 0, ids: mine, target: g.nodes[0].id });
  ok(!r.ok && r.msg, 'attacking a data node is refused (would corrupt hp math)');
  r = applyCommand(g, { op: 'attack', fid: 0, ids: mine, target: g.ents.get(g.factions[0].hq).id });
  ok(!r.ok && r.msg, 'friendly fire is refused');
  r = applyCommand(g, { op: 'train', fid: 0, bid: g.factions[1].hq, utype: 'researcher' });
  ok(!r.ok && r.msg, "training at a rival's building is refused");
  r = applyCommand(g, { op: 'train', fid: 0, bid: g.factions[0].hq, utype: 'nonsense' });
  ok(!r.ok && r.error, 'unknown unit type → protocol error (caller bug)');
  r = applyCommand(g, { op: 'frobnicate', fid: 0 });
  ok(!r.ok && r.error, 'unknown op → protocol error');

  // gather + smart drive the economy through the protocol only
  r = applyCommand(g, { op: 'gather', fid: 0, ids: mine, node: g.nodes[0].id });
  ok(r.ok, 'gather accepted');
  step(g, 600);
  const f0 = g.factions[0];
  ok(f0.data > 0, `data flowed through protocol-issued orders (◆${f0.data.toFixed(0)})`);
  r = applyCommand(g, { op: 'smart', fid: 0, ids: mine, target: g.nodes[1].id });
  ok(r.ok && g.units.find(u => u.id === mine[0]).gatherNode === g.nodes[1].id, 'smart onto a node re-targets gathering');

  // build via can_place → build; the response carries `bid` (id-collision guard)
  const hq = g.ents.get(f0.hq);
  f0.compute = 1000;
  let spot = null;
  for (let rad = 13; rad <= 34 && !spot; rad += 3.5) {
    for (let k = 0; k < 10 && !spot; k++) {
      const a = Math.atan2(-hq.z, -hq.x) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.62;
      const x = hq.x + Math.cos(a) * rad, z = hq.z + Math.sin(a) * rad;
      const cp = applyCommand(g, { op: 'can_place', fid: 0, btype: 'lab', x, z });
      if (cp.place && cp.afford) spot = { x, z };
    }
  }
  ok(!!spot, 'can_place spiral found a lab site');
  r = applyCommand(g, { op: 'build', fid: 0, btype: 'lab', x: spot.x, z: spot.z, builders: mine.slice(0, 2) });
  ok(r.ok && Number.isInteger(r.bid) && r.id === undefined, 'build returns the site as `bid`, never `id`');
  step(g, 1);
  ok(g.ents.get(r.bid)?.type === 'lab', 'the site exists in the sim');

  // set_ai flips control of a faction
  r = applyCommand(g, { op: 'set_ai', fid: 2, ai: false });
  ok(r.ok && g.factions[2].isAI === false && g.factions[2].ai === null, 'set_ai detaches the built-in AI');
  applyCommand(g, { op: 'set_ai', fid: 2, ai: true });
  ok(g.factions[2].isAI === true, 'set_ai re-attaches it');
}

// --- Test 2: snapshots and fog-honest observations ------------------------------
console.log('\n[2] Snapshots: omniscient state vs fog-filtered observe');
{
  const g = createGame({ seed: 9, allAI: false, playerFaction: 0 });
  const st = snapshot(g);
  ok(st.units.length === g.units.length && st.buildings.length === 4 && st.nodes.length === g.nodes.length,
    'full snapshot sees everything');
  ok(!JSON.stringify(st).includes('NaN'), 'snapshot is clean JSON (no NaN leakage)');

  const obs = observe(g, 0);
  ok(obs.omniscient === false && obs.perspective === 0, 'tracked faction gets a fog-honest view');
  ok(obs.units.every(u => u.fid === 0), 'no rival units visible at spawn');
  ok(obs.buildings.length === 1 && obs.buildings[0].fid === 0, 'only own campus visible at spawn');
  ok(obs.factions[0].compute !== undefined && obs.factions[1].compute === undefined,
    'own ledger open, rival ledgers hidden');
  ok(obs.factions[1].gen !== undefined && obs.factions[1].stock !== undefined && obs.factions[1].trust !== undefined,
    'rival public signals (gen, stock, trust) remain readable');
  ok(obs.factions[1].hq === null, "rival HQ entity id is not leaked");
  const obs2 = observe(g, 2, { grids: true });
  ok(obs2.omniscient === true, 'untracked perspective is flagged omniscient (fog only tracks one faction)');
  const og = observe(g, 0, { grids: true });
  ok(typeof og.grids.visible === 'string' && og.grids.n * og.grids.n >= og.grids.visible.length * 0.7,
    'fog grids export as base64');
  ok(og.exploredFrac > 0 && og.exploredFrac < 0.2, `explored fraction plausible (${og.exploredFrac})`);

  // march a scout into a rival campus: live building appears, then a ghost stays
  const scout = g.units.find(u => u.faction === 0);
  const hq1 = g.ents.get(g.factions[1].hq);
  let t = 0;
  applyCommand(g, { op: 'move', fid: 0, ids: [scout.id], x: hq1.x, z: hq1.z });
  while (t++ < 6000 && !observe(g, 0).buildings.some(b => b.fid === 1 && !b.ghost)) {
    if (t % 200 === 0) applyCommand(g, { op: 'move', fid: 0, ids: [scout.id], x: hq1.x, z: hq1.z });
    stepGame(g, TUNE.tick); g.events.length = 0;
  }
  ok(observe(g, 0).buildings.some(b => b.fid === 1 && !b.ghost), 'scouting reveals the rival campus live');
  applyCommand(g, { op: 'move', fid: 0, ids: [scout.id], x: -78, z: -78 });
  step(g, 500);
  const after = observe(g, 0);
  ok(after.buildings.some(b => b.fid === 1 && b.ghost), 'out of sight → the campus stays as a last-seen ghost');
  ok(!after.units.some(u => u.fid !== 0), 'rival units vanish with the fog');
}

// --- Test 3: stdio server round trip -----------------------------------------------
console.log('\n[3] Headless server: envelope ids, stepping, until_over');
const root = fileURLToPath(new URL('..', import.meta.url));
function startServer() {
  const proc = spawn(process.execPath, ['bridge/server.mjs'], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });
  const pend = new Map();
  let nid = 0, onReady;
  const ready = new Promise((res) => { onReady = res; });
  createInterface({ input: proc.stdout }).on('line', (l) => {
    const o = JSON.parse(l);
    if (o.ready) { onReady(o); return; }
    const p = pend.get(o.id);
    if (p) { pend.delete(o.id); p(o); }
  });
  return {
    ready,
    call(op, params = {}) {
      const id = ++nid;
      proc.stdin.write(JSON.stringify({ id, op, ...params }) + '\n');
      return new Promise((res) => pend.set(id, res));
    },
    close() { try { proc.stdin.end(); } catch { /* gone */ } proc.kill(); },
  };
}

{
  const s = startServer();
  const hello = await s.ready;
  ok(hello.protocol === PROTOCOL_VERSION, 'server greets with the protocol version');
  let r = await s.call('step');
  ok(!r.ok && r.error, 'step before new_game → error');
  r = await s.call('new_game', { seed: 7, faction: 0 });
  ok(r.ok && r.state.units.length === 12 && r.meta.maxGen === 4, 'new_game returns meta + initial state');
  ok(r.state.factions[0].isAI === false && r.state.factions[1].isAI === true, 'player faction detached from AI, rivals attached');

  const st0 = r.state;
  const workers = st0.units.filter(u => u.fid === 0).map(u => u.id);
  r = await s.call('gather', { fid: 0, ids: workers, node: st0.nodes[0].id });
  ok(r.ok, 'gather over stdio');
  r = await s.call('step', { seconds: 30 });
  ok(r.ok && Math.abs(r.time - 30) < 0.01 && r.steps === 300 && Array.isArray(r.events), '300 ticks stepped, events drained');
  r = await s.call('step', { ticks: 5, events: false, observe: 0 });
  ok(r.ok && r.events === undefined && r.obs && r.obs.omniscient === false, 'events opt-out + fog observe in one round trip');

  // the id-collision regression: build's payload must not clobber the envelope
  r = await s.call('observe', { fid: 0 });
  const hq = r.state.buildings.find(b => b.type === 'hq');
  let spot = null;
  for (let rad = 13; rad <= 34 && !spot; rad += 3.5) {
    for (let k = 0; k < 10 && !spot; k++) {
      const a = Math.atan2(-hq.z, -hq.x) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.62;
      const cp = await s.call('can_place', { fid: 0, btype: 'lab', x: hq.x + Math.cos(a) * rad, z: hq.z + Math.sin(a) * rad });
      if (cp.place && cp.afford) spot = { x: hq.x + Math.cos(a) * rad, z: hq.z + Math.sin(a) * rad };
    }
  }
  ok(!!spot, 'server-side can_place found a site');
  r = await s.call('build', { fid: 0, btype: 'lab', x: spot.x, z: spot.z, builders: workers.slice(0, 1) });
  ok(r.ok && Number.isInteger(r.bid) && typeof r.id === 'number' && r.bid !== r.id,
    `envelope id (${r.id}) and site bid (${r.bid}) stay distinct`);

  // second new_game in the same process must reproduce ids (NEXT_SID reset)
  const a = await s.call('new_game', { seed: 5, allAI: true });
  const b = await s.call('new_game', { seed: 5, allAI: true });
  ok(JSON.stringify(a.state) === JSON.stringify(b.state), 'same-process new_game is id-stable');

  // a full AI-vs-AI race runs to a verdict
  r = await s.call('step', { until_over: true, max_seconds: 1800 });
  ok(r.ok && r.over && r.over.winner !== undefined, `until_over reaches a verdict (winner ${r.over?.winner} @ ${r.time}s)`);
  ok(r.events === undefined, 'until_over defaults to no event flood');
  s.close();
}

// --- Test 4: determinism through the full stack ---------------------------------
console.log('\n[4] Determinism: same seed + same command schedule → identical state');
{
  async function run() {
    const s = startServer();
    await s.ready;
    const ng = await s.call('new_game', { seed: 123, faction: 0 });
    const ids = ng.state.units.filter(u => u.fid === 0).map(u => u.id);
    await s.call('gather', { fid: 0, ids, node: ng.state.nodes[1].id });
    await s.call('step', { seconds: 45, events: false });
    await s.call('train', { fid: 0, bid: ng.state.factions[0].hq, utype: 'researcher' });
    await s.call('step', { seconds: 45, events: false });
    const st = (await s.call('state')).state;
    s.close();
    return JSON.stringify(st);
  }
  const [x, y] = [await run(), await run()];
  ok(x === y, `two processes agree byte-for-byte (${x.length} chars of state)`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll bridge checks passed.');
process.exit(failures ? 1 : 0);
