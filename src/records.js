/**
 * records.js — 棋谱：JSON 落盘 + 历史列表 + 日本标准 KIF/CSA 导出
 *
 * KIF / CSA 严格遵循日本业内标准格式，判定原理对照参考项目 record.py 重写为 JS 版：
 *
 *  - KIF：`Kifu for Windows` 头、`手合割：平手`、`先手/後手`、
 *    `手数----指手` 表头、日式记谱「７六歩(77)」「同　銀(33)」「２二角成(88)」「８八角打」、
 *    结果「までN手で○○の勝ち」。
 *  - CSA：`V2.2` 头、`N+/N-`、`P1~P9` 盘面、持驹、手番、走法行 `+776FU`、结果 `%TORYO/%TSUMI/%SENNICHITE`。
 */
'use strict';

const { Shogi, Color } = require('shogi.js');
const { putRecord, getRecordById, listRecords: dbListRecords, searchRecords: dbSearch } = require('./storage');
const { parseUsiMove, usiSquareToXY } = require('./coords');
const { KIND_NAME } = require('./game');

// 打子符号 → shogi.js kind（本地定义，game.js 不导出）
const DROP_TO_KIND = { P: 'FU', L: 'KY', N: 'KE', S: 'GI', G: 'KI', B: 'KA', R: 'HI' };

const FULL_WIDTH = '１２３４５６７８９';
const KANJI_NUM = '一二三四五六七八九';

// rank 字母 a~i 对应段 1~9（a=1段最上, i=9段最下，标准 USI / 日本将棋记谱）
// shogi.js 的 y 坐标即段号（y=1=段1最上）
function rankCharToSegment(rankChar) {
  return rankChar.charCodeAt(0) - 96; // a->1, i->9
}
function fileToFull(file) {
  return FULL_WIDTH[parseInt(file, 10) - 1];
}
function segmentToKanji(seg) {
  return KANJI_NUM[seg - 1];
}
// USI 格 '7g' -> 日式坐标 '76'（筋+段，如 7筋7段=77）
function usiToJpCoord(sq) {
  const file = parseInt(sq[0], 10);
  const seg = rankCharToSegment(sq[1]);
  return `${file}${seg}`;
}
// USI 格 '7g' -> CSA 坐标 '76'
function usiToCsaCoord(sq) {
  return usiToJpCoord(sq);
}

const CSA_PIECE = {
  FU: 'FU', KY: 'KY', KE: 'KE', GI: 'GI', KI: 'KI',
  KA: 'KA', HI: 'HI', OU: 'OU', TO: 'TO', NY: 'NY',
  NK: 'NK', NG: 'NG', UM: 'UM', RY: 'RY',
};
const PROMOTED_MAP = { KY: 'NY', KE: 'NK', GI: 'NG', KA: 'UM', HI: 'RY' };

/**
 * 在 board 上执行一步走子（仅推进用）。
 */
function applyMoveOn(board, mv) {
  if (mv.type === 'drop') {
    const to = usiSquareToXY(mv.to);
    board.drop(to.x, to.y, DROP_TO_KIND[mv.piece]);
  } else {
    const from = usiSquareToXY(mv.from);
    const to = usiSquareToXY(mv.to);
    board.move(from.x, from.y, to.x, to.y, mv.promote);
  }
}

/**
 * 走法历史 -> 逐手 KIF 记谱（含来源日式坐标）。
 */
function movesToKif(sfen, moves) {
  const board = new Shogi();
  board.initializeFromSFENString(sfen);
  const out = [];
  let lastTo = null;
  for (const usi of moves) {
    const mv = parseUsiMove(usi);
    out.push(moveToKif(board, mv, lastTo));
    applyMoveOn(board, mv);
    lastTo = mv.to;
  }
  return out;
}

function moveToKif(board, mv, lastTo) {
  const xFull = fileToFull(mv.to[0]);
  const yKanji = segmentToKanji(rankCharToSegment(mv.to[1]));
  if (mv.type === 'drop') {
    return `${xFull}${yKanji}${KIND_NAME[DROP_TO_KIND[mv.piece]]}打`;
  }
  // 盘上移动：来源棋子类型从 board 读
  const from = usiSquareToXY(mv.from);
  const pieceKind = board.get(from.x, from.y).kind;
  const piece = KIND_NAME[pieceKind];
  const head = lastTo === mv.to ? `同　${piece}` : `${xFull}${yKanji}${piece}`;
  if (mv.promote) return `${head}成(${usiToJpCoord(mv.from)})`;
  return `${head}(${usiToJpCoord(mv.from)})`;
}

// ======================================================================
// JSON 落盘 / 历史列表
// ======================================================================

let recordSeq = 0;

/**
 * 保存一局棋谱（JSON），返回记录对象。
 */
function saveRecord(data) {
  recordSeq += 1;
  const now = Date.now();
  const id = `${now.toString(36)}${recordSeq.toString(36)}`;
  const record = {
    id,
    startSfen: data.startSfen,
    moves: data.moves || [],
    names: data.names || ['先手', '後手'],
    result: data.result,
    resultDetail: data.resultDetail,
    playerIds: data.playerIds || { b: null, w: null },
    winnerId: data.winnerId || null,
    rated: data.rated !== false,
    source: data.source || null,
    createdAt: data.createdAt || now,
    durationSec: data.durationSec || null,
  };
  putRecord(record);
  return record;
}

function listRecords(limit = 200) {
  try {
    return dbListRecords(limit);
  } catch (_) {
    return [];
  }
}

function getRecord(id) {
  try {
    return getRecordById(id);
  } catch (_) {
    return null;
  }
}

function listPlayerRecords(playerId, limit = 50) {
  return listRecords(500)
    .filter((r) => r.playerIds && (r.playerIds.b === playerId || r.playerIds.w === playerId))
    .slice(0, limit);
}

/**
 * 棋谱检索（SQL 层过滤）。
 * @param {object} q 见 storage.searchRecords
 * @returns {Array} 匹配的棋谱（附带 opening 开局特征）
 */
function searchRecords(q = {}) {
  const rows = dbSearch(q);
  return rows.map((r) => ({ ...r, opening: openingName(r) }));
}

/** 开局特征：前 4 手 USI 序列（作定式指纹展示） */
function openingName(rec) {
  const moves = rec.moves || [];
  if (!moves.length) return '';
  return moves.slice(0, Math.min(4, moves.length)).join(',');
}

// ======================================================================
// KIF / CSA 导出
// ======================================================================

const DEFAULT_SFEN = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';

function exportKif(rec) {
  const lines = [
    '# ---- Kifu for Windows V7 V7.1 棋譜ファイル ----',
    `開始日時：${new Date(rec.createdAt || Date.now()).toISOString().replace('T', ' ').slice(0, 19)}`,
    '終了日時：',
    '手合割：平手',
    `先手：${rec.names ? rec.names[0] : '先手'}`,
    `後手：${rec.names ? rec.names[1] : '後手'}`,
    '手数----指手---------消費時間--',
  ];
  const jpMoves = movesToKif(rec.startSfen || DEFAULT_SFEN, rec.moves || []);
  jpMoves.forEach((m, i) => lines.push(`${i + 1} ${m}`));
  const n = (rec.moves || []).length;
  if (rec.resultDetail === '投了') {
    lines.push(`${n + 1} 投了`);
    lines.push(`まで${n}手で${rec.names[rec.result === 'b' ? 0 : 1]}の勝ち`);
  } else if (rec.result === 'b' || rec.result === 'w') {
    lines.push(`まで${n}手で${rec.names[rec.result === 'b' ? 0 : 1]}の勝ち`);
  } else if (rec.result === '-') {
    lines.push(`まで${n}手で${rec.resultDetail || '持将棋'}`);
  }
  return lines.join('\n') + '\n';
}

function exportCsa(rec) {
  const board = new Shogi();
  board.initializeFromSFENString(rec.startSfen || DEFAULT_SFEN);
  const lines = ['V2.2'];
  lines.push(`N+${rec.names ? rec.names[0] : '先手'}`);
  lines.push(`N-${rec.names ? rec.names[1] : '後手'}`);
  // 盘面 P1(9段)~P9(1段)：y=1 为 9段，x=1 为 1筋
  for (let y = 1; y <= 9; y++) {
    let row = `P${y}`;
    for (let x = 1; x <= 9; x++) {
      const p = board.get(x, y);
      if (!p) row += ' * ';
      else row += (p.color === Color.Black ? '+' : '-') + CSA_PIECE[p.kind];
    }
    lines.push(row);
  }
  // 持驹
  for (const [color, sign] of [[Color.Black, 'P+'], [Color.White, 'P-']]) {
    const summary = board.getHandsSummary(color);
    const parts = [];
    for (const kind of ['FU', 'KY', 'KE', 'GI', 'KI', 'KA', 'HI']) {
      for (let i = 0; i < (summary[kind] || 0); i++) parts.push(`00${CSA_PIECE[kind]}`);
    }
    if (parts.length) lines.push(sign + parts.join(''));
  }
  lines.push(board.turn === Color.Black ? '+' : '-');
  // 走法
  for (const usi of rec.moves || []) {
    const mv = parseUsiMove(usi);
    const color = board.turn === Color.Black ? '+' : '-';
    if (mv.type === 'drop') {
      lines.push(`${color}00${usiToCsaCoord(mv.to)}${CSA_PIECE[DROP_TO_KIND[mv.piece]]}`);
      applyMoveOn(board, mv);  // 打子同样推进盘面，否则后续棋子读取错位
    } else {
      const fromXY = usiSquareToXY(mv.from);
      const pieceKind = board.get(fromXY.x, fromXY.y).kind;
      let pt = mv.promote ? (PROMOTED_MAP[pieceKind] || pieceKind) : pieceKind;
      lines.push(`${color}${usiToCsaCoord(mv.from)}${usiToCsaCoord(mv.to)}${CSA_PIECE[pt]}`);
      applyMoveOn(board, mv);
    }
  }
  // 结果
  if (rec.resultDetail === '投了') lines.push('%TORYO');
  else if (rec.resultDetail === '詰み') lines.push('%TSUMI');
  else if (rec.result === '-') lines.push(rec.resultDetail === '入玉' ? '%HIKIWAKE' : '%SENNICHITE');
  return lines.join('\n') + '\n';
}

function exportRecord(rec, fmt) {
  return fmt === 'csa' ? exportCsa(rec) : exportKif(rec);
}

/**
 * 生成回放数据：每一步之后的局面快照（board 数组）。
 * @param {object} rec
 * @returns {{startSfen:string, moves:string[], positions:Array}}
 */
function playbackData(rec) {
  const { Game } = require('./game');
  const game = new Game(rec.startSfen || DEFAULT_SFEN, rec.names);
  const positions = [];
  // 初始局面（含持驹）
  const snap = () => {
    const s = game.state();
    return { board: s.board, hands: s.hands || {} };
  };
  positions.push(snap());
  for (const usi of rec.moves || []) {
    game.applyMove(usi);
    positions.push(snap());
  }
  return {
    id: rec.id,
    startSfen: rec.startSfen || DEFAULT_SFEN,
    moves: rec.moves || [],
    positions,
    names: rec.names,
    result: rec.result,
    resultDetail: rec.resultDetail,
  };
}

/**
 * 导入 KIF 棋谱为平台记录（管理员）。
 * @param {string} text KIF 文本
 * @returns {{ok:true, record:object}|{ok:false, error:string}}
 */
function importKif(text) {
  const { parseKif } = require('./kif');
  let parsed;
  try {
    parsed = parseKif(text);
  } catch (e) {
    return { ok: false, error: `KIF 解析失败：${e.message}` };
  }
  // 尝试从 KIF 头提取"開始日時：YYYY/MM/DD HH:MM"
  let createdAt = null;
  const m = /開始日時[：:]\s*(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})[ 　](\d{1,2}):(\d{1,2})/.exec(text || '');
  if (m) {
    createdAt = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  }
  const record = saveRecord({
    startSfen: parsed.startSfen,
    moves: parsed.moves,
    names: parsed.names,
    result: parsed.result || null,
    resultDetail: parsed.resultDetail || null,
    playerIds: { b: null, w: null },
    winnerId: null,
    rated: false,
    source: 'kif-import',
    createdAt: createdAt || Date.now(),
  });
  return { ok: true, record };
}

/**
 * 读取某棋谱的完整复盘数据（含书签/评论/变着）。
 */
function reviewData(id) {
  const r = getRecord(id);
  if (!r) return null;
  return {
    id: r.id,
    startSfen: r.startSfen,
    moves: r.moves || [],
    names: r.names || ['先手', '後手'],
    result: r.result,
    resultDetail: r.resultDetail,
    playerIds: r.playerIds || {},
    createdAt: r.createdAt,
    bookmarks: r.bookmarks || [],
    comments: r.comments || {},
    variations: r.variations || {},
  };
}

function toggleBookmark(id, moveNo, on) {
  if (!Number.isInteger(moveNo) || moveNo < 0) return { ok: false, error: '手数非法' };
  const r = getRecord(id);
  if (!r) return { ok: false, error: '棋谱不存在' };
  const bookmarks = new Set(r.bookmarks || []);
  if (on) bookmarks.add(moveNo);
  else bookmarks.delete(moveNo);
  r.bookmarks = Array.from(bookmarks).sort((a, b) => a - b);
  writeRecord(r);
  return { ok: true, bookmarks: r.bookmarks };
}

function setComment(id, moveNo, text) {
  if (!Number.isInteger(moveNo) || moveNo < 0) return { ok: false, error: '手数非法' };
  const r = getRecord(id);
  if (!r) return { ok: false, error: '棋谱不存在' };
  const comments = { ...(r.comments || {}) };
  const t = (text || '').trim();
  if (!t) delete comments[moveNo];
  else comments[moveNo] = t;
  r.comments = comments;
  writeRecord(r);
  return { ok: true, comments: r.comments };
}

function addVariation(id, parent, move) {
  const r = getRecord(id);
  if (!r) return { ok: false, error: '棋谱不存在' };
  const movesLen = (r.moves || []).length;
  if (!Number.isInteger(parent) || parent < 0 || parent >= movesLen) {
    return { ok: false, error: '父手数非法' };
  }
  if (!/^([1-9][a-i])([1-9][a-i])(\+?)$|^[PLNSGBR]\*[1-9][a-i]$/.test(move)) {
    return { ok: false, error: '变着走法非法' };
  }
  const variations = { ...(r.variations || {}) };
  if (!variations[parent]) variations[parent] = [];
  if (!variations[parent].some((v) => v.move === move)) {
    variations[parent].push({ move, parent });
  }
  r.variations = variations;
  writeRecord(r);
  return { ok: true, variations: r.variations };
}

function isOwner(rec, playerId) {
  return !!(rec && rec.playerIds && (rec.playerIds.b === playerId || rec.playerIds.w === playerId));
}

function writeRecord(record) {
  putRecord(record);
}

module.exports = {
  saveRecord,
  listRecords,
  getRecord,
  listPlayerRecords,
  searchRecords,
  exportKif,
  exportCsa,
  exportRecord,
  movesToKif,
  playbackData,
  importKif,
  reviewData,
  toggleBookmark,
  setComment,
  addVariation,
  isOwner,
};
