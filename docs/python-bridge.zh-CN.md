# Python 控制接口 — 使用指南与技术分析

语言：[EN](python-bridge.md) | ZH-CN

本仓库自带一套 **Python 控制接口**（`python/asirace`），可以完全从 Python 驱动游戏内的一切行为：下达单位命令、建造训练、研发代际、操纵政策与行业元经济、启动 ASI 训练，并以「战争迷雾诚实」或「全知」两种视角读取世界状态。接口有两种运行模式，共用同一套命令协议：

| 模式 | 入口 | 时钟归属 | 典型用途 |
| --- | --- | --- | --- |
| **无头（headless）** | `asirace.Game` | **Python**（锁步推进，完全确定） | 脚本机器人、批量实验、AI/RL 研究、回归测试 |
| **实况（live）** | `asirace.LiveGame` | 浏览器（实时） | 观战工具、外挂式助手、演示、接管任一阵营代打 |

依赖：Python ≥ 3.9 与 Node.js ≥ 18，**均无第三方包**（Python 侧全部标准库；Node 侧直接加载仓库内的模拟层源码）。

## 30 秒上手

```bash
# 无头：起一局、采数据、推进 60 秒
python3 - <<'PY'
import sys; sys.path.insert(0, 'python')
from asirace import Game, units_of, buildings_of, nodes_alive, nearest

with Game(seed=42, faction=0) as g:            # 0=OpenAI 1=Anthropic 2=DeepMind 3=xAI
    obs = g.observe()                          # 迷雾视角快照
    hq = buildings_of(obs, 0, 'hq')[0]
    g.gather(units_of(obs, 0, 'researcher'), nearest(nodes_alive(obs), hq['x'], hq['z']))
    g.step(seconds=60)
    print(g.observe()['factions'][0]['data'])  # 采回来的数据
PY
```

```bash
# 实况：浏览器开局后交给 Python
python3 -m http.server 8000                    # 终端 A：静态服务器
# 浏览器打开 http://localhost:8000/?bridge=8765 并点「开始竞赛」
python3 python/examples/live_control.py --takeover 3   # 终端 B：接管 xAI 代打
```

更多示例：`python/examples/quickstart.py`（API 之旅）、`scripted_bot.py`（在迷雾下打完整局的宏观机器人）、`live_control.py`（实时战报 + 接管）。运行 `npm run test:py` 可自检整条链路。

## 架构

```text
┌────────────────────────────  Python  ────────────────────────────┐
│  asirace.Game / LiveGame（命令方法、快照助手、find_spot 选址）      │
│  transport.NodeBridge（子进程 stdio） transport.WsBridge（WS 服务）│
└──────────────┬──────────────────────────────┬────────────────────┘
        JSON Lines / stdio             WebSocket（文本帧，同一套 JSON）
┌──────────────▼──────────────┐  ┌────────────▼────────────────────┐
│ bridge/server.mjs（无头）    │  │ js/bridge/live.js（浏览器内）     │
│ 生命周期：new_game / step    │  │ 实时：subscribe / pause / speed  │
└──────────────┬──────────────┘  └────────────┬────────────────────┘
               └──────────┬───────────────────┘
                ┌─────────▼──────────┐
                │ js/bridge/protocol.js │  ← 共享命令分发 + 快照/观测序列化
                └─────────┬──────────┘      （所有权校验在这一层）
                ┌─────────▼──────────┐
                │ js/sim/*（原样复用） │  ← 确定性模拟：0.1 s 固定步长
                └────────────────────┘
```

### 关键设计决策

1. **模拟层零侵入。** `js/sim` 本就与 DOM/three.js 解耦、由种子 RNG 驱动、并且内置 AI 与人类玩家共用同一组 `cmd*` 函数——这正是理想的进程外控制面。整个接口对模拟层的唯一改动是一行修复（见下文 NEXT_SID）。桥接是模拟之上的**旁挂层**，游戏本体、发行包与既有测试完全不受影响。

2. **一套协议，两种载体。** 命令分发、快照与迷雾观测全部实现在 `js/bridge/protocol.js`，无头服务器和浏览器实况桥只是两个不同的「壳」。协议测试一次通过，两种模式同时受益；未来加第三种载体（比如 TCP 多客户端）也只需再写一个壳。

3. **传输选型：JSON Lines over stdio + WebSocket。**
   - *为什么不是 HTTP/REST*：每条命令一次握手太重，且没有服务器推送（实况战报需要）。
   - *为什么不是 gRPC/protobuf*：引入代码生成与依赖链，违背本项目「普通 ES 模块、零构建步骤」的立项原则。
   - *为什么不用 Python 重写模拟*：双实现必然漂移，浏览器里的游戏与研究用模拟会渐行渐远。复用同一份 JS 源码，无头与浏览器行为**逐字节一致**。
   - stdio 的额外好处：子进程生命周期即会话（Python 退出＝模拟器回收，无端口占用、无孤儿进程）、天然背压、天然多实例并行（每个 `Game` 一个进程，互不干扰）。
   - JSON 开销实测可忽略（见性能一节）；协议消息面向「每思考一次一批」而非「每 tick 一条」设计。

4. **实况模式的角色反转。** Python 侧是 WebSocket **服务器**（`WsBridge`，纯标准库实现 RFC 6455 的必要子集：升级握手、掩码帧、分片、ping/pong、close），浏览器是客户端并每 2 秒自动重连。这样 Python 脚本可以随时启动、退出、重启，页面无需刷新；也免去了在 Python 侧引入任何 websocket 依赖。

5. **所有权校验在边界。** 模拟层的 `cmd*` 函数是全能的（内置 AI 以完全信任调用它们），例如 `cmdMove` 可以移动任何阵营的单位、`cmdAttack` 不阻止友军伤害、攻击数据节点会让 hp 变成 NaN。协议层把这些危险自由度挡在门外：每条命令必须携带行动阵营 `fid`，单位列表会被静默过滤为「属于 fid 的存活单位」，攻击目标必须是敌方单位/建筑。测试 `test/bridge.mjs` [1] 逐条覆盖这些护栏。

6. **错误分两类，机器人好写。** 游戏规则拒绝（资源不足、冷却中、选址不合法、目标已死）返回 `{ok:false, msg}` ——机器人循环里属于日常，绕过即可；协议误用（未知 op、未知单位类型、缺参数）返回 `{ok:false, error}`，SDK 将其抛为 `BridgeError` ——那是调用方的 bug，应当炸出来。判断标准：**运行期动态实体的消亡/易主一律算 msg**（目标死了、单位叛逃易主都是常态），静态表出错才算 error。

## 确定性与可复现性

- 模拟以固定 `0.1 s` 步长推进；随机性全部来自 `makeRng(seed)`（mulberry32），模拟层不使用 `Math.random`。
- 无头模式是**锁步**的：`step` 请求之外时间不流动。因此 `(seed, 命令调度)` 完全决定整局演化——`test/bridge.mjs` [4] 与 `test_smoke.py` [3] 均验证两个独立进程重放同一调度后**全量状态 JSON 字节级一致**。
- 注意命令本身也可能消耗 RNG（如 `channel` 的落点、训练完成的出生角度受先后影响），所以复现实验必须重放**完整**命令序列及其所在 tick，不能只重放「重要」命令。
- 修复：`js/sim/industry.js` 的创业公司 id 计数器 `NEXT_SID` 原先跨局不复位，同一进程内连开两局会得到不同的实体 id（不影响胜负，但破坏快照级复现）。现已随 `initIndustry` 复位，同进程 `new_game` 亦可字节级复现（测试 [3] 覆盖）。
- 跨平台提示：JS 的数值是 IEEE-754 双精度，四则运算处处一致；但 `Math.atan2/hypot/pow` 等超越函数不要求正确舍入，不同 JS 引擎/版本理论上存在 ULP 级差异。同一 Node 大版本内实测稳定；需要严格复现的实验请记录 Node 版本。
- **事件流即录像**：`step` 返回窗口内全部模拟事件（带时间戳）。`seed + 命令调度 + 事件流`三件套足以离线重建与分析整局比赛。

## 观测模型：三档视角与「公开情报」

| 调用 | 视角 | 用途 |
| --- | --- | --- |
| `state()` | 全知 | 分析工具、录像、调试 |
| `observe(fid)`，fid 为**被追踪阵营** | 迷雾诚实 | 训练/评测公平智能体 |
| `observe(fid)`，其他 fid | 全知，但带 `omniscient: true` 标记 | 多阵营脚本，明示不公平 |

引擎的迷雾只为一个视角建格网（`game.fog.fid`，即 `new_game` 的 `faction` 参数；内置 AI 本就全知——这是 `js/sim/ai.js` 注释言明的经典 RTS 让步）。因此**要公平就把你的智能体设为 `faction`**；`omniscient` 标记保证「以为在迷雾下训练、实际开了全图」这种静默错误不可能发生。

迷雾诚实视角下：

- 敌方**单位**仅在视野内出现；离开视野即消失。
- 敌方**建筑 / 数据节点 / GPU 集群**离开视野后按「最后所见」保留，带 `ghost: true`（建筑可能早已被拆——这正是记忆的语义）。
- 对手阵营条目只暴露**公开情报**：`gen`（demo day 是全场新闻）、`trust`（公众舆论）、`stock`（股价公开）、`cloud`（市场行为）、`roster/paradigms`（行业新闻）、`asi.state/stage`（训练光柱全图可见）。内部账本 `compute/data/influence/risk/alignment/techs` 与实体 id（如对方总部 `hq`）一律隐藏。
- `observe(fid, grids=True)` 附带 `visible/explored` 两张格网（base64 的 n×n 字节图，n=110、格 2 世界单位），解码：`import base64; bytes(base64.b64decode(g['visible']))`，行主序，索引 `j*n+i` 对应世界 `((i+0.5)*res-half, (j+0.5)*res-half)`。
- 公平性补全：交给 Python 的阵营会设 `isAI=false`，同时免除难度设置里的 AI 收入系数（`chill 0.82× / brutal 1.16×`），与人类玩家完全同规则。

## 协议参考

传输为 JSON 消息：stdio 一行一条；WebSocket 一帧一条。请求 `{id?, op, ...}`；响应回显 `id`（信封 `id` 优先于任何载荷字段——`build` 的新建筑 id 因此改名 `bid` 返回）。

### 生命周期（仅无头）

| op | 参数 | 说明 |
| --- | --- | --- |
| `hello` | — | 健康检查，回协议版本 |
| `new_game` | `seed?` `faction=0` `difficulty=normal` `allAI?` `control?=[fid…]` | 建局；`faction` 同时决定迷雾视角；`control` 列出的阵营脱离内置 AI。响应含 `meta`（全部静态数值表）与初始 `state`。同一进程可反复调用换局——即 SDK 的 `Game.reset()`，训练循环的快速通道（免重启进程、实体 id 稳定） |
| `step` | `ticks=1` 或 `seconds`；`until_over` `max_seconds=3600`；`events=true` `state?` `observe?=fid` | 推进模拟并带回窗口内事件；`until_over` 默认关事件（整局事件量以十万计），事件超 20 000 条保留最新并报 `eventsDropped`；`state/observe` 可搭车省一次往返 |
| `quit` | — | 结束进程 |

### 查询

`ping`、`meta`、`state`、`observe {fid, grids?}`、`can_place {fid,btype,x,z}`（返回选址/资源/前置三项判定与当前造价）、`costs {fid}`（含信任折扣与硬件指数后的实时单价）。

### 命令（全部要求 `fid`）

| op | 参数 | 对应模拟函数 |
| --- | --- | --- |
| `move` / `attack_move` / `stop` | `ids` `x z` | `cmdMove / cmdAttackMove / cmdStop` |
| `attack` | `ids` `target` | `cmdAttack`（拒绝友军与非战斗实体） |
| `gather` | `ids` `node` | `cmdGather`（限研究员） |
| `build_join` | `ids` `bid` | `cmdBuild`（加入己方未完工建筑） |
| `smart` | `ids` `target?` `x? z?` | 协议层按目标类型重推意图（sim 的 `cmdSmart` 写死了人类玩家视角，桥接版按 `fid` 判敌我） |
| `channel` | `ids` | `cmdChannel`（说客赴国会） |
| `build` | `btype` `x z` `builders?` | `cmdBuildStart`，新工地以 `bid` 返回 |
| `train` | `bid` `utype` | `cmdTrainUnit` |
| `rally` | `bid` `x z` `target?` | `cmdSetRally`（rally 到节点/工地/国会有自动上岗语义） |
| `research_gen` / `start_asi` | — | `cmdResearchGen / cmdStartASI` |
| `research_tech` | `bid` `key` | `cmdResearchTech` |
| `trade` | `dir: c2d\|d2c` | `cmdTrade`（现货市场，滑点随交易积累） |
| `policy` | `pid` `target?` | `cmdPolicy`（出口管制/补贴/调查/公关） |
| `raise` / `cloud` / `acquire` / `poach` | —/`on`/`sid`/`key` | 行业层 `cmdRaise / cmdCloudMode / cmdAcquire / cmdPoach` |
| `set_ai` | `ai: bool` | 切换该阵营内置 AI（关→交给外部控制；开→重挂全新 AI 状态机） |

### 实况专属（浏览器侧处理）

`subscribe {events?, state?=秒, fid?}`（订阅事件流 / 周期快照，快照周期按**模拟时间**计，暂停即停推）、`pause {on}`、`speed {x:1|2}`、`select {ids}`（在玩家 UI 里高亮）、`center {x,z}`（飞镜头）。推送消息形如 `{push:'events'|'state', ...}`，SDK 经 `poll()` 排队取用。实况模式拒绝 `step/new_game`（浏览器拥有时钟）。

## 性能（本容器实测，Node v22 / Python 3.11）

| 指标 | 实测 |
| --- | --- |
| 纯模拟吞吐（4 AI 全开，整局均值） | ≈ 3 200 tick/s ≈ **320× 实时** |
| 全知快照序列化（战局中期，73 单位） | 0.19 ms / ≈ 21 KB |
| 迷雾观测序列化 | 0.13 ms |
| Python 锁步单 tick 往返 | ≈ 0.54 ms（≈ 1 870 tick/s） |
| Python `observe()` 往返 | ≈ 0.28 ms |
| Python 批量推进 600 模拟秒 | 2.3 s（≈ **260× 实时**，含对手 AI） |

指导：训练/批量实验用「思考一次 → `step(seconds=Δ, observe=fid)` 搭车取观测」的节奏，瓶颈基本在你的智能体本身；即便每 tick 观测的极端锁步也有约千步每秒。

## 测试与验证

- `npm test` → `test/headless.mjs`（既有 9 组模拟测试，未动）＋ `test/bridge.mjs`（4 组 45 项：协议护栏、迷雾观测、stdio 服务器、双进程确定性）。
- `npm run test:py` → `python/tests/test_smoke.py`（6 组 29 项：端到端经济循环、多阵营控制、`reset()` 换局循环、确定性、整局 `until_over`、以及**离线 WebSocket 传输测试**——用脚本化「假浏览器」验证握手、掩码分片帧、ping/pong、推送队列与换页重连，无需真开浏览器）。
- 实况链路已在无头 Chromium 里做过真实端到端验证：Python 连上正在渲染的对局，选中/移动单位、飞镜头、二倍速、暂停均反映在游戏 UI 中，事件与状态推送正常回流。

## 已知局限与路线图

- **迷雾单视角**：引擎只为一个阵营维护迷雾格网。公平的多智能体自博弈需要把 `fog` 扩展成按阵营数组（内存 ×4、每 tick 重算 ×4，可行但属模拟层改动，留待后续）。
- **命令只校验所有权，不校验可见性**：与内置 AI 一致，控制端技术上可以对从未侦察到的实体 id 下令（模拟层本身全知）。诚实的智能体应只对 `observe()` 返回的内容行动；硬性可见性拦截会打破与内置对手的对称性，故刻意未加。
- **无存档/回滚**：树搜索类算法暂不能 `save/restore`；等价替代是 `seed + 命令重放`（快，见性能表）。事件流完整可导出。
- **实况模式单客户端**：`WsBridge` 一次服务一个页面；多观察者可再起端口。协议本身无状态，扩展成多客户端只需改壳。
- **无鉴权**：桥接假定本机可信，`WsBridge` 默认只监听 `127.0.0.1`；请勿将端口暴露到公网。
- **Gym 风格封装**是自然的下一步：`observe` 已给出结构化观测与 `exploredFrac` 之类的标量，动作空间建议从宏动作（建造类别 + 自动选址、按类编队攻防）起步，微操（逐单位连续坐标）留给进阶实验。
- 浏览器实况模式的模拟不是锁步的（RAF 驱动、可暂停），**不要**在实况模式做需要复现的实验——那是无头模式的职责。

## 文件地图

```text
bridge/server.mjs             无头 stdio 服务器（Node）
js/bridge/protocol.js         共享协议：命令分发 + 快照/观测（两种模式同源）
js/bridge/live.js             浏览器实况桥（?bridge=PORT 时由 main.js 动态加载）
python/asirace/               SDK：game.py（Game/LiveGame）、transport.py（stdio/WS）
python/examples/              quickstart / scripted_bot / live_control
python/tests/test_smoke.py    Python 侧端到端冒烟测试（npm run test:py）
test/bridge.mjs               协议与服务器测试（并入 npm test）
```
