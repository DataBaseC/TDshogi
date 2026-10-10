#!/usr/bin/env node
/**
 * smoke-spa.js — SPA 集成冒烟测试（开发期校验，不随部署）
 *
 * 在 Node 里用最小 DOM 垫片加载 `app.bundle.js`，验证跨模块集成：
 *   1) 所有模块加载无异常（捕获加载期未定义全局 / 加载顺序问题）；
 *   2) 9 个页面 View 全部注册到 window.Views；
 *   3) 每个 View 具备 render/mount/unmount，且 render() 能产出非空 HTML 字符串；
 *   4) Router.resolve 把各条路由（含老 .html 深链）映射到正确 View。
 *
 * 不做真实 DOM 解析 / mount 执行（那需要完整 jsdom），故不验证事件绑定行为，
 * 只验证「注册 + 渲染 + 路由映射」这条最易出跨模块错的链路。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', 'public', 'js');
const BUNDLE = path.join(JS_DIR, 'app.bundle.js');

// ---- 最小 DOM / 浏览器垫片 ----
function makeClassList() {
  const set = new Set();
  return {
    add: (...c) => c.forEach((x) => set.add(x)),
    remove: (...c) => c.forEach((x) => set.delete(x)),
    toggle: (c, f) => { if (f) set.add(c); else set.delete(c); },
    contains: (c) => set.has(c),
  };
}
function fakeEl() {
  return {
    classList: makeClassList(),
    style: {},
    children: [], childNodes: [],
    innerHTML: '', textContent: '', value: '',
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    hasAttribute() { return false; }, appendChild() {}, insertBefore() {},
    removeChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, focus() {}, blur() {}, scrollIntoView() {},
    dispatchEvent() { return true; }, contains() { return false; },
  };
}
const documentEl = {
  readyState: 'loading', // 让 boot/sound 的 DOMContentLoaded 不触发（本测试不跑启动器）
  documentElement: Object.assign(fakeEl(), { classList: makeClassList() }),
  body: fakeEl(),
  head: fakeEl(),
  addEventListener() {}, removeEventListener() {},
  getElementById() { return null; },
  querySelector() { return null; }, querySelectorAll() { return []; },
  createElement: fakeEl, createTextNode() { return {}; },
  dispatchEvent() { return true; },
};
const store = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
};
const location = {
  protocol: 'http:', host: 'localhost:3000', hostname: 'localhost', port: '3000',
  origin: 'http://localhost:3000', pathname: '/', search: '', hash: '', href: 'http://localhost:3000/',
};
const sandbox = {
  console, URL, URLSearchParams, JSON, Math, Date, Promise, Object, Array, String, Number, Boolean,
  Map, Set, Symbol, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, Error, TypeError,
  setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: (f) => setTimeout(f, 0),
  cancelAnimationFrame: clearTimeout,
  document: documentEl,
  location,
  history: { pushState() {}, replaceState() {}, back() {}, forward() {}, length: 1, state: null },
  localStorage: store(), sessionStorage: store(),
  navigator: { userAgent: 'smoke', language: 'zh-CN' },
  performance: { now: () => Date.now() },
  fetch: () => new Promise((r) => setTimeout(() => r({ ok: true, status: 200, json: () => Promise.resolve({}) }), 0)),
  WebSocket: class { constructor() { this.readyState = 0; } send() {} close() {} },
  Audio: class { play() { return Promise.resolve(); } pause() {} load() {} addEventListener() {} },
  AudioContext: undefined, webkitAudioContext: undefined,
  crypto: { getRandomValues: (a) => a },
  CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, (o && o.detail) || {}); } },
  Event: class { constructor(t) { this.type = t; } },
  MutationObserver: class { observe() {} disconnect() {} },
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// ---- 加载 bundle ----
let loadErr = null;
try {
  vm.runInContext(fs.readFileSync(BUNDLE, 'utf8'), sandbox, { filename: 'app.bundle.js' });
} catch (e) {
  loadErr = e;
}

let pass = 0, fail = 0;
const problems = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; problems.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

console.log('\n[1] bundle 加载');
check('app.bundle.js 加载无异常', !loadErr, loadErr && loadErr.message);

console.log('\n[2] 9 个页面 View 注册');
const expected = ['home', 'lobby', 'gallery', 'tournaments', 'tournament', 'profile', 'review', 'play', 'admin'];
const Views = sandbox.Views || {};
for (const name of expected) {
  const v = Views[name];
  check(`Views.${name} 已注册`, !!v);
  if (v) {
    check(`Views.${name} 有 render/mount/unmount`,
      typeof v.render === 'function' && typeof v.mount === 'function' && typeof v.unmount === 'function');
  }
}

console.log('\n[3] 每个 View 的 render() 产出非空 HTML');
for (const name of expected) {
  const v = Views[name];
  if (!v || typeof v.render !== 'function') { check(`Views.${name}.render`, false, '缺失'); continue; }
  let html = null, err = null;
  try { html = v.render({ id: 'x', room: 'r', tab: 'records' }); } catch (e) { err = e; }
  check(`Views.${name}.render() 返回非空字符串`, typeof html === 'string' && html.trim().length > 0,
    err ? '抛错: ' + err.message : (html == null ? '返回 null' : '空字符串'));
}

console.log('\n[4] Router 路由映射（含老 .html 深链）');
const Router = sandbox.Router;
check('Router 已注册', !!Router && typeof Router.resolve === 'function');
if (Router && Router.resolve) {
  const cases = [
    ['/', 'home'], ['/index.html', 'home'], ['/app.html', 'home'],
    ['/lobby', 'lobby'], ['/lobby.html', 'lobby'],
    ['/gallery', 'gallery'], ['/gallery.html', 'gallery'],
    ['/tournaments', 'tournaments'], ['/tournaments.html', 'tournaments'],
    ['/tournament?id=1', 'tournament'],
    ['/profile', 'profile'], ['/profile.html', 'profile'],
    ['/history.html', 'profile'], // 老棋谱页 → 个人页
    ['/review?id=abc', 'review'], ['/review.html?id=abc', 'review'],
    ['/play?room=xyz&spectate=1', 'play'], ['/play.html?room=xyz', 'play'],
    ['/admin', 'admin'], ['/admin.html', 'admin'],
  ];
  for (const [url, want] of cases) {
    let got = null;
    try { got = Router.resolve(url).viewName; } catch (e) { got = 'ERR:' + e.message; }
    check(`resolve('${url}') → ${want}`, got === want, `实际 ${got}`);
  }
  // history.html → profile 的 records tab
  let params = null;
  try { params = Router.resolve('/history.html').params; } catch (e) {}
  check("resolve('/history.html') 带 tab=records", params && params.tab === 'records', JSON.stringify(params));
}

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
if (fail) {
  console.log('\n未通过项：');
  problems.forEach((p) => console.log('  - ' + p));
  process.exit(1);
}
console.log('SPA 冒烟测试全部通过 ✓');
