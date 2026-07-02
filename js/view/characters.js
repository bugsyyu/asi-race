// ============================================================================
// Characters — genuine skeletal animation. Each unit is a SkinnedMesh bound to
// a 14-bone rig; walk/work/attack/channel/carry clips are authored in code as
// keyframe tracks and played through an AnimationMixer. Rigid per-part weights.
// ============================================================================
import * as THREE from 'three';
// Local merge (replaces three/addons BufferGeometryUtils so the whole game
// needs only build/three.module.js). All parts are non-indexed and share the
// exact same attribute set, so merging is straight concatenation.
function mergeParts(parts) {
  const names = Object.keys(parts[0].attributes);
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const first = parts[0].attributes[name];
    const itemSize = first.itemSize;
    let total = 0;
    for (const g of parts) total += g.attributes[name].count;
    const array = new first.array.constructor(total * itemSize);
    let off = 0;
    for (const g of parts) {
      const a = g.attributes[name];
      array.set(a.array, off);
      off += a.count * itemSize;
    }
    out.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }
  return out;
}

const BONES = [
  'hips', 'spine', 'chest', 'head',
  'armL', 'forearmL', 'armR', 'forearmR',
  'thighL', 'shinL', 'thighR', 'shinR',
];
const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));

// Bind-pose joint positions (local offsets parent→child).
const RIG = {
  hips:     { parent: null,    pos: [0, 1.06, 0] },
  spine:    { parent: 'hips',  pos: [0, 0.22, 0] },
  chest:    { parent: 'spine', pos: [0, 0.30, 0] },
  head:     { parent: 'chest', pos: [0, 0.34, 0] },
  armL:     { parent: 'chest', pos: [-0.40, 0.20, 0] },
  forearmL: { parent: 'armL',  pos: [0, -0.34, 0] },
  armR:     { parent: 'chest', pos: [0.40, 0.20, 0] },
  forearmR: { parent: 'armR',  pos: [0, -0.34, 0] },
  thighL:   { parent: 'hips',  pos: [-0.17, -0.05, 0] },
  shinL:    { parent: 'thighL', pos: [0, -0.46, 0] },
  thighR:   { parent: 'hips',  pos: [0.17, -0.05, 0] },
  shinR:    { parent: 'thighR', pos: [0, -0.46, 0] },
};

// world-space bind position of each bone (for placing body parts)
const BIND = {};
{
  for (const name of BONES) {
    let p = [0, 0, 0], n = name;
    while (n) { const r = RIG[n]; p = [p[0] + r.pos[0], p[1] + r.pos[1], p[2] + r.pos[2]]; n = r.parent; }
    BIND[name] = p;
  }
}

const SKIN_TONES = [0xd9a184, 0xb97a5b, 0x8c5a3f, 0xf0c3a0, 0x6e4630];

// ---------------------------------------------------------------------------
// Body geometry — each part rigidly weighted to one bone, then merged.
// ---------------------------------------------------------------------------
function part(geo, bone, dx = 0, dy = 0, dz = 0) {
  const [bx, by, bz] = BIND[bone];
  geo.translate(bx + dx, by + dy, bz + dz);
  const n = geo.attributes.position.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = BI[bone]; sw[i * 4] = 1; }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  return geo;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0, r1, h, s = 6) => new THREE.CylinderGeometry(r0, r1, h, s);

function buildBody(unitType, factionColor, rng) {
  const fc = new THREE.Color(factionColor);
  const dark = fc.clone().multiplyScalar(0.42);
  const skin = new THREE.Color(SKIN_TONES[Math.floor(rng() * SKIN_TONES.length)]);
  const pants = new THREE.Color(0x2c2b3a);
  const boot = new THREE.Color(0x1c1b26);
  const visor = new THREE.Color(0xaef2ff);

  const parts = [];
  const push = (geo, color, emissive = 0) => {
    const g = geo.toNonIndexed();
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3), emi = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b;
      emi[i * 3] = color.r * emissive; emi[i * 3 + 1] = color.g * emissive; emi[i * 3 + 2] = color.b * emissive;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('emissiveCol', new THREE.BufferAttribute(emi, 3));
    parts.push(g);
  };

  // core body
  push(part(box(0.44, 0.26, 0.30), 'hips', 0, -0.02, 0), pants);
  push(part(box(0.56, 0.52, 0.34), 'chest', 0, 0.02, 0), fc);              // jacket
  push(part(box(0.58, 0.14, 0.36), 'chest', 0, -0.24, 0), dark);           // belt band
  push(part(new THREE.SphereGeometry(0.21, 8, 7), 'head', 0, 0.16, 0), skin);
  push(part(box(0.30, 0.055, 0.05), 'head', 0, 0.17, 0.185), visor, 0.9);  // AR visor strip
  // arms: upper in jacket color, forearm skin, mitt hands
  push(part(cyl(0.085, 0.095, 0.34), 'armL', 0, -0.16, 0), fc);
  push(part(cyl(0.075, 0.085, 0.30), 'forearmL', 0, -0.14, 0), skin);
  push(part(new THREE.SphereGeometry(0.085, 6, 5), 'forearmL', 0, -0.30, 0), skin);
  push(part(cyl(0.085, 0.095, 0.34), 'armR', 0, -0.16, 0), fc);
  push(part(cyl(0.075, 0.085, 0.30), 'forearmR', 0, -0.14, 0), skin);
  push(part(new THREE.SphereGeometry(0.085, 6, 5), 'forearmR', 0, -0.30, 0), skin);
  // legs
  push(part(cyl(0.10, 0.11, 0.44), 'thighL', 0, -0.22, 0), pants);
  push(part(cyl(0.09, 0.10, 0.40), 'shinL', 0, -0.18, 0), pants);
  push(part(box(0.16, 0.10, 0.26), 'shinL', 0, -0.40, 0.05), boot);
  push(part(cyl(0.10, 0.11, 0.44), 'thighR', 0, -0.22, 0), pants);
  push(part(cyl(0.09, 0.10, 0.40), 'shinR', 0, -0.18, 0), pants);
  push(part(box(0.16, 0.10, 0.26), 'shinR', 0, -0.40, 0.05), boot);

  // role accessories --------------------------------------------------------
  if (unitType === 'researcher') {
    push(part(cyl(0.225, 0.235, 0.10, 8), 'head', 0, 0.26, 0), fc);        // cap
    push(part(box(0.26, 0.04, 0.16), 'head', 0, 0.24, 0.24), fc);          // visor brim
    push(part(box(0.34, 0.42, 0.16), 'chest', 0, 0, -0.26), dark);         // field pack
  } else if (unitType === 'secops') {
    push(part(new THREE.SphereGeometry(0.25, 8, 6), 'head', 0, 0.18, 0), dark); // helmet
    push(part(box(0.20, 0.10, 0.20), 'armL', -0.06, 0.04, 0), dark);       // pauldrons
    push(part(box(0.20, 0.10, 0.20), 'armR', 0.06, 0.04, 0), dark);
    push(part(cyl(0.035, 0.035, 0.62), 'forearmR', 0, -0.34, 0.10), new THREE.Color(0x30364a)); // shock baton
    push(part(new THREE.SphereGeometry(0.05, 6, 5), 'forearmR', 0, -0.64, 0.10), visor, 1.4);   // baton tip
    push(part(box(0.60, 0.56, 0.10), 'chest', 0, 0, 0.20), dark);          // chest plate
  } else if (unitType === 'cyberops') {
    push(part(box(0.34, 0.10, 0.24), 'head', 0, 0.14, 0.10), dark);        // opaque visor
    push(part(box(0.30, 0.44, 0.18), 'chest', 0, 0, -0.28), dark);         // rig pack
    push(part(cyl(0.02, 0.02, 0.5), 'chest', 0.12, 0.32, -0.30), fc, 0.8); // antenna
    push(part(box(0.10, 0.10, 0.44), 'forearmR', 0, -0.28, 0.12), new THREE.Color(0x30364a)); // packet launcher
    push(part(box(0.05, 0.05, 0.06), 'forearmR', 0, -0.28, 0.36), visor, 1.6);
  } else if (unitType === 'lobbyist') {
    push(part(box(0.10, 0.30, 0.03), 'chest', 0, -0.05, 0.185), new THREE.Color(0xc9435a)); // tie
    push(part(box(0.30, 0.24, 0.08), 'forearmL', 0, -0.30, 0.06), new THREE.Color(0x5a4632)); // briefcase
    push(part(cyl(0.235, 0.245, 0.06, 8), 'head', 0, 0.30, 0), dark);      // natty hat
  }

  const merged = mergeParts(parts);
  merged.computeVertexNormals();
  return merged;
}

// ---------------------------------------------------------------------------
// Animation clips — authored keyframes, shared across all characters.
// ---------------------------------------------------------------------------
const E = (x = 0, y = 0, z = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
function qTrack(bone, times, eulers) {
  const vals = [];
  for (const e of eulers) { const q = E(...e); vals.push(q.x, q.y, q.z, q.w); }
  return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, vals);
}
function pTrack(bone, times, offsets) {
  const [bx, by, bz] = RIG[bone].pos, vals = [];
  for (const o of offsets) vals.push(bx + o[0], by + o[1], bz + o[2]);
  return new THREE.VectorKeyframeTrack(`${bone}.position`, times, vals);
}

function buildClips() {
  const clips = {};
  { // idle — breathe, tiny head drift
    const t = [0, 1.2, 2.4];
    clips.idle = new THREE.AnimationClip('idle', 2.4, [
      qTrack('spine', t, [[0.02, 0, 0], [0.05, 0, 0], [0.02, 0, 0]]),
      qTrack('head', t, [[0, -0.10, 0], [0.04, 0.10, 0], [0, -0.10, 0]]),
      qTrack('armL', t, [[0.06, 0, 0.06], [0.10, 0, 0.08], [0.06, 0, 0.06]]),
      qTrack('armR', t, [[0.06, 0, -0.06], [0.10, 0, -0.08], [0.06, 0, -0.06]]),
      pTrack('hips', t, [[0, 0, 0], [0, -0.015, 0], [0, 0, 0]]),
    ]);
  }
  { // walk — 0.66s stride
    const t = [0, 0.165, 0.33, 0.495, 0.66];
    const A = 0.62, S = 0.85, R = 0.5;
    clips.walk = new THREE.AnimationClip('walk', 0.66, [
      qTrack('thighL', t, [[A, 0, 0], [0, 0, 0], [-A, 0, 0], [0, 0, 0], [A, 0, 0]]),
      qTrack('thighR', t, [[-A, 0, 0], [0, 0, 0], [A, 0, 0], [0, 0, 0], [-A, 0, 0]]),
      qTrack('shinL', t, [[0.15, 0, 0], [S, 0, 0], [0.3, 0, 0], [0.05, 0, 0], [0.15, 0, 0]]),
      qTrack('shinR', t, [[0.3, 0, 0], [0.05, 0, 0], [0.15, 0, 0], [S, 0, 0], [0.3, 0, 0]]),
      qTrack('armL', t, [[-R, 0, 0.08], [0, 0, 0.08], [R, 0, 0.08], [0, 0, 0.08], [-R, 0, 0.08]]),
      qTrack('armR', t, [[R, 0, -0.08], [0, 0, -0.08], [-R, 0, -0.08], [0, 0, -0.08], [R, 0, -0.08]]),
      qTrack('forearmL', t, [[-0.4, 0, 0], [-0.25, 0, 0], [-0.15, 0, 0], [-0.25, 0, 0], [-0.4, 0, 0]]),
      qTrack('forearmR', t, [[-0.15, 0, 0], [-0.25, 0, 0], [-0.4, 0, 0], [-0.25, 0, 0], [-0.15, 0, 0]]),
      qTrack('spine', t, [[0.07, 0.08, 0], [0.07, 0, 0], [0.07, -0.08, 0], [0.07, 0, 0], [0.07, 0.08, 0]]),
      pTrack('hips', t, [[0, 0, 0], [0, 0.05, 0], [0, 0, 0], [0, 0.05, 0], [0, 0, 0]]),
    ]);
  }
  { // work — kneel-ish hammering
    const t = [0, 0.24, 0.5];
    clips.work = new THREE.AnimationClip('work', 0.5, [
      qTrack('spine', t, [[0.34, 0, 0], [0.48, 0, 0], [0.34, 0, 0]]),
      qTrack('armR', t, [[-2.0, 0, -0.15], [-0.6, 0, -0.15], [-2.0, 0, -0.15]]),
      qTrack('forearmR', t, [[-0.9, 0, 0], [-0.2, 0, 0], [-0.9, 0, 0]]),
      qTrack('armL', t, [[-0.5, 0, 0.3], [-0.4, 0, 0.3], [-0.5, 0, 0.3]]),
      qTrack('head', t, [[0.35, 0, 0], [0.35, 0, 0], [0.35, 0, 0]]),
      pTrack('hips', t, [[0, -0.06, 0], [0, -0.1, 0], [0, -0.06, 0]]),
    ]);
  }
  { // attack — big swing (melee) / recoil (ranged reads fine too)
    const t = [0, 0.16, 0.34, 0.6];
    clips.attack = new THREE.AnimationClip('attack', 0.6, [
      qTrack('armR', t, [[-2.5, 0, -0.4], [-2.7, 0, -0.4], [-0.4, 0, -0.1], [-2.5, 0, -0.4]]),
      qTrack('forearmR', t, [[-1.1, 0, 0], [-1.2, 0, 0], [-0.1, 0, 0], [-1.1, 0, 0]]),
      qTrack('armL', t, [[-0.8, 0, 0.5], [-0.9, 0, 0.5], [-0.3, 0, 0.4], [-0.8, 0, 0.5]]),
      qTrack('spine', t, [[0.05, -0.4, 0], [0.05, -0.5, 0], [0.18, 0.35, 0], [0.05, -0.4, 0]]),
      qTrack('head', t, [[0, 0.2, 0], [0, 0.25, 0], [0, -0.1, 0], [0, 0.2, 0]]),
    ]);
  }
  { // channel — arms raised to the dome, slow sway
    const t = [0, 1.0, 2.0];
    clips.channel = new THREE.AnimationClip('channel', 2.0, [
      qTrack('armL', t, [[-2.7, 0, 0.35], [-2.9, 0, 0.25], [-2.7, 0, 0.35]]),
      qTrack('armR', t, [[-2.7, 0, -0.35], [-2.9, 0, -0.25], [-2.7, 0, -0.35]]),
      qTrack('forearmL', t, [[-0.25, 0, 0], [-0.15, 0, 0], [-0.25, 0, 0]]),
      qTrack('forearmR', t, [[-0.25, 0, 0], [-0.15, 0, 0], [-0.25, 0, 0]]),
      qTrack('spine', t, [[-0.06, 0.06, 0], [-0.1, -0.06, 0], [-0.06, 0.06, 0]]),
      qTrack('head', t, [[-0.3, 0, 0], [-0.35, 0, 0], [-0.3, 0, 0]]),
    ]);
  }
  { // carry — walking legs, arms hugging a crate forward
    const w = clips.walk;
    const t = [0, 0.33, 0.66];
    const tracks = w.tracks.filter(tr => !/arm|forearm/.test(tr.name)).map(tr => tr.clone());
    tracks.push(
      qTrack('armL', t, [[-1.15, 0, 0.35], [-1.2, 0, 0.35], [-1.15, 0, 0.35]]),
      qTrack('armR', t, [[-1.15, 0, -0.35], [-1.2, 0, -0.35], [-1.15, 0, -0.35]]),
      qTrack('forearmL', t, [[-0.7, 0.5, 0], [-0.72, 0.5, 0], [-0.7, 0.5, 0]]),
      qTrack('forearmR', t, [[-0.7, -0.5, 0], [-0.72, -0.5, 0], [-0.7, -0.5, 0]]),
    );
    clips.carry = new THREE.AnimationClip('carry', 0.66, tracks);
  }
  { // flee — frantic walk, arms up
    const w = clips.walk;
    const tracks = w.tracks.filter(tr => !/arm/.test(tr.name)).map(tr => tr.clone());
    const t = [0, 0.33, 0.66];
    tracks.push(
      qTrack('armL', t, [[-2.6, 0, 0.6], [-2.8, 0, 0.5], [-2.6, 0, 0.6]]),
      qTrack('armR', t, [[-2.6, 0, -0.6], [-2.8, 0, -0.5], [-2.6, 0, -0.6]]),
    );
    clips.flee = new THREE.AnimationClip('flee', 0.66, tracks);
  }
  return clips;
}
let CLIPS = null;

// ---------------------------------------------------------------------------
export function makeCharacter(unitType, factionDef, rngSeed = Math.random()) {
  if (!CLIPS) CLIPS = buildClips();
  let s = rngSeed * 2147483647 | 0;
  const rng = () => ((s = (s * 16807) % 2147483647) & 0x7fffffff) / 2147483647;

  // bones
  const bones = [];
  const byName = {};
  for (const name of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(...RIG[name].pos);
    bones.push(b); byName[name] = b;
  }
  for (const name of BONES) if (RIG[name].parent) byName[RIG[name].parent].add(byName[name]);

  const geo = buildBody(unitType, factionDef.color, rng);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.06 });
  // per-vertex emissive via onBeforeCompile: visors, baton tips glow into bloom
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 emissiveCol; varying vec3 vEmi;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmi = emissiveCol;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEmi;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vEmi;');
  };

  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.castShadow = true;
  mesh.add(byName.hips);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.frustumCulled = false; // skinned bounds are unreliable; units are few

  const group = new THREE.Group();
  group.add(mesh);

  const mixer = new THREE.AnimationMixer(mesh);
  const actions = {};
  for (const k in CLIPS) {
    actions[k] = mixer.clipAction(CLIPS[k]);
    actions[k].play(); actions[k].setEffectiveWeight(k === 'idle' ? 1 : 0);
  }
  // desync loops between individuals
  for (const k in actions) actions[k].time = rng() * CLIPS[k].duration;

  let current = 'idle';
  function setAnim(name, speedScale = 1) {
    const next = actions[name] ? name : 'idle';
    if (next !== current) {
      actions[current].fadeOut(0.14);
      actions[next].reset().fadeIn(0.14).play();
      current = next;
    }
    actions[next].setEffectiveTimeScale(speedScale);
  }

  return { group, mesh, mixer, setAnim, get anim() { return current; } };
}
