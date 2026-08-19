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
  let localClocks = { b: 15 * 60 * 1000, w: 15 * 60 * 1000 };  // 本时剩余
  let localByoyomi = { b: 0, w: 0 };  // 当前手读秒剩余
  let inByoyomi = { b: false, w: false }; // 是否在读秒
  let byoyomiDuration = 0;             // 秒读时长
  let lastTickTs = Date.now();

  // 时间控制预设（与服务端 TIME_CONTROLS 对应）
  const TIME_CONTROLS = {
    '15+60': { name: '15分钟 + 60秒' },
    '10+30': { name: '10分钟 + 30秒' },
    '10:00': { name: '10分钟包干' },
    '10sec': { name: '10秒快棋' },
  };

  const $ = (id) => document.getElementById(id);

  function toast(msg) {
    $('toast').textContent = msg;
    $('toast').classList.add('show');
    setTimeout(() => $('toast').classList.remove('show'), 2500);
  }

  // ==================================================================
  // 渲染
  // ==================================================================
  function render(state) {
    const players = state.players || {};
    const viewpoint = mySeat === 'w' ? 'w' : 'b'; // 后手视角
    // 视角布局：上方=对面，下方=自己；左侧持驹=对面，右侧持驹=自己
    const oppSeat = viewpoint === 'b' ? 'w' : 'b';
    const mySeatX = viewpoint === 'b' ? 'b' : 'w';

    // 上方（对面）玩家栏
    const opp = players[oppSeat];
    $('topName').textContent = (opp && opp.name) || (oppSeat === 'b' ? '先手' : '後手');
    $('topRating').textContent = opp ? `ELO ${opp.rating}` : '';
    $('topPlayerBar').classList.toggle('active', state.turn === oppSeat);

    // 下方（自己）玩家栏：名字优先显示自己账号名（localStorage），对手用服务端名
    const me = players[mySeatX];
    const myName = guest && guest.name ? guest.name : (me && me.name) || (mySeatX === 'b' ? '先手' : '後手');
    $('bottomName').textContent = myName;
    $('bottomRating').textContent = me ? `ELO ${me.rating}` : '';
    $('bottomPlayerBar').classList.toggle('active', state.turn === mySeatX);

    // 房间信息 + 时间控制
    const tcName = TIME_CONTROLS[state.timeControl] ? TIME_CONTROLS[state.timeControl].name : '';
    $('roomCodeLabel').textContent = state.code ? `房间 ${state.code}` : '对局';
    if (tcName) $('roomCodeLabel').textContent += ` · ${tcName}`;

    // 观战标识
    const spectator = !isPlayer;
    $('spectatorTag').style.display = spectator ? 'inline' : 'none';
    $('btnResign').style.display = spectator ? 'none' : 'inline';

    // 棋钟初始 + 读秒
    if (state.clock) {
      localClocks.b = state.clock.b;
      localClocks.w = state.clock.w;
    }
    if (state.inByoyomi) {
      inByoyomi = { ...state.inByoyomi };
      localByoyomi = state.curByoyomi ? { ...state.curByoyomi } : { b: 0, w: 0 };
      byoyomiDuration = state.byoyomi || 0;
    }
    updateClocks();

    // 王手红格
    const checkSqs = state.check ? [findKingSq(state, state.turn)] : [];

    // 渲染棋盘（含当前选中目标）；后手视角镜像棋盘
    board.render(state, {
      lastMove: state.lastMove,
      check: checkSqs,
    }, viewpoint);
    renderHands(state);
    renderMoveList(state);

    // 可交互：轮到己方
    const canMove = isPlayer && state.status === 'PLAYING' && mySeat === state.turn;
    board.setInteractive(canMove);
    bindBoardClicks(canMove, state);

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
    el.innerHTML = moves.map((m, i) => {
      const player = i % 2 === 0 ? '▲' : '△';
      const label = kif[i] || m;
      return `<div class="move-row"><span class="no">${i + 1}</span><span>${player} ${label}</span></div>`;
    }).join('');
    el.scrollTop = el.scrollHeight;
  }

  function displayFor(seat) {
    // 本时用尽且进入读秒 → 显示读秒剩余；否则显示本时
    if (inByoyomi[seat] && byoyomiDuration > 0) return fmtClock(localByoyomi[seat], true);
    return fmtClock(localClocks[seat], false);
  }
  function updateClocks() {
    const vp = mySeat === 'w' ? 'w' : 'b';
    const oppSeat = vp === 'b' ? 'w' : 'b'; // 上方=对面
    const mySeatH = vp;                       // 下方=自己
    $('topClock').textContent = displayFor(oppSeat);
    $('bottomClock').textContent = displayFor(mySeatH);
    const lowOpp = inByoyomi[oppSeat] ? localByoyomi[oppSeat] <= 10000 : localClocks[oppSeat] <= 10000;
    const lowMe = inByoyomi[mySeatH] ? localByoyomi[mySeatH] <= 10000 : localClocks[mySeatH] <= 10000;
    $('topClock').classList.toggle('low', lowOpp && state && state.turn === oppSeat);
    $('bottomClock').classList.toggle('low', lowMe && state && state.turn === mySeatH);
  }
  function fmtClock(ms, isByoyomi) {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    if (isByoyomi) return `${sec}`; // 读秒只显示秒数
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // 本地棋钟 tick
  let lastTickSecond = -1;  // 读秒音效：记录上次"嗒"的秒数（跨秒触发）
  setInterval(() => {
    if (!state || state.status !== 'PLAYING') { updateClocks(); return; }
    const now = Date.now();
    const dt = now - lastTickTs;
    lastTickTs = now;
    const turn = state.turn;
    if (inByoyomi[turn] && byoyomiDuration > 0) {
      localByoyomi[turn] = Math.max(0, localByoyomi[turn] - dt);
      // 读秒 ≤10 秒：每秒「嗒」（跨秒边界触发，含 10 与 1）
      const sec = Math.ceil(localByoyomi[turn] / 1000);
      if (sec >= 1 && sec <= 10 && sec !== lastTickSecond) {
        if (window.Sound) window.Sound.playByoyomi();
        lastTickSecond = sec;
      }
      if (sec > 10) lastTickSecond = -1;
    } else {
      localClocks[turn] = Math.max(0, localClocks[turn] - dt);
    }
    updateClocks();
  }, 500);

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
        cell.classList.add('target');
        if (cell.dataset.sq !== t.to || cell.innerHTML) cell.classList.add('has-piece');
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
  }

  // 升变按钮
  $('btnPromote').addEventListener('click', () => {
    if (pendingPromote) sendMove(pendingPromote.promoteUsi);
    $('promoteOverlay').classList.remove('show');
    pendingPromote = null;
  });
  $('btnNoPromote').addEventListener('click', () => {
    if (pendingPromote) sendMove(pendingPromote.nonPromoteUsi);
    $('promoteOverlay').classList.remove('show');
    pendingPromote = null;
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

  function showResult(st) {
    const names = st.players || {};
    const winnerName = st.result === 'b' ? (names.b && names.b.name) : st.result === 'w' ? (names.w && names.w.name) : null;
    const loserName = st.result === 'b' ? (names.w && names.w.name) : st.result === 'w' ? (names.b && names.b.name) : null;
    let text;
    if (st.resultDetail === '投了') {
      text = `${loserName || '一方'} 投了 · ${winnerName || ''} 胜`;
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
    lastTickTs = Date.now();
    // 收到新状态时清空选中（如果对方走子则清）
    if (selected && mySeat !== state.turn) {
      selected = null;
      targets = [];
    }
    render(state);
  });
  api.on('clock', (data) => {
    if (!data) return;
    if (typeof data.b === 'number') {
      localClocks.b = data.b;
      localClocks.w = data.w;
    }
    if (data.curByoyomi) {
      localByoyomi = { ...data.curByoyomi };
    }
    if (data.inByoyomi) {
      inByoyomi = { ...data.inByoyomi };
    }
    if (data.byoyomi != null) byoyomiDuration = data.byoyomi;
    lastTickTs = Date.now();
    updateClocks();
  });
  api.on('game_over', (data) => {
    toast(`对局结束：${data.resultDetail || ''}`);
    if (window.Sound) window.Sound.playEnd();
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
  });

  // 仅当显式带 spectate=1 参数时才进入观战（来自观战列表/随机观战入口）
  // 玩家（建房/加入/匹配/重连）跳转不带 spectate，走 request_state，由服务端按连接身份返回对应状态
  const params = new URLSearchParams(location.search);
  const isSpectate = !!params.get('spectate');
  const isTournamentJoin = !!params.get('join');
  const roomParam = params.get('room');
  function enterRoom() {
    if (isSpectate) {
      api.send({ type: 'spectate', data: { roomId: roomParam } });
    } else if (isTournamentJoin) {
      // 赛事对局：玩家主动进入（建局时可能不在线）
      api.send({ type: 'join_tournament_match', data: { roomId: roomParam } });
    } else {
      // 请求当前状态（可能是重连，也可能是玩家跳转进来）
      api.send({ type: 'request_state' });
    }
  }
  // WS 首次连接与断线重连统一在此进入房间；
  // 观战者重连后服务端不会主动重推 state，必须重新发起 spectate/request_state
  api.on('open', enterRoom);
})();
