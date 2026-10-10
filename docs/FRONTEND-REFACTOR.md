# 前端重构与体验优化设计

> 起草：2026-09-10 ｜ 对应 `PLAN.md` §M5（代码拆分）+ §S（体验优化，本文新增）
>
> 需求来源三条：
> ① 前端脚本体积失衡（`play.js` 775 / `freeboard.js` 514 / `admin.js` 502 / `review.js` 499 行）
> ② 用户反馈「**手机端难用**」（触屏误触、按钮太小、滚动别扭）
> ③ 新需求：**棋盘坐标标注**（默认隐藏）+ **用户设置面板**（音效 / 棋子图集 / 坐标开关…）
>
> **本文只做设计**，不写实现代码。实施按 §7 顺序推进，每步独立可回退。

---

## 0. 设计目标与非目标

**目标**
1. 手机端对局体验可用：看得见棋盘、点得准、滚得动
2. 把「用户可自定义」的能力收进**一个设置面板**，不再散落成各页面的临时开关
3. 已臃肿的页面脚本按职责拆开，使后续改动能定位到小文件

**非目标（明确不做）**
- **不引入构建步骤**（不引 webpack/vite/TS）。本项目定位是「单进程 + 静态前端」，部署即拷贝文件；
  引入构建会让部署与排障复杂度上一个台阶。原生多文件 + 显式 `<script>` 顺序是刻意取舍。
- 不做视觉大改版（配色/字体/整体风格保持）
- 不重写 FreeBoard（§M6 刚统一，正稳定期）

---

## 1. 现状盘点

| 文件 | 行数 | 职责 | 主要问题 |
|---|---|---|---|
| `js/play.js` | 775 | 对局页全部逻辑 | 状态渲染 + 棋钟 + 感想战 + 自由摆棋 + 观战 + 音效判定全在一处 |
| `js/freeboard.js` | 514 | 统一棋盘控制器（四模式） | 尚可，但 `render()` 内联了驹台渲染与拖拽细节 |
| `js/admin.js` | 502 | 管理后台 | 4 个 tab + 用户详情弹层 + 导入导出全在一处 |
| `js/review.js` | 499 | 复盘器 | 与 `play.js` 有部分相似逻辑，未复用 |
| `js/lobby.js` / `home.js` / `gallery.js` … | 75–224 | 各页面入口 | 尚可 |

**已有基础（本次可直接复用，不必新造）**
- `js/piece-kinds.js`：棋种映射单一来源 + 加载自检（§M6 成果）
- `board.js` 的 `getAtlas()` 已支持 `window.PIECE_ATLAS_DEFAULT` 覆盖 → **"棋子图集切换"几乎零成本**
- `--cell-size` 由 `board.js` 按视口算（`auto` 模式），棋盘尺寸已是动态的
- `sound.js` 已有 `SOUND_KEY` 开关持久化；`nav.js` 已有 `THEME_KEY`
- `settings.js` **不存在**——这正是本次要补的：目前偏好散在 5 个 localStorage 键里

---

## 2. 新需求 A：用户设置面板（建议**最先做**）

### 2.1 存储：收敛为单一键

新增 `js/settings.js`（IIFE，挂 `window.Settings`），统一存 `localStorage['tdshogi_settings']`：

```js
const DEFAULTS = {
  theme: 'dark',          // dark | light
  sound: true,            // 行棋/吃子音效
  showCoords: false,      // 棋盘坐标数字与段名（**默认隐藏**，用户要求）
  atlas: 'kinki',         // 棋子图集：kinki | ryoko
  dragToMove: false,      // 手机端是否允许「按住拖拽」走子（见 §4.1，默认关）
  highlightLastMove: true,// 上一步落点高亮
};
```

API：`get(key)` / `set(key, v)` / `all()` / `subscribe(fn)` / `apply()`。

**兼容迁移**：首次读取时若旧键存在则搬过来并写回新键——
`tdshogi_theme` → `theme`、`tdshogi_sound`('on'/'off') → `sound`；
旧键**不删除**（回滚安全），但不再作为数据源。

### 2.2 设置项清单（首版）

| 分组 | 项 | 说明 |
|---|---|---|
| 显示 | 主题 | 复用 `nav.js` 的 `toggleTheme`，改由 `Settings` 驱动 |
| 显示 | **棋盘坐标** | 见 §3 |
| 显示 | 上一步落点高亮 | 现为固定行为，改为可关 |
| 音效 | 音效开关 | 复用 `sound.js`，改由 `Settings` 驱动 |
| 棋子 | **棋子图集** | kinki / ryoko，写 `window.PIECE_ATLAS_DEFAULT` 后触发棋盘重渲染 |
| 操作 | **触屏拖拽走子** | 默认**关**（手机端误触主因，见 §4.1） |

### 2.3 入口与形态

- 导航栏 `nav.js` 增加 ⚙️ 按钮（**所有页面可用**），点击打开居中弹层（复用 `.modal` 风格）
- `profile.html` 内再放一个入口（用户找设置的第一直觉位置）
- 弹层内改动**即时生效**（无「保存」按钮），并在同页其他组件间广播：
  `Settings.subscribe(fn)` → 棋盘重渲染 / 主题切换 / 音效开关

### 2.4 为什么值得先做

它是另外两项的地基：坐标开关、拖拽开关、图集切换都挂在它上面。
且**纯新增文件 + 小改 3 处**（`nav.js` / `sound.js` / `board.js` 各一处读取），风险极低。

---

## 3. 新需求 B：棋盘坐标标注

### 3.1 规格（按用户明确要求）

- **筋（列）**：阿拉伯数字 `1–9`，**从右到左**递增（将棋记谱惯例：1 筋在最右）
- **段（行）**：汉字 `一–九`，**从上到下**
- 位置：**只标一对**（四边全标太啰嗦），并随视角换边——
  - 先手视角：筋号在**上**、段名在**右**
  - 后手视角（棋盘 180° 翻转）：筋号落到**下**、段名落到**左**
- 棋盘 padding 四边保持等宽，标注只在两处也不会让棋盘偏心
- **默认隐藏**，由设置项 `showCoords` 控制（用户要求）

### 3.2 视角联动（关键）

标注必须**跟随 `viewpoint`**：
- 先手视角：1,2,…,9 自右向左；一,二,…,九 自上向下
- 后手视角（棋盘已翻转 180°）：1,2,…,9 自**左**向右，段名同样反向

因此**不能**用静态 HTML 写死坐标，必须在 `board.render(state, opts, viewpoint)` 时按 `viewpoint`
生成或翻转坐标数组。建议把坐标渲染收进 `ShogiBoard`，由 `viewpoint` 驱动，与格子渲染共用一套映射。

### 3.3 实现方式

选**独立标注层**，而非在每个 `.cell` 上挂 `::before`：

```
.board-frame                       ← 新增包裹层（相对定位）
├── .board-coords-top               ← 筋号（先手视角：9…1 视觉顺序）
├── .board-coords-left / -right     ← 段名（一…九）
├── .shogi-board                    ← 现有棋盘（不变）
└── .board-coords-bottom
```

- 用 `display: grid; grid-template-columns: repeat(9, var(--cell-size))` 与棋盘**同参数**对齐，
  因此窄屏 `--cell-size: auto` 时也能自动匹配（无需 JS 计算）
- 字号 10–11px、颜色 `var(--text-dim)`、`user-select: none`、`pointer-events: none`（绝不吃点击）
- 只在 `showCoords` 打开时渲染这四个层（关闭时零开销、零布局影响）

**风险点**：`.board-frame` 包裹会改变既有 CSS 选择器层级（`.board-area > .shogi-board` 之类）。
实施时先 grep 所有 `.shogi-board` 相关的后代选择器，或改用「不新增包裹、把标注层绝对定位挂在
现有容器上」的保守方案。**实施前需先确认 `board.css` 的选择器耦合度**。

---

## 4. 手机端体验优化（用户痛点）

### 4.1 触屏误触 → 默认关闭拖拽

**现状**：`board.css` 在 `@media (pointer: coarse)` 下给 `.shogi-board, .hand-pieces` 设了
`touch-action: none`，即**在棋盘上无法滚动页面**；同时拖拽走子是默认交互。

**问题链**：想滚页面 → 手指落在棋盘上 → 拖拽被识别为走子 → 误走一步。
（`freeboard.js` 的 12px 阈值只解决了「轻点 vs 拖拽」，没解决「想滚动 vs 拖拽」。）

**方案**：
- 设置项 `dragToMove` **默认 `false`**：手机端走子只用「点棋子 → 点目标格」两步点选
  （将棋在触屏上点选比拖拽更可靠，81Dojo 移动版同样以点选为主）
- `dragToMove` 打开时保留现有拖拽逻辑
- 通过 `@media (pointer: coarse)` **不硬编码**，而是由 JS 读设置后给棋盘容器加 class
  （如 `.no-drag`）来切换 `touch-action`，这样桌面端行为完全不变

### 4.2 点击目标尺寸

- `@media (pointer: coarse)` 下：`.btn` 最小高度 **40px**、最小宽度 40px、字号 ≥14px
- `.hand-piece` 在触屏下发到 **≥44px**（iOS HIG 建议值）——注意其视觉尺寸可能需保持，
  用 `padding` / 伪元素扩大**热区**而非放大图形
- 对局页顶部按钮组（视角 / 音效 / 退出）在窄屏改为**仅图标 + `title`**，或收进「⋯」菜单，
  避免三个按钮挤占整行

### 4.3 滚动与布局（**最可能被用户称为"别扭"的一处**）

**已定位的问题**：`style.css` 在 `@media (max-width: 900px)` 里写了

```css
.play-side { order: -1; }   /* 对局页侧栏移到棋盘上方 */
```

后果：手机上打开对局页，**先看到的是「棋谱 / 观众 / 操作」三个面板，要往下滚才看到棋盘**。
对一个下棋应用来说这是主次颠倒。

**方案**：
1. **去掉 `order: -1`**，恢复「棋盘在上、侧栏在下」的自然顺序（棋盘是绝对主角）
2. 侧栏的「棋谱 / 观众」在手机上**默认折叠**（`<details>`，只留标题与条数），点开才展形
3. 对局页顶部信息（房间码/观战标识）与按钮组在同一行内压缩，不换行
4. 提供「回到棋盘」浮标：侧栏较长时，右下角固定一个 ⬆ 按钮 `scrollIntoView` 到棋盘
5. 进入页面时自动 `scrollIntoView` 棋盘（避免从页首开始）

### 4.4 候选（暂不做，记录备查）

- 横竖屏旋转时自动重建棋盘（§D 已记）
- 手机端将棋盘做 `position: sticky`（与 `--cell-size` 计算耦合，风险偏高）

---

## 5. §M5 代码拆分

### 5.1 原则

1. **纯搬运**：只移动代码、不改逻辑（改逻辑与搬家分开做，便于定位回归）
2. **保持 IIFE + `window.*` 命名空间**，不引入模块系统（保零构建）
3. **一次只拆一个文件**，每步都可独立提交与回退
4. **先补测试再拆**：`npm test` + `npm run lint` 两个门禁必须全绿；
   涉及棋盘的改动额外跑 `scripts/e2e-freeboard.js`

### 5.2 目标结构

```
public/js/
├── core/                 # 跨页面基础设施
│   ├── api.js            # WS/REST 封装（现 api.js）
│   ├── settings.js       # 【新】用户设置（§2）
│   ├── sound.js
│   ├── hovercard.js
│   └── nav.js
├── ui/
│   ├── piece-kinds.js    # 棋种映射单一来源（已是）
│   ├── pieces.js         # 棋子 HTML 生成
│   ├── board.js          # ShogiBoard 渲染器（+ 坐标标注 §3）
│   └── freeboard.js      # FreeBoard 交互控制器
└── pages/
    ├── home.js lobby.js history.js gallery.js tournaments.js profile.js
    ├── play/             # play.js 拆分产物（仅 play.html 加载）
    │   ├── play.js       # 入口：状态渲染与编排
    │   ├── play-clock.js # 棋钟（本地倒计时 + 服务端校准 + 读秒音）
    │   ├── play-demo.js  # 感想战 / 自由摆棋
    │   └── play-views.js # 观战视角 / 观众列表 / 聊天
    ├── review.js
    └── admin/            # admin.js 拆分产物
        ├── admin.js      # 入口与登录
        ├── admin-users.js
        └── admin-records.js
```

> 目录分层本身**不做强制**——若实施时发现移动文件带来的 `<script>` 路径维护成本 > 收益，
> 允许保持扁平目录，只做**文件级拆分**。**文件拆开**才是目的，**目录美观**不是。

### 5.3 拆分顺序（低风险 → 高风险）

| 步 | 动作 | 风险 | 验证 | 状态 |
|---|---|---|---|---|
| 1 | 新增 `settings.js`（§2） | 极低 | 手测 + `lint` | ✅ 已完成 |
| 2 | `play.js` 抽出棋钟 → `play-clock.js` | 低（与棋钟 e2e 对应） | `e2e-timecontrol.js` | ✅ 已搬运（2026-09-10），**待用户跑 e2e 验收** |
| 3 | `play.js` 抽出感想战 → `play-demo.js` | 中（§J3 高发区） | `e2e-freeboard.js` | ⬜ 待做 |
| 4 | `play.js` 抽出观战 → `play-views.js` | 中（§R 刚改） | `e2e-spectator-identity.js` | ⬜ 待做 |
| 5 | `admin.js` 按 tab 拆 | 中 | 手测 + `e2e-tournament-admin.js` | ⬜ 待做 |
| 6 | `freeboard.js` 内联驹台/拖拽细节外提 | 中高 | `e2e-freeboard.js` + 单测 | ⬜ 待做 |

**第 2 步实施记录（2026-09-10）**

- 边界：棋钟相关标识符（`localClocks` / `localByoyomi` / `inByoyomi` / `byoyomiDuration` /
  `lastTickTs` / `lastTickSecond` / `fmtClock` / `updateClocks` / `displayFor`）**只在 `play.js`
  内部出现**，用 grep 确认过，没有外部引用点。
- 手法：**纯搬运，逻辑一字未改**。`play.js` 里原本依赖两个闭包变量，改为注入回调：
  `getState()`（取 `state`）、`getViewpoint()`（取 `mySeat === 'w' ? 'w' : 'b'`）。
- 调用点共 5 处，**全部改完并 grep 复核**（残留检查 0 命中）：
  ① 模块顶部 5 个状态声明 → 删除；② `render()` 的棋钟初始化 → `PlayClock.syncFromState(state)`；
  ③ `displayFor/updateClocks/fmtClock` + `setInterval(tick,500)` → `PlayClock.init({...})`；
  ④ `state` 消息里的 `lastTickTs = Date.now()` → `PlayClock.resetTick()`；
  ⑤ `api.on('clock')` 整段 → `PlayClock.syncFromServer(data)`。
- `play.html` 在 `play.js` **之前**引入 `play-clock.js`（依赖顺序）。
- 结果：`play.js` 819 → **758** 行；新增 `play-clock.js` 121 行。
- **搬运时发现、并已单独修复的不一致**：原 `getViewpoint` 按 `mySeat` 计算，而观战者
  `mySeat` 为 `null` → 恒为 `'b'`，于是**观战者切换 §R1 视角后，棋盘翻了、上下棋钟没翻**。
  搬运阶段刻意不动它（行为变更与搬家分开），随后用**单独一个提交**修掉：
  改为 `getViewpoint: () => currentViewpoint()`，**与棋盘共用同一个函数**，
  单一口径从根上杜绝再次跑偏。

### 5.3.1 棋钟可测化（与第 2 步配套，2026-09-10）

拆分时顺手把「按手番扣减时间」从定时器回调里拎成 `advance(dtMs)` 并导出——
**目的是让它能被验证**：时间算错是用户立刻能感知的错误，不该只靠"跑起来看着对"。

`tests/play-clock.test.js` **12 项**（用最小 DOM / window 替身跑浏览器 IIFE）：

| 覆盖 | 用例 |
|---|---|
| **视角换边**（回归点） | 先手视角下下方=先手；切后手视角上下互换 |
| 格式化 | `m:ss` 补零（`61000` → `1:01`、`9000` → `0:09`） |
| 扣减 | 只扣当前手番 / 扣到 0 不为负 / 非 `PLAYING` 不扣 |
| 读秒 | 进读秒只显示秒数；≤10 秒每跨 1 秒响一次、同一秒不重复、>10 秒不响 |
| 校准 | `syncFromServer` 以服务端为准；`null` / `undefined` 不报错也不改动 |
| 高亮 | 轮到谁且 ≤10 秒才给 `low` 标 |

→ `npm test` **58 项全绿**（46 → 58）。

### 5.3.2 公共工具收敛（`util.js`，2026-09-10）

**问题（grep 实证）**：三段工具函数被**逐字复制**到各页面脚本——

| 函数 | 副本数 | 分布 |
|---|---|---|
| `esc` | **11** | lobby / tournaments / hovercard / home / history / review / gallery / profile（**同一文件里定义了两次**）/ admin / **play.js（改名为 `escHtml`）** |
| `toast` | 8 | lobby / tournaments / home / review / gallery / profile / play / admin |
| `$` | 3 | home / play / play-clock |

**为什么这不只是"代码重复"**：`esc` 是 **XSS 防护函数**。抄了 11 份，意味着将来补一个转义字符
要改 11 处，**漏一处就是那个页面的 XSS 漏洞**——不报错、页面照常工作，只是安静地等一个恶意昵称。

**做法**
- 新增 `public/js/util.js`（`window.UI = { $, esc, toast }`），在 `settings.js` 之后、
  `nav.js` 之前引入（9 个页面统一加一行）
- 各页面把**本地实现**改为**一行转发**：`function esc(s) { return window.UI.esc(s); }`
  - **函数名与位置都不变** → 所有调用点零改动；`play.js` 的 `escHtml` 也保留原名
  - ⚠️ 刻意**不写成 `const { esc } = window.UI`**：`const` 不提升，而原实现是函数声明（会提升）。
    若某文件在定义之前就调用了它，`const` 会 TDZ 报错。转发写法**没有时序风险**
- `toast` 顺手加了 `if (!el) return`（原实现找不到 `#toast` 会直接抛错，提示失败不该拖垮整页）

**验证**：用**实现特征**（`'&amp;', '<': '&lt;'`）而非函数名 grep →
全项目只剩 `util.js` 一处实现；`window.UI.` 命中 11 个文件、9 个页面全部引入 `util.js`；
`node --check` 全过、lint 0 error、`npm test` 58 项全绿。

> ⚠️ **漏改一个页面 = 那个页面直接挂掉（`esc is not a function`）**。本轮靠两点兜住：
> ① 9 个页面结构一致、统一插入（old_str 唯一）；② 改完按**实现特征**而非**函数名**复核——
> 正是这一步抓出了 `play.js` 里改名为 `escHtml` 的第 11 份副本（按名字搜是搜不到的）。

**每步独立提交**（本项目已有 git 基线 `v1.3.1`），任何一步出问题都能 `git revert` 单步。

### 5.4 拆分带来的新成本（诚实记录）

无构建步骤下，拆出的每个文件都要在 HTML 里按**依赖顺序**列出 `<script>`。
`play.html` 将从 1 个变成 5 个左右的脚本标签。缓解：

- 顺序约定：`core/` → `ui/` → `pages/`（后续文件不依赖前序之外的）
- 在 `ARCHITECTURE.md` 记录每个页面的脚本清单与顺序
- 若某页脚本超过 6 个，再考虑加一个 `js/loader.js` 做顺序化动态加载（仍无构建）

---

## 6. 数据流与开关生效路径（避免"改了没生效"）

```
用户改设置
  → Settings.set() 写 localStorage
  → Settings 通知订阅者
      ├─ nav.js      → 主题立即切换
      ├─ sound.js    → 音效开关
      ├─ board.js    → 坐标层显隐 + 图集（PIECE_ATLAS_DEFAULT）
      └─ freeboard.js→ 拖拽开关（棋盘容器 class）
```

**注意**：棋盘可能同时存在「坐标开关」与「视角切换」两个触发源，
重渲染入口必须**唯一**（统一走 `FreeBoard.render()`），否则会出现「切了视角坐标没跟着翻」。
这一点与 §R1 的 `setViewpoint` 同类问题，实施时沿用同一约定。

---

## 7. 实施顺序建议（含验收清单）

| 序 | 任务 | 验收 |
|---|---|---|
| 1 | `settings.js` + 导航 ⚙️ 面板（迁移主题/音效） | 改主题/音效后刷新仍生效；旧键用户无感迁移 |
| 2 | **手机端布局修正**（去掉 `order:-1`、侧栏折叠、自动滚到棋盘） | 手机上打开对局页**首屏即见棋盘**；滚动手感正常 |
| 3 | 触屏尺寸与拖拽开关 | 手机点选走子不再误触；按钮可轻松点中 |
| 4 | 棋盘坐标标注 | 开/关生效；**切视角后筋号/段名正确翻转**；不吃点击事件 |
| 5 | 棋子图集切换 | 切换后棋盘与驹台同步换图；刷新后保持 |
| 6 | §M5 拆分（按 §5.3 逐步） | 每步 `npm test` + `npm run lint` 全绿；相关 e2e 通过 |

> 建议 1–5 为一轮（用户可感知的体验批次，风险低），6 单独一轮（结构性改动，需完整回归）。

---

## 8. 开放问题 —— **已全部定案（2026-09-23 复核，无需再问）**

这四条在实现时就已经按下面这样定死了，**不要再当成待确认项**（复核依据：`public/js/settings.js` 的
`DEFAULTS` / `SCHEMA`，以及 `public/js/board.js:141–146` 的坐标生成）：

1. **棋子图集** → 用**下拉（`select`）**，当前选项 `kinki` / `ryoko`。
   选下拉而非单选，就是为了将来加图集时**不用改面板结构**（加一行 `options` 即可）。
2. **坐标样式** → **筋用数字（1–9）、段用汉字（一–九）**，只此一种，不做"汉字筋号"。
   实证：`board.js` 里 `nums = ['1'…'9']`、`kanji = ['一'…'九']`。
3. **拖拽开关默认值** → **默认关**（`dragToMove: false`），即默认用"点棋子 → 点目标格"两步走子避免误触；
   该开关只在触屏（`pointer: coarse`）下有实际影响，桌面端不受影响。
4. **设置是否按设备区分** → **不区分**，全部收敛在**单一 localStorage 键** `tdshogi_settings`。
   （不引入"按设备自动"，避免设置来源出现第二套口径。）
