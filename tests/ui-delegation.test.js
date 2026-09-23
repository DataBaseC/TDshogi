/**
 * ui-delegation.test.js — `data-act` 委托与"不再有 inline onclick"的守护测试
 * （2026-09-23，安全审查遗留项 13f）
 *
 * **为什么要有它**：13f 的改造是"把 34 处 inline onclick 换成 data-act + 委托"。
 * 这种改动的失败方式**极其安静**：某个 `data-act` 名字打错一个字母、或者某个按钮漏了注册，
 * 页面照常渲染、控制台不报错，只是那个按钮**点了没反应** —— 而页面上按钮那么多，
 * 不做静态检查就只能靠人逐个点。
 *
 * 本文件用两层守护：
 *   1. **机制层**：用最小 DOM 替身加载 `util.js`，真发一个 click 事件，
 *      断言"委托能命中动态插入的元素""`data-href` 能跳转"（沿用 `tests/play-clock.test.js`
 *      那套"最小替身跑浏览器 IIFE"的做法，不引入 jsdom）。
 *   2. **接线层**（静态）：源码里每个 `data-act="x"` 都能找到 `onAction('x'` 的注册；
 *      且 `public/` 下不再出现 `onclick="`（除了注释里的说明）。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const UTIL = path.join(ROOT, 'public/js/util.js');

/** 最小 window / document 替身：只为让 util.js 能加载并暴露委托用的 click 监听 */
function loadUtilWithStub() {
  const clicks = [];
  const el = (attrs) => ({
    _attrs: attrs || {},
    style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    getAttribute(k) { return this._attrs[k] === undefined ? null : this._attrs[k]; },
    setAttribute(k, v) { this._attrs[k] = v; },
    removeAttribute(k) { delete this._attrs[k]; },
  });
  const documentStub = {
    addEventListener(type, fn) { if (type === 'click') clicks.push(fn); },
    getElementById: () => null,
    createElement: () => el(),
    head: { appendChild() {} },
    body: { appendChild() {}, classList: { toggle() {} } },
  };
  const locationStub = { search: '', href: '' };
  const g = { document: documentStub, location: locationStub, localStorage: undefined };
  g.window = g;
  // 用 `new Function` 在受控的全局下求值，避免污染本进程真正的 global
  const src = fs.readFileSync(UTIL, 'utf8');
  const fn = new Function('window', 'document', 'location',
    `${src}\nreturn window.UI;`);
  return { UI: fn(g, documentStub, locationStub), clicks, el, locationStub };
}

/** 造一个"点击"事件，`closest` 按选择器返回预设元素（模拟 DOM 的冒泡匹配） */
const clickOn = (map) => ({ target: { closest: (sel) => map[sel] || null } });

test('委托：data-act 命中**动态插入**的元素（这正是它相对逐个绑定的价值）', () => {
  const { UI, clicks, el } = loadUtilWithStub();
  assert.strictEqual(clicks.length, 1, '整页只应装一个 click 监听');
  let got = null;
  UI.onAction('t-echo', (node) => { got = node.getAttribute('data-id'); });
  const btn = el({ 'data-act': 't-echo', 'data-id': '42' });
  clicks[0](clickOn({ '[data-act]': btn }));
  assert.strictEqual(got, '42', '处理器应收到该元素并读到 data-id');
});

test('委托：未知动作名静默忽略（不会 throw、不会误触发别人）', () => {
  const { UI, clicks, el } = loadUtilWithStub();
  let fired = 0;
  UI.onAction('known', () => { fired++; });
  clicks[0](clickOn({ '[data-act]': el({ 'data-act': 'unknow' }) }));
  assert.strictEqual(fired, 0);
  clicks[0](clickOn({ '[data-act]': el({ 'data-act': 'known' }) }));
  assert.strictEqual(fired, 1);
});

test('委托：data-href 通用跳转（替代 6 处 onclick="location.href=…"）', () => {
  const { UI, clicks, el, locationStub } = loadUtilWithStub();
  assert.ok(UI, 'util.js 应能加载');
  clicks[0](clickOn({ '[data-href]': el({ 'data-href': 'history.html' }) }));
  assert.strictEqual(locationStub.href, 'history.html');
});

test('委托：点在没有 data-act/data-href 的地方什么都不做', () => {
  const { clicks, locationStub } = loadUtilWithStub();
  assert.doesNotThrow(() => clicks[0](clickOn({})));
  assert.strictEqual(locationStub.href, '', '不该发生任何跳转');
});

test('静态：public/ 下不再有 inline onclick（13f 的回归守护）', () => {
  const offenders = [];
  const scan = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) { scan(p); continue; }
      if (!/\.(js|html)$/.test(name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      src.split(/\r?\n/).forEach((line, i) => {
        // ⚠️ 只认"代码里的"onclick：注释里会提到它（本改造的说明就写在注释里），
        //    所以跳过以 // 、* 、/* 开头的行。
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
        // ⚠️ 只认 HTML **属性**形态（`onclick="…"`）：`el.onclick = () => {}` 是正常的
        //    DOM 属性赋值，不是注入面，别误报（第一版就误报了三处）。
        if (/onclick\s*=\s*["']/.test(line)) {
          offenders.push(`${path.relative(ROOT, p)}:${i + 1}: ${t.slice(0, 70)}`);
        }
      });
    }
  };
  scan(path.join(ROOT, 'public'));
  assert.deepStrictEqual(offenders, [],
    '以下位置仍有 inline onclick（应改为 data-act + UI.onAction，或 data-href）：\n' + offenders.join('\n'));
});

test('静态：每个 data-act 都有对应的 onAction 注册（防"点了没反应"）', () => {
  const jsDir = path.join(ROOT, 'public/js');
  const srcs = {};
  for (const f of fs.readdirSync(jsDir)) {
    if (f.endsWith('.js')) srcs[`public/js/${f}`] = fs.readFileSync(path.join(jsDir, f), 'utf8');
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'public'))) {
    if (f.endsWith('.html')) {
      srcs[`public/${f}`] = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
    }
  }
  const all = Object.values(srcs).join('\n');
  const registered = new Set();
  for (const m of all.matchAll(/onAction\(\s*['"]([\w-]+)['"]/g)) registered.add(m[1]);

  const used = new Map(); // act → 出现位置
  for (const [file, src] of Object.entries(srcs)) {
    src.split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*')) return;
      for (const m of line.matchAll(/data-act="([\w-]+)"/g)) {
        if (!used.has(m[1])) used.set(m[1], `${file}:${i + 1}`);
      }
    });
  }

  assert.ok(used.size >= 15, `解析到的 data-act 数量偏少（${used.size}）——扫描是不是坏了？`);
  const missing = [...used.entries()]
    .filter(([act]) => !registered.has(act))
    .map(([act, where]) => `data-act="${act}"（${where}）没有任何 UI.onAction('${act}', …) 注册 → 点了不会动`);
  assert.deepStrictEqual(missing, [], '以下动作名没有注册：\n' + missing.join('\n'));
});
