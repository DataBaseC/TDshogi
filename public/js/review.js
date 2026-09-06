/**
 * review.js — 复盘器（专用页面）
 *
 * 参考参考项目（参考 app.js 复盘分块）：
 *  - 棋谱对子布局（▲/△，先手/後手）
 *  - 日式/USI 切换
 *  - 前进/后退/跳首/跳末 + 当前手滚动居中
 *  - 书签（toggle）
 *  - 评论（写/删）
 *  - 变着（在指定手数下保存备选走法）
 *  - 仅 owner / 管理员可访问（服务端校验）
 */
(function () {
  const guest = window.NAV.renderNav('history');
  const params = new URLSearchParams(location.search);
  const recordId = params.get('id');
  // 管理员访问他人棋谱：携带 adminToken（服务端校验通过则放行）
  const adminToken = params.get('adminToken') || '';

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  if (!recordId) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('errorText').textContent = '缺少棋谱 ID';
    return;
  }

  const board = new window.ShogiBoard(document.getElementById('boardContainer'), { readonly: true });
  let review = null;     // 完整复盘数据
  let positions = [];    // 中间局面（来自 playback 或本地重放）
  let cursor = 0;        // 当前手（0=初始）
  let displayMode = 'jp';// 'jp' | 'usi'
  let navFromList = false; // 抑制自动滚动
  // 自由摆放（PLAN §G）：本地草稿，不入谱
  let fb = null;
  let freeMode = false;

  async function load() {
    const authQ = `guest=${encodeURIComponent(guest.id)}${adminToken ? `&token=${encodeURIComponent(adminToken)}` : ''}`;
    const url = `/api/records/${recordId}/review?${authQ}`;
    try {
      const r = await fetch(url);
      if (r.status === 403) throw new Error('只能复盘自己的棋谱');
      if (r.status === 404) throw new Error('棋谱不存在');
      if (!r.ok) throw new Error('加载失败');
      review = await r.json();
    } catch (e) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('error').style.display = 'block';
      document.getElementById('errorText').textContent = e.message;
      return;
    }
    // 加载回放中间局面
    const pb = await fetch(`/api/records/${recordId}/playback?${authQ}`).then((r) => r.json());
    positions = pb.positions || [];
    cursor = 0;
    render();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('review').style.display = 'block';
  }

  function resultText(r) {
    const n = r.names || ['先手', '後手'];
    if (r.result === 'b') return `${n[0]} 胜`;
    if (r.result === 'w') return `${n[1]} 胜`;
    if (r.result === '-') return r.resultDetail || '和棋';
    return '未完成';
  }

  function render() {
    // 顶部元信息
    document.getElementById('rvNameB').textContent = (review.names || ['先手'])[0];
    document.getElementById('rvNameW').textContent = (review.names || ['先手', '後手'])[1];
    document.getElementById('rvResult').textContent = resultText(review);
    document.getElementById('rvMoves').textContent = `${review.moves.length} 手`;
    document.getElementById('rvDate').textContent = new Date(review.createdAt).toLocaleString('zh-CN');
    document.getElementById('rvCursor').textContent = `${cursor} / ${review.moves.length}`;

    // 玩家栏：复盘默认先手视角，上方=后手，下方=先手
    const names = review.names || ['先手', '後手'];
    document.getElementById('topName').textContent = names[1] || '後手';
    document.getElementById('topRating').textContent = '';
    document.getElementById('bottomName').textContent = names[0] || '先手';
    document.getElementById('bottomRating').textContent = '';
    document.getElementById('topClock').textContent = '';
    document.getElementById('bottomClock').textContent = '';

    // 棋盘（先手视角）；自由摆放模式由 FreeBoard 接管渲染
    const pos = positions[cursor];
    if (pos) {
      if (freeMode && fb) { fb.render(); } else {
        board.render({ board: pos.board, turn: cursor % 2 === 0 ? 'b' : 'w' }, {}, 'b');
        // 持驹区：先手视角，左侧=后手(w)，右侧=先手(b)
        const hands = pos.hands || {};
        window.renderHands(document.getElementById('oppHandPieces'), hands, 'w', null, 'b');
        window.renderHands(document.getElementById('myHandPieces'), hands, 'b', null, 'b');
      }
    }

    // 棋谱对子列表
    renderMoveList();
    renderAnnotations();
    renderVariations();
  }

  function renderMoveList() {
    // 一编号 = 一手棋，与 KIF 文件手数顺序一致（此前为对子布局，一号两手）
    const el = document.getElementById('rvMoveList');
    const moves = review.moves;
    const times = review.moveTimes || [];
    let cum = 0;
    const html = [];
    for (let no = 1; no <= moves.length; no++) {
      // 每手的走子前局面：positions[0]=初始，positions[k]=第 k 手后
      const before = positions[no - 1];
      const text = formatMove(moves[no - 1], before);
      const mark = no % 2 === 1 ? '▲' : '△';
      const spent = Number(times[no - 1]) || 0;
      cum += spent;
      const timeTxt = spent ? ` <span style="color:var(--text-dim);font-size:11px;">(${Math.floor(spent / 60)}:${String(spent % 60).padStart(2, '0')}/${Math.floor(cum / 3600)}:${String(Math.floor((cum % 3600) / 60)).padStart(2, '0')}:${String(cum % 60).padStart(2, '0')})</span>` : '';
      html.push(`<div class="rv-move-row${cursor === no ? ' current' : ''}">
        <span class="rv-no">${no}</span>
        <span class="rv-mv${cursor === no ? ' cursor' : ''}${isBookmarked(no) ? ' bookmark' : ''}${hasComment(no) ? ' has-comment' : ''}${hasVariation(no) ? ' has-var' : ''}" data-no="${no}">${mark} ${text}${timeTxt}</span>
      </div>`);
    }
    el.innerHTML = html.join('');
    el.querySelectorAll('.rv-mv').forEach((node) => {
      node.addEventListener('click', () => {
        const no = parseInt(node.dataset.no, 10);
        if (!no || no > review.moves.length) return;
        navFromList = true;
        cursor = no;
        render();
      });
    });
    scrollMoveListToCurrent();
  }

  function formatMove(usi, beforePos) {
    if (!usi) return '—';
    if (displayMode === 'jp') return usiToJp(usi, beforePos ? beforePos.board : null);
    return usi;
  }

  // 从走子前局面查找 from 格的棋子中文名（服务端 KIND_NAME 格式）
  function pieceNameAtBoard(board, fromUsi) {
    if (!board) return '';
    for (let r = 0; r < board.length; r++) {
      const row = board[r];
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (cell && cell.sq === fromUsi && cell.piece) return cell.piece;
      }
    }
    return '';
  }

  const KIND_JP = {
    '歩': '歩', '香': '香', '桂': '桂', '銀': '銀', '金': '金', '角': '角', '飛': '飛', '玉': '玉',
    'と': 'と', '成香': '杏', '成桂': '圭', '成銀': '全', '馬': '馬', '龍': '龍',
  };

  function usiToJp(usi, beforeBoard) {
    const full = ['０','１','２','３','４','５','６','７','８','９'];
    const kanji = ['一','二','三','四','五','六','七','八','九'];
    // 打子 P*5e → ５五歩打（此前落进普通走子分支渲染错乱）
    const dropM = /^([PLNSGBR])\*([1-9])([a-i])$/.exec(usi);
    if (dropM) {
      const sym = (window.DROP_SYMBOLS || {})[dropM[1]] || '歩';
      return `${full[parseInt(dropM[2], 10) - 1]}${kanji[dropM[3].charCodeAt(0) - 97]}${sym}打`;
    }
    if (usi.length === 4 || usi.length === 5) {
      const toFile = usi[2];
      const toY = usi.charCodeAt(3) - 96;
      // 升变标记
      const promote = usi.length === 5 ? '成' : '';
      // 从走子前局面推导棋子名
      const fromUsi = usi.slice(0, 2);
      const rawPiece = pieceNameAtBoard(beforeBoard, fromUsi);
      const pieceName = KIND_JP[rawPiece] || rawPiece || '';
      return `${full[parseInt(toFile, 10)]}${kanji[toY - 1]}${pieceName}${promote}`;
    }
    // 其他未识别形式，保留 USI
    return usi;
  }

  function scrollMoveListToCurrent() {
    const el = document.getElementById('rvMoveList');
    const cur = el.querySelector('.rv-mv.cursor');
    if (!cur) return;
    if (navFromList) { navFromList = false; return; }
    const target = cur.offsetTop;
    el.scrollTop = Math.max(0, target - el.clientHeight / 2 + cur.clientHeight / 2);
  }

  function isBookmarked(no) { return (review.bookmarks || []).includes(no); }
  function hasComment(no) { return !!(review.comments && review.comments[no]); }
  function hasVariation(no) { return !!(review.variations && review.variations[no] && review.variations[no].length); }

  function renderAnnotations() {
    const no = cursor;
    document.getElementById('btnBookmark').classList.toggle('active', isBookmarked(no));
    document.getElementById('btnComment').classList.toggle('active', hasComment(no));
    document.getElementById('rvHasVariation').style.display = hasVariation(no) ? 'block' : 'none';
    // 评论展示
    const cm = document.getElementById('rvComments');
    const cmInput = document.getElementById('rvCommentInput');
    if (cm.style.display !== 'none') {
      cmInput.value = hasComment(no) ? review.comments[no] : '';
    }
  }

  function renderVariations() {
    const el = document.getElementById('rvVariations');
    const list = (review.variations || {})[cursor] || [];
    if (!list.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<div style="font-size:12px;color:var(--text-dim);">变着（仅供参考，不影响主棋谱）：</div>` +
      list.map((v) => `<div style="font-size:13px;margin-top:4px;padding:6px 10px;background:var(--bg-3);border-radius:6px;">↪ ${esc(formatMove(v.move))} <span style="color:var(--text-dim);font-size:11px;">(${esc(v.move)})</span></div>`).join('');
  }

  // ---- 操作 ----
  document.getElementById('btnFirst').addEventListener('click', () => { cursor = 0; render(); });
  document.getElementById('btnPrev').addEventListener('click', () => { if (cursor > 0) { cursor--; render(); } });
  document.getElementById('btnNext').addEventListener('click', () => { if (cursor < review.moves.length) { cursor++; render(); } });
  document.getElementById('btnLast').addEventListener('click', () => { cursor = review.moves.length; render(); });
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') { if (cursor > 0) { cursor--; render(); } }
    else if (e.key === 'ArrowRight') { if (cursor < review.moves.length) { cursor++; render(); } }
    else if (e.key === 'Home') { cursor = 0; render(); }
    else if (e.key === 'End') { cursor = review.moves.length; render(); }
  });

  document.getElementById('rvDisplayMode').addEventListener('change', (e) => {
    displayMode = e.target.value;
    renderMoveList();
  });

  // 书签
  document.getElementById('btnBookmark').addEventListener('click', async () => {
    if (!cursor) return toast('初始局面无法加书签');
    const on = !isBookmarked(cursor);
    const r = await fetch(`/api/records/${recordId}/bookmark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest: guest.id, moveNo: cursor, on }),
    }).then((res) => res.json());
    if (r.ok) {
      review.bookmarks = r.bookmarks;
      render();
      toast(on ? '已加书签' : '已取消书签');
    } else toast(r.error || '操作失败');
  });

  // 评论
  const commentPanel = document.getElementById('rvComments');
  document.getElementById('btnComment').addEventListener('click', () => {
    if (!cursor) return toast('初始局面无法评论');
    commentPanel.style.display = commentPanel.style.display === 'none' ? 'block' : 'none';
    if (commentPanel.style.display === 'block') {
      document.getElementById('rvCommentInput').value = hasComment(cursor) ? review.comments[cursor] : '';
      document.getElementById('rvCommentInput').focus();
    }
  });
  document.getElementById('btnCancelComment').addEventListener('click', () => { commentPanel.style.display = 'none'; });
  document.getElementById('btnSaveComment').addEventListener('click', async () => {
    const text = document.getElementById('rvCommentInput').value;
    const r = await fetch(`/api/records/${recordId}/comment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest: guest.id, moveNo: cursor, text }),
    }).then((res) => res.json());
    if (r.ok) {
      review.comments = r.comments;
      commentPanel.style.display = 'none';
      render();
      toast('评论已保存');
    } else toast(r.error || '操作失败');
  });

  // 变着
  const varPanel = document.getElementById('rvVariationPanel');
  document.getElementById('btnVariation').addEventListener('click', () => {
    if (!cursor) return toast('初始局面无法添加变着');
    varPanel.style.display = varPanel.style.display === 'none' ? 'block' : 'none';
    if (varPanel.style.display === 'block') {
      document.getElementById('rvVariationInput').focus();
    }
  });
  document.getElementById('btnCancelVariation').addEventListener('click', () => { varPanel.style.display = 'none'; });
  document.getElementById('btnSaveVariation').addEventListener('click', async () => {
    const move = document.getElementById('rvVariationInput').value.trim();
    if (!move) return;
    const r = await fetch(`/api/records/${recordId}/variation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest: guest.id, parent: cursor, move }),
    }).then((res) => res.json());
    if (r.ok) {
      review.variations = r.variations;
      varPanel.style.display = 'none';
      document.getElementById('rvVariationInput').value = '';
      render();
      toast('变着已保存');
    } else toast(r.error || '操作失败');
  });

  // ---- 自由摆放（PLAN §G）：本地草稿，不入谱；导航/关闭即丢弃 ----
  function startFreePlace() {
    const pos = positions[cursor];
    if (!pos) return toast('局面尚未加载');
    if (fb) fb.destroy();
    fb = new window.FreeBoard({
      board,
      viewpoint: 'b',
      interactive: true,
      hands: { my: document.getElementById('myHandPieces'), myColor: 'b', opp: document.getElementById('oppHandPieces'), oppColor: 'w' },
    });
    fb.attach();
    fb.startFrom({ board: pos.board, hands: pos.hands || { b: [], w: [] } });
    freeMode = true;
    document.getElementById('btnFreePlace').classList.add('active');
    document.getElementById('btnUndoFree').style.display = 'inline-block';
    toast('自由摆放已开启：移动/驹台放置/双击升变，翻页即丢弃');
  }

  function stopFreePlace() {
    freeMode = false;
    if (fb) { fb.detach(); fb.destroy(); fb = null; }
    document.getElementById('btnFreePlace').classList.remove('active');
    document.getElementById('btnUndoFree').style.display = 'none';
    render();
  }

  document.getElementById('btnFreePlace').addEventListener('click', () => {
    if (freeMode) stopFreePlace();
    else startFreePlace();
  });

  function undoFreePlace() {
    if (!freeMode || !fb) return toast('自由摆放未开启');
    if (!fb.undo()) toast('没有可撤销的操作');
  }
  document.getElementById('btnUndoFree')?.addEventListener('click', undoFreePlace);
  document.addEventListener('keydown', (e) => {
    if (!freeMode) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undoFreePlace(); }
  });

  // 导出
  function doExport(fmt) {
    const url = `/api/records/${recordId}/export?fmt=${fmt}&guest=${encodeURIComponent(guest.id)}${adminToken ? `&token=${encodeURIComponent(adminToken)}` : ''}`;
    window.location.href = url;
  }
  document.getElementById('btnExportKif').addEventListener('click', () => doExport('kif'));
  document.getElementById('btnExportCsa').addEventListener('click', () => doExport('csa'));

  load();
})();
