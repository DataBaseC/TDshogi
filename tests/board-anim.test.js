'use strict';
/**
 * board-anim.test.js — 走子动效（2026-10-11）
 *
 * 三块：
 *  ① board.diffBoard() 的纯函数行为——它是「这一手是什么」的唯一判定处，
 *     动效的正确性完全取决于它（识别错 → 棋子乱跳/原地重播）。
 *  ② CSS 契约：棋子阴影 + 落子/打子/升变/吃子关键帧与类必须在 board.css 里。
 *  ③ BGM 试听音量：必须取用户设置（Sound.bgmVolumeValue），不能写死。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { makeSandbox, loadPage, PAGES, PUBLIC } = require('./helpers/page');

function loadApp() {
  const sandbox = makeSandbox();
  const html = Object.keys(PAGES)[0]; // SPA 单文档
  const results = loadPage(sandbox, html);
  for (const r of results) {
    assert.ok(r.ok, `加载 js/${r.file} 抛错：${r.error && r.error.message}`);
  }
  return sandbox;
}

/** 空棋盘（与服务端同口径：board[r][c]，r=0 是 1 段） */
function emptyBoard() {
  return Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => ({
    piece: null, color: null, promoted: false, sq: `${c + 1}${String.fromCharCode(97 + r)}`,
  })));
}
/** 造一枚棋子（r 行 c 列） */
function put(board, r, c, piece, color, promoted) {
  board[r][c] = { piece, color, promoted: !!promoted, sq: `${c + 1}${String.fromCharCode(97 + r)}` };
  return board;
}

test('diffBoard：首次渲染（无上一帧）不判定任何走子', () => {
  const sandbox = loadApp();
  assert.strictEqual(sandbox.diffBoard(null, emptyBoard()), null);
});

test('diffBoard：普通移动 → 落点 + 出发格，非打子、非升变', () => {
  const sandbox = loadApp();
  const prev = put(emptyBoard(), 6, 6, '歩', 'b', false);   // 7g
  const cur = put(emptyBoard(), 5, 6, '歩', 'b', false);    // 7f
  const d = sandbox.diffBoard(prev, cur);
  assert.ok(d, '应识别出这一手');
  assert.deepStrictEqual([d.to.r, d.to.c], [5, 6]);
  assert.deepStrictEqual([d.from.r, d.from.c], [6, 6]);
  assert.strictEqual(d.isDrop, false);
  assert.strictEqual(d.captured, false);
  assert.strictEqual(d.promoted, false);
});

test('diffBoard：打子（持驹落盘）→ isDrop，没有出发格', () => {
  const sandbox = loadApp();
  const prev = emptyBoard();
  const cur = put(emptyBoard(), 4, 4, '歩', 'b', false);
  const d = sandbox.diffBoard(prev, cur);
  assert.ok(d);
  assert.strictEqual(d.isDrop, true);
  assert.strictEqual(d.from, null);
  assert.strictEqual(d.captured, false);
});

test('diffBoard：吃子 → captured，出发格仍能认出', () => {
  const sandbox = loadApp();
  const prev = put(put(emptyBoard(), 3, 7, '歩', 'b', false), 4, 7, '歩', 'w', false); // 8d 先手歩 / 8e 后手歩
  const cur = put(emptyBoard(), 4, 7, '歩', 'b', false);                                // 8e 被先手吃掉
  const d = sandbox.diffBoard(prev, cur);
  assert.ok(d);
  assert.deepStrictEqual([d.to.r, d.to.c], [4, 7]);
  assert.deepStrictEqual([d.from.r, d.from.c], [3, 7]);
  assert.strictEqual(d.captured, true, '被吃的敌子要让落点放红环');
  assert.strictEqual(d.isDrop, false);
});

test('diffBoard：升变 → promoted（出发未成駒、落点已成駒）', () => {
  const sandbox = loadApp();
  const prev = put(emptyBoard(), 2, 2, '歩', 'b', false);    // 3c：歩
  const cur = put(emptyBoard(), 1, 2, 'と', 'b', true);      // 3b：と
  const d = sandbox.diffBoard(prev, cur);
  assert.ok(d);
  assert.strictEqual(d.promoted, true, '同一枚子从 歩 变 と 应判为升变');
  assert.strictEqual(d.to.piece.promoted, true);
});

test('diffBoard：未升变的移动不会被误判成升变', () => {
  const sandbox = loadApp();
  const prev = put(emptyBoard(), 4, 4, '銀', 'b', false);
  const cur = put(emptyBoard(), 3, 4, '銀', 'b', false);
  assert.strictEqual(sandbox.diffBoard(prev, cur).promoted, false);
});

test('diffBoard：一次变多枚（装载新盘面 / 悔棋 / 重置）→ 不播动画', () => {
  const sandbox = loadApp();
  const prev = put(emptyBoard(), 6, 6, '歩', 'b', false);
  const cur = put(put(emptyBoard(), 4, 4, '角', 'b', false), 5, 6, '歩', 'b', false);
  assert.strictEqual(sandbox.diffBoard(prev, cur), null, '多于一枚新棋子时应放弃（宁可不播也不播错）');
});

test('diffBoard：同一格换人（被吃后对方落子）也认得出', () => {
  const sandbox = loadApp();
  const prev = put(emptyBoard(), 4, 4, '歩', 'w', false);
  const cur = put(emptyBoard(), 4, 4, '銀', 'b', false);
  const d = sandbox.diffBoard(prev, cur);
  assert.ok(d);
  assert.deepStrictEqual([d.to.r, d.to.c], [4, 4]);
  assert.strictEqual(d.captured, true, '这格原有敌子，应视为吃子');
});

test('board.css：棋子阴影 + 四类走子动画的关键帧与类齐备', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'css', 'board.css'), 'utf8');
  assert.ok(/\.piece-img\s*\{[^}]*drop-shadow/.test(css), '棋子应有轮廓阴影（drop-shadow，非方框 box-shadow）');
  for (const kf of ['piece-place', 'piece-drop', 'piece-flip', 'cell-land', 'cell-capture', 'cell-vacate']) {
    assert.ok(new RegExp(`@keyframes\\s+${kf}\\b`).test(css), `缺少关键帧 ${kf}`);
  }
  for (const cls of ['anim-enter', 'anim-drop', 'anim-promote', 'anim-capture', 'anim-vacate']) {
    assert.ok(new RegExp(`\\.cell\\.${cls}\\b`).test(css), `缺少动画类 .cell.${cls}`);
  }
  // 动画必须挂在包裹层上：直接动画 .piece-img 会把后手棋子的 180° 朝向旋掉
  assert.ok(/\.cell\.anim-enter\s*>\s*\.piece-anim/.test(css), '落子动画应作用在 .piece-anim 包裹层');
  assert.ok(/\.cell\.anim-promote\s*>\s*\.piece-anim/.test(css), '升变翻转应作用在 .piece-anim 包裹层');
});

test('board.js：渲染后做一次 diff 并打动画类；同一局面的重绘不得抹掉动画', () => {
  const src = fs.readFileSync(path.join(PUBLIC, 'js', 'board.js'), 'utf8');
  assert.ok(/this\._prevBoard = snapshotBoard\(board\)/.test(src),
    'render 应保存**快照**（存引用会让"原地修改同一数组"的自由摆放 diff 恒空）');
  assert.ok(/this\.animateMove\(prevBoard, board, viewpoint\)/.test(src), 'render 末尾应触发走子动效');
  assert.ok(/animateMoves'\) === false/.test(src), '应支持「走子动画」开关');
  assert.ok(/if \(boardEquals\(prevBoard, curBoard\)\) return;/.test(src),
    '同一局面的重复渲染应直接返回（既不清也不挂，动画才不会被后续重绘抹掉）');
  assert.ok(/clearAnimClasses\(\)/.test(src), '新的一手到来时应清掉上一帧的动画标记');
  // 关键回归：无脑 innerHTML='' 的整盘重绘会把刚挂上的动画抹掉（对局页因此看不到动画）
  const removeArgs = /cell\.classList\.remove\(([^)]*)\)/.exec(src);
  assert.ok(removeArgs, 'render 里应有 class 清理');
  assert.ok(!/anim-/.test(removeArgs[1]), '逐格类清理不得包含 anim-*（动画类由 animateMove 管理）');
  assert.ok(/global\.diffBoard = diffBoard/.test(src), 'diffBoard 应导出（测试与复用）');
});

// ---------------------------------------------------------------------------
// 行为级回归：走子动效的"渲染时序"
// 报告指出的测试盲区——只测 diffBoard 纯函数与 CSS 契约，测不到「同一帧内多次
// render 叠加后动画还在不在」。这里用一个极简 DOM 把 ShogiBoard 真跑起来。
// ---------------------------------------------------------------------------
function miniDoc() {
  function mk(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      children: [], parentNode: null,
      style: {}, dataset: {}, attributes: {},
      _cls: new Set(), _html: '',
      get className() { return [...el._cls].join(' '); },
      set className(v) { el._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
      classList: {
        add: (...c) => c.forEach((x) => el._cls.add(x)),
        remove: (...c) => c.forEach((x) => el._cls.delete(x)),
        toggle: (c, on) => { const v = on === undefined ? !el._cls.has(c) : on; if (v) el._cls.add(c); else el._cls.delete(c); },
        contains: (c) => el._cls.has(c),
      },
      setAttribute(k, v) { el.attributes[k] = String(v); },
      getAttribute(k) { return el.attributes[k] === undefined ? null : el.attributes[k]; },
      addEventListener() {}, removeEventListener() {},
      appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = el; el.children.push(c); return c; },
      removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; return c; },
      querySelector(sel) { return find(el, sel, 0); },
      querySelectorAll() { return []; },
      get innerHTML() { return el._html; },
      set innerHTML(v) {
        el._html = String(v == null ? '' : v);
        el.children.forEach((c) => { c.parentNode = null; });
        el.children = [];
        // 极简：从 class="a b" 造出子元素（够 .piece-img / .piece-anim 用）
        const re = /class="([^"]+)"/g;
        let m;
        while ((m = re.exec(el._html))) {
          const child = mk('div');
          child.className = m[1];
          el.appendChild(child);
        }
      },
    };
    return el;
  }
  function find(root, sel, depth) {
    if (depth > 5) return null;
    for (const c of root.children) {
      if (c.classList.contains(sel.slice(1))) return c;
      const r = find(c, sel, depth + 1);
      if (r) return r;
    }
    return null;
  }
  return { createElement: mk };
}

/** 用极简 DOM 起一块棋盘（先手视角，方便直接按服务端坐标推算显示格） */
function makeBoard(sandbox) {
  sandbox.document = miniDoc();
  sandbox.innerWidth = 640;
  const container = sandbox.document.createElement('div');
  const board = new sandbox.ShogiBoard(container, {});
  return board;
}

test('行为级：一帧内 4 次 render 叠加（setModel→setCheck→setInteractive→render）后动画仍在', () => {
  const sandbox = loadApp();
  const board = makeBoard(sandbox);
  const b1 = put(emptyBoard(), 6, 6, '歩', 'b', false);   // 7g
  const b2 = put(emptyBoard(), 5, 6, '歩', 'b', false);   // 7f

  board.render({ board: b1 }, {}, 'b');
  board.render({ board: b2 }, {}, 'b');                   // 走子帧：第 1 次 render
  const to = board._findCell('7f');
  assert.ok(to && to.classList.contains('anim-enter'), '第 1 次 render 应挂上落子动画类');
  const firstChild = to.children[0];
  assert.ok(firstChild && firstChild.classList.contains('piece-anim'), '落点应被包进 .piece-anim');

  // 同一帧内 FreeBoard 的 setter 各自又会 render 数次（setCheck / setInteractive / 显式 render）
  board.render({ board: b2 }, {}, 'b');
  board.render({ board: b2 }, {}, 'b');
  board.render({ board: b2 }, {}, 'b');
  assert.ok(to.classList.contains('anim-enter'), '同一局面的后续重绘不得抹掉动画类（FN-03）');
  assert.strictEqual(to.children[0], firstChild,
    '内容没变的格子不应被重建（否则动画元素被换掉，动画从头/丢失）');
});

test('行为级：新的一手到来时，上一帧的动画标记被清掉', () => {
  const sandbox = loadApp();
  const board = makeBoard(sandbox);
  const b1 = put(emptyBoard(), 6, 6, '歩', 'b', false);   // 7g
  const b2 = put(emptyBoard(), 5, 6, '歩', 'b', false);   // 7f
  const b3 = put(put(emptyBoard(), 4, 6, '歩', 'b', false), 5, 6, '歩', 'b', false); // 7e（再进）
  board.render({ board: b1 }, {}, 'b');
  board.render({ board: b2 }, {}, 'b');
  const first = board._findCell('7f');
  assert.ok(first.classList.contains('anim-enter'));
  board.render({ board: b3 }, {}, 'b');
  assert.ok(!first.classList.contains('anim-enter'), '上一手的动画标记应被清除');
  assert.ok(board._findCell('7e').classList.contains('anim-enter'), '这一手的落点应挂上动画');
});

test('行为级：升变会额外打上 anim-promote', () => {
  const sandbox = loadApp();
  const board = makeBoard(sandbox);
  const b1 = put(emptyBoard(), 2, 2, '歩', 'b', false);   // 3c
  const b2 = put(emptyBoard(), 1, 2, 'と', 'b', true);    // 3b：升变
  board.render({ board: b1 }, {}, 'b');
  board.render({ board: b2 }, {}, 'b');
  const cell = board._findCell('3b');
  assert.ok(cell.classList.contains('anim-promote'), '升变格应有翻面动画类');
  assert.ok(cell.classList.contains('anim-enter'), '升变也应有落子动画');
});

test('行为级：原地修改同一 board 引用（自由摆放）也要能识别出走子（FN-24）', () => {
  const sandbox = loadApp();
  const board = makeBoard(sandbox);
  const shared = put(emptyBoard(), 6, 6, '銀', 'b', false);   // 7g 銀
  board.render({ board: shared }, {}, 'b');
  // freeboard 的 _move 是"原地改同一个数组"：同一个引用，内容变了（并写入新 sq）
  shared[5][6] = { piece: '銀', color: 'b', promoted: false, sq: '7f' };
  shared[6][6] = null;
  board.render({ board: shared }, {}, 'b');
  const cell = board._findCell('7f');
  assert.ok(cell && cell.classList.contains('anim-enter'),
    '同一数组原地修改后重绘，仍应识别出走子（prev 必须存快照而非引用）');
});

test('行为级：转屏/缩放后格子尺寸跟随重算（FN-04）', () => {
  const sandbox = loadApp();
  const board = makeBoard(sandbox);
  board.render({ board: emptyBoard() }, {}, 'b');
  const cell = board.cells[0][0];
  const w1 = cell.style.width;
  assert.ok(/px$/.test(w1), '格子应有像素尺寸');
  sandbox.innerWidth = 400;     // 模拟窄屏/转屏
  board.render({ board: emptyBoard() }, {}, 'b');
  assert.notStrictEqual(cell.style.width, w1, '视口变化后格子尺寸应重算（此前只在 build() 算一次）');
});

test('行为级：切观战视角会重画棋子朝向（增量渲染的签名必须含 viewpoint）', () => {
  const sandbox = loadApp();
  const board = makeBoard(sandbox);
  const b = put(emptyBoard(), 8, 0, '玉', 'b', false);   // 1i（先手玉）
  board.render({ board: b }, {}, 'b');
  const cell = board._findCell('1i');
  const viewB = cell.innerHTML;
  board.render({ board: b }, {}, 'w');
  assert.notStrictEqual(cell.innerHTML, viewB, '切视角后同一格的棋子朝向应被重画');
});

test('BGM 试听音量跟随用户设置（不再写死 0.7）', () => {
  const sound = fs.readFileSync(path.join(PUBLIC, 'js', 'sound.js'), 'utf8');
  assert.ok(/function bgmVolumeValue\(\)/.test(sound), 'sound.js 应暴露当前 BGM 音量');
  assert.ok(/\n\s*bgmVolumeValue,/.test(sound), 'bgmVolumeValue 应在导出表里');

  const profile = fs.readFileSync(path.join(PUBLIC, 'js', 'profile.js'), 'utf8');
  assert.ok(/a\.volume = \(window\.Sound && window\.Sound\.bgmVolumeValue\)/.test(profile),
    '试听音量应取 Sound.bgmVolumeValue()');
  assert.ok(!/a\.volume = 0\.7;/.test(profile), '不应再有写死的 0.7 音量');
});

test('Sound.bgmVolumeValue() 的取值 = 0.7 × 用户百分比（默认 50% → 0.35）', () => {
  const sandbox = loadApp();
  assert.strictEqual(typeof sandbox.Sound.bgmVolumeValue, 'function');
  assert.ok(Math.abs(sandbox.Sound.bgmVolumeValue() - 0.35) < 1e-9,
    '默认设置（50%）下试听音量应为 0.35，与正式 BGM 完全一致');
});
