// ============================================================================
// Live bridge — lets an external controller (python/asirace LiveGame) drive a
// RUNNING browser game over WebSocket. Enabled by a `?bridge=…` query param:
//
//   http://localhost:8000/?bridge=8765        → ws://localhost:8765
//   http://localhost:8000/?bridge=host:9000   → ws://host:9000
//   http://localhost:8000/?bridge=ws://…      → used as-is
//
// Role inversion on purpose: the PYTHON side is the WebSocket *server* (plain
// stdlib there — no pip installs), the page is the client and auto-reconnects
// every 2 s, so the Python script can be started or restarted at any moment.
//
// Game ops are the exact same protocol the headless server speaks (shared
// js/bridge/protocol.js); this file only adds the realtime concerns: event /
// state push subscriptions and a few UI courtesies (pause, speed, select,
// camera). `step` is refused — in live mode the browser owns the clock.
// ============================================================================
import { applyCommand, snapshot, observe, PROTOCOL_VERSION } from './protocol.js';

export function initLiveBridge(game, param, hooks = {}) {
  const url = /^wss?:\/\//.test(param) ? param
    : `ws://${String(param).includes(':') ? param : `localhost:${param}`}`;

  let ws = null, alive = false, stopped = false;
  const subs = { events: false, state: 0, fid: null, nextState: 0 };

  const send = (obj) => { if (alive) try { ws.send(JSON.stringify(obj)); } catch { /* peer vanished mid-send */ } };

  function handle(msg) {
    const id = msg.id;
    const reply = (r) => send(id === undefined ? r : { ...r, id }); // envelope id wins any payload key
    try {
      switch (msg.op) {
        case 'subscribe': {
          if (msg.events !== undefined) subs.events = !!msg.events;
          if (msg.state !== undefined) { subs.state = Math.max(0, Number(msg.state) || 0); subs.nextState = 0; }
          if (msg.fid !== undefined) subs.fid = msg.fid === null ? null : Number(msg.fid);
          reply({ ok: true, subs: { events: subs.events, state: subs.state, fid: subs.fid } });
          return;
        }
        case 'pause': hooks.pause?.(!!msg.on); reply({ ok: true, paused: !!msg.on }); return;
        case 'speed': { const x = Number(msg.x) === 2 ? 2 : 1; hooks.speed?.(x); reply({ ok: true, speed: x }); return; }
        case 'select': hooks.select?.(Array.isArray(msg.ids) ? msg.ids.map(Number) : []); reply({ ok: true }); return;
        case 'center': hooks.center?.(Number(msg.x) || 0, Number(msg.z) || 0); reply({ ok: true }); return;
        case 'new_game': case 'step':
          reply({ ok: false, error: 'live mode is realtime — the browser owns the clock' });
          return;
        case 'quit': reply({ ok: true, bye: true }); return; // python leaving; the game plays on
        default: reply(applyCommand(game, msg));
      }
    } catch (e) {
      reply({ ok: false, error: `internal: ${e && e.message || e}` });
    }
  }

  function connect() {
    if (stopped) return;
    ws = new WebSocket(url);
    ws.onopen = () => {
      alive = true;
      hooks.toast?.(`外部控制端已连接 ${url}`);
      send({ hello: true, live: true, protocol: PROTOCOL_VERSION, playerFaction: game.playerFaction });
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { send({ ok: false, error: 'bad json' }); return; }
      handle(msg);
    };
    ws.onclose = () => {
      if (alive) hooks.toast?.('外部控制端已断开 — 每 2 秒尝试重连');
      alive = false;
      if (!stopped) setTimeout(connect, 2000);
    };
    ws.onerror = () => { /* onclose follows with the retry */ };
  }
  connect();

  return {
    // frame loop hands over each tick batch of events BEFORE main.js clears it
    frame(events) {
      if (!alive) return;
      if (subs.events && events.length) send({ push: 'events', time: game.time, events });
      if (subs.state > 0 && game.time >= subs.nextState) {
        subs.nextState = game.time + subs.state;
        const st = subs.fid != null ? observe(game, subs.fid) : snapshot(game);
        send({ push: 'state', state: st, ui: hooks.ui?.() });
      }
    },
    stop() { stopped = true; try { ws?.close(); } catch { /* already gone */ } },
  };
}
