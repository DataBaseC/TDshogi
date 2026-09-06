/**
 * game.js — 基于 shogi.js 的规则引擎封装（服务端权威判定）
 *
 * shogi.js 是底层库：getMovesFrom / getDropsBy 只做"伪合法"检查
 * （移动规则、二歩、打步死），但**不检查王手自杀**。因此本模块负责：
 *
 *  1. 王手过滤：对每个候选走法，在临时副本上模拟，若导致己方王被将则剔除。
 *  2. 升变候选：为每个 from→to 判断是否存在"成 / 不成"两种走法。
 *  3. 结果判定：王手、将死、千日手、入玉（持将棋）。
 *  4. 局面快照：输出前端渲染所需的统一结构。
 *
 * 对外只暴露 USI 走法字符串，前端不直接触碰 shogi.js。
 */
'use strict';

const { Shogi, Piece, Color, kindToString } = require('shogi.js');
const {
  usiSquareToXY, xyToUsiSquare, parseUsiMove, moveToUsi,
} = require('./coords');

const STARTING_SFEN = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';

// shogi.js Kind 与中文/英文名称、CSA 符号映射
const KIND_NAME = {
  FU: '歩', KY: '香', KE: '桂', GI: '銀', KI: '金',
  KA: '角', HI: '飛', OU: '玉',
  TO: 'と', NY: '成香', NK: '成桂', NG: '成銀', UM: '馬', RY: '龍',
};
// 原始（未成）棋子 → 可用于打子的 CSA 符号
const RAW_TO_DROP = { FU: 'P', KY: 'L', KE: 'N', GI: 'S', KI: 'G', KA: 'B', HI: 'R' };
const DROP_TO_KIND = { P: 'FU', L: 'KY', N: 'KE', S: 'GI', G: 'KI', B: 'KA', R: 'HI' };

const KING_POSITIONS = {}; // color -> {x,y} 缓存，走子后失效

function cloneBoard(shi) {
  const s = new Shogi();
  s.initializeFromSFENString(shi.toSFENString());
  return s;
}

function findKing(shi, color) {
  for (let y = 1; y <= 9; y++) {
    for (let x = 1; x <= 9; x++) {
      const p = shi.get(x, y);
      if (p && p.kind === 'OU' && p.color === color) {
        return { x, y };
      }
    }
  }
  return null;
}

/**
 * 判断在给定 Shogi 局面上，color 方走一步后是否合法（即己方王不被将）。
 * @param {Shogi} shi 局面
 * @param {import('./coords').UsiMove} mv 待验证走法
 */
function isMoveLegal(shi, mv) {
  const clone = cloneBoard(shi);
  try {
    if (mv.type === 'drop') {
      const to = usiSquareToXY(mv.to);
      clone.drop(to.x, to.y, DROP_TO_KIND[mv.piece]);
    } else {
      const from = usiSquareToXY(mv.from);
      const to = usiSquareToXY(mv.to);
      clone.move(from.x, from.y, to.x, to.y, mv.promote);
    }
  } catch (err) {
    return false;
  }
  // 走子/打子后 clone.turn 均已切换到对手 → 走子方自己的王 = oppositeColor(clone.turn)。
  // 修复：原打子分支误查 clone.turn（对手的王），导致「打入对方王周围构成打将」的
  // 合法着法（如金打王侧）被误判非法。打将是否成立由对方应对，不在此过滤。
  return !clone.isCheck(oppositeColor(clone.turn));
}

function oppositeColor(color) {
  return color === Color.Black ? Color.White : Color.Black;
}

/**
 * 从某格出发的候选走法（含升变两种情况）。
 * 返回 USI 数组。
 */
function candidateMovesFrom(shi, x, y, piece, legalOnly = true) {
  const out = [];
  const color = piece.color;
  const rawKind = Piece.unpromote(piece.kind);

  // 盘上移动
  for (const m of shi.getMovesFrom(x, y)) {
    const toSq = xyToUsiSquare(m.to.x, m.to.y);
    // 是否可能升变：棋子非玉、非金、且未成，且落点在其升变区域内
    const canPromote = rawKind !== 'OU' && rawKind !== 'KI' && !Piece.isPromoted(piece.kind)
      && inPromotionZone(m.to.y, color);
    if (canPromote) {
      const promoteMv = { type: 'move', from: xyToUsiSquare(x, y), to: toSq, promote: true };
      if (!legalOnly || isMoveLegal(shi, promoteMv)) out.push(moveToUsi(promoteMv));
      // 不成（无路可走时强制升变除外——move 会自动升变，但我们这里手动区分）
      const nonPromoteMv = { type: 'move', from: xyToUsiSquare(x, y), to: toSq, promote: false };
      if (!legalOnly || isMoveLegal(shi, nonPromoteMv)) out.push(moveToUsi(nonPromoteMv));
    } else {
      const mv = { type: 'move', from: xyToUsiSquare(x, y), to: toSq, promote: false };
      if (!legalOnly || isMoveLegal(shi, mv)) out.push(moveToUsi(mv));
    }
  }
  return out;
}

function inPromotionZone(y, color) {
  // 先手（Black）推进方向是 y 减小（朝 9 段），升变区为 y<=3（1、2、3 行/段）
  // 后手（White）推进方向是 y 增大，升变区为 y>=7
  return color === Color.Black ? y <= 3 : y >= 7;
}

class Game {
  constructor(startSfen = STARTING_SFEN, names = ['先手', '後手']) {
    this.startSfen = startSfen;
    this.names = names;
    this.shogi = new Shogi();
    try {
      this.shogi.initializeFromSFENString(startSfen);
    } catch (err) {
      this.shogi = new Shogi(); // 兜底回平手
    }
    this.moves = [];            // USI 走法历史
    this.result = null;         // 'b' | 'w' | '-' | null
    this.resultDetail = null;   // '詰み' | '投了' | '千日手' | '入玉' | null
    this.lastMove = null;       // 最近一手 USI
  }

  get turn() {
    return this.shogi.turn === Color.Black ? 'b' : 'w';
  }

  /**
   * 当前局面所有合法走法（USI 数组），已过滤王手自杀。
   */
  legalMovesUsi() {
    const out = [];
    const color = this.shogi.turn;
    for (let y = 1; y <= 9; y++) {
      for (let x = 1; x <= 9; x++) {
        const p = this.shogi.get(x, y);
        if (p && p.color === color) {
          out.push(...candidateMovesFrom(this.shogi, x, y, p));
        }
      }
    }
    // 打子
    for (const m of this.shogi.getDropsBy(color)) {
      const mv = { type: 'drop', piece: RAW_TO_DROP[Piece.unpromote(m.kind)], to: xyToUsiSquare(m.to.x, m.to.y) };
      if (isMoveLegal(this.shogi, mv)) out.push(moveToUsi(mv));
    }
    return out;
  }

  /**
   * 从某个起点（盘上格名 or 打子符号）出发的合法走法，用于前端高亮。
   * @param {string} from '7g' 或 'P'/'L'/...（打子符号）
   * @returns {{to:string, usi:string, promote:boolean, drop:boolean}[]}
   */
  legalTargets(from) {
    const color = this.shogi.turn;
    const out = [];
    // 打子：from 为打子符号（'P'/'L'/'N'/'S'/'G'/'B'/'R'），用 DROP_TO_KIND（符号→kind）判断
    if (from && from.length === 1 && from in DROP_TO_KIND) {
      const kind = DROP_TO_KIND[from];
      const dropMoves = this.shogi.getDropsBy(color).filter((m) => m.kind === kind);
      for (const m of dropMoves) {
        const mv = { type: 'drop', piece: from, to: xyToUsiSquare(m.to.x, m.to.y) };
        if (isMoveLegal(this.shogi, mv)) {
          out.push({ to: mv.to, usi: moveToUsi(mv), promote: false, drop: true });
        }
      }
      return out;
    }
    // 盘上移动
    let xy;
    try { xy = usiSquareToXY(from); } catch (_) { return out; }
    const piece = this.shogi.get(xy.x, xy.y);
    if (!piece || piece.color !== color) return out;
    for (const usi of candidateMovesFrom(this.shogi, xy.x, xy.y, piece)) {
      const parsed = parseUsiMove(usi);
      out.push({ to: parsed.to, usi, promote: parsed.promote, drop: false });
    }
    return out;
  }

  /**
   * 同一 from→to 是否同时存在"成/不成"两种走法。
   * @returns {string[]|null} [不成usi, 成usi] 或 null
   */
  promotionChoice(from, to) {
    const cands = this.legalTargets(from).filter((t) => t.to === to);
    const usis = cands.map((c) => c.usi);
    if (usis.length >= 2) return usis;
    return null;
  }

  /**
   * 执行一步走子。
   * @param {string} usi
   * @returns {{ok:boolean, error?:string}}
   */
  applyMove(usi) {
    let mv;
    try { mv = parseUsiMove(usi); } catch (_) { return { ok: false, error: '无法解析走法' }; }
    // 合法性校验（含王手过滤）
    if (!isMoveLegal(this.shogi, mv)) {
      return { ok: false, error: '非法走法' };
    }
    try {
      if (mv.type === 'drop') {
        const to = usiSquareToXY(mv.to);
        this.shogi.drop(to.x, to.y, DROP_TO_KIND[mv.piece]);
      } else {
        const from = usiSquareToXY(mv.from);
        const to = usiSquareToXY(mv.to);
        this.shogi.move(from.x, from.y, to.x, to.y, mv.promote);
      }
    } catch (err) {
      return { ok: false, error: `走子失败: ${err.message}` };
    }
    this.moves.push(usi);
    this.lastMove = usi;
    this.updateResult();
    return { ok: true };
  }

  /**
   * 判定并更新结果。
   */
  updateResult() {
    const color = this.shogi.turn; // 当前轮到的一方
    const opp = oppositeColor(color);
    const myKing = findKing(this.shogi, color);
    const oppKing = findKing(this.shogi, opp);

    // 对方王被吃（不可能在合法棋中出现，但兜底）
    if (!oppKing) {
      this.result = color === Color.Black ? 'b' : 'w';
      this.resultDetail = '詰み';
      return;
    }

    // 当前方是否被将死：被将且无合法着法
    if (this.shogi.isCheck(color)) {
      if (this.legalMovesUsi().length === 0) {
        this.result = opp === Color.Black ? 'b' : 'w';
        this.resultDetail = '詰み';
        return;
      }
    }

    // 入玉 / 持将棋：己方王未死但无合法着法（困毙）
    if (!myKing) {
      // 王被吃则判负
      this.result = color === Color.Black ? 'w' : 'b';
      this.resultDetail = '詰み';
      return;
    }
    if (this.legalMovesUsi().length === 0) {
      this.result = '-';
      this.resultDetail = '入玉';
      return;
    }

    // 千日手：局面重复 4 次
    if (this.isFourfoldRepetition()) {
      this.result = '-';
      this.resultDetail = '千日手';
      return;
    }

    this.result = null;
    this.resultDetail = null;
  }

  /**
   * 判断是否出现千日手（同一局面+同一手番+同一持驹重复 4 次）。
   * 通过重放走法并哈希每步局面。
   */
  isFourfoldRepetition() {
    const seen = new Map();
    const replay = new Shogi();
    replay.initializeFromSFENString(this.startSfen);
    const keyOf = (shi) => shi.toSFENString().replace(/ \d+$/, ''); // 去掉手数字段
    for (let i = 0; i <= this.moves.length; i++) {
      const key = keyOf(replay);
      seen.set(key, (seen.get(key) || 0) + 1);
      if (i === this.moves.length) break;
      const mv = parseUsiMove(this.moves[i]);
      try {
        if (mv.type === 'drop') {
          const to = usiSquareToXY(mv.to);
          replay.drop(to.x, to.y, DROP_TO_KIND[mv.piece]);
        } else {
          const from = usiSquareToXY(mv.from);
          const to = usiSquareToXY(mv.to);
          replay.move(from.x, from.y, to.x, to.y, mv.promote);
        }
      } catch (_) {
        return false;
      }
    }
    return [...seen.values()].some((n) => n >= 4);
  }

  /**
   * 认输（当前手番方认输）。
   */
  resign() {
    const color = this.shogi.turn;
    this.result = color === Color.Black ? 'w' : 'b';
    this.resultDetail = '投了';
  }

  isGameOver() {
    return !!this.result;
  }

  /**
   * 输出统一局面快照，供前端渲染。
   * board: display[0]=9段(上) 左起9筋→1筋，元素 {piece, color, promoted, sq} 或 null
   */
  state() {
    const shi = this.shogi;
    const rows = [];
    for (let y = 1; y <= 9; y++) {       // y=1 最上段(9段)
      const row = [];
      for (let x = 1; x <= 9; x++) {     // x=1 1筋 ... x=9 9筋（需转成显示 9筋→1筋）
        const p = shi.get(x, y);
        const sq = xyToUsiSquare(x, y);
        if (p) {
          row.push({
            piece: KIND_NAME[p.kind],
            color: p.color === Color.Black ? 'b' : 'w',
            promoted: Piece.isPromoted(p.kind),
            sq,
          });
        } else {
          row.push({ piece: null, color: null, promoted: false, sq });
        }
      }
      rows.push(row);
    }
    return {
      sfen: shi.toSFENString(),
      turn: this.turn,
      board: rows,
      hands: this.hands(),
      moves: [...this.moves],
      check: shi.isCheck(shi.turn),
      result: this.result,
      resultDetail: this.resultDetail,
      lastMove: this.lastMove,
      names: this.names,
    };
  }

  /**
   * 持驹。
   * @returns {{b: {piece, count}[], w: {piece, count}[]}}
   */
  hands() {
    const out = { b: [], w: [] };
    for (const color of [Color.Black, Color.White]) {
      const key = color === Color.Black ? 'b' : 'w';
      const summary = this.shogi.getHandsSummary(color);
      // 展示顺序：飛角金銀桂香歩（对应 RAW_TO_DROP 顺序 R B G S N L P）
      for (const kind of ['HI', 'KA', 'KI', 'GI', 'KE', 'KY', 'FU']) {
        const count = summary[kind] || 0;
        if (count > 0) {
          out[key].push({ piece: KIND_NAME[kind], count });
        }
      }
    }
    return out;
  }

  /**
   * 某一方当前是否王手。
   */
  isCheck() {
    return this.shogi.isCheck(this.shogi.turn);
  }
}

function newGame(startSfen = STARTING_SFEN, names = ['先手', '後手']) {
  return new Game(startSfen, names);
}

module.exports = {
  Game,
  newGame,
  STARTING_SFEN,
  KIND_NAME,
  kindToString,
};
