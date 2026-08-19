# REFLECTIONS — TDShogi 优化任务

## 2026-08 双端/观战 bug 修复 + UI 优化（round 1）

- 结果：e2e 34/34 通过；修复服务端 4 bug（观战残留、认输/离开判负方向、CSA 打子盘面不推进、断线宽限未实现）+ 前端 2 bug（首页观战入口缺 spectate=1、观战断线重连黑屏）。
- 原因：先静态评审（找到 8 项）但真实根因只有实测才能暴露——用 ws 客户端写 e2e 逐路径验证，快速定位；测试脚本自身时序错误（wait 消费 vs 队列残留）也造成过误报，需用"最新 state 跟踪"而非消息消费。
- 对策：e2e 测试脚本 `scripts/e2e-test.js` 保留为回归资产（建房/加入/走子/观战/重连/匹配全覆盖）；UI 改动遵循"宁简勿繁"（棋盘 --cell-size 响应式、日式记谱 movesKif、favicon、字体栈降级）。

## 2026-08 赛事功能修复（round 2）

- 结果：赛事全流程打通，e2e-tournament.js 13/13 通过（报名→满员开赛→首轮自动建房→认输结束→胜者晋级→决赛→冠军）。
- 原因：根因两个——`assignNextMatches` 是空函数（对局永不创建）；`_finalize` 把 winnerId 计算包在 `room.rated` 条件内，赛事房间 rated:false 导致 `onMatchFinished` 永不触发。修复用注入 matchFactory 模式避免 tournaments↔rooms 循环依赖。
- 对策：新增 `scripts/e2e-tournament.js` 回归资产；赛事对局计 ELO 隔离（rated:false）+ 前端隐藏再来一局、退出回赛事页；admin 默认密码加启动警告。

## 2026-08 账号系统（round 3）

- 结果：完整账号系统交付，e2e-account.js 15/15 通过（注册/重名/短名/登录/错误密码/令牌校验/WS 身份/游客升级迁移/登出）。
- 原因：需求"注册账号"但项目是游客免注册设计——选择延续 JSON 存储零依赖方案：scrypt 加盐哈希 + HMAC 会话令牌（30 天），游客升级时迁移 ratings/records/session 到账号 id。
- 对策：三个关键决策——会话令牌直接作为 WS guestId 复用现有链路（protocol 层 verifyToken→accountId）；游客升级保留原 id 数据迁移而非新建；测试教训：监听器在消息到达后注册会漏消息，统一用"队列+wait"模式（e2e-test/e2e-tournament/e2e-account 三套脚本已统一）。

## 2026-08 双端跳转竞态（round 4，用户报障）

- 结果：复现并修复「加入房间后其中一个页面空棋盘、时钟不动」：request_state 兜底绑定（bindToActiveGame），主 e2e 37/37 通过。
- 原因：双端从大厅被 game_start 跳转 play.html 时，新 WS 连接可能先于旧连接 close 到达服务端——reconnect() 只找 connected=false 的座位故失败，新连接无房间绑定，request_state 返回 null，前端 state 恒 null → 棋盘空 + 时钟不走。
- 对策：request_state 无绑定且玩家有进行中对局时按 playerId 强制绑定（顶替旧连接，不依赖 close 时序）；新增 e2e 竞态回归断言（3 项）防复发；复现脚本用「同 guestId 双连接 + 立即 request_state」精确还原用户场景，比纯静态推理可靠。

## 2026-08 打入 bug + rematch 提示 + 棋子渲染（round 5，用户报障）

- 结果：修复打入无效（legaltargets 打子符号判断用错映射表）、棋子渲染偏离格心/被裁剪（background-size 用原始像素而 div 只有 44-56px）；新增 rematch 请求提示；主 e2e 41/41 通过。
- 原因：两个映射表——RAW_TO_DROP 的 key 是 kind（'FU'）而前端点击驹台传的是打子符号（'P'），`from in RAW_TO_DROP` 恒 false → 打子目标恒空；棋子图 512×256 每格 64px 但 background-size 用原大 + position 用 64px 偏移，显示窗口 44-56px 只露出格子左上部分。
- 对策：legalTargets 改用 DROP_TO_KIND（符号→kind）判断；pieceHTML 让 background-size 与 position 都按显示尺寸缩放（8×size 宽 + size 步长偏移）→ 每格完整居中；rematch 一方投票即给对手发 rematch_requested（前端 toast + 按钮 pulse 高亮）；打入/rematch 均固化为 e2e 断言（4 项）。

## 2026-08 对局结束残留绑定（round 6，用户报障）

- 结果：修复「赢棋后对手退出，赢家不退出直接再匹配报'你已在房间中'」：quickMatch/createRoom/joinRoom 三入口自动解绑已结束房间（_autoLeaveFinished），主 e2e 43/43 通过。
- 原因：clientToRoom 绑定在房间 FINISHED 后不清理，而 quickMatch 只检查 clientToRoom 是否有值、不区分房间状态 → 结束房间的玩家误报"已在对局中"。
- 对策：新增 _autoLeaveFinished——若当前绑定房间已 FINISHED 则清座位+解绑（玩家无需手动退出）；三处入口调用；固化为 e2e 断言（不退出再匹配 + 不退出再建房 2 项）；教训：调试时 server-dbg.log 追加式重定向 + 多个临时验证脚本叠加曾造成"假复现"，务必用干净重启 + 单一最小脚本确认根因。

## 2026-08 三项体验优化（round 7）

- 结果：导出文件名含选手+日期（RFC 5987 编码）、admin 界面加搜索与回放/导出带 token、程序化音效（落子/吃子/读秒/开始/结束），主 e2e 44/44 通过。
- 原因：导出文件名原本只是 id；admin 回放/导出按钮未带 adminToken 导致 403（"管理员看不了自己棋谱"的直接根因）；项目零外部素材，音效用 Web Audio API 实时合成（噪声冲击+频率衰减模拟木质敲击）。
- 对策：server.js Content-Disposition 用 filename* 双轨（ASCII 兜底 + UTF-8 编码）；admin 列表加按名字/ID 搜索 + adminPlayback/adminExport 带 token + review.js 支持 adminToken 参数；新增 public/js/sound.js（懒初始化 AudioContext 符合自动播放策略，首次点击解锁，音效开关持久化）；教训：headless 浏览器验证音效时 hook 注入与页面时序竞争会造成假阴性，改用页面内 console 调试标记确认触发（真实对局 console 出现 move detected 0->1 即为证）。

## 2026-08 0+10 快棋修复（round 8，用户报障）

- 结果：修复「10 秒快棋无读秒音效 + 时间设置错误」：10sec 从"10 秒包干"改为"0+10 每手读秒"（main=0, byoyomi=10s），棋钟支持 main=0 开局即读秒，e2e-timecontrol.js 10/10 通过。
- 原因：原配置 main=10s, byoyomi=0（10 秒总包干）——本时用尽直接判负，永不进入读秒状态，读秒音效自然不触发；且 _tick 的 `if (clock>0)` 分支在 main=0 时永远不执行、`else if (inByoyomi)` 初始 false → 时钟完全不走。
- 对策：TIME_CONTROLS 改 0+10；新增 initClockState() 统一三处建房 + rematch 的时钟初始化（main<=0 且 byoyomi>0 → 开局 inByoyomi=true）；_tick 重构为 `else if (byoyomi>0)` 覆盖 main=0 场景（含未标记读秒时自动进入）；浏览器实测 10 秒倒数每秒触发 playByoyomi（A 9 次/B 7 次）；教训：验证"读秒重置/超时耗时"类断言要留意 tick 相位（首条 clock 可能读到 10000 或 9000、超时 9.5-10.5s 波动），断言区间放宽避免假失败。








## 2026-08 底层架构四层（round 9，用户指定 6→5→10→4）

- 结果：从底往上完成四层——SQLite 存储（storage.js 改 better-sqlite3，兼容接口 + 旧 JSON 自动迁移）、对局快照重启恢复（gamesnapshots 表 + restoreSnapshots，杀进程重启双方可续局）、棋谱检索（SQLite JSON 函数组合条件 + 前端检索栏）、观战聊天（房间广播 + 节流）。全量回归 81 项通过（44+15+13+9），另 chat 7/7。
- 原因：用户明确"从底层往上层做"——先存储（一切数据能力的地基）→ 再恢复（对局可靠性）→ 检索（依赖 SQLite 查询）→ 聊天（纯增量）。SQLite 选 better-sqlite3 而非 node:sqlite（后者实验性有警告）；兼容层设计让业务模块近乎零改动。
- 对策：每个提交独立（store/recovery/search/chat 4 个 commit），回归资产新增 e2e-snapshot.js（9 项）+ e2e-chat.js（7 项）；教训——e2e-snapshot 首次"假失败"根因是残留 node 服务器进程污染快照表（playing=3 而非 1），排查顺序应是"先查有没有多余进程"再怀疑功能；timecontrol 偶发 8/10 是服务器被前序测试拖慢的 tick 波动，单独跑即 10/10。
