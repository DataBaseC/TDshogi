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
| **P0** | **§P1** | **单元测试基建（node --test + `npm test`）** | **✅ 73 项全绿（2026-09-11；含入玉宣言 7 项）** | — |
| P1 | §P2 | eslint（`no-undef` 等） | ✅ 已实施（2026-09-10），首跑抓出 18 个 error | — |
| P1 | §P3 | CI（GitHub Actions：lint + check + test + e2e 冒烟） | ✅ 已实施（2026-09-10） | §P1 |
| P2 | §P4 | 统一 logger 与错误上报 | ✅ 已实施（2026-09-12），含 `X-Request-Id` | — |
| P2 | §P5 | WS 消息契约（类型常量 + 入参校验） | ✅ 已实施（2026-09-12） | — |
| P1 | §J2 | 王手红格高亮丢失（play 页） | ✅ 已修复（`setCheck`，2026-09-08） | — |
| **P1** | **§R1** | **观战视角切换（先手/后手）** | **✅ 已实施（2026-09-10），待实测** | — |
| P2 | §R4 | 观战列表显示观众数 / 热门对局 | ✅ 已实施（2026-09-10），待实测 | — |
| P2 | §R2 | kibitz 观战评论强化 | ✅ 已实施（2026-09-11），待实测 | — |
| P1 | §J4 | demo_state 下发权威 hands，兜住前端模型漂移 | ✅ 已实施（2026-09-12），待实测 | — |
| **P1** | **§M6** | **复盘浏览模式：FreeBoard 增 `review` 模式，统一所有看谱场景** | **✅ 已实施（2026-09-08），待用户实测** | 建议与 M5 一起做 |
| **P1** | **§S** | **前端体验优化（设置面板 / 手机端布局 / 触屏误触 / 棋盘坐标 / 图集切换）** | **✅ S1–S5 已实施（2026-09-10），待实机确认** | 用户痛点 |
| P2 | §M5 | 前端拆分（按页面内聚） | ✅ **已完成**（2026-09-12）：`play.js` 906→629 拆出 chat/demo；`review.js`/`admin.js` 评估后**不拆**（理由见正文），顺手消除 `resultText` 重复 | 待实机验证 |
| P3 | §M1 | `rooms.js` mixin 拆分 | ✅ 已实施（2026-09-12）：**2056 → 240 行**，拆出 9 个 mixin 模块 | 待实机验证 |
| P3 | §M2 | `server.js` 路由模块化 + 统一 admin 中间件 + eslint no-undef | ✅ 已实施（2026-09-12）：**592 → 117 行**，拆出 `src/http/`（context + middleware + 4 个 routes） | 待实机验证 |
| P3 | §M4 | 存储双写统一（会话单一来源 = kv） | ⬜ 待实施 | — |
| **P1** | **§U** | **对局体感与账号治理（提醒音 / 红框 / 弹窗入聊天 / 音效设置 / 游客清理 / 登录 IP / 评论权限）** | ✅ **已实施（2026-09-13）**：U1–U7 全部落地（见 §U 各节末尾状态行） | ⚠️ 缺真实音频 + 待实机 |
| **P1** | **§V** | **赛事系统 2.0（需求 8–12）** | ✅ **T1–T8 全部完成**（T1–T7：2026-09-13；T8 瑞士制：2026-09-15，算法 + 接线 + 前端） | `docs/TOURNAMENT.md` |
| P4 | §C1/C3/C5/C6 | 管理后台其余增强 | ✅ **C1 总览 / C5 公告 / C6 实时干预 均已实施（2026-09-15）**；C3 早已完成 | — |
| P2 | §W | 管理后台分页（20 条/页）+ 专属赛事管理页 | ✅ **已实施（2026-09-13）**：W1 四 tab 分页（`PAGE_SIZE=20`，统一走 `UI.paginate`）、W2 赛事管理页 | — |
| P4 | §C1/C3/C5/C6 | 管理后台其余增强（总览/棋谱管理/公告/实时干预） | ⬜ 未排期（**C3 棋谱管理已完成**——即 admin「全部棋谱」tab；余 C1/C5/C6） | M2 + K 审计 |
| **P2** | **§X** | **管理员 IP 封禁（HTTP + WS 双生效点 / 网段 / 临时封禁 / 白名单 / 防自锁）** | ✅ **已实施（2026-09-15）**：`src/ipban.js` + 双生效点 + admin「IP 封禁」tab；**17 项单测** | 无依赖 |
| P3 | §Y | 存储与 WAL 维护（checkpoint 截断） | ✅ **已实施（2026-09-15）**：`-wal` 4027KB → 0 | 随 §X 一并 |
| — | §Q1-Q7 | 商业化 / 产品候选池（见 §3） | ⏸ 待你排期（Q7 余 CSRF/XSS 面） | — |
| P4 | §D | 长期 Backlog | ⏸ | — |

**推荐执行顺序**：~~§P1 单测~~ ✅ → ~~§P2 eslint~~ ✅ → ~~§P3 CI~~ ✅ → ~~§S 前端体验~~ ✅ →
~~§P4 logger~~ ✅ → ~~§P5 WS 契约~~ ✅ → ~~§J4 权威 hands~~ ✅ → ~~§M5 / §M2 / §M1 结构拆分~~ ✅ →
~~§U 对局体感~~ ✅ → ~~§V 赛事 T1–T7~~ ✅ → ~~§W 分页~~ ✅ →
**实机验收（P0-1）→ 提交 → 再决定：§V-T8 赛制 / §C1·C5·C6 后台增强 / §M4 / §D backlog**。

> （2026-09-14 更新：上表此前把 §U / §V / §W 标为"设计完成待实施"，但三者**均已于 2026-09-13 落地**
> ——文档滞后会直接误导下一次排期，故据代码核对结果改正（逐条落点见 `docs/ROADMAP.md` §2 与
> `docs/TOURNAMENT.md` §11）。）
>
> （2026-09-13 调整：结构拆分三件套完成，本轮进入**功能期**。§U 的 7 条都是增量小改、
> 互不依赖，适合逐条快速落地；§V 赛事 2.0 是本期最大工程，按 `docs/TOURNAMENT.md` 的
> T1–T8 分阶段推进，其中 **T7 与 §W 同期**（都动管理后台）。）
>
> 📋 **施工顺序、批次划分、依赖关系与每批验收方式 → `docs/ROADMAP.md`**（2026-09-13 新增）。
> 本文只负责记录**需求与设计**，"怎么排期、按什么顺序做"一律看路线图，避免两处描述漂移。
理由：**没有测试兜底的大拆分风险太高**——M1/M6/M5 都是结构性改动，必须有回归网；
§P1 是纯增量（只加测试不改业务），半天可落地，且能立刻拦住 J3 那类"映射表写错一个字"的缺陷。

---

## 2. 已实施待实测

### J2 王手（check）红格高亮丢失 — ✅ 已修复（2026-09-08）

- **根因**：`play.js` 把 `{ check: [...] }` 当**第三个参数**传给 `setModel`，而
  `FreeBoard.setModel(modelLike, lastMove)` 只收两个参数 → 该参数被**静默丢弃**；
  `FreeBoard.render()` 也不再给 `board.render` 传 `check`（旧的 `reapplySelection()` 会传）。
- **修法**：`freeboard.js` 新增 `setCheck(sqList)` 并让 `render()` 透传给棋盘；
  `play.js` 改为显式调用 `fb.setCheck(state.check ? [findKingSq(state, state.turn)] : [])`
  （王手格 = 当前手番方的玉所在格）。
- 复盘页的上一步 / 王手高亮已随 §M6（FreeBoard 第四模式 `review`）统一解决。

### J4 demo_state 下发权威局面（board + hands）— ✅ 已实施（2026-09-12）

- **背景**：J3 之所以能长期潜伏，是因为**感想战推演的持驹完全由前端本地重放得出**——
  服务端 `_broadcastDemo` 只发 `moves/kif/legalTargets...`，**不含 `hands`**，
  前端模型一旦有偏差，显示就是错的且无从校验。
- **方案**：`_broadcastDemo` 与 `demoEnter` 载荷追加 `hands`（服务端 `_demoGame` 取 `game.hands()`，零额外计算）；
  前端 `applyDemoMode()` 以服务端 hands 覆盖本地重放结果（moves 仍走本地重放，以支持历史手跳转）。
- **收益**：前端模型漂移被服务端权威兜住，同类 bug 不再靠肉眼发现。

#### 实施记录（2026-09-12）

实际下发的是 **`board` + `hands`**（不只有 hands）：`game.state()` 本就同时给出两者，零额外计算；
而**盘面同样会漂移**（J3 的显性症状正是"吃错子"），只兜持驹等于漏一半。

**三处出口必须同口径**（都取同一份 `game.state()`；漏一处就会"时灵时不灵"，很难查）：

| 出口 | 覆盖场景 |
|---|---|
| `_gameState()` 的 `st.demo` | 重进 / 初载已结束房间（`state` 推送） |
| `_broadcastDemo()` 的 `demo_state` | 推演走子、undo、交接演示权等实时变更 |
| `demoEnter()` 的 `demo_init` | 显式进入感想战页 |

**前端只在「最新一手」覆盖**（`play.js` 的 `applyDemoMode`）：服务端只维护**推演终局**这一个局面，
历史手仍需本地重放（这是"任意手跳转"的必要代价），而最新一手恰是大家在看的、
也最容易暴露漂移的地方。载荷**深拷贝**后再交给组件，避免自由摆棋等交互原地改动服务端数据；
`demoInfo.board/hands` 缺失时静默跳过（兼容旧载荷），不会把棋盘渲染成空。

**回归护栏**：`tests/freeboard.test.js` 新增「§J4 漂移回归」——用一手真实序列
（`7g7f` → `3c3d` → `8h2b+` → `3a2b` → `B*5e`，覆盖普通走子 / 吃子升变 / 反吃成駒 / 打子）
分别跑**服务端 `game.js`** 与**前端 `FreeBoard` 重放**，**盘面逐格 + 持驹逐种**比对必须完全相同，
并对 J3 类问题形成第二道防线。

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

**进度（2026-09-12）：`play.js` 拆分完毕**（906 → **629 行**）。

| 模块 | 行数 | 内容 | 耦合处理 |
|---|---|---|---|
| `play-clock.js` | 153 | 棋钟（本时 / 读秒 / tick） | 注入 `getState` / `getViewpoint`；导出 `advance(dtMs)` 供单测 |
| `play-chat.js` | 151 | 聊天分区（§R2）+ 观众列表（§R） | **零耦合**：状态自带，`PlayChat.init()` 自注册 DOM 与 WS 事件（幂等） |
| `play-demo.js` | 288 | 感想战（推演谱 / 光标浏览 / 演示权 / 自由摆棋 / 历史手合法走法） | **双向依赖**用回调注入：core 提供 `getState`/`getFb`/`getSeat`/`getViewpoint`/`ensureBoard`/`renderPlayerBars`/`clearSelection`；模块对外提供 `enter`/`exit`/`isActive`/`applyMode`/`updateUI`/`sendMove`/`setPendingPromo`/`takePendingPromo` |

`play.js` 只保留 core：状态同步、走子交互、升变、玩家栏、音效、WS 事件路由。
**额外收益**：此前被 eslint 抓出的隐式全局 `window.freeMode` 随之进入模块内部，跨脚本污染隐患从根上消失。

⚠️ **行为一字未改**（纯搬运 + 依赖注入），但前端没有自动化测试，**必须实机验证**——
重点：感想战全流程（进入 / 演示 / 待った / 清空 / 自由摆棋 / 历史手跳转）、聊天三个分区、观众列表。
#### 余下两文件：评估后**不拆**（2026-09-12），但顺手消除一处真实重复

原计划把 `review.js` / `admin.js` 也拆开。实测两者分别 **559 / 531 行**，读完结构后的结论是**不拆**——
这是判断而非省略，理由如下：

1. **§M5 的目标对它们已天然满足**。拆 `play.js` 的动机是它把「对战 + 感想战 + 聊天 + 棋钟」
   四个互不相关的子系统混在 906 行里；而 `review.js` 只服务 `review.html`、`admin.js` 只服务 `admin.html`
   ——**每个文件已被一个页面独占**，不存在"多子系统混编"；
2. **前端没有模块系统**。拆开后只能靠 `window.Xxx` 共享状态；`review` 的渲染链路
   （`load` → `render` → `renderMoveList` / `renderAnnotations` / `renderVariations`）一旦切断，
   跨文件追一个渲染分支比在 559 行里读更费劲——**耦合不会消失，只会从"文件内"变成"文件间"**；
3. **`admin.js` 的拆分点是假的**：4 个 tab 看似独立，但全部写操作挤在 `adminPost`（178 行）里按 path 分派，
   真要拆得先重构它——那是**行为改动**而非搬运，在无前端自动化测试的前提下不值得冒险；
4. **无测试兜底**：`play.js` 拆完尚需实机验证，再拆两个无测试覆盖的页面只是叠加风险。

**若将来确实要拆**（例如某文件涨到 800+ 行），拆分点已勘明，可直接照做：

| 文件 | 拆分点 | 备注 |
|---|---|---|
| `review.js` | 记谱工具（`usiToJp` / `pieceNameAtBoard` / `formatMove`）→ `notation.js`；注记（书签/评论/变着）→ `review-annotations.js`；自由摆放 → `review-freeplace.js` | 记谱工具是**无状态纯函数**，最容易先抽，`board.js` 将来可复用 |
| `admin.js` | **先按 tab 把 `adminPost` 拆成 4 个函数，再按 tab 拆文件**（`admin-{records,users,tournaments,audit}.js`） | 顺序不能反：先拆函数再拆文件，否则跨文件分派更难读 |

**顺手消除的真实重复**：`resultText`（对局结果文案）原先在 `history.js` 与 `review.js` 各有一份，
且**返回形态不同**（列表要 `{text, cls}` 着色、复盘页只要纯文本）。现已合并到 `util.js` 的
`UI.resultText(r, opts)`，两处改为一行转发（**调用点零改动**），由 `tests/util.test.js` 同时锁定两种形态。
收益不只是少 10 行：将来加新结果说明（時間切れ / 入玉宣言 / 反则负…）时，
**不会出现"只改一边、另一页静默显示成未完成"**。

> 原始「建议与 M6 同期做（先统一组件再拆文件）」仍然成立——真到要拆时照上面的表来。

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

#### 实施记录（2026-09-12，分批进行中）

**装配方式（与计划的一处调整）**：**保留 `src/rooms.js` 作为装配入口**，不改名为 `rooms/index.js`。
原因：`require('./rooms')` 的解析顺序是「先 `rooms.js`，再 `rooms/index.js`」，保留原文件意味着
`protocol.js` 一行都不用改；mixin 文件放 `src/rooms/` 目录，两者不冲突。
每个 mixin 形如 `module.exports = function applyX(X) { Object.assign(X.prototype, {…}); }`，
**`this.*` 调用链完全不变**，对调用方透明。

**机器验证（每批必做）**：`scripts/_dump-prototype.js` 打印 `RoomManager.prototype` 的方法名，
与拆分前基线 `.tmp-proto-before.txt` 做 `Compare-Object`——**少一个就是漏搬，多一个就是凭空造**。
全部拆完后删除这两份临时文件。

| 批次 | 模块 | 行数 | 状态 |
|---|---|---|---|
| 1 | `rooms/config.js`（时间控制 / 超时常量 / 打子符号 / `initClockState`） | 76 | ✅ |
| 2 | `rooms/demo.js`（感想战 9 个方法） | 263 | ✅ |
| 3 | `rooms/snapshot.js`（快照 + 重启恢复 7 个方法） | 206 | ✅ |
| 4 | `rooms/clock.js`（棋钟 4 个方法） | 92 | ✅ |
| 5 | `rooms/state.js`（状态快照/推送 + 观战名单 + 系统播报 13 个方法） | 285 | ✅ |
| 6 | `rooms/binding.js`（观战 / 连接绑定 / 断线回位 8 个方法） | 273 | ✅ |
| 7 | `rooms/cleanup.js`（房间销毁 + 各类宽限计时 8 个方法） | 183 | ✅ |
| 8 | `rooms/gameplay.js`（走子 / 认输 / 结算落盘 / 离开 8 个方法） | 295 | ✅ |
| 9 | `rooms/lifecycle.js`（建房 / 加入 / 匹配 / 开局 / 赛事 14 个方法） | 493 | ✅ |

**最终结果**：`src/rooms.js` **2056 → 240 行（-88%）**，只剩骨架（构造 / 房间码 / 房间查找 /
广播 / 统计）；`RoomManager.prototype` 方法数 **76 → 76**；`npm test` 106 项全绿、
`npm run lint` **0 error**（warning 数 7，与拆分前完全一致）。

**验证手段（本次最有价值的部分）**：除了「方法名清单比对」（证明**没漏没多**），
还加了一道**逐方法源码比对**——从 `git HEAD`（拆分前）取出 `rooms.js`，
与拆分后的实现逐方法 `toString()` 比对（空白归一化）：

> 最终只剩 **4 处差异**，全部是 `require('./x')` → `require('../x')` 的**路径调整**
> （搬到子目录后必要且等价），其余 **72 个方法逐字一致**。

这道检查抓到了**两个真实问题**：
1. **漏装配**：`lifecycle.js` 写完后忘了加 `require('./rooms/lifecycle')(RoomManager)` ——
   于是 `createRoom` / `joinRoom` / `quickMatch` 等 5 个方法**在 prototype 上根本不存在**。
   单测覆盖不到这些路径，方法名清单当时也还未跑，**差点就这么提交了**；
2. **一处抄写偏差**：`quickMatch` 里把 `this.playerRegistry(cid)`「顺手」写成带 `?: null` 保护的版本——
   语义变了（原本会抛错的地方变成静默返回 null），而方法名清单**完全看不出来**。

⚠️ **教训**：大规模代码搬运**不能只验证「个数对不对」，还要验证「内容对不对」**。
临时校验脚本验完即删（需要时可重写）。

### M2 `server.js` 路由模块化 — ✅ 已实施（2026-09-12）

- `src/http/` 目录：`routes/{home,lobby,records,accounts,admin,tournaments}.js` + `middleware/{adminAuth,error,requestCtx}.js`
- 统一 admin 中间件（当前每个路由各写一遍 `admin.verify(token)`，是 §C 的既有前提）
- `resolvePlayer` / `sanitize` 等工具移入 `src/http/util.js`
- **配 eslint `no-undef`**：今天 `server.js` 漏 `require('./src/auth')` 导致四条管理路由 500，
  `node --check` 与现有 lint 都查不出，只能靠运行时暴露（见 §K8 教训）
- WS 部分保留在 `server.js`

#### 实施记录（2026-09-12）

**结果**：`server.js` **592 → 117 行**，只保留「组装」职责（中间件挂载 + 路由装配 + WS + listen）。

| 文件 | 行数 | 内容 |
|---|---|---|
| `src/http/context.js` | 62 | `protocol` 单例、`VERSION`、`resolvePlayer` / `sanitize` / `checkAdmin` |
| `src/http/middleware.js` | 134 | `requestId`(§P4) / `adminEntryGate`(§J5) / `adminOnly` / `adminWrite` / `tournamentAction` |
| `src/http/routes/public.js` | 63 | 首页 / 大厅 / 个人 / 玩家卡 / 赛事列表 / 棋谱广场 |
| `src/http/routes/records.js` | 176 | 棋谱导出 / 回放 / 复盘 / 检索 / 书签 / 评论 / 变着 |
| `src/http/routes/accounts.js` | 68 | 注册 / 登录 / 令牌校验 / 个人资料 |
| `src/http/routes/admin.js` | 187 | 用户管理 / 审计 / 棋谱导入与元数据 / 赛事审核 |

**与原文计划的差异（取舍）**：
- `middleware/` 由三个文件（`adminAuth`/`error`/`requestCtx`）**合并为一个 `middleware.js`**：
  三者合计仅 ~140 行，拆三个文件反而要在三处跳转；且 `adminOnly` 与 `adminWrite` 强相关（共用同一判定），
  分开写容易出现"两套鉴权并存"——那正是 §Q7-1 越权的成因。
- `routes` 由 6 个合并为 4 个：`home`/`lobby`/`tournaments` 都是 ≤10 行的只读接口，合成 `public.js`；
  赛事在 `server.js` 里本就只有 4 条路由、且其中 3 条共用 `tournamentAction` 包装。
- 原文说"`resolvePlayer` / `sanitize` 移入 `src/http/util.js`" → 实际放进 `context.js`：
  它们与 `protocol` 单例、`checkAdmin` 同属"HTTP 层共享上下文"，分两处反而割裂。
- **原文动机之一是"漏 require 导致 4 条路由 500"**：拆分后每条路由的依赖在各模块顶部显式列出，
  覆盖面随之扩大——本次拆完 ESLint 立刻抓到 `middleware.js` 里未使用的 `admin` 导入。

**验证**：
1. **路由清单比对**（同 §M1 思路）：从 `git HEAD`（拆分前）与拆分后代码分别提取 `app.<method>('<path>'`，
   **37 : 37 逐条对齐**。路由拆分最怕漏掉一条，而漏掉**不会报错**——只会在用户点进那个页面时变成 404；
2. **起服冒烟**：`PORT=0 node server.js`，5 秒内正常启动、日志输出正常；
3. `npm test` 106 项全绿、`npm run lint` 0 error。

## §P 工程质量与防回归基建（2026-09-07 新增）

> 背景：当前**无 CI、无 eslint、无一个纯单元测试**（scripts 里 17 个文件全是要起服的 e2e/工具），
> `package.json` 只有 `start/dev`。所有正确性依赖"起服 + 手工点"，
> 因此出现了「漏 require 导致 4 条路由 500」「成驹还原表写错一个字潜伏到用户吃子才发现」这类问题。

### P1 单元测试基建 — ✅ 已实施（2026-09-08 起，现 **73 项**全绿）

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

### P2 eslint — ✅ 已实施（2026-09-10）

- `eslint.config.js`（flat config）：`no-undef`、`no-unused-vars`，node + browser 双环境
- 先只开 error 级，逐步收紧；**优先拦 `no-undef`**（今天 `server.js` 漏 `require('./src/auth')` 的那一类）

### P3 CI — ✅ 已实施（2026-09-10）

- `.github/workflows/ci.yml`：Node 22 → `npm ci --omit=dev` → `npm test` → 全量 `node --check` → 起服跑 e2e
- 当前仓库无 remote，先写好配置，推远端时自动生效

### P4 统一 logger 与错误上报 — ✅ 已实施（2026-09-12）

**交付**：新增 `src/logger.js`（零依赖）；服务端 **21 处 `console.*` 全部迁移**（`server.js` 7 / `storage.js` 5 /
`rooms.js` 4 / `backup.js` 2 / `protocol.js`、`ratelimit.js`、`accounts.js` 各 1），
`server.js` + `src/` 下 `console.` 已清零。

| 能力 | 说明 |
|---|---|
| 级别 | `debug < info < warn < error`；`LOG_LEVEL` env 或 `log.setLevel()` 运行时调整（默认 `info`） |
| 格式 | 默认 **text**（`HH:mm:ss.SSS INFO  [scope] msg k=v`，观感贴近迁移前）；`LOG_FORMAT=json` 时每行一个 JSON（`ts`/`level`/`ctx`/`msg` + 自定义字段） |
| 分流 | `debug`/`info` → stdout，`warn`/`error` → stderr（`npm start > srv.log 2> srv.err` 天然分离告警） |
| 上下文 | `log.child({ roomId })` 派生；HTTP 层已挂 `req.log`（自动带 **requestId**） |
| Error | `{ err }` 传 Error 时结构化：JSON 带 `name`/`message`/`stack`（截断 6 行）；text 模式堆栈另起缩进行 |
| 可测性 | `setOutput(fn)` 注入输出，单测无需劫持 console（`tests/logger.test.js` **11 项**） |

**requestId**（本次新增的排障能力）：`server.js` 给每个 HTTP 请求分配 8 位短 id，写入响应头 `X-Request-Id`；
管理写接口 500 时响应体也带 `requestId`——**用户报障时只要报这个 id，就能在日志里定位到那次请求**，
不必再靠"大概几点几分"去猜。

**前端对等物：`window.debugLog`**（2026-09-12 补，挂在 `public/js/util.js`——该文件 9 个页面全部已加载，
**零 HTML 改动**）。前端此前只有 `console.error`，没有任何可开关的调试输出，排障只能临时插
`console.log` 再删。现在：

| 项 | 说明 |
|---|---|
| 开关 | `?debug=1`（甩个链接给用户最快）／`localStorage.tdshogi_debug='1'`（`debugLog.enable()` 会写）／`window.TDSHOGI_DEBUG=true`（自动化用）；**刻意不进设置面板**——那是"用户偏好"，这是"排障开关" |
| 零开销 | 关闭时函数第一行即 return，不构造字符串、不入缓冲 |
| 格式 | `HH:mm:ss.SSS DEBUG [scope] args…`——**与服务端 text 日志同格式**，两端可对照着看；参数**原样透传**给 console（不 stringify，保留展开对象的能力） |
| 留痕 | 环形缓冲最近 200 条，`debugLog.dump()` 整段取出——用户报障时可直接复制给开发者，不必截图 |
| 容错 | 隐私模式下 `localStorage` 抛错时退化为关闭，**不拖垮页面** |

服务端对应的便捷入口是 `require('./logger').debugLog(scope, msg, fields)`
（与 `log.debug` 同源同行为，单独命名只为在代码里一眼分辨"排障打点"与"常规日志"）。

**约定**：scope（模块名）是第一个参数，用于替代旧代码手写的 `[模块]` 前缀——迁移时**不要再把前缀写进消息**。

### P5 WS 消息契约 — ✅ 已实施（2026-09-12）

- `src/messages.js`：消息类型常量 + 入参校验函数；`_routeInner` 改用常量 switch
- 非法/未知消息直接回 `error` 而不依赖 try-catch 兜底，减少"消息字段写错静默失败"

**实施记录（2026-09-12）**

交付 `src/messages.js`：客户端消息类型常量表 `C2S`（**26 种**，与 `protocol.js` 的 switch 分支一一对应）
+ 声明式参数校验 `validate(type, data)`。`protocol._route()` 在进入业务分支**之前**先校验，
缺参数当场回明确错误，不再让 `undefined` 流进 rooms 层、最后被报成一句模糊的「走子失败」。

| 设计点 | 说明 |
|---|---|
| 校验粒度 | **只校验「必填且类型明确」的参数**——`move.usi`／`chat.text`／`rename.name`／`admin_login.password`／`join_room.code`／`join_tournament.id`／`join_tournament_match.roomId`／`demo_move.usi`；可选参数一律交给业务层（校验过严比不校验更糟） |
| 错误文案 | 形如 `move: 缺少参数 data.usi（USI 走法，如 7g7f）`——**带类型名与字段名**，前端与日志可直接定位 |
| 未知类型 | 由 `validate` 统一拦截（原先靠 switch 的 `default`），行为不变但收敛为单一出口 |
| 防漂移 | `tests/messages.test.js` 解析 `protocol.js` 的 `case 'x':` 列表，与 `C2S_TYPES` **双向**比对：漏登记（会误拒合法请求）与漏实现（会落 default）都被拦下 |

**与原始计划的差异（取舍）**：原计划写「`_routeInner` 改用常量 switch」，实际**保留字符串 `case`**。
常量 switch 的唯一收益是"避免拼写错误"，而**双向一致性测试已能抓到同类问题且更强**；
代价却是 26 个 `case` 逐个改写 = 26 次串行编辑（同文件不能并行编辑）+ 大 diff 换零收益。
留待 §M2 重构路由时顺手迁移更划算。

**⚠️ 本轮真实踩坑**：初版把 `demo_enter` 的 `roomId` 设成了必填——但前端与 `scripts/e2e-freeboard.js`
都用 `send('demo_enter', {})`（roomId 由服务端按连接身份定位）。若照此上线，**感想战直接进不去、e2e 当场失败**。
现已移除该规则并加回归断言。**教训：必填校验必须以「调用方实际怎么发」为准，逐个核对全部调用点
（含 `scripts/` 的 `send('x', …)` 风格），不能凭服务端函数签名臆断。**

## §Q 商业化 / 产品候选池（2026-09-07 新增，待你排期）

| 编号 | 方向 | 说明 | 现状缺口 |
|---|---|---|---|
| Q1 | 注册转化 | 游客可全功能使用 → 账号价值弱。用等级/经验/称号/收藏/战绩做账号专属权益，强化"游客数据一键迁移"入口（migrate 已有） | 缺引导与权益设计 |
| Q2 | 内容运营 | 棋谱广场 + 解说评论 = 内容资产，利于 SEO；做「每周名局」栏目与首页运营位 | 广场刚建成，无运营位 |
| Q3 | 赛事前台与自动化 | 赛事系统后端已完整（报名/审核/对阵/冠军）；道场与俱乐部最愿付费的是**赛程展示页 + 自动编排 + 报名提醒 + 结果公示** | 缺前台与通知 |
| Q4 | AI 陪练 / 棋力测试 | USI 引擎接入（Backlog 已有），商业价值最高，适合会员制 | 未做 |
| Q5 | 社交与俱乐部 | 关注/好友/私信/道场入驻，直接提升留存 | 未做 |
| Q6 | PWA | 加 `manifest` + service worker 缓存静态资源，手机可"安装到桌面"（无构建步骤，成本很低） | 未做 |
| Q7 | 安全合规（对外运营前必做） | ~~越权枚举~~ ✅ §Q7-1；~~接口速率限制~~ ✅ §Q7-3；~~数据备份~~ ✅ §Q7-4；**CSRF / XSS 面**待做 | 主体完成 |

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

### §Q7-4 数据备份 — ✅ 已实施 2026-09-10

**问题**：全部资产（账号 / 游客会话 / 棋谱 / 等级分 / 赛事 / 公告 / 审计日志）都在**单个
SQLite 文件** `data/tdshogi.db` 里，而此前**没有任何备份机制**——磁盘损坏或误删一次，全部丢失。

**方案**：新增 `src/backup.js`，服务启动即开启每日自动备份。

| 关注点 | 做法 |
|---|---|
| **一致性** | 用 `VACUUM INTO ?` 而非复制文件。数据库是 WAL 模式，数据分散在 `.db`/`-wal`/`-shm` 三件套里，**运行中直接拷贝会拿到不一致的中间状态**（WAL 新数据没并进主库）；`VACUUM INTO` 走一次读事务取**一致性快照**，WAL 下读不阻塞写 → **服务运行中也能安全备份** |
| **产物** | 紧凑单文件 `tdshogi-YYYYMMDD-HHMMSS.db`（顺带整理碎片，可直接当完整库打开）。文件名时间戳**字典序 == 时间序**，便于排序裁剪 |
| **可信** | 每份备份落盘后立刻 `PRAGMA integrity_check` + 检查 `records` 表存在；**校验失败当场删除**——宁可没有备份，也不要留个坏文件让人以为安全 |
| **滚动保留** | 先按份数（默认 **14** 份）裁，再按总量（默认 **2GB**）兜底裁；两个维度都**只删最旧的**，且永远保留最新 1 份 |
| **触发** | `startAutoBackup()`：启动时补一次（**当天已备则跳过 → 反复重启不会重复备份**）+ 每 6 小时检查一次（跨零点后被补上）；定时器 `unref()` 不阻止进程退出 |
| **不添乱** | 全程 try/catch：**备份失败只记日志，绝不影响对局服务** |
| **手动** | `scripts/backup.js` → `npm run backup`（`--list` / `--keep=N` / `--quiet`）——升级或改数据结构前手动打一份 |

**验证**：
- `tests/backup.test.js` 7 项（真实临时库备份 + 内容可读回 + 坏文件判定 + 排序与命名 +
  份数裁剪 + 总量裁剪与「至少留 1 份」+ **同日重复启动不新增**）→ `npm test` **46 项全绿**
- 真实库实测：源库文件 80KB → 备份 100KB（**多出的正是 WAL 里未 checkpoint 的数据**，
  恰好印证「直接复制文件会丢数据」）
- ⚠️ 测试须在 **require `storage` 之前**设 `process.env.DATA_DIR`（storage 在 require 时就算好库路径），
  靠 `node --test` 每文件独立进程实现隔离

**运维文档**：`DEPLOY.md` 新增「四、备份与恢复」，含**恢复步骤**——关键是
⚠️ 覆盖前**必须同时删除 `-wal` / `-shm`**，否则新库会读到"上一条数据库"的事务日志。

### §Q7-5 管理接口统一鉴权 — ✅ 已实施 2026-09-10

**问题**：管理接口的鉴权是**手抄**的。`server.js` 里同一段

```js
const token = req.query.token || req.headers['x-admin-token'] || null;
if (!admin.verify(token)) return res.status(403).json({ error: '无管理员权限' });
```

出现在 8 个路由里（`/api/history`、`/api/admin/users`、`/api/admin/users/:id`、
`/api/admin/audit`、`/api/admin/records/import`、`/api/admin/tournaments`、
`records/:id/visibility`、`records/:id/meta`）。写接口有 `adminWrite` 包装器，读接口全靠手抄。

**风险**：以后新增第 9 个管理接口，**只要忘了抄这两行就是越权漏洞**——而这类疏漏不报错、
不被测试发现，只会静默存在。这与 §Q7-1 的越权枚举**同源**：都靠"人记得写"来保证安全。

**修复**：

| 部件 | 作用 |
|---|---|
| `checkAdmin(req)` | **全项目唯一的身份判定入口**：解析 token（兼容 header / `?token` / `?adminToken` 三种来源）+ `admin.verify`，通过返回 token、失败返回 null |
| `adminOnly(req,res,next)` | Express 中间件版：`app.get(path, adminOnly, handler)`；通过后把 token 放进 `req.adminToken`，handler 无需再解析 |
| `adminWrite(handler)` | 改为返回 **`[adminOnly, h]`**（Express 会展开数组）→ 调用处写法不变，但鉴权与读接口走**同一个** `adminOnly`，不再有第二套判定 |
| `tournamentAction(action)` | 同上返回数组 |

**为什么用"返回 handler 数组"而不是逐个路由加中间件**：11 个路由一行都不用改，
避免为了统一结构而制造 11 处新的改动风险。

**Express 支持性已核实**（不能靠记忆）：`node_modules/express/lib/router/route.js:208`
用 `flatten(slice.call(arguments))` 展开数组；且随后有
`if (typeof handle !== 'function') throw ...`——即便写法有误也是**启动即报错**，
不会静默跳过鉴权（fail loud，不是 fail open）。

**"管理员 *或* 谱主"的 7 处**：`records/:id/export|playback|review|bookmark|comment|variation`
与 `/api/records/search`——这些**不能**用 `adminOnly`（会把谱主一起拒掉），但原先各自手抄
token 解析、且只支持 2 种来源。现已统一改为 `!!checkAdmin(req)`，与中间件共用**同一份判定逻辑**。

**收敛结果**：`grep admin.verify server.js` **只剩 `checkAdmin` 内 1 处**；
`grep x-admin-token` 同样只剩 1 处（+ 注释）。全项目**唯一**的管理身份判定入口。

**⚠️ 一处刻意的行为差异**：token 来源优先级由「`?token` 优先」改为「`x-admin-token` header 优先」
（header 是更明确的意图，前端 `admin.js` 也一直只用 header），同时新增 `?adminToken` 来源支持
（此前只有 `/api/history` 认它）。三条来源现统一在 `checkAdmin` 内，不会再出现"某个接口少认一种"。

**验证**：`node --check`、`npm run lint`（0 error）、`npm test`（58 项）全绿；
grep 复核：8 个纯管理接口全部走 `adminOnly`、7 处条件判断改为 `checkAdmin`、无残留手抄解析。
**⚠️ 属于服务端改动，需重启进程生效**——重启后请确认：管理后台各 tab 能正常打开（写操作正常），
非管理员直接请求 `/api/admin/*` 仍返回 403。

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

### §P1 单元测试扩充 — ✅ 73 项（2026-09-10 起；2026-09-11 补入玉宣言 7 项）

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
| R-d | 持将棋点数判定（入玉宣言法） | 未实现 | **✅ 已实施**（2026-09-11）**27 点法**：先手 28 / 后手 27，对齐 81Dojo | 见下方「入玉宣言」一节 |

> **R-d 口径订正（重要）**：点数**只统计**「宣言方在敌阵内的棋子（不含玉）+ 宣言方持驹」，
> 敌阵**以外**的盘上棋子**一律不计**；持驹**计分**但**不计入**「敌阵内 10 枚」。
> 早先草稿曾误按「盘上全体、不含持驹」实现——**这个口径下先手 28 点永远无法达成**
> （己方非玉棋子满员也只有 27 点），自相矛盾，故必须按上述标准口径。

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
| R2 | **kibitz 观战评论** | 观众 / 玩家发言**分区**（`#chatTabs`：全部·对局·观战）+ 配色区分 + 观战者 👁 标识 | ✅ 已实施（2026-09-11） |
| R3 | 观众进出提示 | 系统消息「XX 进入/离开观战」，`sys` 消息在各分区均可见；设置面板可开关（`spectatorNotices`） | ✅ 已实施（2026-09-11） |
| R4 | **观战列表增强** | lobby 每局显示观众数、热门对局排序 | ✅ 已实施（见下） |
| R5 | 观战信息增强 | 玩家栏显示**等级 Lv + 称号**（双方用时由顶部棋钟呈现）；**「本手耗时」未做** | 🟨 部分实施（2026-09-11） |
| R6 | 终局后观战 | 观战者自动进入感想战旁观 | 已有 ✓ |

**建议顺序**：R1 → R4 → R2 → R3 → R5。**观战者视角与观众数是"看棋"体验的核心，投入小、感知强。**

---

### §R2 / §R3 / §R5 实施记录（2026-09-11）

| 项 | 落点 | 实现要点 |
|---|---|---|
| R2 分区 | `play.html` `#chatTabs`、`play.js` | 聊天加「全部 / 对局 / 观战」三个 tab；`role` 由服务端下发（`player-b` / `player-w` / `spectator`），前端按角色着色 + 观众 👁 标识；**系统消息在任何分区都可见**，不会被分区过滤掉 |
| R3 进出提示 | `rooms.js`（`_sysChat` / `spectate` / `_unbindClient`）、`settings.js` | 观众进入 / 离开播报系统消息；名字**必须在清理前先取**（registry 已删除，靠 `spectatorNames` 缓存兜底）；设置面板 `spectatorNotices` 开关，关闭后前端直接丢弃以免刷屏 |
| R5 信息增强 | `rooms.js` `_gameState`、`play.js` `playerMeta` | 玩家栏副标题 = `Lv.N · ELO R · 称号`；等级来自 `ratings.profile()`、称号来自会话对象。**「本手耗时」未做** |

**关键坑（R5）：称号必须缓存，不能每步读盘。**
`title` 不在 `ratings.profile()` 里（那是**内存**缓存），而是挂在会话对象上，只能走 `auth.load()`；
而 `auth.load()` 是**同步读磁盘**。`_gameState()` 每次走子都会调用、每局 2 次，直接读等于把磁盘 I/O
塞进对局主循环（与 §Q7-2 修掉的是同一类问题）。故 `_playerTitle()` 加 **30s TTL 内存缓存**
（`Map`，超过 1000 条整体清空），兼顾「管理员改称号后仍能较快反映」。

**验证**：`node --check` 全过、`npm run lint` 0 error、`npm test` **73 项全绿**（66 → 73）。

### §P1 R-d 入玉宣言实施记录（2026-09-11）

**规则（AJSA 27 点法，对齐 81Dojo）**——`game.canDeclareNyugyoku(color)`，五条缺一不可：

1. 玉在**敌阵**（先手 y≤3 / 后手 y≥7）
2. **敌阵内**除玉外己方棋子 **≥10 枚**
3. 点数 **先手 ≥28 / 后手 ≥27**
4. 自己手番
5. 未被王手

**⚠️ 口径订正（务必牢记）**：点数 = 「**敌阵内**己方棋子 + **持驹**」。
- ❌ 敌阵**以外**的盘上棋子**不计**（早先草稿按「盘上全体」写，是错的）
- ❌ 持驹**不计入**「10 枚」（持驹不在敌阵内）
- 大駒（飛角，含龍馬）5 点 / 其余 1 点 / 玉 0 点

**为什么这个订正不能含糊**：己方非玉棋子满员 19 枚也只有 27 点（歩9+香2+桂2+銀2+金2+角5+飛5），
若只算盘上，先手的 **28 点门槛永远不可能达成**，规则自相矛盾。28/27 的设计前提是
「盘面总点数恒为 54」，超出 27 的部分只能来自**吃掉的对方棋子（持驹）**。

**设计取舍：失败不判负，改为「按钮只在可宣言时出现」。**
严格 AJSA 中「误宣言 = 反则负」，但网页上按钮若常驻，误点判负代价过大。折中方案：
- 服务端在 `_gameState` 下发 `canDeclare = { seat, ok, reason, points, count }`
- 前端**仅在 `ok === true` 时亮出按钮**（`play.js`）→ 条件不满足根本点不到 → 不存在误点判负
- 规则只在 `game.js` **实现一处**，前端不重复算点数（避免两处口径漂移）
- 服务端仍保留权威校验（防手工构造消息），失败只回 `error` 不判负

**验证**：新增 7 项单测（先手 28 点可宣言 / 27 点不可 / 后手 27 点可 / 玉不在敌阵 / 敌阵内不足 10 枚 /
被王手 / **敌阵外棋子不计分**的回归用例），`npm test` **73 项全绿**。

## §S 前端体验优化（2026-09-10 用户提出，S1–S5 已实施）

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

### §S4 调整：坐标只保留一对（2026-09-10，用户反馈）

初版四边都标（上/下筋号 + 左/右段名），用户反馈太啰嗦。改为**只标一对、随视角换边**：

| 视角 | 筋号（1–9） | 段名（一–九） |
|---|---|---|
| 先手 | **上边** | **右边** |
| 后手（棋盘 180° 翻转） | **下边** | **左边** |

实现只改 `board.js` 的 `renderCoords()`：四个容器仍保留在 DOM（CSS 已按四边定位），**只填需要显示的
那一对、清空另一对**——空容器无内容即无视觉呈现，省掉一套位置切换逻辑。
棋盘 padding 四边保持等宽，否则标注只在一侧会让棋盘视觉偏心。

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

## §T 私人房间（密码房 / 休闲模式）+ 在线人数修正（2026-09-10 用户提出）

### §T1 在线人数显示错误 — ✅ 已实施 2026-09-10

**现象**：用户反馈「在线人数还是不对」——此前修过一次（把 `rooms.stats().online` 换成 `clients.size`），
仍未解决。

**根因**：`lobbyData()` / `homeData()` 用的是 `this.clients.size`。而 `this.clients` 是
`Map<clientId, ws>`，clientId 为 `${session.id}_${时间戳}`——**每次连接都生成新的一条**
（代码注释明确写着「同一身份可多窗口并存，全部登记，不互相顶替」）。
所以它数的是**连接数**而不是**人数**：同一人开两个标签页 = 2、手机+电脑 = 2、
刷新时旧连接若未及时关闭还会短暂虚高。

**修法**：改用 `this.playerToClients.size`（`Map<playerId, Set<clientId>>`，size 即**唯一身份数**），
与观战人数按 playerId 去重的口径一致（§R）。

另：`rooms.stats()` 里那个 `online` 字段公式本身就是错的
（`rooms.size + (clientToRoom.size - rooms.size)` 恒等于 `clientToRoom.size`，只统计已绑定房间的连接），
一并移除——**在线口径只在 protocol 层定义一次**，避免别处再算错一遍。

### §T2 私人房间（密码房）— ✅ 已实施 2026-09-10

**需求**：创建房间时可选「私人房间」并可设密码；**私人房间不计 ELO，经验值照常加**。

**已有基础（结算逻辑无需改动）**
- `room.rated` 字段已存在；`_finalize()` 里 `if (room.rated && ...) ratings.applyGameResult(...)`
  → 私人房设 `rated: false` 即**自动**不结算 ELO
- 经验值 `ratings.addExp(..., 1, 'game')` 是**无条件**执行的 → 天然满足「经验照常加」

**改动清单**

| 位置 | 内容 |
|---|---|
| `src/rooms.js` | `createRoom(host, tc, { isPrivate, password })`；房间加 `isPrivate` / `passwordHash`；`joinRoom(player, code, password)` 校验；观战入口（列表 / 直接观战 / 随机观战）过滤私人房；快照持久化新字段 |
| `src/protocol.js` | `create_room` 透传 `isPrivate`/`password`；`join_room` 透传 `password`；缺密码或不符时回 `needPassword: true` |
| `public/lobby.html` | 「私人房间」复选框 + 密码输入（勾选后才显示）；加入房间的密码框（按需显示） |
| `public/js/lobby.js` | 发送新参数；收到 `needPassword` 时显示密码框并提示 |

**密码处理**：服务端**只存 hash、不存明文**；密码限 4–8 位。
⚠️ 注意 WS 本身不加密，明文密码会经过网络传输——在未启用 HTTPS 的部署下这是**既有架构限制**，
此处记录，不做超范围处理。

**观战策略（默认取最"私人"的一种，可改）**：私人房间
① 不出现在大厅观战列表；② 直接观战被拒绝；③ 排除在「随机观战」之外。
若希望「知道密码的朋友仍可观战」，告知后放开即可。

#### 实施记录（2026-09-10）

| 文件 | 改动 |
|---|---|
| **`src/room-password.js`（新增）** | `hash` / `verify` / `isValid` + `MIN=4`/`MAX=8`。**纯函数模块**——安全逻辑不该埋在 1787 行的 `rooms.js` 里靠人眼检查，抽出来才能单测 |
| `src/rooms.js` | `createRoom(host, tc, {isPrivate, password})`；房间加 `rated:!isPrivate` / `isPrivate` / `passwordHash`；`joinRoom(player, code, password)` 校验；`activeGames()` / `spectate()` / `randomSpectate()` 过滤私人房；快照保存与恢复带新字段 |
| `src/protocol.js` | `create_room` 透传新参数；`join_room` 回 `needPassword: true`（**结构化标志**，不是混在文案里） |
| `public/lobby.html` | 「🔒 私人房间」复选框 + 密码框（勾选才显示）；加入房间的密码框（按需显示） |
| `public/js/lobby.js` | 发送新参数；收到 `needPassword` 亮出密码框并聚焦；建房提示区分私人房 |
| `tests/room-password.test.js`（新增） | **8 项**：随机盐、不含明文、错误/缺失/类型拒绝、未设密码放行、**损坏哈希串只判否不抛错**、长度边界、中文密码 |

**几个刻意的设计**
- **不用 scrypt / bcrypt**：慢哈希是为防「拿到 hash 后离线爆破」，而房间密码的 hash 只存在于
  服务端内存（快照也是短命数据），攻击者拿不到；反过来 `scryptSync` 会阻塞事件循环 50–100ms，
  建房/加房会让**所有人的走子**卡一下。门禁类密码用快哈希，账号凭证才值得慢哈希。
- **校验位置在「处理当前所在房间」之前**：否则密码输错也会先把玩家从旧等待房踢出去，
  变成"试错一次就被赶出房间"。
- **`spectate()` 放行本房选手**：否则座位回位（含终局复盘）会被自己的私人房拒之门外。
- **密码可留空**：此时房间只是「休闲模式」（不计 ELO、不开放观战），不设门禁。
- ⚠️ WS 本身不加密，明文密码会经过网络——未启用 HTTPS 的部署下属**既有架构限制**，不做超范围处理。

**验证**：`node --check` 全过、`npm run lint` 0 error、`npm test` **66 项全绿**（58 → 66）。
**⚠️ 服务端改动需重启进程**；前端刷新即可。

#### §T2 补充：私人房「凭密码观战」（2026-09-10 用户确认）

用户决定：**知道密码的朋友可以观战**（原实现是一律拒绝观战）。

| 位置 | 改动 |
|---|---|
| `src/rooms.js` `spectate()` | 签名加 `password`；**也可传 6 位房间码**（大厅「观战」按钮只拿得到码）；密码正确即放行；缺失/错误回 `needPassword: true` |
| `src/protocol.js` | `spectate` 透传 `password`（`data.roomId \|\| data.code`）；`needPassword` 结构化回传 |
| `public/lobby.html` | 「加入房间」卡片加 **「👁 观战（用房间码）」** 按钮（复用房间码 + 密码框） |
| `public/js/lobby.js` | 观战按钮：校验房间码 → 密码存 `sessionStorage` → 发 `spectate {code, password}` |
| `public/js/play.js` | `spectate` 分支从 `sessionStorage` 取密码随连接提交（**取完即删**）；被拒且 `needPassword` 时提示后**回大厅**（本页无密码框，否则用户干等在空白对局页） |

**为什么密码走 sessionStorage 而不是 URL**：观战授权不跨连接——大厅那次 `spectate` 成功后跳转到
`play.html` 是**新连接**，必须重新带上密码；而放进 URL 会让密码留在**浏览器历史与服务端访问日志**里。
取完即删，避免残留被下一次观战误用。

**仍未开放的两项**（保留"私人"语义）：私人房**不进大厅观战列表**、**不参与随机观战**。
「凭房间码 + 密码观战」是私人房唯一的观战入口。

**赛事房间确认未受任何影响**：`isPrivate` 只在普通建房（`type:'room'`）时写入，
赛事房（`createTournamentMatch`）没有这个字段 → 三处过滤 `!r.isPrivate` 对它恒为 `true`：
**照常出现在观战列表、照常可随机观战、照常可直接观战**（比赛本就该公开给人看）。

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
- 横竖屏旋转已自动重建（`FreeBoard` 视口监听）；复盘页手机端已于 2026-09-16 细调完毕

### 复盘页手机端细调（2026-09-16，`review.css` + `review.html`）

按 375 / 390 宽视口实机渲染后逐项修，**每一处都是量出来的、不是猜的**：

| 问题 | 实测现象 | 处理 |
|---|---|---|
| 顶部按钮把标签折进词里 | 「翻转视/角」「导/出/KIF」 | 按钮组加 `.rv-meta-actions` 类，≤640px 改**等分两列** + `white-space: nowrap` |
| 棋谱操作按钮换行不齐 | 「自由摆放」孤零零占一行 | `.rv-nav-actions` 等分两列 |
| 棋谱列表固定 360px | 手机上棋盘被挤出首屏 | 改 `max-height: 42vh` |
| 触控目标偏小 | 走法条目 13px 字 + 5px 内边距 | 行高与内边距各放大一档 |
| 长名字把玩家栏撑高 | 45 字 → 栏高 **41px 变 104px** | 名字截断为一行 + 省略号 |
| ⚠️ **移动端整列被撑出视口** | 长名字时 `player-bar` 宽 **895px**（视口仅 401） | `grid-template-columns: 1fr` → **`minmax(0, 1fr)`** |

⚠️ 最后一条是**加省略号时才暴露出来的上游 bug**：`1fr` 的最小尺寸是 `auto`（≈ min-content），
列内只要有不可换行内容，整列就会被撑破 → 手机上莫名其妙的横向滚动。
桌面那列本来就写了 `minmax(0, 1fr)`，移动端这行漏了。
> 教训：**改 `nowrap` 之前先确认上游有没有 `min-width: 0` / `minmax(0, …)`**，
> 否则"修好换行"会顺手换来一个横向滚动。

## §J 缺陷修复批次

| 编号 | 问题 | 根因 | 状态 |
|---|---|---|---|
| J1 | 驹台持驹选中后无法取消 | `_handleClick` 的 hand 分支不可达（驹台不在 boardEl 内），真正生效的 `pick()` 无条件赋值 | ✅ 已验证 |
| J3 | 感想战吃子后持驹棋种错误（吃角行多出飞车） | `DEMOTE` 表里 `'馬': '飛'` 写错（应为 `'角'`） | ✅ 已验证 |
| J5 | 隐藏管理员入口 | 导航对所有人都可见 | ✅ 已完成（条件渲染 + `ADMIN_ENTRY_KEY` 门禁） |

---

## §U 对局体感与账号治理（2026-09-13 用户提出，设计完成待实施）

> 7 条需求（原文编号 1–7），横跨棋钟、棋盘渲染、聊天、设置面板、账号生命周期与 admin 展示。
> 共同点：**都是增量小改**，不触碰对局核心逻辑（走子/规则/胜负判定），适合实机测试期并行落地。
>
> **实施进度（2026-09-13）**：
> **U1–U4 已完成**（批次 1）、**U5 已完成**（批次 2，含干跑模式）、
> **U6 已改进**（原已实现"最近 IP"，本次改为**默认掩码 + 点击展开完整 IP**，并补"最后活跃时间"）、
> **U7 经核查为"零工作"**——服务端 `force: isAdmin`、前端管理员就地编辑/删除入口（`review.js:267/410`）
> 在 §L 就已做完，`tests/records.test.js` 也有断言，本次只做复核。
> **W1（后台分页 20 条/页）尚未实施**，见 §W。
>
> 本批新增测试：`play-clock.test.js`（§U1 三种音 + §U2 `isDanger`）、
> `freeboard.test.js`（§U2 `setDanger`）、`cleanup.test.js`（§U5 全套）。
> `npm test` **117 项全绿**。

### U1 时间提醒：本时每跨过整分钟响 1 声 — ✅ 已实施（2026-09-13，待实机验收）

**用户已拍板方案**（在两轮澄清中选定「B 每整分钟都响」；A「标准比赛式」与 C「线上平台式」已否决）。

| 时机 | 行为 |
|---|---|
| 本时（持ち時間）剩余每跨过一个整分钟（5:00、4:00、3:00…） | 播 **1 声**「整分钟提醒音」 |
| **读秒阶段**每跨过 10 秒（60、50、40、30、20、10…） | 播 **1 声**「读秒报时音」（2026-09-13 用户追加） |
| 读秒 ≤10 秒 | 每秒「嗒」（**已有**，`play-clock.js` 的 `tick()`） |

> **2026-09-13 追加**：用户要求"**最后一分钟也是十秒报一次，跟围棋一样**"。
> 落地为"读秒阶段每跨过 10 秒报一声"。
> ⚠️ 与围棋官方规则**略有差异**，如实记录以便日后核对：《中国围棋竞赛规则》是在**最后一分钟**内
> 依次报「30 秒、40 秒、50 秒」（更细的节点还有 55、58 秒），随后才逐秒报 1–10；
> 本项目简化为**整十秒一次**（60/50/40/30/20/10），实现更简洁且听感连续。
> 三种音（**整分钟提醒 / 读秒报时 / 十秒逐秒**）必须**两两音色可区分**——需求原文明确要求前两者与倒计时分开。

- **现状**：`public/js/play-clock.js` 的 `tick()` 已实现"读秒 ≤10 秒每秒嗒（跨秒边界触发，含 10 与 1）"。
- **方案**：在 `advance()` / `tick()` 中新增整分钟边界检测——
  记住 `lastMinuteMark`，当 `Math.ceil(bankMs / 60000)` 发生变化且 `bankMs > 0`、**且不在读秒阶段**时播一声。
  ⚠️ 初始化时把 `lastMinuteMark` 设为当前值，**否则进对局瞬间会误响**。
- **音效区分**（需求原文明确要求）：整分钟提醒音与十秒倒计时「嗒」音**必须是两个不同音色**。
- **涉及**：`play-clock.js`（检测）、`sound.js`（新音）、`settings.js`（开关）、`public/audio/`（资源）。
- **验证**：`advance(dtMs)` 可脱离定时器驱动 → 在 `tests/play-clock.test.js` 加"跨整分钟恰好触发 1 次"
  "读秒阶段不触发整分钟提醒""初始化不误响"三个用例。**这是本条最有价值的护栏**——
  音效类 bug 在实机上很难复现和定位。

### U2 读秒 ≤10 秒时棋盘外框变红 — ✅ 已实施（2026-09-13，待实机验收）

**用户已拍板**：触发条件 = **本方读秒 ≤10 秒**；**观战者一律不显示**（观战者 `mySeat` 为 null，天然排除）。

- **方案**：
  - `freeboard.js` 新增 `setDanger(on)` → 给棋盘外框加/移除 `.fb-danger` 类；
  - `style.css` 加 `.fb-danger`（红色外框 + 轻微脉动，**不要闪烁**——闪烁在长时间对局里很烦人）；
  - `play.js` 在棋钟更新回调里判断：`mySeat !== null && state.turn === mySeat && 读秒中 && 读秒剩余 <= 10000`。
- **注意**：必须用**读秒剩余**而非本时剩余——本时用尽才进读秒，两者是不同的量
  （`play-clock.js` 里 `displayFor(seat)` 已区分，直接复用它的口径，**不要再抄一遍判定**，
  这是 §S 棋钟视角那个 bug 的同类风险）。
- **涉及**：`freeboard.js`、`public/css/style.css`、`play.js`、`play-clock.js`（对外暴露剩余值）。
- **验证**：`tests/freeboard.test.js` 加 `setDanger` 状态用例；实机看红框出现/消失。

### U3 弹窗消息同时写入右侧聊天区 — ✅ 已实施（2026-09-13，待实机验收）

**背景**：现有弹窗是 `util.js` 的 `toast()`（**2.5 秒后消失**），玩家低头看棋盘就错过了。
需求 3 要求重要提示**同时**进聊天区留痕。

- **现状**：`play-chat.js` 的 `appendChat({ name, text, sys })` **已支持系统消息样式**（暗色斜体）。
- **方案**：
  - `play-chat.js` 暴露 `PlayChat.system(text)`（内部走 `appendChat({ name: '系统', sys: true })`）；
  - `play.js` 把 5 处 `toast(...)` 中的**信息类**改为 `notify(msg)`（toast + 聊天留痕），
    但**排除断线类**（`此身份已在其他窗口登录，本页已断开`）——断线后聊天区也没人看，反而制造误导。
- **涉及**：`play-chat.js`、`play.js`。
- **验证**：实机触发「对局开始」「对局结束」「对手请求再来一局」三种提示，确认聊天区均出现。

### U4 音效与 BGM 可选（音频资源后续实装） — ✅ 已实施（2026-09-13，待实机验收）

- **现状**：`settings.js` 是 `DEFAULTS + SCHEMA` 声明式结构（`bool` / `select` 两种类型），加项成本极低；
  已有 `sound` 布尔开关（行棋音效）。
- **方案**：新增 4 个设置项（全部进 `SCHEMA`，`set()` 有白名单保护，安全）：

| key | 类型 | 默认 | 说明 |
|---|---|---|---|
| `soundMinute` | select | `default` | 整分钟提醒音（U1） |
| `soundByoyomi` | select | `default` | 读秒倒计时音 |
| `soundMove` | select | `default` | 棋驹落子音 |
| `bgm` | select | **`off`** | 对局 BGM（需求原文要求**默认关闭**） |

- **`sound` 布尔保留为总开关**：关掉时全部静音（含 BGM）——避免"关了总开关却还在放 BGM"这种矛盾状态。
- **音频资源**：`public/audio/{minute,byoyomi,move,bgm}/` 下按选项名放文件；**本期先只做设置项与读取链路**，
  资源位留空（读取失败静默降级，绝不能因为缺音频而报错中断对局）。
- **涉及**：`settings.js`、`sound.js`、`public/audio/`（新建）。
- **验证**：`tests/` 加 SCHEMA 合法性用例（键在 DEFAULTS 内、select 的 options 非空）；
  实机确认设置可保存、刷新后保留。

### U5 游客账号 30 天未登录自动清理 — ✅ 已实施（2026-09-13，待实机验收）

**用户已拍板规则**：全删（含棋谱）；**但若对局双方都是游客就删棋谱，有一方是注册用户则保留棋谱**。

- **现状（有利条件）**：
  - 游客会话落盘在 `sessions/<24hex>.json`，**已有 `lastSeen`**（`auth.js` 每次 `identify()` 刷新）；
  - `accounts.register(username, password, guestId)` 会把来源游客 id 存进 `account.guestId`，
    注释明确写着"**迁移后仍保留用于追溯**" → 这正是判断"该游客后来注册了没有"的现成依据。
- **规则实现**：
  1. 扫 `sessions/*.json`，取 `lastSeen < now - 30d` 的候选；
  2. **排除已注册**：若存在 `account.guestId === session.id` → 保留（人还在，只是没登录）；
  3. 删除会话文件；
  4. 棋谱处理：遍历该游客参与的对局，`playerIds.b` / `playerIds.w` **双方都属于待清理集合** → 删棋谱；
     **有一方是注册用户或未过期游客** → 保留。
- **新增 `src/cleanup.js`**，调度复用 `src/backup.js` 的 `startAutoBackup` 模式（启动补一次 + 每 6 小时检查），
  失败只记日志、绝不影响对局服务。保留期用 `GUEST_RETENTION_DAYS`（默认 30）可配。
- ⚠️ **不可逆操作，必须留退路**：
  - 首版支持 `CLEANUP_DRY_RUN=1`（只记日志不删）——**先在真实数据上跑一次看清单**再开真删；
  - 每轮清理把"删了哪些 id / 哪些棋谱"写进 `logs`（走 §P4 logger，`scope='cleanup'`）。
- **涉及**：`src/cleanup.js`（新）、`server.js`（启动挂载）、`storage.js`（按玩家删棋谱的入口）。
- **验证**：`tests/cleanup.test.js`（新，用 `.tmpdata-test` 隔离）——
  构造"纯游客 / 已注册 / 30 天内活跃 / 双方皆游客的棋谱 / 一方注册的棋谱"五类数据，
  断言清理结果与 `lastSeen` 边界（30 天前后各一例）。

### U6 管理后台显示登录 IP — ✅ 已实施（2026-09-13，待实机验收）

**用户已选**：只显示 IP，不做属地（省掉 GeoIP 依赖与第三方查询）。

- **现状**：`net.js` 有 `clientIp(req)` 与 `maskIp(ip)`；`auth.js` 在**首次 / IP 变化时**把网络信息写入 session（§K2）。
- **方案**：admin「全部用户」tab 新增 **IP** 列，数据来自 `auth.listSessions()`；
  **默认显示掩码 IP**（如 `203.0.113.*`），管理员点一下可展开完整 IP——原始 IP 属隐私数据，
  默认掩码能防"后台截图外流"这类低级泄露。悬停显示该项的**最后更新时刻**，避免误以为是实时值。
- **涉及**：`src/http/routes/admin.js` 或 `protocol.js`（数据出口）、`public/js/admin.js` + `admin.html`（渲染）。
- **验证**：实机（同一账号换 IP 后应更新）。

### U7 管理员可编辑任意棋谱的评论 — ⚠️ **经核查基本已满足**，仅需复核

- **现状核查**：`src/http/routes/records.js` 的 `/api/records/:id/comment` 已经做到：
  - `const isAdmin = !!checkAdmin(req)`；
  - 公开棋谱：**仅管理员**可维护评论（`if (records.isPublic(rec) && !isAdmin) → 403`）；
  - 非公开棋谱：`if (!isAdmin && !records.isOwner(rec, guest)) → 403` → **管理员放行**；
  - 写入时传 `force: isAdmin`，`records.setComment` 支持编辑（带 `commentId`）与删除（`commentId` + 空 text）；
  - 且管理员操作会写**审计日志**（`record-comment-add` / `record-comment-edit`）。
- **结论**：需求 7 的服务端能力**已经具备**。本条实际工作只有两件：
  1. **复核前端入口**：`review.html` 的管理员登录态下，任意评论是否存在「编辑 / 删除」按钮（含**他人棋谱**）；
  2. 补一条回归测试（管理员改他人评论 → 200 + 审计有记录；非管理员 → 403）。
- **涉及**：`public/js/review.js`（入口复核）、`tests/records.test.js`（补断言）。

---

## §V 赛事系统 2.0（2026-09-13 用户提出，需求 8–12）

> **完整设计见 `docs/TOURNAMENT.md`**（数据模型 / 权限矩阵 / 状态机 / API 清单 / T1–T8 实施阶段 / 风险）。
> 这里只记要点，避免两处描述漂移。
>
> **实施进度（2026-09-13）：按用户要求「前端先行」**——`tournaments.html` / `tournaments.js` 已改造：
> ① 顶部两个按钮：**`📋 我的赛事`（新增，紧挨创建按钮）** + `🏆 我要创建赛事`；
> ② 「我的赛事」视图把**我主办的**与**我参加的**分开列——两类人的诉求不同
>    （主办人盯报名进度与待办，参赛者只关心什么时候轮到自己），混排两边都不好用；
> ③ **往期赛事只列一行摘要**（名称 · 状态 · 人数 · 冠军），**不再展开对阵图与参赛名单**——
>    赛事一多，每张卡都铺开对阵表会把页面拉得极长（用户明确要求）；
> ④ 状态文案收敛为 `statusText()` 一处（原先散在渲染里，加状态时容易漏改）。
>
> **纯前端实现**：`我的赛事` 由前端按 `ownerId` / `players` 自行过滤，**未改后端**——
> 现有 `/api/tournaments` 返回的字段已经够用。
> 因此后端 **T1（数据模型 + `canManage` 单点权限）仍未开始**，它是 T2 之后一切的前提。
>
> ✅ **2026-09-14 更正**：T1–T7 均已于 2026-09-13 落地（实施记录见本文件下方
> 「T1~T3 已实施」/「T4 / T5 已实施」/「T6 / T7 已实施」三节，以及 `docs/TOURNAMENT.md` §11）。
> 仅余 T8（瑞士制/循环赛，需求原文即标注"待实装"）。

### T1~T3 已实施（2026-09-13）

- **T1 数据模型与状态机** ✅：见 `docs/TOURNAMENT.md` §11「T1 实施记录」；
- **T2 建赛申请与审核** ✅：
  - 前端**完整申请表**（名称 / 人数 4–32 / 赛制 / **举办理由** / 报名起止 / 比赛起止 / **报名是否需审核**）；
  - 前端做基础校验（理由 ≥10 字、时间顺序），**服务端再验一遍**（`createTournament` + `validateSchedule`）；
  - admin 赛事 tab 现在会显示**申请详情**（📅 时间 · 📝 理由 · 报名是否需审核 · 待批准人数）。
- **T3 报名两段式 + 未满员轮空** ✅：
  - `joinTournament` 按 `requireApproval` 分流：免审核直接 `approved`，需审核进 `pending`；
  - **名额按 `approved` 计**——否则"待审核的人"会把名额占满，真正被批准的反而报不进来；
  - 新增 `decideEntrant`（批准/拒绝）、`kickPlayer`（仅报名阶段）、`startTournament`（手动开赛，
    把 `approved` **冻结**进 `players`——不冻结的话，开赛后批准新报名会让名单与对阵表对不上）；
  - **未满员开赛**：多余的叶位自动**轮空**判晋级；
  - ⚠️ **轮空判定必须"两边都已定"**：只看"一方为空就判轮空"，会让 3 人赛的决赛
    把轮空者**直接判成冠军**（另一半 A vs B 还没打）。已用 `childState()` 递归判定子树是否已定，
    并由 `tests/tournaments.test.js` 专门盯住"轮空不得提前产生冠军"。
  - **新增 REST 路由** `src/http/routes/tournaments.js`：批准报名 / 踢人 / 手动开赛。
    ⚠️ 身份走 **token 头**（`x-account-token` / `x-admin-token`），**不用 `?player=<id>`**——
    后者是公开查询用的宽松通道，任何人都能填别人的 id，拿它做管理鉴权等于没有鉴权。
- **另有 3 处列表分页**（用户要求"避免爆炸"）：`UI.paginate` 提到 `util.js` 供三处共用 ——
  棋谱页 20 条/页、赛事页（进行中/往期/我的）各 20 条/页、个人页最近对局**只显示 10 条**。
- **主办人不再自动参赛**（用户要求）：`createTournament` 不再往 `entrants`/`players` 塞创建者。
- **导航调整**：棋谱广场从顶部导航移到棋谱页标题右侧（省导航空间）。

### T4 / T5 已实施（2026-09-13）

**T5 赛事详情页** `public/tournament.html` + `public/js/tournament.js`：

- **所有用户（含未登录游客）都能打开**：基本信息 / 申请信息（理由与四个时间）/ 报名与参赛名单 /
  对阵表 / **变更记录**（最近 50 条，服务端已截断——办得久的赛事日志会越积越多）；
- **主办人管理面板**（就在详情页，用户确认"主办人也在这里管理"）：开始比赛 · 取消赛事 ·
  名单里逐人「批准 / 拒绝 / 踢出 / 取消成绩」；
- **管理员面板**：以上全部 + **设置冠军**（⚠️ 仅管理员，见 `ACTION_ROLES.set_champion`）。

**T4 管理操作**：新增 `voidPlayer`（取消选手成绩）与 `setChampion`（设置冠军），
REST 侧补齐 `POST /api/tournaments/:id/{void,cancel,champion}`。

**权限显示的设计**：详情接口 `GET /api/tournaments/:id` 会附带服务端算好的 `caps`
（当前请求者能做哪些操作），前端据此决定按钮显隐。
⚠️ `caps` **只是描述、不是票据**——每个写接口都会用 `canManage()` 重新判一遍；
客户端伪造 `caps` 越不了权。这样既避免出现"点了必然 403"的按钮，又不引入第二处权限判定。

**⚠️ T4 踩到的两个坑（都已修 + 测试盯住）**：
1. `clearUpstream` 原本从传入节点**自己**开始清，把刚设好的改判结果一起抹掉
   → 改为**从父节点**起清；
2. 取消成绩时对手**不能从 `node.players` 取**：对局一结束 `onMatchFinished` 就清空了 `players`，
   于是 `players.find(p => p !== me)` 得到 `undefined` → 被当成"这里本就空着"→
   把整场**作废**（还顺手重新建了一场房）。改为从**子树胜者**（`childState`）推对手，
   并同时把该节点 `matchId` 置空（房间作废）。

### T6 / T7 已实施（2026-09-13）

**T6a 赛事棋谱**（需求 12）：
- 棋谱落盘时带上 `tournamentId`，并**强制 `visibility = 'public'`**。
  判定写在**落盘路径**（`src/rooms/gameplay.js`）而不是靠调用方传参——
  这样将来新增的建房入口也不会漏掉这条规则（D4 的落地方式）；
- 数据库新增 `tournamentId` 摘要列 + 索引（沿用既有的 `ensureRecordColumns()` 补列机制，老库自动迁移）；
- `GET /api/tournaments/:id/records`（**公开**）+ 详情页展示，每页 20 条。

**T6b 重赛**（需求 12）：
- `onMatchFinished` 现在会保留 `lastMatchId` / `lastPlayers`，否则**赛后申诉无从核对资格**；
- `requestRematch`：⚠️ **不能只判 `canManage(..., 'request_rematch')`**——那只回答
  "你是不是本赛事的参赛者"，回答不了"**这一场**是不是你打的"。还要拿 `lastPlayers` 核对一遍，
  否则任何一个参赛者都能对别人的对局提申诉；
- `decideRematch`：批准 = 作废该场结果 + `clearUpstream` + 重建该局；若冠军出自这条路径，一并退掉
  （赛事退回 `playing`）。主办人 / 管理员可裁决。

**T6c 赛后存档与管理员编辑**（需求 11）：
- 冠军产生时记 `endedAt`；`autoArchiveDue()` 扫描 `finished` 且超过 `ARCHIVE_AFTER_HOURS`（24h）的赛事
  → 自动 `archived`。**由 server 定时调用**（启动先跑一次 + 每小时一次，`unref()` 不拖住退出）；
- `archiveTournament`（仅管理员）、`editArchived`（仅管理员 + **仅 `archived`**，字段收窄到冠军/备注），
  每次编辑写 `adminEditLog` 并在详情页对管理员显示"编辑历史"；
- ⚠️ **`edit_archived` 的状态限制写在 `canManage` 里**（权限判定的唯一处）：
  未存档时连管理员也不放行——存档前有正常管理操作可用，走"编辑"会把还没定论的东西
  记成"赛后更正"，并绕过状态机与操作日志的语义。
- ⚠️ `adminEditLog` 是**敏感信息**（谁在赛后改了结论）：`publicInfo` 会带上，但
  HTTP 出口**按"是否管理员"决定下发**——不能因为它挂在 `publicInfo` 里就给所有访客。

**T7 管理后台赛事页**（需求 13）：赛事 tab 的三个列表（待审核/进行中/历史）各自**分页 20 条/页**，
每条显示申请表详情（📅时间 · 📝理由 · 报名是否需审核 · 待批准人数），
并提供「存档」（finished）与「详情 ↗」（所有状态）入口。

- **规模判断**：这是**重构级**扩展，不是加字段——权限体系（主办人 vs 管理员 vs 选手）、
  报名两段式、赛后存档都是新机制。现有 `src/tournaments.js` 仅 283 行（建赛/审核/单败对阵/晋级）。
- **五个关键决策**（详见设计文档 §0）：
  D1 新增 `registration` / `archived` 状态；D2 权限判定**收敛到 `canManage()` 单点**；
  D3 报名分 `entrants`（池）与 `players`（开赛冻结）；D4 赛事棋谱**强制公开**；
  D5 赛后"可编辑 + 全程留痕"而非锁定。
- **用户已确认**（本文写作前的两轮澄清）：人数档位 4/8/16/32（2 的幂）；
  报名审核**可配置、默认需审核**；赛事棋谱**强制公开**。
- **用户已拍板**（2026-09-13，回应设计文档 §13 的 A4–A8）：
  ✅ 决赛后 **24 小时**自动存档；✅ 未满员**允许开赛、首轮轮空**；
  ✅ 重赛批准后原棋谱**保留并标记"已作废"**；✅ **主办人结束后不能取消赛事**（仅未结束时）；
  ✅ **手动设冠军仅管理员**（需求 10 原文含主办人，**已被用户修正**）。
- ⚠️ **有两处以用户口径为准、与需求原文不一致**（已同步到设计文档 §1 权限矩阵与 §7）：
  ① 设冠军（含撤销/更改）＝ **仅管理员**；② 取消赛事 ＝ 主办人**仅限未结束时**。
  实现时**以 `docs/TOURNAMENT.md` 的权限矩阵为唯一依据**，不要照需求原文写。

## §W 管理后台优化（2026-09-13 用户提出，需求 13）

### W1 分页（20 条/页）— ✅ 已实施（2026-09-13）

**实现方式与原文计划的差异**：原文设想"服务端 `?page=&limit=` + 前端分页控件"，
实际采用**纯前端分页**（服务端仍全量下发）：

- **理由**：全量下发 + 前端切片的改动面小得多（只动 `admin.js` 的一个函数），
  而需求要解决的问题是"**页面一次渲染太多**"——前端切片已经解决。
  真到十万级数据时再改服务端分页，那时也**只需动 `renderPaged` 一处**；
- **实现**：`admin.js` 的 `renderPaged(key, items, pagerElId, render, reset)`——
  做成"**包裹**"而不是改各 render 函数内部：render 只管画一页，分页状态集中在包裹函数里，职责不混；
- **接入的 tab**：棋谱 / 用户 / 审计 / **赛事**（四个）；
- ⚠️ **赛事 tab 的分页方式与其他三个不同**（2026-09-13 补充）：
  它内部按「待审核 / 进行中 / 历史」**分三块**渲染，所以是**每块各自分页**（`tnPending`/`tnActive`/`tnHistory`
  三个独立页码），而不是像其他 tab 那样整体切片——整体切片会打乱分组（某页可能只剩"历史"没有"待审核"）；
- ⚠️ **2026-09-14 归并**：赛事 tab 最初是我另写的一套（`fillTnList` + 直接用 `UI.paginate` + 自建 `tnPages`），
  与既有的 `renderPaged` + `pages` 并存 —— **同一个功能两套实现、两套页码状态**，已合并：
  `renderPaged` 改为 **`UI.paginate` 的薄封装**（删掉它自建的分页条 HTML），
  `tnPages` 并入共用的 `pages`；
- 搜索时传 `reset: true` 回到第 1 页；数据变少时页码自动回退（避免停在空页）。

### W2 专属赛事管理页 — ✅ 已实施（2026-09-13）

admin 的「赛事管理」tab 升级为完整管理界面（含 §V 的管理员操作、报名审核、重赛裁决、存档编辑），
与 §V-T7 同期实施。

**涉及**：`public/js/admin.js`、`public/admin.html`、`protocol.js`、`src/http/routes/admin.js`。

---

## §X 管理员 IP 封禁（2026-09-14 用户提出）— ✅ 已实施（2026-09-15）

### X1 需求

管理员可封禁指定 IP（或网段）：拒绝其**所有**后续访问（HTTP + WebSocket），
可设到期时间（临时 / 永久），必填理由，可查看列表、解封、延长。

### X2 为什么不能"只做一个拒绝列表"——难点全在边界情况

| 风险 | 说明 | 对策 |
|---|---|---|
| **误伤整片用户** | 家庭宽带 / 学校 / 公司常共用出口 IP（NAT），封一个 IP 可能封掉几百人 | ① 默认给**限时**（如 24h）而非永久；② 封禁确认框**明示影响面**（"该 IP 近期有 N 个不同账号访问过"）；③ UI 上引导"优先封账号" |
| **封到自己** | 管理员把自己当前 IP 封了 → 后台再也进不去 | **服务端硬性拒绝**封禁"请求者自己的 `clientIp`"（前端置灰只是体验，判定必须在服务端） |
| **IPv6 绕过** | 同一 /64 可换出无数地址 | 比对前统一走 `net.normalizeIp()`（**已存在**）；并支持按**网段**封（至少 /64、/48） |
| **反代失真** | 不处理 `X-Forwarded-For` 时拿到的是 Nginx 的 IP | 复用 `net.clientIp(req)`（§K1 已支持可信代理跳数）；**不要**自己解析 header |
| **监控 / 健康检查被误封** | 探活 IP 被封 → 监控全红 | 内置**白名单**：回环 + 内网段 + `IP_BAN_WHITELIST` 可配 |
| **重启后失效** | 放内存里，进程一重启封禁全丢 | 落 `storage` 的 kv（与 ratings / tournaments 同机制） |

### X3 数据模型

```js
// 存储键：ipBans
{
  "203.0.113.0/24": {
    ip: "203.0.113.0/24",        // 规范化后的 IP 或网段（key 与 ip 一致）
    reason: "刷接口",             // 必填，上限 200 字
    bannedById: "admin",          // 与 audit 同一口径
    bannedAt: 1757800000000,
    expiresAt: 1757886400000,     // null = 永久
    hits: 12,                     // 命中次数 —— 用来判断"封对了没"
    lastHitAt: 1757803600000,
  }
}
```

### X4 生效点（**两处，缺一不可**）

1. **HTTP**：新中间件 `ipBanGate`，挂在 **`requestId` 之后、其余所有路由之前**。
   顺序很关键：挂太靠后，被封的 IP 仍会走到鉴权 / 限流逻辑里；
2. **WebSocket**：握手阶段拒绝（`net.js` 的 upgrade 处理里）。
   ⚠️ **只挡 HTTP 等于假封禁**——WS 才是对局主通道，漏了它，被封的人照样能下棋。

命中时 HTTP 返回 **403 + 明确文案**（不静默：静默会让被封者反复重试刷日志）；
WS 直接拒绝升级。

### X5 管理入口

admin 新增 tab「IP 封禁」（复用 §W1 的分页组件）：

- 列表：IP（**默认掩码**、点击展开，与 §U6 同一口径——IP 属隐私数据）、理由、到期时间、
  命中次数、操作人；20 条/页；
- 新增：IP / 网段 + 理由（必填）+ 时长（1h / 24h / 7d / 永久）；
- 解封、延长；
- 每次操作写 `audit.adminAction`（`ip-ban` / `ip-unban` / `ip-ban-extend`）。

### X6 验收要点（单测）

- 封禁后 **HTTP 403** 且 **WS 握手被拒**——**两处都要测，只测一处等于没测**；
- 到期后**自动放行**（比对时判 `expiresAt`，不依赖定时清理）；
- 白名单内 IP 不受影响；
- **不能封自己**（服务端拒绝）；
- 网段匹配（`/24` 覆盖段内地址，`/64` 同理）；
- `normalizeIp` 的等价形式（IPv6 压缩 / 展开）命中同一条记录；
- 进程重启后仍生效（落盘）。

### X7 与既有机制的关系

- **限流（`src/ratelimit.js`）**：自动、短时、按接口；**IP 封禁**：人工、长时、全局。两者互补。
- 可在限流触发时给出"**建议封禁**"提示，但**不做自动封禁**——
  自动封禁 + NAT 共享 IP = 大面积误伤，收益不值这个风险。

### X8 规模评估

小～中：1 个新模块（`src/ipban.js`）+ 1 个中间件 + WS 握手 3 行 + admin 一个 tab。
**无依赖**，可与 §C1 / §C5 同批做（都动 admin，一起做省得反复切文件）。

### X9 实施记录（2026-09-15）

| 文件 | 内容 |
|---|---|
| `src/ipban.js`（新，约 380 行） | CIDR 位运算匹配、白名单、临时/永久封禁、命中计数、落盘 |
| `src/http/middleware.js` | 新增 `ipBanGate`（HTTP 生效点） |
| `server.js` | 挂载 `ipBanGate`（`requestId` 之后、限流之前）+ WS `verifyClient`（第二个生效点） |
| `src/http/routes/admin.js` | 4 条路由：列表 / 封禁 / 解封 / 延长（全走 `adminWrite` 落审计） |
| `public/admin.html` + `js/admin.js` | 新增「🚫 IP 封禁」tab（复用 `renderPaged`，20 条/页） |
| `tests/ipban.test.js`（新，17 项） | 见下 |

**实施中发现并修掉的两个真问题**：

1. ⚠️ **`net.normalizeIp` 不能用来解析"规则字面量"**：它会把 `::1` 改写成 `127.0.0.1`
   （对"客户端 IP"是正确的，两者确实是同一个回环），但白名单里的 `::1/128` 被改写后
   就变成 IPv4 地址，随后因"128 位前缀 > 32 位"被判非法**直接丢弃**——
   **白名单静默失效**。已改为自建 `parseIpLiteral`（只去端口 / 去 `::ffff:`，不做回环改写）。
   这个 bug 是单测抓出来的（`isWhitelisted('::1')` 断言失败）。
2. ⚠️ **测试的 `reset()` 不能靠"逐条解封"**：它依赖 `list()` 里的 key 能被 `parseRule` 解析，
   库里一旦有旧格式数据就会**漏清**，用例互相污染，表现为"同样代码时好时坏"。
   已改为直接 `writeJson('ipbans.json', {})` 清空存储。

**验收**：`tests/ipban.test.js` **17 项全绿**，覆盖——
网段位运算与主机位归一、单 IP 只命中自身、**IPv6 压缩/展开/大小写等价写法**、
到期即时放行、永久封禁、白名单（含"内网段不允许被封"）、参数校验、
默认 24h、解封与延长、**防自锁 `covers()`**、**重启后仍生效**、命中计数、
同段归并、`pruneExpired`、非法 IP 不炸。

---

## §Y 存储与 WAL 维护（2026-09-15，伴随 §X 一并处理）

### Y1 起因

排查"数据库要不要换更大的"时，发现 `data/tdshogi.db-wal` **4 MB**，
而主库只有 **128 KB**——WAL 比主库还大 30 倍。

### Y2 结论与处理

- ✅ **备份没问题**（这点最容易搞反）：`src/backup.js` 用的是 `VACUUM INTO`，
  走一次读事务拿**一致性快照**，本身就把 WAL 内容算进去了；
  模块注释里也明确写了"不能直接拷 `.db`/`.db-wal`/`.db-shm` 三件套"。
  **所以"不 checkpoint 会丢备份"是错的**；
- ✅ **已加 `storage.checkpointWal()`**（`wal_checkpoint(TRUNCATE)`），
  由 `startAutoBackup` 的每日 tick 顺手调用一次。
  **实测：`-wal` 4027 KB → 0，主库 128 → 144 KB**。
  它纯粹是打扫（省磁盘、崩溃后回放更快），**不承担正确性职责**。

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

- **安全**：~~`/api/history?player=` 越权枚举~~ ✅ 已修（§Q7-1，2026-09-10）；
  ~~接口速率限制~~ ✅ **已完成**（`src/ratelimit.js`：HTTP `api`/`auth`/`heavy` + WS `wsMsg`/`wsNotice`
  + `adminLogin` 防爆破，见 §Q7）；
  剩余：令牌存 localStorage 的 XSS 面；隐私数据保留期与导出脱敏（部分由 §K 覆盖）
- **性能**：~~`_pushState` 全量推送（增量 diff）~~ ✅ **已评估并决定不做（2026-09-20）**：
  实测后收益不足、风险不低，见下方 **§Z1**（附实测数据）
- **玩法**：AI 对战（USI 引擎，**用户明确不做**）、~~駒落ち让子~~ ✅ **已完成（2026-09-20）**，
  见下方 **§Z4**、**循环赛**（需求原文未要求，暂不做；
  多轮比积分的诉求已由瑞士制覆盖）、~~i18n~~ ✅ **基础设施 + 玩家页面已完成（2026-09-20）**，
  见下方 **§Z5**（`admin.html` 与约 300 条 JS 提示语待补，`npm run i18n` 列缺口）
- **运维**：PM2/systemd 脚本已在 `DEPLOY.md`，尚未完整线上验证
- **前端**：~~横竖屏旋转自动重建棋盘~~ ✅ 已完成（`FreeBoard` 监听 `resize`/`orientationchange`，
  节流 150ms 重绘）；~~对局页玩家栏显示等级~~ ✅ 已完成（§R3/§R5：等级 / ELO / 称号）；
  ~~`review.css` 手机端细调~~ ✅ **已完成（2026-09-16）**：见下方「复盘页手机端细调」

---

## §Y 玩家侧功能补完（2026-09-20 用户提出）

用户原话："功能还差玩家头像，快捷输入，选手脱离页面后的聊天框状态提示，举报按钮。
等级特权，比如等级5才能举办赛事。" 五项一次做完。

### Y1 玩家头像

- **预设头像白名单**，存在 `src/auth.js` 的 `AVATARS`（16 个字形）。
  ⚠️ **存的就是字形本身**（`'🐯'`），不是 id —— 这样**不存在第二张"id → 字形"映射表**，
  服务端按它校验、前端直接渲染（存 id 的话前端就得抄一份，新增头像时必然"服务端认、前端画不出"）。
- **走会话文件**（`auth.setAvatar`，与 `rename` 同款）→ **游客也能换头像**，
  不必为了换个头像去注册账号（平台默认就是游客开下）。
- 未选过时按 id **稳定派生**一个（同一玩家每次进来看到的一样，而不是每次随机闪）。
- 出口：`hello.avatar` / `hello.avatars`（白名单）、`state.players[].avatar`、
  聊天消息 `avatar`、观众列表 `avatar`。
- 前端渲染统一走 `UI.avatarGlyph()` / `UI.avatarHtml()`（`public/js/util.js`）——
  导航、玩家栏、聊天、观众列表各写一遍迟早"圆的方的、大小不一"。
- ⚠️ 房间侧有 `_playerAvatar()` **带 30 秒 TTL 的缓存**（与 `_playerTitle` 同因：
  `auth.load()` 是同步读磁盘，而玩家栏每次走子都要拿对手头像）。
  改头像后由 `rooms.refreshAvatar()` **主动失效并重推 state**，
  否则要等半分钟才生效 —— 用户会以为"没保存上"再点一次。

### Y2 聊天快捷语

`play-chat.js` 的 `QUICK_PHRASES`（6 条通用礼貌语）+ `#chatQuick` 胶囊按钮，点击即发。
⚠️ **只列通用礼貌语**：这是"一键发出、没有二次确认"的通道，任何可能引战或被误读的措辞
放进来都会直接变成事故。发送仍走同一条 `chat` 通道，**受服务端 2 秒节流约束**。

### Y3 选手脱离页面的聊天区状态提示

原先玩家栏有「⚠️ 断线 · 60 秒内未重连将判你获胜」，但**聊天区没有任何留痕** ——
低头看棋盘的对手会错过瞬时提示，观战者更是完全不知道发生了什么。
现补四条系统播报（`kind` 前缀 `player-`，**不受**「观众进出提示」开关影响）：

| 时机 | 文案 | kind |
|---|---|---|
| WS 断开（关页面/掉线） | `⚠️ X 已离开页面（掉线），等待重连…` | `player-leave` |
| 宽限期到、判负 | `⏱ X 掉线超过宽限期未回归，判负` | `player-timeout` |
| 点「退出」按钮 | `🚪 X 退出了对局（判负）` | `player-exit` |
| 重连回来 | `✅ X 已回到对局` | `player-return` |

⚠️ 掉线那条的名字只能从 `room.players[seat].name` 取 —— 走到那里 registry 已被删除
（§R3 的观众播报踩过同一个坑，所以那段注释专门写了"必须先记下名字"）。
⚠️ 重连播报只在"此前确实是掉线态"时发，首次绑定不发，否则开局就多一条废话。

### Y4 举报

- 新模块 `src/reports.js`（`CATEGORIES` / `submit` / `list` / `pendingCount` / `decide`）。
- 入口：对局页「🚩 举报对手」→ 类别下拉 + 补充说明。
  ⚠️ 类别清单由**服务端下发**（`hello.reportCategories`），前端不抄。
  ⚠️ 被举报人取**对面座位**（视角可翻转，写死先手/后手会举报到自己）。
- ⚠️ **被举报人的名字由服务端查会话**，不信客户端传的 `targetName` ——
  否则举报记录里的"被举报人"可以被伪造成任意人，管理员据此处理会冤枉无辜。
- 防滥用：同一举报人对同一目标 **30 分钟去重** + 单人 **10 条/小时**配额。
  举报**不设等级门槛**：它是"防坏人"的机制，抬门槛等于把新人挡在保护之外。
- 管理端：新 tab「🚩 举报」（`GET/POST /api/admin/reports`），可标记已处理/驳回 + 备注。
  ⚠️ 处理是**一次性**的：已处理的举报不能再处理（否则处理备注会被后一次覆盖）。

### Y5 等级特权

- **门槛表只在 `src/ratings.js` 的 `LEVEL_PRIVILEGES` 一处**：
  `{ create_tournament: 5 }`。未定义的门槛 = **不限制**（新特权默认放开，避免悄悄拦住老功能）。
- 判定在 `tournaments.createTournament` 里（**所有建赛入口的必经之路**），
  而不是 protocol / HTTP 路由层 —— 放一层就等于"以后新增一个建赛入口时又得记得补一遍"。
- 前端不抄门槛数值：`hello.privileges` 由门槛表**推导**出 `{need, ok}`，
  前端据此禁用按钮并提示"需要 Lv.5（你当前 Lv.2）"。
  ⚠️ 这只是"别让用户点一个必然失败的按钮"，真正的拦截在服务端（绕过前端照样建不了赛）。
  ⚠️ 游客不按等级提示（真正的阻碍是"没登录"，按等级提示反而误导）。
- ⚠️ **e2e 受影响**：新建账号是 Lv.0，进不了建赛。两个赛事 e2e 改为先用
  `POST /api/admin/users/:id/elo` 把经验提上去（顺带把"管理员改等级"这条链路也走了一遍）。
  ⚠️ 注意**不能断言"新账号恰好 Lv.0"**：连上就发每日登录经验，首连即 Lv.1。

### 校验

| 项 | 结果 |
|---|---|
| `npm test` | **211 项全绿**（+7 举报） |
| `npm run lint` | **0 error** |
| `npm run e2e` | **14 个脚本 / 198 项断言全绿**（新增 `e2e-player-features.js` 24 项） |

⚠️ 写 e2e 时的两个坑（都已写进脚本注释）：
1. **断言"这次收到了 X"必须用只认新消息的 `waitNew()`**，不能用会翻旧消息的 `wait()` ——
   否则"举报自己被拒"会捞到上一条 `error`（重复举报）而**假通过**；
2. `adminWrite` 的**失败**响应是 `HTTP 400 + {error}`、**不含 `ok` 字段**，
   断言要判状态码，不能写 `body.ok === false`。

---

## §Z §D 剩余项推进（2026-09-20 续）

### Z1 `_pushState`「增量推送」——**实测后判定不做**

§D 把「`_pushState` 全量推送 → 增量 diff」列为演进方向。动手前先量了一遍
（`_pushState` 会按连接**逐个**组装快照，每份都重跑 `movesToKif` / `game.state()` /
`legalMovesUsi()` / `_legalTargetsMap()`）：

| 单次开销 | 50 手 | 100 手 |
|---|---|---|
| `movesToKif`（**从头重放整局**） | 0.067 ms | 0.093 ms |
| `game.state()` | 0.015 ms | 0.011 ms |
| `legalMovesUsi()` | 1.219 ms | 0.493 ms |
| `_legalTargetsMap()` | 1.215 ms | 0.509 ms |

推算一次 `_pushState` 的总开销（100 手局面；观战者只付 `movesToKif + game.state`）：

| 房间规模 | 总开销 |
|---|---|
| 2 玩家 | ≈ 2.2 ms |
| 2 玩家 + 5 观战 | ≈ 2.7 ms |
| 2 玩家 + 10 观战 | ≈ 3.3 ms |

**结论：不值得做。** 一次推送 2–3 ms、且只在事件（走子/进出房）时触发，
不构成瓶颈；而**线格式的增量 diff 需要前端实现合并逻辑** —— 一旦合并有偏差就是
"棋盘不同步"，属于最难查的一类故障，风险与收益完全不成比例。

若将来真成为瓶颈，**正确的第一步不是 diff，而是把不变量算一次**：
两名玩家拿到的 `legalMovesUsi` / `_legalTargetsMap` 是**同一份**（都按 `game.turn` 算），
现在等于算了两遍；这属于服务端内部重构，**协议字节完全不变**，风险低得多。
（本次未做：省的约 1 ms 还抵不上动热路径的风险。）

### Z2 顺带修掉的真 bug：**と金/成香/成桂 走底线被误判「必须升变」**

查 Z1 的数值时，随机对局里发现 `movesToKif` 会崩，顺线挖到规则层一个真 bug：

- `candidateMovesFrom` 的 `canPromote` **要求"未成"**（已成子不能再升变）→ 只提供"不成"一种走法 ✅
- 但 `applyMove` 的强制升变守卫用 `Piece.unpromote(piece.kind)` 判种类，
  把已成子**还原成原始种类**再判定 → 必然得出"必须升变" → **拒绝合法着法** ❌

后果：**と金进底线**（终盘常见着法）被拒，还回一句对と金毫无意义的
「该棋子走到此位置必须升变」；前端高亮可点、服务端拒绝。
影响面：**と金/成香走底线、成桂走最下两段**。

修法：守卫加 `!Piece.isPromoted(piece.kind)`，与 `candidateMovesFrom` 的 `canPromote` 同源。

**同时补了一条不变量测试**（比定点用例更有价值）：

> `legalMovesUsi()` 里的**每一个**着法，`applyMove()` 都必须接受。

候选生成与执行校验是两条独立代码路径，口径一旦漂移就会出现"点了没反应/莫名报错"，
而只挑固定局面写用例发现不了。测试用**定种子伪随机**跑 3 局 × 200 手
（`Math.random` 在测试里是禁忌——偶发失败比不测还糟）。
已回验：修复前这条测试会挂 **12 次**（最早第 91 手），确实有护栏作用。

### Z3 测试与文档基建的修正

1. **e2e runner 从不读取服务端 stdout**（`stdio:'pipe'` 却只挂 stderr 监听）——
   管道写满（约 64 KB）会**阻塞服务端**。本次实测服务端全程只输出 0.9 KB，
   所以它**不是**那次偶发失败的原因（`e2e-test.js` 在套件里偶发
   `create_room 等待回执超时`、单独跑必过，连跑 5 次套件均未复现，**原因未定**）；
   但"没人读的子进程管道"始终是个隐患，已改为读取并保留末尾快照；
   失败时一并打印**服务端输出末尾**——脚本报的"等回执超时"通常只是表象；
2. **e2e 的超时信息带上"已收到什么"**：光说"等待 X 超时"无法区分
   "服务端没回 / 回了 `error` / 回了别的类型"，下次再出就能直接判读；
3. **admin「举报」tab 补分页**（新加 tab 容易漏，与 §W1"所有列表 20 条/页"的约定不符）；
4. **清理文档里"已实施却仍标待实施"的过时条目**：`UI-PAGES.md` 的
   `tournament.html` 与 admin 分页/赛事管理页、`TOURNAMENT.md` 里 **T4/T5 各有一组重复行**
   （第二组从未更新、仍标 ⬜）。这类反向失真会让人重复评估已完成的工作。

### Z4 駒落ち（让子）—— ✅ 已完成（2026-09-20）

用户："多语言最后再说，开工" → 做 §D 玩法项里的 駒落ち。

#### 规则约定（有依据，也有一处待确认）

依据日本将棋连盟《6.実戦》原文：**「駒落ちの場合は、必ず上手から指し始めます」**。

- **上手** = 让子方（落自己的棋子）；**下手** = 用全部棋子的一方；
- **上手先手**：让子局由上手先走；
- 落掉的棋子**直接不存在**（不在盘上、不在驹台、也不算被吃）——所以生成局面是"从初形里拿掉"，
  而不是塞进谁的手里。

⚠️ **一处待确认**：传统上「**香落ち是例外，由下手先手**」（通称"香落ち下手先"）。
连盟入门页只写"必ず上手から"、未收录该例外，而我查到的另一份资料称香落ち为公认例外——
**两个来源互相矛盾**。本实现按"一律上手先手"（依连盟原文）。
为便于改判，它被做成表里的 `firstMover` 字段：要给香落ち开例外，只需给 `lance`/`lance-right`
两项填 `'w'`，局面其余部分不受影响（"白先"链路已验证可用：走子判定与棋钟都取 `game.turn`）。

#### 术语映射：**上手 = 座位 `b`**

不是随便定的——它同时满足两件事，从而**不必引入"白先"这一整类边界**：

1. 上手先手 ⇒ 初始手番就是 SFEN 默认的 `b`（`STARTING_SFEN` 尾部就是 `b`）；
2. 落子取自 `b` 的初形（`1i`/`2h`/`8h`… 那一侧）。

因此 `createRoom` 在让子局里把房主固定为 `b`；**平手局仍然随机执先手**（既有行为不变）。

#### 手合割表（11 项，表驱动）

平手 / 香落ち / 右香落ち / 角落ち / 飛車落ち / 飛香落ち / 二枚落ち / 四枚落ち /
六枚落ち / 八枚落ち / 十枚落ち。

⚠️ **刻意不做三枚/五枚/七枚/九枚落ち**：这几种在各方资料里落子组合不一致
（五枚落ち到底是"四枚+左桂"还是"四枚+双桂"说法不一），与其猜一个，不如只提供各来源一致的标准阶梯。

⚠️ `香落ち` 落的是**与上手角行同侧**的那枚香（连盟：「上手左侧（角のあるほう）の香」）
——即 **`9i`，不是 `1i`**。这是最容易搞反的一处，单测专门钉了它。

#### 接线点（以及踩到的 4 个坑）

| 位置 | 改动 |
|---|---|
| `src/handicap.js`（新） | 表 + SFEN 生成；**模块加载时即校验**，表写错立刻抛错（而不是生成一个"看着正常"的局面） |
| `rooms/lifecycle.js` | `createRoom` 接受 `handicap`；未知 id **拒绝**（不能静默当平手）；让子局房主固定 `b`；`rated: !isPrivate && !hd` |
| `rooms/gameplay.js` | 落盘带 `handicap`/`handicapLabel`；**再来一局改用 `newGame(room.game.startSfen)`** |
| `rooms/state.js` | `state` 下发 `handicap`/`handicapLabel`/`rated`；大厅列表与后台列表也带上 |
| `rooms/snapshot.js` | 快照存/恢复 handicap（只存 `startSfen` 会"盘面对、标签丢"） |
| `src/records.js` | 棋谱存 handicap；KIF 的 `手合割：` 改为动态 + 让子局用「下手/上手」 |
| `hello` + 前端 | `handicaps` 随 hello 下发；大厅建房下拉与提示；对局页信息栏提示；大厅列表标记 |

1. ⚠️ **KIF 的 `手合割：平手` 是写死的** —— 让子局会导出错误信息（盘上少着子却写"平手"）；
2. ⚠️ **「再来一局」原来是 `newGame()`** —— 会让让子局**静默变回平手局**
   （上手突然多出 2~10 枚棋子，双方都不会察觉）；
3. ⚠️ **快照只存了 `startSfen`** —— 重启后盘面是让子局、标签却是平手，看着像数据坏了；
4. ⚠️ **既有问题**：`saveRecord` 的 `rated` 靠 `data.rated !== false`，而调用方**从来没传过** →
   棋谱恒为 `rated: true`，私人房（不计 ELO）也被标成"计入评分"。已一并修正。

#### 不计 ELO

段位差已经用"落子"补偿过了，再按平手口径结算评分没有意义 —— 与私人房同一处理
（`_finalize` 只对 `rated` 房间结算；经验照常加）。

#### 测试

- `tests/handicap.test.js` **12 项**：表自检、平手 === `STARTING_SFEN`、每种手合割的子力数/手番/有棋可下、
  香落ち落的是角侧那枚、阶梯逐级累加、十枚落ち只剩玉+歩、生成局面能被规则引擎驱动并记谱、
  `normalize` 的三态（`null`/`false`/条目）、坏数据抛错、盘面字段解析互逆、
  **KIF 导出的手合割与下手/上手**；
- `scripts/e2e-handicap.js` **26 项**：未知 id 被拒、二枚落ち的 18/20 子力、上手先走且下手抢走被拒、
  不计 ELO（收不到 `elo_updated`）、**再来一局仍是 18/20**、平手局对照。

**校验**：`npm test` **225 项全绿**（+12）、lint 0 error、
`npm run e2e` **15 脚本 / 224 断言全绿**（+26）；并用浏览器验过大厅下拉 11 项、提示联动、
对局页显示「二枚落ち（上手先手 · 不计 ELO）」、**盘面真的只渲染 38 枚**。
⚠️ 浏览器验证的坑：棋子是 `.piece-img` + CSS 雪碧图，**数 `<img>` 或文本一律得 0**
（第一版判据就栽在这里，差点误判成"没渲染让子局面"）。

### Z5 i18n（多语言）—— ✅ 基础设施 + 玩家页面已完成（2026-09-20）

用户："来i18n"。此前一直标着"**大工程，需独立排期**"——真正贵的是**逐页改文案**，
所以这一轮的重点不是"翻了多少句"，而是**把边际成本压下来**。

#### 三条设计取舍（决定了以后加文案有多省事）

1. **以中文原文当键**。本项目只有一种源语言，所谓 key 就是那句待翻译的话本身。
   再立一层 `t.home.hero.title` 式命名空间，等于每加一句文案要同时改 HTML/JS + 词典 + key 表**三处**。
   代价是**改中文原文会丢翻译**——所以配了自动化自检（见下）。
2. **DOM 整段匹配**：文本节点的 `trim()` 后**完全等于**某词条才替换，属性
   （`placeholder`/`title`/`aria-label`）同理。于是**静态页面零改动**就被覆盖，
   不必给每个元素标 `data-i18n`。只做"整段相等"是刻意的：否则会替换长句里的词，
   产出"半句中文半句英文"——那比不翻译更难读。
3. **节点记住原文**（WeakMap）。否则切到英文后节点里存的是英文，再切回中文时拿英文查表
   必然落空——用户就"回不去中文"了。

#### 两级宽松匹配（避免为同一句话抄两条）

- **去掉全部空白再匹配**：中文排版里空格不承载语义（`天锻将棋 道场` ↔ `天锻将棋道场`）；
- **前缀 emoji 原样保留、其余再匹配**：`🏠 创建房间` → `🏠 ` + `Create a room`。
  否则每加一个图标就要多维护一条词条，迟早漏。
- ⚠️ 宽松**只跨排版差异，不会把另一句话当成同一句**（有单测钉：`创建房间并邀请好友` 不该被部分匹配）。

#### 接线（4 个点）

| 位置 | 说明 |
|---|---|
| `public/js/i18n.js`（新） | 词典 + `t()` + DOM 扫描 + 语言轮换 + `localStorage` 持久化 + `<html lang>` |
| `nav.js` | 语言按钮（🌐 位置显示当前语言 `中`/`EN`）；导航项与 title 走 `t()`；`rerender()` 供切语言后重建 |
| `util.js` 的 `toast()` | **所有提示的必经之路**（含服务端下发的错误文案）→ 补一条词条就能翻一条，**不必改服务端** |
| 10 个 HTML | 在 `nav.js` **之前**引入 `i18n.js`（少了它只退化回中文，不会白屏：`tr()` 有兜底） |

⚠️ **中文是默认语言 → 零开销**：不建 `MutationObserver`、DOM 扫描直接返回。
非中文时才启用观察器接住 JS/服务端渲染出来的内容（大厅手合割下拉就是这么翻的）。

#### 覆盖率报告（`npm run i18n`）—— 让"逐页补文案"变成清单作业

```
npm run i18n          # 报 HTML 静态文案的缺口
npm run i18n -- --js  # 连 JS 里的中文字面量（提示语/动态文案）一起报
```

⚠️ 判据**直接调用运行时的查词函数**（含两级宽松匹配），不另写一套近似规则——
否则报告说"已覆盖"、界面还是中文，比没有报告更糟。

**当前覆盖**：词条 **439 条**；**面向玩家的页面 100%**（首页/大厅/对局/棋谱列表/广场/复盘/
赛事列表/赛事详情/个人）；`admin.html` **刻意不翻**（用户 2026-09-20 拍板"admin 全中文即可"：
只有站长用，而站长就是中文用户 —— 报告里已把它列入 EXCLUDE，不再算缺口）；
JS 提示语约 300 条待补（多为错误提示，用户点得到时才会显示）。

#### 两个必须记住的坑

1. ⚠️ **同一中文词在源码里只能有一条词条**（原文字典的固有约束）。`棋谱` 原本同时出现在
   导航（Games）与对局/复盘页的列表标题（Move list）——**JS 对象字面量的重复键会被静默覆盖**，
   表现为"这个页面对了、那个页面错了"。处理：把两处列表标题改成「走子记录」（中文也更准确）。
   这类冲突由**单测的重复键自检**兜住（逐个键在源码里数出现次数，必须恰好 1 次）。
2. ⚠️ **`applyTheme()` 与设置面板都用 `querySelector('.theme-toggle')` 取"第一个"**——
   语言按钮复用了这个类名，于是它的「中/EN」被覆写成 🌙。已改为按 `id` 定位
   （`themeToggle`/`langToggle`）。**按类名取"第一个"本身就是隐患**，别再用。

#### 测试

- `tests/i18n.test.js` **7 项**：默认中文原样返回、切换与回退、变量替换（含"未收录也替换"）、
  **词典自检**（值非空 / 不是键的复制 / **重复键** / **英文里残留中文过多**）、宽松匹配、语言表自检；
- 浏览器验证 **17 项**：导航/标题/正文翻译、`<html lang>` 更新、持久化、
  **切回中文能恢复**（WeakMap 机制）、英文下打开大厅（**服务端渲染的下拉选项也被翻**）、无控制台报错。

**校验**：`npm test` **232 项全绿**（+7）、lint 0 error、`npm run e2e` **15 脚本 / 224 断言全绿**。

### Z7 多语言续：日语 + 「反复点语言会卡死」的根因（2026-09-20 用户反馈）

用户三条反馈：**反复点切换语言会卡死**、**为啥没有日语**、**查看详情没有箭头**。

#### ⚠️ Z7-1「卡死」的根因：**重建了用户正在点的那个元素**

先量化，别猜：`_pushState`… 不，是 `i18n`。**在页面内**用 `performance.now()` 夹住
`I18N.setLocale()`（⚠️ 别用 Playwright `click()` 的耗时当指标——那里混了
等元素可点、滚动、事件派发等框架开销，实测约 300ms，会把"页面很快"读成"页面很卡"）：

| 场景 | 单次切换 |
|---|---|
| 真实页面（DOM ~180 节点） | 0–2 ms |
| **人为注入到 12186 节点** | **最大 36 ms**（线性、正常） |

**所以慢的从来不是词典与 DOM 扫描。** 真正的根因是：`setLocale()` 每次调
`NAV.rerender()` **重建整个导航**，而**语言按钮就在导航里** ——
用户连点时，`mousedown` 与 `mouseup` 落在**两个不同元素**上就不再产生 `click`，
点击白丢 → "点了没反应" → 继续点 → 看起来像卡死。

**修法**：`NAV.rerender()` → **`NAV.applyLocale()`**，只**改文字**、绝不换元素
（导航项文案、三个按钮的 `title`、语言按钮的 `中/EN/JA`、用户链接的 `title`）。
验证（12 项全过，含决定性判据）：

- 切换两次后按钮**还是同一个元素**（打标记验证）→ 不会再丢点击；
- **同步连点 30 次：总耗时 15ms，一次不丢**（语言恰好前进 30 步）；
- 真鼠标快速连点 9 次（不等元素稳定）：9 次全部生效。

> **可复用的教训**：任何"改语言 / 改主题 / 改状态"引发的界面刷新，
> **都不要重建包含触发控件的那个子树**。要么只改文字，要么把触发控件挪到重建范围之外。
> 这类 bug 的典型症状就是"点着点着就不灵了"，而单测与耗时测量都看不出问题。

#### Z7-2 日语（ja）

- 加入 `LOCALES`：`中文 → English → 日本語`（导航按钮点一下轮换一种）；
- ⚠️ **ja 词条里有一批与中文原文完全相同是正常的**：界面大量沿用将棋术语
  （先手/後手/詰み/香落ち/二枚落ち/入玉…），在日语里就是原样。所以
  「译文不许与原文相同」这条自检**只对 en 生效**；ja 换成更合适的
  **「不许出现明显的简体字」**（飞/车/让/时/图/详…）—— 那才说明是"照抄中文忘了改日文写法"。
  ⚠️ 黑名单只放**确定不在日文里用**的字：`学/画/声/連/通/数/体` 这类中日同形字一旦进黑名单
  就会把正确译文误判成错的（这个自检要的是"能信"，不是"查得全"）。
- ⚠️ 重复键自检要**按语言块分别数**：同一个键在 en 与 ja 各出现一次是正常的，
  按整份源码数会误判成重复。
- ⚠️ `<html lang>` 直接写 locale id：原先写的是"非 en 就当 zh-CN"，加了 ja 之后会把日语标成中文。
- `scripts/i18n-report.js` 支持 `--locale=ja`（覆盖率要**按语言分别看**）。

**两种目标语言现在都是 100%**：en **439 条** / ja **441 条**（`admin.html` 仍排除）。

#### ⚠️ Z7-3 「反复切语言**直接卡死浏览器**」的真根因（2026-09-20 追加，**更正 Z7-1 的结论**）

用户第二次反馈："反复切换语言还是会卡死，**直接造成浏览器卡死**"，并指出"**是赛事页会触发**"。

**先说更正**：Z7-1 把"导航被重建导致丢点击"当成卡死的根因，**不成立**。
它只解释了"连点几下之后点了没反应"（体感像卡死），**解释不了浏览器本身卡死**。
真根因如下（有数据）：

| 步骤 | 事实 |
|---|---|
| 量化 | 页面内夹 `performance.now()`：单次切换 **0~2ms**；人为造到 **12186 节点**也才 **36ms**（线性）。**慢的从来不是词典与扫描。** |
| 探针 | 包装 `Node.prototype.textContent` 的 setter 计数 + 事件循环延迟：`index.html` 连点 40 轮**写入量恒定**（427/轮）、静止 0 次。**说明卡死与"页面上有多少文字"无关。** |
| 纯数据定位 | 逐条扫描词典：**3 条译文首尾带空白**（`' — sign up…'`、`'Viewing profile: '`、`'　— 指したい…'`）；用**旧算法**模拟观察器循环 —— **en 6 条 / ja 3 条永不收敛**。 |

**机理**：`translateNode` 原实现是

```
next = 当前内容的首部空白 + 译文 + 当前内容的尾部空白
```

译文**自身首尾带空白**时，每写一次就多出一层空白 →
`写入 → MutationObserver(characterData) → translateNode → 再写入 → …`
**无限微任务循环**：主线程被彻底占满（浏览器卡死）、文本无限膨胀。
而 `——想下棋请另外报名。` 正好在**赛事页**（创建赛事弹窗里）—— 与用户说的完全对上。

**四处修法**（缺一不可）：

1. **结构上堵死**：`nodeContent(原文, 译文)` **只依赖原文**（故意不接收"当前内容"），
   结果是个常数 ⇒ 写完一次后 `node.textContent === next` 恒成立 ⇒ 循环**不可能**发生
   （不再靠"词典里别写脏数据"来保证）。
2. **清数据**：那 3 条译文去掉首尾空白；排版用的空白**写回标记层**
   （`profile.js` 里标签与名字之间那个空格）。加自检：**译文不许首尾带空白**。
3. **加熔断安全网**：观察器回调里若有 5000 次/秒以上的写入，**停用自动翻译**并告警
   —— 宁可界面退回中文，也绝不卡死浏览器。⚠️ 只统计**观察器内**的写入
   （`setLocale()` 主动全量重扫在大页面上本来就上万次，那是正常的）。
   ⚠️ 熔断后**不自动重挂**（能触发一次风暴的东西会一直触发）。
4. **加回归**：`tests/i18n.test.js` 里"**翻译必须收敛**"——逐语言逐词条套用上述循环，
   并**反向自检**"老实现确实会挂在这条断言上"（否则等于白写）。
   另加"译文不许首尾带空白"。

**校验**：`npm test` **238 项全绿**（+3）；`npm run e2e` 15 脚本/**227** 断言全绿；
浏览器验收 —— 把当初致命的那句话与病态词条**故意注入赛事页**后连切 30 轮：
写入量首末轮持平（105/105）、DOM 不涨、静止不烧、熔断器**未误触发**；
最后 **10 个页面 × 3 种语言 = 30 个组合**全绿（无控制台报错、导航均切到对应语言）。

**遗留（已知、不修）**：切换语言后，**已经渲染出来的日期文本**会保留切换前的格式 ——
它们是普通字符串（不在词典里），要等该列表下次刷新或刷新页面。多数列表有轮询会自愈。

> **可复用的教训（两条，分属不同层）**：
> 1. **任何"写 DOM 又监听 DOM"的机制，其写入必须是幂等的**（重复执行必须收敛）。
>    这类 bug 不报错、单测看不出、耗时测量也正常，只会在**特定数据**下把浏览器打死；
>    必须靠"**逐条数据做不动点模拟**"这类检查才抓得到。
> 2. **别把排版用的空白塞进译文**：它属于标记层。这不只是风格问题 —— 它是上面那场事故的燃料。
>
> 另：Z7-1 的 `applyLocale()`（就地更新、不重建导航）**仍然要保留**，
> 它解决的是另一个真实问题（连点丢点击），只是**不是**卡死的原因。

---

## §Z8 外部安全审查（2026-09-21）与 v1.4.5 安全热修

一份外部审查报告（`docs/TDShogi-review-report.html`）对 **v1.4.4（29ca712）** 做了静态通读 +
隔离实例动态复现，给出 **4 个 P0 / 5 个 P1 / 6 个 P2**。我逐条对着代码核实，**4 个 P0 全部属实**，
且项目里**没有任何 `uncaughtException` 兜底**（grep 零命中），所以 P0-1 真的是"一条命令打崩全站"。

### 已修（本版 v1.4.5）

| 编号 | 问题（核实结论） | 修法 |
|---|---|---|
| **P0-1** | `verifyToken` 用 `sig.length`（UTF-16 字符数）比对，却拿 `Buffer.from(sig)`（UTF-8 字节数）去 `timingSafeEqual`。签名段塞 32 个 emoji（64 字符 / 128 字节）→ 长度校验通过、抛 `RangeError`；**抛出点在 WS 握手回调里**→ 进程退出。`server.js` 的 `new URL(req.url, 'http://' + req.headers.host)` 同理（畸形 Host 抛 `ERR_INVALID_URL`） | 比较前先做**格式白名单**（`^[0-9a-f]{64}$` ⇒ 字符数恒等于字节数）+ `try/catch`；`admin.verify` 同款一并收紧；WS 握手整体包 `try/catch`（只拒该连接）+ 不信任 Host（基地址固定 `localhost`）+ 进程级 `uncaughtException`/`unhandledRejection` 兜底 |
| **P0-2** | `SESSION_SECRET` 回落源码常量 `'tdshogi_session_secret_change_me'`，而**账号 id 是公开数据**（大厅/个人页/悬停卡/管理接口都可见）→ 离线伪造任意账号令牌、完全接管 | 环境变量优先；否则**首启生成随机密钥并持久化**（`data/secret.json`）。⚠️ 必须持久化（密钥一换所有旧令牌失效）。`ADMIN_SECRET` 同款（原先**从管理口令派生**，口令弱就等于没有） |
| **P0-3** | `register(username, password, guestId)` 对 `guestId` **不验证来源**，任何人用受害者 id 注册即可搬走其**全部棋谱 / ELO / 会话**（审查实测：1516 分 1 局的账号被搬空） | **最小修复**：目标 id 已是注册账号 → 拒绝迁移并记 `log.warn`。完整方案（迁移凭据：游客会话里存一个不下发的 key，迁移时必须携带）留下一版 |
| **P0-4** | `resolvePlayer()` 是**公开读**用的宽松解析（`/api/profile?player=` 本就该宽松），却被 6 个棋谱接口拿去做 `records.isOwner` 判定 → 凭**公开 id** 即可导出/回放/复盘他人棋谱、以他人名义写评论/书签/变着。（`bookmark`/`variation` 更松：**根本没做身份解析**，直接用 `req.body.guest`） | 拆出**严格**的 `resolveOwner()`：**注册账号必须凭签名令牌**（裸 24-hex 且 `accounts.getAccount()` 命中 → 返回 null）；游客 id 即凭证的现状保持不变。6 个接口全部改用它，`resolvePlayer` 只留给管理员检索 |
| **P1-2** | 内置默认管理口令 `'Cplusplus123'` + `ADMIN_SECRET` 从口令派生 → 开箱部署＝后台沦陷；不登录也能离线伪造 admin token（审查实测 200） | 删除内置默认口令：未配置时**首启生成随机口令、持久化并打印一次**；`ADMIN_SECRET` 改为随机且与口令解耦 |
| **P1-3** | `esc()` 只转 `& < > "`，**不转单引号** —— 而管理页把用户数据拼进单引号 `onclick` 属性里。游客改名 `');alert()//`（12 字符，恰好过长度校验）→ 管理员一点按钮即以管理员身份执行脚本（存储型 XSS） | `esc()` 增补 `'` → `&#39;`（全站无损修复）。⚠️ 根治（管理页改事件委托、`onclick` 字符串拼接全面下线）留下一版 |
| **P1-4** | `adminEntryGate` 用 `req.path === '/admin.html'`，而 Express 的 `req.path` **不做百分号解码**、静态中间件却会解码 → `GET /%61dmin.html` 绕过门禁 | 比较前 `decodeURIComponent`（非法编码不抛错） |

**回归用例**（报告要求"把复现脚本转正"，已落库）：
- `tests/security.test.js`（P0-1 多字节签名不抛、P0-2 随机密钥持久化与复用、P0-3 劫持被拦**且正常升级仍可用**、P1-4 编码变形仍 404）；
- `tests/util.test.js` 增 `esc` 单引号用例；
- `scripts/e2e-security.js`（已并入 `npm run e2e`）：崩溃向量后**进程必须存活**、棋谱越权**必须 403**、**本人令牌必须 200**（正向对照）。

### 未修（如实列账，避免"修了 P0 就当收工"）

- **P1-1 重复操作静默判负**（双击「加入/匹配」→ 当前对局被 `_autoResignAndLeave` 判负）：
  ✅ **已修（2026-09-23）**。改法：`joinRoom`/`quickMatch` **三段式**
  （非破坏性校验 → 才动当前对局 → 落座/入队）；`quickMatch` **只拦 `PLAYING`**；
  ⚠️ 对局中**建房**仍保留 PLAN §H 的"自动认输退出旧局"（行为没改，`e2e-freeboard.js` 断言已同步）。
  **验收**：`scripts/e2e-lobby-ops.js` 13 项已接回套件 → **17 脚本 / 265 断言全绿**。
  > 下面那几条**是 2026-09-21 的历史记录**（当时试做后撞出"回归"、按先保绿回退），
  > 其中"撞出的回归"后来查明**与本改动无关**：根因是 `protocol.js` 的 clientId
  > 只用毫秒时间戳做后缀，同一 guestId 的双连接同毫秒握手会生成**相同 clientId**，
  > 后到者覆盖先到者的注册 → 先到者**静默失聪**（实测碰撞率 21/60 ≈ 1/3）。
  > 已修（clientId 加自增序号），该问题同时是**线上**隐患（同一游客开两个标签页可能中招）。
  **2026-09-21 试做过一轮（结果：有效但撞出回归，已回退）**，结论与坑记录如下，
  下一轮直接从这里接手：
  1. 改法是**三段式**：`① 非破坏性校验 → ② 才动当前对局 → ③ 落座/入队`。
     "重复请求"判据用**状态**（已在同一房间 / 已在队列 / 正在对局），
     ⚠️ **不要**用"N 秒内算重复"的时间窗 —— 会误伤"匹配→认输→立刻再匹配"这类合法快速操作
     （`e2e-test.js`「对局结束后不退出可直接再次匹配」当场抓到，已证伪）。
  2. 该改法能过 `scripts/e2e-lobby-ops.js` 的全部 13 项（报告里三个变体都不再判负，正向路径也没误伤），
     但会让 `e2e-test.js` 的「同身份占用防护」段挂掉（`G1 create_room` 静默无回应、服务端无异常），
     根因未定位，故按"先保绿"回退。
  3. **验收目标就是 `scripts/e2e-lobby-ops.js`**（已在仓库里，只是没接进 `npm run e2e`）：
     修好后把它加回 `e2e-all.js` 的清单即可。
- **P1-5 游客清理空转**（`cleanup.js` 读的是已废弃的 `sessions` **表**，真实会话在 kv）：
  属实，隐私保留期承诺目前未生效，留下版。
- **P0-4 的完整方案**：游客 id 目前仍是"id 即凭证"，需要会话撤销机制才能彻底解决。
- P2 各项（`maxPayload`、单 IP 连接数上限、`_lastChatTs` 清理、幽灵消息 `elo_updated`/`tournament_update`、
  依赖 `npm audit`、镜像内跑 `npm test` 是"0 测试"假绿）—— 见报告 §5。

> **两条值得记住的教训**：
> 1. **"公开 id 当凭证"是一个系统性弱点**，P0-2 与 P0-4 同源：id 到处可见（大厅/个人页/悬停卡），
>    一旦哪处把它当身份用，就等于把那处的权限公开了。**判定归属必须凭签名令牌**。
> 2. **"长度先比、再常量时间比较"这个写法本身有坑**：`String.length` 是 UTF-16 码元数、
>    `Buffer.from()` 是 UTF-8 字节数，两者在非 ASCII 输入下不等价 —— 结论是**必须先做格式白名单**
>    （hex/base64 之类"字符数 == 字节数"的字符集），再进比较。

### Z6 收尾四处调整（2026-09-20 用户提出）

用户："admin 全中文即可，收尾吧"，外加四处界面调整：

| 项 | 改动 | 为什么 |
|---|---|---|
| **荣誉明细** | 列出**每一个打完的赛事**（含没名次的，标「参赛」），不再只列前四 | 早先 `if (!place) continue` 会把"打了但没进前四"的整条丢掉 —— 打满 5 届只显示 1 条，看着像数据丢了 |
| **冠军标记** | 夺冠条目的名次后加 🏆 | 一眼认出哪几届是冠军 |
| **个人页看他人** | `profile.html?player=<id>` = **只读视图** | 此前**没有入口**看别人的个人页 |
| **举报按钮** | 从右侧「操作」卡移到**顶部交互栏** | 原先要滚动才看得到；`show` 时顺带把表单滚进视野（手机窄屏尤其明显） |
| **赛事列表按钮** | 「查看详情 / 管理 →」→ **「查看详情 →」** | 管理入口在详情页里，列表不必提示 |

**只读视图隐藏什么、保留什么**（这条是设计的要点）：

- **隐藏**：账号卡（注册/登录/退出）、资料编辑卡（手机号等）、改名与换头像入口 —— 都只对本人有意义；
- **保留**：等级/经验、ELO、战绩、**赛事荣誉**、ELO 走势、最近对局 —— 那正是"看别人"想看的东西。

⚠️ `setupViewMode()` 必须在页面里**最后一处 `renderAccountUI()` 之后**调用，否则账号卡会被重新显示出来。

**入口只加一处**：`hovercard`（玩家名字的去重卡片）底部加「👤 查看个人页 →」。
全站凡是有 `data-player-id` 的地方（对局玩家栏、聊天、观战名单、排行榜、赛报名单…）**因此都有入口**，
比在每个页面各加一个链接省事，也不会漏掉某个列表。
⚠️ 卡片本身有 `mouseenter` 取消隐藏（`ensureEl` 里早有），所以移进卡片点得到。

**测试**：`tournaments.test.js` 加 1 项（八人赛第 1 轮出局者 → 明细里应有一条 `placeLabel='参赛'`），
共 **233 项**；浏览器验证 **18 项**（只读视图的隐藏/保留、hovercard 入口可点且能跳转、
举报按钮与「退出对局」同父节点、列表按钮文案），无控制台报错。
⚠️ 新写赛事测试时踩了一次：主办 id 必须用文件顶部**已抬到 Lv.5** 的白名单里的（等级特权门槛）。
