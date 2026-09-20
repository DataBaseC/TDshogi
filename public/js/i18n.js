/**
 * i18n.js — 多语言（PLAN §Z5）
 *
 * 设计取舍（三条，都是为了让"加一种语言"的边际成本尽量低）：
 *
 * 1. **以中文原文当键**。本项目只有一种源语言，所谓"key"本来就是那句待翻译的话——
 *    再立一层 `t.home.hero.title` 式的 key 命名空间，等于每加一句文案都要同时改
 *    HTML/JS + 词典 + key 表三处。代价是**改中文原文会丢翻译**，
 *    所以靠一条测试兜底：「en 词典的值里不许残留中文」+「键必须非空」。
 *
 * 2. **DOM 整段匹配**：文本节点的 `trim()` 后**完全等于**某个词条时才替换，
 *    属性（`placeholder`/`title`/`aria-label`）同理。于是**静态页面零改动**就会被覆盖——
 *    不需要给每个元素标 `data-i18n`。刻意只做"整段相等"，避免把长句里的词误替换成英文
 *    （那种"半句中文半句英文"的界面比不翻译更难读）。
 *
 * 3. **节点记住原文**（WeakMap）。否则切到英文后，节点里存的就是英文，
 *    再切回中文时拿英文去查表必然查不到 —— 用户就"回不去中文"了。
 *
 * ⚠️ 中文是默认语言，此文件对中文用户**零开销**：不建观察器、DOM 扫描直接跳过。
 * ⚠️ 服务端下发的字符串（错误提示、系统播报）也走 `t()`（`UI.toast` 是必经之路），
 *    所以**给词典补一条就能翻一条**，不必改服务端；带变量的句子（`已批准 3 人`）
 *    需要在调用点用 `t('已批准 {n} 人', { n })`。
 */
(function () {
  const STORAGE_KEY = 'tdshogi_locale';

  /** 可选语言。`short` 用于导航栏那个小按钮 */
  const LOCALES = [
    { id: 'zh-CN', label: '中文', short: '中' },
    { id: 'en', label: 'English', short: 'EN' },
  ];

  // ==================================================================
  // 词典：`en` 下是「中文原文 → 英文」。变量写成 `{name}`。
  // ==================================================================
  const DICT = {
    en: {
      // ---- 导航与通用 ----
      首页: 'Home',
      对战: 'Play',
      棋谱: 'Games',
      赛事: 'Tournaments',
      个人: 'Profile',
      管理后台: 'Admin console',
      切换主题: 'Toggle theme',
      设置: 'Settings',
      语言: 'Language',
      '个人 · 游客': 'Profile · Guest',
      '个人 · 已登录账号': 'Profile · Signed in',
      复制: 'Copy',
      已复制: 'Copied',
      确定: 'OK',
      取消: 'Cancel',
      关闭: 'Close',
      返回: 'Back',
      保存: 'Save',
      刷新: 'Refresh',
      加载中: 'Loading…',
      暂无: 'None',
      暂无数据: 'No data yet',
      没有数据: 'No data',
      查看详情: 'View details',
      在线: 'Online',
      离线: 'Offline',
      未知: 'Unknown',
      无名棋士: 'Unnamed player',
      系统: 'System',
      你: 'You',

      // ---- 时间控制（服务端下发的 name 也照此翻） ----
      '10 分钟包干（标准比赛）': '10 min sudden death (standard)',
      '15 分钟 + 60 秒读秒': '15 min + 60 s byoyomi',
      '10 分钟 + 30 秒读秒': '10 min + 30 s byoyomi',
      '10 秒快棋': '10 s bullet',
      '10分钟包干': '10 min',
      '15分+60秒': '15 min + 60 s',
      '10分+30秒': '10 min + 30 s',
      '10秒': '10 s',

      // ---- 首页 ----
      天锻将棋道场: 'TDShogi Dojo',
      '日本将棋 · 在线实时对战 · 免注册即刻对局': 'Japanese shogi · real-time online play · no sign-up required',
      '⚔️ 开始对局': '⚔️ Start a game',
      '🎲 随机观战': '🎲 Watch a random game',
      在线人数: 'Online',
      对局中: 'Playing',
      等待对局: 'Waiting',
      复盘中: 'Reviewing',
      累计棋谱: 'Games played',
      三步开始你的将棋之旅: 'Three steps to start playing shogi',
      立即开局: 'Play right away',
      '无需注册，打开就能玩。快速匹配在线对手，或生成房间码邀请好友来一局。':
        'No sign-up needed — just start. Match with an online player, or create a room code and invite a friend.',
      登记账号: 'Create an account',
      '注册正式账号，ELO 评级、胜绩与全部棋谱永久保存，游客数据可一键升级迁移。':
        'Register to keep your ELO rating, results and all game records — your guest data migrates in one click.',
      复盘精进: 'Review and improve',
      '每局自动存为标准 KIF/CSA 棋谱，复盘器支持书签、评论与变着研究。':
        'Every game is saved as standard KIF/CSA. The reviewer supports bookmarks, comments and variations.',
      系统公告: 'Announcements',
      ELO排行榜: 'ELO leaderboard',
      最新对局战报: 'Latest results',
      '查看我的棋谱 →': 'My games →',
      将棋规则速查: 'Shogi rules at a glance',
      '🎯 目标：将死对方的王（玉将）': '🎯 Goal: checkmate the opponent’s king',
      '轮流走子，攻击对方的王使其无路可逃即为「詰み」（将死）获胜。被将军时必须应将；本平台服务端自动判定王手与将死。':
        'Players alternate moves; trapping the opponent’s king with no escape is checkmate (詰み) and wins. You must answer a check — the server detects checks and mate for you.',
      '⬆️ 升变：进入敌阵可强化棋子': '⬆️ Promotion: enter the enemy camp to upgrade a piece',
      '棋子进入、离开或在对方三段阵地内移动时可以选择升变（翻面）：飞车→龙王、角行→龙马、银将/桂马/香车/步兵均获得金将走法。玉与金不能升变。':
        'A piece may promote (flip) when it moves into, out of, or within the enemy’s last three ranks: rook→dragon, bishop→horse, and silver/knight/lance/pawn all gain gold-general moves. King and gold cannot promote.',
      '🖐️ 打入：吃掉的棋子归你使用': '🖐️ Drops: captured pieces join your hand',
      '吃掉的对方棋子放入自己的驹台，之后可在任意空格「打入」重新上战场——这是将棋最独特的规则（二步、打步詰等禁手已由服务端校验）。':
        'Captured pieces go to your hand and can later be dropped onto any empty square — shogi’s most distinctive rule. Illegal drops (two pawns on a file, pawn-drop mate, etc.) are rejected by the server.',

      // ---- 大厅 ----
      快速匹配: 'Quick match',
      '点击后自动与在线棋手配对，无需房间码': 'Automatically paired with an online player — no room code needed',
      '寻找对手中…': 'Looking for an opponent…',
      取消匹配: 'Cancel match',
      创建房间: 'Create a room',
      '生成 6 位房间码，邀请好友加入对局。': 'Get a 6-character room code and invite a friend.',
      比赛时间: 'Time control',
      '手合割（让子）': 'Handicap',
      '不让子：双方各 20 枚，房主随机执先手，计入 ELO。':
        'No handicap: 20 pieces each, the host plays a random colour, rated.',
      '🔒 私人房间': '🔒 Private room',
      '（不计 ELO，经验照常 · 不开放观战）': '(unrated, XP still earned, no spectators)',
      '房间密码（4-8 位，可留空表示不设密码）': 'Room password (4–8 chars, leave empty for none)',
      加入房间: 'Join a room',
      '输入 6 位房间码': 'Enter the 6-character room code',
      房间码: 'Room code',
      房间号: 'Room code',
      加入: 'Join',
      观战: 'Watch',
      '👁 观战（用房间码）': '👁 Watch (with a room code)',
      '进行中的对局': 'Games in progress',
      '当前没有进行中的对局': 'No games in progress',
      '人观战': 'watching',
      房间对局: 'Room game',
      快速对局: 'Quick match game',

      // ---- 让子（手合割） ----
      平手: 'Even game',
      香落ち: 'Lance handicap',
      右香落ち: 'Right-lance handicap',
      角落ち: 'Bishop handicap',
      飛車落ち: 'Rook handicap',
      飛香落ち: 'Rook + lance handicap',
      二枚落ち: 'Two-piece handicap',
      四枚落ち: 'Four-piece handicap',
      六枚落ち: 'Six-piece handicap',
      八枚落ち: 'Eight-piece handicap',
      十枚落ち: 'Ten-piece handicap',
      让子: 'Handicap',
      上手: 'Giver (handicap)',
      下手: 'Receiver (handicap)',

      // ---- 对局页 ----
      房间: 'Room',
      对局: 'Game',
      认输: 'Resign',
      再来一局: 'Rematch',
      请求再来一局: 'Request a rematch',
      退出对局: 'Leave game',
      对手断线: 'Opponent disconnected',
      对手已断线: 'Opponent is disconnected',
      '⚠️ 断线': '⚠️ Disconnected',
      '连接中…': 'Connecting…',
      '对手': 'Opponent',
      你已获胜: 'You win',
      你已落败: 'You lose',
      和棋: 'Draw',
      未完成: 'Unfinished',
      胜利: 'Win',
      失败: 'Loss',
      胜: 'Win',
      负: 'Loss',
      持驹: 'In hand',
      观众: 'Spectators',
      暂无观众: 'No spectators yet',
      操作: 'Actions',
      聊天: 'Chat',
      全部: 'All',
      发送: 'Send',
      说点什么: 'Say something…',
      系统消息: 'System',
      走子记录: 'Move list',
      入玉宣言: 'Declare nyugyoku',
      举报对手: 'Report opponent',
      尚未走子: 'No moves yet',
      回放: 'Replay',
      观众进出提示: 'Spectator join/leave notices',
      请稍等: 'Please wait',
      轮到你走: 'Your turn',
      等待对手走子: 'Waiting for the opponent',
      同意: 'Agree',
      同意再来一局: 'Agree to rematch',
      已申请再来一局: 'Rematch requested',

      // ---- 设置面板 ----
      显示: 'Display',
      棋子: 'Pieces',
      音效: 'Sound',
      主题: 'Theme',
      深色: 'Dark',
      浅色: 'Light',
      跟随系统: 'Follow system',
      棋盘坐标: 'Board coordinates',
      上一步高亮: 'Highlight last move',
      行棋音效: 'Move sounds',
      触屏拖拽走子: 'Drag to move (touch)',
      棋子图集: 'Piece set',
      金輝: 'Kinki',
      凌雲: 'Ryoko',
      分钟提醒音: 'Minute reminder',
      读秒音: 'Byoyomi tick',
      落子音: 'Move sound',
      '对局 BGM': 'Game BGM',
      关闭音效: 'Off',
      默认: 'Default',
      开启: 'On',

      // ---- 棋谱/复盘 ----
      棋谱列表: 'Game list',
      复盘: 'Review',
      开始: 'Start',
      结束: 'End',
      上一步: 'Previous',
      下一步: 'Next',
      首手: 'First',
      末手: 'Last',
      书签: 'Bookmark',
      评论: 'Comment',
      变着: 'Variation',
      导入: 'Import',
      导出: 'Export',
      手数: 'Moves',
      结果: 'Result',
      对局时间: 'Played at',
      用时: 'Duration',
      导出KIF: 'Export KIF',
      导出CSA: 'Export CSA',

      // ---- 个人页 ----
      昵称: 'Name',
      等级: 'Level',
      战绩: 'Record',
      胜率: 'Win rate',
      赛事荣誉: 'Tournament honours',
      夺冠: 'Titles',
      亚军: 'Runner-up',
      四强: 'Top 4',
      参赛赛事: 'Tournaments entered',
      夺冠率: 'Title rate',
      还没有参加过赛事: 'No tournaments yet',
      '去「赛事」页报名，或自己办一场吧！': 'Sign up on the Tournaments page, or host one yourself!',
      编辑资料: 'Edit profile',
      头像: 'Avatar',
      保存修改: 'Save changes',

      // ---- 赛事 ----
      我的赛事: 'My tournaments',
      进行中: 'In progress',
      已结束: 'Finished',
      待审核: 'Pending review',
      已取消: 'Cancelled',
      报名: 'Sign up',
      取消报名: 'Withdraw',
      已报名: 'Signed up',
      报名名单: 'Entrants',
      待批准: 'Pending approval',
      批准: 'Approve',
      拒绝: 'Reject',
      全部批准: 'Approve all',
      开始比赛: 'Start tournament',
      取消赛事: 'Cancel tournament',
      存档赛事: 'Archive tournament',
      对阵表: 'Bracket',
      名次表: 'Standings',
      赛程: 'Schedule',
      冠军: 'Champion',
      轮空: 'Bye',
      主办: 'Host',
      主办人: 'Host',
      主办人管理面板: 'Organiser panel',
      管理员: 'Administrator',
      参赛人数: 'Players',
      创建赛事: 'Create tournament',
      赛事名称: 'Tournament name',
      举办理由: 'Reason for hosting',
      赛制: 'Format',
      单败淘汰: 'Single elimination',
      瑞士制: 'Swiss system',

      // ---- 登录/账号 ----
      登录: 'Sign in',
      退出登录: 'Sign out',
      用户名: 'Username',
      密码: 'Password',
      注册: 'Register',
      账号: 'Account',
      游客: 'Guest',
      升级为账号: 'Upgrade to an account',

      // ---- 常见服务端消息 ----
      '还没轮到你': 'Not your turn yet',
      '非法走法': 'Illegal move',
      '未知的手合割': 'Unknown handicap',
      '你已在对局中，请先结束当前对局': 'You are already in a game — finish it first',
      '对局尚未结束': 'The game is not over yet',
      '房间不存在': 'Room not found',
      '房间已满': 'Room is full',
      '需要密码': 'Password required',
      '密码错误': 'Wrong password',
      '请输入 6 位房间码': 'Enter the 6-character room code',
      '你不在对局中': 'You are not in a game',
      '对手已离开': 'The opponent left',
      '服务器内部错误': 'Internal server error',
      '网络异常，正在重连…': 'Network problem — reconnecting…',
      '已重新连接': 'Reconnected',
      '行动超时': 'Move timed out',
      '时间切れ': 'Out of time',
      该房间需要密码: 'This room requires a password',

      // ---- 页面标题与首页补充 ----
      'TDShogi · 在线将棋对战平台': 'TDShogi · Online shogi platform',
      'TDShogi · 猹狸的将棋道场': 'TDShogi · Shogi Dojo',
      '平台实时数据': 'Live platform stats',
      '三步开始': 'Get started in three steps',
      '⏱ 持钟：包干与本手持读秒': '⏱ Clocks: sudden death and per-move byoyomi',
      '常规时制为每方「10+0」包干用时；快棋采用「0+10」形式——不设总时长，每手棋 10 秒读秒，超时即负。时间耗尽前留意读秒提示音。':
        'The standard control is 10+0 sudden death per side; bullet uses 0+10 — no total time, 10 seconds per move, and running out loses. Listen for the byoyomi cue.',

      // ---- 大厅补充 ----
      '对战 · TDShogi': 'Play · TDShogi',
      对战大厅: 'Play lobby',
      '一键匹配在线对手，两人即开，实时对局。': 'Match with an online player instantly — two players and you are live.',
      开始匹配: 'Start matching',
      '正在寻找对手…': 'Looking for an opponent…',
      点击下方按钮取消: 'Press the button below to cancel',
      复制房间码: 'Copy room code',
      '等待对手加入后自动开局…': 'The game starts automatically once your opponent joins…',
      '输入好友提供的 6 位房间码加入对局。': 'Enter the 6-character code your friend gave you.',
      '进行中的对局（观战）': 'Games in progress (spectate)',
      '输入房间码，如 AB3X7Q': 'Enter the room code, e.g. AB3X7Q',

      // ---- 对局页补充 ----
      '对局 · TDShogi': 'Game · TDShogi',
      '👁 观战中': '👁 Spectating',
      '🔄 视角·先手': '🔄 View · Black',
      '🎤 感想战中': '🎤 Review mode',
      '🙋 我来演示': '🙋 Let me demonstrate',
      '🤝 交给对方': '🤝 Hand over',
      '↩️ 待った': '↩️ Take back',
      '🗑 清空推演': '🗑 Clear line',
      '⏭ 回到最新': '⏭ Back to latest',
      '✋ 自由摆棋': '✋ Free placement',
      '按规则行棋 · 不计入棋谱': 'Legal moves only · not saved to records',
      '观众（': 'Spectators (',
      提交举报: 'Submit report',
      '是否升变？': 'Promote?',
      不成: 'Don’t promote',
      成: 'Promote',
      '切换观战视角（先手 / 后手）': 'Switch viewpoint (Black / White)',
      音效开关: 'Sound on/off',
      '入玉宣言：玉在敌阵 + 敌阵内 10 枚以上 + 点数先手 28 / 后手 27 以上，且自己手番、未被王手 → 宣言方胜（AJSA 规则）':
        'Nyugyoku declaration: your king in the enemy camp, 10+ of your pieces in the enemy camp, 28 points (Black) or 27 (White), on your turn and not in check → the declaring side wins (AJSA rules).',
      '举报对手：作弊 / 辱骂 / 恶意挂机等': 'Report opponent: cheating / abuse / idling, etc.',
      '补充说明（可选）': 'Additional details (optional)',

      // ---- 赛事详情 ----
      '赛事详情 · TDShogi': 'Tournament · TDShogi',
      // 注意与上面的 `加载中` 是**两条**：原文一个带省略号一个不带，键必须与原文一致
      '加载中…': 'Loading…',

      // ---- 赛事列表 ----
      '赛事 · TDShogi': 'Tournaments · TDShogi',
      棋手赛事: 'Tournaments',
      '单败淘汰 / 瑞士制 · 报名满员自动开赛 · 赛事对局不计 ELO':
        'Single elimination / Swiss · starts automatically when full · tournament games are unrated',
      '🏆 我要创建赛事': '🏆 Create a tournament',
      '← 返回全部赛事': '← All tournaments',
      进行中的赛事: 'Ongoing tournaments',
      往期赛事: 'Past tournaments',
      赛事创建申请: 'Tournament application',
      '4 人': '4 players',
      '8 人': '8 players',
      '16 人': '16 players',
      '32 人': '32 players',
      '瑞士制（积分编排）': 'Swiss system',
      '循环赛（待实装）': 'Round-robin (not yet available)',
      '轮数（瑞士制）': 'Rounds (Swiss)',
      '按人数自动（推荐）': 'Automatic by player count (recommended)',
      '3 轮': '3 rounds',
      '4 轮': '4 rounds',
      '5 轮': '5 rounds',
      '6 轮': '6 rounds',
      '7 轮': '7 rounds',
      '8 轮': '8 rounds',
      '9 轮': '9 rounds',
      '瑞士制按积分逐轮配对（强者遇强者、不重复对阵），没有淘汰——输一两场仍有机会。':
        'Swiss pairs players by score each round (strong vs strong, no repeat pairings) with no elimination — losing a game or two still leaves you in it.',
      '人数为奇数时，每轮积分最低且未轮空过的一人轮空（视同胜）。':
        'With an odd number of players, the lowest-scoring player who has not yet had a bye sits out (counted as a win).',
      '举办理由（10–200 字，管理员据此审核）': 'Why you are hosting (10–200 chars; admins review this)',
      报名开始: 'Registration opens',
      报名结束: 'Registration closes',
      比赛开始: 'Play starts',
      比赛结束: 'Play ends',
      '报名需我审核（关闭则报名即参赛）': 'I approve sign-ups (if off, signing up is entering)',
      提交后进入: 'Submitting sends it to',
      管理员审核: 'admin review',
      '，通过后才开放报名。': ', and registration opens only after approval.',
      主办人不会自动参赛: 'The host does not enter automatically',
      '——想下棋请另外报名。': ' — sign up separately if you want to play.',
      '时间未填写的项视为「不限」。': 'Any time field left empty means “no limit”.',
      提交申请: 'Submit application',
      '如：暑期棋王赛': 'e.g. Summer Shogi Cup',
      '说明办赛目的、面向人群、赛程安排等': 'Describe the purpose, the intended players, the schedule, etc.',

      // ---- 个人页 ----
      '个人 · TDShogi': 'Profile · TDShogi',
      '当前为游客身份。注册账号后，你的对局、积分与棋谱将绑定到账号，可在任意浏览器登录继续。注册会保留当前游客的全部数据。':
        'You are playing as a guest. Register and your games, rating and records attach to the account, usable from any browser. Your current guest data is kept.',
      注册新账号: 'Register a new account',
      注册并保留游客数据: 'Register and keep guest data',
      已有账号登录: 'Sign in to an existing account',
      '已登录账号 · ID:': 'Signed in · ID:',
      '游客账号 · ID:': 'Guest · ID:',
      改名: 'Rename',
      '🎨 换头像': '🎨 Change avatar',
      '选一个头像（点击即生效）': 'Pick an avatar (applies immediately)',
      'ELO 积分': 'ELO rating',
      '📋 我的资料': '📋 My details',
      手机号: 'Phone',
      '（不公开显示，仅管理员可见）': '(not public — admins only)',
      '棋风（公开显示）': 'Style (public)',
      不设定: 'Not set',
      '居飞车·急战': 'Static rook · rapid attack',
      '居飞车·持久战': 'Static rook · slow game',
      振飞车: 'Ranging rook',
      力战型: 'Fighting style',
      奇袭型: 'Surprise style',
      接受型: 'Counter style',
      '注册日期：': 'Registered:',
      保存资料: 'Save details',
      对局数: 'Games',
      平: 'D',
      'ELO 走势': 'ELO trend',
      最近对局: 'Recent games',
      '用户名（2-16 字符）': 'Username (2–16 characters)',
      '密码（至少 4 位）': 'Password (at least 4 characters)',
      确认密码: 'Confirm password',
      点击更换头像: 'Click to change avatar',
      '修改名字（12 字内）': 'Change name (up to 12 characters)',
      '11 位手机号，留空清除': '11-digit phone number; leave empty to clear',

      // ---- 棋谱广场 ----
      '棋谱广场 · TDShogi': 'Gallery · TDShogi',
      '🏆 棋谱广场': '🏆 Gallery',
      '管理员精选的公开棋谱（赛事名局、经典对局）。点击任一局进入复盘。':
        'Public records picked by the admins (tournament highlights, classic games). Click one to review it.',
      全部标签: 'All tags',
      搜索: 'Search',
      '搜索双方名 / 标题 / 赛事': 'Search players / title / event',

      // ---- 棋谱列表 ----
      '棋谱 · TDShogi': 'Games · TDShogi',
      棋谱管理: 'My games',
      '🌐 棋谱广场 →': '🌐 Gallery →',
      '对局记录（仅自己的）': 'Your games only',
      全部结果: 'All results',
      先手胜: 'Black wins',
      后手胜: 'White wins',
      检索: 'Search',
      重置: 'Reset',
      '点击任意棋谱进入「复盘器」，可前进/后退、加书签、写评论、保存变着，并导出 KIF/CSA。':
        'Click any record to open the reviewer: step back and forth, add bookmarks and comments, save variations, and export KIF/CSA.',
      从左侧选择棋谱进入复盘器: 'Pick a record on the left to start reviewing',
      感想战式的复盘分析: 'Review and analysis',
      浏览公开棋谱: 'Browse the gallery',
      '关键词（选手名）': 'Keyword (player name)',
      '开局（如 7g7f,3c3d）': 'Opening moves (e.g. 7g7f,3c3d)',
      '手数范围（如 20-80）': 'Move range (e.g. 20-80)',

      // ---- 复盘器 ----
      '复盘 · TDShogi': 'Review · TDShogi',
      '加载棋谱中…': 'Loading record…',
      返回棋谱列表: 'Back to game list',
      先手: 'Black',
      後手: 'White',
      '🔄 翻转视角': '🔄 Flip viewpoint',
      '🛡️ 管理员：对局信息与展示设置': '🛡️ Admin: game info and visibility',
      标题: 'Title',
      轮次: 'Round',
      对局日期: 'Date',
      '标签（逗号分隔）': 'Tags (comma separated)',
      先手展示名: 'Black display name',
      後手展示名: 'White display name',
      结果说明: 'Result note',
      广场置顶: 'Pin in gallery',
      简介: 'Description',
      保存对局信息: 'Save game info',
      '私有（仅谱主可见）': 'Private (owner only)',
      '公开（广场可见）': 'Public (visible in gallery)',
      应用可见性: 'Apply visibility',
      // ⚠️ 这里只能写带全角冒号的原文：`显示`（设置面板的分组标题）已经在上面定义过，
      // 再写一遍会被**静默覆盖**（这条就是被 tests/i18n.test.js 的重复键自检抓出来的）。
      '显示：': 'Show:',
      日式: 'Japanese',
      '◀ 上一手': '◀ Previous',
      '下一手 ▶': 'Next ▶',
      '末手 ⏭': 'Last ⏭',
      '✋ 自由摆放': '✋ Free placement',
      '↩️ 撤销摆放': '↩️ Undo placement',
      当前手: 'Current move',
      '↪ 添加变着': '↪ Add variation',
      保存变着: 'Save variation',
      本手已存在变着: 'A variation already exists here',
      '切换先手 / 后手视角': 'Switch Black / White viewpoint',
      展示在广场卡片上的一句话说明: 'One-line note shown on the gallery card',
      '在当前局面上自由摆放棋子（草稿，不入谱）': 'Place pieces freely on the current position (a draft, not recorded)',
      '评论当前手…': 'Comment on this move…',
      '走法 USI，如 7g7f 或 P*5e': 'Move in USI, e.g. 7g7f or P*5e',
      '说点什么…': 'Say something…',
    },
  };

  // ==================================================================
  // 核心
  // ==================================================================
  const key = STORAGE_KEY;
  let locale = 'zh-CN';
  try {
    const saved = localStorage.getItem(key);
    if (saved && LOCALES.some((l) => l.id === saved)) locale = saved;
  } catch (_) { /* 隐私模式下 localStorage 会抛错：用默认语言即可，不影响对局 */ }

  /** 词条原文（DOM 节点原始中文）→ 避免切回中文时"查英文表" */
  const srcOf = new WeakMap();
  let observer = null;

  /** 去空白索引：中文排版里空格不承载语义，而「天锻将棋 道场」这类写法很常见 */
  const normIdx = {};
  function indexOf(l) {
    if (!normIdx[l]) {
      const m = new Map();
      for (const [k, v] of Object.entries(DICT[l] || {})) {
        const nk = k.replace(/\s+/g, '');
        if (!m.has(nk)) m.set(nk, v);
      }
      normIdx[l] = m;
    }
    return normIdx[l];
  }

  /** 开头的 emoji/图形字符（含变体选择符与 ZWJ），如「🏠 创建房间」的前缀 */
  const LEAD_EMOJI = /^((?:[\p{Extended_Pictographic}\uFE0F\u200D]+\s*)+)/u;

  /**
   * 查词，三级宽松匹配（都是**安全**的：只会跨过空白与"开头图标"这类排版差异，
   * 不会把另一句话当成同一句）。
   *
   * 1. 整段精确匹配；
   * 2. 去掉全部空白再匹配（`天锻将棋 道场` ↔ `天锻将棋道场`）；
   * 3. 前缀 emoji **原样保留**、其余部分再匹配（`🏠 创建房间` → `🏠 ` + Create a room）。
   *
   * 有了第 2、3 条，词典里就不必为「带 emoji 的同一个词」再抄一遍，
   * 否则每加一个图标都要多维护一条，迟早漏。
   */
  function lookup(l, s) {
    const d = DICT[l];
    if (!d) return undefined;
    if (Object.prototype.hasOwnProperty.call(d, s)) return d[s];
    const idx = indexOf(l);
    const ns = s.replace(/\s+/g, '');
    if (idx.has(ns)) return idx.get(ns);
    const m = LEAD_EMOJI.exec(s);
    if (m) {
      const rest = s.slice(m[0].length);
      if (Object.prototype.hasOwnProperty.call(d, rest)) return m[0] + d[rest];
      const rn = rest.replace(/\s+/g, '');
      if (idx.has(rn)) return m[0] + idx.get(rn);
    }
    return undefined;
  }

  function subst(text, vars) {
    if (!vars) return text;
    return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));
  }

  /**
   * 取译文。
   * @param {string} text 中文原文（找不到译文时**原样返回**——宁可显示中文，也不要显示 key）
   * @param {object} [vars] `{n}` 变量
   */
  function t(text, vars) {
    if (text == null) return text;
    const s = String(text);
    if (locale === 'zh-CN') return subst(s, vars);
    const hit = lookup(locale, s);
    return subst(hit === undefined ? s : hit, vars);
  }

  /** 保留首尾空白（缩进/换行是排版的一部分，替换文本时不能吃掉） */
  function swap(node, translated) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(node.textContent);
    if (!m) return translated;
    return m[1] + translated + m[3];
  }

  function translateNode(node) {
    const raw = srcOf.has(node) ? srcOf.get(node) : node.textContent;
    if (!raw || !raw.trim()) return;
    if (!srcOf.has(node)) srcOf.set(node, raw);
    const out = t(raw.trim());
    const next = swap(node, out);
    if (node.textContent !== next) node.textContent = next; // 相同则不写，避免触发观察器空转
  }

  const ATTRS = ['placeholder', 'title', 'aria-label'];

  function translateEl(el) {
    for (const a of ATTRS) {
      if (!el.hasAttribute || !el.hasAttribute(a)) continue;
      const raw = el.getAttribute(a);
      if (!raw || !raw.trim()) continue;
      const out = t(raw.trim());
      if (out !== raw) el.setAttribute(a, out);
    }
  }

  /** 扫描一棵子树（静态页面加载时、或切换语言时、或 JS 渲染出新内容后） */
  function apply(root) {
    if (locale === 'zh-CN') return; // 中文：不需要做任何事（默认语言零开销）
    const node = root || document.body;
    if (!node) return;
    if (node.nodeType === 3) { translateNode(node); return; }
    if (node.nodeType === 1) translateEl(node);
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n.nodeType === 3) {
        // 跳过 style/script 里的文本
        const p = n.parentNode;
        if (p && (p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE')) continue;
        translateNode(n);
      } else {
        translateEl(n);
      }
    }
  }

  /** 切换语言：把已翻译的节点按原文重扫一遍，并通知页面重渲染动态文案 */
  function setLocale(id) {
    if (!LOCALES.some((l) => l.id === id)) return false;
    locale = id;
    try { localStorage.setItem(key, id); } catch (_) {}
    if (document.documentElement) document.documentElement.lang = id === 'en' ? 'en' : 'zh-CN';
    // 先把已有节点**还原成原文**再扫描：否则英文会被当成"原文"再查一次表
    // （守卫 DOM 能力：单元测试里没有 document.querySelectorAll，不该因此抛错）
    if (document.querySelectorAll) {
      document.querySelectorAll('*').forEach((el) => {
        if (el.childNodes) {
          el.childNodes.forEach((n) => {
            if (n.nodeType === 3 && srcOf.has(n)) n.textContent = srcOf.get(n);
          });
        }
      });
    }
    apply(document.body);
    startObserver();
    // 导航栏等由 JS 渲染的内容需要重建（新节点会被观察器接住，但重建本身得有人叫）
    if (window.NAV && window.NAV.rerender) { try { window.NAV.rerender(); } catch (_) {} }
    return true;
  }

  function current() {
    return LOCALES.find((l) => l.id === locale) || LOCALES[0];
  }

  /** 轮换到下一种语言（导航栏那个小按钮用） */
  function cycle() {
    const i = LOCALES.findIndex((l) => l.id === locale);
    return setLocale(LOCALES[(i + 1) % LOCALES.length].id);
  }

  /**
   * JS 动态渲染后如果调用 `apply()` 不方便，就靠观察器兜住。
   * ⚠️ 只在非中文时启用——中文用户的默认路径上不该多一个全局观察器。
   */
  function startObserver() {
    if (locale === 'zh-CN' || observer || typeof MutationObserver !== 'function') return;
    observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') { translateNode(r.target); continue; }
        r.addedNodes.forEach((n) => {
          if (n.nodeType === 1 || n.nodeType === 3) apply(n);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function init() {
    if (document.documentElement) document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
    apply(document.body);
    startObserver();
  }

  window.I18N = {
    LOCALES,
    t,
    apply,
    setLocale,
    cycle,
    current,
    init,
    /** 仅供测试与工具：词典本体 + 查词函数（`scripts/i18n-report.js` 用它算覆盖率） */
    _dict: DICT,
    _lookup: lookup,
  };
  window.t = t; // JS 里直接 `t('...')`（与其它全局工具一致，本项目无模块系统）

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
