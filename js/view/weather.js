// ============================================================================
// Dynamic weather — pure view-layer ambience, the sim never reads it.
// A state machine drifts between clear / cloudy / rain: cloud shadows sweep
// the field on a terrain-conforming sheet, showers dim the key light behind
// a falling rain veil, then the sun comes back. All randomness is local
// (Math.random), so determinism of the simulation is untouched.
// ============================================================================
import * as THREE from 'three';
import { TUNE } from '../sim/constants.js';
import { THEME } from './theme.js';
import { sampleGroundY } from './terrain.js';

function cloudAlphaTex() {
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  // soft cumulus blobs, drawn wrapping so the tiling never shows a seam
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 14 + Math.random() * 44;
    const a = 0.25 + Math.random() * 0.5;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      const gr = g.createRadialGradient(x + ox, y + oy, r * 0.15, x + ox, y + oy, r);
      gr.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(x + ox, y + oy, r, 0, Math.PI * 2); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function createWeather(scene, rig, lights) {
  const W = THEME.weather || { rainChance: 0.35, cloudTint: 1 };

  // ---- drifting cloud shadows on a terrain-conforming sheet ----
  const size = TUNE.mapSize + 80;
  const sheetGeo = new THREE.PlaneGeometry(size, size, 72, 72);
  sheetGeo.rotateX(-Math.PI / 2);
  const sp = sheetGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) sp.setY(i, sampleGroundY(sp.getX(i), sp.getZ(i)) + 0.34);
  const cloudTex = cloudAlphaTex();
  cloudTex.repeat.set(2.2, 2.2);
  const sheetMat = new THREE.MeshBasicMaterial({
    color: 0x061018, alphaMap: cloudTex, transparent: true, opacity: 0, depthWrite: false,
  });
  const sheet = new THREE.Mesh(sheetGeo, sheetMat);
  sheet.renderOrder = 1;
  scene.add(sheet);

  // ---- rain veil: line streaks falling around the camera target ----
  const N = 420, FALL = 27, BOX = 46, TOP = 26;
  const drops = [];
  for (let i = 0; i < N; i++) {
    drops.push({
      x: (Math.random() - 0.5) * BOX * 2,
      z: (Math.random() - 0.5) * BOX * 2,
      y: Math.random() * TOP,
      s: FALL * (0.85 + Math.random() * 0.3),
    });
  }
  const rainPos = new Float32Array(N * 6);
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: 0xa9c2d6, transparent: true, opacity: 0 });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.visible = false;
  scene.add(rain);

  // ---- state machine ----
  const STATES = {
    clear:  { cloud: 0.14, sun: 1.0,  hemi: 1.0,  fog: 1.0,  rain: 0 },
    cloudy: { cloud: 0.44, sun: 0.72, hemi: 0.86, fog: 0.93, rain: 0 },
    rain:   { cloud: 0.58, sun: 0.48, hemi: 0.72, fog: 0.8,  rain: 0.5 },
  };
  let state = 'clear';
  let t = 0, dur = 45 + Math.random() * 40;
  const cur = { ...STATES.clear };
  const baseSun = lights.sun.intensity, baseHemi = lights.hemi.intensity;
  const baseNear = scene.fog.near, baseFar = scene.fog.far;
  const windX = 0.008 + Math.random() * 0.005, windY = 0.004 + Math.random() * 0.004;

  function pick() {
    if (state === 'clear') state = 'cloudy';
    else if (state === 'cloudy') state = Math.random() < W.rainChance ? 'rain' : 'clear';
    else state = 'cloudy';
    dur = state === 'clear' ? 50 + Math.random() * 45
      : state === 'cloudy' ? 28 + Math.random() * 28
      : 22 + Math.random() * 26;
  }
  // debug / screenshot hook: pin a state (snaps, no ease)
  function force(s) { if (STATES[s]) { state = s; t = 0; dur = 1e9; Object.assign(cur, STATES[s]); } }

  function update(dt) {
    t += dt;
    if (t > dur) { t = 0; pick(); }
    const tgt = STATES[state];
    const k = Math.min(1, dt / 4.5);      // ~4.5s ease between states
    for (const key in cur) cur[key] += (tgt[key] - cur[key]) * k;

    cloudTex.offset.x += windX * dt;
    cloudTex.offset.y += windY * dt;
    sheetMat.opacity = cur.cloud * W.cloudTint;

    lights.sun.intensity = baseSun * cur.sun;
    lights.hemi.intensity = baseHemi * cur.hemi;
    scene.fog.near = baseNear * cur.fog;
    scene.fog.far = baseFar * cur.fog;

    rainMat.opacity = cur.rain;
    rain.visible = cur.rain > 0.02;
    if (rain.visible) {
      rain.position.set(rig.position.x, sampleGroundY(rig.position.x, rig.position.z), rig.position.z);
      for (let i = 0; i < N; i++) {
        const d = drops[i];
        d.y -= d.s * dt;
        if (d.y < 0) {
          d.y += TOP;
          d.x = (Math.random() - 0.5) * BOX * 2;
          d.z = (Math.random() - 0.5) * BOX * 2;
        }
        const o = i * 6;
        rainPos[o] = d.x; rainPos[o + 1] = d.y; rainPos[o + 2] = d.z;
        rainPos[o + 3] = d.x + 0.16; rainPos[o + 4] = d.y + 0.6; rainPos[o + 5] = d.z;
      }
      rainGeo.attributes.position.needsUpdate = true;
    }
  }

  return { update, force, get state() { return state; } };
}
