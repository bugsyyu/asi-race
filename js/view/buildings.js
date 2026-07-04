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

// Real CC0 surface textures (Poly Haven, assets/textures/LICENSE.txt), loaded
// once and shared by every building material: board-formed concrete for the
// architecture, a worn scratched floor that doubles as brushed steel.
let TEX = null;
function tex() {
  if (TEX) return TEX;
  const L = new THREE.TextureLoader();
  const t = (p, srgb) => {
    const x = L.load(p);
    x.wrapS = x.wrapT = THREE.RepeatWrapping;
    x.anisotropy = 4;
    if (srgb) x.colorSpace = THREE.SRGBColorSpace;
    return x;
  };
  TEX = {
    concD: t('assets/textures/concrete_wall_008_diff_1k.jpg', true),
    concN: t('assets/textures/concrete_wall_008_nor_gl_1k.jpg', false),
    steelD: t('assets/textures/concrete_floor_worn_001_diff_1k.jpg', true),
    steelN: t('assets/textures/concrete_floor_worn_001_nor_gl_1k.jpg', false),
  };
  return TEX;
}

// ---------------------------------------------------------------------------
// Facade system — reference-style architecture: white spandrel bands, full
// dark ribbon-glass floors with crisp mullions, a parapet cap, and a paired
// emissive map so scattered windows burn at dusk. One albedo+emissive pair
// per (floors, cols, accent, theme), cached.
// ---------------------------------------------------------------------------
const facCache = new Map();
function facadeMats(floors, cols, accentHex) {
  const F = THEME.mats.facade;
  const key = `${THEME.key}|${floors}|${cols}|${accentHex}`;
  if (facCache.has(key)) return facCache.get(key);
  const W = 256, H = 64 * floors;
  const alb = document.createElement('canvas'); alb.width = W; alb.height = H;
  const emi = document.createElement('canvas'); emi.width = W; emi.height = H;
  const a = alb.getContext('2d'), e = emi.getContext('2d');
  a.fillStyle = F.wall; a.fillRect(0, 0, W, H);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  const accent = '#' + accentHex.toString(16).padStart(6, '0');
  const fh = 64, glassH = 34, sillY = 18; // per-floor band layout
  const cw = W / cols;
  for (let f = 0; f < floors; f++) {
    const y = f * fh;
    // spandrel seam shadow + ribbon glass band
    a.fillStyle = 'rgba(0,0,0,0.13)'; a.fillRect(0, y + fh - 3, W, 3);
    a.fillStyle = F.glass; a.fillRect(0, y + sillY, W, glassH);
    // glass sheen gradient
    const gr = a.createLinearGradient(0, y + sillY, 0, y + sillY + glassH);
    gr.addColorStop(0, 'rgba(255,255,255,0.14)'); gr.addColorStop(0.4, 'rgba(255,255,255,0)');
    a.fillStyle = gr; a.fillRect(0, y + sillY, W, glassH);
    for (let cix = 0; cix < cols; cix++) {
      const x = cix * cw;
      a.fillStyle = F.mullion; a.fillRect(x, y + sillY, 2, glassH); // mullion
      if (Math.random() < F.lit) {                                 // a lit office
        const litCol = Math.random() < 0.72 ? '#ffe9c0' : accent;
        a.fillStyle = litCol; a.globalAlpha = 0.85;
        a.fillRect(x + 3, y + sillY + 2, cw - 6, glassH - 4);
        a.globalAlpha = 1;
        e.fillStyle = litCol;
        e.fillRect(x + 3, y + sillY + 2, cw - 6, glassH - 4);
      }
    }
    a.fillStyle = F.mullion; a.fillRect(W - 2, y + sillY, 2, glassH);
  }
  // weathering: per-panel value jitter + hairline panel seams on the spandrels
  for (let f = 0; f < floors; f++) {
    const y = f * fh;
    for (let cix = 0; cix < cols; cix++) {
      const x = cix * cw;
      if (Math.random() < 0.5) {
        a.fillStyle = `rgba(8,10,16,${(0.02 + Math.random() * 0.05).toFixed(3)})`;
        a.fillRect(x, y, cw, sillY);
      }
      a.fillStyle = 'rgba(0,0,0,0.08)';
      a.fillRect(x, y, 1, sillY);
      a.fillRect(x, y + sillY + glassH, 1, fh - sillY - glassH);
    }
  }
  // street-level occlusion — the wall darkens toward the ground
  const aoG = a.createLinearGradient(0, H - fh * 0.85, 0, H);
  aoG.addColorStop(0, 'rgba(0,0,0,0)'); aoG.addColorStop(1, 'rgba(18,14,10,0.30)');
  a.fillStyle = aoG; a.fillRect(0, H - fh * 0.85, W, fh * 0.85);
  // parapet cap line
  a.fillStyle = 'rgba(255,255,255,0.28)'; a.fillRect(0, 0, W, 4);
  a.fillStyle = 'rgba(0,0,0,0.18)'; a.fillRect(0, 4, W, 2);
  const mk = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const fac = new THREE.MeshStandardMaterial({
    map: mk(alb), roughness: 0.42, metalness: 0.12,
    emissive: 0xffffff, emissiveIntensity: F.emissive, emissiveMap: mk(emi),
  });
  const roof = M.concrete(0x565b70);
  const out = { fac, roof };
  facCache.set(key, out);
  return out;
}

// box whose sides wear the facade and whose top/bottom stay roof concrete
function facBox(w, h, d, floors, cols, accentHex, x, y, z) {
  const { fac, roof } = facadeMats(floors, cols, accentHex);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [fac, fac, roof, roof, fac, fac]);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// fine horizontal louvers for data-hall flanks
let louverCache = null;
function louverTex() {
  if (louverCache) return louverCache;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#171a26'; g.fillRect(0, 0, 128, 128);
  for (let y = 2; y < 128; y += 5) {
    g.fillStyle = '#232838'; g.fillRect(0, y, 128, 2);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, y + 2, 128, 1);
  }
  louverCache = new THREE.CanvasTexture(c);
  louverCache.colorSpace = THREE.SRGBColorSpace;
  return louverCache;
}

// intelligence-agency black glass (Fort-Meade language): near-black curtain
// wall, cold sheen, sparse cyan/accent scan slits burning in the dark
const secCache = new Map();
function secGlassMat(accentHex) {
  const key = THEME.key + '|' + accentHex;
  if (secCache.has(key)) return secCache.get(key);
  const W = 256, H = 128, fh = 64;
  const alb = document.createElement('canvas'); alb.width = W; alb.height = H;
  const emi = document.createElement('canvas'); emi.width = W; emi.height = H;
  const a = alb.getContext('2d'), e = emi.getContext('2d');
  a.fillStyle = '#0b0e15'; a.fillRect(0, 0, W, H);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  const accent = '#' + accentHex.toString(16).padStart(6, '0');
  for (let f = 0; f < 2; f++) {
    const y = f * fh;
    a.fillStyle = '#0e1522'; a.fillRect(0, y + 12, W, 42);
    const gr = a.createLinearGradient(0, y + 12, 0, y + 54);
    gr.addColorStop(0, 'rgba(160,200,255,0.10)'); gr.addColorStop(0.5, 'rgba(160,200,255,0)');
    a.fillStyle = gr; a.fillRect(0, y + 12, W, 42);
    for (let x = 0; x < W; x += 16) { a.fillStyle = '#161e2e'; a.fillRect(x, y + 12, 2, 42); }
    a.fillStyle = 'rgba(0,0,0,0.5)'; a.fillRect(0, y + fh - 3, W, 3);
    for (let x = 4; x < W; x += 16) {
      if (Math.random() < 0.24) {
        const col = Math.random() < 0.6 ? '#41d8ff' : (Math.random() < 0.75 ? accent : '#ff5560');
        a.fillStyle = col; a.fillRect(x, y + 30, 10, 3);
        e.fillStyle = col; e.fillRect(x, y + 30, 10, 3);
      }
    }
  }
  const ao = a.createLinearGradient(0, H - 40, 0, H);
  ao.addColorStop(0, 'rgba(0,0,0,0)'); ao.addColorStop(1, 'rgba(0,0,0,0.35)');
  a.fillStyle = ao; a.fillRect(0, H - 40, W, 40);
  const mk = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: mk(alb), roughness: 0.26, metalness: 0.5,
    emissive: 0xffffff, emissiveIntensity: 1.0 * (THEME.glowScale ?? 1), emissiveMap: mk(emi),
  });
  secCache.set(key, mat);
  return mat;
}

// contact-shadow decal: a cached radial-gradient plane laid on the plate under
// every mass. Fakes the ambient occlusion that pins buildings to the ground —
// real AO is too costly at this draw-call count, and without it they read as
// toys pasted onto the map.
let aoTexCache = null;
function aoTex() {
  if (aoTexCache) return aoTexCache;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 8, 64, 64, 63);
  grd.addColorStop(0, 'rgba(0,0,0,0.60)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.33)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  aoTexCache = new THREE.CanvasTexture(c);
  return aoTexCache;
}
function contactAO(rx, rz, x = 0, z = 0, y = 0.175) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(rx * 2, rz * 2),
    new THREE.MeshBasicMaterial({
      map: aoTex(), transparent: true, opacity: THEME.mats.aoDecal ?? 0.45, depthWrite: false,
    }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z);
  m.renderOrder = 1;
  m.userData.decal = true; // fog ghosts hide decals instead of solidifying them
  return m;
}

// scored-concrete site paving: expansion-joint grid + weather blotches. Real
// campuses pour a slab, they don't ship buildings on trays.
const pavingCache = new Map();
function pavingTex(baseCss) {
  const key = THEME.key + '|' + baseCss;
  if (pavingCache.has(key)) return pavingCache.get(key);
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = baseCss; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 46; i++) {           // rain stains, tyre scrub, age
    const x = Math.random() * S, y = Math.random() * S, r = 6 + Math.random() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(20,18,14,${(0.02 + Math.random() * 0.05).toFixed(3)})`);
    gr.addColorStop(1, 'rgba(20,18,14,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const step = S / 6;
  for (let i = 0; i <= 6; i++) {           // expansion joints + sun-lit lip
    g.fillStyle = 'rgba(0,0,0,0.15)';
    g.fillRect(i * step, 0, 2, S); g.fillRect(0, i * step, S, 2);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(i * step + 2, 0, 1, S); g.fillRect(0, i * step + 2, S, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  pavingCache.set(key, t);
  return t;
}

// trampled-earth skirt: an alpha-fading disc that feathers each site into the
// terrain instead of leaving a hard tray edge on the grass
let skirtTexCache = null;
function skirtTexture() {
  if (skirtTexCache) return skirtTexCache;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 18, 64, 64, 63);
  gr.addColorStop(0, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.62, 'rgba(255,255,255,0.30)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  skirtTexCache = new THREE.CanvasTexture(c);
  return skirtTexCache;
}

// server-rack faces for the GPU cluster: bays of tiny status LEDs
let rackTexCache = null;
function rackTex() {
  if (rackTexCache) return rackTexCache;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#05060a'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#11141f';
  for (let y = 4; y < 124; y += 10) g.fillRect(4, y, 120, 7); // bay slots
  const cols = ['#7ddf9a', '#ffcf6e', '#59c8ff', '#8a93ff'];
  for (let y = 6; y < 124; y += 10) {
    for (let x = 8; x < 120; x += 6) {
      if (Math.random() < 0.55) {
        g.fillStyle = cols[(Math.random() * cols.length) | 0];
        g.globalAlpha = 0.35 + Math.random() * 0.65;
        g.fillRect(x, y, 2, 3);
      }
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  rackTexCache = t;
  return t;
}

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

// Exact per-channel compensation for each map's linear mean (measured), so a
// tinted material keeps its authored hue and brightness with the map applied.
const CONC_COMP = new THREE.Color().setRGB(3.76, 4.23, 6.2);
const STEEL_COMP = new THREE.Color().setRGB(10.75, 10.63, 11.26);

const M = {
  concrete: (tint = 0x3a3d52) => new THREE.MeshStandardMaterial({
    color: lift(tint, THEME.mats.concreteLift).multiply(CONC_COMP),
    map: tex().concD, normalMap: tex().concN, normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.9, metalness: 0.05,
  }),
  dark: () => new THREE.MeshStandardMaterial({
    color: lift(0x23253a, THEME.mats.darkLift).multiply(STEEL_COMP),
    map: tex().steelD, normalMap: tex().steelN, normalScale: new THREE.Vector2(0.4, 0.4),
    roughness: 0.85,
  }),
  metal: () => new THREE.MeshStandardMaterial({
    color: lift(0x596180, THEME.mats.metalLift).multiply(STEEL_COMP),
    map: tex().steelD, normalMap: tex().steelN, normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.42, metalness: 0.7,
  }),
  // every glow accent obeys the theme's daylight scale — sun kills neon
  glow:     (hex, i = 1.6) => new THREE.MeshStandardMaterial({ color: 0x0a0a12, emissive: hex, emissiveIntensity: i * (THEME.glowScale ?? 1), roughness: 0.6 }),
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
// Design language: near-future tech-campus vocabulary composited from many
// built references (ring campuses, geodesic conservatories, black-glass
// agency slabs, glass parliament domes, fin colonnades, setback crowns,
// dragonscale solar, cold-aisle light lines) then pushed past buildable —
// levitating shells, containment rings, precessing gyros, holo signage.
// ---------------------------------------------------------------------------
function coreHQ(fdef) {
  const g = new THREE.Group(); const spin = [], lamps = [];
  const trim = M.concrete(0x4a4f6a);
  const parapet = M.concrete(0x9aa0b5);

  // Slender big-tech proportions: the structures cover barely half the plaza
  // and rise tall — width:height ≈ 1:2.5, never squat.
  // podium — three ribbon-glass floors with an overhanging parapet lip
  g.add(facBox(7.0, 3.6, 5.6, 3, 8, fdef.accent, 0.4, 1.8, 0));
  g.add(box(7.4, 0.28, 6.0, parapet, 0.4, 3.75, 0));
  // dark recessed lobby line at grade
  g.add(box(7.04, 0.5, 5.64, M.dark(), 0.4, 0.26, 0));

  // tower — thirteen-storey glass slab with corner fins and a setback crown
  g.add(facBox(4.6, 12.4, 4.6, 13, 5, fdef.accent, -2.4, 6.2, -0.5));
  g.add(box(5.0, 0.3, 5.0, parapet, -2.4, 12.55, -0.5));
  // vertical corner fins sharpen the silhouette against the sky
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(box(0.17, 12.3, 0.17, parapet, -2.4 + sx * 2.32, 6.2, -0.5 + sz * 2.32));
  }
  // setback glass crown ringed by a light band — the skyline signature
  g.add(facBox(3.2, 1.4, 3.2, 2, 4, fdef.accent, -2.4, 13.32, -0.5));
  g.add(box(3.5, 0.16, 3.5, parapet, -2.4, 14.08, -0.5));
  const bandMat = M.glow(fdef.accent, 1.2); lamps.push(bandMat);
  for (const [dx, dz, bw, bd] of [[0, 2.47, 5.0, 0.07], [0, -2.47, 5.0, 0.07], [2.47, 0, 0.07, 5.0], [-2.47, 0, 0.07, 5.0]]) {
    const seam = box(bw, 0.05, bd, bandMat, -2.4 + dx, 12.73, -0.5 + dz);
    seam.castShadow = false; g.add(seam);
  }
  // light seams trace the podium parapet — circuitry, not trim
  for (const [dx, dz, bw, bd] of [[0, 3.0, 7.4, 0.06], [0, -3.0, 7.4, 0.06], [3.7, 0, 0.06, 6.0], [-3.7, 0, 0.06, 6.0]]) {
    const seam = box(bw, 0.045, bd, bandMat, 0.4 + dx, 3.93, dz);
    seam.castShadow = false; g.add(seam);
  }

  // holo sign — faction glyph billboard above the tower
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.font = '100px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#' + fdef.accent.toString(16).padStart(6, '0');
  ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 18;
  ctx.fillText(fdef.glyph, 64, 70);
  const tex2 = new THREE.CanvasTexture(c); tex2.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2),
    new THREE.MeshBasicMaterial({ map: tex2, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  sign.position.set(-2.4, 14.7, -0.5); g.add(sign); spin.push(sign);

  // antenna + aviation beacon on the tower parapet corner
  g.add(cyl(0.06, 0.09, 2.2, M.metal(), -4.35, 13.6, 1.5, 6));
  const bMat = M.glow(fdef.color, 2.2); lamps.push(bMat);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), bMat);
  beacon.position.set(-4.35, 14.8, 1.5); g.add(beacon);

  // podium roof plant: AC units with fan wells + dish, pipe run at the flank
  g.add(box(1.4, 0.8, 1.0, M.metal(), 1.9, 4.3, -1.4), box(1.0, 0.65, 0.85, M.metal(), 0.5, 4.2, -1.8));
  g.add(cyl(0.32, 0.32, 0.18, M.dark(), 1.9, 4.78, -1.4, 10), cyl(0.24, 0.24, 0.16, M.dark(), 0.5, 4.6, -1.8, 10));
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2.8), M.metal());
  dish.rotation.x = Math.PI / 1.9; dish.position.set(2.9, 4.45, 1.5); g.add(dish);
  g.add(cyl(0.09, 0.09, 3.0, M.metal(), 3.55, 1.7, 0.8, 6));

  // entry canopy + glowing lobby doors, flanked by white planter blocks
  g.add(box(2.6, 0.26, 1.9, parapet, 2.0, 1.9, 3.4));
  g.add(box(0.14, 1.7, 0.14, M.metal(), 1.1, 1.0, 4.2), box(0.14, 1.7, 0.14, M.metal(), 2.9, 1.0, 4.2));
  const door = M.glow(0xffe2b8, 1.0); lamps.push(door);
  const dm = box(1.5, 1.4, 0.08, door, 2.0, 0.76, 2.86); dm.castShadow = false; g.add(dm);
  g.add(box(0.22, 1.6, 0.8, trim, 1.1, 0.8, 2.95), box(0.22, 1.6, 0.8, trim, 2.9, 0.8, 2.95));
  g.add(box(1.0, 0.45, 0.65, parapet, -0.9, 0.53, 3.4), box(1.0, 0.45, 0.65, parapet, -2.6, 0.53, 3.4));
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x2e4a44, roughness: 0.95 });
  for (const px of [-0.9, -2.6]) {
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), bushMat);
    bush.position.set(px, 0.9, 3.4); bush.castShadow = true; g.add(bush);
  }
  return { core: g, spin, lamps };
}

function coreDatacenter(fdef) {
  const g = new THREE.Group(); const spin = [], lamps = [];
  const vent = M.glow(fdef.accent, 1.3); lamps.push(vent);
  const hallMat = new THREE.MeshStandardMaterial({
    color: 0xd8dce8, map: louverTex(), roughness: 0.75, metalness: 0.25, // louvered flanks
  });
  for (let i = -1; i <= 1; i++) {
    g.add(box(2.2, 3.6, 6.0, hallMat, i * 2.55, 1.8, 0));
    const strip = box(2.22, 0.4, 5.6, vent, i * 2.55, 3.0, 0);
    strip.castShadow = false; g.add(strip);
    // rack door seams
    g.add(box(0.06, 2.8, 6.02, M.concrete(0x30344a), i * 2.55 - 1.06, 1.6, 0));
  }
  // roof slab trimmed to keep its corners inside fp + 0.7 (8.0×6.7: adjacent
  // datacenters at minimum spacing can no longer kiss corner-to-corner)
  g.add(box(7.6, 0.4, 6.3, M.concrete(0x9aa0b5), 0, 3.9, 0));
  // cable trays bridging the halls + heat stacks + transformer yard
  g.add(box(7.5, 0.12, 0.7, M.metal(), 0, 4.2, -2.2), box(7.5, 0.12, 0.7, M.metal(), 0, 4.2, 2.2));
  g.add(cyl(0.36, 0.46, 2.6, M.metal(), -3.3, 5.3, -2.0, 10), cyl(0.3, 0.38, 2.0, M.metal(), -2.3, 5.0, -2.4, 10));
  g.add(box(1.3, 1.0, 1.0, M.metal(), 3.0, 0.5, 2.6));
  g.add(cyl(0.09, 0.09, 0.55, M.dark(), 2.7, 1.25, 2.6, 6), cyl(0.09, 0.09, 0.55, M.dark(), 3.3, 1.25, 2.6, 6));
  // status LEDs blinking down the cold aisle
  const led = M.glow(0x7ddf9a, 1.6); lamps.push(led);
  for (let k = 0; k < 5; k++) {
    const dot = box(0.07, 0.07, 0.07, led, -1.35, 0.6 + k * 0.42, 3.21);
    dot.castShadow = false; g.add(dot);
  }
  for (const [x, z] of [[-2.55, 1.7], [0, -1.7], [2.55, 1.7]]) {
    const fan = new THREE.Group();
    fan.add(cyl(0.9, 0.9, 0.4, M.metal(), 0, 0, 0));
    for (let b = 0; b < 3; b++) {
      const blade = box(1.5, 0.06, 0.3, M.metal());
      blade.rotation.y = b * Math.PI / 1.5; fan.add(blade);
    }
    fan.position.set(x, 4.3, z); g.add(fan); spin.push(fan);
    g.add(cyl(1.05, 1.05, 0.22, M.concrete(0x3a3f56), x, 4.12, z, 12)); // fan shroud
  }
  // liquid-cooling light lines down the cold aisles + end-wall status slits +
  // dragonscale solar shingles on the roof deck
  const cool = M.glow(0x41d8ff, 1.1); lamps.push(cool);
  for (const x of [-1.28, 1.28]) {
    const t = cyl(0.05, 0.05, 5.4, cool, x, 0.34, 0, 6);
    t.rotation.x = Math.PI / 2; t.castShadow = false; g.add(t);
  }
  for (let i = -1; i <= 1; i++) {
    const sl = box(1.5, 0.07, 0.04, cool, i * 2.55, 2.55, 3.02);
    sl.castShadow = false; g.add(sl);
  }
  const shingle = new THREE.MeshStandardMaterial({ color: 0x14202f, roughness: 0.3, metalness: 0.55 });
  for (const [px, pz, rz] of [[-1.28, 0.55, 0.09], [1.28, 0.55, -0.09], [-1.28, -0.45, 0.09], [1.28, -0.45, -0.09]]) {
    const p = box(0.95, 0.05, 0.7, shingle, px, 4.17, pz);
    p.rotation.z = rz; g.add(p);
  }
  return { core: g, spin, lamps };
}

function coreLab(fdef) {
  // Ring campus around a levitating geodesic conservatory: the courtyard grows
  // the experiment now, sealed in a triangulated shell that hovers on a lift
  // ring — no door, no scaffold, no visible support.
  const g = new THREE.Group(); const spin = [], lamps = [];
  const { fac } = facadeMats(3, 24, fdef.accent);
  const R = 3.55, H = 3.3, r = 1.9;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 40, 1, true), fac);
  wall.position.y = H / 2 + 0.12; wall.castShadow = wall.receiveShadow = true;
  g.add(wall);
  const court = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.02, r + 0.02, H - 0.5, 24, 1, true), M.concrete(0x8a8fa8));
  court.position.y = (H - 0.5) / 2 + 0.12; g.add(court);
  // roof ring + white parapet rims inside and out
  const roof = new THREE.Mesh(new THREE.RingGeometry(r, R, 40), M.concrete(0x9aa0b5));
  roof.rotation.x = -Math.PI / 2; roof.position.y = H + 0.13; g.add(roof);
  const rimO = new THREE.Mesh(new THREE.TorusGeometry(R, 0.09, 6, 40), M.concrete(0x9aa0b5));
  rimO.rotation.x = Math.PI / 2; rimO.position.y = H + 0.15; g.add(rimO);
  const rimI = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 6, 32), M.concrete(0x9aa0b5));
  rimI.rotation.x = Math.PI / 2; rimI.position.y = H + 0.15; g.add(rimI);
  // planted courtyard with the hovering conservatory sphere
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(r - 0.12, 24),
    new THREE.MeshStandardMaterial({ color: 0x39543c, roughness: 1 }));
  lawn.rotation.x = -Math.PI / 2; lawn.position.y = 0.34; g.add(lawn);
  const orbMat = M.glow(fdef.accent, 1.4); lamps.push(orbMat);
  const sphere = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 1),
    new THREE.MeshStandardMaterial({
      color: 0xdfe8ee, roughness: 0.3, metalness: 0.1, flatShading: true,
      transparent: true, opacity: 0.55,
    }));
  shell.castShadow = true; sphere.add(shell);
  const lattice = new THREE.Mesh(new THREE.IcosahedronGeometry(0.97, 1),
    new THREE.MeshBasicMaterial({ color: fdef.accent, wireframe: true, transparent: true, opacity: 0.5 }));
  sphere.add(lattice);
  const seed = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), orbMat);
  seed.castShadow = false; sphere.add(seed);
  sphere.position.set(0, 1.75, 0); g.add(sphere); spin.push(sphere);
  const liftRing = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.045, 6, 24), orbMat);
  liftRing.rotation.x = Math.PI / 2; liftRing.position.y = 0.62; liftRing.castShadow = false;
  g.add(liftRing);
  // light seam rides the roof parapet
  const roofGlow = new THREE.Mesh(new THREE.TorusGeometry(R - 0.05, 0.035, 6, 48), orbMat);
  roofGlow.rotation.x = Math.PI / 2; roofGlow.position.y = H + 0.2; roofGlow.castShadow = false;
  g.add(roofGlow);
  // rooftop solar arc + a glowing skylight monitor
  const panelM = new THREE.MeshStandardMaterial({ color: 0x18243c, roughness: 0.25, metalness: 0.5 });
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + 0.5;
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.06, 0.75), panelM);
    p.position.set(Math.cos(a) * (R - 0.85), H + 0.36, Math.sin(a) * (R - 0.85));
    p.rotation.y = -a; p.rotation.z = -0.3; p.castShadow = true;
    g.add(p);
  }
  const sky = new THREE.MeshStandardMaterial({
    color: 0x0a0a12, emissive: fdef.accent, emissiveIntensity: 1.1, roughness: 0.6, flatShading: true,
  });
  lamps.push(sky);
  const monitor = new THREE.Mesh(new THREE.SphereGeometry(0.55, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2), sky);
  monitor.position.set(-2.0, H + 0.28, -1.4); monitor.castShadow = false; g.add(monitor);
  return { core: g, spin, lamps };
}

function coreInstitute(fdef) {
  // Alignment institute — a levitating triangulated think-sphere held over its
  // launch bowl by three containment pylons and an equatorial data ring. No
  // building on Earth does this yet; alignment research runs ahead of physics.
  const g = new THREE.Group(); const spin = [], lamps = [];
  g.add(cyl(3.0, 3.4, 0.9, M.concrete(0x596174), 0, 0.45, 0, 24));   // podium
  g.add(cyl(1.5, 2.2, 0.55, M.dark(), 0, 1.12, 0, 20));              // launch bowl
  const glowA = M.glow(fdef.accent, 1.3); lamps.push(glowA);
  const lev = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.055, 6, 32), glowA);
  lev.rotation.x = Math.PI / 2; lev.position.y = 1.5; lev.castShadow = false; g.add(lev);
  // the sphere: white triangulated panels, glowing seams, polar oculus
  const sph = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(2.35, 1),
    new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.38, metalness: 0.08, flatShading: true }));
  shell.castShadow = shell.receiveShadow = true; sph.add(shell);
  const seams = new THREE.Mesh(new THREE.IcosahedronGeometry(2.37, 1),
    new THREE.MeshBasicMaterial({ color: 0x7ddf9a, wireframe: true, transparent: true, opacity: 0.4 }));
  sph.add(seams);
  const calm = M.glow(0x7ddf9a, 1.5); lamps.push(calm);
  const oculus = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), calm);
  oculus.position.y = 2.35; oculus.castShadow = false; sph.add(oculus);
  sph.position.y = 3.85; g.add(sph); spin.push(sph);
  // containment pylons + the equatorial data ring
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2 + 0.5;
    g.add(cyl(0.08, 0.13, 5.2, M.metal(), Math.cos(a) * 3.0, 2.7, Math.sin(a) * 3.0, 8));
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), glowA);
    tip.position.set(Math.cos(a) * 3.0, 5.4, Math.sin(a) * 3.0); tip.castShadow = false; g.add(tip);
  }
  const orbit = new THREE.Mesh(new THREE.TorusGeometry(2.95, 0.04, 6, 48), glowA);
  orbit.rotation.x = Math.PI / 2; orbit.position.y = 3.85; orbit.castShadow = false; g.add(orbit);
  return { core: g, spin, lamps };
}

function coreSecoffice(fdef) {
  // Cyber-defense citadel: the Pentagon's five-sided plan wearing intelligence
  // black glass, batter-walled, stacked with a rotated crown prism, shield
  // emitter bands and a rotating sweep scanner.
  const g = new THREE.Group(); const spin = [], lamps = [];
  const fac = secGlassMat(fdef.accent);
  const R = 3.6, H = 2.7;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 0.18, H, 5, 1, true), fac);
  wall.position.y = H / 2 + 0.12; wall.rotation.y = Math.PI / 10;
  wall.castShadow = wall.receiveShadow = true;
  g.add(wall);
  const slab = (r, h, y, rot) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 5), M.concrete(0x2e3346));
    m.rotation.y = rot; m.position.y = y; m.castShadow = m.receiveShadow = true;
    g.add(m); return m;
  };
  slab(R + 0.08, 0.22, H + 0.18, Math.PI / 10);
  // shield emitter bands trace both parapets
  const shield = M.glow(fdef.accent, 1.1); lamps.push(shield);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.03, R + 0.03, 0.07, 5, 1, true), shield);
  band.rotation.y = Math.PI / 10; band.position.y = H + 0.02; band.castShadow = false; g.add(band);
  // crown prism rotated 36° — the stacked-fortress massing
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.3, 1.05, 5, 1, true), fac);
  crown.rotation.y = Math.PI / 10 + Math.PI / 5; crown.position.y = H + 0.8;
  crown.castShadow = crown.receiveShadow = true; g.add(crown);
  slab(2.2, 0.18, H + 1.38, Math.PI / 10 + Math.PI / 5);
  const band2 = new THREE.Mesh(new THREE.CylinderGeometry(2.18, 2.18, 0.06, 5, 1, true), shield);
  band2.rotation.y = Math.PI / 10 + Math.PI / 5; band2.position.y = H + 1.28;
  band2.castShadow = false; g.add(band2);
  // rotating sweep scanner on the crown
  const radar = new THREE.Group();
  radar.add(cyl(0.07, 0.1, 0.5, M.metal(), 0, 0.25, 0, 6));
  const dishM = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.6), M.metal());
  dishM.rotation.x = Math.PI / 2.2; dishM.position.y = 0.55; radar.add(dishM);
  radar.position.y = H + 1.47; g.add(radar); spin.push(radar);
  // comms mast with warning eye, off the crown on the main roof
  g.add(cyl(0.05, 0.08, 2.2, M.metal(), -2.55, H + 1.2, 1.15, 6));
  const redEye = M.glow(0xff4444, 1.8); lamps.push(redEye);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), redEye);
  eye.position.set(-2.55, H + 2.35, 1.15); eye.castShadow = false; g.add(eye);
  // perimeter watch: corner cameras, gate bollards, entry scan slit
  for (const [cx, cz] of [[2.6, 2.2], [-2.6, -2.2]]) {
    const cam = box(0.26, 0.16, 0.34, M.dark(), cx, H + 0.1, cz);
    cam.rotation.y = Math.atan2(-cx, -cz) + Math.PI;
    cam.rotation.x = 0.35;
    g.add(cam);
  }
  g.add(box(0.26, 0.5, 0.26, M.metal(), -0.8, 0.37, 3.3), box(0.26, 0.5, 0.26, M.metal(), 0.8, 0.37, 3.3));
  const slit = M.glow(fdef.color, 1.6); lamps.push(slit);
  const sl = box(2.6, 0.18, 0.08, slit, 0, 1.3, 3.1); sl.castShadow = false; g.add(sl);
  return { core: g, spin, lamps };
}

function corePolicy(fdef) {
  // Policy nexus: a glass parliament dome with spiral ramp lights and a mirror
  // funnel over a two-storey glass council block; fin colonnade for a porch —
  // statecraft rebuilt in curtain wall.
  const g = new THREE.Group(); const spin = [], lamps = [];
  const white = M.concrete(0x9aa4b5);
  const white2 = M.concrete(0x848ea6);
  g.add(facBox(3.4, 2.4, 2.4, 2, 6, fdef.accent, 0, 1.32, 0));        // council block
  g.add(box(3.6, 0.18, 2.6, white2, 0, 2.6, 0));                      // cornice
  g.add(box(1.3, 1.5, 2.0, white2, -2.35, 0.87, 0), box(1.3, 1.5, 2.0, white2, 2.35, 0.87, 0)); // wings
  g.add(box(1.36, 0.12, 2.06, white, -2.35, 1.68, 0), box(1.36, 0.12, 2.06, white, 2.35, 1.68, 0));
  // the dome: glass shell, two ramp light rings, inverted mirror funnel
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.3, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0xbcd4e6, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.4,
    }));
  dome.position.y = 2.7; dome.castShadow = false; g.add(dome);
  const warm = M.glow(0xffe2b8, 0.95); lamps.push(warm);
  for (const [r, y] of [[0.95, 2.98], [0.6, 3.38]]) {
    const ramp = new THREE.Mesh(new THREE.TorusGeometry(r, 0.032, 6, 32), warm);
    ramp.rotation.x = Math.PI / 2; ramp.position.y = y; ramp.castShadow = false; g.add(ramp);
  }
  g.add(cyl(0.5, 0.09, 0.75, M.metal(), 0, 3.1, 0, 12));              // mirror funnel
  // fin colonnade porch — the modern column order
  for (const x of [-1.2, -0.6, 0, 0.6, 1.2]) g.add(box(0.1, 1.85, 0.44, white, x, 1.05, 1.5));
  g.add(box(3.0, 0.14, 0.85, white2, 0, 2.04, 1.45));
  const door = M.glow(0xffe2b8, 0.9); lamps.push(door);
  const dm = box(0.9, 1.3, 0.06, door, 0, 0.77, 1.24); dm.castShadow = false; g.add(dm);
  // ceremonial steps + planters
  g.add(box(2.8, 0.2, 0.9, white2, 0, 0.1, 2.25));
  g.add(box(2.2, 0.18, 0.6, white, 0, 0.28, 2.0));
  for (const px of [-2.0, 2.0]) {
    g.add(box(0.6, 0.45, 0.6, white2, px, 0.32, 2.25));
    const bush = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.65, 7),
      new THREE.MeshStandardMaterial({ color: 0x2e4a44, roughness: 0.95 }));
    bush.position.set(px, 0.86, 2.25); bush.castShadow = true; g.add(bush);
  }
  // holo seal precessing over the dome tip + the flag on the wing roof
  const seal = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 24), warm);
  seal.rotation.x = Math.PI / 2 + 0.35; seal.position.y = 4.25; seal.castShadow = false;
  g.add(seal); spin.push(seal);
  const flag = M.glow(0xffcf6e, 1.4); lamps.push(flag);
  const fm = box(0.7, 0.45, 0.05, flag, -1.9, 3.9, -0.7); fm.castShadow = false;
  g.add(cyl(0.04, 0.04, 2.6, M.metal(), -2.25, 2.9, -0.7, 6), fm);
  return { core: g, spin, lamps };
}

function coreTower(fdef) {
  // Washington-Monument silhouette: slim white stone obelisk with a floating
  // firewall halo and a pyramidion sensor tip.
  const g = new THREE.Group(); const spin = [], lamps = [];
  const stone = M.concrete(0x9aa0b5);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 1.05, 8.2, 4, 1), stone);
  shaft.rotation.y = Math.PI / 4;
  shaft.position.y = 4.1; shaft.castShadow = shaft.receiveShadow = true;
  g.add(shaft);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.64, 1.1, 4, 1), stone);
  tip.rotation.y = Math.PI / 4; tip.position.y = 8.75; tip.castShadow = true;
  g.add(tip);
  g.add(box(1.9, 0.5, 1.9, M.concrete(0x848aa2), 0, 0.37, 0)); // base collar
  // floating firewall halo — this is the weapon
  const ring = M.glow(fdef.color, 2.0); lamps.push(ring);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.1, 8, 28), ring);
  halo.rotation.x = Math.PI / 2; halo.position.y = 6.9; halo.castShadow = false;
  g.add(halo); spin.push(halo);
  const eyeMat = M.glow(0xaef2ff, 1.6); lamps.push(eyeMat);
  const eye = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), eyeMat);
  eye.position.y = 9.55; eye.castShadow = false;
  g.add(eye); spin.push(eye);
  // lit arris edges + a tilted gyro ring precessing above the main halo
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(shaft.geometry),
    new THREE.LineBasicMaterial({ color: 0x59c8ff, transparent: true, opacity: 0.5 }));
  edges.rotation.y = Math.PI / 4; edges.position.y = 4.1; g.add(edges);
  const halo2 = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.055, 8, 24), ring);
  halo2.rotation.x = Math.PI / 2 + 0.3; halo2.position.y = 8.0; halo2.castShadow = false;
  g.add(halo2); spin.push(halo2);
  return { core: g, spin, lamps };
}

const CORES = {
  hq: coreHQ, datacenter: coreDatacenter, lab: coreLab,
  institute: coreInstitute, secoffice: coreSecoffice,
  policy: corePolicy, tower: coreTower,
};

// ---------------------------------------------------------------------------
// Base plates — shaped per building so no two silhouettes repeat: chamfered
// rectangular aprons hugging each floor plan; the institute and tower get
// smooth round plinths. All extents stay inside fp + 0.7 (see canPlace),
// including the chamfer-corner vertices and the extrude bevel (+~0.14).
// ---------------------------------------------------------------------------
const PLATES = { // [half-width x, half-width z, corner chamfer]
  hq: [6.0, 6.0, 1.8],
  datacenter: [4.35, 3.65, 1.5],
  lab: [3.7, 3.2, 1.3],
  secoffice: [3.4, 3.05, 1.2],
  policy: [3.1, 2.75, 1.1],
};

function chamferShape(wx, wz, c) {
  const s = new THREE.Shape();
  s.moveTo(-wx + c, -wz);
  s.lineTo(wx - c, -wz); s.lineTo(wx, -wz + c);
  s.lineTo(wx, wz - c); s.lineTo(wx - c, wz);
  s.lineTo(-wx + c, wz); s.lineTo(-wx, wz - c);
  s.lineTo(-wx, -wz + c); s.closePath();
  return s;
}
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

  // site work — a scored-concrete apron poured flush with the grade, feathered
  // into the terrain by a trampled-earth skirt: buildings grow out of the
  // ground here, they don't arrive on trays. Shape still varies per type
  // (see PLATES); everything stays inside the fp + 0.7 budget.
  {
    const skirt = new THREE.Mesh(new THREE.CircleGeometry(fp + 0.68, 26),
      new THREE.MeshBasicMaterial({
        map: skirtTexture(), color: THEME.mats.skirt,
        transparent: true, opacity: 0.55, depthWrite: false,
      }));
    skirt.rotation.x = -Math.PI / 2; skirt.position.y = 0.045;
    skirt.userData.decal = true;
    group.add(skirt);

    const apronMat = new THREE.MeshStandardMaterial({
      map: pavingTex(type === 'secoffice' ? THEME.mats.apronDark : THEME.mats.apron),
      normalMap: tex().concN, normalScale: new THREE.Vector2(0.25, 0.25),
      roughness: 0.94, metalness: 0.02,
    });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3e4e, roughness: 0.6, metalness: 0.4 });

    const rect = PLATES[type];
    if (rect) {
      // chamfered slab matched to this building's floor plan, nearly flush
      const [wx, wz, c] = rect;
      const g = new THREE.ExtrudeGeometry(chamferShape(wx, wz, c),
        { depth: 0.09, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.06, bevelSegments: 1 });
      g.rotateX(-Math.PI / 2);
      const uvA = g.attributes.uv, uvS = 1 / (2.2 * Math.max(wx, wz));
      for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) * uvS, uvA.getY(i) * uvS);
      const deck = new THREE.Mesh(g, apronMat);
      deck.position.y = 0.03;
      deck.receiveShadow = true; deck.castShadow = false;
      group.add(deck);

      if (type === 'hq' || type === 'secoffice' || type === 'policy') {
        // painted wayfinding stripe toward the entry + human-scale posts
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.4),
          new THREE.MeshBasicMaterial({ color: fdef.color, transparent: true, opacity: 0.2, depthWrite: false }));
        stripe.rotation.x = -Math.PI / 2; stripe.position.set(0, 0.155, wz - 1.4);
        stripe.userData.decal = true;
        group.add(stripe);
        group.add(cyl(0.05, 0.06, 0.5, postMat, -1.05, 0.37, wz - 0.45, 6));
        group.add(cyl(0.05, 0.06, 0.5, postMat, 1.05, 0.37, wz - 0.45, 6));
      }
    } else {
      // low round pad (institute, tower) — plain poured concrete
      const deck = new THREE.Mesh(new THREE.CylinderGeometry(fp + 0.42, fp + 0.6, 0.16, 24, 1),
        M.concrete(0x5c5a6e));
      deck.position.y = 0.08; deck.receiveShadow = true; deck.castShadow = false;
      group.add(deck);
    }
  }

  // contact-shadow decal under the mass — pins the structure to its slab
  const AO = {
    hq: [5.9, 4.6, -0.6, -0.1], datacenter: [4.5, 3.9, 0, 0], lab: [4.15, 4.15, 0, 0],
    institute: [3.7, 3.7, 0, 0], secoffice: [4.15, 4.15, 0, 0], policy: [3.6, 3.0, 0, 0.2],
    tower: [2.1, 2.1, 0, 0],
  }[type];
  if (AO) group.add(contactAO(AO[0], AO[1], AO[2], AO[3]));

  group.add(core);
  core.position.y = 0.16; // structures sit on the slab, not in it

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
    for (const l of lamps) {
      // capture the authored intensity before the construction dim overwrites it
      if (l.userData.base === undefined) l.userData.base = l.emissiveIntensity;
      l.emissiveIntensity = p < 1 ? 0.15 : l.userData.base;
    }
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
  const gs = THEME.glowScale ?? 1;
  // poured industrial slab, feathered into the field — not a serving tray
  const skirt = new THREE.Mesh(new THREE.CircleGeometry(6.65, 26),
    new THREE.MeshBasicMaterial({
      map: skirtTexture(), color: THEME.mats.skirt,
      transparent: true, opacity: 0.55, depthWrite: false,
    }));
  skirt.rotation.x = -Math.PI / 2; skirt.position.y = 0.045; skirt.userData.decal = true;
  group.add(skirt);
  group.add(cyl(6.35, 6.6, 0.3, M.concrete(0x4e4c5e), 0, 0.15, 0, 24)); // ≤ fp + 0.7
  group.add(contactAO(4.8, 4.8, 0, 0, 0.315));
  // racks wear real server faces: bays of blinking status LEDs
  const rackMat = new THREE.MeshStandardMaterial({
    color: lift(0x23253a, THEME.mats.darkLift), roughness: 0.7, metalness: 0.3,
    emissive: 0xffffff, emissiveIntensity: 0.85 * gs, emissiveMap: rackTex(),
  });
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + Math.PI / 4;
    const rack = box(1.6, 2.6, 1.1, rackMat, Math.cos(a) * 3.4, 1.6, Math.sin(a) * 3.4);
    rack.lookAt(0, 1.6, 0);
    group.add(rack);
  }
  // coolant light loop + the data fountain around the scheduler core
  const coolant = new THREE.Mesh(new THREE.TorusGeometry(3.95, 0.05, 6, 40), M.glow(0x41d8ff, 1.2));
  coolant.rotation.x = Math.PI / 2; coolant.position.y = 0.34; coolant.castShadow = false;
  group.add(coolant);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.58, 2.0, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x59c8ff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 1.45; beam.userData.decal = true; group.add(beam);
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x0a0a12, emissive: 0x8a93ff, emissiveIntensity: 0.7 * gs });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), coreMat);
  core.position.y = 2.45; group.add(core);
  // ownership banner light
  const ownMat = new THREE.MeshStandardMaterial({ color: 0x0a0a12, emissive: 0x666a80, emissiveIntensity: 1.2 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.16, 8, 40), ownMat);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.46; ring.castShadow = false; group.add(ring);
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
  function tick(dt) { core.rotation.y += dt * 0.9; core.position.y = 2.45 + Math.sin(performance.now() / 700) * 0.12; }
  return { group, setOwner, setCapture, tick };
}

export function makeCapitol() {
  const group = new THREE.Group();
  // plinth stays inside fp(8) + 0.7 so buildings at legal distance never sink
  // into it (and lobbyists channeling at fp + 2.5 keep clear of the steps)
  group.add(cyl(8.0, 8.7, 1.2, M.concrete(0x4a4a58), 0, 0.6, 0, 28));
  group.add(cyl(6.5, 7, 1.0, M.concrete(0x565666), 0, 1.7, 0, 24));
  group.add(contactAO(7.2, 7.2, 0, 0, 1.215));
  group.add(contactAO(5.7, 4.0, 0, 0, 2.215));
  const hall = box(9, 3.4, 6, M.concrete(0x6a6577), 0, 3.9, 0);
  group.add(hall);
  for (let i = -3; i <= 3; i++) group.add(cyl(0.3, 0.34, 3.2, M.concrete(0x8a8496), i * 1.25, 3.9, 3.25, 10));
  group.add(box(10, 0.7, 7, M.concrete(0x565666), 0, 5.9, 0));
  const domeMat = new THREE.MeshStandardMaterial({ color: 0x8f8aa0, roughness: 0.5, metalness: 0.25 });
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(2.35, 2.55, 1.9, 18), domeMat);
  drum.position.y = 7.0; drum.castShadow = true; group.add(drum);
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 1.7, 6), domeMat);
    col.position.set(Math.cos(a) * 2.6, 7.0, Math.sin(a) * 2.6);
    group.add(col);
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.6, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.position.y = 7.9; dome.castShadow = true; group.add(dome);
  const lampMat = M.glow(0xffe9c4, 2.4);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), lampMat);
  lamp.position.y = 11.6; group.add(lamp);
  group.add(cyl(0.07, 0.07, 1.6, M.metal(), 0, 10.9, 0, 6));
  const glow = new THREE.PointLight(0xffd9a0, 14, 34, 1.8);
  glow.position.y = 7; group.add(glow);
  return { group, tick: () => {} };
}
