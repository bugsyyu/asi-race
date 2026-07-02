// ============================================================================
// Audio — everything synthesized live in WebAudio. No files, no network.
// One AudioContext, unlocked on the first user gesture (the start screen).
// ============================================================================
let ctx = null, master = null, musicBus = null, sfxBus = null;
let muted = false, musicTimer = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = 0.16; musicBus.connect(master); // quiet underneath
  startMusic();
}

export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.9; }
export function isMuted() { return muted; }

const now = () => ctx.currentTime;

// pan by screen x (0..1) so battles read spatially
function panner(x = 0.5) {
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  if (p.pan) p.pan.value = Math.max(-1, Math.min(1, (x - 0.5) * 1.6));
  return p;
}

function env(node, t0, a, peak, d, end = 0.0001) {
  node.gain.setValueAtTime(0.0001, t0);
  node.gain.linearRampToValueAtTime(peak, t0 + a);
  node.gain.exponentialRampToValueAtTime(end, t0 + a + d);
}

function blip({ type = 'sine', f0 = 440, f1 = f0, a = 0.004, d = 0.12, vol = 0.5, x = 0.5, t0 = 0 }) {
  const t = now() + t0;
  const o = ctx.createOscillator(), g = ctx.createGain(), p = panner(x);
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + a + d);
  env(g, t, a, vol, d);
  o.connect(g).connect(p).connect(sfxBus);
  o.start(t); o.stop(t + a + d + 0.05);
}

function noise({ dur = 0.3, vol = 0.4, x = 0.5, hp = 200, lp = 6000, t0 = 0, decay = true }) {
  const t = now() + t0;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (decay ? 1 - i / len : 1);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const g = ctx.createGain(); g.gain.value = vol;
  const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp;
  const l = ctx.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = lp;
  const p = panner(x);
  src.connect(h).connect(l).connect(g).connect(p).connect(sfxBus);
  src.start(t);
}

// ---------------------------------------------------------------------------
// The SFX palette. x = screen position 0..1 for panning.
// ---------------------------------------------------------------------------
export const sfx = {
  click:    (x) => { if (!ctx || muted) return; blip({ type: 'square', f0: 1400, f1: 900, d: 0.05, vol: 0.12, x }); },
  select:   (x) => { if (!ctx || muted) return; blip({ type: 'sine', f0: 660, f1: 880, d: 0.07, vol: 0.14, x }); },
  order:    (x) => { if (!ctx || muted) return; blip({ type: 'sine', f0: 520, f1: 700, d: 0.06, vol: 0.13, x }); blip({ type: 'sine', f0: 780, d: 0.05, vol: 0.09, x, t0: 0.05 }); },
  thunk:    (x) => { if (!ctx || muted) return; blip({ type: 'sine', f0: 190, f1: 60, d: 0.16, vol: 0.5, x }); noise({ dur: 0.09, vol: 0.16, hp: 90, lp: 900, x }); },
  hammer:   (x) => { if (!ctx || muted) return; blip({ type: 'triangle', f0: 320 + Math.random() * 160, f1: 120, d: 0.07, vol: 0.14, x }); },
  complete: (x) => { if (!ctx || muted) return; [523, 659, 784].forEach((f, i) => blip({ type: 'triangle', f0: f, d: 0.22, vol: 0.16, x, t0: i * 0.07 })); },
  train:    (x) => { if (!ctx || muted) return; blip({ type: 'triangle', f0: 440, f1: 660, d: 0.14, vol: 0.16, x }); },
  zap:      (x) => { if (!ctx || muted) return; blip({ type: 'sawtooth', f0: 1900, f1: 300, d: 0.09, vol: 0.14, x }); noise({ dur: 0.05, vol: 0.08, hp: 2500, x }); },
  laser:    (x) => { if (!ctx || muted) return; blip({ type: 'square', f0: 980, f1: 240, d: 0.12, vol: 0.11, x }); },
  melee:    (x) => { if (!ctx || muted) return; noise({ dur: 0.07, vol: 0.2, hp: 500, lp: 3000, x }); blip({ type: 'square', f0: 240, f1: 90, d: 0.06, vol: 0.14, x }); },
  die:      (x) => { if (!ctx || muted) return; blip({ type: 'sawtooth', f0: 300, f1: 55, d: 0.3, vol: 0.2, x }); },
  explode:  (x) => { if (!ctx || muted) return; noise({ dur: 0.7, vol: 0.5, hp: 40, lp: 1600, x }); blip({ type: 'sine', f0: 110, f1: 30, d: 0.55, vol: 0.55, x }); },
  alert:    ()  => { if (!ctx || muted) return; [0, 0.18].forEach(t0 => blip({ type: 'square', f0: 740, f1: 740, d: 0.12, vol: 0.16, t0 })); },
  bad:      ()  => { if (!ctx || muted) return; blip({ type: 'sawtooth', f0: 220, f1: 140, d: 0.4, vol: 0.2 }); },
  gen:      ()  => { if (!ctx || muted) return; [392, 494, 587, 784].forEach((f, i) => blip({ type: 'triangle', f0: f, d: 0.3, vol: 0.15, t0: i * 0.09 })); },
  policy:   (x) => { if (!ctx || muted) return; blip({ type: 'sine', f0: 880, f1: 1320, d: 0.2, vol: 0.13, x }); },
  capture:  (x) => { if (!ctx || muted) return; [330, 415, 494].forEach((f, i) => blip({ type: 'sine', f0: f, d: 0.18, vol: 0.14, x, t0: i * 0.06 })); },
  deposit:  (x) => { if (!ctx || muted) return; blip({ type: 'sine', f0: 1180, f1: 1560, d: 0.05, vol: 0.09, x }); },
  riser:    ()  => { if (!ctx || muted) return; const t = now(); const o = ctx.createOscillator(), g = ctx.createGain();
                     o.type = 'sawtooth'; o.frequency.setValueAtTime(80, t); o.frequency.exponentialRampToValueAtTime(640, t + 2.4);
                     env(g, t, 0.4, 0.12, 2.2); o.connect(g).connect(sfxBus); o.start(t); o.stop(t + 2.8); },
  fanfare:  ()  => { if (!ctx || muted) return; [523, 659, 784, 1046, 784, 1046].forEach((f, i) => blip({ type: 'triangle', f0: f, d: 0.35, vol: 0.2, t0: i * 0.13 })); },
  doom:     ()  => { if (!ctx || muted) return; [196, 185, 165, 147].forEach((f, i) => blip({ type: 'sawtooth', f0: f, d: 0.7, vol: 0.17, t0: i * 0.3 })); },
};

// ---------------------------------------------------------------------------
// Music — a slow generative loop. Detuned saw pad on Am–F–C–G, sparse
// pentatonic plucks on top. Sits far under the SFX.
// ---------------------------------------------------------------------------
const CHORDS = [
  [220.0, 261.63, 329.63],  // Am
  [174.61, 220.0, 261.63],  // F
  [130.81, 196.0, 261.63],  // C
  [196.0, 246.94, 293.66],  // G
];
const PLUCK = [440, 523.25, 587.33, 659.25, 783.99, 880];
let bar = 0;

function pad(freqs, t0, dur) {
  for (const f of freqs) for (const det of [-4, 3]) {
    const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(500, t0); lp.frequency.linearRampToValueAtTime(900, t0 + dur * 0.5); lp.frequency.linearRampToValueAtTime(420, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.05, t0 + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    o.connect(lp).connect(g).connect(musicBus);
    o.start(t0); o.stop(t0 + dur + 0.1);
  }
}

function pluck(t0) {
  const f = PLUCK[Math.floor(Math.random() * PLUCK.length)];
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.value = f;
  env(g, t0, 0.01, 0.045, 1.4);
  o.connect(g).connect(musicBus); o.start(t0); o.stop(t0 + 1.6);
}

function startMusic() {
  const BAR = 4.8;
  const schedule = () => {
    if (!ctx) return;
    const t0 = now() + 0.08;
    pad(CHORDS[bar % 4], t0, BAR + 0.4);
    if (Math.random() < 0.75) pluck(t0 + 0.6 + Math.random() * (BAR - 1.6));
    if (Math.random() < 0.4) pluck(t0 + 0.6 + Math.random() * (BAR - 1.6));
    bar++;
  };
  schedule();
  musicTimer = setInterval(schedule, 4800);
}

// Tension layer: call when the endgame begins — adds a low pulsing drone.
let droneNodes = null;
export function setTension(on) {
  if (!ctx || (on && droneNodes)) return;
  if (on) {
    const o = ctx.createOscillator(), g = ctx.createGain(), l = ctx.createOscillator(), lg = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = 55;
    l.frequency.value = 0.9; lg.gain.value = 0.02;
    l.connect(lg).connect(g.gain);
    g.gain.value = 0.05;
    o.connect(g).connect(musicBus);
    o.start(); l.start();
    droneNodes = [o, l];
  } else if (droneNodes) {
    for (const n of droneNodes) { try { n.stop(); } catch (e) { /* already stopped */ } }
    droneNodes = null;
  }
}
