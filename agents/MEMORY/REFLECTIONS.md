# REFLECTIONS — TDShogi 优化任务

## 2026-08 感想战 v7：座位回位 + 同步回显 + KIF 对齐标答（round 20，用户实测反馈）

- 结果：修复演示者行棋无反应/观众不自动同步/重进变观战者三连 bug（同根：广播排除发送者 + demo_state 处理器缺失 + 重连跳过 FINISHED），补观众列表/感想战再来一局；KIF 导出对齐 81Dojo 标答（場所/持ち時間/时间列不补零/時間切れ标记）。全量回归 190 项。
- 原因：①「不回发给自己」的优化在客户端改为服务端驱动渲染后成了信息黑洞；②单页重构时事件处理器随旧代码被删、新代码块没有补回——每次重构都要审计事件订阅清单；③座位判定此前散落各处，用户提出「座位结构化」后统一为 playerId→座位 的显式回位规则。
- 对策：①广播一律全员、客户端以服务端回执为唯一事实源（正确性优先于微秒级流量）；②重构后 grep 事件订阅清单（api.on/rooms 广播）核对收发对称；③外部标答文件（81Dojo KIF）逐行对照是格式类需求的最高效验证。

# REFLECTIONS — TDShogi 优化任务

## 2026-08 感想战 v6 定稿：棋盘组件化 + 单页模式 + 拖拽 + 谱时间（round 19，用户实测反馈）

- 结果：FreeBoard 升级为统一棋盘组件（play/demo-rules/free 三模式 + Pointer Events 拖拽行棋），感想战回归对局页内（终局自动切模式），独立 demo 页删除；棋谱每手记录耗时，右列与 KIF 导出带时间。全量回归 187 项全绿。
- 原因：v5 独立页方案在实机暴露绑定丢失/身份显示/聊天缺位等问题——独立页本身没错，但用户要的是「棋盘作为一个可靠的组件，在各个场景以不同模式复用」，且单页跳转少更符合直觉。v3/v4/v5 三轮迭代实为同一个组件抽象没做到位：模式逻辑散在页面里而不是组件里。
- 对策：①交互组件一旦出现「第二处要用」，立即抽组件而不是复制/寄生；②棋盘组件只做规则内交互与渲染，业务（发消息/广播）通过回调上抛；③每手耗时在走子时记录一次（rooms.moveTimes），落盘/展示/导出三处共享，事后补录无法还原。

# REFLECTIONS — TDShogi 优化任务

## 2026-08 实机「按钮全无/点击无反应」——浏览器缓存旧脚本（round 18，用户实测反馈）

- 结果：静态资源改协商缓存（Cache-Control: no-cache），版本错位类问题根除；demo.js turnHint 空值防御。
- 原因：服务进程常驻 + 静态文件实时读盘 = 版本错位高发；express.static 默认 ETag/Last-Modified 强缓存让浏览器继续跑旧脚本——旧 demo.js 缺新元素，新代码中途抛异常，症状是「状态文字更新了但按钮全无」。服务器重启只解决服务端，**浏览器侧的旧脚本要靠缓存策略**。
- 对策：①迭代期静态资源一律 no-cache（上线稳定后再考虑带版本号的强缓存）；②「一半 UI 更新了一半没更新」= 中途抛异常的典型指纹，先查新旧元素差异；③排障三板斧固化为 curl /api/home 的 version 字段 + 强刷指引 + no-cache。

# REFLECTIONS — TDShogi 优化任务

## 2026-08 感想战 v3（按规则行棋）+ 同身份占用防护（round 17，用户实测反馈）

- 结果：感想战重构为「演示者按将棋规则行棋」（服务端 applyMove 校验，推演谱 moves/kif/legals 广播，右列棋谱追加推演手点击跳转，待った/清空推演，✋ 自由摆棋切换为本地草稿）；同身份占用防护三连（快速匹配不配自己/不能加入自己的房间/名下进行中房间拒绝再建房）。全量回归 179 项全绿（e2e-freeboard 27 项）。
- 原因：v2 的「自由行棋=任意摆子」是我对需求的过度设计——用户参考 81Dojo 感想战，主体是规则内推演，自由摆只是附属工具。同身份占用则是共享 localStorage 场景（同浏览器双标签）从没人防过。用户看实机看得比我准：我先做了浏览器「复现」，实际测的仍是同身份自娱对局，被再次点破。
- 对策：①做交互类功能前先找一个同类成熟产品对齐形态（用户点名 81Dojo 就该先翻它）；②「同一身份」的判定要下沉到 playerId（rooms.playerRegistry 注入），任何配对/加入/占位类操作都要过一遍同身份防线；③共享 localStorage 使同浏览器双标签天然同身份，双账号实测必须双浏览器或无痕窗口——测试方案要先跟用户对齐环境。

## 2026-08 实机报障「双方锁死、计时器不动」——幽灵恢复局劫持（round 16，用户报障）

- 结果：定位并修复。根因链：卡死对局被快照以 PLAYING/WAITING 持久化 → 服务器重启 restoreSnapshots 无条件复活（僵尸恢复局，全员 offline 无判负计时，永驻）→ 玩家再开新对局时 request_state 重连兜底按 playerId 把双方绑进同一场死局（新房间反成空房）。快照表实测：桂馬 vs DoBoC 0 手 PLAYING 僵尸局 + 3 场 WAITING。修复：恢复自愈（WAITING 立即销毁；PLAYING 未连接座位 60s 判负，及时重连可续局）+ 入口兜底（建房/加入/匹配放弃名下恢复局）。e2e-snapshot 扩到 16 项，全量回归 150 项。
- 原因（方法论复盘）：①我的首次"复现"用了同浏览器双窗口——同一 localStorage 身份自己和自己下，且我的游客 id 名下没有僵尸局 → 测不出来。用户点破"你测试是自己的账号和自己下"后才逼出忠实复现问题：**复现环境的身份/数据状态必须对齐真实受害者**（僵尸局绑定在他们的 playerId 上）。②排查时用户环境端口被占（EADDRINUSE）恰恰是关键证据——用户自己 npm start 的进程跑着旧代码，代码修复没有生效路径。
- 对策：①凡是"按 playerId 找回对局"的兜底逻辑，必须审问：这个 playerId 名下是否可能存在不该恢复的局（快照恢复局/幽灵局）？②快照恢复必须配对生命周期出口（判负/销毁计时），否则"重启不丢局"变成"僵尸永生"；③本地无法复现时，先枚举"我的环境 vs 受害者环境"的差异清单（身份、数据、进程、端口），逐项对齐再下结论。

## 2026-08 个人资料 + 悬停信息卡（round 15）

- 结果：账号资料（手机号私密/棋风/注册日期）+ 全局悬停信息卡 hovercard.js（data-player-id 事件委托）+ e2e-profile 17 项；全量回归 143 项；浏览器实测注册→存资料→悬停出卡全通。
- 原因（踩坑）：①测试脚本三连挂全是我自己写的裸轮询——`ws.on('message')` 忘挂导致队列永远空、无超时的 `new Promise` 挂死整个套件、收尾引用改名前的变量；对策：**一律复用成熟的 Client 类**（带超时 wait），别在套件里手写裸 WebSocket 轮询。②"令牌 vs accountId"错位已是第三次出现（tournaments isIn、play 底栏、home 排行榜 self）——每次新增按 id 匹配的前端逻辑都要问一句：guest.id 是令牌还是玩家 id？统一 `split('.')[0]` 归一化。
- 对策：私密字段的隐私边界做成"白名单出口"——phone 只存在于 getOwnProfile（本人令牌）与 adminUserData（管理员）两个返回点，公开卡从数据源结构上就不携带，e2e 断言"序列化结果里搜不到号码"兜底。

## 2026-08 赛事管理台一期落地（round 14）

- 结果：B2 创建需正式账号（服务端强制）+ B3 审核状态机（pending_approval/rejected/cancelled）+ admin 四路由 + 「赛事管理」tab + e2e-tournament-admin 19 项；全量回归 126 项全绿；浏览器实测审核流转（待审核→通过→报名中→公共页可见）。
- 原因（踩坑记录）：①测试客户端 `wait()` 先扫历史队列——同一 WS 连接第二次 create_tournament 会立刻拿到上一场的旧响应（id 错位→reject 报「状态已变更」），负向断言同理捞到旧 error；对策：**先注册一次性监听再发送**，或每条负向用例用全新客户端。②rejectTournament 引用了不存在的 `reviewer` 变量——`node --check` 查不出运行时 ReferenceError，**服务端 500 返回 HTML**，测试报"Unexpected token '<'"时直接看服务器日志最快。③REST 注册用户名有 16 字符上限，随机后缀别太长。
- 对策：涉及"同一连接多次发同类消息"的 e2e 一律用 before-send 监听模式；新路由先 curl 一次冒烟再跑套件。

## 2026-08 管理员昵称不显示 + timecontrol"偶发"真因（round 13，用户报障）

- 结果：修复管理员用户列表只见 ID 不见昵称——根因是**读写源不一致**：`auth.identify/upsertSession` 把会话写在 kv 表（`sessions/<id>.json` 键），而 `auth.listSessions` 读独立的 sessions 表（几乎无人写入，实测 0 行）→ `ratings.allUsers` 合并不到名字。修复：storage 新增 `listJsonByPrefix`，listSessions 改从 kv 枚举。顺带补齐纯会话用户的默认 ELO/战绩字段（原来显示 undefined）。修复后回归 105 项稳定通过（timecontrol 4 连跑全绿）。
- 结果（附）：揪出 e2e-timecontrol.js **从第一天起 50% 概率翻车**的真因——座位随机（rooms.js:216 自初始提交就是随机先手）而测试硬编码假设房主 A=先手 'b'；A 抽到后手时走子被服务端拒绝、state 停在旧局面、断言读到 b 方未重置的时钟（表现为"8000ms/7.4s 判负"）。此前 round 8/9 把它归因为"tick 波动"，单独跑就绿纯属运气。修复：按 created.seat 映射客户端（seatClient）。
- 原因：两类问题同源——**同一份数据/同一个事实存在两条路径，各自假设对方与自己一致**（写入走 A路、读取走 B路；客户端座位 vs 测试假设）。这类 bug 静态看代码很难发现，必须"从写入点追到读取点"逐链路核对，或用真实数据流实测（instrument 打印座位/轮次/时钟）才能现形。
- 对策：①排障先问"这份数据谁写、谁读、是否同源"；②"偶发"测试失败不要接受历史结论（哪怕是自己之前的诊断），要构造能复现两种分支的实验（本例连跑 4 次覆盖随机座位）；③对依赖随机性的测试，显式断言/读取随机结果而非硬编码假设。

## 2026-08 交接接手：部署修复 + 回归治理 + 文档体系（round 12）

- 结果：定位并修复「服务器没法部署」——`.npmrc` 设 `ignore-scripts=true`（better-sqlite3 v13 tarball 自带全平台预编译二进制，无需编译；带 binding.gyp 却无 install 脚本触发 npm 自动 node-gyp 才是炸点）。干净目录 `npm ci --omit=dev` 实测秒装成功，全新 DATA_DIR 启动 + 页面/REST/WS 全通。全量回归 105 项通过；lobby 加入面板缩小、tournaments 两段式改版落地并浏览器验证；新增 docs/UI-PAGES.md 与 docs/PLAN.md。
- 原因：部署故障属于"依赖包生命周期脚本与宿主工具链的隐式耦合"，代码语法检查/单测都发现不了——必须用 rsync 干净副本模拟真实部署路径（npm ci → 冷启动 → 冒烟）才能暴露。主项目能跑只是因为当初装依赖时预编译恰好成功。
- 对策：①排障顺序升级：先看 install 期错误再怀疑运行时代码，`node -e require` 一行命令即可隔离"装不上"与"跑不动"；②这类环境性修复要在 DEPLOY.md 留健康自检命令；③页面改版验证在无法看截图的会话里可用"DOM 快照结构 + 只读几何测量（getBoundingClientRect）"双验证替代视觉判断，诚实标注限制。遗留：赛事审核流（PLAN §B）与管理后台增强（§C）待用户拍板优先级。

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

## 2026-08 观战身份隔离回归修复（round 10，用户报障）

- 结果：修复「对战后一方空棋盘无法操作」+「观战者加入后选手 ID 变观战者」：handleConnection 不再自动 reconnect（改 findPendingGame 仅探测报告，绑定延后到 request_state），前端处理 replaced。全量回归 94 项通过（新增 e2e-spectator-identity 6/6）。
- 原因：同浏览器多窗口共享 localStorage guestId——观战窗口连接时 handleConnection 的自动 reconnect() 按 playerId 匹配座位，把观战窗口误绑为玩家座位，顶掉原玩家绑定 → 玩家空棋盘、观战者变"选手"。
- 对策：重连意图由 request_state（玩家明确请求）区分，观战走 spectate 永不触发；hello 保留 reconnect 探测结果供前端提示；前端 replaced 提示 + 禁用操作；教训——主 e2e 曾"卡死"是测试脚本缺 process.exit（失败时 ws 保持事件循环挂起），补 process.exit 后恢复；临时二分文件 e2e-test-noc.js 误提交已移除，git 保持干净。

## 2026-08 同 guestId 多窗口互顶（round 11，用户复报）

- 结果：修复「同浏览器多窗口（建房+加入+观战共享 guestId）」导致全部窗口收到 replaced 被顶替信号、前端禁用棋盘（表现为对局状态出错/无法操作/ID 错乱）：protocol 层 guestToClient 单值映射改 playerToClients 多值集合，移除连接时 replaced 通知。真实浏览器三窗口验证通过，全量回归 94 项。
- 原因：guestToClient（playerId→单 clientId）+ 每次连接即发 replaced 的设计，把"同身份多连接"（同浏览器多标签的合法场景）误判为"账号被顶替"。前一轮修的是"观战不抢座位"，但没处理"多窗口互相收 replaced"这条更普遍的路径。
- 对策：架构文档先行（docs/ARCHITECTURE.md 第 6 章连接绑定专章），按文档的映射表逐一核对才发现 guestToClient 单值是根源；playerToClients 多值映射 + _sendToPlayer 广播全部连接；rooms 层座位绑定不受影响；教训——用户说"没修复"时不要重复旧假设，应回到架构文档用真实操作链（同浏览器多窗口）重新复现，而非仅验证独立身份场景。
