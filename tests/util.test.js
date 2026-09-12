/**
 * tests/util.test.js — 前端公共工具（PLAN §M5 收敛 + §P4 的 `debugLog`）
 *
 * `util.js` 是 IIFE 挂 `window`，这里给它一个最小浏览器替身（location / localStorage / console），
 * 每次用例都 **重新 require**（清缓存）以便从零验证「加载时读开关」的行为。
 *
 * 只测不依赖真实 DOM 的部分：`debugLog` 全是纯逻辑；`$` / `toast` 需真实 DOM，不在本轮范围。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const UTIL = path.join(__dirname, '../public/js/util.js');

/**
 * 造一个最小浏览器环境并加载 util.js。
 * @param {{search?:string, debugKey?:string|null, preFlag?:boolean}} [opts]
 */
function loadUtil(opts = {}) {
  const store = new Map();
  if (opts.debugKey != null) store.set('tdshogi_debug', String(opts.debugKey));

  const logs = [];
  const win = {
    location: { search: opts.search || '' },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    console: { log: (...args) => logs.push(args) },
  };
  if (opts.preFlag !== undefined) win.TDSHOGI_DEBUG = opts.preFlag;

  globalThis.window = win;
  delete require.cache[require.resolve(UTIL)];
  require(UTIL);
  return { win, logs, store, debugLog: win.debugLog };
}

test('默认关闭：debugLog 零输出、零留痕', () => {
  const { logs, debugLog } = loadUtil();
  assert.strictEqual(debugLog.isOn(), false);
  debugLog('play', '不该出现', { a: 1 });
  assert.strictEqual(logs.length, 0, '关闭时不应有任何控制台输出');
  assert.deepStrictEqual(debugLog.dump(), [], '关闭时不应写入环形缓冲');
});

test('enable() 后输出「时间戳 + DEBUG + [scope]」，参数原样透传', () => {
  const { logs, debugLog } = loadUtil();
  debugLog.enable();
  logs.length = 0; // 丢弃 enable() 自带的提示行
  const payload = { hp: 3 };
  debugLog('play', 'state 到达', payload);

  assert.strictEqual(logs.length, 1);
  assert.match(logs[0][0], /^\d{2}:\d{2}:\d{2}\.\d{3} DEBUG \[play\]$/, '格式应与服务端 text 日志同构');
  assert.strictEqual(logs[0][1], 'state 到达');
  assert.strictEqual(logs[0][2], payload, '对象应原样透传（不能 stringify，否则控制台里展不开）');
});

test('enable() 持久化开关，disable() 清除', () => {
  const { store, debugLog } = loadUtil();
  debugLog.enable();
  assert.strictEqual(store.get('tdshogi_debug'), '1', 'enable 应写入 localStorage');
  debugLog.disable();
  assert.strictEqual(store.has('tdshogi_debug'), false, 'disable 应清掉标记');
  assert.strictEqual(debugLog.isOn(), false);
});

test('开关三来源：URL ?debug=1 加载即生效', () => {
  assert.strictEqual(loadUtil({ search: '?room=abc&debug=1' }).debugLog.isOn(), true);
  assert.strictEqual(loadUtil({ search: '?debug=true' }).debugLog.isOn(), true);
  assert.strictEqual(loadUtil({ search: '?debug=0' }).debugLog.isOn(), false, 'debug=0 不应开启');
  assert.strictEqual(loadUtil({ search: '' }).debugLog.isOn(), false);
});

test('开关三来源：localStorage 标记加载即生效', () => {
  assert.strictEqual(loadUtil({ debugKey: '1' }).debugLog.isOn(), true);
  assert.strictEqual(loadUtil({ debugKey: '0' }).debugLog.isOn(), false);
});

test('开关三来源：window.TDSHOGI_DEBUG 预置（自动化测试用）', () => {
  assert.strictEqual(loadUtil({ preFlag: true }).debugLog.isOn(), true);
  assert.strictEqual(loadUtil({ preFlag: false }).debugLog.isOn(), false);
});

test('dump() 保留最近 200 条，超出后丢弃最旧的', () => {
  const { debugLog } = loadUtil();
  debugLog.enable();
  debugLog.clear();
  for (let i = 0; i < 205; i++) debugLog('t', 'n' + i);

  const d = debugLog.dump();
  assert.strictEqual(d.length, 200, '环形缓冲上限应为 200');
  assert.match(d[0], /n5$/, '最旧的 5 条应被挤出');
  assert.match(d[d.length - 1], /n204$/, '最新一条应在末尾');
});

test('dump() 把对象压成一行，便于整段复制给开发者', () => {
  const { debugLog } = loadUtil();
  debugLog.enable();
  debugLog.clear();
  debugLog('play', '写盘', { roomId: 'r1' });
  debugLog('play', '异常', new Error('炸了'));
  const d = debugLog.dump();
  assert.match(d[0], /^\d{2}:\d{2}:\d{2}\.\d{3} DEBUG \[play\] 写盘 \{"roomId":"r1"\}$/);
  assert.match(d[1], /异常 炸了$/, 'Error 应压成 message');
});

test('refresh() 重新读取开关（改 URL 后无需刷新页面）', () => {
  const { win, debugLog } = loadUtil();
  assert.strictEqual(debugLog.isOn(), false);
  win.location.search = '?debug=1';
  assert.strictEqual(debugLog.refresh(), true);
  assert.strictEqual(debugLog.isOn(), true, 'refresh 后应立即生效');
});

test('window.UI.debugLog 与 window.debugLog 是同一个函数', () => {
  const { win } = loadUtil();
  assert.strictEqual(typeof win.debugLog, 'function');
  assert.strictEqual(win.UI.debugLog, win.debugLog);
});

test('localStorage 抛错时（隐私模式）不崩溃，退化为关闭', () => {
  const win = {
    location: { search: '' },
    localStorage: {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
      removeItem: () => { throw new Error('SecurityError'); },
    },
    console: { log: () => {} },
  };
  globalThis.window = win;
  delete require.cache[require.resolve(UTIL)];
  require(UTIL);

  assert.strictEqual(win.debugLog.isOn(), false, '读不到开关应按关闭处理');
  assert.doesNotThrow(() => win.debugLog.enable(), 'enable 不应因存储不可用而抛错');
  assert.doesNotThrow(() => win.debugLog.disable());
});

// ======================================================================
// UI.resultText（§M5：原先 history.js 与 review.js 各有一份实现）
// ======================================================================
// 这条测试的价值在于**同时锁定两种返回形态**：列表页要 `{text, cls}` 着色，
// 复盘页只要纯文本。合并实现时最容易犯的错就是让其中一种形态失效——
// 而两页都只会**静默显示错文案**，不会报错。
test('UI.resultText：纯文本形态与带样式形态（历史页/复盘页两种用法）', () => {
  const win = {
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console: { log: () => {} },
  };
  globalThis.window = win;
  delete require.cache[require.resolve(UTIL)];
  require(UTIL);
  const sf = win.UI.resultText;

  // ---- 纯文本形态（review.js 的用法）----
  assert.strictEqual(sf({ result: 'b', names: ['先手', '後手'] }), '先手 胜');
  assert.strictEqual(sf({ result: 'w', names: ['先手', '後手'] }), '後手 胜');
  assert.strictEqual(sf({ result: '-', resultDetail: '千日手', names: [] }), '千日手', '和棋应显示 resultDetail');
  assert.strictEqual(sf({ result: '-', names: [] }), '和棋', '无 resultDetail 时兜底为「和棋」');
  assert.strictEqual(sf({ result: null }), '未完成');
  assert.strictEqual(sf({}), '未完成');
  assert.strictEqual(sf({ result: 'b' }), '先手 胜', 'r.names 缺失时用默认双方名');

  // ---- names 覆盖（history.js 传局部 names 的用法）----
  assert.strictEqual(sf({ result: 'b', names: ['甲', '乙'] }, { names: ['丙', '丁'] }), '丙 胜');

  // ---- 带样式形态（history.js 的用法）----
  assert.deepStrictEqual(
    sf({ result: 'b', names: ['甲', '乙'] }, { withClass: true }),
    { text: '甲 胜', cls: 'result-win' });
  assert.deepStrictEqual(
    sf({ result: '-' , resultDetail: '入玉宣言', names: [] }, { withClass: true }),
    { text: '入玉宣言', cls: 'result-draw' });
  assert.deepStrictEqual(
    sf({ result: null }, { withClass: true }),
    { text: '未完成', cls: 'result-draw' });
});
