// ============================================================================
// Terrain — vertex-colored ground driven by the same heightfield the sim uses,
// plus instanced trees/rocks kept clear of gameplay areas.
// ============================================================================
import * as THREE from 'three';
import { groundHeight } from '../shared/height.js';
import { MAP, TUNE } from '../sim/constants.js';
import { THEME } from './theme.js';

// Tileable mottle texture: multiplied over the vertex colors it gives the
// ground per-meter grain (soil clods, worn grass) that vertex colors alone
// can't resolve. Values hover around 1 so the palette stays authored below.
function detailTexture(seedRng) {
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  // multiplier texture: stays near white so the authored palette survives
  g.fillStyle = '#ececec'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 3600; i++) {                    // soil clods, slightly dark
    const v = 185 + Math.floor(seedRng() * 42);
    g.fillStyle = `rgba(${v},${v},${v},${0.18 + seedRng() * 0.22})`;
    g.beginPath();
    g.arc(seedRng() * S, seedRng() * S, 1 + seedRng() * 4.5, 0, 7);
    g.fill();
  }
  for (let i = 0; i < 1500; i++) {                    // sun-catching flecks
    g.fillStyle = `rgba(255,255,255,${0.12 + seedRng() * 0.18})`;
    g.beginPath();
    g.arc(seedRng() * S, seedRng() * S, 0.6 + seedRng() * 2, 0, 7);
    g.fill();
  }
  for (let i = 0; i < 800; i++) {                     // blade-like scratches
    const v = 205 + Math.floor(seedRng() * 50);
    g.strokeStyle = `rgba(${v},${v},${v},0.3)`;
    const x = seedRng() * S, y = seedRng() * S, a = seedRng() * Math.PI;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 4, y + Math.sin(a) * 4); g.stroke();
  }
  if (THEME.flecks) {
    // colored speckles for the sunlit look: green growth + dry straw
    for (let i = 0; i < 1500; i++) {
      g.fillStyle = `rgba(${120 + (seedRng() * 40) | 0},${170 + (seedRng() * 40) | 0},${80 + (seedRng() * 30) | 0},${0.14 + seedRng() * 0.2})`;
      g.beginPath(); g.arc(seedRng() * S, seedRng() * S, 0.6 + seedRng() * 1.8, 0, 7); g.fill();
    }
    for (let i = 0; i < 700; i++) {
      g.fillStyle = `rgba(235,${215 + (seedRng() * 25) | 0},160,${0.12 + seedRng() * 0.16})`;
      g.beginPath(); g.arc(seedRng() * S, seedRng() * S, 0.5 + seedRng() * 1.4, 0, 7); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(46, 46);
  t.anisotropy = 4;
  return t;
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
    // faint worn paths from each HQ toward the capitol
    for (const p of MAP.hqPos) {
      const d = distToSegment(x, z, p.x, p.z, 0, 0);
      if (d < 3.4) tmp.lerp(cPath, 0.5 * (1 - d / 3.4));
    }
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const groundMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.96, metalness: 0,
    map: detailTexture(seedRng),
  });
  groundMat.color.setScalar(1.09); // rebalance the near-white multiplier map
  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);

  // Scatter: keep clear of HQs, capitol, clusters, nodes and travel lanes.
  const clear = [
    ...MAP.hqPos.map(p => ({ ...p, r: 30 })),
    ...MAP.clusters.map(p => ({ ...p, r: 16 })),
    { ...MAP.capitol, r: 20 },
    ...MAP.nodes.map(p => ({ ...p, r: 8 })),
  ];
  const isClear = (x, z) => {
    if (Math.abs(x) > TUNE.mapSize / 2 + 24 || Math.abs(z) > TUNE.mapSize / 2 + 24) return false;
    for (const c of clear) { const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz < c.r * c.r) return false; }
    for (const p of MAP.hqPos) if (distToSegment(x, z, p.x, p.z, 0, 0) < 6) return false;
    return true;
  };

  // Scatter bookkeeping so buildings placed mid-game can clear the ground
  // beneath them (otherwise trees poke through roofs).
  const scatterGroups = [];

  // trees: cone canopy + trunk, two instanced meshes
  const NT = 300;
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 1.6, 5);
  const canopyGeo = new THREE.ConeGeometry(1.5, 3.4, 6);
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
    q.setFromEuler(new THREE.Euler(0, seedRng() * Math.PI * 2, 0));
    s.set(sc, sc, sc);
    v.set(x, h + 0.8 * sc, z); m.compose(v, q, s); trunks.setMatrixAt(placed, m);
    v.set(x, h + (1.6 + 1.4) * sc, z); m.compose(v, q, s); canopies.setMatrixAt(placed, m);
    cCanopy.setHSL(...THEME.scatter.canopy(seedRng));
    canopies.setColorAt(placed, cCanopy);
    treePts.push({ x, z });
    placed++;
  }
  trunks.count = canopies.count = placed;
  scene.add(trunks, canopies);
  scatterGroups.push({ meshes: [trunks, canopies], pts: treePts });

  // rocks — more of them, tinted per instance so they don't read as clones
  const NR = 170;
  const rockGeo = new THREE.IcosahedronGeometry(0.9, 0);
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), NR);
  rocks.castShadow = true;
  const cRock = new THREE.Color();
  const rockPts = [];
  placed = 0; guard = 0;
  while (placed < NR && guard++ < 5000) {
    const x = (seedRng() - 0.5) * (size - 8), z = (seedRng() - 0.5) * (size - 8);
    if (!isClear(x, z)) continue;
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
    const one = new THREE.ConeGeometry(0.085, 1, 4, 1, true).toNonIndexed();
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
    let bad = false;
    for (const p of MAP.hqPos) if (distToSegment(x, z, p.x, p.z, 0, 0) < 4.5) { bad = true; break; }
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
  const NCT = 64;
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
    if (!isClear(x, z)) continue;
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
  const NLM = 60;
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

  // Capitol lawn — a soft circle of green under the dome.
  const lawn = new THREE.Mesh(
    new THREE.CircleGeometry(15, 40),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(THEME.lawn), roughness: 1 })
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(MAP.capitol.x, groundHeight(MAP.capitol.x, MAP.capitol.z) + 0.05, MAP.capitol.z);
  lawn.receiveShadow = true;
  scene.add(lawn);

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

  return { ground, clearAround };
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  const x = ax + dx * t, z = az + dz * t;
  return Math.hypot(px - x, pz - z);
}
