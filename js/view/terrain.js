// ============================================================================
// Terrain — vertex-colored ground driven by the same heightfield the sim uses,
// plus instanced trees/rocks kept clear of gameplay areas.
// ============================================================================
import * as THREE from 'three';
import { groundHeight, slopeAt } from '../shared/height.js';
import { MAP, TUNE } from '../sim/constants.js';
import { THEME } from './theme.js';

// ---------------------------------------------------------------------------
// Ground material — real CC0 photo textures (Poly Haven, see assets/textures/
// LICENSE.txt): an aerial grass/rock albedo + normal map for the meadow, a
// dry-mud albedo for bare ground, blended in-shader by a baked coverage mask
// that follows the same noise as the vertex tint (moss banks stay grassy,
// worn paths and building aprons go to dirt). Vertex colors survive as a
// theme tint multiplied on top.
// ---------------------------------------------------------------------------
const GRASS_REPEAT = 12, DIRT_REPEAT = 36;

// ---------------------------------------------------------------------------
// Cut-and-fill: every building site grades the terrain to a level pad with a
// smooth bank around it (real earthworks, not a slab floating over a slope).
// SITES is consulted by sampleGroundY so units/effects ride the graded ground.
// ---------------------------------------------------------------------------
const SITES = [];
const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function sampleGroundY(x, z) {
  let h = groundHeight(x, z);
  for (let i = 0; i < SITES.length; i++) {
    const s = SITES[i];
    const dx = x - s.x, dz = z - s.z, d2 = dx * dx + dz * dz;
    if (d2 >= s.r2) continue;
    const t = sstep(s.rFlat, s.rBlend, Math.sqrt(d2));
    h = s.y + (h - s.y) * t;
  }
  return h;
}

function bakeCoverageMask(size) {
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const x = (i / (S - 1) - 0.5) * size;
      const z = (j / (S - 1) - 0.5) * size;
      // same moss field the vertex tint uses, plus a medium-scale breakup
      const moss = groundHeight(x * 0.55 + 400, z * 0.55 - 260) * 0.9 - 0.12;
      const mid = groundHeight(x * 1.9 - 320, z * 1.9 + 540) * 0.45;
      let cover = 0.58 + moss * 0.55 + mid;
      cover -= slopeAt(x, z) * 1.1;                        // cliffs shed their topsoil
      for (const p of MAP.hqPos) {
        const d = distToSegment(x, z, p.x, p.z, 0, 0);
        if (d < 5.5) cover -= (1 - d / 5.5) * 1.2;         // worn convoy paths
        const dh = Math.hypot(x - p.x, z - p.z);
        if (dh < 16) cover -= (1 - dh / 16) * 0.9;         // trampled campus aprons
      }
      const dc = Math.hypot(x - MAP.capitol.x, z - MAP.capitol.z);
      if (dc < 22) cover -= (1 - dc / 22) * 0.5;           // packed earth around the lawn
      const v = Math.max(0, Math.min(1, cover)) * 255;
      const o = (j * S + i) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return { tex: t, ctx: g, S };
}

function groundMaterial(renderer /* optional */, size) {
  const loader = new THREE.TextureLoader();
  const rep = (t, r, srgb) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(r, r);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const grassMap = rep(loader.load('assets/textures/aerial_grass_rock_diff_1k.jpg'), GRASS_REPEAT, true);
  const grassNor = rep(loader.load('assets/textures/aerial_grass_rock_nor_gl_1k.jpg'), GRASS_REPEAT, false);
  const dirtMap = rep(loader.load('assets/textures/brown_mud_dry_diff_1k.jpg'), DIRT_REPEAT, true);
  const mask = bakeCoverageMask(size);

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0,
    map: grassMap, normalMap: grassNor, normalScale: new THREE.Vector2(0.7, 0.7),
  });
  mat.color.setScalar(THEME.terrainTex.gain); // rebalance the albedo multiply
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tDirt = { value: dirtMap };
    sh.uniforms.tMask = { value: mask.tex };
    sh.uniforms.uDirtRepeat = { value: DIRT_REPEAT };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSplatUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplatUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tDirt; uniform sampler2D tMask; uniform float uDirtRepeat; varying vec2 vSplatUv;')
      .replace('#include <map_fragment>', `
        vec4 gcol = texture2D( map, vMapUv );
        vec4 dcol = texture2D( tDirt, vSplatUv * uDirtRepeat );
        float cover = texture2D( tMask, vSplatUv ).r;
        cover = smoothstep( 0.28, 0.72, cover );
        diffuseColor *= mix( dcol, gcol, cover );
      `);
  };
  return { mat, grassMap, mask };
}

export function buildTerrain(scene, seedRng) {
  const size = TUNE.mapSize + 60, segs = 176;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cBase = new THREE.Color(THEME.terrain.base);   // ground body
  const cWarm = new THREE.Color(THEME.terrain.warm);   // sun-warmed faces
  const cLow = new THREE.Color(THEME.terrain.low);     // hollows
  const cMoss = new THREE.Color(THEME.terrain.moss);   // turf patches
  const cPath = new THREE.Color(THEME.terrain.path);
  const cWhite = new THREE.Color(0xffffff);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = groundHeight(x, z);
    pos.setY(i, h);
    // slope-ish shading: sample height a bit toward the sun (-x)
    const hs = groundHeight(x - 2.5, z + 0.8);
    const litFace = THREE.MathUtils.clamp((h - hs) * 0.9 + 0.28, 0, 1);
    tmp.copy(cLow).lerp(cBase, THREE.MathUtils.clamp(h * 0.5 + 0.55, 0, 1)).lerp(cWarm, litFace * 0.55);
    // moss banks: low-frequency patches keep the plain from reading as one color
    const moss = groundHeight(x * 0.55 + 400, z * 0.55 - 260) * 0.9 - 0.12;
    if (moss > 0) tmp.lerp(cMoss, Math.min(0.55, moss));
    // fine soil grain on top of the patches
    const grain = groundHeight(x * 6.1 - 900, z * 6.1 + 700) * 0.10;
    tmp.offsetHSL(0, 0, grain - 0.045);
    // steep faces read as bare rock: desaturate and darken with slope
    const sl = slopeAt(x, z);
    if (sl > 0.22) tmp.offsetHSL(0, -Math.min(0.22, (sl - 0.22) * 0.5), -Math.min(0.1, (sl - 0.22) * 0.22));
    // faint worn paths from each HQ toward the capitol
    for (const p of MAP.hqPos) {
      const d = distToSegment(x, z, p.x, p.z, 0, 0);
      if (d < 3.4) tmp.lerp(cPath, 0.5 * (1 - d / 3.4));
    }
    // photo albedo now carries the detail; the palette survives as a tint
    tmp.lerp(cWhite, THEME.terrainTex.tintLift);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const { mat: groundMat, grassMap, mask } = groundMaterial(null, size);
  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);

  // Earthworks: level a pad at (x,z) and grade a bank out to rBlend — mesh,
  // registry (for sampleGroundY) and a dirt stamp on the coverage mask so the
  // cut reads as stripped topsoil.
  function flattenSite(x, z, rFlat, rBlend) {
    const y = groundHeight(x, z);
    SITES.push({ x, z, rFlat, rBlend, r2: rBlend * rBlend, y });
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const dx = p.getX(i) - x, dz = p.getZ(i) - z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rBlend * rBlend) continue;
      const t = sstep(rFlat, rBlend, Math.sqrt(d2));
      p.setY(i, y + (p.getY(i) - y) * t);
    }
    p.needsUpdate = true;
    geo.computeVertexNormals();
    const px = (v) => ((v / size) + 0.5) * (mask.S - 1);
    const rpx = (r) => (r / size) * (mask.S - 1);
    const gr = mask.ctx.createRadialGradient(px(x), px(z), rpx(rFlat) * 0.5, px(x), px(z), rpx(rBlend));
    gr.addColorStop(0, 'rgba(0,0,0,0.9)');
    gr.addColorStop(0.72, 'rgba(0,0,0,0.5)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    mask.ctx.fillStyle = gr;
    mask.ctx.beginPath();
    mask.ctx.arc(px(x), px(z), rpx(rBlend) + 1, 0, Math.PI * 2);
    mask.ctx.fill();
    mask.tex.needsUpdate = true;
  }

  // Scatter: keep clear of HQs, capitol, clusters, nodes and travel lanes.
  const clear = [
    ...MAP.hqPos.map(p => ({ ...p, r: 30 })),
    ...MAP.clusters.map(p => ({ ...p, r: 16 })),
    { ...MAP.capitol, r: 20 },
    ...MAP.nodes.map(p => ({ ...p, r: 8 })),
  ];
  const isClear = (x, z, maxSlope = 0.42) => {
    if (Math.abs(x) > TUNE.mapSize / 2 + 24 || Math.abs(z) > TUNE.mapSize / 2 + 24) return false;
    if (slopeAt(x, z) > maxSlope) return false;            // no trees on cliff faces
    for (const c of clear) { const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz < c.r * c.r) return false; }
    for (const p of MAP.hqPos) if (distToSegment(x, z, p.x, p.z, 0, 0) < 6) return false;
    return true;
  };

  // Scatter bookkeeping so buildings placed mid-game can clear the ground
  // beneath them (otherwise trees poke through roofs).
  const scatterGroups = [];

  // shared: straight attribute concatenation (geometries must be non-indexed)
  const concatGeos = (parts) => {
    const names = Object.keys(parts[0].attributes);
    const outG = new THREE.BufferGeometry();
    for (const name of names) {
      const first = parts[0].attributes[name], itemSize = first.itemSize;
      let total = 0;
      for (const gp of parts) total += gp.attributes[name].count;
      const arr = new first.array.constructor(total * itemSize);
      let off = 0;
      for (const gp of parts) { arr.set(gp.attributes[name].array, off); off += gp.attributes[name].count * itemSize; }
      outG.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
    }
    return outG;
  };
  // organic displacement keyed on position (same point → same offset, no cracks)
  const jitter = (g, amt) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = Math.sin(p.getX(i) * 12.9898 + p.getY(i) * 78.233 + p.getZ(i) * 37.719) * 43758.5453;
      const j = 1 - amt / 2 + amt * (k - Math.floor(k));
      p.setXYZ(i, p.getX(i) * j, p.getY(i) * j, p.getZ(i) * j);
    }
    return g;
  };

  // trees: clumped wind-worn canopies (three jittered lobes) on leaning trunks
  // — silhouettes read as vegetation, not traffic cones
  const NT = 300;
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.3, 1.8, 6);
  const canopyGeo = (() => {
    const lobe = (r, dx, dy, dz, sy) => {
      const g = jitter(new THREE.IcosahedronGeometry(r, 1), 0.42);
      g.scale(1, sy, 1);
      g.translate(dx, dy, dz);
      return g;
    };
    const g = concatGeos([
      lobe(1.3, 0, 0, 0, 1.2),
      lobe(0.85, 0.6, 0.9, 0.3, 1.05),
      lobe(0.7, -0.65, 0.5, -0.35, 0.9),
    ]);
    g.computeVertexNormals();
    return g;
  })();
  const trunkMat = new THREE.MeshStandardMaterial({ color: THEME.scatter.trunk, roughness: 1 });
  const canopyMat = new THREE.MeshStandardMaterial({ color: THEME.scatter.canopyBase, roughness: 0.95 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, NT);
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, NT);
  trunks.castShadow = canopies.castShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  const cCanopy = new THREE.Color();
  const treePts = [];
  let placed = 0, guard = 0;
  while (placed < NT && guard++ < 4000) {
    const x = (seedRng() - 0.5) * (size - 10), z = (seedRng() - 0.5) * (size - 10);
    if (!isClear(x, z)) continue;
    const h = groundHeight(x, z);
    const sc = 0.75 + seedRng() * 0.9;
    const leanX = (seedRng() - 0.5) * 0.16, leanZ = (seedRng() - 0.5) * 0.16;
    q.setFromEuler(new THREE.Euler(leanX, seedRng() * Math.PI * 2, leanZ));
    s.set(sc * (0.85 + seedRng() * 0.35), sc, sc * (0.85 + seedRng() * 0.35));
    v.set(x, h + 0.9 * sc, z); m.compose(v, q, s); trunks.setMatrixAt(placed, m);
    v.set(x - leanZ * 1.6 * sc, h + 2.55 * sc, z + leanX * 1.6 * sc);
    m.compose(v, q, s); canopies.setMatrixAt(placed, m);
    cCanopy.setHSL(...THEME.scatter.canopy(seedRng));
    canopies.setColorAt(placed, cCanopy);
    treePts.push({ x, z });
    placed++;
  }
  trunks.count = canopies.count = placed;
  scene.add(trunks, canopies);
  scatterGroups.push({ meshes: [trunks, canopies], pts: treePts });

  // rocks — jittered rubble, tinted per instance so they don't read as clones
  const NR = 170;
  const rockGeo = (() => { const g = jitter(new THREE.IcosahedronGeometry(0.9, 1), 0.5); g.computeVertexNormals(); return g; })();
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), NR);
  rocks.castShadow = true;
  const cRock = new THREE.Color();
  const rockPts = [];
  placed = 0; guard = 0;
  while (placed < NR && guard++ < 5000) {
    const x = (seedRng() - 0.5) * (size - 8), z = (seedRng() - 0.5) * (size - 8);
    if (!isClear(x, z, 0.95)) continue;
    const sc = 0.35 + seedRng() * 1.25;
    q.setFromEuler(new THREE.Euler(seedRng() * 3, seedRng() * 3, seedRng() * 3));
    s.set(sc, sc * (0.6 + seedRng() * 0.5), sc);
    v.set(x, groundHeight(x, z) + 0.2, z);
    m.compose(v, q, s);
    rocks.setMatrixAt(placed, m);
    cRock.setHSL(...THEME.scatter.rock(seedRng));
    rocks.setColorAt(placed, cRock);
    rockPts.push({ x, z });
    placed++;
  }
  rocks.count = placed;
  scene.add(rocks);
  scatterGroups.push({ meshes: [rocks], pts: rockPts });

  // grass tufts — three splayed blades per tuft, hundreds of instances.
  // Cheap silhouette noise that makes the ground read alive at combat zoom.
  const NG = 700;
  const bladeGeo = (() => {
    // de-index BEFORE concatenating: straight attribute merges drop the index
    const one = new THREE.ConeGeometry(0.062, 1, 4, 1, true).toNonIndexed();
    one.translate(0, 0.5, 0);
    const parts = [];
    for (const [rx, rz, dx, dz] of [[0.32, 0, 0.14, 0], [-0.25, 0.28, -0.1, 0.1], [-0.1, -0.3, -0.04, -0.13]]) {
      const b = one.clone();
      b.rotateX(rx); b.rotateZ(rz); b.translate(dx, 0, dz);
      parts.push(b);
    }
    // straight concatenation — same trick as characters.js mergeParts
    const names = Object.keys(parts[0].attributes);
    const outG = new THREE.BufferGeometry();
    for (const name of names) {
      const first = parts[0].attributes[name], itemSize = first.itemSize;
      let total = 0;
      for (const gp of parts) total += gp.attributes[name].count;
      const arr = new first.array.constructor(total * itemSize);
      let off = 0;
      for (const gp of parts) { arr.set(gp.attributes[name].array, off); off += gp.attributes[name].count * itemSize; }
      outG.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
    }
    return outG;
  })();
  const grass = new THREE.InstancedMesh(bladeGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide }), NG);
  const cGrassTuft = new THREE.Color();
  const grassPts = [];
  placed = 0; guard = 0;
  while (placed < NG && guard++ < 9000) {
    const x = (seedRng() - 0.5) * (size - 12), z = (seedRng() - 0.5) * (size - 12);
    if (Math.abs(x) > TUNE.mapSize / 2 + 16 || Math.abs(z) > TUNE.mapSize / 2 + 16) continue;
    // tufts may hug gameplay areas (they're tiny) but must not sprout through
    // node pads, cluster plates, the lawn, or the worn paths
    let bad = slopeAt(x, z) > 0.5;
    if (!bad) for (const p of MAP.hqPos) if (distToSegment(x, z, p.x, p.z, 0, 0) < 4.5) { bad = true; break; }
    if (!bad) for (const p of MAP.nodes) { const dx = x - p.x, dz = z - p.z; if (dx * dx + dz * dz < 16) { bad = true; break; } }
    if (!bad) for (const p of MAP.clusters) { const dx = x - p.x, dz = z - p.z; if (dx * dx + dz * dz < 60) { bad = true; break; } }
    if (bad) continue;
    const d0 = Math.hypot(x - MAP.capitol.x, z - MAP.capitol.z);
    if (d0 < 17) continue;
    const sc = 0.55 + seedRng() * 0.85;
    q.setFromEuler(new THREE.Euler(0, seedRng() * Math.PI * 2, 0));
    s.set(sc, sc * (0.7 + seedRng() * 0.7), sc);
    v.set(x, groundHeight(x, z), z);
    m.compose(v, q, s);
    grass.setMatrixAt(placed, m);
    cGrassTuft.setHSL(...THEME.scatter.grass(seedRng));
    grass.setColorAt(placed, cGrassTuft);
    grassPts.push({ x, z });
    placed++;
  }
  grass.count = placed;
  grass.receiveShadow = true;
  scene.add(grass);
  scatterGroups.push({ meshes: [grass], pts: grassPts });

  // helper: stronger exclusion for the taller signature props
  const nearAny = (x, z, list, r) => {
    for (const p of list) { const dx = x - p.x, dz = z - p.z; if (dx * dx + dz * dz < r * r) return true; }
    return false;
  };

  // crystal trees — pale stalks with faceted mineral canopies, the reference
  // capture's signature flora. Kept well away from data nodes so nobody
  // mistakes scenery for a resource.
  const NCT = 46;
  const stalkGeo = new THREE.CylinderGeometry(0.09, 0.17, 1.5, 5);
  const crysGeoA = new THREE.IcosahedronGeometry(0.82, 0);
  const crysGeoB = new THREE.IcosahedronGeometry(0.5, 0);
  const stalks = new THREE.InstancedMesh(stalkGeo,
    new THREE.MeshStandardMaterial({ color: THEME.crystal.trunk, roughness: 0.85 }), NCT);
  const crysMat = new THREE.MeshStandardMaterial({
    color: THEME.crystal.canopy, emissive: THEME.crystal.emissive,
    emissiveIntensity: THEME.crystal.intensity, flatShading: true, roughness: 0.35, metalness: 0.05,
  });
  const crysA = new THREE.InstancedMesh(crysGeoA, crysMat, NCT);
  const crysB = new THREE.InstancedMesh(crysGeoB, crysMat, NCT);
  stalks.castShadow = crysA.castShadow = crysB.castShadow = true;
  const ctPts = [];
  placed = 0; guard = 0;
  while (placed < NCT && guard++ < 6000) {
    const x = (seedRng() - 0.5) * (size - 14), z = (seedRng() - 0.5) * (size - 14);
    if (!isClear(x, z)) continue;
    if (nearAny(x, z, MAP.nodes, 13)) continue;
    const h = groundHeight(x, z);
    const sc = 0.7 + seedRng() * 1.0;
    q.setFromEuler(new THREE.Euler(0, seedRng() * Math.PI * 2, 0));
    s.set(sc, sc, sc);
    v.set(x, h + 0.75 * sc, z); m.compose(v, q, s); stalks.setMatrixAt(placed, m);
    q.setFromEuler(new THREE.Euler(seedRng() * 0.5, seedRng() * Math.PI * 2, seedRng() * 0.5));
    v.set(x, h + (1.5 + 0.55) * sc, z);
    s.set(sc, sc * (1.15 + seedRng() * 0.5), sc);
    m.compose(v, q, s); crysA.setMatrixAt(placed, m);
    q.setFromEuler(new THREE.Euler(seedRng() * 0.8, seedRng() * Math.PI * 2, seedRng() * 0.8));
    v.set(x + (seedRng() - 0.5) * 0.7 * sc, h + (1.5 + 1.15) * sc, z + (seedRng() - 0.5) * 0.7 * sc);
    s.set(sc * 0.9, sc * 0.9, sc * 0.9);
    m.compose(v, q, s); crysB.setMatrixAt(placed, m);
    ctPts.push({ x, z });
    placed++;
  }
  stalks.count = crysA.count = crysB.count = placed;
  scene.add(stalks, crysA, crysB);
  scatterGroups.push({ meshes: [stalks, crysA, crysB], pts: ctPts });

  // cobalt boulder piles — matte blue rock clusters (no glow: the glowing
  // azure shards are the harvestable data nodes, these are just scenery)
  const NBC = 22;
  const boulderGeo = new THREE.IcosahedronGeometry(1.0, 0);
  const boulders = new THREE.InstancedMesh(boulderGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.55, metalness: 0.08 }), NBC * 3);
  boulders.castShadow = true;
  const cBoulder = new THREE.Color();
  const bPts = [];
  placed = 0; guard = 0;
  while (placed < NBC * 3 && guard++ < 6000) {
    const x = (seedRng() - 0.5) * (size - 14), z = (seedRng() - 0.5) * (size - 14);
    if (!isClear(x, z, 0.95)) continue;
    if (nearAny(x, z, MAP.nodes, 14) || nearAny(x, z, MAP.clusters, 11)) continue;
    // a pile: 3 chunks huddled around the anchor
    for (let k = 0; k < 3 && placed < NBC * 3; k++) {
      const px = x + (seedRng() - 0.5) * 1.9, pz = z + (seedRng() - 0.5) * 1.9;
      const sc = (k === 0 ? 0.9 : 0.45) + seedRng() * 0.75;
      q.setFromEuler(new THREE.Euler(seedRng() * 3, seedRng() * 3, seedRng() * 3));
      s.set(sc, sc * (0.75 + seedRng() * 0.5), sc);
      v.set(px, groundHeight(px, pz) + 0.25 * sc, pz);
      m.compose(v, q, s);
      boulders.setMatrixAt(placed, m);
      const B = THEME.boulder;
      cBoulder.setHSL(B.h + seedRng() * 0.03, B.s + seedRng() * 0.12, B.l + seedRng() * 0.12);
      boulders.setColorAt(placed, cBoulder);
      bPts.push({ x: px, z: pz });
      placed++;
    }
  }
  boulders.count = placed;
  scene.add(boulders);
  scatterGroups.push({ meshes: [boulders], pts: bPts });

  // lumen pebbles — little glowing stones that give the field its sparkle
  const NLM = 40;
  const lumen = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.3, 0),
    new THREE.MeshStandardMaterial({
      color: 0x6a6152, emissive: THEME.lumen.color, emissiveIntensity: THEME.lumen.intensity,
      flatShading: true, roughness: 0.6,
    }), NLM);
  const lmPts = [];
  placed = 0; guard = 0;
  while (placed < NLM && guard++ < 8000) {
    const x = (seedRng() - 0.5) * (size - 16), z = (seedRng() - 0.5) * (size - 16);
    if (Math.abs(x) > TUNE.mapSize / 2 + 10 || Math.abs(z) > TUNE.mapSize / 2 + 10) continue;
    if (nearAny(x, z, MAP.nodes, 5) || nearAny(x, z, MAP.clusters, 8)) continue;
    if (Math.hypot(x - MAP.capitol.x, z - MAP.capitol.z) < 18) continue;
    let onPath = false;
    for (const p of MAP.hqPos) if (distToSegment(x, z, p.x, p.z, 0, 0) < 5) { onPath = true; break; }
    if (onPath) continue;
    const sc = 0.6 + seedRng() * 0.9;
    q.setFromEuler(new THREE.Euler(seedRng() * 3, seedRng() * 3, seedRng() * 3));
    s.set(sc, sc * 0.7, sc);
    v.set(x, groundHeight(x, z) + 0.1, z);
    m.compose(v, q, s);
    lumen.setMatrixAt(placed, m);
    lmPts.push({ x, z });
    placed++;
  }
  lumen.count = placed;
  scene.add(lumen);
  scatterGroups.push({ meshes: [lumen], pts: lmPts });

  // Capitol lawn — a soft circle of tended green under the dome.
  const lawnMap = grassMap.clone();
  lawnMap.repeat.set(2.6, 2.6);
  lawnMap.needsUpdate = true;
  const lawn = new THREE.Mesh(
    new THREE.CircleGeometry(15, 40),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(THEME.lawn).lerp(new THREE.Color(0xffffff), 0.45), map: lawnMap, roughness: 1 })
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(MAP.capitol.x, groundHeight(MAP.capitol.x, MAP.capitol.z) + 0.05, MAP.capitol.z);
  lawn.receiveShadow = true;
  scene.add(lawn);

  // grade the pads that exist from the first frame: HQ campuses, the capitol
  // hill and the GPU cluster yards (buildings placed mid-game grade on spawn)
  for (const p of MAP.hqPos) flattenSite(p.x, p.z, 8.0, 11.5);
  flattenSite(MAP.capitol.x, MAP.capitol.z, 8.9, 12.5);
  for (const c of MAP.clusters) flattenSite(c.x, c.z, 6.9, 10);

  // Bulldoze scatter under a footprint (called when construction starts, so
  // nothing ever pokes through a roof). Instances collapse to zero scale.
  const gone = new THREE.Matrix4().makeScale(0, 0, 0);
  function clearAround(x, z, r) {
    const r2 = r * r;
    for (const grp of scatterGroups) {
      let dirty = false;
      for (let i = 0; i < grp.pts.length; i++) {
        const p = grp.pts[i];
        if (p.gone) continue;
        const dx = p.x - x, dz = p.z - z;
        if (dx * dx + dz * dz > r2) continue;
        p.gone = true; dirty = true;
        for (const mesh of grp.meshes) mesh.setMatrixAt(i, gone);
      }
      if (dirty) for (const mesh of grp.meshes) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  return { ground, clearAround, flattenSite };
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  const x = ax + dx * t, z = az + dz * t;
  return Math.hypot(px - x, pz - z);
}
