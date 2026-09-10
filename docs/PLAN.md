# TDShogi 开发计划（路线图）

> 最近更新：**2026-09-07**（结构重整：进行中 / 待做 / 已归档 三段式；新增 §M6 复盘浏览模式统一）
> 配套：`ARCHITECTURE.md`（服务端架构）、`UI-PAGES.md`（页面地图）、`agents/MEMORY/REFLECTIONS.md`（排障复盘）
> 图例：⬜ 待实施 ｜ 🟨 已改码/进行中，待验证 ｜ ✅ 已完成 ｜ ⏸ 暂缓

---

## 0. 协作约定与当前状态

**协作约定（2026-09-05 定）**
- **测试全部由用户执行**（e2e 套件 + 浏览器实机验证）；我只交付代码改动与文档更新，
  改动后自做 `node --check`、lint 与必要的临时目录纯函数验证（**不起服**）。
- 新需求 / 新 bug **先入计划再实施**；实施后在原条目补「实施记录」，不留口头结论。
- 服务端任何改动**必须重启进程**才生效（已多次因未重启导致误判）。
- 中文多行内容不要放进 PowerShell 的 `-m` / `node -e` 参数（编码会被破坏），改用临时文件。

**当前状态（2026-09-07）**
- 版本 **v1.3.0**；git 备份 `71ccff1` + tag `v1.3.0`（纯本地仓库，无 remote）。
- 服务端 **16 模块**（含新增 net/audit/privacy）、前端 **16 脚本**（含 gallery.js），无构建步骤。
- 部署包：`dist/tdshogi-deploy-v1.3.0.zip`（bsdtar 打包）。**数据库无 schema 变更**，可直接覆盖升级。
- 回归资产 `scripts/e2e-*.js` 共 10 套件（详见 `ARCHITECTURE.md` §8），最近一次全量 190 项。

---

## 1. 优先级路线图

| 优先级 | 编号 | 主题 | 状态 | 依赖 |
|---|---|---|---|---|
| **P0** | **§P1** | **单元测试基建（node --test + `npm test`）** | **🟨 34 项全绿（2026-09-10 新增 game.js 规则引擎 14 项）；规则边界 4 项待确认** | — |
| P1 | §P2 | eslint（`no-undef` 等） | ✅ 已实施（2026-09-10），首跑抓出 18 个 error | — |
| P1 | §P3 | CI（GitHub Actions：lint + check + test + e2e 冒烟） | ✅ 已实施（2026-09-10） | §P1 |
| P2 | §P4 | 统一 logger 与错误上报 | ⬜ 待实施 | — |
| P2 | §P5 | WS 消息契约（类型常量 + 入参校验） | ⬜ 待实施 | — |
| P1 | §J2 | 王手红格高亮丢失（play 页） | ✅ 已修复（`setCheck`，2026-09-08） | — |
| **P1** | **§R1** | **观战视角切换（先手/后手）** | **✅ 已实施（2026-09-10），待实测** | — |
| P2 | §R4 | 观战列表显示观众数 / 热门对局 | ⬜ 待实施 | — |
| P2 | §R2 | kibitz 观战评论强化 | ⬜ 待实施 | — |
| P1 | §J4 | demo_state 下发权威 hands，兜住前端模型漂移 | ⬜ 待定（用户暂缓） | — |
| **P1** | **§M6** | **复盘浏览模式：FreeBoard 增 `review` 模式，统一所有看谱场景** | **✅ 已实施（2026-09-08），待用户实测** | 建议与 M5 一起做 |
| **P1** | **§S** | **前端体验优化（设置面板 / 手机端布局 / 触屏误触 / 棋盘坐标 / 图集切换）** | **🟨 设计完成（`docs/FRONTEND-REFACTOR.md`），待实施** | 用户痛点，建议先于 §M5 |
| P2 | §M5 | 前端拆分（play / admin 按职责内聚） | 🟨 设计完成（同文档），待实施 | 与 §S 分两轮做 |
| P3 | §M1 | `rooms.js` 1820 行 mixin 拆分 | ⬜ 待实施 | 功能稳定后单独窗口 |
| P3 | §M2 | `server.js` 路由模块化 + 统一 admin 中间件 + eslint no-undef | ⬜ 待实施 | §C 的既有前提 |
| P3 | §M4 | 存储双写统一（会话单一来源 = kv） | ⬜ 待实施 | — |
| P4 | §C1/C3/C5/C6 | 管理后台其余增强（总览/棋谱管理/公告/实时干预） | ⬜ 未排期 | M2 + K 审计 |
| — | §Q1-Q7 | 商业化 / 产品候选池（见 §3） | ⏸ 待你排期 | — |
| P4 | §D | 长期 Backlog | ⏸ | — |

**推荐执行顺序**：~~§P1 单测~~ ✅ → ~~§P2 eslint~~ ✅ → ~~§P3 CI~~ ✅ →
**§S 前端体验（1 轮）→ §M5 拆分（1 轮）→ §M2 → §M1 → §M4 → §C 剩余项**。
理由：**没有测试兜底的大拆分风险太高**——M1/M6/M5 都是结构性改动，必须有回归网；
§P1 是纯增量（只加测试不改业务），半天可落地，且能立刻拦住 J3 那类"映射表写错一个字"的缺陷。

---

## 2. 进行中 / 待验证

### J2 王手（check）红格高亮疑似丢失 — ⬜ 待核实

- `play.js:113` 调 `fb.setModel({board, hands}, state.lastMove, { check: [...] })`，
  但 `FreeBoard.setModel(modelLike, lastMove)` 只收两个参数 → 第三个被丢弃；
  `FreeBoard.render()` 也不再给 `board.render` 传 `check`（旧的 `reapplySelection()` 会传）。
- 处理：起服走一局王手局面确认；若确认丢失，给 FreeBoard 加 `setCheck(sqList)` 并在 `render()` 透传。
  **复盘页同样没有 check 与上一步高亮**——并入 §M6 一起解决。

### J4 加固建议：demo_state 下发权威 hands — ⬜ 待定

- **背景**：J3 之所以能长期潜伏，是因为**感想战推演的持驹完全由前端本地重放得出**——
  服务端 `_broadcastDemo` 只发 `moves/kif/legalTargets...`，**不含 `hands`**，
  前端模型一旦有偏差，显示就是错的且无从校验。
- **方案**：`_broadcastDemo` 与 `demoEnter` 载荷追加 `hands`（服务端 `_demoGame` 取 `game.hands()`，零额外计算）；
  前端 `applyDemoMode()` 以服务端 hands 覆盖本地重放结果（moves 仍走本地重放，以支持历史手跳转）。
- **收益**：前端模型漂移被服务端权威兜住，同类 bug 不再靠肉眼发现。

---

## 3. 待做专题

## §M 模块化重构

### M6 复盘浏览模式（FreeBoard 第四模式 `review`）— ✅ 已实施（2026-09-08），待实测

**实施记录（"FreeBoard 模块优化日"）**

| 项 | 内容 |
|---|---|
| 新增 `js/piece-kinds.js` | 棋种映射**单一来源**（PROMOTE/DEMOTE/DROP_NAME/NAME_TO_KEY + rawOf/promoteOf/isPromoted/dropSymOf/nameOfDrop），`board.js` 与 `freeboard.js` 统一引用（无 PieceKinds 时退回内联备份）；**加载时 `validate()` 自检互逆**，再写错映射控制台立刻报错 |
| `freeboard.js` | ① 新增第四模式 `review`（只读，`_canPickHand` 拒绝、点击仅回执 `onSqClick`）② 新增 `setCheck()` / `setLastMove()`，`render()` 透传 `check`（修 **§J2**）③ `setMode` 加 MODES 校验（并删除了重复的旧 `setMode`）④ 触屏拖拽阈值 12px（鼠标 6px）、触屏不 `preventDefault`、ghost 抬到手指上方、记录 `pointerType` ⑤ 吃子统一走 `rawOf` ⑥ 导出常量与纯函数供测试 |
| `review.js` | 浏览与自由摆放**统一走同一个 FreeBoard 实例**：`ensureFb()` + `setModel(..., lastMoveSq())`；自由摆放改为 `setMode('free') + setInteractive(true)`，退出回到 `review`（不再 destroy/new）；新增 `lastMoveSq()` 计算上一步落点 |
| `play.js` | 王手改调 `fb.setCheck([...])`（此前第三个参数被 `setModel` 丢弃） |
| `css/board.css` | `.cell/.hand-piece` 禁选中与点击高亮；触屏下棋盘与驹台 `touch-action:none`（防拖拽被 pointercancel 打断） |
| 页面 | `play.html` / `review.html` 引入 `piece-kinds.js`（在 pieces.js 之后、board.js 之前） |

**最终形态**：FreeBoard 四模式 `play / demo-rules / free / review`；
复盘页、历史页、棋谱广场、管理后台回放、对局页终局浏览**共用同一条渲染链路**。

> 用户要求（2026-09-07）：扩展出统一的**复盘浏览模式**，之后**所有查看棋谱的场景都用这个模式**。先入计划，暂不实施。

**现状：看棋谱有两条不同的渲染路径（双轨）**

| 场景 | 当前实现 | 问题 |
|---|---|---|
| 复盘页浏览（翻手看局面） | 裸 `ShogiBoard`：`board.render({board,turn}, {}, 'b')` + 手写两次 `window.renderHands(...)`（`review.js:198-199`） | **没有上一步高亮**（extra 传 `{}`）、**没有王手高亮**（同 J2）、持驹渲染逻辑与 play 页重复 |
| 复盘页自由摆放 | `new FreeBoard(...)`（`review.js:464`） | 只有这条走了组件 |
| 对局页（对战/感想战） | 全流程 `FreeBoard`（`ensureBoard` + `fb.setModel/render`） | 已统一 ✓ |
| 历史页 / 广场 / 管理后台回放 | 都跳转 `review.html` → 落在上面第一条（裸 board） | 所以"所有看谱场景"目前都是裸 board |

**方案：给 FreeBoard 增加第四种模式 `review`**

```
FreeBoard 模式（四选一）
  play       对战：高亮服务端合法落点，onMove 交页面发送
  demo-rules 感想战：按规则推演，本地乐观渲染 + 服务端校验
  free       自由摆棋：不校验规则，本地草稿
+ review     复盘浏览：只读（interactive=false），自动带上一步高亮 / 王手高亮 / 持驹
```

- `new FreeBoard({ mode:'review', interactive:false, viewpoint, hands:{...} })`，
  翻页时 `fb.setModel({board, hands}, 当前手落点)`，`render()` 内部统一处理 lastMove / check / 持驹
- 自由摆放时切 `setInteractive(true)` + `setMode('free')`，不再 `destroy()` 重建（消除双实例切换）
- `setCheck()` 一并在 M6 落地（顺带解决 J2）

**统一后的收益**
1. 所有看谱场景（复盘页 / 历史页 / 棋谱广场 / 管理后台回放 / 对局页终局后浏览）共用一条渲染链路
2. 白拿上一步高亮与王手高亮，消除 play 与 review 的体验差异
3. 持驹渲染只剩一处实现，移动端适配（§N）也只改一次
4. 为后续能力留扩展位：复盘时点击棋盘看该局面合法手、变着试下、局面评注浮层

**验收**：复盘页翻手有落点高亮、王手局面有红格、持驹与 play 页一致、自由摆放切换无闪烁、
375px 移动端正常（与 §N 一致）、`e2e-freeboard` 与手工复盘回归通过。

### M5 前端拆分（按页面内聚，不做框架迁移）

| 文件 | 现状 | 拆分 |
|---|---|---|
| `review.js` | 约 22 KB（本轮新增广场/管理面板后继续膨胀） | 抽出「复盘器内核」：`reviewer/{board（FreeBoard review 模式）,moves,annotations,admin}`，供 gallery → review 复用 |
| `play.js` | 34 KB（对战+感想战+聊天+棋钟混编） | `play/{core,demo,chat,clock}.js` |
| `admin.js` | 约 20 KB（4 tab） | `admin/{records,users,tournaments,audit}.js` |

建议与 M6 同期做：先统一组件（M6），再按模块拆文件（M5），顺序反了会拆两次。

### M1 `src/rooms.js`（1820 行，全仓最大且是历史 bug 高发区）

**方案：mixin 模式**（各文件导出 `function apply(X) { X.prototype.xxx = ... }`，
`this.*` 调用链全部保留，**不做对象重组**——风险最低的拆法）。

新目录 `src/rooms/`：

| 文件 | 内容 | 行数估计 |
|---|---|---|
| `index.js` | `RoomManager` 骨架 + 映射表 + mixin 装配（对外保持 `require('./rooms')` 兼容） | ~150 |
| `config.js` | 常量：时制、房间码表、各超时常量（支持 env 覆盖） | ~80 |
| `lifecycle.js` | createRoom / joinRoom / quickMatch / cancelMatch / leave / resign / rematch / makeMove / chat | ~450 |
| `binding.js` | `_bindClient` / `_unbindClient` / reconnect / bindToActiveGame / findPendingGame / spectate / randomSpectate / `_autoLeave*` | ~350 |
| `clock.js` | `initClockState` / `_startClock` / `_tick` / `_stopClock` / `_clockData` | ~120 |
| `state.js` | `_gameState` / `_pushState` / `_legalTargetsMap` / `getRoomStateForClient` / `activeGames` / `stats` | ~250 |
| `snapshot.js` | `_snapshotRoom` / `_snapshotAll` / `_clearSnapshot` / `_restoreRoom` / `restoreSnapshots` | ~120 |
| `demo.js` | 感想战全部：`_initDemo` / `_demoGame*` / `demoAction` / `demoLegal` / `demoEnter` / `_broadcastDemo` | ~300 |
| `cleanup.js` | `_dissolveRoom` / `_scheduleWaitingDissolve` / `_scheduleDisconnectLoss` / `_cleanupFinished` | ~120 |

**验收**：拆分后跑全量 e2e（用户执行）；期间**禁止**顺手改行为，纯搬运。

### M2 `server.js` 路由模块化

- `src/http/` 目录：`routes/{home,lobby,records,accounts,admin,tournaments}.js` + `middleware/{adminAuth,error,requestCtx}.js`
- 统一 admin 中间件（当前每个路由各写一遍 `admin.verify(token)`，是 §C 的既有前提）
- `resolvePlayer` / `sanitize` 等工具移入 `src/http/util.js`
- **配 eslint `no-undef`**：今天 `server.js` 漏 `require('./src/auth')` 导致四条管理路由 500，
  `node --check` 与现有 lint 都查不出，只能靠运行时暴露（见 §K8 教训）
- WS 部分保留在 `server.js`

## §P 工程质量与防回归基建（2026-09-07 新增）

> 背景：当前**无 CI、无 eslint、无一个纯单元测试**（scripts 里 17 个文件全是要起服的 e2e/工具），
> `package.json` 只有 `start/dev`。所有正确性依赖"起服 + 手工点"，
> 因此出现了「漏 require 导致 4 条路由 500」「成驹还原表写错一个字潜伏到用户吃子才发现」这类问题。

### P1 单元测试基建 — ⬜ 待实施（最高优先级）

- **工具**：Node 22 内置 `node --test`，**零新依赖**；`package.json` 加 `"test": "node --test tests/*.test.js"`
  （注意：Windows 下 `node --test tests/` 会把目录当模块解析失败，必须用 `*.test.js` glob）
- **目录**：`tests/*.test.js`（与 `scripts/e2e-*` 分离：前者纯函数不起服，后者需起服）
- **数据隔离**：涉及 storage 的用例统一 `process.env.DATA_DIR = '.tmpdata-test'` 并 `after` 清理
- **覆盖优先级**（先做前四类，都是纯函数、收益最高）：

| 模块 | 断言重点 |
|---|---|
| `game.js` | 走法生成、王手过滤、升变区判定、打步死/二步、千日手 |
| `ratings.js` | 等级曲线（0→0 / 2→1 / 6→2 / 14→3 / 30→4 / 62→5 / 封顶 64）、`addExp`、`adminSetPlayer` |
| `records.js` | `normalizeComments`（旧字符串/新数组/空）、`setComment`（新增 / **他人改被拒** / force 编辑 / 删除）、KIF 导出含 `*评论`、`canView` / `listPublic` / `setMeta` |
| `coords.js` | USI ↔ 坐标双向转换（**固化"本项目 USI 与标准上下颠倒"的断言**，防后人按标准直觉改坏） |
| `privacy.js` | `stripPrivate` / `assertNoPrivate`（隐私出口白名单） |
| `net.js` | `normalizeIp` / `clientIp`（`TRUST_PROXY=0/1/true` 三档取值） |
| `auth.js` | `adminSetTitle` / `banPlayer` / `unbanPlayer`（临时 DATA_DIR） |

- **分工澄清**：单元/纯函数测试**由我编写并运行**（属于交付自检，不起服、不碰真实数据）；
  e2e 套件与浏览器实机验证仍由你执行（既有约定不变）。
- **首批已落地（2026-09-08，`npm test` 18 项全绿）**：
  - `tests/piece-kinds.test.js`（9 项）：映射互逆自检、**成駒还原（含 J3 回归：馬→角）**、
    别名 杏/圭/全、金玉不可升变、打子符号双向、NAME_TO_KEY 全覆盖
  - `tests/freeboard.test.js`（9 项）：坐标换算、初始盘面（双方各 20 枚、玉的位置）、
    走子、升变、**吃馬进驹台得角（J3 回归）**、吃龍得飛、吃未成角得角、打子扣驹台与归零移除
- **浏览器模块如何在 Node 中加载**：两个文件都是 IIFE 挂 `window`，
  测试里先 `globalThis.window = {}` 再 `require`（freeboard 用到 `window.renderHands`，给个空函数即可）

### P2 eslint — ⬜ 待实施（并入 §M2）

- `eslint.config.js`（flat config）：`no-undef`、`no-unused-vars`，node + browser 双环境
- 先只开 error 级，逐步收紧；**优先拦 `no-undef`**（今天 `server.js` 漏 `require('./src/auth')` 的那一类）

### P3 CI — ⬜ 待实施

- `.github/workflows/ci.yml`：Node 22 → `npm ci --omit=dev` → `npm test` → 全量 `node --check` → 起服跑 e2e
- 当前仓库无 remote，先写好配置，推远端时自动生效

### P4 统一 logger 与错误上报 — ⬜ 待实施

- `src/logger.js`：级别（`LOG_LEVEL` env）、结构化输出（ts/level/ctx/msg）、roomId / playerId / requestId 上下文
- 分批替换散落的 `console.error`；线上异常有据可查，不必等你回传日志

### P5 WS 消息契约 — ⬜ 待实施

- `src/messages.js`：消息类型常量 + 入参校验函数；`_routeInner` 改用常量 switch
- 非法/未知消息直接回 `error` 而不依赖 try-catch 兜底，减少"消息字段写错静默失败"

## §Q 商业化 / 产品候选池（2026-09-07 新增，待你排期）

| 编号 | 方向 | 说明 | 现状缺口 |
|---|---|---|---|
| Q1 | 注册转化 | 游客可全功能使用 → 账号价值弱。用等级/经验/称号/收藏/战绩做账号专属权益，强化"游客数据一键迁移"入口（migrate 已有） | 缺引导与权益设计 |
| Q2 | 内容运营 | 棋谱广场 + 解说评论 = 内容资产，利于 SEO；做「每周名局」栏目与首页运营位 | 广场刚建成，无运营位 |
| Q3 | 赛事前台与自动化 | 赛事系统后端已完整（报名/审核/对阵/冠军）；道场与俱乐部最愿付费的是**赛程展示页 + 自动编排 + 报名提醒 + 结果公示** | 缺前台与通知 |
| Q4 | AI 陪练 / 棋力测试 | USI 引擎接入（Backlog 已有），商业价值最高，适合会员制 | 未做 |
| Q5 | 社交与俱乐部 | 关注/好友/私信/道场入驻，直接提升留存 | 未做 |
| Q6 | PWA | 加 `manifest` + service worker 缓存静态资源，手机可"安装到桌面"（无构建步骤，成本很低） | 未做 |
| Q7 | 安全合规（对外运营前必做） | ~~`/api/history?player=` 越权枚举~~ ✅ 2026-09-10 已修（见下）；接口速率限制、CSRF/XSS 面待做 | 越权已修 |

### §Q7-1 棋谱越权修复 — ✅ 已实施 2026-09-10

**问题**：`/api/records/search?player=<任意id>` 与 `/api/history?player=<任意id>` 在服务端都
**无法验证「请求者就是该 id」**。而游客 id 在大厅列表 / 观战页 / 悬停卡里都是公开的 →
任何人拿到他人的 id 就能枚举其全部棋谱（含完整走子）。这就是挂在 Backlog 很久的「越权枚举」。

**修复思路**：不再依赖「id 保密」，而是让身份**可验证**。

| 出口 | 改法 |
|---|---|
| `/api/history` | **仅管理员**（adminToken 无效一律 403）；`protocol.historyData` 删除非管理员分支 |
| `/api/records/search` | 管理员可查全部 / 指定人；非管理员 `player` **必须是可验证的账号令牌**，且只能查该令牌自己；游客 403 |
| **WS `record_search`**（新增） | 身份取握手时 `identify()` 的会话，**强制覆盖客户端传的任何 playerId**；`limit` 上限 200 |
| `history.js` | 检索改走 WS（发 `record_search`，收 `record_search_result`），不再传 player |

**为什么改为 WS**：REST 是裸 query 参数，而游客在 Node 侧没有可验证凭证（`guest.id` 既不保密、也无法自证）；
WS 连接握手时已由服务端 `identify()` 绑定身份，是唯一可信来源。账号用户则可用令牌自证（保留 REST 兼容）。

**验证脚本**：`scripts/test-records.js` 已改写为断言新边界——
① WS 检索能拿到自己的棋谱；② REST 用他人 id 查询 → 403；③ `/api/history` 游客访问 → 403。

### §Q7-2 棋谱存储索引化 — ✅ 已实施 2026-09-10

**问题**：`records` 表原本只有 `(id, data, createdAt)`，而 `data` 里存的是**整谱**（含 100+ 手 moves）。
所有列表 / 检索都是「拉一批 data → 逐条 `JSON.parse` → 内存过滤」：

| 位置 | 旧行为 | 代价 |
|---|---|---|
| `records.listPlayerRecords` | `listRecords(500)` 后 filter | 解析 500 份整谱 |
| `records.listPublic`（广场） | `listRecords(1000)` 后 filter | 解析 **1000 份整谱** |
| `protocol.historyData`（管理后台） | `listRecords(1000)` | 解析 1000 份整谱 |
| `protocol.playerCardData`（悬停卡） | 经 `listPlayerRecords` → 仍拉 500 条 | **每次悬停**解析 500 份 |
| `accounts.migrateGuestData` | `dbList(100000)` 全表遍历 | 游客升级账号时全库解析 |

Node 单进程下 `JSON.parse` 是**同步阻塞**的 → 打开一次广场 / 棋谱页就可能卡住主线程，
期间所有人的走子广播都在排队。数据量上去后这是最先暴露的瓶颈。

**方案：摘要列 + 索引**

- `records` 新增标量列：`playerB / playerW / nameB / nameW / result / resultDetail /
  moveCount / opening / pub / visibility / source / timeControl / rated / winnerId / durationSec / meta`
- 索引：`playerB`、`playerW`、`(pub, createdAt)`
- 写入（`putRecord`）与回填（`backfillRecordSummaries`）**共用 `summaryValues()`**，保证两条路径口径一致
- 新接口 `listSummaries() / countSummaries()`：**只 SELECT 标量列，完全不碰 data**
- `searchRecords()` 改走摘要列（`moveCount` / `opening` / `nameB` / `nameW` 等）；
  只有「走法片段关键词」这一种条件仍需扫 `data`
- `opening` 列存**前 10 手** USI（供检索前缀匹配），对外展示仍截前 4 手（与旧行为一致）
- `accounts.migrateGuestData` 改为先用 `playerB/playerW` 索引**只取受影响的棋谱**再逐条改写

**迁移**：`ensureRecordColumns()`（PRAGMA 查列 → ALTER 补列 → 建索引）+ `backfillRecordSummaries()`
（以 `moveCount IS NULL` 判定「未回填」，事务批量 UPDATE）。由 `getDb()` 惰性初始化时触发，
因此**任何入口**（含脚本 / 测试）都保证已回填，且幂等。

**⚠️ 踩到的坑（验证脚本抓到的）**：摘要列索引**不能**写在 `initDb` 的建表 SQL 里——
老库的 `CREATE TABLE IF NOT EXISTS` 不会补列，同批 `CREATE INDEX ON records(playerB)` 会直接
`no such column` 导致启动失败。索引必须由 `ensureRecordColumns()` 在 ALTER 之后建。

**验证**：
- 老结构库（只有 id/data/createdAt）→ 自动补列 + 回填 → **21 项断言全过**
- **真实库副本**（33 条棋谱）→ 全部回填；摘要字段正确、不含 moves、按 playerId 查询命中、二次回填为 0
- `npm test` 20 项全绿；前端 `admin.js` / `history.js` 的手数显示改用 `moveCount`

### §Q7-3 接口速率限制 — ✅ 已实施 2026-09-10

新增 `src/ratelimit.js`（内存固定窗口；零依赖、零外部服务，与项目定位一致）：

| 档位 | 窗口 / 上限 | 用途 |
|---|---|---|
| `api` | 600 / 分钟 | `/api` 全局兜底（宽松，避免 NAT 共享出口 IP 误伤） |
| `auth` | 20 / 5 分钟 | `/api/login`、`/api/register` 防密码爆破 |
| `adminLogin` | 8 / 10 分钟 | WS `admin_login`，**按 IP** 计，登录成功即清零 |
| `heavy` | 60 / 分钟 | `/api/history`、`/api/records/search`、`/api/admin/users`、`/api/admin/audit` |
| `wsMsg` | 40 / 秒 | WS 单连接消息速率（正常对局远低于此，仅拦脚本刷消息） |
| `wsNotice` | 1 / 5 秒 | 限流提示节流（否则「错误响应」本身会形成新的洪泛） |

- 超限返回 **429 + `Retry-After`**；WS 侧**静默丢弃** + 节流提示
- 桶自动清理（`prune()`，60 秒定时 + `unref()` 不阻止进程退出）
- 开关：`RATE_LIMIT_DISABLED=1`（本地压测 / 排障用）
- ⚠️ 限流键为 `clientIp`，**遵守 `TRUST_PROXY`**——反代部署若未配该变量，所有请求会被视为同一 IP
- 验证：专项脚本 13 项断言全过（窗口计数、过期恢复、reset、prune、预置档位）

### §P2 eslint + §P3 CI — ✅ 已实施 2026-09-10

- **eslint v10 扁平配置** `eslint.config.js`：分 Node（CJS）/ 浏览器（IIFE）两套 globals；
  只启用高价值规则（`no-undef` + 结构类），不引入风格规则以免制造无意义 diff
- `npm run lint`。**首跑即抓出 18 个 error**，其中一个是真隐患：
  - `public/js/play.js` 的 **`freeMode` 从未声明** → 赋值时创建了隐式全局 `window.freeMode`
    （非严格模式不报错，属跨脚本污染隐患）。已补 `let freeMode = false;`
  - `public/js/admin.js` 的 `viewUser(...)` 依赖全局属性访问（`window.viewUser = ...`），
    已改为显式 `window.viewUser(...)`
- 顺带清理死代码：`game.js` 的 `KING_POSITIONS`、`rooms.js` 未用的 `getRecord`、`records.js` 未用的 `countSummaries`
- `.github/workflows/ci.yml`：`static-and-unit`（全量 `node --check` + eslint + `npm test`）
  + `e2e`（起服 3100 跑 `scripts/e2e-*.js`；`continue-on-error`，不卡主流程）
- 现状：**0 error / 7 warning**（warning = `play.js` 两个 v6 遗留死函数 + 测试脚本未用变量）

### §P1 单元测试扩充 — 🟨 34 项（2026-09-10）

新增 `tests/game.test.js`（14 项）：初始局面与 40 子、坐标映射、**开局合法着法 = 30**、
走子/手番/lastMove、非法着法拒绝且不留痕、无持驹不可打子、升变区判定、升变执行、
**王手放置禁止（含对照用例）**、吃子进驹台、持驹展示顺序、认输、SFEN 解析。

**刻意未写的断言**：规则边界项待确认（见下），不把臆测固化成"规范"——错误的测试比没有测试更糟。

### §P1 规则边界修正 — ✅ 已实施 2026-09-10（用户拍板后）

用户 2026-09-10 确认三项判定，已改 `src/game.js` 并补测试：

| # | 项 | 原行为 | 修正后 | 改动点 |
|---|---|---|---|---|
| R-a | **困毙**（未被将却无步可走） | 判和棋，记 `'入玉'` | **判负**，记 `'困毙'` | `updateResult()` 合并「无合法着法 → 判负」，文案按是否被将区分 詰み / 困毙 |
| R-b | **强制升变**（歩/香到底线、桂到最下两段） | 同时给出「成」「不成」 | **只给「成」** | 新增 `mustPromote(kind,toY,color)`；`candidateMovesFrom` 不再生成「不成」候选；`applyMove` 拦截不带 `+` 的此类着法 |
| R-c | **千日手** | 一律判和 | **连续王手千日手判王手方负** | `isFourfoldRepetition()` → `detectRepetition()`：返回 `{repeated, perpCheckBy}`，统计 4 次重复区间内各方「步数 vs 将军次数」 |
| R-d | 持将棋点数判定（入玉宣言法 24 点） | 未实现 | **仍未实现**（用户未要求） | 保留 TODO |

- 新增测试 5 项（困毙判负、歩/桂强制升变、普通千日手判和、连续王手千日手判负）→ **`npm test` 39 项全绿**
- 副作用：`resultDetail` 新增两个取值 `'困毙'` 与 `'連続王手の千日手'`（前端横幅按原文展示，无需改动）

## §R 观战互动增强（向 81Dojo 靠拢，2026-09-10）

**本轮已修的观战 bug（代码已落地，待实测）**

| # | 问题 | 修复 |
|---|---|---|
| 1 | 观众列表只有名字、无 playerId → 无法悬停看选手卡、无法区分同名 | `_spectatorList()` 返回 `{id,name,rating,level}`；`_gameState` 与 `spectator_update` 同步；前端渲染带 `data-player-id`（hovercard 生效）与 Lv |
| 2 | **同一身份开多窗口观战被重复计数** | 按 `playerId` 去重，同人只算一个观众 |
| 3 | **刚进入观战的人看到"暂无观众"** | 进场用 `state.spectators` 快照初始化（此前只有 `spectator_update` 才渲染） |
| 4 | **观战者发言一律显示"观众"** | 服务端用其会话真名，并带 `role`（`player-b`/`player-w`/`spectator`）；前端给观战者发言加 👁 标识 |

### R1 观战视角切换（先手 ⇄ 后手）— ✅ 已实施 2026-09-10

**改动**

| 文件 | 内容 |
|---|---|
| `public/js/freeboard.js` | 新增 `setViewpoint(vp)`：翻转 `viewpoint` 并**交换驹台 `myColor / oppColor`**；清选中；同视角幂等、非法值忽略 |
| `public/js/play.js` | 新增 `spectatorViewpoint`（默认 `'b'`）与 `currentViewpoint()`：对局者固定自己视角、观战者用可切换视角；`render()` 与 `enterDemo()` 改用 `currentViewpoint()`；`ensureBoard()` 后调 `fb.setViewpoint()`；感想战分支（`reviewActive`）同样同步视角；新增 `btnViewpoint` 点击处理 |
| `public/play.html` | 顶部按钮组新增 `#btnViewpoint`（仅观战者显示，文字为「🔄 视角·先手 / 後手」） |
| `tests/freeboard.test.js` | 新增 2 项：配色交换与幂等/非法值、切换时清选中 |

**关键设计（避免踩坑）**

- **绝不交换驹台 DOM 元素**。`bindHands()` 给每个元素绑的 pointerdown 监听器在闭包里捕获了 color，
  一旦交换元素，监听器里的 color 就与实际渲染的持驹错位。改为只交换 `myColor / oppColor` 两个标记——
  `render()` 用它们决定「下方驹台渲染谁的持驹」，效果等价且不动 DOM、不重建监听。
- 视角切换**必须清选中**：残留的 `selectedSq / selectedHand` 属于另一视角，否则会出现「选中了对手视角的格子」。
- 观战者 `interactive = false`，驹台拖拽入口 `_handleHandPointerDown` 本就有 `!this.interactive` 拦截，
  配色交换不会带来越权行棋风险。
- 感想战（终局推演）中观战者同样可切视角——`render()` 的 `reviewActive` 分支原本会提前 return，
  故在该分支内也调一次 `setViewpoint`。

**验收**：观战一局 → 点「🔄 视角·先手」→ 棋盘翻转、上下玩家栏与双方驹台互换、按钮文字变「视角·後手」；
再点回先手；新走子推送后视角保持不被重置；对局者本人看不到该按钮。
**注意**：本次只改前端静态资源，**无需重启服务进程**，但需强制刷新浏览器（静态资源禁强缓存，正常刷新即可）。

### R4 大厅显示观众数 + 热门排序 — ✅ 已实施 2026-09-10

- 服务端：`rooms.activeGames()` 每局追加 `spectatorCount`；新增 `RoomManager.spectatorCount(room)`，
  **按 playerId 去重**（同一身份多窗口只算一个），口径与对局页观众列表（`_spectatorList`）一致；
  只做计数、不查资料，适配大厅 5 秒轮询
- 前端 `lobby.js`：列表按 `spectatorCount` 降序（`Array.sort` 稳定 → 同人数保持服务端原序），
  观众 >0 时 meta 显示 `👁 N 人观战`，否则维持原「· 观战」提示
- **易错点（已规避）**：排序后「渲染」与「点击绑定」必须共用同一个数组，否则出现
  「点 A 卡却进入 B 房」的错位 bug
- 验证：`spectatorCount` 去重口径专项验证通过（无观众→0、同人多窗口→去重、未注入 registry 时回退连接数）

**待做的观战互动（向 81Dojo 靠拢）**

| 编号 | 项 | 说明 | 建议 |
|---|---|---|---|
| R1 | **观战视角切换** | ~~观战者固定先手视角~~ → ✅ 已实施，见上 | 已完成 |
| R2 | **kibitz 观战评论** | 现有房间聊天已具备雏形（观众可发言、不落谱、房内可见）。需强化：观众/玩家发言配色区分、@提及、观战评论与对局聊天分区 | 中 |
| R3 | 观众进出提示 | 系统消息「XX 进入/离开观战」，可开关避免刷屏 | 小 |
| R4 | **观战列表增强** | lobby 每局显示观众数、热门对局排序 | ✅ 已实施（见下） |
| R5 | 观战信息增强 | 观战者可见双方等级/称号/用时/本手耗时 | 小 |
| R6 | 终局后观战 | 观战者自动进入感想战旁观 | 已有 ✓ |

**建议顺序**：R1 → R4 → R2 → R3 → R5。**观战者视角与观众数是"看棋"体验的核心，投入小、感知强。**

---

## §S 前端体验优化（2026-09-10 用户提出，设计已完成）

**痛点**：用户反馈「**手机端难用**」（触屏误触、按钮太小、滚动别扭）。

**新需求**
- **棋盘坐标标注**：筋 `1–9`（右→左）、段 `一–九`（上→下），**默认隐藏**，设置里可开
- **用户设置面板**：音效、棋子图集、坐标显示等集中管理

**设计文档**：`docs/FRONTEND-REFACTOR.md`（现状盘点 + 三块设计 + 实施顺序 + 验收清单 + 开放问题）

**设计调研时定位到的真实问题**（有代码依据，很可能就是「别扭」的根源）：
1. `style.css` 在 `@media (max-width:900px)` 里写了 `.play-side { order: -1 }` →
   **手机上打开对局页，先看到的是「棋谱 / 观众 / 操作」三个面板，要往下滚才见棋盘**（主次颠倒）
2. `board.css` 在触屏下对棋盘设 `touch-action: none`，而拖拽走子默认开启 →
   「想滚页面」会被识别成「拖拽走子」而**误走一手**

**计划条目**

| 编号 | 项 | 要点 | 状态 |
|---|---|---|---|
| S1 | 用户设置面板 | 新增 `js/settings.js`，收敛为单一 `tdshogi_settings` 键；导航 ⚙️ 入口；迁移旧 `tdshogi_theme`/`tdshogi_sound` | ✅ 已实施 |
| S2 | 手机端对局页布局 | 统一 `order:0`、侧栏限高、进入自动滚到棋盘 | ✅ 已实施 |
| S3 | 触屏误触 | `dragToMove` **默认关**（点选两步走子）；触屏热区 ≥44px；放开棋盘纵向滚动 | ✅ 已实施 |
| S4 | 棋盘坐标标注 | 独立标注层，**跟随视角翻转**，`pointer-events:none` | ✅ 已实施 |
| S5 | 棋子图集切换 | 读设置；外部 `window.PIECE_ATLAS_DEFAULT` 仍可覆盖 | ✅ 已实施 |

#### 实施记录（2026-09-10，S1–S5 一轮全部落地）

| 项 | 交付 |
|---|---|
| **S1** | **新增 `public/js/settings.js`**：单一键 `tdshogi_settings`；`SCHEMA` 驱动面板渲染（加设置项只改一处）；`subscribe()` 广播；旧键 `tdshogi_theme`/`tdshogi_sound` **只读一次迁移、不删旧键**（回滚安全）；面板 DOM 与样式**动态注入**，不改 HTML 结构；导航加 ⚙️ 入口。9 个页面均在 `nav.js` **之前**引入该脚本 |
| **S2** | `style.css` 的 900px 断点去掉 `.play-side { order: -1 }`（641–900px 的小平板/窄窗口此前仍是「面板在上、棋盘在下」，而 ≤640px 早已改回）；侧栏棋谱/聊天限高；`play.js` 新增 `scrollBoardIntoViewOnce()`，窄屏首次拿到局面即把棋盘滚入视口（有 900px 判断，只用一次） |
| **S3** | 设置项 `dragToMove` **默认关**；`freeboard.js` 新增 `_dragEnabled()`——触屏且未开启时直接跳过拖拽入口，**点击走子完全不受影响**；`@media (pointer: coarse)` 下 `body.no-drag` 放开棋盘 `touch-action: pan-y`，解决「想滚页面却误走一步」；按钮 ≥42px、驹台热区用 `::after` 外扩到 ≈44px |
| **S4** | `board.js` 新增 `buildCoords()` + `renderCoords(viewpoint)`：绝对定位独立层，**与格子同口径随视角翻转**（先手 9…1 筋在左，后手相反），`pointer-events:none` 不吃点击；窄屏 `cellSize()` 推导同步扣除坐标留白（70→92）防溢出 |
| **S5** | `board.js` 的 `getAtlas()` 改为读设置；`play.js` / `review.js` 订阅设置变更重渲染棋盘（坐标/图集/上一步高亮） |

- 校验：`node --check`、`npm run lint`（**0 error**）、`npm test`（39 项）全绿
- **待实机确认**：手机首屏即见棋盘、滚动手感、坐标随视角翻转、图集切换即时生效
- ⚠️ 已知限制：即时切换坐标时格子的**像素尺寸不会重算**（`cellSize` 在渲染时确定），窄屏可能略有溢出；刷新页面即完全对齐

### §S6 复盘页视角翻转 — ✅ 已实施 2026-09-10

**需求**（用户提出）：查看棋谱页（`review.html`）此前**固定先手视角**，应也能翻转。

**实现**
- `review.html` 顶部工具栏新增「🔄 翻转视角」按钮
- `review.js` 新增 `viewpoint` 状态（默认 `'b'`）；`render()` 中：
  - 调 `fb.setViewpoint(viewpoint)` —— **直接复用 §R1 观战视角的机制**（连带交换驹台配色）
  - 玩家栏按视角排布（上方=对面、下方=自己），`data-player-id` 随之指向正确一方
- **顺带修掉一个潜伏隐患**：`freeboard.js` 的 `_handleHandPointerDown` 原先使用监听器闭包捕获的
  `color`，视角翻转后该值会与左右驹台不符（`setViewpoint` 只交换配色标记、**不重建监听器**）→
  改为以 `e.currentTarget.dataset.fbColor` 为准纠正。
  **这同时修好了 §R1 观战翻转时同样的隐患**（此前只影响「自由摆放 + 翻转视角」组合，故一直未被发现）

**验证**：`node --check`、`npm run lint`（0 error）、`npm test`（39 项）全绿

**建议顺序**：S1 → S2 → S3 → S4 → S5（一轮「用户可感知」的体验批次，风险低），
之后**单独一轮**做 §M5 拆分（结构性改动，需完整回归）。

**待用户确认**（详见设计文档 §8）：图集数量、坐标样式、拖拽默认值、是否「按设备自动」。

### §S0 玩家栏 id 丢失 + 复盘悬停卡失效（老 bug）— ✅ 已定位并修复 2026-09-10

**现象**（用户报障）：退出再进来之后，**重进的那个人**在对局页与复盘页都看不到双方的 id
（玩家名上的悬停信息卡失效）。

**根因是两个独立缺陷，症状相同**：

| # | 位置 | 根因 |
|---|---|---|
| 1 | `public/js/play.js` | `api.on('state')` 的终局分支是 `enterDemo(state); return;` ——**跳过 `render()`**。而玩家栏（名字 / ELO / `data-player-id`）只写在 `render()` 里。于是**重进者**（首个 state 就是 `FINISHED`）的玩家栏**从未被渲染**；一直在页面上的人经历过 `PLAYING`，早就渲染过了 —— 这就是「只有重进的人中招」的原因 |
| 2 | `public/js/review.js` | 渲染玩家名只设 `textContent`，**从未 `setAttribute('data-player-id')`**。服务端 `reviewData` 其实**已返回 `playerIds`**，前端根本没用 → 复盘页悬停卡从未生效过 |

**修复**
1. 抽出 `renderPlayerBars(st)`，在 `render()` 与 `enterDemo()` 中**都**调用（终局分支不再漏渲染）
2. `review.js` 补 `topName / bottomName` 的 `data-player-id`（取 `review.playerIds.b / .w`）
3. 附带清理：`render()` 里 `topRating` 有一行被下一行立即覆盖的冗余赋值，已合并

**教训**：把「同一块 UI 的渲染」写在某一个分支里，就会在**其他分支跳过它**的地方埋雷。
抽成可复用函数 + 在所有终止分支显式调用，是这类 bug 的结构性解法。

### M4 存储双写统一（技术债）

- 会话两条路：`auth.*` 写 kv `sessions/<id>.json`（真正在用），
  `storage.getSessionById/putSession` 写独立 `sessions` 表（仅 `accounts.migrateGuestData` 用）。
- 目标：单一来源 = kv；`migrateGuestData` 改调 `auth.upsertSession`；sessions 表接口标记废弃。
- 收益：修「管理员列表偶尔拿不到昵称」的根因，也让 K 的 `net` 字段只写一处。

---

## 4. 本期已完成专题（2026-09-05 ~ 09-07）

## §K 用户详细信息（IP/隐私）与管理员数据管理 — ✅ 已实施，待实测

> 需求：加 IP 等详细信息（**仅管理员可见**）；**管理员可管理用户的任何数据**。

**已落地**
- **M3 基础服务**：`src/net.js`（IP/UA 解析 + `TRUST_PROXY` 反代信任）、`src/audit.js`
  （kv `events/` 事件与审计，24h 去重、双上限裁剪）、`src/privacy.js`（隐私出口白名单）
- **采集**：WS 握手把 `{ip,ua}` 传入 `handleConnection`；会话 `net` 字段仅首次/IP 变化时写盘
- **隐私边界**：IP/UA/手机号/审计事件只从 `adminUserData` 一个出口返回；
  `homeData/lobbyData/historyData(非管理员)/playerCardData/profileData` 统一过 `stripPrivate`
- **管理员能力**：用户详情（登录 IP/UA、登录记录、封禁状态）、改名、重置 ELO/密码、编辑资料、
  封禁/解封、删除账号、用户称号、操作审计 tab
- **封禁**：连接层拒绝（对局/观战/聊天全断）+ 踢下线；重置密码使旧令牌失效（tokenInvalidBefore）

**K7 等级系统（EXP/Level）**
- 规则：每日登录 +2（24h 去重的 loginEvent 兼作判定）、终局双方 +1；
  `L→L+1` 需 `2^(L+1)`（0→1:2、1→2:4…），累计到 L = `2^(L+1)-2`，
  等级 = `floor(log2(exp+2))-1`，clamp `[0, 64]`
- **溢出结论**：数值不崩（exp 远小于 2^53；`2^(L+1)` 在 L≥51 超精度但仍可表示、比较正确）；
  但**64 级是名义上限**（累计需 2^65-2 ≈ 3.7e19，永远满不了）——想"摸得着"就改曲线或降 MAX_LEVEL
- 展示：admin 列表 🔐账号/👤游客 + Lv + 经验；个人页 Lv 与升级进度；hovercard `Lv.x · ELO`；对局 state 带 level

**K8 关键教训**
- 用户报「改备注/封禁提示服务器错误」→ 真因是 **`server.js` 漏 `require('./src/auth')`**
  （`ReferenceError: auth is not defined`），四条写路由全炸
- 教训 1：函数级复现直接调模块函数，**绕过路由层**，查不出路由层未定义引用
- 教训 2：**吞错误文案是排障最大障碍**——`adminWrite` 的 catch 现在带真实异常信息；
  前端 adminPost 对非 JSON 响应提示 HTTP 状态码并提醒"若为 404 请确认进程已重启"
- 教训 3：用户回传一行日志 = 我猜十轮，报障先要日志

## §L 公开棋谱展示（棋谱广场）+ 管理员编辑 — ✅ 已实施，待实测

> 需求：公开棋谱展示页；管理员可设置公开谱；**对局信息与评论管理员可编辑**；
> 评论展示在手数中（旧格式位置）；**KIF 导出带评论**；**公开谱评论仅管理员可维护**。

**数据模型**：`visibility`（默认 private）+ `meta`（title/event/round/playedOn/tags/description/
nameOverrides/resultNote/featured）；**不动** moves/result/playerIds。

**权限矩阵**（`canView = isAdmin || isOwner || visibility==='public'`）

| 能力 | 访客 | 谱主 | 管理员 |
|---|---|---|---|
| 广场列表 / 公开谱回放复盘 | ✅ | ✅ | ✅ |
| 私有谱回放复盘 | ❌ | ✅ | ✅ |
| 编辑 meta | ❌ | ❌ | ✅ |
| 写评论（私有谱） | ❌ | ✅ | ✅ |
| 编辑/删除评论（公开谱） | ❌ | ❌ | ✅ |
| 编辑/删除评论（私有谱） | ❌ | 仅本人 | ✅ |

**评论模型升级**：`{moveNo: '文本'}` → `{moveNo: [{id, authorId, authorName, text, ts, editedBy, editedAt}]}`；
**读时兼容旧字符串**（懒迁移），写入才转新结构；`setComment` 支持 commentId 编辑/删除 + `force`（管理员）。

**接口**：`GET /api/gallery`（标签/关键词/分页/置顶优先）、`POST /api/admin/records/:id/{visibility,meta}`、
评论复用 `/api/records/:id/comment`（靠 commentId + force 区分，未单开 admin 路由——与原设计的一处偏差）。

**前端**：`gallery.html` + `gallery.js`（导航新增「棋谱广场」）；review 页评论渲染到**手数下方**
（作者 + 已编辑标记 + 管理员就地 ✏️/🗑）；管理员面板（对局信息 + 可见性下拉）；
公开谱非管理员只读（隐藏书签/评论/变着/自由摆放）。

**KIF 导出实测**：`*opening note` 紧跟第 1 手之后，旧字符串评论同样导出。

## §N 移动端 UI 适配 — ✅ 已实施，待实测

- 棋盘区改竖排（对手持驹在上、自己持驹在下，DOM 顺序天然正确），解决 375px 横向溢出
- 棋盘尺寸自适应：`--cell-size: auto` → `board.js cellSize()` 按视口算（**CSS 自定义属性不解析 vw/min()**，必须 JS 算）
- 导航紧凑（印章隐藏/用户名截断/按钮 32px）、侧栏回到棋盘下方、输入 16px 防 iOS 缩放、
  `touch-action: manipulation`、弹层与横幅缩放
- 顺手修：`.fb-drag-ghost` 从未有样式 → 拖拽幽灵不跟随指针（PC 上同样存在）
- 已知限制：横竖屏旋转需刷新重算；review.css 手机端细调列入二期

## §J 缺陷修复批次

| 编号 | 问题 | 根因 | 状态 |
|---|---|---|---|
| J1 | 驹台持驹选中后无法取消 | `_handleClick` 的 hand 分支不可达（驹台不在 boardEl 内），真正生效的 `pick()` 无条件赋值 | ✅ 已验证 |
| J3 | 感想战吃子后持驹棋种错误（吃角行多出飞车） | `DEMOTE` 表里 `'馬': '飛'` 写错（应为 `'角'`） | ✅ 已验证 |
| J5 | 隐藏管理员入口 | 导航对所有人都可见 | ✅ 已完成（条件渲染 + `ADMIN_ENTRY_KEY` 门禁） |

---

## 5. 历史批次归档

| 批次 | 内容 | 状态 |
|---|---|---|
| §0 | 棋谱列表改「一编号 = 一手」；打子日式渲染修复 | ✅ |
| §1 | 部署失败根因：better-sqlite3 触发 npm 自动 node-gyp → `.npmrc` `ignore-scripts=true` | ✅ |
| §2 | 幽灵房治理、断线体验、重连绑定、规则引擎、高亮残留 | ✅ |
| §3 | UI 第一批：lobby 卡片同尺寸、tournaments 两段式 | ✅ |
| §A | 首页改版：三步引导 / 最新战报 / 数据条 / 规则速查 | ✅ |
| §B | 赛事系统：B1 改版、B2 登录校验、B3 审核状态机、B4 审核界面、B5 回归 | ✅ |
| §E | 赛事管理台一期 | ✅ 二期：force-finalize、删除记录、移动端触屏悬停 |
| §F | 个人资料 + hovercard + `/api/player-card` | ✅ 二期：移动端触屏半屏卡 |
| §G | 感想战 v6/v7：FreeBoard **三模式**组件化、单页、拖拽、每手耗时、KIF/CSA 对齐 | ✅（M6 将扩为四模式） |
| §H | v8 批次：座位回位、自动退出、历史手行棋、待った、持驹打入回归 | ✅ 遗留：演示者浏览历史手时棋盘不可点 |
| §I | v1.2.0 批次：重进回座位、升变弹窗、成銀图集、驹台禁点、幽灵房、发布加固 | ✅ |

**§C 管理后台增强（原设计）**
- C2 用户管理 → 已并入 §K；C4 赛事管理 → 已由 §E 完成
- C1 总览仪表盘 / C3 棋谱管理（删除·筛选·批量导出）/ C5 公告管理 / C6 实时干预 → **未排期**

---

## 6. §D 长期 Backlog

- **安全**：~~`/api/history?player=` 越权枚举~~ ✅ 已修（§Q7-1，2026-09-10）；令牌存 localStorage 的 XSS 面；隐私数据保留期与导出脱敏（部分由 §K 覆盖）；**接口速率限制**（进行中）
- **性能**：`_pushState` 全量推送（增量 diff 是演进方向）
- **玩法**：AI 对战（USI 引擎）、駒落ち让子、多轮/循环赛制、i18n
- **运维**：PM2/systemd 脚本已在 `DEPLOY.md`，尚未完整线上验证；Nginx 需补 `X-Forwarded-For`（§K1 已补）
- **前端**：横竖屏旋转自动重建棋盘；review.css 手机端细调；对局页玩家栏显示等级
