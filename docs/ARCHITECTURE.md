# TDShogi 程序架构文档

> 版本：v2（2026-08）· 覆盖：SQLite 存储、对局快照恢复、观战聊天、棋谱检索、账号系统
> 本文是排障与二次开发的地图——尤其第 5、6 章（对局状态机、连接与绑定）是历次 bug 的高发区。

---

## 1. 系统概览

| 维度 | 说明 |
|---|---|
| 形态 | **单进程 Node.js 常驻服务**（Express REST + ws WebSocket 同端口） |
| 运行时 | Node 22+（better-sqlite3 v13 硬性要求，22/24 实测），npm 依赖：express / ws / shogi.js / better-sqlite3 |
| 数据 | 单一 SQLite 库 `data/tdshogi.db`（WAL 模式），零外部服务 |
| 前端 | 原生 JS + 程序化 SVG/PNG 棋子，无构建步骤 |
| 规则引擎 | shogi.js（走法生成）+ `src/game.js`（王手过滤/升变/判定封装） |
| 部署 | 云主机 / Docker / PaaS（需常驻进程 + 可写文件系统，非纯静态站）；`.npmrc` ignore-scripts 免编译工具链 |

```
浏览器 ──HTTP──▶ Express(server.js) ──▶ protocol.js（REST 数据 + WS 消息路由）
   │                  │                        │
   └──WebSocket──▶    └── rooms.js（对局状态机·内存）──▶ storage.js（SQLite 持久层）
                                        │
                              tournaments.js / ratings.js / records.js / auth.js / accounts.js
```

**核心不变量**：
- **对局状态（房间）只在内存**，SQLite 只存"落盘数据"（棋谱/评级/账号/快照）
- **WebSocket 是唯一实时通道**，房间内所有更新经 `_pushState` 全量推送
- 服务端是唯一权威（走子合法性、判负、棋钟），前端只渲染与发送意图

---

## 2. 目录结构

```
shogiwebapp/
├── server.js            # 入口：Express 路由 + WS 服务器 + 启动时快照恢复
├── package.json         # 依赖清单（better-sqlite3 需 npm install 编译/预编译）
├── src/                 # 服务端（全部 CommonJS）
│   ├── storage.js       # SQLite 存储层（kv/records/sessions/gamesnapshots 表 + 旧 JSON 迁移）
│   ├── backup.js        # SQLite 备份（VACUUM INTO 一致性快照 + 滚动保留 + 完整性校验）
│   ├── rooms.js         # ★ 对局状态机（房间/匹配/棋钟/观战/聊天/快照/幽灵房间清理）— ~1250 行，核心
│   ├── protocol.js      # WS 消息路由 + REST 数据聚合 + 连接/身份管理
│   ├── game.js          # 规则引擎封装（USI 走法、王手过滤、结果判定）
│   ├── coords.js        # USI 坐标 ↔ shogi.js (x,y) 转换
│   ├── records.js       # 棋谱：SQLite 读写 + KIF/CSA 导出 + 复盘/书签/变着 + 检索
│   ├── kif.js           # KIF 解析（导入）
│   ├── ratings.js       # ELO 评级
│   ├── tournaments.js   # 单败淘汰赛事
│   ├── accounts.js      # 账号（scrypt 哈希 + 令牌 + 游客升级迁移）
│   ├── auth.js          # 游客会话（基于 storage kv 的 sessions/*）
│   ├── admin.js         # 管理员鉴权（HMAC 令牌）
│   ├── net.js           # 客户端网络信息：IP/UA 解析 + 反代信任（PLAN §M3）
│   ├── audit.js         # 登录/管理员操作事件日志（kv events/*，PLAN §M3）
│   ├── privacy.js       # 隐私字段出口白名单 stripPrivate/assertNoPrivate（PLAN §M3）
│   └── announcements.js # 系统公告
├── public/              # 前端（静态）
│   ├── *.html           # 9 页面：index/lobby/play/history/gallery/review/tournaments/profile/admin
│   ├── css/             # style.css（全局+响应式）/ board.css / review.css
│   └── js/              # 19 个脚本：settings.js(用户设置中心·须先于 nav.js) api.js(WS封装) nav.js board.js pieces.js(图集配置)
│   │                      piece-kinds.js(棋种映射单一来源+自检)
│   │                      freeboard.js(统一棋盘组件 play/demo-rules/free/review 四模式)
│   │                      play.js(对局页编排) play-clock.js(棋钟·仅 play.html 加载) gallery.js sound.js …
├── scripts/             # e2e-*.js 回归测试（ws 客户端模拟）+ import-kif-batch
├── data/                # 运行时：tdshogi.db（+ 迁移前的 *.bak）
└── agents/MEMORY/       # 开发反思档案（非运行依赖）
```

---

## 3. 数据流

### 3.1 WS 连接生命周期（protocol.js handleConnection）
```
新连接 ?guest=<guestId|accountToken>
  → accounts.verifyToken(token) 解析账号 id（若有）
  → auth.identify(effectiveId)  建立/读取会话（存 sessions 表）
  → clientId = <sessionId>_<时间戳>   （每个连接唯一，同一身份多连接 clientId 不同）
  → 注册 clients/playerRegistry/guestToClient 映射
  → findPendingGame(playerId) 探测未结束对局（仅报告，不绑定）
  → 发送 hello（含 reconnect 探测结果）
  → 客户端随后发 request_state / spectate / join_tournament_match 决定绑定方式
```

**关键区分**（第 6 章详述）：同身份（同 guestId）多连接并存是合法场景
（同一浏览器多窗口），身份 ≠ 连接。

### 3.2 对局流程
```
建房(create_room) → 房间 WAITING → 加入(join_room) → _startGame → PLAYING
   → 走子(move) → game.applyMove → _pushState(全量推三方) → clock tick
   → 结束(将死/投了/超时/离开) → _checkGameOver → _finalize（ELO+存棋谱+赛事推进）
   → FINISHED → rematch（双方投票）或 leave
```

### 3.3 观战
```
spectate(roomId) → 加入 spectatorsByRoom（只读：state 不含 legalMoves）
  → 每步走子经 _pushState 同步 → 离开/断线经 leave/_unbindClient 清理
```

### 3.4 聊天
```
chat{text} → rooms.chat：校验在房间 → 2s/条节流 → _broadcast 房间内所有人
  （玩家/观战者同权，观战者名显示"观众"）
```

---

## 4. 存储层（storage.js / SQLite）

### 4.1 表结构
| 表 | 用途 | 键 |
|---|---|---|
| `kv` | 通用键值：ratings/tournaments/accounts/announcements/admin | key（文件名） |
| `records` | 棋谱：`data` 存整谱 JSON（含书签/评论/变着），另有一组**标量摘要列**（PLAN §Q7-2） | id（主键）；索引 createdAt / playerB / playerW / (pub, createdAt) |
| `sessions` | 游客/账号会话 | id |
| `gamesnapshots` | 进行中对局快照（重启恢复） | roomId |

### 4.2 设计要点
- **兼容层**：`readJson(name)`/`writeJson(name)` 映射到 kv 表——业务模块（ratings/tournaments/accounts 等）几乎零改动；`listJsonByPrefix(prefix)` 按前缀枚举 kv（会话列表的唯一数据源，auth.listSessions 用它）
- **首次启动自动迁移**旧 `data/*.json` 与 `data/records/*.json` 入库，原文件改 `.bak`
- **摘要列检索（PLAN §Q7-2）**：`records` 除 `data`（整谱）外，另存一组标量摘要列
  （`playerB/playerW/nameB/nameW/result/resultDetail/moveCount/opening/pub/...`）+ 索引。
  `listSummaries` / `countSummaries` / `searchRecords` **只读标量列、不解析整谱**——
  旧实现是「拉一批 data → 逐条 `JSON.parse`」，单进程下会同步阻塞主线程（连带卡住对局广播）。
  `opening` 存前 10 手供前缀匹配；仅「走法片段关键词」仍需扫 `data`。
  老库由 `ensureRecordColumns()` + `backfillRecordSummaries()` 自动补列回填（幂等，随 `getDb()` 首次初始化）
- WAL 模式（读写并发友好）+ synchronous=NORMAL

---

## 5. ★ 对局状态机（rooms.js）

### 5.1 房间（Room）对象结构
```js
room = {
  id, code,                    // 房间 id / 6 位房间码
  game: Game实例,              // 规则状态（startSfen/moves/result 可重放恢复）
  players: { b: {clientId, playerId, name, connected}, w: {...} },  // ★ 座位与连接绑定
  status: 'WAITING'|'PLAYING'|'FINISHED',
  type: 'room'|'quick'|'tournament',
  timeControl, clock, byoyomi, curByoyomi, inByoyomi,  // 棋钟
  rated, tournamentId, creatorId, createdAt, lastActiveAt,
  result, resultDetail, recordId,
}
```

### 5.2 RoomManager 的映射表（★ 连接绑定的真相）
| 映射 | 含义 | 何时写入/删除 |
|---|---|---|
| `rooms` (Map) | roomId → room | createRoom/quickMatch/tournament/restoreSnapshots |
| `byCode` | code → roomId | 建房时 |
| `clientToRoom` | clientId → roomId | `_bindClient`（玩家加入/观战/重连） |
| `clientToPlayer` | clientId → {roomId, seat} | `_bindClient`（仅玩家） |
| `playerToClient` | playerId → clientId | `_bindClient`（玩家座位绑定，**单值：同一 playerId 只有一个活跃 clientId**） |
| `spectatorsByRoom` | roomId → Set\<clientId\> | spectate 加入，leave/断线移除 |

**重要**：`playerToClient` 是"playerId → 一个 clientId"的单值映射。同 guestId 多窗口时，
后绑定的窗口会覆盖前一个——这是"选手 ID 变观战者 / 空棋盘"类 bug 的温床（详见第 6 章）。

### 5.3 绑定/解绑核心
- `_bindClient(clientId, roomId, seat)`：写 clientToRoom + clientToPlayer + playerToClient，并清断线计时器
- `_unbindClient(clientId)`：清三个映射；观战者单独清理 spectators；对局中玩家断线启动 60s 判负计时
- `_autoLeaveFinished(clientId)`：当前绑定房间已 FINISHED 则自动解绑（玩家无需手动退出即可再匹配）
- `_autoLeaveAllRooms(playerId, exceptClientId)`：按 playerId 退出名下**所有**其他房间的座位
  （对局中自动认输投了；复盘中移除座位记录并释放演示权）——覆盖已关闭旧连接残留的座位，
  建房/加入/快速匹配三入口绑新房间前调用（幽灵房治理，见 6.2）

### 5.4 状态推送（_pushState）
```
每次走子/时钟/加入/离开 → 对房间内每个 clientId 单独组装 state
  - 玩家：state.seat=座位, isPlayer=true, 含 legalMoves/legalTargetsBySq
  - 观战者：state.seat=null, isPlayer=false, 不含合法走法（信息隔离）
```
state 额外携带：movesKif（日式记谱）、roomType、clock、inByoyomi、result 等。

### 5.5 棋钟
- `_startClock` 每 1s tick；`clock>0` 扣本时；`clock<=0 且 byoyomi>0` 进入读秒（0+10 快棋开局即读秒）
- 读秒耗尽 / 包干本时耗尽 → 判负（時間切れ）
- 走子后对手读秒重置为满 byoyomi（每手独立）

### 5.6 快照与恢复（gamesnapshots）
```
_snapshotAll 每 30s（可配）把 PLAYING/WAITING 房间序列化存表
  - 序列化排除连接态（clientId/spectators），保存 startSfen+moves+时钟+玩家身份
服务器启动 restoreSnapshots()：重建 Game（重放 moves）、重挂玩家（在线则绑定）、恢复棋钟
对局结束 _clearSnapshot（棋谱已落盘 records，无需恢复）
```

---

## 6. ★ 连接身份与绑定（历次 bug 高发区）

### 6.1 三个"身份"概念
| 概念 | 值 | 说明 |
|---|---|---|
| playerId / guestId | 游客 24hex 或账号 id | **业务身份**（对局/评级/棋谱归属） |
| clientId | `playerId_<时间戳>` | **连接身份**（每 WS 连接唯一） |
| seat | 'b' / 'w' | 房间内座位（绑定 playerId） |

### 6.2 已知坑与当前防护
| 场景 | 问题 | 防护 |
|---|---|---|
| 同 guestId 多窗口 | 观战窗口连接曾把玩家座位绑定抢走（空棋盘/ID 顶替） | handleConnection **不自动绑定**，绑定延后到 `request_state`（玩家意图）；观战走 `spectate` 永不触发重连绑定 |
| 页面跳转竞态 | 新连接先于旧 close 到达，`reconnect` 找不到断线座位 | `request_state` 兜底：先 `reconnect`（connected=false）再 `bindToActiveGame`（强制顶替旧 clientId） |
| **掉线后从大厅列表重进变观战** | `spectate()` 回位曾按 `clientToPlayer.get(clientId)`（断线即删）查座位，新连接永远不命中 → 落观战席 | `spectate()` 按 playerId 匹配断线座位回位（含旧连接竞态清理）；lobby 卡片对本局选手不带 `spectate=1`，走 request_state 路径 |
| **幽灵房（重新匹配进旧对局）** | ① 回位扫描按 Map 插入顺序取第一个断线座位，旧复盘中房间排前劫持新连接；② 旧连接残留的座位只按当前 clientId 查，既有自动退出覆盖不到 | ① `request_state` 带 URL roomId，`reconnect`/`bindToActiveGame` 优先绑定该房间且不再兜底绑其他复盘中房间；② `_autoLeaveAllRooms` 三入口（建房/加入/匹配）绑新房间前按 playerId 清空名下旧座位 |
| 对局结束残留 | clientToRoom 残留导致误报"已在房间中" | `_autoLeaveFinished` 三入口（match/create/join）自动解绑 FINISHED 房间 |
| 观战者残留 | 离开/断线后仍在 spectators 收广播 | `leave`/`_unbindClient` 显式清理 spectatorsByRoom |
| 断线判负 | 断线方永不判负、对手干等 | 60s 宽限期计时（`_scheduleDisconnectLoss`），重连清除 |

### 6.3 当前绑定时序（修复后）
```
玩家窗口刷新：
  新连接 → hello（findPendingGame 探测 ok）
  → 前端 play.js open 后发 request_state（带 URL 里的 roomId）
  → 服务端：getRoomStateForClient 无绑定
     → reconnect()（优先 URL 指定房间；座位 connected=false？绑定）
     → 否则 bindToActiveGame()（同优先级；强制顶替旧 clientId）
     ※ 带 roomId 时两步都不再兜底绑到其他「复盘中」房间（幽灵房防护）
  → 玩家恢复对局
观战窗口（同 guestId）：
  新连接 → hello（探测到对局，但只报告）
  → 前端带 spectate=1 发 spectate → 只加入 spectators，不碰座位
      ※ 但若该 playerId 在此房间有断线座位（掉线重进自己那局）→ 按 playerId 回位到座位
掉线后开新局：
  建房/加入/快速匹配 → _autoLeaveAllRooms(playerId) 先清空名下旧座位
  → 旧房间不再出现在回位扫描里（幽灵房根治）
```

---

## 7. 前端架构

### 7.1 页面与职责
| 页面 | 职责 |
|---|---|
| index.html | 首页：公告/排行/数据条/三步引导/最新战报/规则速查（PLAN §A） |
| lobby.html | 建房/加入/快速匹配三卡 + 观战列表 |
| play.html | 对局页（对战+观战+聊天+音效+断线提示；终局自动切感想战模式，同页同组件） |
| history.html | 棋谱检索 + 列表 |
| gallery.html | **棋谱广场**（PLAN §L）：公开棋谱列表（筛选/分页），点击进复盘 |
| review.html | 复盘器（书签/评论/变着） |
| tournaments.html | 赛事：我要创建赛事（登录门槛）+ 进行中/往期列表（审核流见 PLAN §B） |
| profile.html | 账号（注册/登录/登出）+ 战绩 |
| admin.html | 管理后台（全部棋谱/用户/KIF 导入；增强设计见 PLAN §C） |

每页的布局区块、行为细节与数据源见 `UI-PAGES.md`。

### 7.2 play.js 关键逻辑
- `api.on('open')` → `enterRoom()`：按 URL 参数分支——`spectate=1` 观战 / `join=1` 赛事 / 否则 `request_state`（重连）
- `state` 消息全量渲染：棋盘 / 持驹 / 走子列表（日式记谱 movesKif）/ 棋钟 / 音效
- 走子音效：`moves.length > prevMoves` 且棋子数减少 → 吃子音，否则落子音
- **棋钟已抽到 `play-clock.js`（PLAN §M5 第 1 步）**：`play.js` 只做依赖注入
  `PlayClock.init({ getState, getViewpoint })`，并在 `state` 消息里调 `resetTick()`、
  在 `clock` 消息里调 `syncFromServer(data)`。读秒音效（`sec<=10` 跨秒触发 `playByoyomi`）
  与 tick 循环都在 `play-clock.js` 内
- 视角口径统一：`PlayClock.init({ getViewpoint: () => currentViewpoint() })`，与棋盘**共用同一函数**
  ——观战者切视角时棋钟同步换边（此前各自算视角，出现过"棋盘翻、棋钟不翻"，2026-09-10 修复）
- `advance(dtMs)` 独立导出：时间扣减可**脱离定时器**单测（`tests/play-clock.test.js` 12 项）
- `replaced` 消息：同身份别处登录 → toast 提示 + 禁用棋盘

### 7.3 棋盘组件与「看棋谱」的渲染路径

`freeboard.js` 的 `FreeBoard` 是全站统一的棋盘交互组件，**四种模式**（2026-09-08 起）：

| 模式 | 用途 | 交互 |
|---|---|---|
| `play` | 对战 | 高亮服务端合法落点，`onMove(usi)` 交页面发送 |
| `demo-rules` | 感想战 | 按规则推演，本地乐观渲染 + 服务端校验 |
| `free` | 自由摆棋 | 不校验规则，本地草稿（撤销/双击升变） |
| `review` | **复盘浏览** | 只读：不可选子/不可拖，自动带上一步与王手高亮，点击回执 `onSqClick` |

内部统一处理：合法目标高亮、升变弹层、拖拽行棋（Pointer Events，触屏阈值更宽）、
持驹渲染、视角镜像、`setCheck()` 王手高亮、`setLastMove()` 上一步高亮。

**统一后的调用路径（PLAN §M6 已收口）**

| 页面 | 棋盘渲染 |
|---|---|
| `play.html` | FreeBoard（`play` / 终局 `demo-rules`） |
| `review.html` 浏览 | FreeBoard（`review` 只读模式） |
| `review.html` 自由摆放 | **同一个实例**切 `free` 模式（不再 destroy/new） |
| history / gallery / admin 回放 | 跳转 `review.html` → 同上 |

- **棋种映射单一来源**：`js/piece-kinds.js`（PROMOTE/DEMOTE/DROP_NAME/NAME_TO_KEY），
  `board.js` 与 `freeboard.js` 都引用它；加载时 `validate()` 自检互逆——
  §J3「吃馬却多出飞车」就是映射表写错一个字，现在这类错误会在控制台立刻报错。
- 相关修复：§J2（王手高亮）通过 `setCheck()` 解决。

### 7.4 音效（sound.js）
Web Audio API 程序化合成（零素材）：落子/吃子/读秒/开局/结束；首次 pointerdown 解锁 AudioContext；
开关持久化交由 `Settings`（PLAN §S1，键 `tdshogi_settings.sound`）——`setEnabled` 转调 `Settings.set`，
`applyEnabled` 供 `Settings.apply` 回调同步内部状态（**不可互相回调，否则递归**）。

### 7.5 用户设置（settings.js，PLAN §S1）
- 单一 localStorage 键 `tdshogi_settings`；旧键 `tdshogi_theme` / `tdshogi_sound` 首次读取时迁移（不删旧键）
- `SCHEMA` 是设置项的**唯一描述**，⚙️ 面板据其渲染；新增设置项只改 `SCHEMA` + `DEFAULTS` + 相应消费者
- 单向数据流：`set()` → 持久化 + `apply()` + `subscribe` 广播；订阅方（nav/sound/board/play/review）各自应用
- 面板 DOM 与样式**动态注入**，无需修改任何 HTML 结构；9 个页面只需在 `nav.js` 之前引入该脚本

---

## 8. 测试体系（scripts/）

| 脚本 | 覆盖 | 断言数 |
|---|---|---|
| e2e-test.js | 建房/加入/走子同步/观战隔离/断线重连/竞态/匹配/幽灵房间防护/同身份占用防护 | 47 |
| e2e-account.js | 注册/登录/令牌/WS 身份/游客升级迁移 | 15 |
| e2e-profile.js | 个人资料读写/手机号私密边界/玩家信息卡/state 携带 id | 17 |
| e2e-tournament.js | 账号创建→审核→报名→开赛→晋级→决赛→冠军 | 15 |
| e2e-tournament-admin.js | 赛事管理台：游客拒/待审核隐藏/403/审核/拒绝/取消解散/幂等 | 19 |
| e2e-snapshot.js | 快照落盘→杀进程→重启→续局 + 恢复局治理（WAITING 不复活/60s 自愈） | 16 |
| e2e-chat.js | 三方聊天/身份/节流 | 7 |
| e2e-spectator-identity.js | 观战不顶替玩家（含同 guestId） | 6 |
| e2e-timecontrol.js | 0+10 快棋：开局即读秒/重置/超时判负 | 10 |
| e2e-freeboard.js | 感想战：终局初始化/权限矩阵/规则校验/分支/KIF/清理改版 | 39 |
| test-spectate-rejoin.js | 掉线后经 spectate 入口按 playerId 回位 + 对照组（纯观众/多窗口） | 15 |

全量合计 **179 项**（2026-08-29 实测通过；其后 v1.2.0 批次新增后两项，改动当日主套件 48/39/6 通过，详见 PLAN §I）。

**统一模式**：ws 客户端模拟多端 + "队列+wait（取最新匹配）" + `process.exit` 强制收尾。
运行：先起服务器（`PORT=3999 DATA_DIR=独立目录`），再 `node scripts/e2e-*.js`。

### 8.1 单元测试（`tests/`，PLAN §P1）

- 运行：`npm test`（等价 `node --test tests/*.test.js`）
  ——**Windows 下不能写 `node --test tests/`**，Node 会把目录当模块解析并报 MODULE_NOT_FOUND
- 定位：纯函数与纯数据，**不起服、不连数据库**；涉及 storage 的用例用临时 `DATA_DIR` 并在收尾清理
- 浏览器侧模块（IIFE 挂 `window`）在 Node 中的加载方式：
  ```js
  globalThis.window = { renderHands: () => {} };      // 最小替身
  require('../public/js/piece-kinds.js');
  require('../public/js/freeboard.js');
  ```
- 当前覆盖（**39 项**，2026-09-10）：
  - `tests/piece-kinds.test.js`：映射互逆自检、成駒还原（含「吃馬得角」回归）、别名杏/圭/全、打子符号双向、NAME_TO_KEY 全覆盖
  - `tests/freeboard.test.js`：坐标换算、初始盘面 40 枚、走子、升变、吃子进驹台、打子扣减与归零移除、§R1 视角切换（配色交换 / 清选中）
  - `tests/game.test.js`（2026-09-10 新增 19 项）：初始局面、坐标映射、**开局合法着法 = 30**、走子、非法着法拒绝、
    打子无持驹拒绝、升变区与升变执行、**王手放置禁止**、吃子进驹台、持驹顺序、认输、SFEN 解析，
    以及**规则边界 5 项**（困毙判负 / 歩与桂强制升变 / 普通千日手判和 / 连续王手千日手判王手方负）
    —— 这 5 项由用户 2026-09-10 拍板后实现（见 PLAN「§P1 规则边界修正」）。
    仍待实现：持将棋点数判定（入玉宣言法 24 点）
- 静态检查：`npm run lint`（eslint 扁平配置，分 Node / 浏览器两套 globals；`no-undef` 已在首跑抓出
  `play.js` 的隐式全局 `freeMode` 等 18 个 error）；CI 见 `.github/workflows/ci.yml`
- 扩充优先级：`records.js` KIF/CSA 与评论 → `coords.js` → `privacy.js` / `net.js` / `ratelimit.js`

---

## 9. 部署与运维

- 环境变量：`PORT` / `DATA_DIR` / `ADMIN_PASSWORD`（未配置时内置密码 `Cplusplus123`）/ `ADMIN_SECRET`（未配置时从管理密码派生）/ `SESSION_SECRET` / `SNAPSHOT_INTERVAL_MS`
- 网络与审计（PLAN §M3）：`TRUST_PROXY`（反代层数，`0`|`1`|`true`；**未配置时不信任 XFF**，直连部署保持默认即可）/ `AUDIT_MAX_EVENTS`（默认 5000）/ `AUDIT_RETENTION_DAYS`（默认 90）
- 后台入口（PLAN §J5）：`ADMIN_ENTRY_KEY`（可选；设置后 `/admin.html` 须带 `?k=<key>`，否则 404。导航 🛡️ 入口仅本机持有 admin token 时显示）
- 速率限制（PLAN §Q7）：`RATE_LIMIT_DISABLED=1` 关闭全部限流（本地压测/排障用）；`RATE_LIMIT_DEBUG=1` 打印过期桶清理日志。限流键为 `clientIp`，**遵守 `TRUST_PROXY`**
- 依赖安装：仓库 `.npmrc` 设了 `ignore-scripts=true`（better-sqlite3 v13 走 tarball 内置预编译，无需任何 C++ 工具链；排障见 DEPLOY.md）
- 数据：单文件 `data/tdshogi.db`（备份 = 复制该文件；迁移前旧文件为 .bak）
- 常驻：PM2 / systemd / Docker；WebSocket 需 Nginx 反代 `Upgrade` 头
- 详见 `DEPLOY.md`

---

## 10. 已知边界与演进方向

- **单进程局限**：对局状态在内存，横向扩展需 Redis 外置（当前快照恢复覆盖"重启不丢局"）
- **安全**：~~`/api/history?player=` 越权（游客体系无密码，id 可枚举）~~ ✅ 2026-09-10 已修（PLAN §Q7）：
  `/api/history` 已收归管理员专用，用户的棋谱检索改走 WS `record_search`（连接握手时绑定的身份强制过滤，
  客户端传 playerId 也无效）；`/api/records/search` 的非管理员分支要求可验证的账号令牌。
  仍待处理：接口速率限制、会话令牌存 localStorage（XSS 面）
- **玩法缺口**：无 AI 对战、无駒落ち（让子）、无 i18n（仅中文界面）
- **性能**：每步 `_pushState` 全量推状态，长对局/多观战者时带宽随人数线性增长（可优化为增量推送）
