# TDShogi 开发计划（路线图）

> 最近更新：**2026-09-05**（新代理接手，文档结构重整）
> 配套：`ARCHITECTURE.md`（服务端架构）、`UI-PAGES.md`（页面地图）、`agents/MEMORY/REFLECTIONS.md`（排障复盘）
> 图例：⬜ 待实施 ｜ 🟨 已改码/进行中，待验证 ｜ ✅ 已完成 ｜ ⏸ 暂缓

---

## 0. 协作约定与当前状态

**协作约定（2026-09-05 定）**
- **测试全部由用户执行**（e2e 套件 + 浏览器实机验证）；我只交付代码改动与文档更新，
  改动后自做 `node --check` 与 lint 自检。
- 新需求 / 新 bug **先入计划再实施**；实施后在原条目补「实施记录」，不留口头结论。

**当前状态**
- 版本 v1.2.0（git 98926d0）；**工作区有大批未提交改动**（server/src/public/scripts），
  动手前建议先落一个基线提交。
- 回归资产 `scripts/e2e-*.js` 共 10 套件（详见 `ARCHITECTURE.md` §8），最近一次全量 190 项。
- 服务端 13 模块 / 前端 15 脚本，无构建步骤，静态资源走 `no-cache` 协商缓存。

---

## 1. 优先级路线图

| 优先级 | 编号 | 主题 | 状态 | 依赖 |
|---|---|---|---|---|
| **P0** | §J1 | 驹台持驹选中后无法取消 | ✅ 已修复（用户验证 2026-09-05） | — |
| **P0** | §J2 | 王手红格高亮疑似丢失 | ⬜ 待核实 | — |
| **P0** | §J3 | 感想战推演吃子后持驹棋种错误（吃角行多出飞车） | ✅ 已修复（用户验证 2026-09-05） | — |
| P1 | §J4 | demo_state 下发权威 hands，兜住前端模型漂移 | ⬜ 待定 | — |
| P1 | §J5 | 隐藏管理员入口（导航条件显示 + `ADMIN_ENTRY_KEY` 可选门禁） | ✅ 已实施 | — |
| **P1** | §K | **用户详细信息（IP 等，仅管理员可见）+ 管理员可管理用户数据** | 🟨 已实施（2026-09-05），待用户实测 | ~~§M3~~ ✅ 已完成 |
| **P2** | §L | **公开棋谱展示（棋谱广场）+ 管理员编辑对局信息与评论** | ⬜ 待实施 | §K 的 admin 中间件与审计 |
| **P3** | §M | 模块化重构：**M3 基础服务已落地**；rooms 拆分 / server 路由拆分 / 前端拆分待做 | 🟨 部分完成 | 与 K/L 解耦，建议在其之后 |
| P4 | §C1/C3/C5/C6 | 管理后台其余增强（总览仪表盘/棋谱管理/公告管理/实时干预） | ⬜ 未排期 | — |
| **P1** | §N | 移动端 UI 适配（棋盘竖排/导航紧凑/触控优化） | 🟨 已实施（2026-09-05），待用户实测 | — |
| P4 | §D | 长期 Backlog | ⏸ | — |

**推荐执行顺序**：J1/J3 验证（用户）→ ~~M3~~ ✅ → **K（下一步）** → L → M 其余 → C 剩余项。
理由：M3 是 K 的地基且零风险；K 产出的「统一 admin 中间件 + 审计」正是 L 与 C 的前提；
M 的大拆分（rooms 1820 行）风险最高，放在功能稳定后做，避免与业务需求抢回归窗口。

---

## 2. 进行中 / 待验证

### J1 驹台持驹选中后无法取消 — 🟨 已改码

- **现象**：点驹台持驹进入选中态后，再点几次都无法取消，只能随便打入一格或等对手走子刷新。
- **根因**：驹台 DOM 在 `handsEls`，不在 `board.boardEl` 内 → `_handleClick()` 里带 toggle 的
  `.hand-piece` 分支**从不可达**；实际生效的是 `freeboard.js render()` 的 `pick()` 回调，
  它原先无条件赋值 `selectedHand`。
- **实施记录（2026-09-05）**：`public/js/freeboard.js` 的 `pick()` 非 free 分支改为
  `if (!s || !this.legalTargetsBySq[s]) return; this._pickHand(color, piece, s);`。
  同种再点 = 取消，异种 = 切换；一处覆盖 play / demo-rules；`play.js` 旧链路（onSelectPiece）已是死代码未动。
- **用户验收清单**：① 再点同种取消 ② 异种切换 ③ 感想战与自由摆棋各复测 ④ 非手番方驹台仍点不动。

### J2 王手（check）红格高亮疑似丢失 — ⬜ 待核实

- `play.js:113` 调 `fb.setModel({board, hands}, state.lastMove, { check: [...] })`，
  但 `FreeBoard.setModel(modelLike, lastMove)` 只收两个参数 → 第三个被丢弃；
  `FreeBoard.render()` 也不再给 `board.render` 传 `check`（旧的 `reapplySelection()` 会传）。
- 处理：起服走一局王手局面确认；若确认丢失，给 FreeBoard 加 `setCheck(sqList)` 并在 `render()` 透传。

### J3 感想战推演吃子后持驹棋种错误（吃了角行却多出飞车）— 🟨 已改码

- **现象**：感想战推演中吃子，驹台增加的棋子与实际吃掉的棋子不符（典型：吃「馬」→ 驹台多出「飛」）。
- **排查结论（不是先后手、也不是两套棋盘）**：
  1. 持驹渲染**只有一个入口**——FreeBoard（`play.js:507-511` hands + `523 bindHands`）；
     `play.js:145 renderHands(st)` 是 v6 组件化后遗留的**死代码**，无调用点，不存在两套渲染打架。
  2. 感想战重放的手番计算正确（`ensureOriginalPositions` / `applyDemoMode` 均按 `(手数索引 % 2)` 取 b/w）。
  3. 服务端 `hands` 用中文名（`game.js` `KIND_NAME`），与前端模型字段一致，`find(piece===raw)` 能匹配。
  4. **真因**：`freeboard.js` 的 `DEMOTE`（成駒 → 原始棋种）把 **`'馬': '飛'`**（应为 `'角'`）。
     于是任何「吃掉对方成駒 → 进驹台」的路径都会把**角行的成駒还原成飞车**。
- **影响面（同一张表的三处调用）**：
  1. `applyUsiOnModel()` 吃子 → **感想战推演主路径**（服务端 demo_state 不含 hands，显示完全依赖前端重放）
  2. `_move()` → 自由摆棋拖拽吃子
  3. `togglePromote()` 双击降级 → 双击「馬」会变成「飛」（同一张表，顺带修好）
- **实施记录（2026-09-05）**：`'馬': '飛'` → `'馬': '角'`，一处改动覆盖上述三条路径。
- **用户验收**：感想战吃「馬」→ 驹台应多「角」；吃「龍」→ 多「飛」；自由摆棋双击「馬」→ 变回「角」。

### J5 隐藏管理员入口（用户要求，不让普通用户接触后台）— ✅ 已实施 2026-09-05

**两层改动：**

1. **导航入口隐藏**（`nav.js` / `admin.js`）：
   - `renderNav()` 里 🛡️ 入口改为条件渲染：仅当本机 localStorage 持有 admin token
     （`tdshogi_admin_token`，与 admin.js 同键）才显示——普通用户任何页面都看不到；
     管理员自己登录后仍能看到，方便进出
   - admin.js 登录/登出后调用 `NAV.renderNav(null)` 重渲染（token 增删即时反映到导航）
   - 代码注释明确：这只管"入口可见性"，权限校验始终在服务端 `admin.verify`
2. **服务端可选门禁**（`server.js`）：设置 `ADMIN_ENTRY_KEY` 后，访问 `/admin.html`
   必须带 `?k=<key>`，否则 **404**（连"后台存在"都不暴露）；不设置则保持开放，避免把自己锁在门外。
   该 key 只用于"找到页面"，登录仍需管理密码（`/api/admin/*` 的 verify 鉴权不变）。

**管理员使用方式**：直接访问 `/admin.html`（或配置了 key 时 `?k=...`）；部署说明已写入 `DEPLOY.md`。
验证过 public 下仅 `nav.js` 一处引用 admin.html，无其他入口残留。

### J4 加固建议：demo_state 下发权威 hands — ⬜ 待定

- **背景**：J3 之所以能长期潜伏，是因为**感想战推演的持驹完全由前端本地重放得出**——
  服务端 `_broadcastDemo` 只发 `moves/kif/legalTargets...`，**不含 `hands`**，
  前端模型一旦有任何偏差，显示就是错的且无从校验（用户说的"有的时候"可能还有别的偏差来源）。
- **方案**：`_broadcastDemo` 与 `demoEnter` 的载荷追加 `hands`（由服务端 `_demoGame` 实例取 `game.hands()`，零额外计算）；
  前端 `applyDemoMode()` 以服务端 hands **覆盖**本地重放结果（moves 仍走本地重放，因为要支持历史手跳转）。
- **收益**：前端模型漂移（吃子/打子/升变各类映射错误）被服务端权威兜住，同类 bug 不再靠用户肉眼发现。
- 风险：载荷略增（每手变化时才发，影响可忽略）。

---

## 3. §K 用户详细信息（IP 等隐私）与管理员数据管理 — 🟨 已实施（2026-09-05），待用户实测

> 需求原文：用户需要加 IP 地址等详细信息；**用户的 IP 等隐私仅管理员可见**；**管理员可以管理用户的任何数据**。

### K0 现状盘点（2026-09-05 实读代码）

| 维度 | 现状 |
|---|---|
| IP 采集 | **完全缺失**：全仓无 `remoteAddress` / `x-forwarded-for` / `trust proxy`；Nginx 示例只配了 `X-Real-IP`，没有 `X-Forwarded-For` |
| WS 侧 | `server.js:335` `wss.on('connection', (ws, req))` **已有 req**，可拿到 socket 与握手头，无需改架构 |
| 会话存储 | `auth.js` 用 kv（`sessions/<id>.json`）存 `{id,name,createdAt,lastSeen}`；`storage.js` 另有独立 `sessions` 表（`getSessionById/putSession`）被 `accounts.migrateGuestData` 使用 → **双写不同源**（历史遗留，见 M4） |
| 管理员读取 | `protocol.adminUserData()` 已返回 profile/records/name/**phone**/accountCreatedAt |
| 管理员写入 | **只有赛事审核与 KIF 导入**；用户数据无任何写接口（改名/重置/封禁/删除全部没有） |
| admin 前端 | 2+1 tab（全部棋谱 / 全部用户 / 赛事管理），用户详情是弹层，无编辑区 |

### K1 连接信息采集（新 `src/net.js`）

- `clientIp(req)`：`X-Forwarded-For` 首段 → `X-Real-IP` → `req.socket.remoteAddress`；
  归一化 `::ffff:1.2.3.4` → `1.2.3.4`、`::1` → `127.0.0.1`；非法值返回 `null`。
- `clientUa(req)`：取 `user-agent`，截断 200 字符（防超长脏数据）。
- `app.set('trust proxy', process.env.TRUST_PROXY || 1)`（反代层数可配；**未反代时必须为 0/false，
  否则伪造 XFF 即可伪装 IP**）。
- WS：`protocol.handleConnection(ws, guestId, { ip, ua })`（新增第三参，默认 `{}`，不影响现有 e2e）。
- REST：Express 中间件挂 `req.clientIp / req.clientUa`，供审计与登录接口复用。
- **部署配套**：`DEPLOY.md` / `README.md` 的 Nginx 示例补
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`，并注明与 `TRUST_PROXY` 的对应关系。

### K2 数据模型与隐私边界（白名单出口原则）

- 会话对象扩展（存 kv `sessions/<id>.json`，**随会话走**）：
  ```js
  net: { firstIp, firstSeenAt, lastIp, lastUa, lastSeenAt, loginCount }
  ```
  写入策略：**仅当 IP 变化时更新**，避免每次心跳都写盘。
- 登录/连接事件（append-only，供管理员回溯）：新增 kv 前缀 `events/`，
  记录 `{ ts, type:'login'|'ws_connect', playerId, ip, ua }`；
  同一 `playerId + ip` 24h 内不重复记录；容量上限环形保留最近 **5000 条**（`MAX_EVENTS` 可配）。
- **隐私出口白名单**（沿用 §F 手机号的做法，只有两处可返回 IP/UA）：
  1. `protocol.adminUserData()`（管理员）；
  2. 本人查看自己的登录记录（**待定**：游客 id 无密码，任何人拿到 id 即可查 → 一期建议**不开**，只给管理员）。
  其余一律剔除：`playerCardData` / `state` / `activeGames` / `recentSummaries` / `leaderboard` / `historyData`。
- 可选脱敏：`ADMIN_IP_MASK=1` 时管理员界面也只显示 `1.2.*.*`（巡检/演示场景）。
- 保留期：`IP_RETENTION_DAYS`（默认 90），启动时清理过期 events；会话上的 `net` 字段随会话保留。

### K3 服务端接口（全部经统一 admin 中间件，见 M2）

| 接口 | 行为 |
|---|---|
| `GET /api/admin/users` | 列表增加 `lastIp`（列展示）、`banned` 标记（IP 列表仍**不在列表接口返回**，只在详情给，减少暴露面） |
| `GET /api/admin/users/:id` | 追加 `net`（firstIp/lastIp/UA/登录次数/首次最后时间）、`events`（近 50 条登录记录）、`banned` |
| `POST /api/admin/users/:id/ban` / `unban` | 封禁：写入 `banned:{reason,until,by}`；**生效点** `auth.identify()` 拒绝 + WS `handleConnection` 拒绝（发 error 后关闭）、已在线连接踢下线 |
| `POST /api/admin/users/:id/rename` | 改名（同步 `rooms.updatePlayerName` 让对局内即时生效） |
| `POST /api/admin/users/:id/reset-rating` | 重置 ELO 与战绩（`ratings` 提供 `resetPlayer`） |
| `POST /api/admin/users/:id/reset-password` | 账号重置为随机密码并返回一次（或走「强制下线 + 下次登录需重设」，一期直接返回随机串） |
| `POST /api/admin/users/:id/profile` | 改手机号/棋风/备注（管理员备注 `adminNote` 仅管理员可见） |
| `DELETE /api/admin/users/:id` | 删除账号 + 会话（**高危**：需二次确认 + 提交用户名确认；棋谱默认保留但解绑 playerId） |

- 幂等与错误形状：统一 `{ok, error}`；重复 ban/unban 返回 `状态已变更`。
- **审计**：所有写操作经 `src/audit.js` 落 `events/`（`type:'admin_action'`，
  含 `adminIp`、`targetId`、`action`、`before/after` 摘要），管理员可在后台查看。

### K4 admin 前端（`admin.html` / `admin.js`）

- 「全部用户」tab：列表加 **IP 列**（脱敏开关生效）、封禁徽标、筛选（按 IP 段/是否封禁/是否账号）。
- 用户详情弹层新增两块：
  1. **登录信息**：首次/最近 IP、UA、登录次数、最近 50 条登录记录表（时间/IP/UA）
  2. **管理操作**：改名 / 重置 ELO / 重置密码 / 封禁(填原因与时长) / 解封 / 编辑资料 / 删除账号(高危二次确认)
- 新增「操作审计」tab（或并入详情）：按时间倒序展示 admin 操作日志。

### K5 测试与验收（用户执行）

- 新脚本 `scripts/e2e-privacy.js`（预计 12-15 项）：
  1. 非管理员访问 admin 用户接口 → 403
  2. `/api/player-card`、`/api/home`、`/api/lobby`、`/api/records/search` 响应序列化后**正则搜不到 IP**
  3. 管理员详情能拿到 `net.ip`
  4. XFF 伪造头在未开 `TRUST_PROXY` 时不生效
  5. 封禁后该 id 新建 WS 连接被拒、已在线连接被踢
  6. 改名 → 进行中对局双方即时看到新名
  7. 审计日志写入条数与内容正确
- 浏览器手测：admin 用户列表 IP 显示、详情弹层两块、封禁/解封、操作审计。

### K6 实施记录（2026-09-05，代码已全部落地，待用户实测）

**服务端**
| 文件 | 改动 |
|---|---|
| `auth.js` | `identify(guestId, meta)` 接收 `{ip,ua}`：首次/IP 变化才写 `session.net`（防高频 I/O）；封禁到期懒解封；调 `audit.loginEvent`（24h 同人同 IP 去重）。新增管理员会话操作：`adminRename`（显示名≤16，不改账号登录名）/`banPlayer`（days>0 有期，否则永久）/`unbanPlayer`/`adminSetNote`（备注存会话，游客账号统一）/`adminDeleteSession`/`getSessionRaw` |
| `protocol.js` | `handleConnection` 第三参 `meta`；**封禁身份在连接层直接拒绝**（发 error 后 close，对局/观战/聊天全部不可用）；新增 `kickPlayer(playerId)`（发提示后关全部该身份连接）；`adminUserData` 追加 `isAccount/net/banned/adminNote/style/events`；公开出口 `homeData/lobbyData/historyData(非管理员)/playerCardData/profileData` 统一过 `privacy.stripPrivate` |
| `accounts.js` | `verifyToken` 支持 `tokenInvalidBefore`（重置密码后旧令牌全失效）；新增 `adminUpdateProfile`（phone/style）/`adminResetPassword`（可随机生成、明文仅响应一次、旧令牌失效）/`deleteAccount`（删账号+会话+评级，棋谱保留） |
| `ratings.js` | `resetPlayer`（重置 ELO/战绩）/`removePlayer`；`allUsers` 附带 `lastIp`/`banned` |
| `server.js` | WS 传入 `netInfo.clientInfo(req)`；新增 `adminWrite` 包装（verify→业务→audit.adminAction）；六条写路由：`POST /api/admin/users/:id/{ban,unban,rename,reset-rating,reset-password,profile}` + `DELETE /api/admin/users/:id`（confirm 须为用户名或 DELETE；删除时先踢下线）+ `GET /api/admin/audit`（审计查询） |

**前端（admin.html / admin.js）**
- 用户列表：**最近 IP 列** + 封禁徽标 + 行内「封禁/解封」按钮
- 详情弹层：封禁横幅（原因/到期时间）、**登录信息卡**（首次/最近 IP、UA、时间）、**编辑资料表单**（手机号/棋风/管理员备注）、**管理操作按钮组**（改名/重置 ELO/重置密码/封禁/解封/删除账号——高危操作双重确认）、**最近 50 条登录记录表**
- 新 tab「操作审计」：管理员写操作流水（时间/动作/目标/成败/来源 IP/详情），带刷新按钮

**与原设计的偏差**
- 封禁生效点选择「连接层拒绝」（比逐入口拦截更彻底且实现简单）；未做按 IP 段封禁
- `loginCount` 未落会话（用 audit 事件条数代替，避免每次连接写盘）
- 删除账号：评级清空、棋谱保留（playerIds 悬空）；游客无删除项（弹层隐藏该按钮）
- 改名只改显示名（会话 name），账号登录用户名不变——改名不改登录凭证
- REST 出口 `records/search` 走的是 `storage.searchRecords` 原始返回，未过 stripPrivate（数据源无隐私字段，风险面为零；后续 §L 改造时统一收口）

### K7 等级系统（EXP / Level）— ✅ 已实施（2026-09-05），待用户实测

> 用户需求：每日登录经验 +2、完成一局 +1；等级指数增长（0→1 需 2、1→2 需 4、2→3 需 8 …）；
> 最高 64 级；管理员可编辑 ELO 等信息；管理员列表显示游客身份。
> J1/J3 同日经用户实机验证通过。

**曲线与溢出结论（用户问「64 级会不会溢出？」）**
- 升到 L 级的累计经验 = `2^(L+1) - 2`；等级公式 `L = floor(log2(exp+2)) - 1`，clamp [0, 64]
- **数值上不会崩**：exp 是累计获得量，远小于 2^53（安全整数上限）；`2^(L+1)` 在 L≥51 超出安全整数
  精度但 Number 仍可表示（上限 ~1.8e308），`exp >= 需求` 的比较结果依然正确
- **设计上 64 级是"名义上限"**：升满 64 级累计需 `2^65-2 ≈ 3.7e19` 经验——按每日 +2 要 5e16 天，
  永远满不了。若想"摸得着"满级，建议改低增长曲线（如 1.1 倍几何）或降 MAX_LEVEL（`ratings.js` 一个常量）

**实现**
| 位置 | 内容 |
|---|---|
| `ratings.js` | `MAX_LEVEL/levelFromExp/nextLevelExp/addExp`（升级自动结算，返回 leveledUp）/`adminSetPlayer`（管理员直接改 ELO/经验，等级随经验推导）；`defaultRating` 加 `exp/level`；`profile()` 返回 exp/level；`allUsers` 附带 `exp/level/isAccount`（游客/账号区分，延迟 require accounts 防循环依赖） |
| `protocol.js` | `handleConnection`：`audit.loginEvent` 从 auth.identify 挪到此处——**去重结果兼做「每日首次」判定**，首次连接 → `ratings.addExp(+2,'daily-login')`（auth 层拿不到去重结果，故必须挪）；`playerCardData` 带 `level` |
| `rooms.js` | `_finalize`：终局双方 `addExp(+1,'game')`（含赛事对局、判负局）；`_gameState.players` 带 `level` |
| `server.js` | `POST /api/admin/users/:id/elo`：编辑 ELO（100-5000）与经验（≥0），走 adminWrite 审计 |
| 前端 | admin 用户列表：🔐/👤 身份徽标 + `Lv.x · ELO` + 经验；详情弹层「等级与 ELO」编辑区（ELO/经验两个输入 + 保存）；profile 页 ELO 卡下方显示 `Lv.x` 与 `经验 x / 升级所需`；hovercard 显示 `Lv.x · ELO` |

**验证**：等级曲线单测通过（0→0、2→1、6→2、14→3、30→4、62→5；1e18 经验 → 58 级不崩、64 封顶生效）。
注意：`nextLevelExp(63)` 的返回值 3.7e19 超出安全整数，**展示会丢精度**（差几十），功能无影响。

**用户验收点**：每日首次连接 +2（同日第二次连接不涨）；打完一局双方 +1；个人页/hovercard/admin 列表等级正确；管理员改经验后等级立即重算。

---

## 🎯 N. 移动端 UI 适配 — 🟨 已实施（2026-09-05），待用户实测

> 用户需求：PC 端已完美，做手机端适配。现状：已有 900px/640px 基础单列断点，但 375-430px 视口存在硬伤。

**修复前的问题清单**
1. **棋盘区横向溢出**（最严重）：`.board-area` 横排三列 ≈ 482px > 375px 视口
2. **棋盘尺寸不自适应**：`--cell-size` 断点固定值（38px）在 375px 下棋盘+持驹仍超宽
3. **导航溢出**：brand+5 链接+主题钮+用户徽章 ≈ 380px+
4. 对局侧栏被 900px 断点 `order:-1` 提到棋盘上方（手机上应在下方）
5. 输入框 14px 触发 iOS 聚焦自动放大
6. **既有缺陷顺手修**：`.fb-drag-ghost` 从未有样式定义——没有 fixed 定位，拖拽幽灵棋子一直静止在文档流里而非跟随指针（PC 上同样存在）

**实施（`style.css` ≤640px 媒体查询为主 + `board.css` + `board.js` 一处）**
| 项 | 方案 |
|---|---|
| 棋盘区竖排 | `.board-area` 改 `flex-direction: column`：对手持驹横条在上、棋盘居中、自己持驹横条在下（DOM 顺序天然正确，零 HTML 改动）；`.hand-pieces` 横排可换行 |
| 棋盘尺寸 | `--cell-size: auto`（≤640px）→ `board.js cellSize()` 检测到非 px 值时按视口推导：`clamp(28px, (视口-70)/9, 48px)`。**注意：CSS 自定义属性不解析 vw/min()**，getComputedStyle 拿到原始 token，所以必须由 JS 算像素 |
| 导航 | 印章隐藏、logo 缩小、链接 padding 6px、用户名 64px 截断省略、按钮 32px——375px 单行放得下 |
| 侧栏归位 | ≤640px `order:0` 回到棋盘下方；棋谱限高 200px、聊天 140px |
| 触控 | 交互元素 `touch-action: manipulation`（去双击缩放延迟）；`-webkit-text-size-adjust: 100%` |
| 输入 | `.input/.select` 强制 16px（覆盖内联 13px，防 iOS 聚焦缩放） |
| 弹层/横幅 | promote/banner 缩放、bannerText 22px；admin tab 容器加 flex-wrap |
| 持驹 | `.hand-piece` 36px、棋盘 padding 6px |
| 拖拽幽灵 | 补全 `.fb-drag-ghost` 样式（fixed 定位跟随指针、drop-shadow、44px 棋子） |

**验证**：board.js 语法 + 两个 CSS 花括号配平检查通过；实机验证归用户（重点：375px 视口棋盘完整、
对局可正常点击/拖拽打入、导航不换行、横屏旋转后需刷新页面重算尺寸——已知限制）。
**二期候选**：旋转/resize 自动重建棋盘、review.css 手机端细调、对局页玩家栏显示等级。

### K8 实测反馈修正（2026-09-05 二次，用户报「改备注/封禁提示服务器错误」+ 需求变更）

**排查结论**：函数级复现（临时 DATA_DIR，不起服）把备注/封禁/资料/审计/详情拼装全链路跑了一遍，
**全部正常无异常** → 服务端逻辑没有 bug。结合「报错的恰是两条全新路由」，最可能原因是
**测试时服务进程跑的还是旧代码**（未重启 → 新路由 404 → 前端笼统报错）。

**落地修正**：
1. `adminWrite` 的 catch 不再吞成笼统的"服务器内部错误"，改为
   `服务器内部错误: <真实异常信息>`（配合服务端 console.error 全栈，可定位）
2. 前端 `adminPost`：非 JSON 响应（404 HTML 等）提示 `请求失败（HTTP 404，若为 404 请确认服务进程已重启）`
3. **需求变更：管理员备注 → 用户称号**（原 adminNote 字段废弃）：
   - 存会话 `session.title`（≤12 字符，留空清除），游客/账号统一，`auth.adminSetTitle`
   - 展示为「用户名称（称号）」：admin 用户列表、详情弹层标题、hovercard
   - `player-card` 公开接口带 `title`（称号是展示性字段，编辑权限仅管理员）
   - 详情编辑区原备注框改为「用户称号」输入框
4. 待用户确认：若下次仍出现「服务器内部错误: xxx」，把 xxx 发来即可精确定位。

**真实根因（用户回传日志定位）**：`ReferenceError: auth is not defined at server.js:190` ——
**server.js 忘了 `require('./src/auth')`**（§K3 写路由用到 auth.banPlayer/adminSetTitle/adminRename/unbanPlayer，
但顶层漏了 require）。封禁/改名/解封/资料四条路由全炸，与用户报障完全吻合。
已补 require。**教训（重要）**：函数级复现直接调模块函数，**绕过了 server.js 路由层**，查不出路由层的
未定义引用；`node --check` 只查语法、lint 未开 no-undef 也查不出。对策：①server.js 新增引用模块时
必须核对顶层 require 清单；②路由层验证要么起服冒烟、要么给项目配 eslint `no-undef`（列入 §M2 时一并做）。

---

## 4. §L 公开棋谱展示（棋谱广场）+ 管理员编辑 — ⬜ 待实施

> 需求原文：后续做**公开展示棋谱**的页面；管理员可设置公开展示的棋谱（如比赛棋谱）；
> **棋谱中的对局信息和评论，管理员可以编辑**。

### L1 数据模型（`records` 记录扩展，向后兼容）

```js
{
  visibility: 'private' | 'public',          // 默认 'private'（存量无字段即 private）
  meta: {                                    // 展示用可编辑信息（管理员）
    title, event, round, playedOn,           // 标题/赛事/轮次/对局日期
    tags: [], description,                   // 标签/简介（列表筛选与详情页头图说明）
    nameOverrides: { b, w },                 // 覆盖展示名（导入的比赛谱常用）
    resultNote,                              // 结果补充说明
    featured: false,                         // 是否置顶到广场首页
    updatedBy, updatedAt,
  },
}
```
- **不改** `moves / result / playerIds`（原始对局数据只读，避免展示层污染棋谱本身）；
  若确需修正结果，走管理员专用接口并写审计（二期）。

### L2 权限模型改造（关键，改动面小但影响大）

现状：`/api/records/:id/playback` 与 `/review` 要求 `isOwner || admin`；
`historyData` 普通用户只返回自己的（**注**：历史记忆里「普通用户可见公共 kif-import 谱」与当前代码不符，以代码为准）。
改为统一判定 `canViewRecord(rec, ctx) = isAdmin || isOwner || rec.visibility === 'public'`：

| 能力 | 游客 | 本人 | 管理员 |
|---|---|---|---|
| 广场列表（`visibility=public`） | ✅ | ✅ | ✅ |
| 公开谱回放/复盘 | ✅ | ✅ | ✅ |
| 私有谱回放/复盘 | ❌ | ✅ | ✅ |
| 编辑 meta（对局信息） | ❌ | ❌（一期仅管理员） | ✅ |
| 写评论 | ❌（一期） | ✅ | ✅ |
| 编辑/删除**任意**评论 | ❌ | 仅本人 | ✅ |

### L3 评论模型升级（兼容性是重点）

现状 `comments` 是 `{ [moveNo]: string }`（单条、无作者）。公开展示需要多人评论与管理员编辑，
升级为 `{ [moveNo]: [{ id, authorId, authorName, text, ts, editedBy, editedAt }] }`：

- **读时兼容**：`reviewData()` 归一化——旧字符串自动包装为
  `{ id: '<recId>:<moveNo>:legacy', authorId: rec.playerIds[colorOf(moveNo)], authorName: null, text, ts: rec.createdAt }`，
  前端与导出无需改；**写入时才转为新结构**（懒迁移，无停机脚本）。
- `setComment` 语义扩展：新增可选 `commentId`——有则**编辑**该条，无则新增；
  `text` 为空且带 `commentId` → **删除**该条。权限：本条作者本人 或 管理员。
- 管理员删除他人评论 → 记审计（含原文快照，便于回滚争议）。

### L4 服务端接口

| 接口 | 行为 |
|---|---|
| `GET /api/gallery?tag=&q=&page=` | 公开棋谱列表（轻量摘要，不含 moves），支持标签/关键词/分页；置顶优先 |
| `GET /api/records/:id/meta` | 公开谱返回 meta；私有谱按 L2 鉴权 |
| `POST /api/admin/records/:id/visibility` | `{ visibility }` 切换公开/私有 |
| `POST /api/admin/records/:id/meta` | 编辑对局信息（title/event/round/playedOn/tags/description/nameOverrides/resultNote/featured） |
| `POST /api/admin/records/:id/comment` | 管理员新增/编辑/删除**任意**评论（复用 L3 扩展后的 setComment） |

- `records.listPublic(opts)`：基于 SQLite `json_extract(data,'$.visibility')` 查询（与 `searchRecords` 同法）。
- `historyData` 普通用户补充：返回自己的 **+ 所有 public 谱**（对齐产品直觉：广场里的谱自己也能在历史页看到）。

### L5 前端

- 新页面 `public/gallery.html` + `js/gallery.js`（导航 `nav.js` 加「棋谱广场」入口）：
  筛选条（标签/搜索）→ 卡片网格（双方名/赛事/手数/结果/日期，置顶徽标）→ 点击进 `review.html?id=`。
- `review.html` 支持公开谱只读复盘（无需登录）；带 `adminToken` 进入时显示「编辑对局信息」面板
  （表单：标题/赛事/轮次/日期/标签/简介/双方名覆盖/结果说明/置顶）与「公开/取消公开」开关。
- 评论 UI 升级：评论列表显示作者与编辑标记（`已编辑`），本人可编辑/删除，管理员可编辑/删除任意。

### L6 测试（用户执行）

- 新脚本 `scripts/e2e-gallery.js`（预计 15-18 项）：公开/私有可见性矩阵（游客/本人/他人/管理员）、
  meta 编辑与审计、评论新增/编辑/删除权限矩阵、**旧字符串评论懒迁移后可读**、广场筛选与分页。
- 回归：`e2e-test` 的历史/复盘相关断言需按新权限模型复查。

---

## 5. §M 模块化重构 — ⬜ 待实施

### M1 `src/rooms.js`（1820 行，全仓最大且是历史 bug 高发区）

**方案：mixin 模式**（各文件导出 `function apply(X) { X.prototype.xxx = ... }`，
`this.*` 调用链全部保留，**不做对象重组**——这是风险最低的拆法）。

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

### M2 `server.js`（349 行：静态/REST/WS 混编）

- `src/http/` 目录：`routes/{home,lobby,records,accounts,admin,tournaments}.js` + `middleware/{adminAuth,error,requestCtx}.js`
- 统一 admin 中间件（当前每个路由各写一遍 `admin.verify(token)`，是 §C 的既有前提）
- `resolvePlayer` / `sanitize` 等工具移入 `src/http/util.js`
- WS 部分保留在 `server.js`（只做 `wss.on('connection')` → `protocol.handleConnection`）

### M3 基础服务（✅ 已实施 2026-09-05，K 的地基，零行为变更）

- `src/net.js`：IP/UA 解析（K1）
- `src/audit.js`：审计与事件日志（K2/K3）
- `src/privacy.js`：**字段出口白名单**——`stripPrivate(obj, { allow })` / `assertNoPrivate(obj)`，
  把「手机号/IP 不外泄」从人肉约定变成**结构性保证**（并可在 e2e 里断言）。

**实施记录（2026-09-05）**

| 交付 | 说明 |
|---|---|
| `src/net.js`（新） | `clientIp/clientUa/clientInfo/attachClientInfo/normalizeIp/maskIp/trustProxyHops`；`TRUST_PROXY` 未配置 = 不信任任何代理头（防伪造 XFF）；`::ffff:` 与 `::1` 归一化；非法值返回 `null` |
| `src/audit.js`（新） | 事件存 kv 前缀 `events/`，键名带 14 位时间戳（字典序=时间序）；`loginEvent`（同 playerId+IP 24h 去重）/ `adminAction`（不去重）/ `query` / `loginHistory` / `prune`；`AUDIT_MAX_EVENTS`(默认 5000) 与 `AUDIT_RETENTION_DAYS`(默认 90) 双上限 |
| `src/privacy.js`（新） | `PRIVATE_KEYS` 命中集（phone/ip/ua/net/events/token…）+ `stripPrivate(value,{allow})` + `assertNoPrivate(value)` 返回命中路径 |
| `src/storage.js`（增） | 新增 `deleteJson(name)`（审计裁剪需要；纯新增，原接口不动） |
| `server.js`（接） | `app.set('trust proxy', trustProxySetting())` + `app.use(attachClientInfo)`（挂 `req.clientIp/req.clientUa`）+ 启动时 `audit.prune()`（try-catch 兜底） |

- **本步刻意未做**：① 各 REST 出口接入 `stripPrivate`（留到 §K 实施时与 admin 中间件一起改，
  避免现在无 IP 数据时动 `protocol.js`）；② WS 连接把 `{ip,ua}` 传给 `protocol.handleConnection`
  （属 §K1，与会话写入一起做）；③ `auth` 会话写 `net` 字段（属 §K2）。
  即：**本步只铺地基，还没有任何隐私数据被采集落盘**，现有行为完全不变。
- 自检（`node -e`，纯函数不落盘）：IP 归一化/脱敏、`TRUST_PROXY=0|1|true` 三种取值顺序、
  `stripPrivate` 与 `assertNoPrivate` 均符合预期。

### M4 存储双写统一（技术债）

- 会话当前两条路：`auth.*` 写 kv `sessions/<id>.json`（真正在用），
  `storage.getSessionById/putSession` 写独立 `sessions` 表（仅 `accounts.migrateGuestData` 用）。
- 目标：会话单一来源 = kv；`migrateGuestData` 的会话迁移改调 `auth.upsertSession`；
  `storage` 的 sessions 表接口标记废弃（保留导出以防外部脚本引用）。
- 收益：修「管理员列表偶尔拿不到昵称」类问题的根因，也让 K 的 `net` 字段只需写一处。

### M5 前端拆分（按页面内聚，不做框架迁移）

| 文件 | 现状 | 拆分 |
|---|---|---|
| `play.js` | 34 KB（对战+感想战+聊天+棋钟+复盘浏览混编） | `play/{core,demo,chat,clock}.js` |
| `admin.js` | 15 KB（3 tab） | `admin/{records,users,tournaments,audit}.js`（K4/L5 之后自然拆） |
| `review.js` | 16.7 KB | 抽出「复盘器内核」供 `gallery → review` 复用（L5） |

**风险与顺序**：M1 风险最高（rooms 是历次 bug 中心），必须在功能需求（K/L）稳定后单独窗口做，
且拆分期间禁止行为变更；M3 风险最低、收益立即可见，**建议先行**。

---

## 6. 已完成批次（历史归档）

| 批次 | 内容 | 状态 |
|---|---|---|
| §0 | 棋谱列表改「一编号 = 一手」（对齐 KIF 手数）；打子日式渲染修复 | ✅ |
| §1 | 部署失败根因：better-sqlite3 触发 npm 自动 node-gyp → 仓库根 `.npmrc` `ignore-scripts=true` | ✅ |
| §2 | 幽灵房治理、断线体验（connected 字段 / 接続切断 / %CHUDAN）、重连绑定、规则引擎、高亮残留 | ✅ |
| §3 | UI 第一批：lobby 卡片同尺寸、tournaments 两段式 + 创建弹窗 | ✅ |
| §A | 首页改版：三步引导 / 最新战报 / 平台数据条 / 规则速查（A1-A4 全落地） | ✅ |
| §B | 赛事系统：B1 前端改版、B2 服务端登录校验、B3 审核状态机、B4 admin 审核界面、B5 回归 | ✅ |
| §E | 赛事管理台一期：审核队列 / 进行中 / 历史 + 四路由（幂等）+ 公共页联动 | ✅ 二期遗留：force-finalize、删除记录、移动端触屏悬停 |
| §F | 个人资料（手机号私密/棋风/注册日期）+ hovercard.js 全局悬停小窗 + `/api/player-card` | ✅ 二期遗留：移动端触屏点击弹半屏卡 |
| §G | 感想战 v6/v7：棋盘组件化（FreeBoard 三模式）、单页模式、拖拽行棋、每手耗时、KIF/CSA 对齐 81Dojo | ✅ |
| §H | v8 批次：座位统一回位、自动退出、任意历史手行棋、待った跨本谱、持驹打入回归 | ✅ 遗留：演示者浏览历史手时棋盘不可点（`updateDemoUI` 交互限制未放开） |
| §I | v1.2.0 实测批次：I1 重进回座位、I2 升变弹窗、I3 成銀图集错位、I4 非手番方驹台禁点、I5 幽灵房、I6 发布与安全加固 | ✅ |

**§C 管理后台增强（原设计，部分并入 §K）**
- C2 用户管理增强 → **已并入 §K（本期需求）**
- C4 赛事管理 → 已由 §E 完成
- C1 总览仪表盘 / C3 棋谱管理（删除·筛选·批量导出 ZIP）/ C5 公告管理 / C6 实时干预（解散房间·踢人·全服广播）→ **未排期**，通用前提是 M2 的统一 admin 中间件 + K 的审计日志

---

## 7. §D 长期 Backlog

- **安全**：`/api/history?player=` 越权枚举（游客 id 无密码）；令牌存 localStorage 的 XSS 面；
  IP 等隐私数据的保留期与导出脱敏（部分由 §K 覆盖）
- **性能**：`_pushState` 全量推送，长对局多观众带宽线性增长（增量 diff 是演进方向）
- **玩法**：AI 对战（USI 引擎接入）、駒落ち让子、多轮/循环赛制、i18n
- **运维**：PM2/systemd 落地脚本已在 `DEPLOY.md`，尚未做过一轮完整线上验证；
  Nginx 示例缺 `X-Forwarded-For`（由 §K1 补齐）
