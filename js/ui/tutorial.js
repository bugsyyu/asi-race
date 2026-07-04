// ============================================================================
// 教程 — 游戏内指南。分页帮助手册直接由与模拟层相同的常量生成，
// 外加一条脚本化的新手提示条：它观察游戏状态，玩家每学会一个动作就自动推进。
// ============================================================================
import { FACTIONS, BUILDINGS, GENS, ASI, POLICIES, TUNE } from '../sim/constants.js';

const $ = (id) => document.getElementById(id);
const kbd = (k) => `<kbd>${k}</kbd>`;

const TABS = {
  '目标': () => `
    <h3>赢下竞赛 —— 或者活过它</h3>
    <p>四家实验室正冲刺人工超级智能。依次研发四个模型代际（<b>Gen-1 → Gen-4 AGI</b>），
    然后启动<b>ASI 训练</b>（${ASI.cost.c}⚡ ${ASI.cost.d}◆，${ASI.time} 秒）。
    第一个跑完的训练将终结整场游戏 —— 对所有人而言。</p>
    <p>屏幕顶部那条彩色进度带<b>就是</b>这场竞赛本身。当某条泳道开始脉动，说明有人已启动最终训练。
    你可以跑得比他快，可以打出<b>监管调查</b>冻结他，也可以直接炮击他的园区 ——
    总部每挨一次打，训练就停摆 ${TUNE.asiPauseOnHqDamage} 秒。</p>
    <p><b>结局的方式很重要。</b>训练完成时<b>对齐 ≥ ${TUNE.alignedThreshold}</b>，
    你的模型醒来会是友善的；莽着跑完的话……嗯。本作共有六种结局。
    你也可以用老办法取胜：做最后一个还亮着灯的园区。</p>
    <p><b>战争迷雾。</b>没去过的地方一片漆黑；到过但无人驻守的区域会转暗，
    只显示你<b>最后一眼</b>看到的建筑 —— 对手此刻在干什么，得有单位在场才知道。
    单位视野约 ${TUNE.sightUnit}，建筑站得更高看得更远，占领的 GPU 集群也会替你放哨。
    唯一的例外是 ASI 训练的光柱：全世界都看得见。</p>`,
  '操作': () => `
    <h3>为触控板而生</h3>
    <div class="krow"><span>${kbd('双指滑动')}</span><span>平移镜头</span></div>
    <div class="krow"><span>${kbd('捏合')} / ${kbd('ctrl+滚轮')}</span><span>缩放</span></div>
    <div class="krow"><span>${kbd('双指点按')}</span><span>即右键：下达命令 — 移动 · 采集 · 施工 · 攻击 · 集结</span></div>
    <div class="krow"><span>${kbd('单击')} · ${kbd('拖框')} · ${kbd('shift')}</span><span>选中 · 框选 · 加选</span></div>
    <div class="krow"><span>${kbd('Q')}/${kbd('E')} · ${kbd('WASD')}</span><span>旋转 · 平移（方向键亦可）· ${kbd('H')} 回总部</span></div>
    <div class="krow"><span>${kbd('ctrl+1–4')} / ${kbd('1–4')}</span><span>保存 / 召回编队</span></div>
    <div class="krow"><span>${kbd('空格')}</span><span>跳转到最近一次遇袭地点</span></div>
    <div class="krow"><span>${kbd('P')} · ${kbd('F')} · ${kbd('M')}</span><span>暂停 · 二倍速 · 静音</span></div>
    <div class="krow"><span>${kbd('Esc')}</span><span>取消放置 / 关闭面板 / 取消选中</span></div>
    <p>指令卡上的每个按钮都在角落标注了快捷键。</p>`,
  '经济': () => `
    <h3>三种货币，一份编制</h3>
    <p><b>⚡ 算力</b>持续流入 —— 来自园区、数据中心（每座 ${TUNE.dcComputeRate}/秒）
    和地图中环可占领的 <b>GPU 集群</b>（${TUNE.clusterComputeRate}/秒）。每升一个模型代际，全部收入 +10%。</p>
    <p><b>◆ 数据</b>由研究员从发光的节点挖出，再搬回园区或实验楼。公开数据<i>会挖空</i>；
    四座富矿环绕地图正中的国会。到 Gen-3 后，你的实验楼会自动产出合成数据。</p>
    <p><b>◇ 影响力</b>来自站在国会大厦的说客（每人 ${TUNE.lobbyRate}/秒，
    ${TUNE.lobbyEffectiveCap} 人以内效率最佳）。攒下来打政策牌。</p>
    <p><b>☺ 人才</b>是你的单位上限，靠建造实验楼与数据中心扩充。招聘成本随<b>公众信任</b>浮动：
    人人喜爱的实验室，招人便宜。</p>
    <h3>建筑一览</h3>
    ${Object.entries(BUILDINGS).filter(([k]) => k !== 'hq').map(([k, b]) =>
      `<div class="krow"><span>${kbd(b.hotkey || '–')} <b>${b.name}</b></span><span>${b.desc}</span></div>`).join('')}`,
  '政治与信任': () => `
    <h3>看不见硝烟的战争</h3>
    <p><b>信任</b>（0–100）是公众对你的观感。它会缓慢回归 50；每发布一个新代际 +${TUNE.trustGenBonus}，
    出一次安全事故则 ${TUNE.trustIncidentHit}。信任太低会让招聘变贵、让你的研究员<b>跳槽去更体面的对手</b>；
    而且若在信任低于 ${TUNE.scrutinyTrust} 时启动 ASI 训练，监管者会给每个对手直接发放 +${TUNE.scrutinyInfluence}◇。</p>
    <p><b>风险</b>随每次抢跑新代际不断累积。积得太高，安全事故就会开始把你的建筑打成黑屏。
    <b>对齐研究院</b>能消解风险、修复信任，并抬升那条决定结局的对齐值。</p>
    <h3>政策牌（需要政策办公室 + ◇）</h3>
    ${Object.values(POLICIES).map((p) =>
      `<div class="krow"><span>${p.icon} <b>${p.name}</b> · ${p.cost}◇</span><span>${p.desc}</span></div>`).join('')}`,
  '结局': () => `
    <h3>六种收场方式</h3>
    <div class="krow"><span>✦ <b>对齐 ASI（你）</b></span><span>训练完成时对齐 ≥ ${TUNE.alignedThreshold}。最好的那个结局。</span></div>
    <div class="krow"><span>☠ <b>失控 ASI（你）</b></span><span>没达标就跑完了。你"赢"了。</span></div>
    <div class="krow"><span>◈ <b>对齐 ASI（对手）</b></span><span>谨慎的对手先冲线。人类没事；你失业了。</span></div>
    <div class="krow"><span>✖ <b>失控 ASI（对手）</b></span><span>鲁莽的对手先冲线。从此万物皆休。</span></div>
    <div class="krow"><span>⚑ <b>最后的实验室</b></span><span>所有对手园区被摧毁。竞赛以消耗战告终。</span></div>
    <div class="krow"><span>▽ <b>你的园区沦陷</b></span><span>总部被毁。你可以留下观战，看世界走向何方。</span></div>
    <h3>四大阵营</h3>
    ${FACTIONS.map((f) =>
      `<div class="krow"><span><b style="color:${f.css}">${f.glyph} ${f.name}</b></span><span><b>${f.bonusName}</b> — ${f.bonusDesc}</span></div>`).join('')}`,
};

// 帮助面板在开局前就存在（开始界面也会打开它）。
export function createHelp() {
  const help = $('help'), tabsBox = $('help-tabs'), body = $('help-body');
  let open = false, curTab = '目标';
  tabsBox.innerHTML = '';
  for (const name in TABS) {
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = () => { curTab = name; render(); };
    tabsBox.append(b);
  }
  function render() {
    [...tabsBox.children].forEach((b) => b.classList.toggle('on', b.textContent === curTab));
    body.innerHTML = TABS[curTab]();
    body.scrollTop = 0;
  }
  function show(tab) { if (tab && TABS[tab]) curTab = tab; render(); help.classList.remove('hidden'); open = true; }
  function hide() { help.classList.add('hidden'); open = false; }
  $('btn-help-close').onclick = hide;
  help.addEventListener('click', (e) => { if (e.target === help) hide(); });
  return { show, hide, isOpen: () => open };
}

export function createTutorial(game, uiState, help) {
  const pf = game.playerFaction;
  const mine = (pred) => game.units.some((u) => u.faction === pf && pred(u));
  const STEPS = [
    { text: '双指滑动平移镜头 · 捏合缩放 · Q/E 旋转视角', done: () => uiState.camMoved },
    { text: '按住左键拖出选框，框住你的三名研究员', done: () => uiState.selResearchers >= 2 },
    { text: '双指点按（右键）一个发光的 ◆ 节点，开始挖数据', done: () => mine((u) => u.state === 'gather' || u.state === 'return') },
    { text: '选中研究员后按 D，放下一座数据中心（+6⚡/秒）', done: () => game.buildings.some((b) => b.faction === pf && b.type === 'datacenter') },
    { text: '地图罩着战争迷雾 — 黑的地方没人去过，灰的地方只剩记忆。派个单位出门侦察', done: null, dwell: 10 },
    { text: '点击你的实验室园区，训练更多研究员（R）', done: () => game.units.filter((u) => u.faction === pf && u.type === 'researcher').length > 3 || (game.ents.get(game.factions[pf].hq)?.queue.length ?? 0) > 0 },
    { text: '顶部那条彩带就是竞赛本身 — 谁先跑完 ASI 训练，游戏立刻结束', done: null, dwell: 9 },
    { text: `攒够 ${GENS[2].cost.c}⚡ ${GENS[2].cost.d}◆，回园区研发 Gen-2（G）`, done: () => game.factions[pf].gen >= 2 || (game.ents.get(game.factions[pf].hq)?.queue.some((q) => q.gen) ?? false) },
    { text: 'Gen-2 解锁政策办公室 — 派说客去国会攒 ◇，然后开始耍手段', done: () => game.buildings.some((b) => b.faction === pf && b.type === 'policy'), dwell: 26 },
    { text: `ASI 完成时对齐 ≥ ${TUNE.alignedThreshold} 才是好结局 — 对齐研究院能把你送到那里`, done: null, dwell: 12 },
    { text: '盯紧风险条 — 连续抢跑代际会引发安全事故。随时按 ? 打开完整手册', done: null, dwell: 12 },
  ];
  const hint = $('hint');
  let step = 0, shownFor = 0, dismissed = false, shownStep = -1;

  function renderHint(text) {
    hint.replaceChildren();
    if (text === null) return;
    const span = document.createElement('span');
    span.textContent = text;
    const x = document.createElement('button');
    x.className = 'hx'; x.textContent = '✕'; x.title = '跳过这条提示';
    x.onclick = () => { step++; shownFor = 0; };
    hint.append(span, x);
  }

  function update(dt) {
    if (dismissed || game.over || !game.factions[pf].alive) { renderHint(null); return; }
    if (step >= STEPS.length) { renderHint(null); dismissed = true; return; }
    if (help.isOpen()) { renderHint(null); shownStep = -1; return; }
    const s = STEPS[step];
    shownFor += dt;
    if (shownStep !== step) { renderHint(s.text); shownStep = step; }
    const min = 2.5;
    if (s.done ? (shownFor > min && s.done()) : shownFor > (s.dwell || 8)) { step++; shownFor = 0; }
  }

  return { update };
}
