// ============================================================================
// View — keeps a visual twin of every sim entity. Interpolated positions,
// animation state mapping, health bars, selection rings, raycast picking.
// ============================================================================
import * as THREE from 'three';
import { FACTIONS, UNITS, TUNE } from '../sim/constants.js';
import { THEME } from './theme.js';
import { isVisible, isExplored } from '../sim/fog.js';
import { sampleGroundY as groundHeight } from './terrain.js';
import { makeCharacter } from './characters.js';
import { makeBuilding, makeNode, makeCluster, makeCapitol, makeStartup } from './buildings.js';

const BUILD_H = { hq: 14, datacenter: 5.6, lab: 4.2, institute: 6.4, secoffice: 4.6, policy: 4.6, tower: 10 };

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

  // ---- fog of war ----
  const fogHidden = new Set(); // ent ids the player can neither see nor pick
  const ghostMat = new THREE.MeshStandardMaterial({ color: 0x201d31, roughness: 0.97, metalness: 0 });
  const revealAll = () => {
    const pf = game.playerFaction;
    return pf < 0 || game.over != null || !game.factions[pf].alive;
  };
  // Swap a remembered structure to a dark silhouette (and back). Original
  // materials are parked on each mesh, so per-material animations done by the
  // building api simply go dormant while ghosted.
  function setGhosted(v, on) {
    if (!!v.ghosted === on) return;
    v.ghosted = on;
    v.group.traverse((o) => {
      if (o.isLight) { o.visible = !on; return; }
      if (o.isLine || o.userData.decal || (o.isMesh && o.material?.wireframe)) { o.visible = !on; return; } // glow kit dies in memory
      if (!o.isMesh || o.isSprite || o === v.hit || o === v.ring) return;
      if (on) {
        if (!('liveMat' in o.userData)) o.userData.liveMat = o.material;
        o.material = ghostMat;
      } else if ('liveMat' in o.userData) {
        o.material = o.userData.liveMat;
      }
    });
  }

  // ---- statics ----
  {
    const cap = makeCapitol();
    cap.group.position.set(game.capitol.x, groundHeight(game.capitol.x, game.capitol.z), game.capitol.z);
    scene.add(cap.group);
    const h = hitCyl(9.5, 9, game.capitol.id); cap.group.add(h); hits.push(h);
    reg.set(game.capitol.id, { kind: 'capitol', group: cap.group, api: cap, hit: h });
  }
  for (const c of game.clusters) {
    const v = makeCluster();
    v.group.position.set(c.x, groundHeight(c.x, c.z), c.z);
    scene.add(v.group);
    const h = hitCyl(6.4, 3.4, c.id); v.group.add(h); hits.push(h);
    reg.set(c.id, { kind: 'cluster', group: v.group, api: v, owner: -2, capQ: -1, hit: h });
  }

  function addNodeVis(n) {
    const v = makeNode();
    v.group.position.set(n.x, groundHeight(n.x, n.z), n.z);
    scene.add(v.group);
    const h = hitCyl(2.3, 3.4, n.id); v.group.add(h); hits.push(h);
    reg.set(n.id, { kind: 'node', group: v.group, api: v, hit: h });
  }
  for (const n of game.nodes) addNodeVis(n);

  // ---- dynamic creation ----
  function addUnitVis(u) {
    const fdef = FACTIONS[u.faction];
    const ch = makeCharacter(u.type, fdef, (((u.id * 2654435761) % 2147483646) + 1) / 2147483647);
    ch.group.position.set(u.x, groundHeight(u.x, u.z), u.z);
    scene.add(ch.group);
    const ring = makeRing(1.05, THEME.selRing);
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
    const ring = makeRing(b.fp + 1.1, THEME.selRing);
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
    fogHidden.delete(id);
  }

  // ---- corpses: fallen units linger, crumple, then sink away ----
  const corpses = [];
  function corpsify(id) {
    const v = reg.get(id);
    if (!v || v.kind !== 'unit' || !v.group.visible) { removeVis(id); return; }
    // detach from the registry but leave the body in the scene for the fall
    if (v.hit) { const i = hits.indexOf(v.hit); if (i >= 0) hits.splice(i, 1); }
    reg.delete(id);
    selected.delete(id);
    fogHidden.delete(id);
    v.ring.visible = false;
    v.bar.sp.visible = false;
    v.char.setAnim('death');
    const mat = v.char.mesh.material;
    mat.transparent = true;
    corpses.push({ group: v.group, char: v.char, mat, t: 0 });
  }
  function updateCorpses(dt) {
    for (let i = corpses.length - 1; i >= 0; i--) {
      const c = corpses[i];
      c.t += dt;
      c.char.mixer.update(dt);
      if (c.t > 0.85) {
        c.group.position.y -= dt * 0.7;                       // settle into the ground
        c.mat.opacity = Math.max(0, 1 - (c.t - 0.85) / 0.6);
      }
      if (c.t > 1.5) {
        scene.remove(c.group);
        corpses.splice(i, 1);
      }
    }
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
      for (const h of ray.intersectObjects(hits, false)) {
        const id = h.object.userData.entId;
        if (fogHidden.has(id)) continue;         // hidden by fog — not clickable
        const ent = game.ents.get(id);
        if (ent) return { ent, point: h.point };
        // stale ghost of a dead structure — fall through to the ground
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
    const pf = game.playerFaction;
    const all = revealAll();
    const mem = (!all && game.fog && game.fog.fid === pf) ? game.fog.memory : null;

    // create missing
    for (const u of game.units) if (!reg.has(u.id)) addUnitVis(u);
    for (const b of game.buildings) if (!reg.has(b.id)) addBuildingVis(b);
    // remove gone — units crumple into corpses, remembered statics stay as ghosts
    for (const id of [...reg.keys()]) {
      const v = reg.get(id);
      if (v.kind !== 'unit' && v.kind !== 'building' && v.kind !== 'node') continue;
      if (game.ents.has(id)) continue;
      if (v.kind === 'unit') { corpsify(id); continue; }
      if (mem && mem.has(id)) {
        if (!v.ghosted) {
          setGhosted(v, true);
          v.group.visible = true;
          if (v.bar) v.bar.sp.visible = false;
          if (v.ring) v.ring.visible = false;
          selected.delete(id);
        }
        continue;
      }
      removeVis(id);
    }

    for (const u of game.units) {
      const v = reg.get(u.id);
      if (!v) continue;
      // enemy units exist only where the player has eyes
      if (!all && u.faction !== pf && !isVisible(game, pf, u.x, u.z)) {
        v.group.visible = false;
        fogHidden.add(u.id);
        continue;
      }
      fogHidden.delete(u.id);
      v.group.visible = true;
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
      else if (anim === 'attack' && UNITS[u.type].ranged) anim = 'shoot';
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
      if (!all && b.faction !== pf) {
        if (!isVisible(game, pf, b.x, b.z)) {
          if (mem && mem.has(b.id)) {
            // remembered: freeze at the last-seen look, as a dark silhouette
            setGhosted(v, true);
            v.group.visible = true;
            v.bar.sp.visible = false;
          } else {
            v.group.visible = false;
            fogHidden.add(b.id);
          }
          if (v.flag) v.flag.visible = false;
          continue;
        }
      }
      fogHidden.delete(b.id);
      setGhosted(v, false);
      v.group.visible = true;
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
      // damage states: below 65% hp smoke drifts up; below 35% open flames
      // flicker through it, scaling with how bad things are
      if (b.done && b.hp < b.maxHp) {
        const frac = b.hp / b.maxHp;
        const gy = groundHeight(b.x, b.z), bh = BUILD_H[b.type] * b.progress;
        if (frac < 0.65 && Math.random() < dt * (1.9 - frac)) {
          const a = Math.random() * Math.PI * 2;
          fx.smoke(b.x + Math.cos(a) * b.fp * 0.5, gy + bh * 0.7, b.z + Math.sin(a) * b.fp * 0.5, 1.6, true);
        }
        if (frac < 0.35) {
          // flames ride the roofline so they clear the geometry below
          if (Math.random() < dt * (8 - frac * 12)) {
            const a = Math.random() * Math.PI * 2, r = b.fp * (0.1 + Math.random() * 0.45);
            fx.flame(b.x + Math.cos(a) * r, gy + bh * (0.72 + Math.random() * 0.3) + 0.4, b.z + Math.sin(a) * r,
              1 + (0.35 - frac) * 2.2);
          }
          if (Math.random() < dt * 1.4) {
            fx.sparks(b.x, gy + bh + 0.5, b.z, 0xffb27a, 3, 4);
          }
        }
      }
    }

    for (const n of game.nodes) {
      const v = reg.get(n.id);
      if (!v) continue;
      if (!all && !isVisible(game, pf, n.x, n.z)) {
        if (mem && mem.has(n.id)) {
          setGhosted(v, true);
          v.group.visible = true;
        } else {
          v.group.visible = false;
          fogHidden.add(n.id);
        }
        continue;
      }
      fogHidden.delete(n.id);
      setGhosted(v, false);
      v.group.visible = true;
      v.api.setAmount(n.amount / n.max);
      v.api.tick(dt);
    }
    // startup campuses appear when founded, vanish when acquired
    for (const s of (game.industry?.startups || [])) {
      if (!reg.has(s.id)) {
        const api = makeStartup(s.name);
        api.group.position.set(s.x, groundHeight(s.x, s.z), s.z);
        scene.add(api.group);
        const h = hitCyl(3.4, 4, s.id); api.group.add(h); hits.push(h);
        reg.set(s.id, { kind: 'startup', group: api.group, api, hit: h });
      }
      const v2 = reg.get(s.id);
      if (staticFog(v2, s.id, s.x, s.z, all, pf)) v2.api.tick(dt);
    }
    for (const [id, v2] of reg) {
      if (v2.kind === 'startup' && !game.ents.has(id)) removeVis(id);
    }
    // clusters and the Capitol never vanish: explored is enough to remember them
    for (const c of game.clusters) {
      const v = reg.get(c.id);
      if (!v) continue;
      if (!staticFog(v, c.id, c.x, c.z, all, pf)) continue;
      if (c.owner !== v.owner) { v.owner = c.owner; v.api.setOwner(c.owner >= 0 ? FACTIONS[c.owner].color : null); }
      const q = Math.round((c.capProgress / TUNE.captureTime) * 24);
      if (q !== v.capQ) {
        v.capQ = q;
        v.api.setCapture(c.capProgress / TUNE.captureTime, c.capBy >= 0 ? FACTIONS[c.capBy].color : 0xffffff);
      }
      v.api.tick(dt);
    }
    {
      const cap = game.capitol;
      const v = reg.get(cap.id);
      if (v) staticFog(v, cap.id, cap.x, cap.z, all, pf);
    }

    updateCorpses(dt);
  }

  // Landmark fog state: live (true) / explored ghost / hidden. Returns
  // whether the caller should keep applying live updates.
  function staticFog(v, id, x, z, all, pf) {
    if (all || isVisible(game, pf, x, z)) {
      fogHidden.delete(id);
      setGhosted(v, false);
      v.group.visible = true;
      return true;
    }
    if (isExplored(game, pf, x, z)) {
      fogHidden.delete(id);
      setGhosted(v, true);
      v.group.visible = true;
    } else {
      v.group.visible = false;
      fogHidden.add(id);
    }
    return false;
  }

  return {
    sync, setSelection, pick,
    setGround: (g) => { ground = g; },
    has: (id) => reg.has(id),
    isFogHidden: (id) => fogHidden.has(id),
  };
}
