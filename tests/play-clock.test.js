'use strict';
/**
 * play-clock.test.js — 棋钟（`public/js/play-clock.js`）
 *
 * `play-clock.js` 是浏览器 IIFE（挂在 `window.PlayClock`），这里用最小的 DOM / window
 * 替身把它跑起来。重点保护两类东西：
 *   ① 时间格式化、读秒切换、扣减边界——算错用户立刻能感知；
 *   ② **棋钟随视角换边**——§R1 观战视角切换时曾出现"棋盘翻了、棋钟没翻"的不一致，
 *      这里把换边固化成回归测试。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// ---------------- 最小浏览器替身（必须在 require 之前就位） ----------------
const els = {};
function makeEl(id) {
  return {
    id,
    textContent: '',
    classList: {
      _s: new Set(),
      toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); },
      has(c) { return this._s.has(c); },
    },
  };
}
global.document = { getElementById: (id) => (els[id] || (els[id] = makeEl(id))) };
// play-clock.js 的 $ 是转发到 window.UI.$（实现统一在 util.js）——测试里给个最小替身
global.UI = { $: (id) => global.document.getElementById(id), esc: (s) => s, toast: () => {} };

const sounds = [];
// §U1：三种音**分别计数**——只数总数的话，"该响的响、不该响的不响"这类断言会被掩盖
// （比如整分钟音误响、逐秒音漏响，总数仍可能对上）。
const marks = { byoyomi: 0, byoyomiMark: 0, minute: 0 };
global.window = global;               // play-clock.js 里用 window.Sound / window.PlayClock
global.Sound = {
  playByoyomi: () => { sounds.push(1); marks.byoyomi++; },
  playByoyomiMark: () => { marks.byoyomiMark++; },
  playMinuteWarning: () => { marks.minute++; },
};

require(path.resolve(__dirname, '..', 'public', 'js', 'play-clock.js'));
const Clock = global.PlayClock;

/**
 * 把棋钟置于已知状态。
 * @param {{vp?:'b'|'w', status?:string, turn?:string, b?:number, w?:number,
 *          inByoyomi?:object, byoyomi?:number, curByoyomi?:object}} o
 */
function setup(o) {
  const opt = o || {};
  Clock.stop(); // init 会启动真定时器，测试里不需要
  const st = {
    status: opt.status || 'PLAYING',
    turn: opt.turn || 'b',
    clock: { b: opt.b != null ? opt.b : 600000, w: opt.w != null ? opt.w : 300000 },
    // 传 inByoyomi 才会重置读秒相关状态（与原 syncFromState 的语义一致）
    inByoyomi: opt.inByoyomi || { b: false, w: false },
    byoyomi: opt.byoyomi || 0,
    curByoyomi: opt.curByoyomi || { b: 0, w: 0 },
  };
  Clock.init({
    getState: () => st,
    getViewpoint: () => opt.vp || 'b',
  });
  Clock.stop();
  Clock.syncFromState(st);
  return st;
}

const bottom = () => els.bottomClock.textContent;
const top = () => els.topClock.textContent;

test('视角：先手视角下，下方棋钟显示先手时间；后手视角上下互换', () => {
  setup({ vp: 'b' });
  assert.strictEqual(bottom(), '10:00', '先手视角：下方（自己）= 先手');
  assert.strictEqual(top(), '5:00', '上方 = 后手');

  setup({ vp: 'w' }); // 切到后手视角
  assert.strictEqual(bottom(), '5:00', '后手视角：下方（自己）= 后手');
  assert.strictEqual(top(), '10:00', '上方 = 先手');
});

test('格式化：本时显示 m:ss，零填充', () => {
  setup({ vp: 'b', b: 61000, w: 9000 });
  assert.strictEqual(bottom(), '1:01');
  assert.strictEqual(top(), '0:09');
});

test('advance：只扣当前手番，对手不受影响', () => {
  setup({ vp: 'b', turn: 'b' });
  Clock.advance(10000);
  Clock.update();
  assert.strictEqual(bottom(), '9:50', '当前手番先手被扣 10 秒');
  assert.strictEqual(top(), '5:00', '后手不动');
});

test('advance：扣到 0 即止，不出现负数', () => {
  setup({ vp: 'b', b: 3000 });
  Clock.advance(10000);
  Clock.update();
  assert.strictEqual(bottom(), '0:00');
});

test('advance：非 PLAYING（未开局 / 已终局）不扣时间', () => {
  setup({ vp: 'b', status: 'FINISHED' });
  Clock.advance(5000);
  Clock.update();
  assert.strictEqual(bottom(), '10:00', '终局后本地钟不应继续走');
});

test('读秒：进入读秒后只显示剩余秒数（不带冒号）', () => {
  setup({
    vp: 'b',
    inByoyomi: { b: true, w: false },
    byoyomi: 60,
    curByoyomi: { b: 30000, w: 0 },
  });
  assert.strictEqual(bottom(), '30', '先手在读秒 → 显示 30 秒');
  assert.strictEqual(top(), '5:00', '后手未读秒 → 仍显示本时');
});

test('读秒音效：剩余 ≤10 秒时每跨 1 秒响一次，同一秒内不重复', () => {
  sounds.length = 0;
  setup({
    vp: 'b',
    turn: 'b',
    inByoyomi: { b: true, w: false },
    byoyomi: 60,
    curByoyomi: { b: 10000, w: 0 },
  });

  Clock.advance(1000); // 10000 → 9000，sec=9 → 响
  assert.strictEqual(sounds.length, 1, '秒数变化应响一次');
  Clock.advance(100);  // 仍在第 9 秒
  assert.strictEqual(sounds.length, 1, '同一秒内不重复响');
  Clock.advance(900);  // 9000 → 8000，sec=8 → 响
  assert.strictEqual(sounds.length, 2);
});

test('读秒音效：剩余 >10 秒不响', () => {
  sounds.length = 0;
  setup({
    vp: 'b',
    turn: 'b',
    inByoyomi: { b: true, w: false },
    byoyomi: 60,
    curByoyomi: { b: 30000, w: 0 },
  });
  Clock.advance(5000); // 30000 → 25000，sec=25
  assert.strictEqual(sounds.length, 0);
});

test('syncFromServer：以服务端时间为准校准（clock 消息）', () => {
  setup({ vp: 'b' });
  Clock.syncFromServer({
    b: 123000,
    w: 54000,
    byoyomi: 0,
    inByoyomi: { b: false, w: false },
    curByoyomi: { b: 0, w: 0 },
  });
  assert.strictEqual(bottom(), '2:03');
  assert.strictEqual(top(), '0:54');
});

test('syncFromServer：空数据不报错也不改动', () => {
  setup({ vp: 'b', b: 600000, w: 300000 });
  Clock.syncFromServer(null);
  Clock.syncFromServer(undefined);
  assert.strictEqual(bottom(), '10:00');
});

test('回合高亮：轮到谁，谁那一侧的棋钟打 low 标（仅在 ≤10 秒时）', () => {
  setup({ vp: 'b', turn: 'b', b: 8000, w: 600000 }); // 先手 8 秒且轮到先手
  assert.ok(els.bottomClock.classList.has('low'), '轮到先手且 ≤10 秒 → 下方高亮');
  assert.ok(!els.topClock.classList.has('low'), '后手时间充裕 → 不高亮');

  setup({ vp: 'b', turn: 'w', b: 8000, w: 600000 }); // 虽然先手快没了，但没轮到先手
  assert.ok(!els.bottomClock.classList.has('low'), '没轮到自己 → 不高亮');
});

test('syncFromState：服务端下发 clock 字段时覆盖本地值', () => {
  setup({ vp: 'b', b: 600000, w: 300000 });
  Clock.syncFromState({
    status: 'PLAYING',
    turn: 'b',
    clock: { b: 1000, w: 2000 },
  });
  assert.strictEqual(bottom(), '0:01');
  assert.strictEqual(top(), '0:02');
});

// ======================================================================
// §U1 时间提醒（两种新音：本时整分钟 / 读秒每 10 秒）
//
// 音效类问题在实机上极难复现——没人会盯着秒表数"刚才到底响了几声"。
// 所以这批断言是这条需求**唯一可靠**的护栏。
// ======================================================================

test('§U1 本时：每跨过一个整分钟提醒 1 次，进对局不补响历史分钟', () => {
  marks.minute = 0;
  setup({ vp: 'b', turn: 'b', b: 3 * 60 * 1000 }); // 3:00 → mm=3
  assert.strictEqual(marks.minute, 0, '刚进入（syncFromState）不得补响');

  Clock.advance(30 * 1000); // 2:30，mm 仍为 3
  assert.strictEqual(marks.minute, 0, '同一分钟内不重复响');

  Clock.advance(30 * 1000); // 2:00，mm 3→2
  assert.strictEqual(marks.minute, 1, '跨过整分钟应响 1 次');

  Clock.advance(60 * 1000); // 1:00，mm 2→1
  assert.strictEqual(marks.minute, 2);

  Clock.advance(60 * 1000); // 0:00，mm 1→0
  assert.strictEqual(marks.minute, 3, '跨到 0:00 也要响（若条件写 mm>=1 会吞掉这条）');

  Clock.advance(5000); // 已归零
  assert.strictEqual(marks.minute, 3, '归零后不重复响');
});

test('§U1 读秒：每跨过 10 秒报时一次，10 秒以内交给逐秒音', () => {
  marks.byoyomiMark = 0;
  marks.byoyomi = 0;
  setup({
    vp: 'b', turn: 'b',
    inByoyomi: { b: true, w: false }, byoyomi: 60,
    curByoyomi: { b: 60000, w: 0 },
  });

  Clock.advance(1000); // 60 → 59 秒：仍是第 6 档
  assert.strictEqual(marks.byoyomiMark, 0, '同一档内不重复报');

  Clock.advance(9000); // → 50 秒，档位 6→5
  assert.strictEqual(marks.byoyomiMark, 1, '跨过 10 秒应报 1 次');

  Clock.advance(10000); // → 40 秒
  assert.strictEqual(marks.byoyomiMark, 2);

  Clock.advance(30000); // → 10 秒，档位到 1
  assert.strictEqual(marks.byoyomiMark, 2, '10 秒档不报时，避免与逐秒「嗒」重叠');

  Clock.advance(1000); // 10 → 9 秒
  assert.ok(marks.byoyomi >= 1, '10 秒以内由逐秒「嗒」接管');
});

test('§U1 提醒边界：服务端校准后以新值为基准，不因时间跳变连响', () => {
  marks.minute = 0;
  setup({ vp: 'b', turn: 'b', b: 2 * 60 * 1000 }); // 2:00

  // ⚠️ 两个最容易写错的点，都在这里固化成断言：
  //  ① mm = ceil(剩余/60000)，跨界点是**整分钟那一刻**（2:00 扣到 1:59 仍是 mm=2）；
  //  ② 重置基准后的**第一拍只记录、不发声**——否则进对局/重连瞬间会补响一串。
  Clock.advance(1000); // 1:59：首拍，只记录 mm=2
  assert.strictEqual(marks.minute, 0, '首拍只记录，不补响');

  Clock.advance(60 * 1000); // 0:59，mm 2→1
  assert.strictEqual(marks.minute, 1, '跨过整分钟应响 1 次');

  // 模拟重连：服务端说只剩 30 秒（本地以为还有 1:59）→ 时间"跳"了
  Clock.syncFromServer({ b: 30000, w: 300000 });
  assert.strictEqual(marks.minute, 1, '校准动作本身不应发声');

  Clock.advance(1000); // 0:29，但换基准后的第一拍只记录
  assert.strictEqual(marks.minute, 1, '校准后第一拍只记录基准，不补响');

  Clock.advance(29 * 1000); // 0:00，mm 1→0
  assert.strictEqual(marks.minute, 2, '之后的正常跨界仍要响');
});

// ======================================================================
// §U2 危险外框：棋钟只回答「当前手番方是否读秒 ≤10 秒」
// 「是不是自己 / 是不是观战者」由 play.js 判断（需求明确要求观战者不显示）
// ======================================================================

test('§U2 isDanger：仅当当前手番方读秒 ≤10 秒时为真', () => {
  const byo = (ms) => ({ vp: 'b', turn: 'b', inByoyomi: { b: true, w: false }, byoyomi: 60, curByoyomi: { b: ms, w: 0 } });

  setup(byo(30000));
  assert.strictEqual(Clock.isDanger(), false, '读秒还剩 30 秒不算危险');

  setup(byo(11000));
  assert.strictEqual(Clock.isDanger(), false, '11 秒尚未进入危险（边界）');

  setup(byo(10000));
  assert.strictEqual(Clock.isDanger(), true, '读秒 10 秒进入危险');

  setup(byo(5000));
  assert.strictEqual(Clock.isDanger(), true, '读秒 5 秒仍是危险');

  setup({ vp: 'b', turn: 'b', b: 5000, inByoyomi: { b: false, w: false } });
  assert.strictEqual(Clock.isDanger(), false, '本时阶段不算危险（红框只针对读秒）');

  setup({ vp: 'b', turn: 'b', status: 'FINISHED', inByoyomi: { b: true, w: false }, byoyomi: 60, curByoyomi: { b: 5000, w: 0 } });
  assert.strictEqual(Clock.isDanger(), false, '终局不显示');
});
