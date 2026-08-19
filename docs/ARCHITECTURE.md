# TDShogi 程序架构文档

> 版本：v2（2026-08）· 覆盖：SQLite 存储、对局快照恢复、观战聊天、棋谱检索、账号系统
> 本文是排障与二次开发的地图——尤其第 5、6 章（对局状态机、连接与绑定）是历次 bug 的高发区。

---

## 1. 系统概览

| 维度 | 说明 |
|---|---|
| 形态 | **单进程 Node.js 常驻服务**（Express REST + ws WebSocket 同端口） |
| 运行时 | Node 18+（实测 24），npm 依赖：express / ws / shogi.js / better-sqlite3 |
| 数据 | 单一 SQLite 库 `data/tdshogi.db`（WAL 模式），零外部服务 |
| 前端 | 原生 JS + 程序化 SVG/PNG 棋子，无构建步骤 |
| 规则引擎 | shogi.js（走法生成）+ `src/game.js`（王手过滤/升变/判定封装） |
| 部署 | 云主机 / Docker / PaaS（需常驻进程 + 可写文件系统，非纯静态站） |

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
│   ├── rooms.js         # ★ 对局状态机（房间/匹配/棋钟/观战/聊天/快照）— 1025 行，核心
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
│   └── announcements.js # 系统公告
├── public/              # 前端（静态）
│   ├── *.html           # 8 页面：index/lobby/play/history/review/tournaments/profile/admin
│   ├── css/             # style.css（全局+响应式）/ board.css / review.css
│   └── js/              # api.js(WS封装) nav.js board.js pieces.js play.js sound.js …
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
| `records` | 棋谱（含书签/评论/变着 JSON） | id，索引 createdAt |
| `sessions` | 游客/账号会话 | id |
| `gamesnapshots` | 进行中对局快照（重启恢复） | roomId |

### 4.2 设计要点
- **兼容层**：`readJson(name)`/`writeJson(name)` 映射到 kv 表——业务模块（ratings/tournaments/accounts 等）几乎零改动
- **首次启动自动迁移**旧 `data/*.json` 与 `data/records/*.json` 入库，原文件改 `.bak`
- **JSON 函数检索**：`searchRecords` 用 SQLite `json_extract`/`json_array_length` 实现条件组合查询（开局/手数/结果/关键词）
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
| 页面跳转竞态 | 新连接先于旧 close 到达，`reconnect` 找不到断线座位 | `request_state` 兜底：先 `reconnect`（connected=false）再 `bindToActiveGame`（强制顶替） |
| 对局结束残留 | clientToRoom 残留导致误报"已在房间中" | `_autoLeaveFinished` 三入口（match/create/join）自动解绑 FINISHED 房间 |
| 观战者残留 | 离开/断线后仍在 spectators 收广播 | `leave`/`_unbindClient` 显式清理 spectatorsByRoom |
| 断线判负 | 断线方永不判负、对手干等 | 60s 宽限期计时（`_scheduleDisconnectLoss`），重连清除 |

### 6.3 当前绑定时序（修复后）
```
玩家窗口刷新：
  新连接 → hello（findPendingGame 探测 ok）
  → 前端 play.js open 后发 request_state
  → 服务端：getRoomStateForClient 无绑定
     → reconnect()（座位 connected=false？绑定）
     → 否则 bindToActiveGame()（强制顶替旧 clientId）
  → 玩家恢复对局
观战窗口（同 guestId）：
  新连接 → hello（探测到对局，但只报告）
  → 前端带 spectate=1 发 spectate → 只加入 spectators，不碰座位
```

---

## 7. 前端架构

### 7.1 页面与职责
| 页面 | 职责 |
|---|---|
| index.html | 首页：公告/排行/进行中对局/随机观战 |
| lobby.html | 建房/加入/快速匹配/观战列表 |
| play.html | 对局页（对战+观战+聊天+音效） |
| history.html | 棋谱检索 + 列表 |
| review.html | 复盘器（书签/评论/变着） |
| tournaments.html | 赛事创建/报名/对阵表 |
| profile.html | 账号（注册/登录/登出）+ 战绩 |
| admin.html | 管理后台（全部棋谱/用户/KIF 导入） |

### 7.2 play.js 关键逻辑
- `api.on('open')` → `enterRoom()`：按 URL 参数分支——`spectate=1` 观战 / `join=1` 赛事 / 否则 `request_state`（重连）
- `state` 消息全量渲染：棋盘 / 持驹 / 走子列表（日式记谱 movesKif）/ 棋钟 / 音效
- 走子音效：`moves.length > prevMoves` 且棋子数减少 → 吃子音，否则落子音
- 读秒音效：`inByoyomi[turn] && sec<=10` 跨秒触发 playByoyomi
- `replaced` 消息：同身份别处登录 → toast 提示 + 禁用棋盘

### 7.3 音效（sound.js）
Web Audio API 程序化合成（零素材）：落子/吃子/读秒/开局/结束；首次 pointerdown 解锁 AudioContext；开关持久化 localStorage。

---

## 8. 测试体系（scripts/）

| 脚本 | 覆盖 | 断言数 |
|---|---|---|
| e2e-test.js | 建房/加入/走子同步/观战隔离/观战离开/断线重连/竞态/匹配/结束残留 | 44 |
| e2e-account.js | 注册/登录/令牌/WS 身份/游客升级迁移 | 15 |
| e2e-tournament.js | 报名→开赛→晋级→决赛→冠军 | 13 |
| e2e-snapshot.js | 快照落盘→杀进程→重启→双方重连续局 | 9 |
| e2e-chat.js | 三方聊天/身份/节流 | 7 |
| e2e-spectator-identity.js | 观战不顶替玩家（含同 guestId） | 6 |
| e2e-timecontrol.js | 0+10 快棋：开局即读秒/重置/超时判负 | 10 |

**统一模式**：ws 客户端模拟多端 + "队列+wait（取最新匹配）" + `process.exit` 强制收尾。
运行：先起服务器（`PORT=3999 DATA_DIR=独立目录`），再 `node scripts/e2e-*.js`。

---

## 9. 部署与运维

- 环境变量：`PORT` / `DATA_DIR` / `ADMIN_PASSWORD` / `ADMIN_SECRET` / `SESSION_SECRET` / `SNAPSHOT_INTERVAL_MS`
- 数据：单文件 `data/tdshogi.db`（备份 = 复制该文件；迁移前旧文件为 .bak）
- 常驻：PM2 / systemd / Docker；WebSocket 需 Nginx 反代 `Upgrade` 头
- 详见 `DEPLOY.md`

---

## 10. 已知边界与演进方向

- **单进程局限**：对局状态在内存，横向扩展需 Redis 外置（当前快照恢复覆盖"重启不丢局"）
- **安全**：`/api/history?player=` 越权（游客体系无密码，id 可枚举）仍未修；会话令牌存 localStorage（XSS 风险）
- **玩法缺口**：无 AI 对战、无駒落ち（让子）、无 i18n（仅中文界面）
- **性能**：每步 `_pushState` 全量推状态，长对局/多观战者时带宽随人数线性增长（可优化为增量推送）
