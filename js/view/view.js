// ============================================================================
// View — keeps a visual twin of every sim entity. Interpolated positions,
// animation state mapping, health bars, selection rings, raycast picking.
// ============================================================================
import * as THREE from 'three';
import { FACTIONS, TUNE } from '../sim/constants.js';
import { groundHeight } from '../shared/height.js';
import { makeCharacter } from './characters.js';
import { makeBuilding, makeNode, makeCluster, makeCapitol } from './buildings.js';

const BUILD_H = { hq: 9.2, datacenter: 4.4, lab: 5.2, institute: 5.6, secoffice: 4.2, policy: 5.6, tower: 7.2 };

function makeBar() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 10;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(2.3, 0.36, 1);
  sp.visible = false;
  return { sp, tex, c, last: -1 };
}
function drawBar(bar, frac, build = false) {
  const q = Math.round(frac * 40) + (build ? 1000 : 0);
  if (q === bar.last) return;
  bar.last = q;
  const g = bar.c.getContext('2d');
  g.clearRect(0, 0, 64, 10);
  g.fillStyle = 'rgba(8,8,14,0.85)'; g.fillRect(0, 0, 64, 10);
  const w = Math.max(1, Math.round(60 * frac));
  g.fillStyle = build ? '#ffb27a' : frac > 0.55 ? '#7ddf9a' : frac > 0.28 ? '#ffcf6e' : '#ff6e6e';
  g.fillRect(2, 2, w, 6);
  bar.tex.needsUpdate = true;
}

function makeRing(r, hex) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(r * 0.82, r, 28),
    new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.visible = false;
  return m;
}

function hitCyl(r, h, entId) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8), new THREE.MeshBasicMaterial({ visible: false }));
  m.position.y = h / 2;
  m.userData.entId = entId;
  return m;
}

export function createView(scene, game, fx) {
  const reg = new Map();       // ent id -> vis
  const hits = [];             // pickable meshes
  const selected = new Set();
  let ground = null;           // set via setGround

  // ---- statics ----
  {
    const cap = makeCapitol();
    cap.group.position.set(game.capitol.x, groundHeight(game.capitol.x, game.capitol.z), game.capitol.z);
    scene.add(cap.group);
    const h = hitCyl(9.5, 9, game.capitol.id); cap.group.add(h); hits.push(h);
    reg.set(game.capitol.id, { kind: 'capitol', group: cap.group, api: cap });
  }
  for (const c of game.clusters) {
    const v = makeCluster();
    v.group.position.set(c.x, groundHeight(c.x, c.z), c.z);
    scene.add(v.group);
    const h = hitCyl(6.4, 3.4, c.id); v.group.add(h); hits.push(h);
    reg.set(c.id, { kind: 'cluster', group: v.group, api: v, owner: -2, capQ: -1 });
  }

  function addNodeVis(n) {
    const v = makeNode();
    v.group.position.set(n.x, groundHeight(n.x, n.z), n.z);
    scene.add(v.group);
    const h = hitCyl(2.3, 3.4, n.id); v.group.add(h); hits.push(h);
    reg.set(n.id, { kind: 'node', group: v.group, api: v });
  }
  for (const n of game.nodes) addNodeVis(n);

  // ---- dynamic creation ----
  function addUnitVis(u) {
    const fdef = FACTIONS[u.faction];
    const ch = makeCharacter(u.type, fdef, (((u.id * 2654435761) % 2147483646) + 1) / 2147483647);
    ch.group.position.set(u.x, groundHeight(u.x, u.z), u.z);
    scene.add(ch.group);
    const ring = makeRing(1.05, 0xffffff);
    ring.position.y = 0.13; ch.group.add(ring);
    const bar = makeBar(); bar.sp.position.y = 2.9; ch.group.add(bar.sp);
    const h = hitCyl(0.95, 2.6, u.id); ch.group.add(h); hits.push(h);
    reg.set(u.id, { kind: 'unit', group: ch.group, char: ch, ring, bar, hit: h, yaw: 0 });
  }
  function addBuildingVis(b) {
    const fdef = FACTIONS[b.faction];
    const v = makeBuilding(b.type, fdef, b.fp);
    v.group.position.set(b.x, groundHeight(b.x, b.z), b.z);
    scene.add(v.group);
    const ring = makeRing(b.fp + 1.1, 0xffffff);
    ring.position.y = 0.12; v.group.add(ring);
    const bar = makeBar(); bar.sp.position.y = BUILD_H[b.type] + 1.2; bar.sp.scale.set(3.4, 0.42, 1); v.group.add(bar.sp);
    const h = hitCyl(Math.max(1.6, b.fp * 0.95), Math.max(4, BUILD_H[b.type]), b.id); v.group.add(h); hits.push(h);
    // rally flag
    const flag = new THREE.Group();
    flag.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6),
      new THREE.MeshBasicMaterial({ color: 0xe9ecf4 })));
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.6),
      new THREE.MeshBasicMaterial({ color: fdef.accent, side: THREE.DoubleSide }));
    cloth.position.set(0.5, 0.9, 0); flag.add(cloth);
    flag.children[0].position.y = 1.2;
    flag.visible = false; scene.add(flag);
    reg.set(b.id, { kind: 'building', group: v.group, api: v, ring, bar, hit: h, flag });
  }

  function removeVis(id) {
    const v = reg.get(id);
    if (!v) return;
    scene.remove(v.group);
    if (v.flag) scene.remove(v.flag);
    if (v.hit) { const i = hits.indexOf(v.hit); if (i >= 0) hits.splice(i, 1); }
    reg.delete(id);
    selected.delete(id);
  }

  // ---- selection ----
  function setSelection(ids) {
    for (const id of selected) {
      const v = reg.get(id);
      if (v && v.ring) v.ring.visible = false;
      if (v && v.flag) v.flag.visible = false;
    }
    selected.clear();
    for (const id of ids) {
      const v = reg.get(id);
      if (!v) continue;
      selected.add(id);
      if (v.ring) v.ring.visible = true;
    }
  }

  // ---- picking ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(clientX, clientY, camera, groundOnly = false) {
    ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!groundOnly) {
      const hs = ray.intersectObjects(hits, false);
      if (hs.length) {
        const ent = game.ents.get(hs[0].object.userData.entId);
        if (ent) return { ent, point: hs[0].point };
      }
    }
    if (ground) {
      const gs = ray.intersectObject(ground, false);
      if (gs.length) return { ent: null, point: gs[0].point };
    }
    return null;
  }

  // ---- per-frame sync ----
  const euler = new THREE.Euler();
  function sync(alpha, dt, time) {
    // create missing
    for (const u of game.units) if (!reg.has(u.id)) addUnitVis(u);
    for (const b of game.buildings) if (!reg.has(b.id)) addBuildingVis(b);
    // remove gone
    for (const id of [...reg.keys()]) {
      const v = reg.get(id);
      if ((v.kind === 'unit' || v.kind === 'building' || v.kind === 'node') && !game.ents.has(id)) removeVis(id);
    }

    for (const u of game.units) {
      const v = reg.get(u.id);
      if (!v) continue;
      const x = u.px + (u.x - u.px) * alpha;
      const z = u.pz + (u.z - u.pz) * alpha;
      v.group.position.set(x, groundHeight(x, z), z);
      // facing — shortest-arc ease
      let d = u.facing - v.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      v.yaw += d * Math.min(1, dt * 10);
      v.group.rotation.y = v.yaw;
      // animation
      let anim = u.anim;
      if (u.state === 'flee') anim = 'flee';
      else if (anim === 'walk' && u.carry >= TUNE.carryCap * 0.5) anim = 'carry';
      v.char.setAnim(anim, anim === 'walk' || anim === 'carry' || anim === 'flee' ? 1.05 : 1);
      v.char.mixer.update(dt);
      // health bar
      const show = u.hp < u.maxHp || selected.has(u.id);
      v.bar.sp.visible = show;
      if (show) drawBar(v.bar, u.hp / u.maxHp);
    }

    for (const b of game.buildings) {
      const v = reg.get(b.id);
      if (!v) continue;
      v.api.setProgress(b.progress);
      v.api.setAlarm(b.disabledUntil > game.time);
      v.api.tick(dt, time);
      const show = (b.hp < b.maxHp && b.done) || selected.has(b.id) || !b.done;
      v.bar.sp.visible = show;
      if (show) drawBar(v.bar, b.done ? b.hp / b.maxHp : Math.max(0.04, b.progress), !b.done);
      if (v.flag) {
        const on = selected.has(b.id) && b.rally && b.faction === game.playerFaction;
        v.flag.visible = !!on;
        if (on) v.flag.position.set(b.rally.x, groundHeight(b.rally.x, b.rally.z), b.rally.z);
      }
      // damage smoke
      if (b.done && b.hp < b.maxHp * 0.55 && Math.random() < dt * (1.6 - b.hp / b.maxHp)) {
        const a = Math.random() * Math.PI * 2;
        fx.smoke(b.x + Math.cos(a) * b.fp * 0.5, groundHeight(b.x, b.z) + BUILD_H[b.type] * b.progress * 0.7,
          b.z + Math.sin(a) * b.fp * 0.5, 1.6, true);
      }
    }

    for (const n of game.nodes) {
      const v = reg.get(n.id);
      if (v) { v.api.setAmount(n.amount / n.max); v.api.tick(dt); }
    }
    for (const c of game.clusters) {
      const v = reg.get(c.id);
      if (!v) continue;
      if (c.owner !== v.owner) { v.owner = c.owner; v.api.setOwner(c.owner >= 0 ? FACTIONS[c.owner].color : null); }
      const q = Math.round((c.capProgress / TUNE.captureTime) * 24);
      if (q !== v.capQ) {
        v.capQ = q;
        v.api.setCapture(c.capProgress / TUNE.captureTime, c.capBy >= 0 ? FACTIONS[c.capBy].color : 0xffffff);
      }
      v.api.tick(dt);
    }
  }

  return {
    sync, setSelection, pick,
    setGround: (g) => { ground = g; },
    has: (id) => reg.has(id),
  };
}
