# TDShogi UI 页面参考

> 面向前端开发/排障的每页地图。服务端与协议细节见 `ARCHITECTURE.md`，
> 改版计划见 `PLAN.md`。更新于 2026-08-27。

## 共享基础设施（所有页面）

| 文件 | 职责 | 关键点 |
|---|---|---|
| `js/settings.js` | **用户设置中心**（PLAN §S1） | 单一 localStorage 键 `tdshogi_settings`（旧 `tdshogi_theme`/`tdshogi_sound` 首次读取时自动迁移、旧键不删）；`SCHEMA` 驱动 ⚙️ 设置面板（导航右侧入口），**加设置项只改这一处**；`get/set/all/subscribe/apply`。面板 DOM 与样式动态注入，不改 HTML 结构。**必须在 `nav.js` 之前加载** |
| `js/nav.js` | 全局导航渲染 | `renderNav(pageKey)` 高亮当前页；管理 localStorage guest 身份（GUEST_KEY）。主题改由 `Settings` 驱动（`getTheme`/`toggleTheme` 转调），并提供 ⚙️ 设置入口。**名字以服务端权威**：首次只生成 id 不生成名字，`hello` 到达后由 api.js 调用 `NAV.updateUserName()` 回写并刷新徽章。**🛡️ 管理入口仅本机 localStorage 持有 admin token 时渲染**（PLAN §J5），普通用户不可见；`/admin.html` 可再配 `ADMIN_ENTRY_KEY` 门禁（未配 key 时管理员直接访问该 URL） |
| `js/api.js` | WS 连接封装 + REST 工具 | `api.connect(guestId)` → `/ws?guest=<id>`；`api.on(type, fn)` 订阅、`api.send(obj)` 发送；hello 名字注入导航 |
| `js/board.js` + `css/board.css` | 棋盘渲染与走子交互 | `new ShogiBoard(container, opts)`；`render(state, extra, viewpoint)` 全量渲染；合法目标高亮（空格=绿点 `.target`、有子=方块 `.has-piece`）；上一步橙色 `.last`（可由设置关闭）、王手红 `.check`；后手视角镜像。**棋盘坐标**（PLAN §S4）：`buildCoords()` + `renderCoords(viewpoint)` 独立绝对定位层，随视角翻转、`pointer-events:none`，由设置开关（默认隐藏） |
| `js/pieces.js` | 驹台持驹渲染 | `renderHands(el, hands, seat, onClick, viewpoint)`；自研 SVG 木纹棋子（驹台格子可点击打子） |
| `js/sound.js` | Web Audio 程序化音效 | 落子/吃子/读秒嗒声/开局/结束；AudioContext 需首次 pointerdown 解锁；开关由 `Settings` 统一持久化（`setEnabled` 转调 `Settings.set('sound')`，`applyEnabled` 供其回调，避免递归） |
| `css/style.css` | 设计令牌 + 布局 | CSS 变量主题（深色和风 + 金色点缀）、卡片/按钮/toast/modal 类名、响应式断点（900px 单列；短视口压 cell-size） |

身份约定（读代码前必知）：**guest.id 含 `.` 即账号会话令牌**（`<accountId>.<ts>.<sig>`），纯 24 hex 是游客 id。REST 查询自己数据时，账号要传 `id.split('.')[0]`（accountId）；对局/棋谱落盘都存 accountId。

---

## 1. index.html（首页）— `js/home.js`

**职责**：落地页（2026-08 改版后）。自上而下：

1. **Hero**：标题/副标语/「开始对局」按钮/**随机观战**按钮（WS `random_spectate` → `spectating` 事件跳转 play 页）
2. **平台数据条** `.live-strip`：在线 / 对局中 / 等待对局(waiting+matching) / 累计棋谱，四个胶囊
3. **三步引导** `.steps-grid`：立即开局(lobby) → 登记账号(profile) → 复盘精进(history)，等宽三卡
4. **公告 & ELO 排行榜** 双栏
5. **最新对局战报**：最近 5 局轻量摘要（双方/结果/手数/时间/ELO 标记），点击进复盘器；空态引导开局
6. **将棋规则速查** `.rule-card`：4 个 `<details>` 折叠卡（目标/升变/打入/持钟），纯静态

- 数据源：`GET /api/home`（stats/games/announcements/leaderboard/recordsTotal/recentBattles），home.js 每 5s 轮询。
- 后端配套：`storage.countRecords()`、`records.recentSummaries(limit)`（不带 moves 全量，省轮询带宽）。

## 2. lobby.html（对战大厅）— `js/lobby.js`

**职责**：三个同尺寸面板组成 `.lobby-grid`（两列网格，第三块换行留空——刻意留白，后续此处放新功能）＋ 底部**进行中的对局（观战）**列表。

1. ⚔️ 快速匹配：`quick_match` / `cancel_match`；等待动画 `.match-wait`
2. 🏠 创建房间：4 种时制下拉 → `create_room`；成功显示房间码 + 复制按钮（`game_start` 时自动跳转 play 页）
3. 🔑 加入房间：6 位码输入框（支持回车提交）→ `join_room`；下方另有 **「👁 观战（用房间码）」** → `spectate {code, password}`
   （PLAN §T2：私人房凭「房间码 + 密码」观战；密码经 `sessionStorage` 带到 play 页，**不落 URL**，避免留在浏览器历史与服务端访问日志）

底部列表来自 `GET /api/lobby` 的 `games`，5s 轮询；每张 game-card 点击进入对局——点击者是该局选手（`g.playerIds` 命中 hello 下发的本机 playerId）则跳 `play.html?room=<roomId>`（走 request_state 回位到选手座位），否则才带 `spectate=1` 观战进入；meta 显示房间码/类型/手数/观战人数（§R4：`spectatorCount` 由服务端按 playerId 去重，列表按观众数降序「热门优先」，同人数保持服务端原序）。

## 3. play.html（对局页）— `js/play.js`（核心页面）+ `js/play-clock.js`（棋钟）

> 脚本顺序：`play-clock.js` 必须排在 `play.js` **之前**（后者依赖前者的 `window.PlayClock`）。
> 棋钟于 PLAN §M5 第 1 步从 `play.js` 抽出；`play.js` 只注入 `getState/getViewpoint`
> 并在 `state`/`clock` 消息里转发，tick 循环与读秒音效都在 `play-clock.js`。

**职责**：对战 / 观战 / 重连三合一。布局：顶部信息栏 + 棋盘（上=对手栏，下=自己栏）+ 左对手持驹/右自己持驹 + 右侧聊天与走子记录。

> 规划中（见 PLAN §G）：终局后自动进入感想战——**演示行棋**模式：演示者（默认房主）自由行棋全场实时同步，演示权可「交给对方」，常驻提示「正在由 xx 演示」，可回到终局。

进入分支（URL 参数决定，onopen 后发送）：
- `spectate=1&room=` → `spectate {roomId}`（只读视角，无 legalTargets；若该身份在此房间有断线座位 → 服务端按 playerId 回位到选手座位，`spectating` 带 `rebind:true`）
- `join=1&room=` → `join_tournament_match {roomId}`（赛事对局）
- 无 spectate → `request_state`（带 URL 的 roomId：服务端优先绑定该房间回位，按序 reconnect→bindToActiveGame 兜底绑定）

渲染要点：
- `state` 消息全量驱动；`seat`/`isPlayer` 区分玩家观战
- **视角**：`currentViewpoint()` 统一决定——对局者固定自己视角，观战者可在先手/后手间切换
  （顶部「🔄 视角·先手/後手」按钮，仅观战者可见；PLAN §R1）。切换走 `FreeBoard.setViewpoint()`，
  只翻转 viewpoint 与驹台配色、不换 DOM，并清选中
- 走子：选己方棋子/驹台子 → 服务端下发的 `legalTargetsBySq[from]` 渲染目标 → 点目标格出招；成/不成双选时弹升变浮层
- 棋钟本地 500ms tick + 服务端 `clock` 校准；读秒 ≤10s 每秒播嗒声
- 音效触发判据：`moves.length` 增加 && 棋子总数减少 → 吃子音
- 对手栏 `players[x].connected === false` 时显示 "⚠️ 断线 · 60秒内未重连将判你获胜"
- 结束横幅文案区分 投了/接続切断(掉线)/詰み/時間切れ；赛事局隐藏"再来一局"，退出返回 tournaments.html
- `replaced` 消息（旧协议保留路径）：提示此身份已在别处登录并锁盘
- 聊天：`chat {text}`（全员含观战者，2s 节流由服务端执行）

## 4. history.html（棋谱检索）— `js/history.js`

**职责**：自己的对局检索 + 列表入口。

- **WS `record_search {query,opening,movesMin,movesMax,result}`** → 回 `record_search_result {records}`
  （PLAN §Q7：身份由 WS 握手时绑定，服务端**强制按该连接身份过滤**；客户端不传也不可指定 playerId。
  旧的 REST `/api/records/search?player=` 与 `/api/history?player=` 现仅管理员可用）
- 条件含义：query=选手名关键词 / opening=前N手 USI（逗号分隔）/ moves=区间如 `30-80` / result=b|w|-
- 列表项点击 → `review.html?id=<recordId>`；回车即检索

## 4.5 gallery.html（棋谱广场）— `js/gallery.js`（PLAN §L，2026-09 新增）

**职责**：展示管理员设为**公开**的棋谱（赛事名局、经典对局），任何人可浏览与复盘。

- 数据源 `GET /api/gallery?q=&tag=&page=&limit=`（服务端只返回 `visibility=public`，摘要不含 moves）
- 布局：搜索框（双方名/标题/赛事）+ 标签下拉（从首屏记录提取）+ 卡片列表 + 分页（20/页）
- 卡片：置顶标题（⭐ 标题）、双方名（管理员可用 `nameOverrides` 覆盖展示名）、结果 + 手数、
  赛事·轮次·日期、简介、标签徽标
- 点击卡片 → `review.html?id=<recordId>`（公开谱免登录复盘）

## 5. review.html（复盘器）— `js/review.js`

**职责**：单谱复盘（似感想战界面）。能力：

- 对子布局走谱（▲/△）、日式记谱 ↔ USI 切换
- 前进/后退/跳首/跳末，当前手滚动居中
- 书签 toggle / 评论（写删）/ 变着（在任意手数挂备选着法）
- 数据：`GET /api/records/:id/playback`（局面序列）+ `/review`（完整标注数据）；写操作 POST bookmark/comment/variation（body 带 `guest`）
- 权限：owner 或管理员（管理员经 admin.html 跳入时带 `&adminToken=`）；**公开棋谱任何人可复盘**
- **棋盘渲染（PLAN §M6 已统一）**：浏览与自由摆放**共用同一个 FreeBoard 实例**——
  浏览走 `review` 只读模式（`ensureFb()` + `setModel(..., lastMoveSq())`，自动带上一步/王手高亮与统一持驹），
  自由摆放切 `free` 模式后切回（不再 destroy/new）
- **视角翻转（PLAN §S6）**：顶部「🔄 翻转视角」按钮在先手/后手视角间切换（默认先手）。
  走 `fb.setViewpoint(vp)`（与对局页观战视角同一机制，连带交换驹台配色），
  玩家栏（`topName`/`bottomName` 及其 `data-player-id`）随视角重排为「上方=对面、下方=自己」
- **§L 变更**：
  - 评论**展示在手数下方**（`💬 作者 文本（已编辑）`），管理员就地 ✏️ 编辑 / 🗑 删除；
    「当前手」面板仅用于新增或编辑输入
  - **公开谱 + 非管理员 = 只读**：隐藏书签/评论/变着/自由摆放按钮
  - 带 `adminToken` 进入时显示「管理员：对局信息与展示设置」面板（标题/赛事/轮次/日期/标签/简介/
    双方名覆盖/结果说明/置顶）+ 可见性下拉（私有一公开）
  - 顶部元信息优先展示 `meta.nameOverrides` / `meta.resultNote`（与广场卡片一致）

> 规划中（见 PLAN §G）：新增「✋ 自由摆放」开关——在当前浏览局面上自由摆子推演（草稿性质，不入谱）。

## 6. tournaments.html（棋手赛事）— `js/tournaments.js`

**职责**：赛事展示与参与（2026-08 改版后）。

- 顶部横幅卡：标题说明 + **🏆 我要创建赛事** 按钮
  - 游客点击 → toast 引导登录并跳 profile.html（前端拦截）
  - 正式账号 → 弹出创建弹窗（名称 ≤20 字 + 4/8/16 人）→ `create_tournament`
  - **服务端强制登录校验**（B2）：游客直接发 WS 消息也会被拒
  - 创建后进入 `pending_approval`，公共列表不展示；创建者本窗口显示「🕐 审核中」，管理员通过后进入报名
- 两段列表：**进行中的赛事**（status open/playing）与**往期赛事**（finished，含冠军行）
  - 数据源 `GET /api/tournaments`（服务端过滤，5s 轮询）；参赛者名单行内显示
  - open 态有名额与"加入比赛"按钮（`join_tournament`）；bracket 存在则渲染对阵树
- 服务端流程：管理员审核 → 报名满员自动 `startTournament` → matchFactory 建房 → 各轮胜者晋级 → 冠军写入 championId

## 7. profile.html（个人页）— `js/profile.js`

**职责**：账号体系 + 个人战绩。

- 未登录：注册（用户名/密码×2，带 guestId 自动迁移游客数据）/登录表单；游客改名区（`rename`）
- 已登录：显示账号名/id；登出重置为新游客身份
- 战绩：ELO 卡片、总场次 W/L/D、ELO 走势柱状图（最近 30 条，`profile.history`）、最近对局列表（点进 history）
- 数据源：`GET /api/profile?player=<accountId>`（账号令牌取 split('.')[0]）
- **我的资料卡**（登录后显示）：手机号（私密，仅管理员可见）/ 棋风下拉 / 注册日期只读；`GET/POST /api/account/profile`（令牌鉴权）；身份卡显示棋风徽标与注册日期

## 7.5 选手信息悬停小窗（js/hovercard.js，全局组件）

- 渲染时给名字元素加 `data-player-id="<playerId>"` 即自动生效（事件委托，无需逐页绑定）
- 悬停 ~400ms 弹出公开资料：昵称/账号游客徽标/ELO·胜率/棋风/注册日期/近 10 局胜负点；**绝不含手机号**
- 数据源 `GET /api/player-card?id=`；30s 缓存；视口边界翻转；ESC/移开关闭
- 挂载点：首页排行榜与最新战报、对局页玩家栏、大厅观战列表、赛事参赛者与对阵表

## 8. admin.html（管理后台）— `js/admin.js`

**职责**：管理员控制台（现状仅两个 tab，增强设计见 PLAN §C）。

- 登录：输入管理密码 → WS `admin_login` → 换 12 小时 HMAC token 存 localStorage（ADMIN_KEY）；退出仅清本地
- Tab「全部棋谱」：`GET /api/history?adminToken=`（无 player= 全库）；按名字/ID 前端过滤；每条 [回放][KIF][CSA]（链接携带 adminToken 或 token）；📥 KIF 批量导入（POST /api/admin/records/import，逐文件上传统计成败）
- Tab「全部用户」：`GET /api/admin/users?token=`；每行显示**昵称 (id)** 与 ELO/战绩（未下过棋的纯会话用户显示默认 1500/0 局）；详情弹层 `GET /api/admin/users/:id`（评分四卡 + 该用户对局列表）；按名字/ID 过滤
- Tab「赛事管理」：`GET /api/admin/tournaments`（全量含待审核/已拒/已取消）；统计条 + 待审核队列（通过/拒绝）+ 进行中（取消，解散对局并提示解散场数）+ 历史；写操作 `POST /api/admin/tournaments/:id/{approve,reject,cancel}`，幂等，二次确认
- token 失效统一处理：403 → 清 token 回登录态

服务端侧密码优先级：`ADMIN_PASSWORD` env > data/admin.json > 内置 `Cplusplus123`（v1.2.0 起；token 签名密钥未配置 `ADMIN_SECRET` 时从密码派生）。
