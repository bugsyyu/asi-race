// ============================================================================
// Terrain — vertex-colored ground driven by the same heightfield the sim uses,
// plus instanced trees/rocks kept clear of gameplay areas.
// ============================================================================
import * as THREE from 'three';
import { groundHeight } from '../shared/height.js';
import { MAP, TUNE } from '../sim/constants.js';

export function buildTerrain(scene, seedRng) {
  const size = TUNE.mapSize + 60, segs = 150;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cBase = new THREE.Color('#3f3a58');   // dusk violet ground
  const cWarm = new THREE.Color('#6e4f52');   // sun-warmed faces
  const cLow = new THREE.Color('#2b2740');    // hollows
  const cPath = new THREE.Color('#524a63');
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = groundHeight(x, z);
    pos.setY(i, h);
    // slope-ish shading: sample height a bit toward the sun (-x)
    const hs = groundHeight(x - 2.5, z + 0.8);
    const litFace = THREE.MathUtils.clamp((h - hs) * 0.9 + 0.28, 0, 1);
    tmp.copy(cLow).lerp(cBase, THREE.MathUtils.clamp(h * 0.5 + 0.55, 0, 1)).lerp(cWarm, litFace * 0.55);
    // faint worn paths from each HQ toward the capitol
    for (const p of MAP.hqPos) {
      const d = distToSegment(x, z, p.x, p.z, 0, 0);
      if (d < 3.4) tmp.lerp(cPath, 0.5 * (1 - d / 3.4));
    }
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }));
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

  // trees: cone canopy + trunk, two instanced meshes
  const NT = 240;
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 1.6, 5);
  const canopyGeo = new THREE.ConeGeometry(1.5, 3.4, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3c2f33, roughness: 1 });
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2e4a44, roughness: 0.95 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, NT);
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, NT);
  trunks.castShadow = canopies.castShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  const cCanopy = new THREE.Color();
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
    cCanopy.setHSL(0.42 + seedRng() * 0.06, 0.32, 0.2 + seedRng() * 0.1);
    canopies.setColorAt(placed, cCanopy);
    placed++;
  }
  trunks.count = canopies.count = placed;
  scene.add(trunks, canopies);

  // rocks
  const NR = 90;
  const rockGeo = new THREE.IcosahedronGeometry(0.9, 0);
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x565064, roughness: 1, flatShading: true }), NR);
  rocks.castShadow = true;
  placed = 0; guard = 0;
  while (placed < NR && guard++ < 3000) {
    const x = (seedRng() - 0.5) * (size - 8), z = (seedRng() - 0.5) * (size - 8);
    if (!isClear(x, z)) continue;
    const sc = 0.4 + seedRng() * 1.1;
    q.setFromEuler(new THREE.Euler(seedRng() * 3, seedRng() * 3, seedRng() * 3));
    s.set(sc, sc * (0.6 + seedRng() * 0.5), sc);
    v.set(x, groundHeight(x, z) + 0.2, z);
    m.compose(v, q, s);
    rocks.setMatrixAt(placed, m);
    placed++;
  }
  rocks.count = placed;
  scene.add(rocks);

  // Capitol lawn — a soft circle of green under the dome.
  const lawn = new THREE.Mesh(
    new THREE.CircleGeometry(15, 40),
    new THREE.MeshStandardMaterial({ color: 0x33503f, roughness: 1 })
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(MAP.capitol.x, groundHeight(MAP.capitol.x, MAP.capitol.z) + 0.05, MAP.capitol.z);
  lawn.receiveShadow = true;
  scene.add(lawn);

  return { ground };
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  const x = ax + dx * t, z = az + dz * t;
  return Math.hypot(px - x, pz - z);
}
