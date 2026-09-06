/**
 * freeboard.js — 统一棋盘组件（PLAN §G v6）
 *
 * 三种模式（一个组件，全站共用）：
 *   play       对战模式：高亮服务端合法落点，onMove(usi) 交页面发送（服务端权威）
 *   demo-rules 感想战模式：同规则行棋，但由本地模型乐观渲染（服务端 demo 校验+广播）
 *   free       自由摆棋：不校验规则，本地草稿（撤销/双击升变，不入谱）
 *
 * 交互：点击流 + 拖拽行棋（鼠标/触屏 Pointer Events，参考 lishogi/81dojo）。
 * 吃子/打子归属按正常将棋规则（被吃子恢复原始棋种进吃方驹台）。
 *
 * 坐标策略：模型统一用服务端 r/c 坐标，渲染交给 ShogiBoard（内部处理视角镜像）。
 */
(function (global) {
  const PROMOTE = { '歩': 'と', '香': '成香', '桂': '成桂', '銀': '成銀', '角': '馬', '飛': '龍' };
  // 成駒 → 原始棋种（吃子进驹台/双击降级用）
  // ⚠️ 曾把 '馬' 错写成 '飛'：吃掉对方的馬（角行升变）会在驹台多出「飛」，已修正为「角」（PLAN §J3）
  const DEMOTE = { 'と': '歩', '成香': '香', '杏': '香', '成桂': '桂', '圭': '桂', '成銀': '銀', '全': '銀', '馬': '角', '龍': '飛' };
  const DROP_NAME = { P: '歩', L: '香', N: '桂', S: '銀', G: '金', B: '角', R: '飛' };
  const DRAG_THRESHOLD = 6; // px，超过视为拖拽

  function sqToRC(sq) {
    const x = parseInt(sq[0], 10) - 1;
    const y = sq.charCodeAt(1) - 97;
    return [y, x];
  }

  class FreeBoard {
    constructor({ board, viewpoint = 'b', interactive = false, mode = 'play', hands, onChange, onMove, onPromoteChoice } = {}) {
      this.board = board;            // ShogiBoard 实例
      this.viewpoint = viewpoint;
      this.interactive = !!interactive;
      this.mode = mode;              // 'play' | 'demo-rules' | 'free'
      this.handsEls = hands || null; // { my: el, myColor, opp: el, oppColor }
      this.onChange = onChange || null;
      this.onMove = onMove || null;          // (usi) => void
      this.onPromoteChoice = onPromoteChoice || null; // ({ usiMove, usiPromote }) => void
      this.model = null;             // { board, hands }
      this.lastMove = null;
      this.legalTargetsBySq = {};    // { fromSq|dropSym: [{to, usi, promote}] }
      this.turnColor = null;         // 当前手番 'b'|'w'（非 free 模式下限制只能选手番方持驹）
      this.history = [];             // free 模式撤销栈
      this.selectedSq = null;
      this.selectedHand = null;      // { color, piece, sym }
      this._onClick = (e) => this._handleClick(e);
      this._onDbl = (e) => this._handleDblClick(e);
      this._onPointerDown = (e) => this._handlePointerDown(e);
      this._drag = null;
    }

    // ---------- 装载 ----------
    setModel(modelLike, lastMove = null) {
      this.model = {
        board: JSON.parse(JSON.stringify(modelLike.board)),
        hands: JSON.parse(JSON.stringify(modelLike.hands || { b: [], w: [] })),
      };
      this.lastMove = lastMove;
      this.selectedSq = null;
      this.selectedHand = null;
      this.render();
    }

    startFrom(stateLike) {
      this.setModel(stateLike, stateLike.lastMove || null);
      this.history = [JSON.stringify(this.model)];
    }

    getSnapshot() {
      return { position: JSON.parse(JSON.stringify(this.model)), lastMove: this.lastMove };
    }

    // ---------- 模式/开关 ----------
    setMode(mode) {
      this.mode = mode;
      this.selectedSq = null;
      this.selectedHand = null;
      this.ruleTargets = null;
      this.render();
    }
    setInteractive(v) {
      this.interactive = !!v;
      if (!this.interactive) { this.selectedSq = null; this.selectedHand = null; }
      this.render();
    }
    setLegalTargets(map) { this.legalTargetsBySq = map || {}; }
    setRuleContext(ctx) { this.setLegalTargets(ctx ? ctx.legalTargetsBySq || {} : {}); } // 兼容旧调用
    /** 设置当前手番（'b'|'w'）：非 free 模式下，非手番方的持驹不可选（打子符号与颜色无关，
     *  否则演示者/玩家可点对手驹台的同种棋子，视觉上像从对手驹台打入） */
    setTurn(color) { this.turnColor = (color === 'b' || color === 'w') ? color : null; }
    _canPickHand(color) { return this.mode === 'free' || !this.turnColor || color === this.turnColor; }
    destroy() { this.detach(); this._removeGhost(); this.model = null; }
    attach() {
      this.board.boardEl.addEventListener('click', this._onClick);
      this.board.boardEl.addEventListener('dblclick', this._onDbl);
      this.board.boardEl.addEventListener('pointerdown', this._onPointerDown);
    }
    detach() {
      this.board.boardEl.removeEventListener('click', this._onClick);
      this.board.boardEl.removeEventListener('dblclick', this._onDbl);
      this.board.boardEl.removeEventListener('pointerdown', this._onPointerDown);
      document.removeEventListener('pointermove', this._onDocMove);
      document.removeEventListener('pointerup', this._onDocUp);
    }
    bindHands(myEl, myColor, oppEl, oppColor) {
      this.handsEls = { my: myEl, myColor, opp: oppEl, oppColor };
      // 驹台容器绑定 pointerdown：支持从驹台拖拽打入/放置（PLAN §H）
      if (myEl) {
        myEl.dataset.fbColor = myColor;
        myEl.addEventListener('pointerdown', (e) => this._handleHandPointerDown(e, myColor));
      }
      if (oppEl) {
        oppEl.dataset.fbColor = oppColor;
        oppEl.addEventListener('pointerdown', (e) => this._handleHandPointerDown(e, oppColor));
      }
    }

    clearSelection() { this.selectedSq = null; this.selectedHand = null; this.render(); }

    // ---------- 选中/出招核心（模式间共享） ----------
    _selectFrom(sq) {
      const targets = this.legalTargetsBySq[sq];
      if (!targets) return false; // 该棋子当前不可动
      this.selectedSq = sq;
      this.selectedHand = null;
      this.render();
      return true;
    }

    _tryTarget(fromSq, toSq) {
      const targets = this.legalTargetsBySq[fromSq] || [];
      const t = targets.find((x) => x.to === toSq);
      if (!t) return false;
      this.selectedSq = null;
      const promote = targets.find((x) => x.to === toSq && x.promote);
      const non = targets.find((x) => x.to === toSq && !x.promote);
      if (promote && non && this.onPromoteChoice) {
        this.onPromoteChoice({ to: toSq, usiMove: non.usi, usiPromote: promote.usi });
      } else if (this.onMove) {
        this.onMove(t.usi);
      }
      return true;
    }

    _pickHand(color, piece, sym) {
      if (this.selectedHand && this.selectedHand.color === color && this.selectedHand.piece === piece) {
        this.selectedHand = null;
      } else {
        this.selectedHand = { color, piece, sym: sym || Object.keys(DROP_NAME).find((k) => DROP_NAME[k] === piece) };
        this.selectedSq = null;
      }
      this.render();
    }

    // ---------- 点击流 ----------
    _handleClick(e) {
      if (!this.interactive || !this.model || this._drag) return;
      const hand = e.target.closest('.hand-piece');
      if (hand && hand.parentElement && hand.parentElement.dataset.fbColor) {
        const color = hand.parentElement.dataset.fbColor;
        if (!this._canPickHand(color)) return; // 非手番方持驹禁选
        const piece = hand.dataset.piece;
        if (this.mode === 'free') { this._pickHand(color, piece); return; }
        const sym = Object.keys(DROP_NAME).find((k) => DROP_NAME[k] === piece);
        if (sym && this.legalTargetsBySq[sym]) { this._pickHand(color, piece, sym); return; }
        return; // 该棋子无合法打点
      }
      const cell = e.target.closest('.cell');
      if (!cell || !cell.dataset.sq) return;
      const sq = cell.dataset.sq;
      const [r, c] = sqToRC(sq);
      const cellPiece = this.model.board[r][c];

      if (this.mode === 'free') { this._freeClick(sq); return; }

      if (this.selectedHand) {
        if (this._tryTarget(this.selectedHand.sym, sq)) { this.selectedHand = null; this.render(); }
        return;
      }
      if (this.selectedSq && this.selectedSq !== sq) {
        if (this._tryTarget(this.selectedSq, sq)) { this.selectedSq = null; this.render(); return; }
      }
      if (this.selectedSq === sq) { this.selectedSq = null; this.render(); return; }
      if (cellPiece && cellPiece.piece) { this._selectFrom(sq); return; }
      this.selectedSq = null;
      this.render();
    }

    _handleDblClick(e) {
      if (!this.interactive || !this.model || this.mode !== 'free') return;
      const cell = e.target.closest('.cell');
      if (!cell || !cell.dataset.sq) return;
      this.togglePromote(cell.dataset.sq);
    }

    // ---------- 拖拽行棋（Pointer Events：鼠标/触屏通用） ----------
    _handlePointerDown(e) {
      if (!this.interactive || !this.model || (e.button !== undefined && e.button !== 0)) return;
      const hand = e.target.closest('.hand-piece');
      let drag = null;
      if (hand && hand.parentElement && hand.parentElement.dataset.fbColor) {
        const color = hand.parentElement.dataset.fbColor;
        if (!this._canPickHand(color)) return; // 非手番方持驹禁拖
        const piece = hand.dataset.piece;
        const sym = Object.keys(DROP_NAME).find((k) => DROP_NAME[k] === piece);
        if (this.mode === 'free') drag = { kind: 'hand-free', color, piece };
        else if (sym && this.legalTargetsBySq[sym]) drag = { kind: 'hand', color, piece, sym, fromSq: sym };
        if (!drag) return;
        drag.ghostSrc = hand.innerHTML;
      } else {
        const cell = e.target.closest('.cell');
        if (!cell || !cell.dataset.sq) return;
        const sq = cell.dataset.sq;
        const [r, c] = sqToRC(sq);
        const cellPiece = this.model.board[r][c];
        if (!cellPiece || !cellPiece.piece) return;
        if (this.mode === 'free') drag = { kind: 'cell-free', fromSq: sq };
        else if (this.legalTargetsBySq[sq]) drag = { kind: 'cell', fromSq: sq };
        else return; // 不可动的棋子
        const pieceEl = cell.querySelector('span, img, div');
        drag.ghostSrc = pieceEl ? pieceEl.outerHTML : cell.innerHTML;
      }
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.pointerId = e.pointerId;
      this._drag = drag;
      this._docMove = (ev) => this._handleDocMove(ev);
      this._docUp = (ev) => this._handleDocUp(ev);
      document.addEventListener('pointermove', this._docMove);
      document.addEventListener('pointerup', this._docUp);
      e.preventDefault();
    }

    _ensureGhost() {
      if (this._drag.ghost) return this._drag.ghost;
      const g = document.createElement('div');
      g.className = 'fb-drag-ghost';
      g.innerHTML = this._drag.ghostSrc;
      document.body.appendChild(g);
      this._drag.ghost = g;
      return g;
    }

    _handleDocMove(e) {
      const drag = this._drag;
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
      drag.moved = true;
      const ghost = this._ensureGhost();
      ghost.style.left = e.clientX + 'px';
      ghost.style.top = e.clientY + 'px';
      // 悬停格高亮
      document.querySelectorAll('.cell.drag-over').forEach((c) => c.classList.remove('drag-over'));
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cell = el && el.closest('.cell');
      if (cell) cell.classList.add('drag-over');
    }

    /** 驹台拖拽起点：按住驹台棋子拖到目标格（rules 校验合法打点；free 自由放置） */
    _handleHandPointerDown(e, color) {
      if (!this.interactive || !this.model) return;
      if (!this._canPickHand(color)) return; // 非手番方持驹禁拖
      const wrap = e.target.closest('.hand-piece');
      if (!wrap) return;
      const piece = wrap.dataset.piece;
      const sym = Object.keys(DROP_NAME).find((k) => DROP_NAME[k] === piece);
      if (this.mode !== 'free') {
        if (!sym || !(this.legalTargetsBySq[sym] || []).length) return; // 无合法打点不可拖
      }
      this._drag = {
        kind: this.mode === 'free' ? 'hand-free' : 'hand',
        color, piece, sym, fromSq: sym,
        startX: e.clientX, startY: e.clientY, pointerId: e.pointerId,
        ghostSrc: wrap.innerHTML,
      };
      this._docMove = (ev) => this._handleDocMove(ev);
      this._docUp = (ev) => this._handleDocUp(ev);
      document.addEventListener('pointermove', this._docMove);
      document.addEventListener('pointerup', this._docUp);
      e.preventDefault();
    }

    _handleDocUp(e) {
      const drag = this._drag;
      if (!drag || e.pointerId !== drag.pointerId) return;
      document.removeEventListener('pointermove', this._docMove);
      document.removeEventListener('pointerup', this._docUp);
      this._drag = null;
      if (drag.ghost) drag.ghost.remove();
      document.querySelectorAll('.cell.drag-over').forEach((c) => c.classList.remove('drag-over'));
      if (!drag.moved) return; // 未拖动 → 交给 click 流程
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cell = el && el.closest('.cell');
      const toSq = cell && cell.dataset.sq;
      if (!toSq) return;
      if (drag.kind === 'cell-free' || drag.kind === 'hand-free') {
        if (drag.kind === 'cell-free') this._move(drag.fromSq, toSq);
        else this._drop(drag.color, drag.piece, toSq);
        return;
      }
      // play / demo-rules：目标是合法落点才出招
      const fromSq = drag.fromSq;
      if (fromSq === toSq) return;
      if (!this._tryTarget(fromSq, toSq)) {
        // 非法落点：无操作（棋子由模型重绘归位）
        this.render();
      } else {
        this.selectedSq = null;
        this.selectedHand = null;
        this.render();
      }
    }

    _removeGhost() {
      if (this._drag && this._drag.ghost) this._drag.ghost.remove();
      document.querySelectorAll('.fb-drag-ghost').forEach((g) => g.remove());
    }

    // ---------- free 模式操作 ----------
    _freeClick(sq) {
      const [r, c] = sqToRC(sq);
      const cell = this.model.board[r][c];
      if (this.selectedHand) {
        if (cell && cell.piece) return;
        this._drop(this.selectedHand.color, this.selectedHand.piece, sq);
        return;
      }
      if (this.selectedSq && this.selectedSq !== sq) { this._move(this.selectedSq, sq); return; }
      if (this.selectedSq === sq) { this.selectedSq = null; this.render(); return; }
      if (cell && cell.piece) { this.selectedSq = sq; this.render(); }
    }

    _move(fromSq, toSq) {
      const [fr, fc] = sqToRC(fromSq);
      const [tr, tc] = sqToRC(toSq);
      const piece = this.model.board[fr][fc];
      if (!piece) return;
      this._pushHistory();
      const target = this.model.board[tr][tc];
      if (target && target.piece) {
        const raw = DEMOTE[target.piece] || target.piece;
        this._addToHand(piece.color, raw);
      }
      this.model.board[tr][tc] = { piece: piece.piece, color: piece.color, promoted: !!piece.promoted, sq: toSq };
      this.model.board[fr][fc] = null;
      this.selectedSq = null;
      this.lastMove = toSq;
      this._afterOp();
    }

    _drop(color, piece, sq) {
      const [r, c] = sqToRC(sq);
      if (this.model.board[r][c] && this.model.board[r][c].piece) return;
      this._pushHistory();
      const list = this.model.hands[color] || [];
      const idx = list.findIndex((h) => h.piece === piece);
      if (idx < 0) { this.history.pop(); return; }
      list[idx].count -= 1;
      if (list[idx].count <= 0) list.splice(idx, 1);
      this.model.board[r][c] = { piece, color, promoted: false, sq };
      this.selectedHand = null;
      this.lastMove = sq;
      this._afterOp();
    }

    togglePromote(sq) {
      const [r, c] = sqToRC(sq);
      const piece = this.model.board[r][c];
      if (!piece || !piece.piece) return;
      let next = null;
      if (PROMOTE[piece.piece]) next = { name: PROMOTE[piece.piece], promoted: true };
      else if (DEMOTE[piece.piece]) next = { name: DEMOTE[piece.piece], promoted: false };
      if (!next) return;
      this._pushHistory();
      piece.piece = next.name;
      piece.promoted = next.promoted;
      this._afterOp();
    }

    undo() {
      if (this.history.length <= 1) return false;
      this.history.pop();
      this.model = JSON.parse(this.history[this.history.length - 1]);
      this.selectedSq = null;
      this.selectedHand = null;
      this._afterOp();
      return true;
    }

    _pushHistory() {
      this.history.push(JSON.stringify(this.model));
      if (this.history.length > 200) this.history.shift();
    }

    _afterOp() {
      this.render();
      if (this.onChange) this.onChange(this.getSnapshot());
    }

    _addToHand(color, piece) {
      const list = this.model.hands[color] = this.model.hands[color] || [];
      const h = list.find((x) => x.piece === piece);
      if (h) h.count += 1;
      else list.push({ piece, count: 1 });
    }

    // ---------- 规则模式：合法 USI 应用到模型（推演乐观渲染/谱面重放） ----------
    applyUsi(usi, color) {
      if (!this.model) return;
      applyUsiOnModel(this.model, usi, color);
      const isDrop = /^([PLNSGBR])\*/.test(usi);
      this.lastMove = isDrop ? usi.slice(2) : usi.slice(2, 4);
    }

    // ---------- 渲染 ----------
    render() {
      if (!this.model) return;
      this.board.render({ board: this.model.board }, { lastMove: this.lastMove }, this.viewpoint);
      if (this.selectedSq) this.board.highlightSq(this.selectedSq, 'sel');
      const from = this.selectedHand ? this.selectedHand.sym : this.selectedSq;
      const targets = from ? (this.legalTargetsBySq[from] || []) : [];
      for (const t of targets) this.board.highlightSq(t.to, 'target');
      if (this.handsEls) {
        const pick = (color, sym) => (piece) => {
          if (!this.interactive) return;
          if (!this._canPickHand(color)) return; // 非手番方持驹禁选
          if (this.mode === 'free') { this._pickHand(color, piece); return; }
          const s = sym || Object.keys(DROP_NAME).find((k) => DROP_NAME[k] === piece);
          if (!s || !this.legalTargetsBySq[s]) return; // 该棋子无合法打点
          // 驹台点击走这里（棋盘容器不含驹台，_handleClick 的 hand 分支不可达）：
          // 再次点击同种持驹 = 放下（取消选中）；点击其他种类 = 切换选中
          this._pickHand(color, piece, s);
        };
        const vp = this.viewpoint;
        if (this.handsEls.opp) global.renderHands(this.handsEls.opp, this.model.hands, this.handsEls.oppColor, this.interactive ? pick(this.handsEls.oppColor) : null, vp);
        if (this.handsEls.my) global.renderHands(this.handsEls.my, this.model.hands, this.handsEls.myColor, this.interactive ? pick(this.handsEls.myColor) : null, vp);
      }
    }
  }

  /** 标准平手初始盘面模型（谱面浏览/重放用） */
  function initialModel() {
    const board = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => ({ piece: null, color: null, promoted: false, sq: `${c + 1}${String.fromCharCode(97 + r)}` })));
    const set = (r, c, piece, color) => { board[r][c] = { piece, color, promoted: false, sq: `${c + 1}${String.fromCharCode(97 + r)}` }; };
    const backW = ['香', '桂', '銀', '金', '玉', '金', '銀', '桂', '香'];
    for (let c = 0; c < 9; c++) { set(0, c, backW[c], 'w'); set(8, c, backW[c], 'b'); set(2, c, '歩', 'w'); set(6, c, '歩', 'b'); }
    set(1, 1, '角', 'w'); set(1, 7, '飛', 'w');
    set(7, 1, '飛', 'b'); set(7, 7, '角', 'b');
    return { board, hands: { b: [], w: [] } };
  }

  /**
   * 将一步合法 USI 应用到模型（纯结构变换：移动/吃子/打子/升变）。
   * color：该手的行棋方。规则已由服务端校验。
   */
  function applyUsiOnModel(model, usi, color) {
    const dropM = /^([PLNSGBR])\*([1-9])([a-i])$/.exec(usi);
    if (dropM) {
      const piece = DROP_NAME[dropM[1]];
      const sq = usi.slice(2);
      const [r, c] = sqToRC(sq);
      const list = model.hands[color] = model.hands[color] || [];
      const idx = list.findIndex((h) => h.piece === piece);
      if (idx >= 0) {
        list[idx].count -= 1;
        if (list[idx].count <= 0) list.splice(idx, 1);
      }
      model.board[r][c] = { piece, color, promoted: false, sq };
      return;
    }
    if (usi.length >= 4) {
      const fromSq = usi.slice(0, 2);
      const toSq = usi.slice(2, 4);
      const promote = usi[4] === '+';
      const [fr, fc] = sqToRC(fromSq);
      const [tr, tc] = sqToRC(toSq);
      const piece = model.board[fr][fc];
      if (!piece || !piece.piece) return;
      const target = model.board[tr][tc];
      if (target && target.piece) {
        const raw = DEMOTE[target.piece] || target.piece;
        const list = model.hands[color] = model.hands[color] || [];
        const h = list.find((x) => x.piece === raw);
        if (h) h.count += 1;
        else list.push({ piece: raw, count: 1 });
      }
      let name = piece.piece;
      let promoted = !!piece.promoted;
      if (promote) { name = PROMOTE[name] || name; promoted = true; }
      model.board[tr][tc] = { piece: name, color: piece.color, promoted, sq: toSq };
      model.board[fr][fc] = null;
    }
  }

  global.FreeBoard = FreeBoard;
  FreeBoard.initialModel = initialModel;
  FreeBoard.applyUsiOnModel = applyUsiOnModel;
})(window);
