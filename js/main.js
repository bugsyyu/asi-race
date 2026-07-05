// ============================================================================
// main — boots the start screen, wires input (trackpad-first), runs the
// fixed-step sim loop, and routes sim events to view / audio / HUD.
// ============================================================================
import * as THREE from 'three';
import { FACTIONS, BUILDINGS, TUNE, DIFFICULTY } from './sim/constants.js';
import { createGame, addUnit, addBuilding } from './sim/world.js';
import {
  stepGame, cmdStop, cmdSmart, cmdSetRally, cmdChannel, cmdAttackMove,
  cmdBuildStart, cmdTrainUnit, cmdResearchGen, cmdStartASI, cmdPolicy, cmdResearchTech, cmdTrade, cmdZeroDay,
  canPlace, buildingCost, canAfford, needsMet,
} from './sim/sim.js';
import { makeRng } from './sim/rng.js';
import { isVisible } from './sim/fog.js';
import { createRenderer } from './view/renderer.js';
import { THEMES, setTheme } from './view/theme.js';
import { buildTerrain, sampleGroundY as groundHeight } from './view/terrain.js';
import { cmdRaise, cmdCloudMode, cmdAcquire, cmdPoach } from './sim/industry.js';
import { createWeather } from './view/weather.js';
import { createEffects } from './view/effects.js';
import { createFogOverlay } from './view/fog.js';
import { createView } from './view/view.js';
import { createHUD } from './ui/hud.js';
import { createHelp, createTutorial } from './ui/tutorial.js';
import { initAudio, setMuted, isMuted, sfx, setTension } from './audio/audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const help = createHelp();

// Right-click is a game command everywhere — never the browser menu, even over
// HUD chrome. Exception: the fatal overlay, where right-click → copy matters.
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest || !e.target.closest('#fatal')) e.preventDefault();
});

// ---------------------------------------------------------------------------
// Start screen
// ---------------------------------------------------------------------------
let pickedFaction = 1, pickedDiff = 'normal', pickedTime = 'day';
{
  const box = $('factions');
  FACTIONS.forEach((f, i) => {
    const c = document.createElement('button');
    c.className = 'fcard' + (i === pickedFaction ? ' sel' : '');
    c.style.setProperty('--fc', f.css);
    c.innerHTML = `
      <span class="fglyph">${f.glyph}</span>
      <span class="fname">${f.name}</span>
      <span class="fmotto">“${f.motto}”</span>
      <span class="fbonus"><b>${f.bonusName}</b> — ${f.bonusDesc}</span>`;
    c.onclick = () => {
      pickedFaction = i;
      [...box.children].forEach((n, j) => n.classList.toggle('sel', j === i));
      sfx.select(0.5);
    };
    box.append(c);
  });
  const dbox = $('difficulty');
  for (const key in DIFFICULTY) {
    const b = document.createElement('button');
    b.className = 'dcard' + (key === pickedDiff ? ' sel' : '');
    b.textContent = DIFFICULTY[key].label;
    b.onclick = () => {
      pickedDiff = key;
      [...dbox.children].forEach((n) => n.classList.toggle('sel', n === b));
      sfx.click(0.5);
    };
    dbox.append(b);
  }
  const tbox = $('daytime');
  for (const key of ['day', 'dusk']) {
    const b = document.createElement('button');
    b.className = 'dcard' + (key === pickedTime ? ' sel' : '');
    b.textContent = THEMES[key].label;
    b.onclick = () => {
      pickedTime = key;
      [...tbox.children].forEach((n) => n.classList.toggle('sel', n === b));
      sfx.click(0.5);
    };
    tbox.append(b);
  }
  $('btn-howto').onclick = () => { initAudio(); help.show('目标'); };
  $('btn-start').onclick = () => { initAudio(); setTheme(pickedTime); $('start').classList.add('hidden'); boot(); };
}

// ---------------------------------------------------------------------------
// Game boot
// ---------------------------------------------------------------------------
function boot() {
  const seed = (Date.now() % 1e9) | 0;
  const game = createGame({ playerFaction: pickedFaction, seed, difficulty: pickedDiff });
  const pf = game.playerFaction;
  const me = () => game.factions[pf];

  $('hud').classList.remove('hidden');
  const R = createRenderer($('app'));
  const { scene, camera, rig, camState } = R;
  const terrain = buildTerrain(scene, makeRng(seed ^ 0x9e3779b9));
  const weather = createWeather(scene, R.rig, R.lights); // after terrain: pads are graded
  const fx = createEffects(scene);
  const view = createView(scene, game, fx);
  view.setGround(terrain.ground);
  const fogview = createFogOverlay(scene, game);

  // camera opens on your campus, facing the Capitol (up-screen is -forward,
  // i.e. world (-sin yaw, -cos yaw); pointing it at the origin needs atan2(x, z))
  {
    const hq = game.ents.get(me().hq);
    rig.position.set(hq.x, 0, hq.z);
    camState.yaw = Math.atan2(hq.x, hq.z);
    rig.rotation.y = camState.yaw;
  }

  // ---- selection & groups ---------------------------------------------------
  let selIds = [];
  const groups = {};
  const uiState = { camMoved: false, selResearchers: 0 };

  function setSelection(ids, silent = false) {
    selIds = ids.filter((id) => game.ents.has(id));
    view.setSelection(selIds);
    hud.setSelection(selIds);
    uiState.selResearchers = selIds.filter((id) => {
      const e = game.ents.get(id);
      return e && e.kind === 'unit' && e.faction === pf && e.type === 'researcher';
    }).length;
    if (!silent && selIds.length) sfx.select(0.5);
  }
  const ownSelectedUnits = () =>
    selIds.map((id) => game.ents.get(id)).filter((e) => e && e.kind === 'unit' && e.faction === pf);

  // ---- placement mode ---------------------------------------------------------
  let place = null; // { btype, ghost, mats, valid, x, z }
  function enterPlace(btype) {
    exitPlace();
    const fp = BUILDINGS[btype].fp;
    const ghost = new THREE.Group();
    const disk = new THREE.Mesh(
      new THREE.CylinderGeometry(fp, fp, 0.5, 24),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.32, depthWrite: false })
    );
    disk.position.y = 0.3;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(fp + 0.5, fp + 0.85, 32),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12;
    ghost.add(disk, ring);
    ghost.visible = false;
    scene.add(ghost);
    place = { btype, ghost, mats: [disk.material, ring.material], valid: false, x: 0, z: 0 };
    hud.toast(`正在放置「${BUILDINGS[btype].name}」— 点击建造，Esc 取消`);
  }
  function exitPlace() {
    if (!place) return;
    scene.remove(place.ghost);
    place = null;
  }
  function updatePlace(cx, cy) {
    if (!place) return;
    const hit = view.pick(cx, cy, camera, true);
    if (!hit) { place.ghost.visible = false; return; }
    const { x, z } = hit.point;
    place.x = x; place.z = z;
    place.ghost.visible = true;
    place.ghost.position.set(x, groundHeight(x, z), z);
    const f = me();
    place.valid = canPlace(game, pf, place.btype, x, z).ok
      && canAfford(f, buildingCost(f, place.btype))
      && needsMet(game, f, BUILDINGS[place.btype].needs || {});
    for (const m of place.mats) m.color.setHex(place.valid ? 0x7ddf9a : 0xff6e6e);
  }
  function confirmPlace(shift) {
    if (!place || !place.valid) { if (place) sfx.click(0.5); return; }
    const builders = ownSelectedUnits().filter((u) => u.type === 'researcher').map((u) => u.id);
    const res = cmdBuildStart(game, pf, place.btype, place.x, place.z, builders);
    if (res.ok) {
      markPlayerCmd();
      sfx.thunk(sxOf(place.x, place.z));
      if (!shift) exitPlace();
    } else hud.toast(res.msg || '无法在此建造', 'warn');
  }

  // ---- attack-move targeting -------------------------------------------------
  let amoveArm = false;
  function armAmove() {
    exitPlace();
    amoveArm = true;
    hud.toast('攻击移动：点击目标区域 — 部队沿途清剿一切敌人（Esc 取消）');
  }
  function fireAmove(cx, cy) {
    amoveArm = false;
    const hit = view.pick(cx, cy, camera, true);
    if (!hit) return;
    const ids = ownSelectedUnits().map((u) => u.id);
    if (!ids.length) return;
    cmdAttackMove(game, ids, hit.point.x, hit.point.z);
    markPlayerCmd();
    sfx.order(sxOf(hit.point.x, hit.point.z));
  }

  // ---- HUD actions --------------------------------------------------------------
  let paused = false, speed = 1, overShown = false;

  const hud = createHUD(game, {
    click: () => sfx.click(0.5),
    deny: (why) => { hud.toast(why, 'warn'); sfx.click(0.5); },
    cmd: (c) => {
      if (!me().alive) return;
      if (c.type === 'place') enterPlace(c.btype);
      else if (c.type === 'amove') armAmove();
      else if (c.type === 'stop') { cmdStop(game, selIds); markPlayerCmd(); sfx.order(0.5); }
      else if (c.type === 'channel') { cmdChannel(game, ownSelectedUnits().filter((u) => u.type === 'lobbyist').map((u) => u.id)); markPlayerCmd(); sfx.order(0.5); }
      else if (c.type === 'train') { const r = cmdTrainUnit(game, c.bid, c.utype); if (r.ok) sfx.click(0.6); else hud.toast(r.msg || '无法训练', 'warn'); }
      else if (c.type === 'gen') { const r = cmdResearchGen(game, pf); if (r.ok) sfx.riser(0.5); else hud.toast(r.msg || '无法研发', 'warn'); }
      else if (c.type === 'tech') { const r = cmdResearchTech(game, c.bid, c.key); if (r.ok) sfx.click(0.6); else hud.toast(r.msg || '无法研究', 'warn'); }
      else if (c.type === 'trade') { const r = cmdTrade(game, pf, c.dir); if (r.ok) sfx.click(0.6); else hud.toast(r.msg || '无法交易', 'warn'); }
      else if (c.type === 'raise') { const r = cmdRaise(game, pf); if (r.ok) sfx.riser(0.4); else hud.toast(r.msg || '无法融资', 'warn'); }
      else if (c.type === 'cloud') { const r = cmdCloudMode(game, pf, c.on); if (r.ok) sfx.click(0.6); }
      else if (c.type === 'acquire') { const r = cmdAcquire(game, pf, c.sid); if (r.ok) sfx.riser(0.5); else hud.toast(r.msg || '无法收购', 'warn'); }
      else if (c.type === 'poach') { const r = cmdPoach(game, pf, c.key); if (!r.ok) hud.toast(r.msg || '无法挖角', 'warn'); else if (r.failed) sfx.click(0.4); else sfx.riser(0.5); }
      else if (c.type === 'zeroday') { const r = cmdZeroDay(game, pf, c.target); if (r.ok) sfx.riser(0.6); else hud.toast(r.msg || '无法发动', 'warn'); }
      else if (c.type === 'asi') { const r = cmdStartASI(game, pf); if (!r.ok) hud.toast(r.msg || '无法启动训练', 'warn'); }
      else if (c.type === 'policy') { const r = cmdPolicy(game, pf, c.pid, c.target); if (!r.ok) hud.toast(r.msg || '无法施行', 'warn'); }
    },
    center: (x, z) => { rig.position.set(clamp(x, -104, 104), 0, clamp(z, -104, 104)); uiState.camMoved = true; },
    pause: () => togglePause(),
    speed: () => { speed = speed === 1 ? 2 : 1; hud.setSpeed(speed); sfx.click(0.5); },
    sound: () => { setMuted(!isMuted()); hud.setSound(!isMuted()); },
    help: () => help.show(),
    restart: () => location.reload(),
    spectate: () => { if (paused) togglePause(); },
  });
  hud.setCamRef(() => ({ x: rig.position.x, z: rig.position.z, yaw: camState.yaw, zoom: camState.zoom }));
  hud.setSound(!isMuted());
  hud.setSpeed(1);
  const tut = createTutorial(game, uiState, help);

  function togglePause() {
    paused = !paused;
    hud.setPaused(paused);
    sfx.click(0.5);
  }

  // ---- helpers ---------------------------------------------------------------------
  const V3 = new THREE.Vector3();
  function sxOf(x, z) {
    V3.set(x, groundHeight(x, z), z).project(camera);
    return clamp(V3.x * 0.5 + 0.5, 0, 1);
  }
  const hqPos = (fid) => game.ents.get(game.factions[fid].hq) || { x: 0, z: 0 };
  // Battlefield juice only plays where the player has vision (feed/toasts
  // still report public news). Everything shows once the race is decided.
  const seen = (x, z) => game.over != null || !me().alive || isVisible(game, pf, x, z);
  let lastPlayerCmd = -1;
  const markPlayerCmd = () => { lastPlayerCmd = performance.now(); };
  const gates = {};
  function gate(name, ms) {
    const t = performance.now();
    if (t - (gates[name] || 0) < ms) return false;
    gates[name] = t; return true;
  }

  // ---- event routing ------------------------------------------------------------------
  const beams = {}; // fid -> beam handle
  function routeEvent(ev) {
    hud.onEvent(ev);
    switch (ev.t) {
      case 'spawn_building': {
        const b = game.ents.get(ev.id);
        if (b) {
          terrain.clearAround(b.x, b.z, b.fp + 1.6); // no trees through roofs
          terrain.flattenSite(b.x, b.z, b.fp + 0.9, b.fp + 4.2); // grade the pad
        }
        break;
      }
      case 'ping':
        if (performance.now() - lastPlayerCmd < 150) fx.ping(ev.x, ev.z, ev.col);
        break;
      case 'build_fx':
        if (!seen(ev.x, ev.z)) break;
        fx.buildPuff(ev.x, ev.z, ev.fp);
        if (gate('hammer', 240)) sfx.hammer(sxOf(ev.x, ev.z));
        break;
      case 'build_done':
        if (seen(ev.x, ev.z)) fx.ring(ev.x, ev.z, FACTIONS[ev.fid].color, 6, 0.7);
        if (ev.fid === pf) sfx.complete(sxOf(ev.x, ev.z));
        break;
      case 'trained':
        if (ev.fid === pf && gate('train', 200)) sfx.train(0.5);
        break;
      case 'deposit':
        if (ev.fid === pf && ev.amt >= TUNE.popupMinDeposit) {
          fx.floatText(ev.x, ev.z, `+${ev.amt}◆`, '#59c8ff', 0.85);
          if (gate('dep', 350)) sfx.deposit(sxOf(ev.x, ev.z));
        }
        break;
      case 'gather_fx':
        if (seen(ev.x, ev.z)) fx.gather(ev.x, ev.z);
        break;
      case 'shot': {
        if (!seen(ev.fx, ev.fz) && !seen(ev.tx, ev.tz)) break;
        const gy = groundHeight(ev.tx, ev.tz) + 1.4;
        fx.tracer(ev.fx, groundHeight(ev.fx, ev.fz) + ev.fy, ev.fz, ev.tx, gy, ev.tz, FACTIONS[ev.fid].accent);
        if (gate('laser', 90)) sfx.laser(sxOf(ev.fx, ev.fz));
        break;
      }
      case 'melee':
        if (!seen(ev.x, ev.z)) break;
        fx.melee(ev.x, ev.z);
        if (gate('melee', 120)) sfx.melee(sxOf(ev.x, ev.z));
        break;
      case 'unit_died':
        if (ev.faction === pf || seen(ev.x, ev.z)) {
          fx.explosion(ev.x, ev.z, FACTIONS[ev.faction].color, false);
          if (gate('die', 100)) sfx.die(sxOf(ev.x, ev.z));
        }
        if (ev.faction === pf) R.addShake(0.12);
        break;
      case 'building_died':
        if (ev.faction === pf || seen(ev.x, ev.z)) {
          fx.explosion(ev.x, ev.z, FACTIONS[ev.faction].color, true);
          sfx.explode(sxOf(ev.x, ev.z));
          R.addShake(ev.faction === pf ? 0.7 : 0.35);
        }
        break;
      case 'damaged': {
        const e = game.ents.get(ev.id);
        if (e && e.kind === 'building' && e.faction === pf && gate('hitb', 500)) R.addShake(0.08);
        break;
      }
      case 'incident':
        if (ev.fid === pf || seen(ev.x, ev.z)) {
          fx.incident(ev.x, ev.z);
          sfx.bad(sxOf(ev.x, ev.z));
        }
        if (ev.fid === pf) R.addShake(0.3);
        break;
      case 'alert':
        if (ev.fid === pf && gate('alert', 2500)) sfx.alert(0.5);
        break;
      case 'gen_start':
        if (ev.fid === pf) sfx.riser(0.5);
        break;
      case 'gen_done': {
        const p = hqPos(ev.fid);
        if (seen(p.x, p.z)) fx.genFlash(p.x, p.z, FACTIONS[ev.fid].color);
        sfx.gen(sxOf(p.x, p.z)); // demo day makes headlines either way
        break;
      }
      case 'asi_start': {
        const p = hqPos(ev.fid);
        if (beams[ev.fid]) beams[ev.fid].remove();
        beams[ev.fid] = fx.beam(p.x, p.z, FACTIONS[ev.fid].color);
        sfx.riser(0.5); setTension(true);
        R.addShake(0.25);
        break;
      }
      case 'asi_done': {
        if (beams[ev.fid]) beams[ev.fid].finish();
        const p = hqPos(ev.fid);
        fx.confetti(p.x, p.z, [FACTIONS[ev.fid].color, 0xffffff, FACTIONS[ev.fid].accent]);
        break;
      }
      case 'capture':
        if (ev.fid === pf || seen(ev.x, ev.z)) {
          fx.capture(ev.x, ev.z, FACTIONS[ev.fid].color);
          if (gate('cap', 300)) sfx.capture(sxOf(ev.x, ev.z));
        }
        break;
      case 'defect':
        if (seen(ev.x, ev.z)) fx.floatText(ev.x, ev.z, '↷ 跳槽', ev.from === pf ? '#ff6e6e' : '#7ddf9a', 0.8);
        if (ev.from === pf || ev.to === pf) sfx.bad(0.5);
        break;
      case 'policy': {
        const p = hqPos(ev.target);
        const icon = { export_controls: '⛔', subsidy: '⚡', probe: '⚖', charm: '✦' }[ev.pid] || '✦';
        if (seen(p.x, p.z)) fx.policyStamp(p.x, p.z, icon, FACTIONS[ev.fid].color);
        sfx.policy(0.5); // policy plays are C-SPAN material — always audible
        break;
      }
      case 'elim':
        if (beams[ev.fid]) { beams[ev.fid].remove(); delete beams[ev.fid]; }
        if (ev.fid === pf && !overShown) {
          overShown = true;
          setSelection([]);
          exitPlace();
          sfx.doom(0.5);
          hud.showEnd('defeat');
        }
        break;
      case 'victory': {
        setTension(false);
        if (ev.aligned) sfx.fanfare(0.5); else sfx.doom(0.5);
        overShown = true;
        exitPlace();
        hud.showEnd('victory', ev.winner);
        break;
      }
    }
  }

  // ---- input: pointer -----------------------------------------------------------------
  const canvas = R.renderer.domElement;
  const marquee = document.createElement('div');
  marquee.id = 'marquee';
  $('hud').append(marquee);
  let down = null; // { x, y, moved }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 2) { smartCommand(e.clientX, e.clientY); return; }
    if (e.button !== 0) return;
    if (amoveArm) { fireAmove(e.clientX, e.clientY); return; }
    if (place) { confirmPlace(e.shiftKey); return; }
    down = { x: e.clientX, y: e.clientY, moved: false };
  });
  addEventListener('pointermove', (e) => {
    updatePlace(e.clientX, e.clientY);
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!down.moved && Math.hypot(dx, dy) > 7) { down.moved = true; marquee.style.display = 'block'; }
    if (down.moved) {
      marquee.style.left = Math.min(down.x, e.clientX) + 'px';
      marquee.style.top = Math.min(down.y, e.clientY) + 'px';
      marquee.style.width = Math.abs(dx) + 'px';
      marquee.style.height = Math.abs(dy) + 'px';
    }
  });
  addEventListener('pointerup', (e) => {
    if (e.button !== 0 || !down) return;
    const d = down; down = null;
    marquee.style.display = 'none';
    if (d.moved) boxSelect(d.x, d.y, e.clientX, e.clientY, e.shiftKey);
    else clickSelect(e.clientX, e.clientY, e.shiftKey);
  });

  function clickSelect(cx, cy, shift) {
    const hit = view.pick(cx, cy, camera);
    if (!hit || !hit.ent) { if (!shift) setSelection([]); return; }
    const id = hit.ent.id;
    if (shift && selIds.length) {
      setSelection(selIds.includes(id) ? selIds.filter((i) => i !== id) : [...selIds, id]);
    } else setSelection([id]);
  }
  function boxSelect(x0, y0, x1, y1, shift) {
    const L = Math.min(x0, x1), Rt = Math.max(x0, x1), T = Math.min(y0, y1), B = Math.max(y0, y1);
    const got = [];
    for (const u of game.units) {
      if (u.faction !== pf) continue;
      V3.set(u.x, groundHeight(u.x, u.z) + 1, u.z).project(camera);
      const sx = (V3.x * 0.5 + 0.5) * innerWidth, sy = (-V3.y * 0.5 + 0.5) * innerHeight;
      if (sx >= L && sx <= Rt && sy >= T && sy <= B) got.push(u.id);
    }
    if (got.length) setSelection(shift ? [...new Set([...selIds, ...got])] : got);
    else if (!shift) setSelection([]);
  }
  function smartCommand(cx, cy) {
    if (amoveArm) { amoveArm = false; return; }
    if (place) { exitPlace(); return; }
    if (!me().alive) return;
    const hit = view.pick(cx, cy, camera);
    if (!hit) return;
    const { ent, point } = hit;
    // exactly one of my production buildings selected → set rally.
    // Rallying onto a data node / friendly construction site sends fresh
    // units straight to work there (see applyRally in sim.js).
    const b = selIds.length === 1 ? game.ents.get(selIds[0]) : null;
    if (b && b.kind === 'building' && b.faction === pf && (BUILDINGS[b.type].trains || []).length) {
      cmdSetRally(game, b.id, point.x, point.z, ent && ent.id !== b.id ? ent.id : null);
      markPlayerCmd(); sfx.order(0.5);
      return;
    }
    const ids = ownSelectedUnits().map((u) => u.id);
    if (!ids.length) return;
    cmdSmart(game, ids, ent, point.x, point.z);
    markPlayerCmd();
    sfx.order(sxOf(point.x, point.z));
  }

  // ---- input: wheel (trackpad-first) ----------------------------------------------------
  // Same semantics as scrolling a huge page: deltaY>0 pans the view down-screen,
  // deltaX>0 pans it right-screen. On a macOS/Windows trackpad with natural
  // scrolling that means the world follows your fingers on BOTH axes, like any
  // maps/canvas app; on a mouse the wheel scrolls the map like a document.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    uiState.camMoved = true;
    if (e.ctrlKey) { // pinch gesture on trackpads arrives as ctrl+wheel
      camState.zoom = clamp(camState.zoom * (1 + e.deltaY * 0.011), camState.minZoom, camState.maxZoom);
      return;
    }
    if (e.altKey) { // alt+scroll tilts the boom — down to a near-horizon shot
      camState.pitch = clamp(camState.pitch + e.deltaY * 0.0016, camState.minPitch, camState.maxPitch);
      return;
    }
    const k = 0.0022 * camState.zoom;
    const sin = Math.sin(camState.yaw), cos = Math.cos(camState.yaw);
    rig.position.x = clamp(rig.position.x + (e.deltaX * cos + e.deltaY * sin) * k, -104, 104);
    rig.position.z = clamp(rig.position.z + (-e.deltaX * sin + e.deltaY * cos) * k, -104, 104);
  }, { passive: false });

  // ---- input: keyboard ---------------------------------------------------------------------
  const held = new Set();
  const PAN_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'BracketLeft', 'BracketRight'];
  let tabIdx = -1;
  let lastGroupTap = { n: '', t: -1 };
  addEventListener('keydown', (e) => {
    if (e.repeat && !PAN_KEYS.includes(e.code)) return;
    if (e.code === 'Escape') {
      if (amoveArm) { amoveArm = false; return; }
      if (place) { exitPlace(); return; }
      if (hud.handleKey('Escape')) return;
      if (help.isOpen()) { help.hide(); return; }
      setSelection([]);
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      const a = hud.getLastAlert();
      if (a) rig.position.set(clamp(a.x, -104, 104), 0, clamp(a.z, -104, 104));
      return;
    }
    if (e.code === 'Slash' || e.code === 'F1') {
      e.preventDefault();
      if (help.isOpen()) help.hide(); else help.show();
      return;
    }
    if (e.code === 'Tab') {
      // cycle through idle researchers — the classic "idle villager" key
      e.preventDefault();
      const idle = game.units.filter((u) => u.faction === pf && u.type === 'researcher' && u.state === 'idle');
      if (!idle.length) { hud.toast('没有空闲的研究员'); return; }
      tabIdx = (tabIdx + 1) % idle.length;
      const u = idle[tabIdx];
      setSelection([u.id]);
      rig.position.set(clamp(u.x, -104, 104), 0, clamp(u.z, -104, 104));
      uiState.camMoved = true;
      return;
    }
    if (e.code === 'KeyP') { togglePause(); return; }
    if (e.code === 'KeyF') { speed = speed === 1 ? 2 : 1; hud.setSpeed(speed); return; }
    if (e.code === 'KeyM') { setMuted(!isMuted()); hud.setSound(!isMuted()); return; }
    if (e.code === 'KeyH') { const h = hqPos(pf); rig.position.set(h.x, 0, h.z); uiState.camMoved = true; return; }
    if (/^Digit[1-4]$/.test(e.code)) {
      const n = e.code.slice(5);
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); groups[n] = selIds.slice(); hud.toast(`编队 ${n} 已保存`); }
      else if (groups[n] && groups[n].length) {
        setSelection(groups[n]);
        // double-tap jumps the camera to the group
        const now = performance.now();
        if (lastGroupTap.n === n && now - lastGroupTap.t < 450) {
          const live = groups[n].map((id) => game.ents.get(id)).filter(Boolean);
          if (live.length) {
            const cx = live.reduce((s, u) => s + u.x, 0) / live.length;
            const cz = live.reduce((s, u) => s + u.z, 0) / live.length;
            rig.position.set(clamp(cx, -104, 104), 0, clamp(cz, -104, 104));
            uiState.camMoved = true;
          }
        }
        lastGroupTap = { n, t: now };
      }
      return;
    }
    // contextual command-card hotkeys take priority over camera letters
    if (!e.ctrlKey && !e.metaKey && hud.handleKey(e.code)) { e.preventDefault(); return; }
    if (PAN_KEYS.includes(e.code)) {
      e.preventDefault();
      held.add(e.code);
      uiState.camMoved = true;
    }
  });
  addEventListener('keyup', (e) => held.delete(e.code));
  addEventListener('blur', () => held.clear());

  function heldCamera(dt) {
    const pan = 46 * dt * (camState.zoom / 62);
    let mx = 0, mz = 0;
    if (held.has('KeyW') || held.has('ArrowUp')) mz -= 1;
    if (held.has('KeyS') || held.has('ArrowDown')) mz += 1;
    if (held.has('KeyA') || held.has('ArrowLeft')) mx -= 1;
    if (held.has('KeyD') || held.has('ArrowRight')) mx += 1;
    if (mx || mz) {
      // screen-relative: W/↑ pans up-screen, D/→ pans right-screen (mz<0 is up)
      const sin = Math.sin(camState.yaw), cos = Math.cos(camState.yaw);
      rig.position.x = clamp(rig.position.x + (mx * cos + mz * sin) * pan, -104, 104);
      rig.position.z = clamp(rig.position.z + (-mx * sin + mz * cos) * pan, -104, 104);
    }
    if (held.has('KeyQ')) camState.yaw += dt * 1.7;
    if (held.has('KeyE')) camState.yaw -= dt * 1.7;
    // [ steepens back toward bird's-eye, ] dips toward the horizon
    if (held.has('BracketLeft')) camState.pitch = clamp(camState.pitch - dt * 1.1, camState.minPitch, camState.maxPitch);
    if (held.has('BracketRight')) camState.pitch = clamp(camState.pitch + dt * 1.1, camState.minPitch, camState.maxPitch);
    rig.rotation.y = camState.yaw;
  }

  window.__asirace = { game, camera, rig, camState, groundHeight, addUnit, addBuilding, weather }; // console / automated-test hook

  // ---- main loop -------------------------------------------------------------------------------
  let last = performance.now(), acc = 0, tSec = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const rdt = Math.min(0.1, (now - last) / 1000);
    last = now;
    tSec += rdt;

    if (!paused) {
      acc += rdt * speed;
      let steps = 0;
      while (acc >= TUNE.tick && steps < 12) {
        stepGame(game, TUNE.tick);
        acc -= TUNE.tick;
        steps++;
      }
      if (steps === 12) acc = 0; // don't spiral after a backgrounded tab
    }

    for (const ev of game.events) routeEvent(ev);
    game.events.length = 0;

    // keep beam pause state honest (the sim has no "resumed" event)
    for (const fid in beams) {
      const f = game.factions[fid];
      if (!f.alive || f.asi.state === 'none') { beams[fid].remove(); delete beams[fid]; continue; }
      if (f.asi.state === 'running') beams[fid].setPaused(f.asi.paused);
    }

    heldCamera(rdt);
    const alpha = paused ? 1 : clamp(acc / TUNE.tick, 0, 1);
    view.sync(alpha, rdt, tSec);
    fogview.update();
    // enemies that slipped into the fog drop out of the selection
    if (selIds.length && selIds.some((id) => view.isFogHidden(id))) {
      setSelection(selIds.filter((id) => !view.isFogHidden(id)), true);
    }
    fx.update(rdt, tSec);
    weather.update(rdt);
    hud.update(rdt);
    tut.update(rdt);
    R.render(rdt);
  }
  requestAnimationFrame(frame);
}
