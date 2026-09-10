/**
 * play.js — 对局页逻辑
 *
 *  - 状态同步（state 消息全量渲染）
 *  - 走子交互：点己方棋子/持驹 → 高亮合法目标 → 点目标格落子
 *  - 升变：存在成/不成两种走法时弹层选择
 *  - 棋钟：本地倒计时 + 服务端 clock 消息校准
 *  - 认输 / 再来一局 / 退出 / 观战模式
 */
(function () {
  const guest = window.NAV.renderNav('play');
  const api = window.API;
  api.connect(guest.id);

  const board = new window.ShogiBoard(document.getElementById('boardContainer'), {});

  let state = null;       // 最新对局状态
  let mySeat = null;      // 'b' | 'w' | null（观战）
  let isPlayer = false;
  let selected = null;    // 当前选中的起点（格名或打子符号）
  let targets = [];       // 当前选中起点的合法目标
  let pendingPromote = null; // { usi, nonPromoteUsi, promoteUsi }
  // 棋钟状态与逻辑已抽到 play-clock.js（PLAN §M5）：本时剩余 / 读秒 / tick 都在那边
  // 统一棋盘组件（PLAN §G v6）：play 模式行棋 / 终局切感想战（demo-rules）/ 自由摆棋
  let fb = null;                  // FreeBoard 控制器（棋盘交互与拖拽）
  let reviewActive = false;       // 感想战模式中
  let demoInfo = null;            // 推演谱（服务端 v4 载荷）
  let demoCursor = 0;             // 联合谱浏览位置
  let originalPositions = null;   // 原谱各手局面缓存
  let pendingDemoPromo = null;    // 感想战升变选择
  let spectatorViewpoint = 'b';   // 观战视角（PLAN §R1）：仅观战者生效，可切 'b' / 'w'
  // 感想战「自由摆棋」模式（本地草稿，不入谱不同步）。
  // 注：此前漏写声明 → 赋值时创建了**隐式全局 `window.freeMode`**（非严格模式不报错），
  // 属跨脚本污染隐患（PLAN §P2 eslint 抓出）。必须在此显式声明。
  let freeMode = false;

  // 时间控制预设（与服务端 TIME_CONTROLS 对应）
  const TIME_CONTROLS = {
    '15+60': { name: '15分钟 + 60秒' },
    '10+30': { name: '10分钟 + 30秒' },
    '10:00': { name: '10分钟包干' },
    '10sec': { name: '10秒快棋' },
  };

  // 公共工具（PLAN §M5）：实现统一在 util.js，此处只转发，避免"抄多份、改一处漏九处"
  const $ = (id) => window.UI.$(id);
  function toast(msg) { return window.UI.toast(msg); }

  // ==================================================================
  // 渲染
  // ==================================================================
  /** 当前棋盘视角：对局者固定自己视角；观战者可切换（PLAN §R1） */
  function currentViewpoint() {
    return isPlayer ? (mySeat === 'w' ? 'w' : 'b') : spectatorViewpoint;
  }

  /**
   * 玩家栏渲染（名字 / ELO / 悬停信息卡所需的 data-player-id）。
   *
   * ⚠️ 必须独立成函数：终局时 `api.on('state')` 走的是 `enterDemo(state); return;`
   * ——**跳过了 render()**。此前玩家栏只写在 render() 里，于是「重进到一个已结束的房间」
   * 的人（首个 state 就是 FINISHED）玩家栏从未被渲染：显示占位符，且双方
   * `data-player-id` 为空导致悬停信息卡失效。
   * 这正是「退出再进来后看不到双方 id」的根因，重进者才中招、一直在页面上的人不受影响。
   */
  function renderPlayerBars(st) {
    const players = st.players || {};
    const viewpoint = currentViewpoint();
    // 视角布局：上方=对面，下方=自己
    const oppSeat = viewpoint === 'b' ? 'w' : 'b';
    const mySeatX = viewpoint === 'b' ? 'b' : 'w';

    // 上方（对面）玩家栏
    const opp = players[oppSeat];
    const oppDisconnected = opp && opp.connected === false && st.status === 'PLAYING';
    $('topName').textContent = (opp && opp.name) || (oppSeat === 'b' ? '先手' : '後手');
    $('topName').setAttribute('data-player-id', (opp && opp.id) || ''); // 悬停信息卡
    $('topRating').textContent = oppDisconnected
      ? '⚠️ 断线 · 60秒内未重连将判你获胜'
      : (opp ? `ELO ${opp.rating}` : '');
    $('topPlayerBar').classList.toggle('disconnected', !!oppDisconnected);
    $('topPlayerBar').classList.toggle('active', st.turn === oppSeat && !oppDisconnected);

    // 下方（自己）玩家栏：名字优先显示自己账号名（localStorage），对手用服务端名
    const me = players[mySeatX];
    const myName = guest && guest.name ? guest.name : (me && me.name) || (mySeatX === 'b' ? '先手' : '後手');
    $('bottomName').textContent = myName;
    $('bottomName').setAttribute('data-player-id', (me && me.id) || '');
    $('bottomRating').textContent = me ? `ELO ${me.rating}` : '';
    $('bottomPlayerBar').classList.toggle('active', st.turn === mySeatX);
  }

  /**
   * 手机/平板端首次拿到局面后，把棋盘滚到视口内（PLAN §S2）。
   * 此前首屏停在顶部信息栏与侧栏，要往下滚才见到棋盘——对一个下棋应用来说主次颠倒。
   * 只用一次（后续走子不应打断用户正在看的内容），宽屏不执行。
   */
  let boardScrolled = false;
  function scrollBoardIntoViewOnce() {
    if (boardScrolled) return;
    boardScrolled = true;
    if (window.innerWidth > 900) return;
    const el = $('boardContainer');
    if (!el) return;
    setTimeout(() => {
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
    }, 80);
  }

  function render(state) {
    const viewpoint = currentViewpoint();
    renderPlayerBars(state);

    // 房间信息 + 时间控制
    const tcName = TIME_CONTROLS[state.timeControl] ? TIME_CONTROLS[state.timeControl].name : '';
    $('roomCodeLabel').textContent = state.code ? `房间 ${state.code}` : '对局';
    if (tcName) $('roomCodeLabel').textContent += ` · ${tcName}`;

    // 观战标识
    const spectator = !isPlayer;
    $('spectatorTag').style.display = spectator ? 'inline' : 'none';
    $('btnResign').style.display = spectator ? 'none' : 'inline';
    // §R1：视角切换按钮仅观战者可见，文字反映当前视角
    const vpBtn = $('btnViewpoint');
    if (vpBtn) {
      vpBtn.style.display = spectator ? 'inline' : 'none';
      vpBtn.textContent = viewpoint === 'b' ? '🔄 视角·先手' : '🔄 视角·後手';
    }

    // 棋钟初始 + 读秒（PLAN §M5：逻辑已抽到 play-clock.js）
    window.PlayClock.syncFromState(state);

    // 感想战中：棋盘由推演谱渲染（state 推送仅更新横幅/时钟等周边）
    if (reviewActive && fb) {
      fb.setViewpoint(viewpoint); // §R1：观战者在感想战中也能切视角
      if (state.status === 'FINISHED') { applyDemoMode(); }
      updateDemoUI();
      return;
    }

    // 棋盘渲染与交互统一交给 FreeBoard 组件（PLAN §G v6）
    ensureBoard(viewpoint);
    fb.setViewpoint(viewpoint); // §R1：切换观战视角（内部同视角则空转）
    fb.setModel({ board: state.board, hands: state.hands }, state.lastMove);
    // §J2：王手格此前作为第三个参数传给 setModel 被丢弃，改用专门的 setCheck
    fb.setCheck(state.check ? [findKingSq(state, state.turn)] : []);
    fb.setLegalTargets(state.legalTargetsBySq || {});
    fb.setTurn(state.turn); // 手番方持驹才可点选（打子符号与颜色无关，防误选对手驹台）
    const canMove = isPlayer && state.status === 'PLAYING' && mySeat === state.turn;
    fb.setInteractive(canMove);
    fb.render();
    renderMoveList(state);
    // 观众列表：进场时用 state 快照初始化（此前只有 spectator_update 才渲染，
    // 导致刚进入的观战者一直看到"暂无观众"，直到有人进出才更新）
    if (state.spectators) renderSpectators(state.spectators);

    // 胜负横幅
    if (state.result) {
      showResult(state);
      const isTournament = state.roomType === 'tournament';
      $('btnRematch').style.display = (isPlayer && !isTournament) ? 'inline' : 'none';
      $('bannerRematch').style.display = (isPlayer && !isTournament) ? 'inline' : 'none';  // 观战者/赛事局不可点再来一局
    } else {
      $('banner').classList.remove('show');
      $('btnRematch').style.display = 'none';
    }
  }

  function findKingSq(st, color) {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = st.board[r][c];
        if (cell && cell.piece && cell.color === color && (cell.piece === '玉' || cell.piece === '王')) {
          return cell.sq;
        }
      }
    }
    return null;
  }

  function renderHands(st) {
    const vp = mySeat === 'w' ? 'w' : 'b';
    const oppSeat = vp === 'b' ? 'w' : 'b'; // 对手在左
    const mySeatH = vp;                       // 自己在右
    // 左侧 = 对手持驹（不可操作）；以自己视角渲染，对手棋子朝下
    window.renderHands($('oppHandPieces'), st.hands, oppSeat, null, vp);
    // 右侧 = 自己持驹（可操作打子）；以自己视角渲染，自己棋子正立
    window.renderHands($('myHandPieces'), st.hands, mySeatH, (piece) => onSelectPiece(piece, mySeatH), vp);
  }

  function renderMoveList(st) {
    const el = $('moveList');
    const moves = st.moves || [];
    const kif = st.movesKif || [];
    if (!moves.length) {
      el.innerHTML = '<div style="color:var(--text-dim);font-size:12px;">尚未走子</div>';
      return;
    }
    // 每手耗时（KIF 消費時間/累計時間样式）
    const times = st.moveTimes || [];
    let cum = 0;
    const fmt = (sec) => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    el.innerHTML = moves.map((m, i) => {
      const player = i % 2 === 0 ? '▲' : '△';
      const label = kif[i] || m;
      const spent = Number(times[i]) || 0;
      cum += spent;
      const timeTxt = (spent || cum) ? ' <span style="color:var(--text-dim);font-size:11px;">(' + fmt(spent) + '/' + fmt(cum) + ')</span>' : '';
      return `<div class="move-row"><span class="no">${i + 1}</span><span>${player} ${label}${timeTxt}</span></div>`;
    }).join('');
    el.scrollTop = el.scrollHeight;
  }

  // 棋钟已抽到 play-clock.js（PLAN §M5）：此处只做一次依赖注入。
  // 注入的是模块内读不到的两个"外部状态"——在 play.js 里它们是闭包变量：
  //   state → 最新对局状态（判断是否 PLAYING、谁的回合）
  //   视角  → 与棋盘**共用 `currentViewpoint()`**，保证两者永远同一口径
  //          （对局者固定自己视角；观战者跟随可切换的 spectatorViewpoint）
  window.PlayClock.init({
    getState: function () { return state; },
    getViewpoint: function () { return currentViewpoint(); },
  });

  // ==================================================================
  // 走子交互
  // ==================================================================
  function onSelectPiece(pieceName, color) {
    if (color !== mySeat) return;      // 只能操作自己持驹
    if (state.turn !== mySeat) return; // 未轮到自己
    const sym = window.DROP_SYMBOLS && Object.keys(window.DROP_SYMBOLS).find((k) => window.DROP_SYMBOLS[k] === pieceName);
    if (!sym) return;
    setSelection(sym);
  }

  function setSelection(from) {
    selected = from;
    const legalBySq = (state && state.legalTargetsBySq) || {};
    targets = legalBySq[from] || [];
    // 重绘高亮
    reapplySelection();
  }

  function reapplySelection() {
    const st = state;
    const checkSqs = st.check ? [findKingSq(st, st.turn)] : [];
    const viewpoint = mySeat === 'w' ? 'w' : 'b';
    board.render(st, {
      lastMove: st.lastMove,
      check: checkSqs,
    }, viewpoint);
    // 叠加选中与目标
    if (selected) board.highlightSq(selected, 'sel');
    targets.forEach((t) => {
      const cell = board._findCell(t.to);
      if (cell) {
        // 先清旧类再添加：避免残留 has-piece（方块）污染空格目标（应为绿点）
        cell.classList.remove('target', 'has-piece');
        cell.classList.add('target');
        // 有棋子的目标格 → 绿色方块；空位 → 绿点
        if (cell.innerHTML) cell.classList.add('has-piece');
      }
    });
  }

  function bindBoardClicks(canMove, st) {
    // 重新绑定棋盘格点击（使用事件委托，绑在容器上避免重复绑定）
    const boardEl = board.boardEl;
    boardEl.onclick = (e) => {
      if (!canMove) return;
      const cell = e.target.closest('.cell');
      if (!cell) return;
      const sq = cell.dataset.sq;
      if (!sq) return;
      if (selected) {
        // 有选中：尝试落子
        const t = targets.find((x) => x.to === sq);
        if (t) {
          handleTarget(t);
        } else {
          // 未点中合法目标：若点是己方棋子则改选
          setSelection(sq);
        }
      } else {
        // 无选中：尝试选中己方棋子
        setSelection(sq);
      }
    };
  }

  function handleTarget(t) {
    // 升变：同一 from→to 同时有成与不成
    const cands = targets.filter((x) => x.to === t.to);
    const hasPromote = cands.some((x) => x.promote);
    const hasNonPromote = cands.some((x) => !x.promote);
    if (hasPromote && hasNonPromote && selected && !selected.startsWith('P*') && !/^[PLNSGBR]$/.test(selected)) {
      // 弹层
      const promoteUsi = cands.find((x) => x.promote).usi;
      const nonPromoteUsi = cands.find((x) => !x.promote).usi;
      pendingPromote = { promoteUsi, nonPromoteUsi };
      $('promoteOverlay').classList.add('show');
      return;
    }
    // 直接走
    sendMove(t.usi);
  }

  function sendMove(usi) {
    api.send({ type: 'move', data: { usi } });
    selected = null;
    targets = [];
    // 立即移除本地高亮（否则走子后绿点/方块残留直到服务器推送）
    clearHighlights();
  }

  /** 清除棋盘上的选中/目标/方块高亮类 */
  function clearHighlights() {
    if (!board || !board.boardEl) return;
    board.boardEl.querySelectorAll('.cell.sel, .cell.target, .cell.has-piece').forEach((c) => {
      c.classList.remove('sel', 'target', 'has-piece');
    });
  }

  // 升变按钮（对局走子 / 感想战演示共用弹层）
  // 感想战分支必须走 demo_move 通道（带光标 index）；sendMove() 硬编码 type:'move' 不能复用
  $('btnPromote').addEventListener('click', () => {
    if (pendingDemoPromo) api.send({ type: 'demo_move', data: { usi: pendingDemoPromo.usiPromote, index: demoCursor } });
    else if (pendingPromote) sendMove(pendingPromote.promoteUsi);
    $('promoteOverlay').classList.remove('show');
    pendingPromote = null;
    pendingDemoPromo = null;
  });
  $('btnNoPromote').addEventListener('click', () => {
    if (pendingDemoPromo) api.send({ type: 'demo_move', data: { usi: pendingDemoPromo.usiMove, index: demoCursor } });
    else if (pendingPromote) sendMove(pendingPromote.nonPromoteUsi);
    $('promoteOverlay').classList.remove('show');
    pendingPromote = null;
    pendingDemoPromo = null;
  });

  // 认输 / 再来一局 / 退出
  $('btnResign').addEventListener('click', () => {
    if (confirm('确定认输吗？')) api.send({ type: 'resign' });
  });
  $('btnRematch').addEventListener('click', () => {
    api.send({ type: 'rematch' });
  });
  $('bannerRematch').addEventListener('click', () => {
    api.send({ type: 'rematch' });
    $('banner').classList.remove('show');
  });
  $('btnLeave').addEventListener('click', () => {
    api.send({ type: 'leave' });
    // 赛事对局退出回赛事页，其余回大厅
    location.href = (state && state.roomType === 'tournament') ? 'tournaments.html' : 'lobby.html';
  });
  // §R1：观战视角切换（先手 ⇄ 后手）。仅观战者可用——对局者固定自己视角。
  $('btnViewpoint').addEventListener('click', () => {
    if (isPlayer) return;
    spectatorViewpoint = spectatorViewpoint === 'b' ? 'w' : 'b';
    if (state) render(state);
    else if (fb) fb.setViewpoint(spectatorViewpoint);
  });

  function showResult(st) {
    const names = st.players || {};
    const winnerName = st.result === 'b' ? (names.b && names.b.name) : st.result === 'w' ? (names.w && names.w.name) : null;
    const loserName = st.result === 'b' ? (names.w && names.w.name) : st.result === 'w' ? (names.b && names.b.name) : null;
    let text;
    if (st.resultDetail === '投了') {
      text = `${loserName || '一方'} 投了 · ${winnerName || ''} 胜`;
    } else if (st.resultDetail === '接続切断') {
      // 断线（中途退出/掉线超时）：提示对手掉线而非投了
      text = `${loserName || '对手'} 掉线断开 · ${winnerName || ''} 胜`;
    } else if (st.resultDetail === '詰み') {
      text = `${winnerName || '一方'} 詰み勝ち`;
    } else if (st.resultDetail === '時間切れ') {
      text = `${winnerName || '一方'} 时间切れ勝ち`;
    } else if (st.result === '-') {
      text = `${st.resultDetail || '和棋'}`;
    } else {
      text = '对局结束';
    }
    $('bannerText').textContent = text;
    $('banner').classList.add('show');
  }

  // ==================================================================
  // WS 事件
  // ==================================================================
  let lastMoveCount = 0;      // 上次已知手数（用于音效触发）
  let lastPieceCount = 81;    // 上次棋盘棋子总数（吃子判定）
  function countPieces(st) {
    let n = 0;
    const b = st.board;
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      if (b[r][c] && b[r][c].piece) n++;
    }
    return n;
  }
  // 首次交互解锁音频（浏览器自动播放策略）
  document.addEventListener('pointerdown', () => {
    if (window.Sound) window.Sound.ensureCtx();
  }, { once: true });

  // 音效开关
  const btnSound = $('btnSound');
  function refreshSoundBtn() {
    if (!btnSound) return;
    btnSound.textContent = (window.Sound && window.Sound.isEnabled()) ? '🔊 音效' : '🔇 静音';
  }
  if (btnSound) {
    btnSound.addEventListener('click', () => {
      if (!window.Sound) return;
      window.Sound.setEnabled(!window.Sound.isEnabled());
      refreshSoundBtn();
      if (window.Sound.isEnabled()) window.Sound.playMove();  // 反馈音
    });
    refreshSoundBtn();
  }

  api.on('state', (data) => {
    const prevMoves = lastMoveCount;
    lastMoveCount = (data.moves || []).length;
    // 走子音效：手数增加（自己或对手走子）
    if (window.Sound && data.moves && data.moves.length > prevMoves) {
      const pieces = countPieces(data);
      if (pieces < lastPieceCount) window.Sound.playCapture();  // 吃子
      else window.Sound.playMove();                             // 普通落子
    }
    lastPieceCount = countPieces(data);
    state = data;
    mySeat = data.seat || null;
    isPlayer = data.isPlayer === true;
    window.PlayClock.resetTick(); // 以"此刻"为倒计时基准（原 `lastTickTs = Date.now()`）
    scrollBoardIntoViewOnce(); // §S2：手机端首屏直接落到棋盘
    // 感想战路由（PLAN §G v6）：终局自动进入；新对局自动退出
    if (state.status === 'FINISHED' && state.result) {
      enterDemo(state);
      return;
    }
    if (reviewActive) exitDemo();
    // 收到新状态时清空选中（如果对方走子则清）
    if (selected && mySeat !== state.turn) {
      selected = null;
      targets = [];
    }
    render(state);
  });

  // 棋钟校准（PLAN §M5：处理逻辑已抽到 play-clock.js）
  api.on('clock', (data) => window.PlayClock.syncFromServer(data));
  // 观战者名单（对局页右列观众列表，PLAN §R）
  // 兼容两种形态：字符串数组（旧）与 {id,name,rating,level}（新）
  function renderSpectators(list) {
    const countEl = $('spectatorCount');
    const el = $('spectatorList');
    if (!el) return;
    const items = (list || []).map((s) => (typeof s === 'string' ? { name: s } : (s || {})));
    if (countEl) countEl.textContent = items.length;
    el.innerHTML = items.length
      ? items.map((s) => {
        const attrs = s.id ? ` data-player-id="${escHtml(s.id)}"` : '';
        const lv = (s.level !== undefined && s.level !== null) ? ` <span style="color:var(--gold-light);font-size:11px;">Lv.${s.level}</span>` : '';
        return `<div style="padding:3px 0;">👤 <span${attrs} class="spectator-name">${escHtml(s.name || '观众')}</span>${lv}</div>`;
      }).join('')
      : '<div style="color:var(--text-dim);font-size:12px;">暂无观众</div>';
  }
  api.on('spectator_update', (d) => renderSpectators(d.spectators || []));

  // ==================================================================
  // 感想战模式（PLAN §G v6 单页）：终局自动进入，同一棋盘组件切 demo-rules
  // ==================================================================
  function demoEdge() {
    return demoInfo ? demoInfo.baseIndex + demoInfo.moves.length : 0;
  }

  function enterDemo(st) {
    // 终局分支会在 api.on('state') 里 enterDemo 后直接 return（不跑 render），
    // 所以玩家栏必须在这里补渲染一次，否则重进者永远看不到双方名字与 id
    renderPlayerBars(st);
    if (reviewActive && fb) { applyDemoMode(); updateDemoUI(); return; }
    reviewActive = true;
    freeMode = false;
    selected = null; targets = [];
    ensureBoard(currentViewpoint());
    demoInfo = st.demo || { moves: [], kif: [], baseIndex: (state.moves || []).length, baseCount: (state.moves || []).length, legalTargetsBySq: {}, legalMoves: [], turn: 'b', demonstratorSeat: null, demonstratorName: null };
    demoCursor = demoEdge();
    $('demoBar').style.display = 'flex';
    applyDemoMode();
    updateDemoUI();
    if (window.Sound) window.Sound.playEnd();
  }

  function exitDemo() {
    reviewActive = false;
    freeMode = false;
    demoInfo = null;
    pendingDemoPromo = null;
    $('demoBar').style.display = 'none';
  }

  function ensureBoard(viewpoint) {
    if (fb) return;
    fb = new window.FreeBoard({
      board,
      viewpoint,
      interactive: false,
      mode: 'play',
      hands: {
        my: $('myHandPieces'), myColor: viewpoint,
        opp: $('oppHandPieces'), oppColor: viewpoint === 'b' ? 'w' : 'b',
      },
      onMove: (usi) => {
        if (reviewActive) api.send({ type: 'demo_move', data: { usi, index: demoCursor } });
        else api.send({ type: 'move', data: { usi } });
      },
      onPromoteChoice: ({ usiMove, usiPromote }) => {
        if (reviewActive) pendingDemoPromo = { usiMove, usiPromote };
        else pendingPromote = { promoteUsi: usiPromote, nonPromoteUsi: usiMove };
        $('promoteOverlay').classList.add('show');
      },
    });
    fb.attach();
    fb.bindHands($('myHandPieces'), viewpoint, $('oppHandPieces'), viewpoint === 'b' ? 'w' : 'b');
  }

  function ensureOriginalPositions() {
    if (originalPositions) return originalPositions;
    const arr = [window.FreeBoard.initialModel()];
    for (const usi of (state.moves || [])) {
      const prev = arr[arr.length - 1];
      const model = { board: JSON.parse(JSON.stringify(prev.board)), hands: JSON.parse(JSON.stringify(prev.hands)) };
      const color = (arr.length - 1) % 2 === 0 ? 'b' : 'w';
      window.FreeBoard.applyUsiOnModel(model, usi, color);
      arr.push(model);
    }
    originalPositions = arr;
    return arr;
  }

  function applyDemoMode() {
    // 棋盘 = 联合谱 cursor 对应局面（原谱重放 + 推演叠加）
    const k = Math.min(demoCursor, demoEdge());
    const bi = demoInfo.baseIndex;
    const ops = ensureOriginalPositions();
    let model;
    if (k <= bi) model = ops[k];
    else {
      const basePos = ops[bi];
      model = { board: JSON.parse(JSON.stringify(basePos.board)), hands: JSON.parse(JSON.stringify(basePos.hands)) };
      for (let i = 0; i < k - bi; i++) {
        const color = (bi + i) % 2 === 0 ? 'b' : 'w';
        window.FreeBoard.applyUsiOnModel(model, demoInfo.moves[i], color);
      }
    }
    let lastMove = null;
    if (k > 0) lastMove = k <= bi ? ((state.moves || [])[k - 1] || null) : (demoInfo.moves[k - bi - 1] || null);
    fb.setModel(model, lastMove);
    fb.setLegalTargets(demoInfo.legalTargetsBySq || {});
  }

  // 公共工具（PLAN §M5）：与全站同一份实现（原函数名 escHtml 保留，调用点不动）
  function escHtml(s) { return window.UI.esc(s); }

  function renderDemoMoveList() {
    const el = $('moveList');
    if (!demoInfo) return;
    const bi = demoInfo.baseIndex;
    const base = demoInfo.baseCount;
    const kifAll = (state.movesKif || []);
    const html = [];
    for (let no = 1; no <= base; no++) {
      const mark = no % 2 === 1 ? '▲' : '△';
      const cur = demoCursor === no ? ' current' : '';
      const off = no > bi;
      const style = off ? ' style="color:var(--text-dim);text-decoration:line-through;opacity:.55;"' : '';
      const times = state.moveTimes || [];
      const spent = Number(times[no - 1]) || 0;
      let cum = 0; for (let k = 0; k <= no - 1; k++) cum += Number(times[k]) || 0;
      const timeTxt = (spent || cum) ? ' (' + Math.floor(spent / 60) + ':' + String(spent % 60).padStart(2, '0') + '/' + Math.floor(cum / 3600) + ':' + Math.floor((cum % 3600) / 60) + ':' + String(cum % 60).padStart(2, '0') + ')' : '';
      html.push('<div class="move-row' + cur + '" data-no="' + no + '" style="cursor:pointer;' + (off ? style : '') + '"><span class="no">' + no + '</span><span' + (off ? style : '') + '>' + mark + ' ' + escHtml(kifAll[no - 1] || (state.moves || [])[no - 1] || '') + timeTxt + '</span></div>');
    }
    for (let i = 0; i < demoInfo.moves.length; i++) {
      const no = bi + i + 1;
      const mark = no % 2 === 1 ? '▲' : '△';
      const cur = demoCursor === no ? ' current' : '';
      const live = no === demoEdge() ? ' 🎤' : '';
      html.push('<div class="move-row' + cur + '" data-no="' + no + '" style="cursor:pointer;color:var(--gold-light);"><span class="no">' + no + '</span><span>' + mark + ' ' + escHtml(demoInfo.kif[i] || demoInfo.moves[i]) + live + '</span></div>');
    }
    el.innerHTML = html.join('');
    el.querySelectorAll('.move-row').forEach((row) => {
      row.addEventListener('click', () => {
        demoCursor = Math.min(parseInt(row.dataset.no, 10), demoEdge());
        applyDemoMode();
        updateDemoUI();
        const curEl = el.querySelector('.move-row.current');
        if (curEl) curEl.scrollIntoView({ block: 'nearest' });
      });
    });
    const curEl = el.querySelector('.move-row.current');
    if (curEl) curEl.scrollIntoView({ block: 'nearest' });
  }

  function updateDemoUI() {
    const seat = demoInfo ? demoInfo.demonstratorSeat : null;
    const name = demoInfo ? demoInfo.demonstratorName : null;
    const amDemo = !!mySeat && seat === mySeat;
    let status;
    if (freeMode) status = '✋ 自由摆棋中（本地草稿，不入谱不同步）';
    else if (seat && amDemo) status = '🎤 正在由你演示（对方实时观看）';
    else if (seat) status = '🎤 正在由 ' + (name || '对方') + ' 演示';
    else status = '💤 演示暂停——点「我来演示」开始行棋';
    $('demoStatus').textContent = status;
    $('btnDemoClaim').style.display = (mySeat && !seat && !freeMode) ? 'inline-block' : 'none';
    [ $('btnDemoTransfer'), $('btnDemoUndo'), $('btnDemoClear') ]
      .forEach((b) => { b.style.display = (amDemo && !freeMode) ? 'inline-block' : 'none'; });
    $('btnFreeMode').style.display = mySeat ? 'inline-block' : 'none';
    $('btnFreeMode').textContent = freeMode ? '🧑‍🔧 退出自由摆棋' : '✋ 自由摆棋';
    $('btnDemoLatest').style.display = (demoCursor < demoEdge()) ? 'inline-block' : 'none';
    $('btnDemoRematch').style.display = isPlayer ? 'inline-block' : 'none';
    const turn = demoInfo ? (demoInfo.turn || 'b') : 'b';
    const turnHint = $('turnHint');
    if (turnHint) turnHint.textContent = turn === 'b' ? '当前轮到 先手▲' : '当前轮到 後手△';
    const topBar = $('topPlayerBar'), bottomBar = $('bottomPlayerBar');
    if (topBar) topBar.classList.toggle('active', turn === 'w');
    if (bottomBar) bottomBar.classList.toggle('active', turn === 'b');
    if (fb) {
      fb.setMode(freeMode ? 'free' : 'demo-rules');
      // 感想战不限制驹台：演示时两方持驹都要能选（手番合法性由服务端校验），
      // 清掉对战模式留下的手番限制
      fb.setTurn(null);
      // 合法走法表：最新一手用 demo_state 下发的；历史手按需向服务端请求（demo_legal）
      const atEdge = demoCursor === demoEdge();
      if (freeMode) fb.setLegalTargets({});
      else if (atEdge) fb.setLegalTargets(demoInfo.legalTargetsBySq || {});
      else requestDemoLegal(demoCursor);
      fb.setInteractive(amDemo && (freeMode || atEdge));
    }
  }

  // 历史手合法走法按需缓存（PLAN §H）
  let demoLegalCache = {};
  function requestDemoLegal(index) {
    const key = index + ':' + demoInfo.moves.length + ':' + demoInfo.baseIndex;
    if (demoLegalCache[key]) { fb.setLegalTargets(demoLegalCache[key]); return; }
    api.send({ type: 'demo_legal', data: { index } });
  }
  api.on('demo_legal', (d) => {
    demoLegalCache[d.index] = d.legalTargetsBySq;
    if (fb && reviewActive && demoCursor === d.index) {
      fb.setLegalTargets(d.legalTargetsBySq);
      fb.render();
    }
  });

  $('btnDemoClaim').addEventListener('click', () => api.send({ type: 'demo_claim' }));
  $('btnDemoTransfer').addEventListener('click', () => api.send({ type: 'demo_transfer' }));
  $('btnDemoUndo').addEventListener('click', () => api.send({ type: 'demo_undo' }));
  $('btnDemoClear').addEventListener('click', () => { if (confirm('清空全部推演手，回到本谱终局局面？')) api.send({ type: 'demo_reset' }); });
  $('btnDemoLatest').addEventListener('click', () => { demoCursor = demoEdge(); applyDemoMode(); updateDemoUI(); });
  $('btnDemoRematch').addEventListener('click', () => { api.send({ type: 'rematch' }); toast('已请求再来一局，等待对方同意…'); });
  $('btnFreeMode').addEventListener('click', () => {
    if (!fb) return;
    freeMode = !freeMode;
    if (freeMode) {
      demoCursor = Math.min(demoCursor, demoEdge());
      applyDemoMode();
      toast('自由摆棋开启：任意移动/吃子/双击升变（本地草稿，不入谱不同步）');
    } else {
      demoCursor = demoEdge();
      applyDemoMode();
      toast('已退出自由摆棋，回到推演谱最新一手');
    }
    updateDemoUI();
  });

  api.on('demo_state', (d) => {
    if (!reviewActive) {
      if (state && state.status === 'FINISHED' && state.result) enterDemo(state);
      return;
    }
    // 光标自动跟随：之前在最新一手 → 跟进新一手；浏览历史则停留（可点「回到最新」）
    const prevEdge = demoEdge();
    demoInfo = d;
    if (demoCursor >= prevEdge || demoCursor > demoEdge()) demoCursor = demoEdge();
    applyDemoMode();
    renderDemoMoveList();
    updateDemoUI();
  });

  // ==================================================================
  // 对局事件
  // ==================================================================
  api.on('game_over', (data) => {
    toast('对局结束：' + (data.resultDetail || ''));
    if (window.Sound) window.Sound.playEnd();
    // 终局不跳页——state 推送（含 demo）会触发自动进入感想战模式
  });
  api.on('game_start', (data) => {
    toast('对局开始！');
    if (window.Sound) window.Sound.playStart();
  });
  // 对手请求再来一局：提示并高亮「再来一局」按钮
  api.on('rematch_requested', (data) => {
    const name = (data && data.requesterName) || '对手';
    toast(`${name} 请求再来一局，点击「再来一局」应战`);
    const btn = $('btnRematch');
    const bannerBtn = $('bannerRematch');
    btn.style.display = 'inline';
    btn.classList.add('pulse');
    if (bannerBtn) {
      bannerBtn.style.display = 'inline';
      bannerBtn.classList.add('pulse');
    }
    setTimeout(() => {
      btn.classList.remove('pulse');
      if (bannerBtn) bannerBtn.classList.remove('pulse');
    }, 4000);
  });
  api.on('error', (data) => {
    if (data && data.message) toast(data.message);
    // 私人房观战需要密码（PLAN §T2）：本页没有密码输入框 → 提示后回大厅的
    // 「👁 观战」入口补填密码（那里有房间码与密码框）。否则用户只会停在一片空白对局页。
    if (data && data.needPassword) {
      setTimeout(() => { location.href = 'lobby.html'; }, 1200);
    }
  });
  // 同身份在别处登录：本页被顶替，提示并停止操作
  api.on('replaced', () => {
    toast('此身份已在其他窗口登录，本页已断开');
    board.setInteractive(false);
  });

  // ==================================================================
  // 聊天
  // ==================================================================
  const chatBox = $('chatBox');
  const chatInput = $('chatInput');
  function appendChat(msg) {
    if (!chatBox) return;
    const row = document.createElement('div');
    row.className = 'chat-msg' + (msg.sys ? ' sys' : '');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = msg.name || '';
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = msg.text;
    row.appendChild(who);
    row.appendChild(text);
    chatBox.appendChild(row);
    chatBox.scrollTop = chatBox.scrollHeight;
    while (chatBox.children.length > 100) chatBox.removeChild(chatBox.firstChild);
  }
  function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    api.send({ type: 'chat', data: { text } });
    chatInput.value = '';
  }
  if ($('btnChatSend')) $('btnChatSend').addEventListener('click', sendChat);
  if (chatInput) chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
  api.on('chat', (data) => {
    // §R：观战者发言带 👁 标识（服务端已用其会话真名，不再一律显示"观众"）
    if (data) {
      const mark = data.role === 'spectator' ? '👁 ' : '';
      appendChat({ name: mark + (data.name || ''), text: data.text });
    }
  });
  // 观战者进入时系统提示（rebind=选手掉线重进回位，不算观战）
  api.on('spectating', (data) => {
    if (data && data.rebind) return;
    appendChat({ name: '系统', text: '你已进入观战，欢迎交流！', sys: true });
  });

  // 仅当显式带 spectate=1 参数时才进入观战（来自观战列表/随机观战入口）
  // 玩家（建房/加入/匹配/重连）跳转不带 spectate，走 request_state，由服务端按连接身份返回对应状态
  const params = new URLSearchParams(location.search);
  const isSpectate = !!params.get('spectate');
  const isTournamentJoin = !!params.get('join');
  const roomParam = params.get('room');
  function enterRoom() {
    if (isSpectate) {
      // 私人房间观战密码（PLAN §T2）：由大厅放进 sessionStorage，随本连接提交。
      // 取完即删——避免残留在会话里被下一次观战误用。
      let pw = '';
      try {
        pw = window.sessionStorage.getItem('tdshogi_spectate_pw') || '';
        if (pw) window.sessionStorage.removeItem('tdshogi_spectate_pw');
      } catch (_) { /* 隐私模式下 sessionStorage 可能不可用，忽略即可 */ }
      api.send({ type: 'spectate', data: { roomId: roomParam, password: pw } });
    } else if (isTournamentJoin) {
      // 赛事对局：玩家主动进入（建局时可能不在线）
      api.send({ type: 'join_tournament_match', data: { roomId: roomParam } });
    } else {
      // 请求当前状态（可能是重连，也可能是玩家跳转进来）；
      // 带 URL 里的 roomId：服务端回位优先绑定该房间（重新匹配后不被旧对局的
      // 复盘中座位按插入顺序劫持——幽灵房修复）
      api.send({ type: 'request_state', data: roomParam ? { roomId: roomParam } : {} });
    }
  }
  // WS 首次连接与断线重连统一在此进入房间；
  // 观战者重连后服务端不会主动重推 state，必须重新发起 spectate/request_state
  // 设置变更 → 重渲染棋盘（坐标 §S4 / 图集 §S5 / 上一步高亮，PLAN §S1）
  if (window.Settings) {
    window.Settings.subscribe((all, key) => {
      if (['showCoords', 'atlas', 'highlightLastMove'].indexOf(key) < 0) return;
      if (state) render(state);
      else if (fb) fb.render();
    });
  }

  api.on('open', enterRoom);
})();
