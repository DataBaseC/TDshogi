/**
 * FreeBoard 纯函数单元测试（PLAN §P1）
 *
 * 只测不依赖 DOM 的部分：坐标换算、初始盘面、USI 应用到模型（走子/吃子/升变/打子）。
 * 吃子用例直接覆盖 §J3 的回归场景：吃掉对方的「馬」，驹台必须多出「角」而不是「飛」。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// 浏览器环境最小替身：freeboard.js 的 IIFE 会挂 global.FreeBoard；render 时才需要真实 DOM
globalThis.window = globalThis.window || {};
globalThis.window.renderHands = () => {};
require(path.join(__dirname, '../public/js/piece-kinds.js'));
require(path.join(__dirname, '../public/js/freeboard.js'));
const FB = globalThis.window.FreeBoard;

/** 取某格的棋子对象 */
const at = (model, sq) => {
  const [r, c] = FB.sqToRC(sq);
  return model.board[r][c];
};
/** 驹台里某棋种的数量 */
const handCount = (model, color, piece) => {
  const h = (model.hands[color] || []).find((x) => x.piece === piece);
  return h ? h.count : 0;
};

test('导出了可测试的常量与纯函数', () => {
  assert.ok(typeof FB.applyUsiOnModel === 'function');
  assert.ok(typeof FB.initialModel === 'function');
  assert.ok(typeof FB.sqToRC === 'function');
  assert.deepStrictEqual(FB.MODES, ['play', 'demo-rules', 'free', 'review']);
});

test('坐标换算：USI 格 ↔ 模型行列', () => {
  assert.deepStrictEqual(FB.sqToRC('1a'), [0, 0]);
  assert.deepStrictEqual(FB.sqToRC('9i'), [8, 8]);
  assert.deepStrictEqual(FB.sqToRC('7g'), [6, 6]);
  assert.deepStrictEqual(FB.sqToRC('5e'), [4, 4]);
});

test('初始盘面：9x9 且双方各 20 枚', () => {
  const m = FB.initialModel();
  assert.strictEqual(m.board.length, 9);
  assert.strictEqual(m.board[0].length, 9);
  let b = 0; let w = 0;
  for (const row of m.board) {
    for (const cell of row) {
      if (!cell || !cell.piece) continue;
      if (cell.color === 'b') b += 1;
      else w += 1;
    }
  }
  assert.strictEqual(b, 20);
  assert.strictEqual(w, 20);
  // 服务端约定：board[8] 是先手（黑）底线、board[0] 是后手（白）底线
  assert.strictEqual(m.board[8][4].piece, '玉');
  assert.strictEqual(m.board[8][4].color, 'b');
  assert.strictEqual(m.board[0][4].piece, '玉');
  assert.strictEqual(m.board[0][4].color, 'w');
});

test('应用走子：棋子从 from 移到 to', () => {
  const m = FB.initialModel();
  const moved = at(m, '7g');               // 先手 7七歩
  assert.strictEqual(moved.piece, '歩');
  FB.applyUsiOnModel(m, '7g7f', 'b');
  assert.strictEqual(at(m, '7g'), null);
  assert.strictEqual(at(m, '7f').piece, '歩');
  assert.strictEqual(at(m, '7f').color, 'b');
});

test('应用升变：落子棋种变为成駒', () => {
  const m = FB.initialModel();
  FB.applyUsiOnModel(m, '7g7f', 'b');
  FB.applyUsiOnModel(m, '3c3d', 'w');
  // 直接构造一次带升变标记的走法（模型不校验规则，只做结构变换）
  FB.applyUsiOnModel(m, '7f7e+', 'b');
  assert.strictEqual(at(m, '7e').piece, 'と');
  assert.strictEqual(at(m, '7e').promoted, true);
});

test('吃子：被吃的成駒按原始棋种进吃方驹台（J3 回归）', () => {
  const m = FB.initialModel();
  const [rw, cw] = FB.sqToRC('5e');
  const [rb, cb] = FB.sqToRC('5f');
  m.board[rw][cw] = { piece: '馬', color: 'w', promoted: true, sq: '5e' }; // 後手的馬（角成）
  m.board[rb][cb] = { piece: '歩', color: 'b', promoted: false, sq: '5f' }; // 先手的歩
  FB.applyUsiOnModel(m, '5f5e', 'b');
  assert.strictEqual(handCount(m, 'b', '角'), 1, '吃掉馬应得到角');
  assert.strictEqual(handCount(m, 'b', '飛'), 0, '不应得到飞车');
  assert.strictEqual(at(m, '5e').piece, '歩');
});

test('吃子：吃龍应得到飛', () => {
  const m = FB.initialModel();
  const [rw, cw] = FB.sqToRC('5e');
  const [rb, cb] = FB.sqToRC('5f');
  m.board[rw][cw] = { piece: '龍', color: 'w', promoted: true, sq: '5e' };
  m.board[rb][cb] = { piece: '歩', color: 'b', promoted: false, sq: '5f' };
  FB.applyUsiOnModel(m, '5f5e', 'b');
  assert.strictEqual(handCount(m, 'b', '飛'), 1);
  assert.strictEqual(handCount(m, 'b', '角'), 0);
});

test('吃子：吃未成角行应得到角（非成駒路径）', () => {
  const m = FB.initialModel();
  const [rw, cw] = FB.sqToRC('5e');
  const [rb, cb] = FB.sqToRC('5f');
  m.board[rw][cw] = { piece: '角', color: 'w', promoted: false, sq: '5e' };
  m.board[rb][cb] = { piece: '歩', color: 'b', promoted: false, sq: '5f' };
  FB.applyUsiOnModel(m, '5f5e', 'b');
  assert.strictEqual(handCount(m, 'b', '角'), 1);
});

test('打子：驹台减一并落子（驹台归零则移除该行）', () => {
  const m = FB.initialModel();
  m.hands.b = [{ piece: '歩', count: 2 }];
  FB.applyUsiOnModel(m, 'P*5e', 'b');
  assert.strictEqual(handCount(m, 'b', '歩'), 1);
  assert.strictEqual(at(m, '5e').piece, '歩');
  assert.strictEqual(at(m, '5e').color, 'b');
  assert.strictEqual(at(m, '5e').promoted, false);
  FB.applyUsiOnModel(m, 'P*4e', 'b');
  assert.strictEqual(handCount(m, 'b', '歩'), 0);
  assert.strictEqual((m.hands.b || []).length, 0, '数量为 0 应从驹台移除');
});

test('打子：驹台无该棋子时只落子不报错', () => {
  const m = FB.initialModel();
  m.hands.b = [];
  FB.applyUsiOnModel(m, 'P*5e', 'b');
  assert.strictEqual(at(m, '5e').piece, '歩');
});

test('§R1 视角切换：翻转 viewpoint 并交换驹台配色（不换 DOM）', () => {
  // model 为 null 时 setViewpoint 不会触发 render，故不需要真实 DOM
  const my = { dataset: {} };
  const opp = { dataset: {} };
  const fb = new FB({
    board: null,
    viewpoint: 'b',
    hands: { my, myColor: 'b', opp, oppColor: 'w' },
  });
  assert.strictEqual(fb.viewpoint, 'b');

  fb.setViewpoint('w');
  assert.strictEqual(fb.viewpoint, 'w');
  // 下方驹台改呈现后手持驹（配色交换，元素本身不动）
  assert.strictEqual(fb.handsEls.my, my, 'DOM 元素不应被交换');
  assert.strictEqual(fb.handsEls.opp, opp, 'DOM 元素不应被交换');
  assert.strictEqual(fb.handsEls.myColor, 'w');
  assert.strictEqual(fb.handsEls.oppColor, 'b');
  assert.strictEqual(my.dataset.fbColor, 'w');
  assert.strictEqual(opp.dataset.fbColor, 'b');

  // 切回先手视角要能完全还原
  fb.setViewpoint('b');
  assert.strictEqual(fb.viewpoint, 'b');
  assert.strictEqual(fb.handsEls.myColor, 'b');
  assert.strictEqual(fb.handsEls.oppColor, 'w');

  // 同视角重复设置应空转（幂等），非法值忽略
  fb.setViewpoint('b');
  assert.strictEqual(fb.handsEls.myColor, 'b');
  fb.setViewpoint('x');
  assert.strictEqual(fb.viewpoint, 'b');
  fb.setViewpoint(null);
  assert.strictEqual(fb.viewpoint, 'b');
});

test('§R1 视角切换：清除选中状态，避免残留另一视角的选中', () => {
  const fb = new FB({
    board: null,
    viewpoint: 'b',
    hands: { my: { dataset: {} }, myColor: 'b', opp: { dataset: {} }, oppColor: 'w' },
  });
  fb.selectedSq = '7g';
  fb.selectedHand = { color: 'b', piece: '歩', sym: 'P' };
  fb.setViewpoint('w');
  assert.strictEqual(fb.selectedSq, null);
  assert.strictEqual(fb.selectedHand, null);
});
