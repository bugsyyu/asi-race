# ASI 竞赛（ASI Race）

一款在浏览器中运行的 3D 即时战略游戏：四家 AI 实验室风格的阵营围绕算力、数据、人才、政府影响力、公众信任、风险和对齐展开竞赛，最终由率先完成 ASI 训练的一方结束游戏。

> 非官方戏仿作品。项目与 OpenAI、Anthropic、Google DeepMind、xAI 或任何真实实验室无关联、未获背书；阵营设定是基于公开印象的游戏化改写，不包含真实人物。

## 在线源码

本仓库保存的是 Fable 生成包里的共享浏览器游戏源码，并补齐了 `vendor/three.module.js`，因此源码检出后可直接用本地静态服务器运行。

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

也可以运行模拟层测试：

```bash
npm test
# 等价于 node test/headless.mjs
```

## Release 下载

GitHub Release `v1.0.0` 包含两个原始平台包：

- `asi-race-mac-zh.zip`：macOS 版，包含 `ASI竞赛.app` 和 `启动游戏.command`
- `asi-race-win-zh.zip`：Windows 版，包含 `启动游戏.cmd` 和 PowerShell 本地服务器启动器

两个平台包都会在首次联网启动时自动下载 `three.module.js`，之后可离线游玩。本仓库源码版已经直接 vendored 该文件。

## 操作

| 输入 | 动作 |
| --- | --- |
| 双指滑动 | 平移镜头 |
| 捏合 / ctrl+滚轮 | 缩放 |
| 双指点按 / 右键 | 智能命令：移动、采集、攻击、集结 |
| 单击 / 拖框 / shift | 选中、框选、加选 |
| Q / E、WASD / 方向键、H | 旋转、平移、回总部 |
| ctrl+1-4 / 1-4 | 保存 / 召回编队 |
| 空格 | 跳转到最近一次遇袭地点 |
| P、F、M、Esc、? / F1 | 暂停、二倍速、静音、取消、手册 |

游戏内置五页「战地手册」，覆盖目标、操作、经济、政治与信任、结局。

## 核心玩法

- 算力来自总部、数据中心和可占领的 GPU 集群。
- 数据由研究员从地图节点采集，高阶实验楼可自动产出合成数据。
- 影响力来自国会游说，可用于出口管制、算力补贴、监管调查和公关攻势。
- 人才决定单位上限，信任影响招聘成本和被挖角风险。
- 抢跑研发会积累风险，对齐研究可降低事故概率并影响结局质量。
- 胜利路线包括 Gen-2、Gen-3、Gen-4（AGI）到 ASI 训练，也可以摧毁所有对手总部。

阵营包括 OpenAI、Anthropic、Google DeepMind 和 xAI 风格的四方，每方有不同经济或安全倾向加成。

## 项目结构

```text
index.html            浏览器入口
css/                  HUD、开始页、战场覆盖层样式
js/sim/               确定性模拟层，不依赖 DOM 或 three.js
js/view/              three.js 表现层、地形、建筑、角色、特效
js/ui/                HUD 与游戏内教程
js/audio/             WebAudio 音效和环境配乐
js/shared/            模拟与渲染共用函数
test/headless.mjs     Node 模拟层测试
vendor/               vendored three.js v0.170.0
packaging/            从 macOS / Windows 包中抽出的启动器源码
```

模拟层以固定 0.1 秒步长推进，渲染层只读取状态并播放表现效果。AI 玩家与玩家走同一套命令 API。

## 原始提示词

```text
Build me a playable 3D real-time strategy game in the browser — Age of
Empires-style gameplay from a bird's-eye view — as a metaphor for the AI race
to superintelligence. The factions are OpenAI, Anthropic, Google DeepMind, and
xAI, each with brand-inspired identity and a bonus matching their personality.
Don't just reskin an RTS: invent the mechanics from the metaphor — think about
what these labs actually compete over (compute, data, talent, government favor,
public perception) and turn those into the economy, the tech progression, and
the win condition. Rival labs should be real AI opponents racing you, and the
whole thing should end with someone reaching superintelligence first.
Use Three.js (plain ES modules, no build step, local static server), built entirely
from real downloaded assets — high quality ones, never AI-generated.
Characters should be rigged models that genuinely walk, work, and fight with
skeletal animations. Make it cinematic and juicy — dramatic lighting, real
shadows, feedback effects on every action — and give it a full soundscape: real
sound effects for combat, building, and alerts, with quiet background music
underneath. Trackpad-first controls, a clean overlay HUD, and an in-game how-
to-play guide. Keep the simulation separate from the rendering, and verify each
system live in the browser as you build rather than at the end.
```

## 资产说明

原始提示词要求使用真实下载资产；当前 Fable 产出的包中实际只依赖下载版 Three.js，建筑、角色几何、骨骼动画、贴图、音效和环境音乐均由项目代码程序化生成。仓库保留这一实现现状，并把 Three.js 固定为 `0.170.0` 以便源码直接运行。
