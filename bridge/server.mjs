#!/usr/bin/env node
// ============================================================================
// Headless bridge server — drives the deterministic sim over JSON Lines on
// stdio. This is the process the Python SDK (python/asirace) spawns.
//
//   node bridge/server.mjs
//
// One line in → one line out, matched by `id`. The controller owns time:
// nothing advances until a `step` request, so an external agent can think as
// long as it likes between ticks and every run is exactly reproducible from
// (seed, command schedule). Lifecycle ops live here; every game op is
// delegated to js/bridge/protocol.js, the same dispatch the browser live
// bridge uses.
// ============================================================================
import { createInterface } from 'node:readline';
import { createGame } from '../js/sim/world.js';
import { stepGame } from '../js/sim/sim.js';
import { TUNE, DIFFICULTY } from '../js/sim/constants.js';
import { applyCommand, snapshot, observe, metaInfo, PROTOCOL_VERSION } from '../js/bridge/protocol.js';

const MAX_EVENTS = 20000;      // per step response, oldest dropped first
const MAX_STEP_SECONDS = 7200; // hard cap for a single step/until_over call

let game = null;

const R2 = (v) => Math.round(v * 100) / 100;
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

function opNewGame(msg) {
  const seed = Number.isFinite(msg.seed) ? msg.seed | 0 : (Date.now() % 1e9) | 0;
  const faction = msg.faction == null ? 0 : msg.faction;
  if (!Number.isInteger(faction) || faction < 0 || faction > 3) return { ok: false, error: 'faction must be 0-3' };
  const difficulty = msg.difficulty || 'normal';
  if (!DIFFICULTY[difficulty]) return { ok: false, error: `unknown difficulty '${difficulty}'` };
  const allAI = !!msg.allAI;

  game = createGame({ playerFaction: faction, seed, difficulty, allAI });
  // Factions handed to external control: built-in AI off, human income rules.
  const control = Array.isArray(msg.control) ? msg.control : (allAI ? [] : [faction]);
  for (const c of control) {
    if (!Number.isInteger(c) || c < 0 || c > 3) return { ok: false, error: 'control entries must be 0-3' };
    game.factions[c].isAI = false;
    game.factions[c].ai = null;
  }
  return { ok: true, protocol: PROTOCOL_VERSION, meta: metaInfo(), state: snapshot(game) };
}

function opStep(msg) {
  if (!game) return { ok: false, error: 'no game — call new_game first' };
  const untilOver = !!msg.until_over;
  let ticks;
  if (untilOver) ticks = Math.round(Math.min(MAX_STEP_SECONDS, msg.max_seconds ?? 3600) / TUNE.tick);
  else if (msg.seconds != null) ticks = Math.round(Math.min(MAX_STEP_SECONDS, msg.seconds) / TUNE.tick);
  else ticks = msg.ticks == null ? 1 : msg.ticks;
  if (!Number.isInteger(ticks) || ticks < 0 || ticks > MAX_STEP_SECONDS / TUNE.tick) {
    return { ok: false, error: `ticks must be an integer in [0, ${MAX_STEP_SECONDS / TUNE.tick}]` };
  }

  // until_over runs skip event collection by default (they'd be enormous)
  const collect = untilOver ? msg.events === true : msg.events !== false;
  const events = [];
  let dropped = 0, steps = 0;
  for (; steps < ticks && !game.over; steps++) {
    stepGame(game, TUNE.tick);
    if (collect) {
      for (const ev of game.events) events.push(ev);
      if (events.length > MAX_EVENTS * 2) { // keep the newest — endgames matter most
        dropped += events.length - MAX_EVENTS;
        events.splice(0, events.length - MAX_EVENTS);
      }
    }
    game.events.length = 0;
  }
  if (events.length > MAX_EVENTS) {
    dropped += events.length - MAX_EVENTS;
    events.splice(0, events.length - MAX_EVENTS);
  }

  const res = { ok: true, time: R2(game.time), steps, over: game.over ? { ...game.over } : null };
  if (collect) { res.events = events; if (dropped) res.eventsDropped = dropped; }
  if (msg.state) res.state = snapshot(game);
  if (msg.observe != null) res.obs = observe(game, msg.observe) || undefined;
  return res;
}

function handle(msg) {
  switch (msg.op) {
    case 'hello': return { ok: true, protocol: PROTOCOL_VERSION, node: process.version };
    case 'new_game': return opNewGame(msg);
    case 'step': return opStep(msg);
    case 'quit': send({ id: msg.id, ok: true, bye: true }); process.exit(0); return;
    default:
      if (!game) return { ok: false, error: 'no game — call new_game first' };
      return applyCommand(game, msg);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { send({ ok: false, error: 'bad json' }); return; }
  let res;
  try { res = handle(msg); } catch (e) { res = { ok: false, error: `internal: ${e && e.stack || e}` }; }
  if (res) send(msg.id === undefined ? res : { ...res, id: msg.id }); // envelope id wins any payload key
});
rl.on('close', () => process.exit(0));

// greeting line — the SDK blocks on this to know the server is up
send({ ready: true, protocol: PROTOCOL_VERSION, node: process.version });
