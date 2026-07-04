// ============================================================================
// Effects — pooled particles, tracers, rings, floating text, the ASI beam.
// One-shot juice for every sim event. No allocations in the hot loop beyond
// text sprites (rare) and beams (rarer).
// ============================================================================
import * as THREE from 'three';
import { sampleGroundY as groundHeight } from './terrain.js';

const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const N = (n) => RM ? Math.ceil(n / 3) : n;

function radialTex(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createEffects(scene) {
  // -- sparks: one Points cloud, CPU-simulated ------------------------------
  const CAP = 900;
  const pos = new Float32Array(CAP * 3).fill(-999);
  const col = new Float32Array(CAP * 3);
  const P = []; for (let i = 0; i < CAP; i++) P.push({ life: 0 });
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const sparkPts = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    size: 0.42, vertexColors: true, map: radialTex(), transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  sparkPts.frustumCulled = false;
  scene.add(sparkPts);
  let pCursor = 0;
  const tmpC = new THREE.Color();
  function spawnP(x, y, z, vx, vy, vz, life, hex, grav = 18) {
    const i = pCursor = (pCursor + 1) % CAP;
    const p = P[i];
    p.life = p.max = life; p.vx = vx; p.vy = vy; p.vz = vz; p.grav = grav; p.i = i;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    tmpC.setHex(hex); col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b;
  }

  // -- smoke sprites --------------------------------------------------------
  const smokeTex = radialTex('rgba(120,116,140,0.55)', 'rgba(120,116,140,0)');
  const smokePool = [];
  function smoke(x, y, z, scale = 1, dark = false) {
    let s = smokePool.find(o => o.life <= 0);
    if (!s) {
      if (smokePool.length > 70) return;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false }));
      s = { sp, life: 0 }; smokePool.push(s); scene.add(sp);
    }
    s.life = s.max = 1.6 + Math.random() * 0.8;
    s.grow = scale; s.sp.material.color.setHex(dark ? 0x2b2531 : 0x8d8aa0);
    s.sp.position.set(x + (Math.random() - 0.5), y, z + (Math.random() - 0.5));
    s.sp.scale.setScalar(scale * 1.2);
    s.sp.material.opacity = 0.5;
  }

  // -- open flames (badly damaged buildings) ---------------------------------
  const flameTex = radialTex('rgba(255,205,110,1)', 'rgba(255,80,25,0)');
  const flamePool = [];
  function flame(x, y, z, scale = 1) {
    let f = flamePool.find(o => o.life <= 0);
    if (!f) {
      if (flamePool.length > 56) return;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flameTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      f = { sp, life: 0 }; flamePool.push(f); scene.add(sp);
    }
    f.life = f.max = 0.4 + Math.random() * 0.35;
    f.base = scale * (0.8 + Math.random() * 0.8);
    f.sp.position.set(x + (Math.random() - 0.5) * 0.7, y, z + (Math.random() - 0.5) * 0.7);
    f.sp.scale.setScalar(f.base);
    f.sp.material.rotation = Math.random() * Math.PI * 2;
    f.sp.material.opacity = 0.9;
  }

  // -- expanding rings ------------------------------------------------------
  const ringPool = [];
  function ring(x, z, hex, maxR = 5, life = 0.6, y = 0.15) {
    let r = ringPool.find(o => o.life <= 0);
    if (!r) {
      if (ringPool.length > 24) return;
      const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40),
        new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      r = { m, life: 0 }; ringPool.push(r); scene.add(m);
    }
    r.life = r.max = life; r.maxR = maxR;
    r.m.material.color.setHex(hex);
    r.m.position.set(x, y + groundHeight(x, z), z);
  }

  // -- tracers (cyber shots) -------------------------------------------------
  const tracers = [];
  function tracer(fx, fy, fz, tx, ty, tz, hex) {
    const len = Math.hypot(tx - fx, ty - fy, tz - fz);
    const dur = Math.max(0.09, len / 46);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5),
      new THREE.MeshBasicMaterial({ color: hex }));
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1.4),
      new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    head.add(tail); tail.position.z = 0.8;
    head.position.set(fx, fy, fz);
    head.lookAt(tx, ty, tz);
    scene.add(head);
    tracers.push({ head, fx, fy, fz, tx, ty, tz, t: 0, dur, hex });
  }

  // -- floating text ---------------------------------------------------------
  const floats = [];
  function floatText(x, z, text, cssColor = '#e9ecf4', size = 1) {
    if (floats.length > 14) return;
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.font = '600 34px ui-monospace, SF Mono, Menlo, monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.8)'; g.shadowBlur = 7;
    g.fillStyle = cssColor; g.fillText(text, 128, 34);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    const y = groundHeight(x, z) + 4.2;
    sp.position.set(x, y, z); sp.scale.set(7 * size, 1.75 * size, 1);
    scene.add(sp);
    floats.push({ sp, tex, life: 1.25 });
  }

  // -- burst helpers ----------------------------------------------------------
  function sparks(x, y, z, hex, n = 12, speed = 7) {
    for (let i = 0; i < N(n); i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2;
      const s = speed * (0.4 + Math.random() * 0.8);
      spawnP(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 2, Math.sin(a) * Math.cos(e) * s,
        0.4 + Math.random() * 0.5, hex);
    }
  }
  function explosion(x, z, hex, big = false) {
    const y = groundHeight(x, z) + 1;
    sparks(x, y + 1, z, 0xffcf6e, big ? 46 : 22, big ? 13 : 9);
    sparks(x, y + 1, z, hex, big ? 26 : 12, big ? 10 : 7);
    ring(x, z, 0xffb27a, big ? 11 : 6, 0.55);
    for (let i = 0; i < N(big ? 7 : 3); i++) smoke(x, y + 1.5 + i * 0.5, z, big ? 3.2 : 2, true);
  }
  function confetti(x, z, hexes) {
    const y = groundHeight(x, z) + 6;
    for (let i = 0; i < N(90); i++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 7;
      spawnP(x, y + Math.random() * 3, z, Math.cos(a) * s, 4 + Math.random() * 7, Math.sin(a) * s,
        1.6 + Math.random() * 1.2, hexes[i % hexes.length], 9);
    }
  }

  // -- the ASI beam ------------------------------------------------------------
  const beams = [];
  function beam(x, z, hex) {
    const g = new THREE.Group();
    const y0 = groundHeight(x, z);
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.3, 240, 18, 1, true),
      new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 240, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
    outer.position.y = core.position.y = 120;
    g.add(outer, core);
    const halo = new THREE.Mesh(new THREE.RingGeometry(2.6, 5.2, 36),
      new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = 0.2;
    g.add(halo);
    g.position.set(x, y0, z);
    g.scale.set(0.01, 1, 0.01);
    scene.add(g);
    const h = { g, outer, core, halo, x, z, y0, t: 0, paused: false, done: false, gone: false, hex };
    beams.push(h);
    return {
      setPaused: (p) => { h.paused = p; },
      finish: () => { h.done = true; },
      remove: () => { h.gone = true; },
    };
  }

  // -- event-shaped one-shots ---------------------------------------------------
  const api = {
    sparks, smoke, ring, tracer, floatText, explosion, confetti, beam, flame,
    buildPuff(x, z, fp) {
      const a = Math.random() * Math.PI * 2, r = fp * (0.4 + Math.random() * 0.6);
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      sparks(px, groundHeight(px, pz) + 1.2, pz, 0xd9b06a, 4, 3.5);
    },
    deposit(x, z, hex) { sparks(x, groundHeight(x, z) + 3, z, 0x59c8ff, 8, 4); ring(x, z, hex, 3.4, 0.4); },
    gather(x, z) { sparks(x, groundHeight(x, z) + 1.6, z, 0x59c8ff, 3, 2.6); },
    melee(x, z) { sparks(x, groundHeight(x, z) + 1.4, z, 0xffe08a, 6, 5); },
    incident(x, z) {
      explosion(x, z, 0xff4444);
      ring(x, z, 0xff4444, 9, 0.8);
      floatText(x, z, '⚠ 安全事故', '#ff6e6e', 1.15);
    },
    capture(x, z, hex) { ring(x, z, hex, 8.5, 0.9); sparks(x, groundHeight(x, z) + 2.5, z, hex, 20, 6); },
    policyStamp(x, z, icon, hex) { floatText(x, z, icon, '#ffffff', 1.7); ring(x, z, hex, 6, 0.7); },
    ping(x, z, kind) {
      const hex = kind === 'attack' ? 0xff6e6e : kind === 'gather' ? 0x59c8ff : 0x7ddf9a;
      ring(x, z, hex, 2.6, 0.45, 0.22);
    },
    genFlash(x, z, hex) {
      ring(x, z, hex, 13, 1.1);
      sparks(x, groundHeight(x, z) + 8, z, hex, 30, 8);
      floatText(x, z, '◈ 新一代模型', '#ffffff', 1.05);
    },

    update(dt, time) {
      // particles
      for (let i = 0; i < CAP; i++) {
        const p = P[i];
        if (p.life <= 0) continue;
        p.life -= dt;
        const j = i * 3;
        if (p.life <= 0) { pos[j + 1] = -999; continue; }
        p.vy -= p.grav * dt;
        pos[j] += p.vx * dt; pos[j + 1] += p.vy * dt; pos[j + 2] += p.vz * dt;
        const gy = 0.1;
        if (pos[j + 1] < gy) { pos[j + 1] = gy; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      }
      sparkGeo.attributes.position.needsUpdate = true;
      sparkGeo.attributes.color.needsUpdate = true;

      for (const s of smokePool) {
        if (s.life <= 0) { s.sp.material.opacity = 0; continue; }
        s.life -= dt;
        s.sp.position.y += dt * 1.6;
        s.sp.scale.addScalar(dt * 2.2 * s.grow);
        s.sp.material.opacity = 0.5 * Math.max(0, s.life / s.max);
      }
      for (const f of flamePool) {
        if (f.life <= 0) { f.sp.material.opacity = 0; continue; }
        f.life -= dt;
        const k = Math.max(0, f.life / f.max);
        f.sp.position.y += dt * 2.8;
        f.sp.scale.setScalar(f.base * (0.45 + 0.65 * k) * (0.88 + 0.18 * Math.sin(f.life * 43)));
        f.sp.material.opacity = 0.9 * k;
      }
      for (const r of ringPool) {
        if (r.life <= 0) { r.m.material.opacity = 0; continue; }
        r.life -= dt;
        const k = 1 - r.life / r.max;
        r.m.scale.setScalar(0.3 + k * r.maxR);
        r.m.material.opacity = 0.85 * (1 - k);
      }
      for (let i = tracers.length - 1; i >= 0; i--) {
        const t = tracers[i];
        t.t += dt;
        const k = Math.min(1, t.t / t.dur);
        t.head.position.set(t.fx + (t.tx - t.fx) * k, t.fy + (t.ty - t.fy) * k, t.fz + (t.tz - t.fz) * k);
        if (k >= 1) {
          sparks(t.tx, t.ty, t.tz, t.hex, 5, 4);
          scene.remove(t.head);
          t.head.children[0].geometry.dispose();
          t.head.geometry.dispose();
          tracers.splice(i, 1);
        }
      }
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i];
        f.life -= dt;
        f.sp.position.y += dt * 2.1;
        f.sp.material.opacity = Math.min(1, f.life * 2);
        if (f.life <= 0) { scene.remove(f.sp); f.tex.dispose(); f.sp.material.dispose(); floats.splice(i, 1); }
      }
      for (let i = beams.length - 1; i >= 0; i--) {
        const b = beams[i];
        b.t += dt;
        if (b.gone) {
          b.g.scale.x = b.g.scale.z = Math.max(0.01, b.g.scale.x - dt * 2);
          if (b.g.scale.x <= 0.02) { scene.remove(b.g); beams.splice(i, 1); }
          continue;
        }
        const target = b.done ? 2.6 : b.paused ? 0.45 : 1;
        b.g.scale.x += (target - b.g.scale.x) * Math.min(1, dt * 2.5);
        b.g.scale.z = b.g.scale.x;
        const pulse = b.paused ? 0.4 + 0.15 * Math.sin(time * 3) : 0.9 + 0.25 * Math.sin(time * 7);
        b.core.material.opacity = 0.75 * pulse;
        b.outer.material.opacity = 0.22 * (b.paused ? 0.6 : 1);
        b.outer.rotation.y += dt * 0.8;
        b.halo.scale.setScalar(1 + 0.14 * Math.sin(time * 4));
        if (!b.paused && !b.done && Math.random() < dt * 26) {
          const a = Math.random() * Math.PI * 2;
          spawnP(b.x + Math.cos(a) * 1.8, b.y0 + 1, b.z + Math.sin(a) * 1.8,
            0, 16 + Math.random() * 14, 0, 1.1, b.hex, 0);
        }
        if (b.done && Math.random() < dt * 50) {
          const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 10;
          spawnP(b.x, b.y0 + 2, b.z, Math.cos(a) * s, 12 + Math.random() * 16, Math.sin(a) * s, 1.4, 0xffffff, 6);
        }
      }
    },
  };
  return api;
}
