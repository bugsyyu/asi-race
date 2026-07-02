// ============================================================================
// Buildings — procedural architecture per type, plus neutral map structures.
// Each factory returns { group, ...api }. All geometry authored in code;
// emissive window textures are drawn on canvases (picked up by bloom).
// ============================================================================
import * as THREE from 'three';

const texCache = new Map();
function windowTex(hex, litChance = 0.55) {
  const key = hex + '|' + litChance;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#07070d'; g.fillRect(0, 0, 128, 128);
  const col = '#' + hex.toString(16).padStart(6, '0');
  for (let y = 8; y < 120; y += 14) for (let x = 6; x < 122; x += 10) {
    if (Math.random() < litChance) {
      g.fillStyle = col; g.globalAlpha = 0.55 + Math.random() * 0.45;
      g.fillRect(x, y, 6, 8);
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

const M = {
  concrete: (tint = 0x3a3d52) => new THREE.MeshStandardMaterial({ color: tint, roughness: 0.9, metalness: 0.05 }),
  dark:     () => new THREE.MeshStandardMaterial({ color: 0x23253a, roughness: 0.85 }),
  metal:    () => new THREE.MeshStandardMaterial({ color: 0x596180, roughness: 0.4, metalness: 0.7 }),
  glow:     (hex, i = 1.6) => new THREE.MeshStandardMaterial({ color: 0x0a0a12, emissive: hex, emissiveIntensity: i, roughness: 0.6 }),
  glass:    (hex) => new THREE.MeshStandardMaterial({
    color: 0x0d0f1c, roughness: 0.35, metalness: 0.2,
    emissive: 0xffffff, emissiveIntensity: 0.9, emissiveMap: windowTex(hex),
  }),
};

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Per-type cores. Each returns { core, spin[], lamps[] }.
// spin: meshes rotated in tick(). lamps: emissive mats pulsed gently.
// ---------------------------------------------------------------------------
function coreHQ(fdef) {
  const g = new THREE.Group(); const spin = [], lamps = [];
  const glass = M.glass(fdef.accent);
  g.add(box(9.5, 4.2, 7, glass, 0, 2.1, 0));
  g.add(box(5.5, 7.6, 5.5, glass, -2.4, 3.8, -0.5));
  g.add(box(10.3, 0.5, 7.8, M.concrete(), 0, 4.5, 0));
  g.add(box(6.1, 0.5, 6.1, M.concrete(), -2.4, 7.85, -0.5));
  // holo sign — faction glyph on a rooftop billboard
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.font = '100px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#' + fdef.accent.toString(16).padStart(6, '0');
  ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 18;
  ctx.fillText(fdef.glyph, 64, 70);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  sign.position.set(-2.4, 10.4, -0.5); g.add(sign); spin.push(sign);
  // antenna + beacon
  g.add(cyl(0.07, 0.1, 3.2, M.metal(), 3.4, 6.2, 2.2));
  const bMat = M.glow(fdef.color, 2.2); lamps.push(bMat);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), bMat);
  beacon.position.set(3.4, 7.9, 2.2); g.add(beacon);
  // entry canopy
  g.add(box(3, 0.3, 2.2, M.concrete(0x4a4060), 2.6, 1.6, 3.6));
  return { core: g, spin, lamps };
}

function coreDatacenter(fdef) {
  const g = new THREE.Group(); const spin = [], lamps = [];
  const vent = M.glow(fdef.accent, 1.3); lamps.push(vent);
  for (let i = -1; i <= 1; i++) {
    g.add(box(2.4, 2.6, 6.4, M.dark(), i * 2.7, 1.3, 0));
    const strip = box(2.42, 0.35, 6.0, vent, i * 2.7, 2.2, 0);
    strip.castShadow = false; g.add(strip);
  }
  g.add(box(8.6, 0.4, 7, M.concrete(), 0, 2.9, 0));
  for (const [x, z] of [[-2.6, 1.8], [0, -1.8], [2.6, 1.8]]) {
    const fan = new THREE.Group();
    fan.add(cyl(0.9, 0.9, 0.4, M.metal(), 0, 0, 0));
    for (let b = 0; b < 3; b++) {
      const blade = box(1.5, 0.06, 0.3, M.metal());
      blade.rotation.y = b * Math.PI / 1.5; fan.add(blade);
    }
    fan.position.set(x, 3.3, z); g.add(fan); spin.push(fan);
  }
  return { core: g, spin, lamps };
}

function coreLab(fdef) {
  const g = new THREE.Group(); const lamps = [];
  g.add(box(6.4, 3.4, 5.4, M.glass(fdef.accent), 0, 1.7, 0));
  g.add(box(7, 0.45, 6, M.concrete(), 0, 3.6, 0));
  const sky = M.glow(fdef.accent, 1.1); lamps.push(sky);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), sky);
  dome.position.set(-1.2, 3.8, 0); dome.castShadow = false; g.add(dome);
  g.add(cyl(0.5, 0.7, 2.6, M.metal(), 2.3, 4.6, -1.6));
  return { core: g, spin: [], lamps };
}

function coreInstitute() {
  const g = new THREE.Group(); const lamps = [];
  g.add(cyl(2.9, 3.3, 2.6, M.concrete(0x3b4452), 0, 1.3, 0, 18));
  const calm = M.glow(0x7ddf9a, 1.5); lamps.push(calm);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.3, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), calm);
  dome.position.y = 2.6; dome.castShadow = false; g.add(dome);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    g.add(cyl(0.18, 0.18, 2.4, M.concrete(0x50596b), Math.cos(a) * 3.5, 1.2, Math.sin(a) * 3.5, 8));
  }
  g.add(cyl(3.9, 3.9, 0.25, M.concrete(0x333b48), 0, 0.12, 0, 20));
  return { core: g, spin: [], lamps };
}

function coreSecoffice(fdef) {
  const g = new THREE.Group(); const spin = [], lamps = [];
  g.add(box(5.8, 2.2, 5.2, M.concrete(0x37343f), 0, 1.1, 0));
  g.add(box(6.2, 0.5, 5.6, M.dark(), 0, 2.45, 0));
  const slit = M.glow(fdef.color, 1.6); lamps.push(slit);
  const s = box(5.9, 0.22, 0.1, slit, 0, 1.7, 2.62); s.castShadow = false; g.add(s);
  const dish = new THREE.Group();
  const d = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), M.metal());
  d.rotation.x = Math.PI / 2.4; dish.add(d);
  dish.add(cyl(0.09, 0.12, 1.1, M.metal(), 0, -0.6, 0, 8));
  dish.position.set(1.7, 3.4, -1.4); g.add(dish); spin.push(dish);
  g.add(box(1.4, 1.6, 0.4, M.dark(), -1.6, 0.8, 2.7));
  return { core: g, spin, lamps };
}

function corePolicy() {
  const g = new THREE.Group(); const lamps = [];
  g.add(box(5.6, 0.5, 4.6, M.concrete(0x4a4458), 0, 0.25, 0));
  for (const x of [-2.2, -0.75, 0.75, 2.2]) g.add(cyl(0.24, 0.28, 2.4, M.concrete(0x6b6478), x, 1.7, 1.9, 10));
  g.add(box(5.2, 2.4, 3.4, M.glass(0xd9c9a5), 0, 1.7, -0.4));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.9, 1.5, 4), M.concrete(0x554e63));
  roof.rotation.y = Math.PI / 4; roof.position.y = 3.6; roof.castShadow = true; g.add(roof);
  const flag = M.glow(0xffcf6e, 1.4); lamps.push(flag);
  const fm = box(0.9, 0.55, 0.05, flag, 0.45, 5.2, 0); fm.castShadow = false;
  g.add(cyl(0.05, 0.05, 2.2, M.metal(), 0, 4.6, 0, 6), fm);
  return { core: g, spin: [], lamps };
}

function coreTower(fdef) {
  const g = new THREE.Group(); const spin = [], lamps = [];
  g.add(cyl(0.75, 1.25, 5.4, M.concrete(0x3d4157), 0, 2.7, 0, 10));
  const ring = M.glow(fdef.color, 2.0); lamps.push(ring);
  const r = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.12, 8, 20), ring);
  r.rotation.x = Math.PI / 2; r.position.y = 4.4; r.castShadow = false; g.add(r);
  const head = new THREE.Group();
  head.add(box(1.5, 0.8, 1.5, M.metal(), 0, 0, 0));
  head.add(cyl(0.09, 0.13, 1.6, M.dark(), 0, 0.1, 1.0, 8));
  head.children[1].rotation.x = Math.PI / 2;
  head.position.y = 5.8; g.add(head); spin.push(head);
  return { core: g, spin, lamps };
}

const CORES = {
  hq: coreHQ, datacenter: coreDatacenter, lab: coreLab,
  institute: () => coreInstitute(), secoffice: coreSecoffice,
  policy: () => corePolicy(), tower: coreTower,
};

// ---------------------------------------------------------------------------
// makeBuilding(type, factionDef, fp) → { group, setProgress, setAlarm, tick }
// ---------------------------------------------------------------------------
export function makeBuilding(type, fdef, fp) {
  const group = new THREE.Group();

  // faction ground pad — readability from the air
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(fp + 0.8, 26),
    new THREE.MeshStandardMaterial({ color: fdef.color, roughness: 1, transparent: true, opacity: 0.16 })
  );
  pad.rotation.x = -Math.PI / 2; pad.position.y = 0.06; pad.receiveShadow = true;
  group.add(pad);
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(fp + 0.55, fp + 0.8, 30),
    new THREE.MeshBasicMaterial({ color: fdef.accent, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  rim.rotation.x = -Math.PI / 2; rim.position.y = 0.07; group.add(rim);

  const { core, spin, lamps } = CORES[type](fdef);
  group.add(core);

  // construction scaffold — corner poles + top frame, hidden when done
  const scaffold = new THREE.Group();
  const sMat = new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.8 });
  const s = fp * 0.85;
  for (const [x, z] of [[-s, -s], [s, -s], [-s, s], [s, s]]) scaffold.add(cyl(0.09, 0.09, 6.5, sMat, x, 3.25, z, 6));
  for (const [a, b] of [[[-s, -s], [s, -s]], [[s, -s], [s, s]], [[s, s], [-s, s]], [[-s, s], [-s, -s]]]) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const beam = box(len, 0.09, 0.09, sMat, (a[0] + b[0]) / 2, 6.4, (a[1] + b[1]) / 2);
    beam.rotation.y = Math.atan2(b[1] - a[1], b[0] - a[0]);
    scaffold.add(beam);
  }
  const crane = cyl(0.07, 0.07, 4.5, sMat, s, 8.4, s, 6);
  crane.rotation.z = Math.PI / 2.6; scaffold.add(crane);
  group.add(scaffold);

  // alarm beacon (incident / disabled)
  const alarmMat = new THREE.MeshStandardMaterial({ color: 0x1a0808, emissive: 0xff2222, emissiveIntensity: 0 });
  const alarm = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), alarmMat);
  alarm.position.y = 0.4; alarm.visible = false; group.add(alarm);

  let progress = -1, alarmOn = false;
  function setProgress(p) {
    if (p === progress) return;
    progress = p;
    const sc = 0.12 + 0.88 * p;
    core.scale.set(1, sc, 1);
    scaffold.visible = p < 1;
    alarm.position.y = 7 * sc + 0.6;
    for (const l of lamps) l.emissiveIntensity = p < 1 ? 0.15 : (l.userData.base ?? (l.userData.base = l.emissiveIntensity));
  }
  function setAlarm(on) {
    alarmOn = on; alarm.visible = on;
    for (const l of lamps) if (l.userData.base) l.emissiveIntensity = on ? 0.1 : l.userData.base;
  }
  function tick(dt, time) {
    const rate = type === 'datacenter' ? 7 : 0.7;
    for (const m of spin) m.rotation.y += dt * rate;
    if (alarmOn) alarmMat.emissiveIntensity = 1.5 + Math.sin(time * 9) * 1.4;
    else if (lamps[0] && progress >= 1) {
      const b = lamps[0].userData.base || 1.5;
      lamps[0].emissiveIntensity = b * (0.9 + 0.1 * Math.sin(time * 2.1));
    }
  }
  setProgress(0);
  return { group, setProgress, setAlarm, tick };
}

// ---------------------------------------------------------------------------
// Neutral structures
// ---------------------------------------------------------------------------
export function makeNode() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0e2030, roughness: 0.25, metalness: 0.1,
    emissive: 0x59c8ff, emissiveIntensity: 1.35, flatShading: true,
  });
  const shards = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2 + 0.4;
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 + (i % 3) * 0.22, 0), mat);
    s.position.set(Math.cos(a) * (i ? 1.15 : 0), 0.5 + (i % 2) * 0.5, Math.sin(a) * (i ? 1.15 : 0));
    s.rotation.set(i, i * 1.7, i * 0.6);
    s.scale.y = 1.9; s.castShadow = true;
    shards.add(s);
  }
  group.add(shards);
  const base = new THREE.Mesh(new THREE.CircleGeometry(2.6, 20),
    new THREE.MeshBasicMaterial({ color: 0x59c8ff, transparent: true, opacity: 0.12 }));
  base.rotation.x = -Math.PI / 2; base.position.y = 0.05; group.add(base);
  function setAmount(frac) { shards.scale.setScalar(0.35 + 0.65 * Math.max(0, frac)); }
  function tick(dt) { shards.rotation.y += dt * 0.25; }
  return { group, setAmount, tick };
}

export function makeCluster() {
  const group = new THREE.Group();
  group.add(cyl(6.4, 6.8, 0.5, M.concrete(0x2e3348), 0, 0.25, 0, 24));
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + Math.PI / 4;
    const rack = box(1.6, 2.6, 1.1, M.dark(), Math.cos(a) * 3.4, 1.8, Math.sin(a) * 3.4);
    rack.lookAt(0, 1.8, 0);
    group.add(rack);
  }
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x0a0a12, emissive: 0x8a93ff, emissiveIntensity: 0.7 });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), coreMat);
  core.position.y = 2.6; group.add(core);
  // ownership banner light
  const ownMat = new THREE.MeshStandardMaterial({ color: 0x0a0a12, emissive: 0x666a80, emissiveIntensity: 1.2 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.16, 8, 40), ownMat);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.55; ring.castShadow = false; group.add(ring);
  // capture progress arc
  const arcMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  let arc = null;
  function setOwner(hex) { ownMat.emissive.setHex(hex ?? 0x666a80); ownMat.emissiveIntensity = hex ? 2.0 : 1.2; }
  function setCapture(frac, hex) {
    if (arc) { group.remove(arc); arc.geometry.dispose(); arc = null; }
    if (frac > 0.02) {
      arc = new THREE.Mesh(new THREE.RingGeometry(6.0, 6.5, 40, 1, 0, frac * Math.PI * 2), arcMat);
      arcMat.color.setHex(hex ?? 0xffffff);
      arc.rotation.x = -Math.PI / 2; arc.position.y = 0.6;
      group.add(arc);
    }
  }
  function tick(dt) { core.rotation.y += dt * 0.9; core.position.y = 2.6 + Math.sin(performance.now() / 700) * 0.12; }
  return { group, setOwner, setCapture, tick };
}

export function makeCapitol() {
  const group = new THREE.Group();
  group.add(cyl(9.5, 10.5, 1.2, M.concrete(0x4a4a58), 0, 0.6, 0, 28));
  group.add(cyl(6.5, 7, 1.0, M.concrete(0x565666), 0, 1.7, 0, 24));
  const hall = box(9, 3.4, 6, M.concrete(0x6a6577), 0, 3.9, 0);
  group.add(hall);
  for (let i = -3; i <= 3; i++) group.add(cyl(0.3, 0.34, 3.2, M.concrete(0x8a8496), i * 1.25, 3.9, 3.25, 10));
  group.add(box(10, 0.7, 7, M.concrete(0x565666), 0, 5.9, 0));
  const domeMat = new THREE.MeshStandardMaterial({ color: 0x8f8aa0, roughness: 0.5, metalness: 0.25 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.7, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.position.y = 6.2; dome.castShadow = true; group.add(dome);
  const lampMat = M.glow(0xffe9c4, 2.4);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), lampMat);
  lamp.position.y = 9.6; group.add(lamp);
  group.add(cyl(0.07, 0.07, 1.6, M.metal(), 0, 8.9, 0, 6));
  const glow = new THREE.PointLight(0xffd9a0, 14, 34, 1.8);
  glow.position.y = 7; group.add(glow);
  return { group, tick: () => {} };
}
