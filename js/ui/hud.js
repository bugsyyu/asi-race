// ============================================================================
// HUD — race tape, resource strip, meters, selection panel + command card,
// minimap, toasts, event feed, end screens. Pure DOM; talks to main via
// an actions object and reads sim state directly (never mutates it).
// ============================================================================
import { FACTIONS, UNITS, BUILDINGS, GENS, MAX_GEN, ASI, POLICIES, TECHS, LUMINARIES, STARTUPS, INDUSTRY, MODEL_NAMES, ENDINGS, TUNE, fmtCost } from '../sim/constants.js';
import { acquireCost } from '../sim/industry.js';
import { unitCost, buildingCost, canAfford, needsMet, needsLabel, hireMult } from '../sim/sim.js';
import { isVisible } from '../sim/fog.js';
import { THEME } from '../view/theme.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function createHUD(game, act) {
  const pf = game.playerFaction;
  const me = () => game.factions[pf];

  // ---- race tape -----------------------------------------------------------
  const tape = $('racetape');
  tape.innerHTML = '';
  const lanes = FACTIONS.map((fd, i) => {
    const lane = el('div', 'lane' + (i === pf ? ' me' : ''));
    lane.style.setProperty('--fc', fd.css);
    lane.append(
      el('span', 'glyph', fd.glyph),
      el('span', 'lname', esc(fd.tag) + (i === pf ? ' · 你' : '')),
    );
    const bar = el('div', 'bar');
    const fill = el('div', 'fill');
    fill.style.background = fd.css;
    bar.append(fill);
    const stage = el('span', 'stage', 'GEN-1');
    lane.append(bar, stage);
    tape.append(lane);
    return { lane, fill, stage };
  });

  // ---- resources + meters --------------------------------------------------
  const resBox = $('resources'); resBox.innerHTML = '';
  const rChips = {};
  for (const [k, sym] of [['compute', '⚡'], ['data', '◆'], ['influence', '◇'], ['talent', '☺']]) {
    const c = el('div', 'res');
    c.append(el('span', 'ric', sym), el('span', 'rv', '0'), el('span', 'rr', ''));
    resBox.append(c);
    rChips[k] = c;
  }
  const meterBox = $('meters'); meterBox.innerHTML = '';
  const meters = {};
  for (const [k, label, cls] of [['trust', '信任', 'good'], ['alignment', '对齐', 'good'], ['risk', '风险', 'bad']]) {
    const m = el('div', 'meter');
    m.append(el('span', 'mlabel', label));
    const bar = el('div', 'mbar');
    const f = el('div', 'mfill ' + cls);
    bar.append(f);
    const v = el('span', 'mval', '0');
    m.append(bar, v);
    meterBox.append(m);
    meters[k] = { f, v };
  }
  const sampler = { t: 0, last: null, rates: { compute: 0, data: 0, influence: 0 } };

  // ---- toasts / feed / news ticker --------------------------------------------
  const toasts = $('toasts'), feed = $('feed');
  const tickerEl = $('ticker'), tickerText = $('ticker-text');
  const news = [];
  let newsIdx = 0, newsT = 0;
  function pushNews(html) {
    news.push(html);
    if (news.length > 24) news.shift();
    newsIdx = news.length - 1; newsT = 0;
    tickerText.innerHTML = html;
    tickerEl.classList.remove('hidden');
    tickerEl.classList.remove('tk-flash');
    void tickerEl.offsetWidth; // restart the flash animation
    tickerEl.classList.add('tk-flash');
  }
  function toast(msg, cls = '') {
    const t = el('div', 'toast ' + cls, esc(msg));
    toasts.append(t);
    setTimeout(() => t.remove(), 4800);
    while (toasts.children.length > 4) toasts.firstChild.remove();
  }
  function feedLine(html, css) {
    const f = el('div', 'feeditem', html);
    if (css) f.style.setProperty('--fc', css);
    feed.prepend(f);
    while (feed.children.length > 7) feed.lastChild.remove();
    pushNews(html); // every wire story also crosses the ticker
  }
  let lastAlert = null;
  let capWarnAt = -99;

  // ---- selection panel + command card ----------------------------------------
  const selpanel = $('selpanel'), cmdcard = $('cmdcard');
  let selIds = [];
  let keys = {};                 // code -> fn for current card
  let rivalPick = null;          // pending policy id awaiting a target
  let lumPick = false;           // pending poach awaiting a luminary
  let refreshT = 0;

  const stateLabel = (u) => ({
    idle: '待命中', move: '移动中', gather: '正在挖数据', return: `搬运 ${Math.round(u.carry)}◆ 返程`,
    build: '施工中', channel: '正在国会游说', attack: '交战中', flee: '正在撤退',
  }[u.state] || u.state);

  function card({ name, key, cost, why, hot, onUse, big }) {
    const b = el('button', 'cmd' + (why ? ' locked' : '') + (cost === false ? ' poor' : '') + (hot ? ' hot' : '') + (big ? ' big' : ''));
    b.append(el('span', 'cname', esc(name)));
    if (key) b.append(el('span', 'ckey', key));
    if (typeof cost === 'string' && cost) b.append(el('span', 'ccost', cost));
    if (why) b.append(el('span', 'cwhy', esc(why)));
    if (!why) b.onclick = () => { act.click(); onUse(); };
    else b.onclick = () => act.deny(why);
    return b;
  }

  function buildCosts(f, def, type, isUnit) {
    const cost = isUnit ? unitCost(f, type) : buildingCost(f, type);
    const ok = canAfford(f, cost);
    const needs = def.needs && !needsMet(game, f, def.needs) ? needsLabel(def.needs) : null;
    return { cost, ok, needs, label: fmtCost(cost) };
  }

  function renderCmd() {
    cmdcard.innerHTML = '';
    keys = {};
    const f = me();
    if (!f || !f.alive) return;

    // luminary picker for headhunting
    if (lumPick) {
      cmdcard.append(el('div', 'cmdhint', `☆ 天价挖角（${INDUSTRY.poachCost.c}⚡+${INDUSTRY.poachCost.i}◇）— 选择目标大牛`));
      const lums = game.industry?.lums || {};
      for (const key in lums) {
        const emp = lums[key].emp;
        if (typeof emp !== 'number' || emp === pf) continue;
        const L = LUMINARIES[key];
        const b2 = card({
          name: `${esc(L.name)} · ${esc(L.title)} @${FACTIONS[emp].tag}`, hot: true,
          onUse: () => { lumPick = false; act.cmd({ type: 'poach', key }); renderCmd(); },
        });
        b2.style.setProperty('--fc', FACTIONS[emp].css);
        cmdcard.append(b2);
      }
      cmdcard.append(card({ name: '取消', key: 'ESC', onUse: () => { lumPick = false; renderCmd(); } }));
      keys.Escape = () => { lumPick = false; renderCmd(); };
      return;
    }

    // rival-target picker (for export controls / probe)
    if (rivalPick) {
      cmdcard.append(el('div', 'cmdhint', `${POLICIES[rivalPick].icon} ${esc(POLICIES[rivalPick].name)} — 选择目标对手`));
      for (const r of game.factions) {
        if (r.id === pf || !r.alive) continue;
        const b = card({
          name: `${r.def.glyph} ${r.def.tag}`, hot: true,
          onUse: () => { const pid = rivalPick; rivalPick = null; act.cmd({ type: 'policy', pid, target: r.id }); renderCmd(); },
        });
        b.style.setProperty('--fc', r.def.css);
        cmdcard.append(b);
      }
      const c = card({ name: '取消', key: 'ESC', onUse: () => { rivalPick = null; renderCmd(); } });
      cmdcard.append(c);
      keys.Escape = () => { rivalPick = null; renderCmd(); };
      return;
    }

    const ents = selIds.map((id) => game.ents.get(id)).filter(Boolean);
    const mine = ents.filter((e) => e.faction === pf);
    const units = mine.filter((e) => e.kind === 'unit');
    const researchers = units.filter((u) => u.type === 'researcher');
    const lobbyists = units.filter((u) => u.type === 'lobbyist');
    const b = mine.find((e) => e.kind === 'building');

    if (researchers.length) {
      for (const [type, code] of [['datacenter', 'KeyD'], ['lab', 'KeyB'], ['institute', 'KeyA'], ['secoffice', 'KeyO'], ['policy', 'KeyP'], ['tower', 'KeyT']]) {
        const def = BUILDINGS[type];
        const { ok, needs, label } = buildCosts(f, def, type, false);
        const use = () => act.cmd({ type: 'place', btype: type });
        cmdcard.append(card({ name: def.name, key: def.hotkey, cost: ok ? label : false, why: needs, hot: ok && !needs, onUse: use }));
        if (!needs && ok) keys[code] = use;
      }
    }
    if (units.length) {
      const stop = () => act.cmd({ type: 'stop' });
      cmdcard.append(card({ name: '停止', key: 'X', onUse: stop }));
      keys.KeyX = stop;
      const mil = units.filter((u) => UNITS[u.type].dmg);
      if (mil.length) {
        const amove = () => act.cmd({ type: 'amove' });
        cmdcard.append(card({ name: '攻击移动', key: 'A', hot: true, onUse: amove }));
        keys.KeyA = amove; // armies outrank the institute hotkey in mixed selections
      }
      if (lobbyists.length) {
        const go = () => act.cmd({ type: 'channel' });
        cmdcard.append(card({ name: '去国会游说', key: 'V', hot: true, onUse: go }));
        keys.KeyV = go;
      }
    }

    // a selected startup campus: anyone can bid
    const sup = ents.find(e => e.kind === 'startup');
    if (!units.length && sup) {
      const cost = acquireCost(sup);
      const ok = f.compute >= cost.c && f.influence >= cost.i;
      cmdcard.append(card({
        name: `⌁ 收购『${esc(sup.name)}』`, cost: ok ? `${cost.c}⚡+${cost.i}◇` : false,
        why: sup.state !== 'private' ? '已不可收购' : null, hot: ok && sup.state === 'private',
        onUse: () => act.cmd({ type: 'acquire', sid: sup.id }),
      }));
    }

    if (!units.length && b && b.done) {
      const trains = BUILDINGS[b.type].trains || [];
      for (const t of trains) {
        const def = UNITS[t];
        const { ok, needs, label } = buildCosts(f, def, t, true);
        const full = b.queue.length >= 5 ? '队列已满' : null;
        const use = () => act.cmd({ type: 'train', utype: t, bid: b.id });
        cmdcard.append(card({ name: def.name, key: def.hotkey, cost: ok ? label : false, why: needs || full, hot: ok && !needs && !full, onUse: use }));
        if (ok && !needs && !full) keys['Key' + def.hotkey] = use;
      }
      // economy techs researched at this building (AoE-style upgrades)
      for (const key in TECHS) {
        const t = TECHS[key];
        if (t.at !== b.type) continue;
        if (f.techs[key]) { cmdcard.append(card({ name: `${t.icon} ${t.name}`, why: '已完成' })); continue; }
        const needs = t.needs?.gen && f.gen < t.needs.gen ? `需要 Gen-${t.needs.gen}`
          : t.needs?.tech && !f.techs[t.needs.tech] ? `需要「${TECHS[t.needs.tech].name}」`
          : b.tech ? '已有研究进行中' : null;
        const ok = canAfford(f, t.cost);
        const use = () => act.cmd({ type: 'tech', key, bid: b.id });
        cmdcard.append(card({ name: `${t.icon} ${t.name}`, cost: ok ? fmtCost(t.cost) : false, why: needs, hot: ok && !needs, onUse: use }));
      }
      if (b.type === 'hq') {
        // compute spot market — convert between ⚡ and ◆ with slippage
        const y = 1 - f.mktPressure;
        const c2d = () => act.cmd({ type: 'trade', dir: 'c2d' });
        const d2c = () => act.cmd({ type: 'trade', dir: 'd2c' });
        cmdcard.append(card({
          name: `⇄ 卖算力购数据 (+${Math.round(TUNE.tradeGetD * y)}◆)`,
          cost: f.compute >= TUNE.tradeLotC ? `${TUNE.tradeLotC}⚡` : false,
          hot: f.compute >= TUNE.tradeLotC, onUse: c2d,
        }));
        cmdcard.append(card({
          name: `⇄ 卖数据购算力 (+${Math.round(TUNE.tradeGetC * y)}⚡)`,
          cost: f.data >= TUNE.tradeLotD ? `${TUNE.tradeLotD}◆` : false,
          hot: f.data >= TUNE.tradeLotD, onUse: d2c,
        }));
      }
      if (b.type === 'hq') {
        const ind = game.industry;
        const cdR = Math.max(0, (f.raiseCd || 0) - game.time);
        cmdcard.append(card({
          name: `☖ 增发融资 (+${Math.round((ind?.prices[pf] || 100) * INDUSTRY.raiseMult)}⚡)`,
          cost: '股价 ' + Math.round(ind?.prices[pf] || 100),
          why: cdR > 0 ? `市场消化 ${Math.ceil(cdR)} 秒` : null, hot: cdR <= 0,
          onUse: () => act.cmd({ type: 'raise' }),
        }));
        cmdcard.append(card({
          name: f.cloud ? '☁ 关闭云服务（收回算力）' : '☁ 开放算力租赁（入局云市场）',
          cost: f.cloud ? '算力 −20% 生效中' : '算力 −20% ↦ ◆+◇',
          hot: true, onUse: () => act.cmd({ type: 'cloud', on: !f.cloud }),
        }));
        if (f.asi.state === 'running') {
          const names = ['沉睡', '梯度风暴', '检查点红利', '叙事引擎', '人才虹吸', '尘世之手'];
          const adj = f.alignment >= TUNE.alignedThreshold ? '清醒' : '失稳';
          cmdcard.append(el('div', 'cmdhint',
            `▲ ${adj}·${MODEL_NAMES[f.def.key]} 涌现中 — 阶段：${names[f.asi.stage || 0]}（对齐研究院仍在影响它的性情）`));
        }
        if (f.gen < MAX_GEN) {
          const g = GENS[f.gen + 1];
          const busy = b.queue.some((q) => q.gen || q.asi) ? '正在训练中' : null;
          const ok = canAfford(f, g.cost);
          const use = () => act.cmd({ type: 'gen' });
          cmdcard.append(card({ name: `研发 ${g.short}`, key: 'G', cost: ok ? fmtCost(g.cost) : false, why: busy, hot: ok && !busy, onUse: use }));
          if (ok && !busy) keys.KeyG = use;
        } else {
          const ok = canAfford(f, ASI.cost);
          const state = f.asi.state !== 'none' ? '训练已经开始' : null;
          const use = () => act.cmd({ type: 'asi' });
          cmdcard.append(card({ name: '▲ 启动 ASI 训练', key: '↵', cost: ok ? fmtCost(ASI.cost) : false, why: state, hot: ok && !state, big: true, onUse: use }));
          if (ok && !state) keys.Enter = use;
        }
      }
      if (b.type === 'policy') {
        cmdcard.append(card({
          name: '☆ 天价挖角', cost: `${INDUSTRY.poachCost.c}⚡+${INDUSTRY.poachCost.i}◇`,
          why: (f.poachCd || 0) > game.time ? `猎头冷却 ${Math.ceil(f.poachCd - game.time)} 秒` : null,
          hot: (f.poachCd || 0) <= game.time,
          onUse: () => { lumPick = true; renderCmd(); },
        }));
        const pkeys = { export_controls: 'KeyZ', subsidy: 'KeyX', probe: 'KeyC', charm: 'KeyV' };
        for (const pid in POLICIES) {
          const p = POLICIES[pid];
          const cdLeft = Math.max(0, (f.policyCd[pid] || 0) - game.time);
          const ok = f.influence >= p.cost;
          const why = cdLeft > 0 ? `冷却 ${Math.ceil(cdLeft)} 秒` : null;
          const use = () => {
            if (p.target === 'rival') { rivalPick = pid; renderCmd(); }
            else act.cmd({ type: 'policy', pid, target: pf });
          };
          cmdcard.append(card({ name: `${p.icon} ${p.name}`, key: pkeys[pid].slice(3), cost: ok ? `${p.cost}◇` : false, why, hot: ok && !why, onUse: use }));
          if (ok && !why) keys[pkeys[pid]] = use;
        }
      }
    }
  }

  function renderSel() {
    selpanel.innerHTML = '';
    const ents = selIds.map((id) => game.ents.get(id)).filter(Boolean);
    if (!ents.length) return; // #selpanel:empty hides the card
    if (ents.length > 1) {
      const counts = {};
      for (const e of ents) {
        const k = e.kind === 'unit' ? UNITS[e.type].name : (BUILDINGS[e.type]?.name || e.kind);
        counts[k] = (counts[k] || 0) + 1;
      }
      const box = el('div', 'multi');
      for (const k in counts) box.append(el('span', 'chip', `${counts[k]}× ${esc(k)}`));
      selpanel.append(el('div', 'sname', `已选中 ${ents.length} 个`), box);
      return;
    }
    const e = ents[0];
    if (e.kind === 'unit') {
      const def = UNITS[e.type];
      selpanel.append(el('div', 'sname', esc(def.name)));
      const hp = el('div', 'hp'); const hf = el('div', 'hpfill');
      hf.style.width = `${(e.hp / e.maxHp) * 100}%`; hp.append(hf);
      selpanel.append(hp, el('div', 'srow', esc(stateLabel(e))), el('div', 'sdesc', esc(def.desc)));
    } else if (e.kind === 'building') {
      const def = BUILDINGS[e.type];
      selpanel.append(el('div', 'sname', esc(def.name) + (e.done ? '' : ' — 建设中')));
      if (e.type === 'hq' && game.industry) {
        const ind = game.industry, dlt = (i) => {
          const d = ind.prices[i] - ind.prev[i];
          return d > 0.2 ? '▲' : d < -0.2 ? '▼' : '·';
        };
        selpanel.append(el('div', 'srow', `股价 ${Math.round(ind.prices[e.faction])} ${dlt(e.faction)} · AI指数 ${Math.round(ind.ai)} · 硬件指数 ${Math.round(ind.hw)}`));
        const f2 = game.factions[e.faction];
        if (f2.roster.length) selpanel.append(el('div', 'srow dim', '在册大牛：' + f2.roster.map(k => LUMINARIES[k].name).join('、')));
      }
      if (e.tech) selpanel.append(el('div', 'srow', `${TECHS[e.tech.key].icon} 研究「${esc(TECHS[e.tech.key].name)}」— 还需 ${Math.ceil(e.tech.remain)} 秒`));
      const hp = el('div', 'hp'); const hf = el('div', 'hpfill');
      hf.style.width = `${(e.done ? e.hp / e.maxHp : e.progress) * 100}%`;
      if (!e.done) hf.classList.add('prog');
      hp.append(hf);
      selpanel.append(hp);
      if (e.disabledUntil > game.time) selpanel.append(el('div', 'srow bad', `⚠ 停摆中 — 事故清理还需 ${Math.ceil(e.disabledUntil - game.time)} 秒`));
      if (e.queue.length) {
        const q = el('div', 'queue');
        for (const item of e.queue) {
          const label = item.unit ? UNITS[item.unit].name : item.gen ? GENS[item.gen].short : 'ASI 训练';
          const qi = el('div', 'qitem', esc(label));
          const qf = el('div', 'qfill');
          qf.style.width = `${(1 - item.remain / item.total) * 100}%`;
          qi.append(qf); q.append(qi);
        }
        selpanel.append(q);
      }
      selpanel.append(el('div', 'sdesc', esc(def.desc)));
      if (e.faction === pf && !e.done) selpanel.append(el('div', 'srow dim', '选中研究员后右键这里，可加派人手施工'));
      else if (e.faction === pf && (BUILDINGS[e.type].trains || []).length) selpanel.append(el('div', 'srow dim', '右键地面 / 数据节点 / 在建建筑，设置集结点'));
    } else if (e.kind === 'startup') {
      const st = STARTUPS[e.key];
      selpanel.append(el('div', 'sname', `创业新势力 · ${esc(e.name)}`),
        el('div', 'srow', `创始人 ${esc(LUMINARIES[e.lumKey].name)} · 估值 ${Math.round(e.valuation)}`),
        el('div', 'sdesc', esc(st.claim) + (e.state === 'ipo' ? ' — 已 IPO' : '')));
    } else if (e.kind === 'node') {
      selpanel.append(el('div', 'sname', '数据节点'),
        el('div', 'srow', `◆ 剩余 ${Math.max(0, Math.round(e.amount))}`),
        el('div', 'sdesc', '派研究员来挖掘公开数据。挖得完的。'));
    } else if (e.kind === 'cluster') {
      const own = e.owner >= 0 ? FACTIONS[e.owner].name : '无主';
      selpanel.append(el('div', 'sname', 'GPU 集群'),
        el('div', 'srow', `占领方：${esc(own)}`),
        el('div', 'sdesc', `己方单位在附近保持多数 ${TUNE.captureTime} 秒即可占领。占领期间 +${TUNE.clusterComputeRate}⚡/秒。`));
    } else if (e.kind === 'capitol') {
      selpanel.append(el('div', 'sname', '国会大厦'),
        el('div', 'sdesc', '派说客驻守此处，为政策操作积攒 ◇ 影响力。'));
    }
  }

  // ---- minimap ----------------------------------------------------------------
  const mm = $('minimap');
  const mctx = mm.getContext('2d');
  const MMS = mm.width;
  const w2m = (v) => ((v + TUNE.mapSize / 2) / TUNE.mapSize) * MMS;
  const mmBg = document.createElement('canvas');
  mmBg.width = mmBg.height = MMS;
  {
    const g = mmBg.getContext('2d');
    const grad = g.createLinearGradient(0, 0, MMS, MMS);
    grad.addColorStop(0, THEME.minimap[0]); grad.addColorStop(1, THEME.minimap[1]);
    g.fillStyle = grad; g.fillRect(0, 0, MMS, MMS);
    g.strokeStyle = 'rgba(255,255,255,0.1)'; g.strokeRect(0.5, 0.5, MMS - 1, MMS - 1);
  }
  let camRef = null;
  // fog shading mask, rebuilt only when the sim's fog stamp moves
  const fogCv = document.createElement('canvas');
  const fogCtx = fogCv.getContext('2d');
  let fogImg = null, fogStamp = -1;
  function drawFogShade(fog) {
    const n = fog.n;
    if (fogStamp !== fog.stamp) {
      fogStamp = fog.stamp;
      if (!fogImg) { fogCv.width = fogCv.height = n; fogImg = fogCtx.createImageData(n, n); }
      const { visible, explored } = fog, d = fogImg.data;
      for (let k = 0; k < n * n; k++) {
        const o = k * 4;
        d[o] = 9; d[o + 1] = 8; d[o + 2] = 20;
        d[o + 3] = visible[k] ? 0 : explored[k] ? 120 : 235;
      }
      fogCtx.putImageData(fogImg, 0, 0);
    }
    mctx.drawImage(fogCv, 0, 0, MMS, MMS);
  }
  function drawMinimap() {
    mctx.drawImage(mmBg, 0, 0);
    const fog = game.fog;
    const fogged = !game.over && me().alive && fog && fog.fid === pf;
    const mem = fogged ? fog.memory : null;
    const nodeDot = (x, z) => {
      mctx.fillStyle = '#59c8ff';
      mctx.fillRect(w2m(x) - 1.5, w2m(z) - 1.5, 3, 3);
    };
    const clusterDot = (x, z, owner) => {
      mctx.save();
      mctx.translate(w2m(x), w2m(z)); mctx.rotate(Math.PI / 4);
      mctx.fillStyle = owner >= 0 ? FACTIONS[owner].css : '#8a93ff';
      mctx.fillRect(-3, -3, 6, 6);
      mctx.restore();
    };
    const buildingDot = (x, z, fid, type) => {
      mctx.fillStyle = FACTIONS[fid].css;
      const s = type === 'hq' ? 7 : 4;
      mctx.fillRect(w2m(x) - s / 2, w2m(z) - s / 2, s, s);
    };
    mctx.fillStyle = '#ffd9a0';
    mctx.beginPath(); mctx.arc(w2m(0), w2m(0), 3.4, 0, 7); mctx.fill();
    if (mem) {
      // fogged: neutral features and rivals appear as the player last saw them
      for (const m of mem.values()) {
        if (m.kind === 'node') nodeDot(m.x, m.z);
        else if (m.kind === 'cluster') clusterDot(m.x, m.z, m.owner);
        else buildingDot(m.x, m.z, m.faction, m.type);
      }
      for (const b of game.buildings) if (b.faction === pf) buildingDot(b.x, b.z, pf, b.type);
      for (const u of game.units) {
        if (u.faction !== pf && !isVisible(game, pf, u.x, u.z)) continue;
        mctx.fillStyle = FACTIONS[u.faction].cssBright;
        mctx.fillRect(w2m(u.x) - 1, w2m(u.z) - 1, 2, 2);
      }
      drawFogShade(fog);
    } else {
      for (const n of game.nodes) nodeDot(n.x, n.z);
      for (const c of game.clusters) clusterDot(c.x, c.z, c.owner);
      for (const b of game.buildings) buildingDot(b.x, b.z, b.faction, b.type);
      for (const u of game.units) {
        mctx.fillStyle = FACTIONS[u.faction].cssBright;
        mctx.fillRect(w2m(u.x) - 1, w2m(u.z) - 1, 2, 2);
      }
    }
    if (lastAlert && game.time - lastAlert.time < 6) {
      mctx.strokeStyle = '#ff6e6e'; mctx.lineWidth = 2;
      const r = 5 + ((game.time * 2) % 1) * 8;
      mctx.beginPath(); mctx.arc(w2m(lastAlert.x), w2m(lastAlert.z), r, 0, 7); mctx.stroke();
    }
    if (camRef) {
      const { x, z, yaw, zoom } = camRef();
      mctx.save();
      mctx.translate(w2m(x), w2m(z));
      mctx.rotate(-yaw);
      const vw = (zoom * 1.35 / TUNE.mapSize) * MMS, vh = (zoom * 0.9 / TUNE.mapSize) * MMS;
      mctx.strokeStyle = 'rgba(255,255,255,0.85)'; mctx.lineWidth = 1.2;
      mctx.strokeRect(-vw / 2, -vh / 2, vw, vh);
      mctx.restore();
    }
  }
  function mmToWorld(ev) {
    const r = mm.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * TUNE.mapSize - TUNE.mapSize / 2;
    const z = ((ev.clientY - r.top) / r.height) * TUNE.mapSize - TUNE.mapSize / 2;
    return { x, z };
  }
  let mmDrag = false;
  mm.addEventListener('pointerdown', (e) => { mmDrag = true; const p = mmToWorld(e); act.center(p.x, p.z); });
  addEventListener('pointermove', (e) => { if (mmDrag) { const p = mmToWorld(e); act.center(p.x, p.z); } });
  addEventListener('pointerup', () => { mmDrag = false; });

  // ---- top-right buttons --------------------------------------------------------
  $('btn-pause').onclick = () => act.pause();
  $('btn-speed').onclick = () => act.speed();
  $('btn-sound').onclick = () => act.sound();
  $('btn-help').onclick = () => act.help();

  // ---- events → juice + feed ------------------------------------------------------
  const stats = { policies: 0, defectionsIn: 0, defectionsOut: 0, captures: 0 };
  function onEvent(ev) {
    const F = (i) => FACTIONS[i];
    switch (ev.t) {
      case 'alert':
        if (ev.fid === pf) {
          lastAlert = { x: ev.x, z: ev.z, time: game.time };
          toast('⚠ 你的园区遭到攻击 — 按空格键查看战况', 'bad');
        }
        break;
      case 'gen_done':
        feedLine(`${F(ev.fid).glyph} ${esc(F(ev.fid).name)} 达成 <b>${GENS[ev.gen].short}</b>`, F(ev.fid).css);
        if (ev.fid === pf) toast(`${GENS[ev.gen].short} 研发完成 — ${GENS[ev.gen].unlocks}`, 'good');
        else toast(`${F(ev.fid).name} 已达成 ${GENS[ev.gen].short}`, 'warn');
        break;
      case 'raise':
        pushNews(`${F(ev.fid).glyph} ${esc(F(ev.fid).name)} 增发融资 +${ev.amt}⚡，股价承压`);
        break;
      case 'cloud':
        pushNews(`${F(ev.fid).glyph} ${esc(F(ev.fid).name)} ${ev.on ? '开放算力租赁，入局云市场 — 硬件板块承压' : '退出云算力市场，算力回收自用'}`);
        break;
      case 'lum_jump': {
        const L = LUMINARIES[ev.key];
        pushNews(`【人事地震】${esc(L.name)}（${esc(L.title)}）${ev.from >= 0 ? '离开 ' + esc(F(ev.from).name) + '，' : ''}加入 ${esc(F(ev.to).name)}`);
        if (ev.from === pf) toast(`${L.name} 离职跳槽 ${F(ev.to).name} — 士气受挫`, 'bad');
        if (ev.to === pf) toast(`${L.name} 加入了你的实验室！`, 'good');
        break;
      }
      case 'lum_quit': {
        const L = LUMINARIES[ev.key];
        pushNews(`【重磅】${esc(L.name)} 宣布退出行业，巡回演讲警告 AI 风险 — ${esc(F(ev.from).name)} 信任受挫`);
        if (ev.from === pf) toast(`${L.name} 退圈并公开警告风险`, 'bad');
        break;
      }
      case 'lum_found': {
        const L = LUMINARIES[ev.key], st = STARTUPS[ev.para];
        pushNews(`【创业】${esc(L.name)} 离开 ${esc(F(ev.from).name)} 创办『${esc(st.name)}』：“${esc(st.claim)}”`);
        toast(`新势力『${st.name}』成立 — 可派兵探访并收购`, ev.from === pf ? 'bad' : 'warn');
        break;
      }
      case 'acquired':
        pushNews(`【并购】${F(ev.fid).glyph} ${esc(F(ev.fid).name)} 以 ${ev.cost}⚡ 收购『${esc(STARTUPS[ev.key].name)}』`);
        if (ev.fid === pf) toast(`收购完成 — 获得范式加成与创始人`, 'good');
        break;
      case 'ipo':
        pushNews(`【IPO】『${esc(STARTUPS[ev.key].name)}』上市大涨 — ${esc(STARTUPS[ev.key].claim)}`);
        break;
      case 'industry':
        pushNews(`【行业】${esc(ev.msg)}`);
        toast(ev.msg, 'warn');
        break;
      case 'poach_fail':
        if (ev.fid === pf) toast('挖角被拒 — 对方接了反offer', 'warn');
        if (ev.victim === pf) toast(`有人试图挖走 ${LUMINARIES[ev.lum].name}！`, 'warn');
        break;
      case 'emerge': {
        const n = `${game.factions[ev.fid].alignment >= TUNE.alignedThreshold ? '清醒' : '失稳'}·${MODEL_NAMES[F(ev.fid).key]}`;
        const lines = [null,
          `【涌现】『${n}』开始自我优化训练管线 — 剩余时间在加速融化`,
          `【涌现】『${n}』检查点开放商用 — 订阅收入涌入，${esc(F(ev.fid).tag)} 股价上扬，算力转售市场被压价`,
          ev.aligned ? `【涌现】『${n}』规模化发布安全评测与对齐报告 — 全行业风险感知回落` : `【涌现】『${n}』开始规模化投放个性化内容 — 对手的公众叙事正被淹没`,
          ev.aligned ? `【涌现】胜局已现 — 全行业人才涌向 ${esc(F(ev.fid).name)}` : `【涌现】猎头预算无上限 — ${esc(F(ev.fid).name)} 正在收买对手内部人员`,
          ev.aligned ? `【涌现】『${n}』完成防御性披露 — 加固母园区并公开全部已知漏洞` : `【涌现】『${n}』买断区域电网容量 — 每个对手的机房都在降频`,
        ];
        pushNews(lines[ev.stage]);
        if (ev.fid === pf) toast(`涌现阶段推进：${lines[ev.stage].split('—')[1].trim()}`, ev.aligned ? 'good' : 'warn');
        else if (ev.stage >= 3) toast(`警报：${F(ev.fid).name} 的模型正在${['', '', '', '主导舆论场', '虹吸你的人才', '挤占现实基础设施'][ev.stage]}`, 'bad');
        break;
      }
      case 'convert': {
        pushNews(`【丑闻】${esc(F(ev.from).name)} 的一名特工被曝收受天价期权 — 携门禁权限转投 ${F(ev.fid).glyph} ${esc(F(ev.fid).name)}`);
        if (ev.from === pf) toast('你的一名特工被收买跳槽 — 永久损失', 'bad');
        break;
      }
      case 'ward':
        pushNews(`【披露】${F(ev.fid).glyph} ${esc(F(ev.fid).name)} 发布防御性安全公告 — 母园区系统加固（承伤 −40%），全行业风险 −4`);
        break;
      case 'brownout':
        pushNews(`【电网】${F(ev.fid).glyph} ${esc(F(ev.fid).name)} 的模型以期货合约买断区域电网容量 — 对手机房被迫降频，监管者向受害方拨付影响力`);
        toast(ev.fid === pf ? '你的模型挤兑了电网 — 合法，但信任受创' : '电网挤兑：你的算力 −50%（12 秒），获监管补偿 +50◇', ev.fid === pf ? 'warn' : 'bad');
        break;
      case 'resonance':
        pushNews('【白热化】两条最终训练同时在跑 — 双方实验室拉满集群、跳过安全冗余抢着冲线：训练齐加速，风险同攀升');
        toast('竞争性超频：两条训练都在提速 — 拦截窗口正在关闭', 'warn');
        break;
      case 'tech_done': {
        const t = TECHS[ev.key];
        if (ev.fid === pf) toast(`${t.icon} 「${t.name}」研究完成 — ${t.desc}`, 'good');
        pushNews(`${F(ev.fid).glyph} ${esc(F(ev.fid).name)} 完成研究「${esc(t.name)}」`);
        break;
      }
      case 'asi_start': {
        const cn = `${game.factions[ev.fid].alignment >= TUNE.alignedThreshold ? '清醒' : '失稳'}·${MODEL_NAMES[F(ev.fid).key]}`;
        pushNews(`【涌现】${esc(F(ev.fid).name)} 的最终训练开始 — 内部代号『${cn}』`);
        feedLine(`${F(ev.fid).glyph} <b>${esc(F(ev.fid).name)} 启动 ASI 训练！</b>`, F(ev.fid).css);
        toast(ev.fid === pf ? '▲ 你的 ASI 训练已启动。守住园区！' : `▲ ${F(ev.fid).name} 启动了 ASI 训练 — 阻止它，或跑赢它`, ev.fid === pf ? 'good' : 'bad');
      }
        break;
      case 'asi_paused':
        if (ev.fid === pf) toast('你的 ASI 训练停摆了 — 总部正在挨打', 'bad');
        break;
      case 'incident':
        if (ev.fid === pf) toast('⚠ 安全事故！一栋建筑熄火，公众全看见了', 'bad');
        feedLine(`⚠ ${esc(F(ev.fid).name)} 发生安全事故`, F(ev.fid).css);
        break;
      case 'defect':
        if (ev.to === pf) { stats.defectionsIn++; toast('对手的一名研究员跳槽投奔了你', 'good'); }
        if (ev.from === pf) { stats.defectionsOut++; toast('你的一名研究员跳槽去了对手那边 — 快提升信任', 'bad'); }
        feedLine(`↷ 研究员跳槽：${F(ev.from).tag} → ${F(ev.to).tag}`, F(ev.to).css);
        break;
      case 'policy': {
        const p = POLICIES[ev.pid];
        if (ev.fid === pf) stats.policies++;
        const tgt = ev.target !== ev.fid ? `，目标 ${F(ev.target).tag}` : '';
        feedLine(`${p.icon} ${esc(F(ev.fid).name)} 打出 <b>${esc(p.name)}</b>${tgt}`, F(ev.fid).css);
        if (ev.target === pf && ev.fid !== pf) toast(`${F(ev.fid).name} 对你打出了「${p.name}」`, 'bad');
        break;
      }
      case 'capture':
        if (ev.fid === pf) { stats.captures++; toast('已占领 GPU 集群（+8⚡/秒）', 'good'); }
        feedLine(`◧ ${esc(F(ev.fid).name)} 占领了一座 GPU 集群`, F(ev.fid).css);
        break;
      case 'capture_start':
        if (ev.owner === pf && game.time - capWarnAt > 12) {
          capWarnAt = game.time;
          lastAlert = { x: ev.x, z: ev.z, time: game.time };
          toast(`⚠ ${F(ev.fid).name} 正在夺取你的 GPU 集群 — 按空格键查看`, 'warn');
        }
        break;
      case 'raid':
        feedLine(`⚔ ${F(ev.from).glyph} ${esc(F(ev.from).name)} 对 ${esc(F(ev.to).tag)} 发起突袭`, F(ev.from).css);
        if (ev.to === pf) {
          lastAlert = { x: ev.x, z: ev.z, time: game.time };
          toast(`⚔ 侦测到 ${F(ev.from).name} 的进攻部队正在逼近 — 按空格键查看`, 'bad');
        }
        break;
      case 'asi_half':
        feedLine(`▲ ${esc(F(ev.fid).name)} 的 ASI 训练已过半`, F(ev.fid).css);
        toast(ev.fid === pf ? '▲ 你的 ASI 训练已过半 — 守住园区' : `▲ ${F(ev.fid).name} 的 ASI 训练已过半！时间不多了`,
          ev.fid === pf ? 'good' : 'bad');
        break;
      case 'elim':
        feedLine(`✖ <b>${esc(F(ev.fid).name)} 已被淘汰</b>`, F(ev.fid).css);
        if (ev.fid !== pf) toast(`${F(ev.fid).name} 退出了竞赛`, 'warn');
        break;
      case 'toast':
        toast(ev.msg, ev.cls || '');
        break;
      case 'node_empty':
        break;
    }
  }

  // ---- end screen -------------------------------------------------------------------
  const endBox = $('end');
  function showEnd(kind, winnerId) {
    const f = me();
    const win = winnerId !== undefined ? FACTIONS[winnerId] : null;
    let key, kicker;
    if (kind === 'defeat') { key = 'defeat'; kicker = '败北'; }
    else if (winnerId === pf) { key = game.over.military ? 'military' : (game.over.aligned ? 'win_aligned' : 'win_rogue'); kicker = '胜利'; }
    else { key = game.over.military ? 'military' : (game.over.aligned ? 'rival_aligned' : 'rival_rogue'); kicker = '竞赛结束'; }
    const E = ENDINGS[key];
    $('end-kicker').textContent = kicker;
    $('end-kicker').className = winnerId === pf ? 'good' : 'bad';
    $('end-title').textContent = E.title.replaceAll('{F}', win ? win.name : '');
    $('end-body').textContent = E.body.replaceAll('{F}', win ? win.name : '');
    const s = $('end-stats'); s.innerHTML = '';
    const rows = [
      ['对局时长', fmtTime(game.time)],
      ['你的代际', GENS[f.gen].short + (f.asi.state === 'done' ? ' → ASI' : '')],
      ['击杀 / 损失', `${f.kills} / ${f.losses}`],
      ['政策使用', stats.policies],
      ['集群占领', stats.captures],
      ['跳槽 流入/流出', `${stats.defectionsIn} / ${stats.defectionsOut}`],
      ['最终信任', Math.round(f.trust)],
      ['最终对齐', Math.round(f.alignment)],
    ];
    for (const [k, v] of rows) s.append(el('div', 'stat', `<span>${esc(k)}</span><b>${esc(v)}</b>`));
    $('btn-spectate').classList.toggle('hidden', !(kind === 'defeat' && !game.over));
    endBox.classList.remove('hidden');
  }
  $('btn-restart').onclick = () => act.restart();
  $('btn-spectate').onclick = () => { endBox.classList.add('hidden'); act.spectate(); };

  // ---- per-frame update ------------------------------------------------------------
  function update(dt) {
    const f = me();
    // rates
    sampler.t += dt;
    if (sampler.t >= 1.2) {
      if (sampler.last) {
        sampler.rates.compute = (f.compute - sampler.last.c) / sampler.t;
        sampler.rates.data = (f.data - sampler.last.d) / sampler.t;
        sampler.rates.influence = (f.influence - sampler.last.i) / sampler.t;
      }
      sampler.last = { c: f.compute, d: f.data, i: f.influence };
      sampler.t = 0;
    }
    const setChip = (k, val, rate) => {
      const c = rChips[k];
      c.querySelector('.rv').textContent = Math.floor(val);
      const r = c.querySelector('.rr');
      if (rate !== undefined) { r.textContent = `${rate >= 0 ? '+' : ''}${rate.toFixed(1)}/s`; r.className = 'rr' + (rate < 0 ? ' neg' : ''); }
    };
    setChip('compute', f.compute, sampler.rates.compute);
    setChip('data', f.data, sampler.rates.data);
    setChip('influence', f.influence, sampler.rates.influence);
    {
      const used = game.units.reduce((n, u) => n + (u.faction === pf ? UNITS[u.type].talent : 0), 0);
      const c = rChips.talent;
      c.querySelector('.rv').textContent = `${used}/${f.talentCap}`;
      c.querySelector('.rr').textContent = `招聘 ×${hireMult(f).toFixed(2)}`;
      c.classList.toggle('full', used >= f.talentCap);
    }
    for (const [k, key] of [['trust', 'trust'], ['alignment', 'alignment'], ['risk', 'risk']]) {
      const v = Math.max(0, Math.min(100, f[key]));
      meters[k].f.style.width = v + '%';
      meters[k].v.textContent = Math.round(v);
      if (k === 'alignment') meters[k].f.classList.toggle('ready', v >= TUNE.alignedThreshold);
      if (k === 'risk') meters[k].f.classList.toggle('hotr', v > 45);
      if (k === 'trust') meters[k].f.classList.toggle('low', v < TUNE.scrutinyTrust);
    }

    // race tape
    for (let i = 0; i < 4; i++) {
      const rf = game.factions[i], L = lanes[i];
      if (!rf.alive) {
        L.lane.classList.add('dead');
        L.stage.textContent = '出局';
        continue;
      }
      const asiPart = rf.asi.state === 'running' ? (1 - rf.asi.remain / rf.asi.total)
        : rf.asi.state === 'done' ? 1 : 0;
      const p = Math.min(1, ((rf.gen - 1) + asiPart) / MAX_GEN);
      L.fill.style.width = (p * 100).toFixed(1) + '%';
      L.fill.classList.toggle('asirun', rf.asi.state === 'running');
      L.stage.textContent = rf.asi.state === 'running'
        ? (rf.asi.paused ? 'ASI ⏸' : `ASI ${Math.round(asiPart * 100)}%`)
        : rf.asi.state === 'done' ? 'ASI ✓' : GENS[rf.gen].short.toUpperCase();
    }

    // ticker rotation — cycle back through recent wire stories
    newsT += dt;
    if (news.length > 1 && newsT > 6) {
      newsT = 0;
      newsIdx = (newsIdx + 1) % news.length;
      tickerText.innerHTML = news[newsIdx];
    }

    refreshT += dt;
    if (refreshT >= 0.3) { refreshT = 0; renderSel(); renderCmd(); drawMinimap(); }
  }

  return {
    update, onEvent, toast, showEnd,
    setSelection(ids) { selIds = ids.slice(); rivalPick = null; renderSel(); renderCmd(); },
    handleKey(code) { if (keys[code]) { keys[code](); return true; } return false; },
    getLastAlert: () => lastAlert,
    setCamRef: (fn) => { camRef = fn; },
    setPaused: (p) => { $('pausemark').classList.toggle('hidden', !p); $('btn-pause').textContent = p ? '▶ 继续' : '暂停'; },
    setSpeed: (s) => { $('btn-speed').textContent = s + '×'; },
    setSound: (on) => { $('btn-sound').textContent = on ? '声音' : '已静音'; $('btn-sound').classList.toggle('on', !on); },
  };
}
