// ============================================================================
// Buildings — procedural architecture per type, plus neutral map structures.
// Each factory returns { group, ...api }. All geometry authored in code;
// emissive window textures are drawn on canvases (picked up by bloom).
// ============================================================================
import * as THREE from 'three';
import { THEME } from './theme.js';

const WHITE = new THREE.Color(0xffffff);
// theme lift: day mode pushes structural tones toward white campus stone
const lift = (hex, t) => (t > 0 ? new THREE.Color(hex).lerp(WHITE, t) : new THREE.Color(hex));

const texCache = new Map();
function windowTex(hex, litChance = 0.55) {
  const key = THEME.key + '|' + hex + '|' + litChance;
  if (texCache.has(key)) return texCache.get(key);
  const lit = litChance * THEME.mats.winLitScale;
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = THEME.mats.winBg; g.fillRect(0, 0, 256, 256);
  const col = '#' + hex.toString(16).padStart(6, '0');
  // floor slabs, then a fine curtain-wall window grid on top
  g.fillStyle = 'rgba(150,160,190,0.16)';
  for (let y = 0; y < 256; y += 26) g.fillRect(0, y, 256, 2);
  for (let y = 7; y < 250; y += 13) for (let x = 5; x < 250; x += 9) {
    if (Math.random() < lit) {
      g.fillStyle = col; g.globalAlpha = 0.4 + Math.random() * 0.6;
      g.fillRect(x, y, 5, 7);
      if (Math.random() < 0.18) {       // a few windows burn brighter — crunch time
        g.fillStyle = '#fff'; g.globalAlpha = 0.5;
        g.fillRect(x + 1, y + 1, 3, 5);
      }
    } else if (Math.random() < (THEME.mats.glassDay ? 0.55 : 0.3)) { // unlit panes
      g.fillStyle = THEME.mats.winDark; g.globalAlpha = 0.8;
      g.fillRect(x, y, 5, 7);
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

const M = {
  concrete: (tint = 0x3a3d52) => new THREE.MeshStandardMaterial({ color: lift(tint, THEME.mats.concreteLift), roughness: 0.9, metalness: 0.05 }),
  dark:     () => new THREE.MeshStandardMaterial({ color: lift(0x23253a, THEME.mats.darkLift), roughness: 0.85 }),
  metal:    () => new THREE.MeshStandardMaterial({ color: lift(0x596180, THEME.mats.metalLift), roughness: 0.4, metalness: 0.7 }),
  glow:     (hex, i = 1.6) => new THREE.MeshStandardMaterial({ color: 0x0a0a12, emissive: hex, emissiveIntensity: i, roughness: 0.6 }),
  glass:    (hex) => THEME.mats.glassDay
    // day: white curtain-wall panels with a dark window grid, sunlit
    ? new THREE.MeshStandardMaterial({ color: 0xf2f4f6, map: windowTex(hex), roughness: 0.5, metalness: 0.08 })
    // dusk: dark glass, windows burn through as emissive
    : new THREE.MeshStandardMaterial({
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
  const trim = M.concrete(0x4a4f6a);
  g.add(box(9.5, 4.2, 7, glass, 0, 2.1, 0));
  g.add(box(5.5, 7.6, 5.5, glass, -2.4, 3.8, -0.5));
  g.add(box(10.3, 0.5, 7.8, M.concrete(), 0, 4.5, 0));
  g.add(box(6.1, 0.5, 6.1, M.concrete(), -2.4, 7.85, -0.5));
  // slab edges between the glass floors, so the curtain wall reads as storeys
  g.add(box(9.7, 0.14, 7.2, trim, 0, 2.1, 0));
  g.add(box(5.7, 0.14, 5.7, trim, -2.4, 3.8, -0.5), box(5.7, 0.14, 5.7, trim, -2.4, 5.8, -0.5));
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
  // rooftop plant: AC units with fan wells, pipe run down the low block
  g.add(box(1.5, 0.8, 1.1, M.metal(), 1.6, 5.15, -1.8), box(1.1, 0.65, 0.9, M.metal(), 0.1, 5.05, -2.2));
  g.add(cyl(0.34, 0.34, 0.18, M.dark(), 1.6, 5.62, -1.8, 10), cyl(0.26, 0.26, 0.16, M.dark(), 0.1, 5.44, -2.2, 10));
  g.add(cyl(0.09, 0.09, 4.1, M.metal(), 4.85, 2.2, 1.0, 6));
  const elbow = cyl(0.09, 0.09, 1.4, M.metal(), 4.4, 4.32, 1.0, 6);
  elbow.rotation.z = Math.PI / 2;
  g.add(elbow);
  // rooftop dish watching the sky
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.65, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2.8), M.metal());
  dish.rotation.x = Math.PI / 1.9; dish.position.set(-4.2, 8.4, -1.8); g.add(dish);
  // entry canopy + glowing lobby doors
  g.add(box(3, 0.3, 2.2, M.concrete(0x4a4060), 2.6, 1.6, 3.6));
  const door = M.glow(0xffe2b8, 1.0); lamps.push(door);
  const dm = box(1.6, 1.3, 0.08, door, 2.6, 0.72, 3.52); dm.castShadow = false; g.add(dm);
  g.add(box(0.24, 1.5, 0.9, trim, 1.6, 0.75, 3.6), box(0.24, 1.5, 0.9, trim, 3.6, 0.75, 3.6));
  return { core: g, spin, lamps };
}

function coreDatacenter(fdef) {
  const g = new THREE.Group(); const spin = [], lamps = [];
  const vent = M.glow(fdef.accent, 1.3); lamps.push(vent);
  for (let i = -1; i <= 1; i++) {
    g.add(box(2.4, 2.6, 6.4, M.dark(), i * 2.7, 1.3, 0));
    const strip = box(2.42, 0.35, 6.0, vent, i * 2.7, 2.2, 0);
    strip.castShadow = false; g.add(strip);
    // rack door seams
    g.add(box(0.06, 2.0, 6.42, M.concrete(0x30344a), i * 2.7 - 1.16, 1.2, 0));
  }
  // roof slab trimmed to keep its corners inside fp + 0.7 (8.0×6.7: adjacent
  // datacenters at minimum spacing can no longer kiss corner-to-corner)
  g.add(box(8.0, 0.4, 6.7, M.concrete(), 0, 2.9, 0));
  // cable trays bridging the halls + heat stacks + transformer yard
  g.add(box(7.9, 0.12, 0.7, M.metal(), 0, 3.2, -2.4), box(7.9, 0.12, 0.7, M.metal(), 0, 3.2, 2.4));
  g.add(cyl(0.34, 0.42, 1.7, M.metal(), -3.5, 3.9, -2.2, 10), cyl(0.28, 0.34, 1.3, M.metal(), -2.4, 3.7, -2.5, 10));
  g.add(box(1.3, 1.0, 1.0, M.metal(), 3.0, 0.5, 2.6));
  g.add(cyl(0.09, 0.09, 0.55, M.dark(), 2.7, 1.25, 2.6, 6), cyl(0.09, 0.09, 0.55, M.dark(), 3.3, 1.25, 2.6, 6));
  // status LEDs blinking down the cold aisle
  const led = M.glow(0x7ddf9a, 1.6); lamps.push(led);
  for (let k = 0; k < 5; k++) {
    const dot = box(0.07, 0.07, 0.07, led, -1.35, 0.6 + k * 0.42, 3.21);
    dot.castShadow = false; g.add(dot);
  }
  for (const [x, z] of [[-2.6, 1.8], [0, -1.8], [2.6, 1.8]]) {
    const fan = new THREE.Group();
    fan.add(cyl(0.9, 0.9, 0.4, M.metal(), 0, 0, 0));
    for (let b = 0; b < 3; b++) {
      const blade = box(1.5, 0.06, 0.3, M.metal());
      blade.rotation.y = b * Math.PI / 1.5; fan.add(blade);
    }
    fan.position.set(x, 3.3, z); g.add(fan); spin.push(fan);
    g.add(cyl(1.05, 1.05, 0.22, M.concrete(0x3a3f56), x, 3.12, z, 12)); // fan shroud
  }
  return { core: g, spin, lamps };
}

function coreLab(fdef) {
  const g = new THREE.Group(); const lamps = [];
  g.add(box(6.4, 3.4, 5.4, M.glass(fdef.accent), 0, 1.7, 0));
  g.add(box(7, 0.45, 6, M.concrete(), 0, 3.6, 0));
  g.add(box(6.6, 0.14, 5.6, M.concrete(0x4a4f6a), 0, 1.7, 0)); // storey slab
  const sky = M.glow(fdef.accent, 1.1); lamps.push(sky);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), sky);
  dome.position.set(-1.2, 3.8, 0); dome.castShadow = false; g.add(dome);
  g.add(cyl(0.5, 0.7, 2.6, M.metal(), 2.3, 4.6, -1.6));
  // tilted solar array + coolant tank on a saddle + roof vents
  const panel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 1.5),
    new THREE.MeshStandardMaterial({ color: 0x18243c, roughness: 0.25, metalness: 0.5 }));
  panel.position.set(1.9, 4.15, 0.9); panel.rotation.z = -0.42; panel.castShadow = true;
  g.add(panel);
  g.add(box(2.5, 0.07, 0.09, M.metal(), 1.9, 4.14, 0.16), box(2.5, 0.07, 0.09, M.metal(), 1.9, 4.14, 1.62));
  const tank = cyl(0.42, 0.42, 1.7, M.metal(), -2.6, 4.06, -1.7, 10);
  tank.rotation.z = Math.PI / 2; g.add(tank);
  g.add(box(0.5, 0.24, 0.5, M.dark(), -1.6, 3.94, -1.7), box(0.5, 0.24, 0.5, M.dark(), -3.4, 3.94, -1.7));
  g.add(box(0.7, 0.4, 0.7, M.metal(), 0.4, 4.02, -2.0));
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
    g.add(cyl(0.24, 0.28, 0.18, M.concrete(0x424b5e), Math.cos(a) * 3.5, 2.44, Math.sin(a) * 3.5, 8)); // capitals
  }
  g.add(cyl(3.9, 3.9, 0.25, M.concrete(0x333b48), 0, 0.12, 0, 20));
  // inlaid meditation ring + reading benches + koi-pond skylight
  const inlay = new THREE.Mesh(new THREE.RingGeometry(3.0, 3.2, 36),
    new THREE.MeshBasicMaterial({ color: 0x7ddf9a, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  inlay.rotation.x = -Math.PI / 2; inlay.position.y = 0.26; g.add(inlay);
  g.add(box(1.1, 0.22, 0.4, M.concrete(0x50596b), 2.2, 0.36, 2.6), box(1.1, 0.22, 0.4, M.concrete(0x50596b), -2.6, 0.36, -2.3));
  const pond = new THREE.Mesh(new THREE.CircleGeometry(0.7, 14),
    new THREE.MeshStandardMaterial({ color: 0x24505c, roughness: 0.12, metalness: 0.4 }));
  pond.rotation.x = -Math.PI / 2; pond.position.set(-2.7, 0.27, 2.4); g.add(pond);
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
  // comms mast with crossbars, corner security cameras, entrance bollards
  g.add(cyl(0.06, 0.09, 2.6, M.metal(), -2.2, 3.9, 1.6, 6));
  g.add(box(0.9, 0.05, 0.05, M.metal(), -2.2, 4.6, 1.6), box(0.7, 0.05, 0.05, M.metal(), -2.2, 4.2, 1.6));
  const redEye = M.glow(0xff4444, 1.8); lamps.push(redEye);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), redEye);
  eye.position.set(-2.2, 5.24, 1.6); eye.castShadow = false; g.add(eye);
  for (const [cx, cz] of [[2.75, 2.45], [-2.75, -2.45]]) {
    const cam = box(0.26, 0.16, 0.34, M.dark(), cx, 2.34, cz);
    cam.rotation.y = Math.atan2(-cx, -cz) + Math.PI;
    cam.rotation.x = 0.35;
    g.add(cam);
  }
  g.add(box(0.28, 0.5, 0.28, M.metal(), -0.7, 0.25, 3.2), box(0.28, 0.5, 0.28, M.metal(), -2.5, 0.25, 3.2));
  return { core: g, spin, lamps };
}

function corePolicy() {
  const g = new THREE.Group(); const lamps = [];
  g.add(box(5.6, 0.5, 4.6, M.concrete(0x4a4458), 0, 0.25, 0));
  // ceremonial steps up to the portico + planters flanking them
  g.add(box(3.4, 0.22, 1.0, M.concrete(0x585065), 0, 0.11, 2.75));
  g.add(box(2.8, 0.2, 0.6, M.concrete(0x615a70), 0, 0.32, 2.5));
  for (const px of [-2.2, 2.2]) {
    g.add(box(0.7, 0.5, 0.7, M.concrete(0x3c3648), px, 0.35, 2.7));
    const bush = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.8, 7),
      new THREE.MeshStandardMaterial({ color: 0x2e4a44, roughness: 0.95 }));
    bush.position.set(px, 0.95, 2.7); bush.castShadow = true; g.add(bush);
  }
  for (const x of [-2.2, -0.75, 0.75, 2.2]) {
    g.add(cyl(0.24, 0.28, 2.4, M.concrete(0x6b6478), x, 1.7, 1.9, 10));
    g.add(box(0.56, 0.16, 0.56, M.concrete(0x7b7488), x, 2.98, 1.9)); // capitals
  }
  g.add(box(5.2, 2.4, 3.4, M.glass(0xd9c9a5), 0, 1.7, -0.4));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.9, 1.5, 4), M.concrete(0x554e63));
  roof.rotation.y = Math.PI / 4; roof.position.y = 3.6; roof.castShadow = true; g.add(roof);
  // lit nameplate under the pediment
  const plaque = M.glow(0xffe2b8, 0.9); lamps.push(plaque);
  const pm = box(2.2, 0.34, 0.07, plaque, 0, 3.06, 1.66); pm.castShadow = false; g.add(pm);
  const flag = M.glow(0xffcf6e, 1.4); lamps.push(flag);
  const fm = box(0.9, 0.55, 0.05, flag, 0.45, 5.2, 0); fm.castShadow = false;
  g.add(cyl(0.05, 0.05, 2.2, M.metal(), 0, 4.6, 0, 6), fm);
  return { core: g, spin: [], lamps };
}

function coreTower(fdef) {
  const g = new THREE.Group(); const spin = [], lamps = [];
  g.add(cyl(0.75, 1.25, 5.4, M.concrete(0x3d4157), 0, 2.7, 0, 10));
  // buttress fins + service hatch + cooling rings up the mast
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2 + 0.5;
    const fin = box(0.18, 1.6, 0.7, M.concrete(0x333850), Math.cos(a) * 1.05, 0.8, Math.sin(a) * 1.05);
    fin.rotation.y = -a; g.add(fin);
  }
  g.add(box(0.5, 0.7, 0.12, M.dark(), 0, 0.6, 1.12));
  g.add(cyl(1.0, 1.0, 0.12, M.metal(), 0, 2.1, 0, 10), cyl(0.9, 0.9, 0.12, M.metal(), 0, 3.2, 0, 10));
  const ring = M.glow(fdef.color, 2.0); lamps.push(ring);
  const r = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.12, 8, 20), ring);
  r.rotation.x = Math.PI / 2; r.position.y = 4.4; r.castShadow = false; g.add(r);
  const head = new THREE.Group();
  head.add(box(1.5, 0.8, 1.5, M.metal(), 0, 0, 0));
  head.add(cyl(0.09, 0.13, 1.6, M.dark(), 0, 0.1, 1.0, 8));
  head.children[1].rotation.x = Math.PI / 2;
  head.add(box(0.34, 0.2, 0.5, M.dark(), -0.5, 0.5, 0));            // sensor pod
  const eyeMat = M.glow(0xaef2ff, 1.5); lamps.push(eyeMat);
  const eye = box(0.1, 0.1, 0.1, eyeMat, -0.5, 0.5, 0.28); eye.castShadow = false;
  head.add(eye);
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
    new THREE.CircleGeometry(fp + 0.7, 26),
    new THREE.MeshStandardMaterial({ color: fdef.color, roughness: 1, transparent: true, opacity: 0.13 })
  );
  pad.rotation.x = -Math.PI / 2; pad.position.y = 0.06; pad.receiveShadow = true;
  group.add(pad);

  const { core, spin, lamps } = CORES[type](fdef);

  // machined base deck — dark metal plinth that grounds every structure, with
  // a faction light strip and four glowing corner bollards. EVERYTHING here
  // must stay inside fp + 0.7: canPlace guarantees fpA + fpB + 1.5 between
  // centers, so 0.75 per side is the hard visual budget (see canPlace).
  {
    const deck = new THREE.Mesh(
      new THREE.CylinderGeometry(fp + 0.4, fp + 0.7, 0.26, 8, 1),
      new THREE.MeshStandardMaterial({ color: 0x1e2233, roughness: 0.34, metalness: 0.72 })
    );
    deck.rotation.y = Math.PI / 8;
    deck.position.y = 0.13; deck.receiveShadow = true; deck.castShadow = false;
    group.add(deck);
    const strip = new THREE.Mesh(
      new THREE.RingGeometry(fp + 0.26, fp + 0.34, 32),
      new THREE.MeshBasicMaterial({ color: fdef.accent, transparent: true, opacity: 0.2, side: THREE.DoubleSide })
    );
    strip.rotation.x = -Math.PI / 2; strip.position.y = 0.27; group.add(strip);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x272b3f, roughness: 0.5, metalness: 0.6 });
    const tipMat = M.glow(fdef.accent, 1.8); lamps.push(tipMat);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const px = Math.cos(a) * (fp + 0.42), pz = Math.sin(a) * (fp + 0.42);
      group.add(cyl(0.06, 0.09, 0.78, postMat, px, 0.52, pz, 6));
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), tipMat);
      tip.position.set(px, 0.95, pz); // extent fp + 0.53 < fp + 0.7 ✓
      group.add(tip);
    }
  }

  group.add(core);
  core.position.y = 0.24; // structures sit on the deck, not in it

  // construction scaffold — corner poles + top frame, hidden when done.
  // 0.78 keeps the pole corners (s·√2 + 0.09) inside the fp + 0.7 envelope
  // for every buildable type; the crane stands mid-site so its tilted arm
  // hangs over the works instead of the neighbour's lot.
  const scaffold = new THREE.Group();
  const sMat = new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.8 });
  const s = fp * 0.78;
  for (const [x, z] of [[-s, -s], [s, -s], [-s, s], [s, s]]) scaffold.add(cyl(0.09, 0.09, 6.5, sMat, x, 3.25, z, 6));
  for (const [a, b] of [[[-s, -s], [s, -s]], [[s, -s], [s, s]], [[s, s], [-s, s]], [[-s, s], [-s, -s]]]) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const beam = box(len, 0.09, 0.09, sMat, (a[0] + b[0]) / 2, 6.4, (a[1] + b[1]) / 2);
    beam.rotation.y = Math.atan2(b[1] - a[1], b[0] - a[0]);
    scaffold.add(beam);
  }
  const crane = cyl(0.07, 0.07, 4.5, sMat, s * 0.35, 8.4, s * 0.35, 6);
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
  // dusk: glowing beacons in the dark; day: matte azure crystal in sunlight
  const mat = new THREE.MeshStandardMaterial({
    color: THEME.mats.nodeColor, roughness: 0.25, metalness: 0.1,
    emissive: 0x59c8ff, emissiveIntensity: THEME.mats.nodeEmissive, flatShading: true,
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
  group.add(cyl(6.3, 6.7, 0.5, M.concrete(0x2e3348), 0, 0.25, 0, 24)); // ≤ fp + 0.7
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
  // plinth stays inside fp(8) + 0.7 so buildings at legal distance never sink
  // into it (and lobbyists channeling at fp + 2.5 keep clear of the steps)
  group.add(cyl(8.0, 8.7, 1.2, M.concrete(0x4a4a58), 0, 0.6, 0, 28));
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
