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

// ======================================================================
// UI.paginate（2026-09-13：棋谱页 / 赛事页 / 后台三处共用）
// ======================================================================
// ⚠️ 复用文件顶部既有的 `loadUtil(opts)`（它返回 `{ win, logs, store, debugLog }`）。
// 这里**不要**再定义同名函数：函数声明同名会**静默覆盖**（不报错、不警告），
// 先前所有用例会突然拿到另一份实现——本次就踩了这个坑。
// 分页算错的表现是「一片空白页」或「最后一页只有一条」——都不报错、也很难描述，
// 所以这里把边界一次性钉死：空数组、单页、末页、页码越界、按钮禁用态、回调触发。

/** 最小分页条替身：从 innerHTML 里解析出按钮，模拟 querySelectorAll + 点击 */
function mkPagerBox() {
  return {
    innerHTML: '',
    _cache: null,
    _cachedHtml: null,
    querySelectorAll() {
      // ⚠️ 解析结果必须**缓存**：真实 DOM 里 `querySelectorAll` 每次返回的是**同一批节点**，
      // 而 `paginate` 是"内部绑回调、测试再取按钮去点"。替身若每次新建对象，
      // 绑上去的 _cb 就落在另一批对象上 —— 测试会变成"点了但没反应"，且看起来像产品 bug。
      if (this._cache && this._cachedHtml === this.innerHTML) return this._cache;
      const out = [];
      const re = /<button[^>]*data-pg="(-?\d+)"([^>]*)>/g;
      let m;
      while ((m = re.exec(this.innerHTML))) {
        // ⚠️ 必须先把 `m[1]`/`m[2]` 取成局部常量再进闭包：`m` 是循环变量，
        // 循环结束后会变 null —— 直接引用它，按钮回调一执行就炸。
        const pg = m[1];
        const attrs = m[2];
        out.push({
          disabled: / disabled/.test(attrs),
          _cb: null,
          getAttribute() { return pg; },
          addEventListener(ev, cb) { if (ev === 'click') this._cb = cb; },
        });
      }
      this._cache = out;
      this._cachedHtml = this.innerHTML;
      return out;
    },
  };
}

test('UI.paginate：切片与页数计算', () => {
  const { win } = loadUtil();
  const pg = win.UI.paginate;
  const items = Array.from({ length: 45 }, (_, i) => i + 1); // 1..45

  let r = pg({ items, page: 1, size: 20 });
  assert.strictEqual(r.total, 45);
  assert.strictEqual(r.totalPages, 3);
  assert.deepStrictEqual(r.slice, items.slice(0, 20), '第 1 页取前 20 条');

  r = pg({ items, page: 2, size: 20 });
  assert.deepStrictEqual(r.slice, items.slice(20, 40));
  assert.strictEqual(r.slice.length, 20);

  r = pg({ items, page: 3, size: 20 });
  assert.deepStrictEqual(r.slice, [41, 42, 43, 44, 45], '末页只剩余数条');
});

test('UI.paginate：空数组 / 单页 / 页码越界都夹回合法范围', () => {
  const { win } = loadUtil();
  const pg = win.UI.paginate;

  let r = pg({ items: [], page: 1, size: 20 });
  assert.deepStrictEqual(r.slice, []);
  assert.strictEqual(r.totalPages, 1, '空数组也算 1 页（前端要显示「共 0 条」而不是 NaN）');
  assert.strictEqual(r.page, 1);

  const items = Array.from({ length: 5 }, (_, i) => i + 1);
  r = pg({ items, page: 9, size: 20 });
  assert.strictEqual(r.page, 1, '只有 1 页时越界页码应夹回 1');

  const many = Array.from({ length: 45 }, (_, i) => i + 1);
  r = pg({ items: many, page: 99, size: 20 });
  assert.strictEqual(r.page, 3, '页码超出末尾应夹回最后一页');
  assert.strictEqual(r.slice.length, 5, '夹回后必须拿到真实数据，而不是空数组');

  r = pg({ items: many, page: 0, size: 20 });
  assert.strictEqual(r.page, 1, 'page=0 夹回 1');
  r = pg({ items: many, page: -3, size: 20 });
  assert.strictEqual(r.page, 1, '负数页码夹回 1');
});

test('UI.paginate：默认每页 20 条，size 可覆盖且非法值兜底', () => {
  const { win } = loadUtil();
  const pg = win.UI.paginate;
  const items = Array.from({ length: 50 }, (_, i) => i + 1);

  assert.strictEqual(pg({ items, page: 1 }).slice.length, 20, '不传 size 时默认 20');
  assert.strictEqual(pg({ items, page: 1, size: 10 }).slice.length, 10, 'size 可覆盖（个人页最近对局用 10）');
  assert.strictEqual(pg({ items, page: 1, size: 0 }).slice.length, 20, 'size=0 视为非法，回落默认值');
  assert.strictEqual(pg({ items: null, page: 1 }).slice.length, 0, 'items 为 null 不该抛错');
});

test('UI.paginate：分页条渲染、按钮禁用态与翻页回调', () => {
  const { win } = loadUtil();
  const pg = win.UI.paginate;
  const items = Array.from({ length: 45 }, (_, i) => i + 1);

  // ---- 单页：只显示总数，不出翻页按钮 ----
  const one = mkPagerBox();
  pg({ items: items.slice(0, 5), page: 1, container: one });
  assert.match(one.innerHTML, /共 5 条/);
  assert.strictEqual(one.querySelectorAll().length, 0, '单页不该出现翻页按钮');

  // ---- 空列表：不显示任何东西（连「共 0 条」也不占位）----
  const empty = mkPagerBox();
  pg({ items: [], page: 1, container: empty });
  assert.strictEqual(empty.innerHTML, '');

  // ---- 多页：两个按钮 + 页码信息 ----
  const box = mkPagerBox();
  let clicked = null;
  pg({ items, page: 2, container: box, onPage: (n) => { clicked = n; } });
  assert.match(box.innerHTML, /第 2 \/ 3 页/, '应显示当前页/总页数');
  assert.match(box.innerHTML, /共 45 条/);

  const btns = box.querySelectorAll();
  assert.strictEqual(btns.length, 2, '中间页应有两个按钮');
  assert.strictEqual(btns[0].disabled, false);
  assert.strictEqual(btns[1].disabled, false);

  btns[0]._cb(); // 上一页
  assert.strictEqual(clicked, 1, '「上一页」应回调 page-1');
  btns[1]._cb(); // 下一页
  assert.strictEqual(clicked, 3, '「下一页」应回调 page+1');

  // ---- 首页：上一页禁用，且点了不触发回调 ----
  const first = mkPagerBox();
  clicked = null;
  pg({ items, page: 1, container: first, onPage: (n) => { clicked = n; } });
  const fb = first.querySelectorAll();
  assert.strictEqual(fb[0].disabled, true, '首页「上一页」应禁用');
  assert.strictEqual(fb[1].disabled, false);
  fb[0]._cb();
  assert.strictEqual(clicked, null, '禁用按钮不该触发翻页回调');

  // ---- 末页：下一页禁用 ----
  const last = mkPagerBox();
  pg({ items, page: 3, container: last, onPage: () => {} });
  const lb = last.querySelectorAll();
  assert.strictEqual(lb[0].disabled, false);
  assert.strictEqual(lb[1].disabled, true, '末页「下一页」应禁用');

  // ---- 不传 container：只切片，不报错 ----
  assert.doesNotThrow(() => pg({ items, page: 1 }));
});
