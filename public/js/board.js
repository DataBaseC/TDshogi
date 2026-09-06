/**
 * board.js — 棋子渲染 + 棋盘渲染 + 走子交互
 *
 * 棋子：使用你自定义的木棋子图集（pieces/kinki.png 或 pieces/ryoko.png）。
 *  - 两方棋子用同一张图集（统一字体/风格）
 *  - 先手/后手以方向区分（后手旋转 180°）
 *  - 升变使用图集中对应的成駒 cell
 *
 * 棋盘：9x9，格内用 USI 坐标定位。支持渲染由服务端下发的 state.board。
 */
(function (global) {
  // 棋子中文名 → kind（来自服务端 KIND_NAME）
  const NAME_TO_KEY = {
    '歩': 'FU', '香': 'KY', '桂': 'KE', '銀': 'GI', '金': 'KI',
    '角': 'KA', '飛': 'HI', '玉': 'OU', '王': 'OU',
    'と': 'TO', '杏': 'NY', '圭': 'NK', '全': 'NG', '馬': 'UM', '龍': 'RY',
    '成香': 'NY', '成桂': 'NK', '成銀': 'NG',
  };

  // 默认棋子图集（可由外部用 window.PIECE_ATLAS_DEFAULT 覆盖）
  function getAtlas() {
    return window.PIECE_ATLAS_DEFAULT || 'pieces/kinki.png';
  }

  /** 当前格尺寸（px），由 CSS 变量 --cell-size 驱动，窄屏响应式缩小 */
  function cellSize() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--cell-size');
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n > 0 && /^\s*[\d.]+px/.test(v)) return n;
    // 移动端自适应（PLAN §N）：--cell-size 为 'auto' 时按视口宽度推导。
    // 注意：CSS 自定义属性不解析 vw/min()（getComputedStyle 拿到的是原始 token），
    // 因此手机端媒体查询里 --cell-size 设为 auto，由这里按视口算出像素值。
    const vw = Math.min(window.innerWidth, 640);
    const byViewport = Math.floor((vw - 70) / 9); // 70 ≈ 棋盘 padding + 页面留白
    return Math.max(28, Math.min(48, byViewport));
  }

  /**
   * 渲染一个棋子（返回 HTML），用于棋盘格和持驹区。
   * 现在改用图片素材（pieces.js.pieceHTML），传入 piece 对象。
   * 内部函数名避开 window.pieceHTML 避免递归。
   * @param {object} piece { piece, color, promoted, sq }
   * @param {number} size
   * @param {string} viewpoint 'b' | 'w'（决定棋子朝向）
   */
  function renderPiece(piece, size, viewpoint) {
    if (!window.pieceHTML) return '';  // pieces.js 未加载
    const kind = NAME_TO_KEY[piece.piece] || 'FU';
    return window.pieceHTML({
      kind,
      color: piece.color,
      promoted: !!piece.promoted,
      size,
      atlas: getAtlas(),
      viewpoint: viewpoint || 'b',
    });
  }

  /**
   * 棋盘渲染器。
   * @param {HTMLElement} container
   */
  class ShogiBoard {
    constructor(container, opts = {}) {
      this.container = container;
      this.opts = opts;
      this.onSelect = opts.onSelect || null;   // (fromSq, piece) => void
      this.onMove = opts.onMove || null;       // (usi) => void
      this.onDrop = opts.onDrop || null;       // (dropPiece, toSq) => void
      this.state = null;
      this.selected = null;     // 当前选中格名（'7g'）或打子符号（'P'）
      this.targets = [];        // 合法目标
      this.interactive = false; // 是否可交互（走子方）
      this.readonly = false;    // 完全只读（回放）
      this.build();
    }

    build() {
      this.container.innerHTML = '';
      this.boardEl = document.createElement('div');
      this.boardEl.className = 'shogi-board';
      this.boardEl.style.position = 'relative';
      this.boardEl.style.display = 'inline-block';
      this.renderEmptyBoard();
      this.container.appendChild(this.boardEl);
    }

    renderEmptyBoard() {
      const grid = document.createElement('div');
      grid.className = 'board-grid';
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(9,1fr);gap:0;position:relative;';
      this.cells = [];
      const sz = cellSize();
      for (let r = 0; r < 9; r++) {
        const row = [];
        for (let c = 0; c < 9; c++) {
          const cell = document.createElement('div');
          cell.className = 'cell';
          cell.style.cssText = `position:relative;width:${sz}px;height:${sz}px;`;
          cell.dataset.r = r;
          cell.dataset.c = c;
          grid.appendChild(cell);
          row.push(cell);
        }
        this.cells.push(row);
      }
      this.boardEl.appendChild(grid);
    }

    /**
     * 更新棋盘显示。
     *
     * 服务端 board[r][col]：
     *   - board[0] = y=1 = 段 1（顶部，后手方）
     *   - board[8] = y=9 = 段 9（底部，先手方）
     *   - col 0 = 1筋，col 8 = 9筋
     *
     * 标准视角（自己永远在下方、近处）：
     *   - 先手(b) 视角：行不变（board[0]=后手在顶部=对面，board[8]=先手在底部=自己），
     *                    列反转（9筋在左）。
     *   - 后手(w) 视角：行镜像（board[0]=后手翻转到底部=自己，board[8]=先手翻到顶部=对面），
     *                    列不变（1筋在左）。
     *
     * 棋子方向由 viewpoint 决定（pieces.js：己方正立，对方旋转180°）。
     *
     * @param {object} state
     * @param {object} extra
     * @param {string} viewpoint 'b' | 'w'
     */
    render(state, extra = {}, viewpoint = 'b') {
      this.state = state;
      this.extra = extra;
      this.viewpoint = viewpoint;
      const board = state.board;
      const flipRow = viewpoint === 'w'; // 后手视角：行镜像（自己翻到底部）
      const colFrom = (c) => viewpoint === 'b' ? (8 - c) : c; // 列方向（先手9筋左，后手1筋左）
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          const dr = flipRow ? (8 - r) : r;  // 行：后手镜像
          const cell = this.cells[dr][c];
          cell.innerHTML = '';
          // 必须包含 has-piece：否则吃子目标（方块）的类残留到空格格子上，
          // 导致「合法目标空格」被污染成绿色方块而非绿点
          cell.classList.remove('sel', 'target', 'check', 'last', 'has-piece');
          const col = colFrom(c);
          const piece = board[r][col];
          if (piece && piece.piece) {
            cell.innerHTML = renderPiece(piece, cellSize() - 8, viewpoint);
            cell.dataset.sq = piece.sq;
          } else {
            // 空格 sq 应从「服务端」未镜像的行 r 反推
            cell.dataset.sq = this._rCToSq(r, c, viewpoint);
          }
        }
      }
      this.applyHighlights(extra);
    }

    _rCToSq(r, c, viewpoint = 'b') {
      // 显示 (r,c) 来自服务端 display[r][colFrom(c)]
      const col = viewpoint === 'b' ? (8 - c) : c;
      const y = r + 1;
      const x = col + 1;
      const rankChar = String.fromCharCode(97 + (y - 1));
      return `${x}${rankChar}`;
    }

    applyHighlights(extra) {
      // 上一步（USI 如 '7g7f' 或打子 'P*5e' → 只需高亮落点 '7f'/'5e'）
      // 修复：原直接传完整 USI 给 highlightSq，_findCell 永远匹配不到（格子 sq 是单格），
      //       导致「上一步」橙色高亮从不显示
      if (extra.lastMove) {
        const lastTo = extra.lastMove.length >= 4 ? extra.lastMove.slice(2) : extra.lastMove;
        this.highlightSq(lastTo, 'last');
      }
      // 王手红格
      (extra.check || []).forEach((sq) => this.highlightSq(sq, 'check'));
      // 选中
      if (this.selected) {
        this.highlightSq(this.selected, 'sel');
      }
      // 合法目标
      (this.targets || []).forEach((t) => this.highlightSq(t.to, 'target'));
    }

    highlightSq(sq, cls) {
      const cell = this._findCell(sq);
      if (cell) cell.classList.add(cls);
    }

    _findCell(sq) {
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          const cell = this.cells[r][c];
          if (cell.dataset.sq === sq) return cell;
        }
      }
      return null;
    }

    /**
     * 设置交互状态（可走子时传 legalTargets 映射）。
     */
    setInteractive(interactive) {
      this.interactive = interactive;
    }

    setSelected(from) {
      this.selected = from;
    }
  }

  // 打子符号（服务端 legalTargets 用 'P','L','N','S','G','B','R'）
  const DROP_SYMBOLS = { P: '歩', L: '香', N: '桂', S: '銀', G: '金', B: '角', R: '飛' };
  const DROP_KANJI = { P: 'FU', L: 'KY', N: 'KE', S: 'GI', G: 'KI', B: 'KA', R: 'HI' };

  /**
   * 渲染持驹区。只清除已渲染的棋子 (.hand-piece)，保留容器内其他节点
   * （如 label 标签），避免反复 append 造成内存泄漏与标签丢失。
   */
  function renderHands(container, hands, color, onPick, viewpoint = 'b') {
    // 只清除已渲染的棋子节点，保留容器内的 label 等
    container.querySelectorAll('.hand-piece').forEach((el) => el.remove());
    const list = hands && hands[color] ? hands[color] : [];
    list.forEach((h) => {
      const wrap = document.createElement('div');
      wrap.className = 'hand-piece';
      wrap.dataset.piece = h.piece;
      const key = NAME_TO_KEY[h.piece] || 'FU';
      wrap.innerHTML = window.pieceHTML({
        kind: key, color, promoted: false, size: 44, atlas: getAtlas(), viewpoint,
      });
      if (h.count > 1) {
        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = h.count;
        wrap.appendChild(count);
      }
      if (onPick) {
        wrap.onclick = () => onPick(h.piece);
      }
      container.appendChild(wrap);
    });
  }

  global.ShogiBoard = ShogiBoard;
  global.renderHands = renderHands;
  global.DROP_SYMBOLS = DROP_SYMBOLS;
  global.DROP_KANJI = DROP_KANJI;
})(window);
