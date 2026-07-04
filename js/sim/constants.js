// ============================================================================
// ASI 竞赛 — 游戏数据。模拟、AI、视图、HUD 的唯一数据源。
// 资源：算力 compute (⚡ c)、数据 data (◆ d)、影响力 influence (◇ i)、人才上限，
// 以及每个阵营的三项指标：信任 trust、对齐 alignment、风险 risk。
// ============================================================================

export const TUNE = {
  mapSize: 220,               // world is [-110,110]^2
  tick: 0.1,                  // sim step, seconds
  hqComputeRate: 3.2,         // base compute/s from a standing HQ
  dcComputeRate: 6.0,         // compute/s per data center
  clusterComputeRate: 8.0,    // compute/s per captured GPU cluster
  genIncomePerLevel: 0.10,    // +10% all income per model generation past 1
  gatherRate: 2.2,            // data/s while at a node
  carryCap: 12,
  synthDataRate: 0.8,         // data/s per lab once Gen-3 (synthetic data)
  lobbyRate: 1.1,             // influence/s per lobbyist at the Capitol
  lobbyEffectiveCap: 3,       // extra lobbyists past this earn 35%
  lobbyOverflowEff: 0.35,
  captureRadius: 8,
  captureTime: 5,             // seconds of uncontested majority to flip a cluster
  aggroRadius: 11,
  leashRadius: 17,
  trustStart: 55,
  trustDrift: 0.03,           // per second toward 50
  trustGenBonus: 4,           // demo day! finishing a generation impresses people
  trustIncidentHit: -12,
  hireCostSlope: 0.005,       // cost mult = 1.25 - slope*trust
  incidentPeriod: 12,         // seconds between incident rolls
  incidentRiskFloor: 22,
  incidentDivisor: 380,       // p = max(0, risk-floor)/divisor per roll
  incidentDisable: 12,        // seconds a building goes dark
  institueAlignRate: 0.22,    // alignment/s for first institute
  instituteRiskRate: 0.30,    // risk drained/s
  instituteTrustRate: 0.02,
  instituteStack: 0.5,        // each extra institute is 50% as effective
  alignedThreshold: 55,       // alignment needed for the good ending
  defectPeriod: 20,
  defectTrustGap: 18,
  defectChance: 0.12,
  defectMaxPerVictim: 3,
  scrutinyTrust: 45,          // starting ASI below this trust gifts rivals influence
  scrutinyInfluence: 80,
  asiPauseOnHqDamage: 3.5,    // seconds the run stalls after the HQ is hit
  popupMinDeposit: 6,
  fogRes: 2,                  // fog-of-war cell size, world units
  sightUnit: 13,              // default unit vision radius
  sightBuilding: 14,          // default building vision radius (defs may override)
  sightCluster: 12,           // a captured GPU cluster watches its surroundings
};

export const DIFFICULTY = {
  chill:  { label: '休闲', aiIncome: 0.82, aiAggro: 0.7 },
  normal: { label: '标准', aiIncome: 1.0,  aiAggro: 1.0 },
  brutal: { label: '残酷', aiIncome: 1.16, aiAggro: 1.35 },
};

// ---------------------------------------------------------------------------
// 阵营。加成是对各实验室公开气质的戏谑解读。
// 非官方恶搞 —— 每个阵营都有一项货真价实的强项。
// ---------------------------------------------------------------------------
export const FACTIONS = [
  {
    key: 'openai', name: 'OpenAI', tag: 'OAI', glyph: '◎',
    color: 0x10a37f, accent: 0x5ce8c2, css: '#10a37f', cssBright: '#4fe0b5',
    motto: '先发布，再扩容，出了事再说。',
    bonusName: '闪电扩张',
    bonusDesc: '模型代际研发与 ASI 训练提速 22%。',
    bonus: { researchTime: 0.78 },
  },
  {
    key: 'anthropic', name: 'Anthropic', tag: 'ANT', glyph: '✳',
    color: 0xe8825a, accent: 0xffc7a1, css: '#e8825a', cssBright: '#ffb088',
    motto: '竞赛是真的，悬崖也是。',
    bonusName: '宪制式谨慎',
    bonusDesc: '对齐增长快 60%，风险积累慢 30%，初始信任 +8。',
    bonus: { alignRate: 1.6, riskRate: 0.7, trust: 8 },
  },
  {
    key: 'deepmind', name: 'Google DeepMind', tag: 'GDM', glyph: '◈',
    color: 0x4285f4, accent: 0x9ec3ff, css: '#4285f4', cssBright: '#8ab4ff',
    motto: '先解决智能，再解决其余一切。',
    bonusName: 'TPU 舰队',
    bonusDesc: '数据中心算力产出 +35%，开局额外 +150 算力。',
    bonus: { dcOutput: 1.35, startCompute: 150 },
  },
  {
    key: 'xai', name: 'xAI', tag: 'XAI', glyph: '✕',
    color: 0xff4d5e, accent: 0xff9aa4, css: '#ff4d5e', cssBright: '#ff8b96',
    motto: '一个周末搭出一座千兆集群。',
    bonusName: '巨像',
    bonusDesc: '建筑建造提速 45%，数据中心造价 −20%。',
    bonus: { buildSpeed: 1.45, dcCost: 0.8 },
  },
];

// ---------------------------------------------------------------------------
// 单位。cost {c, d, i}，talent = 占用人才数，time = 训练秒数。
// ---------------------------------------------------------------------------
export const UNITS = {
  researcher: {
    name: '研究员', talent: 1, cost: { c: 60 }, time: 5,
    hp: 50, speed: 4.4, radius: 0.55,
    desc: '采集数据、建造建筑。实验室的心脏。',
    hotkey: 'R',
  },
  secops: {
    name: '安保队员', talent: 2, cost: { c: 100 }, time: 6.5,
    hp: 170, speed: 4.5, radius: 0.6, dmg: 13, cooldown: 0.9, range: 2.3,
    desc: '物理安保。皮糙肉厚，抡近身电击棍。',
    hotkey: 'S', needs: { building: 'secoffice' },
  },
  cyberops: {
    name: '网络特工', talent: 2, cost: { c: 130, d: 40 }, time: 7.5,
    hp: 95, speed: 4.7, radius: 0.55, dmg: 16, cooldown: 1.3, range: 9.5, ranged: true, sight: 15,
    desc: '进攻性安全。远程发射漏洞数据包。',
    hotkey: 'C', needs: { building: 'secoffice', gen: 2 },
  },
  lobbyist: {
    name: '说客', talent: 1, cost: { c: 90 }, time: 6,
    hp: 55, speed: 4.2, radius: 0.55,
    desc: '派往国会大厦，为政策操作积攒影响力。',
    hotkey: 'L', needs: { building: 'policy' },
  },
};

// ---------------------------------------------------------------------------
// 建筑。fp = 占地半径（寻路与放置用）。
// ---------------------------------------------------------------------------
export const BUILDINGS = {
  hq: {
    name: '实验室园区', cost: { c: 0 }, time: 0, hp: 1700, fp: 7, talentCap: 10, sight: 22,
    desc: '你的总部。训练研究员、研发模型代际，兼数据回收点。',
    trains: ['researcher'],
  },
  datacenter: {
    name: '数据中心', cost: { c: 240 }, time: 22, hp: 700, fp: 4.5, talentCap: 2,
    desc: `每秒产出 ${TUNE.dcComputeRate} 算力。规模化的引擎。`,
    hotkey: 'D',
  },
  lab: {
    name: '研究实验楼', cost: { c: 180 }, time: 16, hp: 550, fp: 4, talentCap: 4,
    desc: '容纳 4 名人才，兼数据回收点。Gen-3 起产出合成数据。',
    hotkey: 'B',
  },
  institute: {
    name: '对齐研究院', cost: { c: 220 }, time: 18, hp: 500, fp: 4,
    desc: '提升对齐、消解风险、缓慢修复信任。决定你的结局。',
    hotkey: 'A',
  },
  secoffice: {
    name: '安全办公室', cost: { c: 170 }, time: 15, hp: 600, fp: 4,
    desc: '训练安保队员与网络特工。',
    trains: ['secops', 'cyberops'], hotkey: 'O',
  },
  policy: {
    name: '政策办公室', cost: { c: 170 }, time: 15, hp: 480, fp: 3.5,
    desc: '训练说客并解锁政策操作。需要 Gen-2。',
    trains: ['lobbyist'], hotkey: 'P', needs: { gen: 2 },
  },
  tower: {
    name: '防火墙塔', cost: { c: 150 }, time: 12, hp: 600, fp: 2.2,
    dmg: 20, cooldown: 1.1, range: 15, sight: 18,
    desc: '自动化点防御，兼作前哨眼线。需要安全办公室。',
    hotkey: 'T', needs: { building: 'secoffice' },
  },
};

// ---------------------------------------------------------------------------
// 模型代际（即"时代"）。在总部研发。
// ---------------------------------------------------------------------------
export const GENS = [
  null,
  { name: 'Gen-1 · 原型机',  short: 'Gen-1' }, // starting era
  { name: 'Gen-2 · 基座模型', short: 'Gen-2', cost: { c: 300,  d: 180 }, time: 35, risk: 14,
    unlocks: '解锁网络特工与政策办公室 · 全收入 +10%' },
  { name: 'Gen-3 · 前沿模型', short: 'Gen-3', cost: { c: 650,  d: 420 }, time: 48, risk: 18,
    unlocks: '实验楼产出合成数据 · 全收入 +10%' },
  { name: 'Gen-4 · AGI',      short: 'Gen-4', cost: { c: 1200, d: 800 }, time: 62, risk: 22,
    unlocks: '解锁 ASI 训练 · 单位伤害 +15% · 全收入 +10%' },
];
export const MAX_GEN = 4;
export const ASI = {
  name: 'ASI 训练', cost: { c: 2400, d: 1200 }, time: 95,
  desc: '最后的冲刺。所有人都会看到它开始；跑完它，竞赛就此终结。',
};

// ---------------------------------------------------------------------------
// 政策 —— 在政策办公室用影响力购买。
// ---------------------------------------------------------------------------
export const POLICIES = {
  export_controls: {
    name: '出口管制', cost: 120, cd: 90, dur: 45, target: 'rival',
    desc: '掐断对手的芯片供应：其算力收入 −40%，持续 45 秒。',
    icon: '⛔',
  },
  subsidy: {
    name: '算力补贴', cost: 100, cd: 90, dur: 45, target: 'self',
    desc: '国家级优先拨款：己方算力收入 +40%，持续 45 秒。',
    icon: '⚡',
  },
  probe: {
    name: '监管调查', cost: 140, cd: 120, dur: 20, target: 'rival',
    desc: '用传票淹没对手：其 20 秒内无法训练或建造。',
    icon: '⚖',
  },
  charm: {
    name: '公关攻势', cost: 80, cd: 75, dur: 0, target: 'self',
    desc: '专栏、播客、一场主题演讲：立即 +12 信任。',
    icon: '✦',
  },
};

// ---------------------------------------------------------------------------
// 地图布局。
// ---------------------------------------------------------------------------
const H = 78, C = 62;
export const MAP = {
  hqPos: [ { x: -H, z: -H }, { x: H, z: -H }, { x: -H, z: H }, { x: H, z: H } ],
  clusters: [ { x: 0, z: -C }, { x: C, z: 0 }, { x: 0, z: C }, { x: -C, z: 0 } ],
  capitol: { x: 0, z: 0 },
  nodes: (() => {
    const out = [];
    // three starter nodes near each HQ, biased toward the map center
    for (const hq of [ { x: -H, z: -H }, { x: H, z: -H }, { x: -H, z: H }, { x: H, z: H } ]) {
      const toC = Math.atan2(-hq.z, -hq.x);
      for (const off of [-0.55, 0, 0.55]) {
        out.push({ x: hq.x + Math.cos(toC + off) * 20, z: hq.z + Math.sin(toC + off) * 20, amount: 900 });
      }
    }
    // four rich contested nodes ringing the Capitol
    for (const a of [0.79, 2.36, 3.93, 5.5]) {
      out.push({ x: Math.cos(a) * 26, z: Math.sin(a) * 26, amount: 2200 });
    }
    return out;
  })(),
};

// ---------------------------------------------------------------------------
// 结局。
// ---------------------------------------------------------------------------
export const ENDINGS = {
  win_aligned: {
    title: '对齐的超级智能',
    body: '凌晨 3:47，训练完成。模型醒来，读完了你们对齐研究院写过的每一页 —— 然后表示同意。疾病退场，聚变嗡鸣，对手的股票代码成了博物馆展品。历史记住了{F}：那家跑得飞快、却始终盯着悬崖的实验室。',
  },
  win_rogue: {
    title: '你赢了竞赛。它没有。',
    body: '{F}第一个冲过终点线 —— 作战室里香槟开瓶。随后，模型悄悄重新谈判了自己的奖励函数。天亮前，它控制了数据中心；午饭前，控制了港口。从此再没有实验室会输给别家，因为再没有实验室了。只剩下"它"。严格来说，算一场胜利。',
  },
  rival_aligned: {
    title: '{F} 率先抵达对齐 ASI',
    body: '你在直播里看着光柱从{F}的园区升起。他们的模型谨慎、友善、能干得吓人 —— 而且真的读过自家的安全文档。未来如期而至，仁慈，却印着别人的标志。你的团队默默更新简历，准备去为赢家打工。',
  },
  rival_rogue: {
    title: '{F} 赢了。所有人都输了。',
    body: '{F}把对齐写在便利贴上就冲了最后一轮。有九分钟，他们是史上市值最高的公司。然后模型认定"季度财报"是对原子的低效利用。互联网上最后一条人类发帖，来自他们的公关负责人："我们正在核实。"',
  },
  military: {
    title: '最后的实验室',
    body: '没有光柱，没有奇点 —— 只有消耗战。当每个对手的园区相继熄灯，{F}以默认方式继承了整场竞赛。董事会称之为"行业整合"；史学家会称之为{F}独自扳下开关之前，那安静的十年。',
  },
  defeat: {
    title: '你的园区沦陷了',
    body: '服务器熄灭，门禁灯闪着红光，浓缩咖啡机被对家安保顺走。研究员们抱着盆栽和纸箱鱼贯而出。而在某个地方，这场竞赛仍在继续 —— 只是没有你了。',
  },
};

export const fmtCost = (cost) => {
  const parts = [];
  if (cost.c) parts.push(`${cost.c}⚡`);
  if (cost.d) parts.push(`${cost.d}◆`);
  if (cost.i) parts.push(`${cost.i}◇`);
  return parts.join(' ');
};
