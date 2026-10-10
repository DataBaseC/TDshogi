# BUG 报告：P1-1 修复后 `e2e-test.js`「同身份占用防护」失败

> ✅ **已解决（2026-09-23）**，根因与本报告第六节的猜测 1 一致：
> `protocol.js` 的 clientId 后缀是**毫秒级时间戳**，同一 guestId 的两条连接（G1/G1b）
> 在同一毫秒内握手会生成**完全相同的 clientId**，后到的连接覆盖先到的
> `clients`/`playerRegistry` 注册 → 先到的连接（G1）此后收不到任何回执
> （回执全发到后者的 socket 上），表现为"请求被静默丢弃"。实测碰撞率约 1/3（21/60），
> 这也是该段**历史抖动**的根源。修复：clientId 追加进程内自增序号（`_connSeq`）。
> 生命周期侧按第二节的三段式落地；`e2e-lobby-ops.js` 已接回 `e2e-all.js`（17 脚本 / 265 断言全绿）。

> 交接文档。仓库：`D:\Ai\CodeBuddy\shogiwebapp`（源码仓库 `DataBaseC/TDShogi`）。
> 当前版本 **v1.4.5**，工作区干净，`npm test` / `npm run lint` / `npm run e2e` **全绿**
> （单测 244、lint 0 error、e2e 16 脚本 252 断言）—— **本 bug 只在应用下面那份修复后才会出现**。
> 相关计划：`docs/ROADMAP.md` §2「批次 13」的 **13a**（本报告即为它的现场记录）。

---

## 一、要修的功能（P1-1：重复请求不能把当前对局判负）

来源：外部安全审查 `docs/TDShogi-review-report.html` P1-1。

`src/rooms/lifecycle.js` 的 `joinRoom()` / `quickMatch()` **一上来就**
`this._autoResignAndLeave(player.clientId)` —— **先把自己判负，再去校验目标**。
于是下面三种"重复 / 必然失败"的请求都会把**当前对局判负**（对手立刻收到 `game_over detail=投了`）：

1. 对局中重复发 `join_room`（同一个房间码）；
2. 双击 `quick_match`（第二下）；
3. `join_room` 输错房间码再试。

产品决定（用户）：**重复请求 = no-op**；当前对局必须分毫不动，只回一条 `error`。

## 二、失败的接口（我改成下面这样之后）

思路上把两个函数改成**三段式**：

```
① 非破坏性校验（目标存在 / 不是自己的房 / 密码对 / 不是同一个房 / 未开赛 / 未满）
   ↓ 全部通过才继续
② 才动当前状态（_autoLeaveFinished / _autoResignAndLeave / _autoLeaveAllRooms / _abandonRestoredFor）
   ↓
③ 落座 / 入队
```

要点：

- `joinRoom`：目标不存在、密码错、**已在同一房**、已开赛、已满 → **一律在校验阶段返回**，
  绝不再走"先认输"那条路；`PLAYING` 时返回「你正在对局中，请先结束当前对局」。
- `quickMatch`：**只拦 `PLAYING`**（`curBefore.status === 'PLAYING'` → 拒绝）；
  等待房照旧"销毁旧房再匹配"；
  ⚠️ **不能**写成"状态不是 WAITING 就拒绝"——那会把既有的
  「一局结束后不退出、直接再匹配」也挡掉（`e2e-test.js` 立刻抓到，见用例名
  「对局结束后不退出可直接再次匹配」）。

### ⚠️ 已证伪的做法，别再试

**不要**加"N 秒内算重复"的**时间窗**（`_lastLobbyAction` + `2 秒`那种）。
实测会误伤合法快速操作：「匹配 → 立刻认输 → 再匹配」完全可能落在 2 秒内，
`e2e-test.js`「对局结束后不退出可直接再次匹配」当场挂掉。

## 三、Bug 症状

应用上述改动后，`npm run e2e` 结果从

```
16 脚本 · 断言 252 通过 / 0 失败
```

变成

```
17 脚本 · 断言 217 通过 / 0 失败 + 1 个脚本退出码 1
未通过：- e2e-test.js
   测试异常: G1 等待 room_created 超时（已收到: hello）
```

即 `scripts/e2e-test.js` 在 **「同身份占用防护」段的第一个动作** 上死掉：

```js
// scripts/e2e-test.js:333-341
// ===== 同身份占用防护（同一 guestId 双连接）=====
console.log('\n=== 同身份占用防护 ===');
const sameId = gid();
const G1  = new Client('G1',  sameId);
const G1b = new Client('G1b', sameId); // 同一身份的第二连接（模拟同浏览器双标签）
await G1.connect(); await G1b.connect(); await T(250);
G1.send('create_room', {});
const gRoom = await G1.wait('room_created');   // ← 卡在这里：G1 什么回执都没收到
```

**关键观察**：

- `G1` 连上并收到过 `hello`，之后 `create_room` **既无 `room_created`、也无 `error`** —— 请求像被静默丢弃；
- **服务端没有任何异常**（连 v1.4.5 新加的 `process.on('uncaughtException')` 兜底也没记到东西）；
- 该段之前的用例全部通过（含 D/E 的"对局中建房自动认输"与"结束后直接建房"）。

**这段之前的用例（同文件 311–331 行，均已通过）**：

```js
F.send('quick_match'); D.send('quick_match');
... ok(dMatched && fMatched, '对局结束后不退出可直接再次匹配');
D.send('create_room', {});                 // 对局中建房 = 自动认输退出旧局并创建新房间
E.send('create_room', {});                 // 对局结束后不退出可直接建房
```

## 四、复现步骤

```powershell
# 1) 按第二节把 src/rooms/lifecycle.js 改成三段式
# 2) 起一个隔离实例
$env:PORT='3999'; $env:DATA_DIR="$env:TEMP\e2e-dbg"; $env:ADMIN_PASSWORD='admin123'
node server.js
# 3) 单独跑该脚本（比跑全量快得多）
node scripts/e2e-test.js
```

⚠️ 若不改代码直接跑，`e2e-test.js` **是绿的** —— 所以本 bug 与"改动有关"，不是环境问题。

## 五、我做到哪一步 / 已排除什么

| 已做 | 结果 |
|---|---|
| 复现失败的**验收脚本** `scripts/e2e-lobby-ops.js`（13 项：三种重复/失败请求 + 正向对照） | ✅ **改法下 13/13 全过** ⇒ P1-1 本身确实修好了 |
| 单跑 `e2e-test.js`（隔离实例 + 干净 DATA_DIR） | ❌ 稳定复现 `G1 等待 room_created 超时` |
| 查服务端日志（stdout 与 stderr 都翻了） | 无异常、无 `uncaughtException` 记录 |
| 时间窗方案 | ❌ 已证伪（见上） |
| **该做的归属实验**（把 `lifecycle.js` 退回 HEAD 后**连跑 3 次** `e2e-test.js`，看是否偶发） | ⏸ **没跑成**（当时审批超时）—— **建议第一件事就补上**。<br>注意：`e2e-test.js` 历史上出现过**同症状**（`room_created` 等待超时）的抖动记录，所以要先排除"本来就偶发"。 |

## 六、建议的排查方向（未验证，供参考）

1. **同 guestId 双连接的身份/客户端注册**：`G1b` 在同一 `playerId` 下第二次连接时，
   服务端可能把它当作"同一身份的新连接"而**替换/注销了 `G1` 的 client 注册**；
   之后 `G1` 的消息到达时，协议层查不到对应 client 就**静默 return**（无回执、无 error）。
   → 查 `src/protocol.js` 的 `handleConnection()` 与 rooms 侧的 `_bindClient/_unbindClient`、
   `clientToRoom` / `clientToPlayer` / `playerRegistry` 的写入点，看是否存在"同 playerId 覆盖"，
   以及**覆盖后旧 clientId 的消息是否会被丢弃**。
2. `create_room` 分支是否存在**未回消息的 return 路径**（协议层"每条消息都要有出口"的老约定，
   `MEMORY.md` 记过同源历史 bug：某分支没有出口 → 表现为"点了没反应"）。
3. 我改的两个函数**只影响 `join_room` / `quick_match`**，`create_room` 并未改动；
   但三段式里新增的
   `this.clientToRoom.get(player.clientId)` 早退分支、以及把
   `_autoLeaveAllRooms/_abandonRestoredFor` 挪到校验之后，可能**改变了同身份场景下的绑定顺序**。
   → 建议二分：只保留"`quickMatch` 只拦 PLAYING"这一处改动，看 `e2e-test.js` 是否仍然挂；
   再逐步加回 `joinRoom` 的改动定位到具体哪一处。

## 七、验收标准

1. `scripts/e2e-lobby-ops.js` **13/13 全过**（这就是 P1-1 的验收脚本，**已在仓库、刻意未接入**套件）；
2. `npm run e2e` 回到 **全绿**（当前 16 脚本 / 252 断言为基线）；
3. 修好后，把 `e2e-lobby-ops.js` 加回 `scripts/e2e-all.js` 的脚本数组（现在那里有一段注释说明为何暂未接入）；
4. `npm test`（244）与 `npm run lint`（0 error）不得退化。

## 八、环境与项目陷阱（会浪费时间的那些）

1. **本机 safe-delete 钩子**会拦 `fs.rmSync(dir, { recursive: true })` ⇒ 测试里"先删临时目录再重建"会让**整个文件加载失败**；用**唯一目录名**（带 `process.pid`），不删。
2. **单测别 `require('src/http/middleware')` 或 `src/http/context`** ⇒ `new Protocol()` 内含定时器，`node --test` 跑完**不退出**。
3. **`readJson/writeJson` 是 SQLite 的 kv 表，不是磁盘 JSON 文件**；`accounts.getAccount()` 走 `publicInfo`、**不含 `guestId`**。
4. **长命令在本环境会被丢到后台、拿不到 stdout** ⇒ 重定向到文件再读（`npm test > x.log 2>&1`）。
5. `e2e` 需要隔离实例（临时 `DATA_DIR` + `ADMIN_PASSWORD=admin123`）：直接 `npm run e2e` 即可，它会自己拉起、跑完停服。
6. `scripts/_verify-spectate-rejoin.js` 是上一轮遗留的临时脚本（也在被 e2e 跑到），与本案无关。
