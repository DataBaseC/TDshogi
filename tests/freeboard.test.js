/**
 * FreeBoard 纯函数单元测试（PLAN §P1）
 *
 * 只测不依赖 DOM 的部分：坐标换算、初始盘面、USI 应用到模型（走子/吃子/升变/打子）。
 * 吃子用例直接覆盖 §J3 的回归场景：吃掉对方的「馬」，驹台必须多出「角」而不是「飛」。
 *
 * （2026-09-12）补 §J4 漂移回归：本地重放的盘面/持驹与 `src/game.js` 的权威结果**逐格比对**，
 * 让"前端模型悄悄跑偏"这类问题在单测阶段就暴露，而不是等用户吃子时才发现。
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

// 服务端规则引擎（§J4 漂移回归的权威基准）
const { newGame, STARTING_SFEN } = require('../src/game');

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

// ======================================================================
// §J4 漂移回归：本地重放 vs 服务端权威
//
// 背景：感想战的棋盘此前**完全由前端本地重放**得出（服务端只发 moves/kif），
// 一旦映射表或吃子逻辑写错（如 J3 的「馬→飛」），显示就是错的且**无从校验**——
// 只能靠用户肉眼发现。§J4 之后服务端会下发权威局面，但**历史手浏览仍依赖本地重放**，
// 所以这条"两边必须一致"的断言仍然是必要的护栏。
// ======================================================================

test('§J4 漂移回归：本地重放与服务端规则引擎的盘面/持驹完全一致', () => {
  // 覆盖：普通走子 → 吃子升变 → 反吃成駒（角取馬）→ 打子
  const moves = ['7g7f', '3c3d', '8h2b+', '3a2b', 'B*5e'];

  // ① 服务端权威：逐手校验合法并推进
  const g = newGame(STARTING_SFEN);
  for (const usi of moves) {
    const r = g.applyMove(usi);
    assert.strictEqual(r.ok, true, `服务端应接受 ${usi}（${(r && r.error) || '无原因'}）`);
  }
  const sv = g.state();

  // ② 前端本地重放：与感想战渲染走的是同一条路径
  const model = FB.initialModel();
  moves.forEach((usi, i) => FB.applyUsiOnModel(model, usi, i % 2 === 0 ? 'b' : 'w'));

  // ③ 盘面逐格比对（忽略 sq 字段的实现差异，只比棋种/颜色/成否）
  const norm = (x) => (x && x.piece ? { piece: x.piece, color: x.color, promoted: !!x.promoted } : null);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      assert.deepStrictEqual(norm(model.board[r][c]), norm(sv.board[r][c]),
        `盘面第 ${r + 1} 行第 ${c + 1} 列不一致（前端重放 vs 服务端）`);
    }
  }

  // ④ 持驹比对
  const hand = (h) => {
    const m = {};
    for (const x of (h || [])) m[x.piece] = x.count;
    return m;
  };
  assert.deepStrictEqual(hand(model.hands.b), hand(sv.hands.b), '先手持驹不一致');
  assert.deepStrictEqual(hand(model.hands.w), hand(sv.hands.w), '后手持驹不一致');

  // ⑤ 关键语义断言（J3 的镜像场景）：反吃「馬」必须得到「角」
  assert.strictEqual(hand(model.hands.w).角, 1, '后手吃马应得角');
  assert.strictEqual(hand(model.hands.w).飛, undefined, '不得凭空得到飞车');
  // 打子已生效：5e 是先手的角，且该角已从驹台扣除
  assert.strictEqual(at(model, '5e').piece, '角');
  assert.strictEqual(at(model, '5e').color, 'b');
  assert.strictEqual(hand(model.hands.b).角, undefined, '打子后驹台应已扣除该角');
});

// ======================================================================
// §U2 危险外框：FreeBoard 只负责"贴不贴 class"
// 「该不该红」由 play.js 判断——需求要求观战者不显示，而本组件
// 在观战与对局两种情形下长得一样，无从区分。
// ======================================================================

test('§U2 setDanger：给棋盘容器贴 / 摘 .fb-danger，且幂等', () => {
  const el = {
    _s: new Set(),
    classList: {
      toggle(c, on) { if (on) el._s.add(c); else el._s.delete(c); },
      has(c) { return el._s.has(c); },
    },
  };
  // 用原型造实例：本用例只碰 setDanger → _applyDanger，不必真的构造棋盘
  // （构造 FreeBoard 需要 ShogiBoard 实例与 DOM，成本高且与本用例无关）
  const fb = Object.create(FB.prototype);
  fb.board = { boardEl: el, render: () => {} };
  fb.danger = false;

  fb.setDanger(true);
  assert.ok(el._s.has('fb-danger'), '危险时应贴上 class');
  fb.setDanger(true);
  assert.ok(el._s.has('fb-danger'), '重复设为 true 应幂等');

  fb.setDanger(false);
  assert.ok(!el._s.has('fb-danger'), '解除危险应摘掉 class');
  fb.setDanger(false);
  assert.ok(!el._s.has('fb-danger'), '重复设为 false 应幂等');

  fb.setDanger(1);
  assert.strictEqual(fb.danger, true, '真值应归一化为布尔（避免 truthy 值外泄）');

  // 容器缺失时不得抛错：棋钟每 500ms 就会调一次，抛错会刷屏
  fb.board = null;
  assert.doesNotThrow(() => fb.setDanger(true));
});
