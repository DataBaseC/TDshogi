/**
 * play-views.test.js — 对局页**视图层**（public/js/play-views.js）的运行期回归
 *
 * ⚠️ 为什么单靠 `page-load.test.js` 不够：那个只保证"**加载期**不抛错"。
 * 拆出来的视图层是**运行期**才跑的——真正会踩的坑是：
 *   - 读了 play.js 闭包里的可变量，但 `ctx` 只在 make() 时按值捕获（症状：切了视角棋盘不翻）；
 *   - `ctx.X = ...` 写了只读的 getter（严格模式直接抛 TypeError，而页面只是"点了没反应"）。
 * 这两类都不会在加载期暴露。所以这里用页面级的 DOM 桩**真调一遍**渲染函数与视角切换。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { makeSandbox, loadPage } = require('./helpers/page');

/** 加载 SPA 全部脚本，返回 { sandbox, views }（views = PlayViews.make() 的返回值） */
function load() {
  const sandbox = makeSandbox();
  const rs = loadPage(sandbox, 'app.html');
  const bad = rs.find((r) => !r.ok);
  assert.ok(!bad, `加载 js/${bad && bad.file} 失败：${bad && bad.error && bad.error.message}`);
  assert.ok(sandbox.PlayViews, 'window.PlayViews 应由 play-views.js 提供');
  // PlayViews.make 需要 deps: api.on(), $(), ctx 等
  const mockApi = { on: () => () => {}, send: () => {}, isConnected: () => true };
  const $ = (id) => sandbox.document.getElementById(id);
  const mockCtx = { isPlayer: false, mySeat: 'b', spectatorViewpoint: 'b', state: null };
  const mockBoard = new Proxy({}, {
    get: (t, k) => {
      if (k === 'then') return undefined;
      return (...args) => (k === 'getViewpoint' ? 'b' : mockBoard);
    },
  });
  mockCtx.fb = mockBoard;
  const views = sandbox.PlayViews.make({
    api: mockApi, $, ctx: mockCtx, TIME_CONTROLS: {},
    ensureBoard: () => { mockCtx.fb = mockBoard; return mockBoard; },
    guest: { id: 'test' }, toast: () => {},
  });
  assert.ok(views, 'PlayViews.make() 应返回视图对象');
  return { sandbox, views };
}

const emptyBoard = () => Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));

function fakeState(over = {}) {
  return Object.assign({
    status: 'PLAYING', turn: 'b', code: 'ABC123', timeControl: '10:00',
    players: {
      b: { id: 'p1', name: '先手君', level: 3, rating: 1500, avatar: '' },
      w: { id: 'p2', name: '後手君', level: 4, rating: 1600, avatar: '' },
    },
    board: emptyBoard(), hands: { b: [], w: [] }, lastMove: null, check: false,
    legalTargetsBySq: {}, moves: [], movesKif: [], moveTimes: [], spectators: [],
  }, over);
}

test('renderPlayerBars：把双方名字/评级写进 DOM（观战视角下上方=後手）', () => {
  const { sandbox, views } = load();
  const doc = sandbox.document;
  views.renderPlayerBars(fakeState());
  assert.strictEqual(doc.getElementById('topName').textContent, '後手君');
  assert.strictEqual(doc.getElementById('bottomName').textContent, '先手君');
  assert.match(String(doc.getElementById('topRating').textContent), /Lv\.4/);
  assert.match(String(doc.getElementById('bottomRating').textContent), /ELO 1500/);
});

test('playerMeta / findKingSq：副标题拼接与王位置定位', () => {
  const { views } = load();
  assert.strictEqual(views.playerMeta(null), '');
  assert.strictEqual(views.playerMeta({ level: 2 }), 'Lv.2');
  assert.strictEqual(views.playerMeta({ level: 2, rating: 1200, title: '名人' }), 'Lv.2 · ELO 1200 · 名人');
  const board = emptyBoard();
  board[8][4] = { piece: '玉', color: 'b', sq: '5i' };
  assert.strictEqual(views.findKingSq({ board }, 'b'), '5i');
  assert.strictEqual(views.findKingSq({ board }, 'w'), null);
});

test('render：整条渲染链跑通不抛错（含 FreeBoard 装机、棋谱、观众列表）', () => {
  const { views } = load();
  assert.doesNotThrow(() => views.render(fakeState()));
  assert.doesNotThrow(() => views.render(fakeState({
    status: 'FINISHED', result: { winner: 'b', reason: '投了' }, roomType: 'normal',
    moves: ['7g7f', '3c3d'], movesKif: ['７六歩', '３四歩'],
  })));
});

test('观战视角切换：点击按钮真的翻转视角（覆盖 ctx 的 setter，不是只读 getter）', () => {
  const { sandbox, views } = load();
  const btn = sandbox.document.getElementById('btnViewpoint');
  assert.ok(btn.__h && btn.__h.click && btn.__h.click.length, 'btnViewpoint 应注册了 click 处理器');
  views.render(fakeState());                       // 让 ctx.state 有值
  const before = views.currentViewpoint();
  assert.doesNotThrow(() => btn.__fire('click'), '切视角不得抛错（曾因 ctx 只读 getter 而抛）');
  const after = views.currentViewpoint();
  assert.notStrictEqual(after, before, '视角应真的翻转（说明写回了 play.js 的 let）');
});
