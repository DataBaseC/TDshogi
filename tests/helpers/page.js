/**
 * tests/helpers/page.js — 前端脚本的「页面级」测试脚手架（§M5，2026-09-28）
 *
 * 前端没有模块系统：`public/*.html` 用 `<script>` 的**顺序**装配全局符号。
 * 拆文件（§4.1/§M5）时最容易犯的错——顺序写反、注入没生效、引用了已搬走的符号——
 * 症状全是**静默**的（页面照常渲染、点了没反应）。本脚手架把"一个页面"搬进 Node：
 *
 *   const { makeSandbox, loadPage, scriptsOf } = require('./helpers/page');
 *   const sandbox = makeSandbox();
 *   loadPage(sandbox, 'play.html');        // 按 <script> 顺序原样跑一遍
 *   sandbox.PlayClock;                     // 关键全局
 *
 * 替身策略：`document` 等用 Proxy 造"万能对象"（任意属性/调用都返回下一个万能对象）。
 * 前端在加载期只会探测/接事件，够用；需要真实 DOM 行为的部分**不在这里覆盖**——
 * 那是 e2e 与人眼的活。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');

/** 万能对象：任意属性/调用/构造都返回下一个万能对象 */
function anyValue() {
  const fn = function () { return anyValue(); };
  return new Proxy(fn, {
    get(_t, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;          // 避免被当成 thenable
      if (k === 'toJSON') return () => ({});       // 让 JSON.stringify(代理) 不返回 undefined
      if (k === 'toString') return () => '';
      if (k === 'length') return 0;
      return anyValue();
    },
    set() { return true; },
    has() { return true; },
    apply() { return anyValue(); },
    construct() { return anyValue(); },
  });
}

/** 浏览器专有全局：**显式白名单**（故意不自动兜底——自动兜底会把"名字写错"也吞掉，
 *  那样测试就不可信了） */
const BROWSER_GLOBALS = [
  'getComputedStyle', 'matchMedia', 'alert', 'confirm', 'prompt', 'atob', 'btoa',
  'URL', 'URLSearchParams', 'Blob', 'FileReader', 'FormData', 'Headers', 'AbortController',
  'IntersectionObserver', 'ResizeObserver', 'MutationObserver', 'DOMParser', 'XMLHttpRequest',
  'Image', 'TextEncoder', 'TextDecoder', 'crypto', 'structuredClone',
  'scrollTo', 'scrollBy', 'open', 'addEventListener', 'removeEventListener', 'dispatchEvent',
  'Element', 'HTMLElement', 'HTMLCanvasElement', 'Node', 'NodeList', 'CSS', 'DocumentFragment',
  'getSelection', 'requestIdleCallback', 'innerWidth', 'innerHeight', 'devicePixelRatio',
  'screen', 'visualViewport', 'scrollY', 'scrollX', 'pageYOffset', 'isSecureContext',
  'reportError', 'Notification',
];

/** 造一个"页面级" window 替身（各脚本共享同一个，与浏览器一致） */
function makeSandbox() {
  const store = new Map();
  const sandbox = {
    console,
    // ⚠️ 定时器一律空实现：脚本会在加载期挂 setInterval（如 api.js 的重连轮询），
    // 真定时器会把 node --test 的进程**吊住不退**（表现为"测试卡死"，而不是报红）。
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    queueMicrotask: (cb) => cb(),
    Math, Date, JSON, Promise, Object, Array, String, Number, Boolean, RegExp, Error,
    Map, Set, Symbol, parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent,
    // fetch 永不 resolve：本脚手架只关心**加载期**。让它返回假数据的话，脚本会在加载后
    // 拿假 JSON 去渲染（`model.board[8]` 之类），产生的异步异常会被 node:test 记成
    // "测试结束后仍有异步活动"而报红——那是**桩的噪音**，不是被拆出来的问题。
    fetch: () => new Promise(() => {}),
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    location: { href: 'http://localhost/', search: '', hash: '', pathname: '/' },
    navigator: { language: 'zh-CN', userAgent: 'node' },
    history: { pushState() {}, replaceState() {} },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    WebSocket: function () { return anyValue(); },
    Audio: function () { return anyValue(); },
    Event: function () { return anyValue(); },
    CustomEvent: function () { return anyValue(); },
  };
  for (const g of BROWSER_GLOBALS) {
    if (!(g in sandbox)) sandbox[g] = anyValue();
  }
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.document = makeDocument();
  vm.createContext(sandbox);
  return sandbox;
}

/**
 * 页面级 document 替身。
 *
 * ⚠️ 不能整个用万能代理：真实代码里有 `while (el.firstChild) el.removeChild(el.firstChild)`
 * 这类**循环删除**，代理会让 `firstChild` 永远为真 → **死循环**（测试卡死）。
 * 所以这里给"元素"一个可枚举的孩子数组，`firstChild` 用 getter 反映它，没有孩子时是 null。
 */
function makeDocument() {
  const mkEl = (tag) => {
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      style: {}, dataset: {}, children: [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      innerHTML: '', outerHTML: '', textContent: '', value: '', href: '', src: '',
      hidden: false, disabled: false, checked: false, scrollTop: 0, scrollHeight: 0,
      __h: {},   // 记录注册的事件处理器：测试可以 __fire('click') 真触发一次
      addEventListener(type, fn) { (el.__h[type] = el.__h[type] || []).push(fn); },
      removeEventListener(type, fn) {
        const a = el.__h[type] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
      },
      /** 触发已注册的处理器（给测试用；真实浏览器里是用户点击） */
      __fire(type, ev) { (el.__h[type] || []).forEach((fn) => fn(ev || { target: el, currentTarget: el })); },
      appendChild(c) { el.children.push(c); return c; },
      removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
      insertBefore(c) { el.children.push(c); return c; },
      replaceChildren() { el.children.length = 0; },
      remove() {}, focus() {}, blur() {}, click() {}, select() {},
      setAttribute() {}, getAttribute: () => null, removeAttribute() {},
      querySelector: () => null, querySelectorAll: () => [],
      closest: () => null, matches: () => false, contains: () => false,
      cloneNode: () => mkEl(tag), scrollIntoView() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
      getContext: () => anyValue(),
    };
    Object.defineProperty(el, 'firstChild', { get: () => el.children[0] || null });
    Object.defineProperty(el, 'lastChild', { get: () => el.children[el.children.length - 1] || null });
    Object.defineProperty(el, 'firstElementChild', { get: () => el.children[0] || null });
    Object.defineProperty(el, 'childNodes', { get: () => el.children });
    Object.defineProperty(el, 'parentNode', { get: () => el.__parent || null, set: (v) => { el.__parent = v; } });
    Object.defineProperty(el, 'parentElement', { get: () => el.__parent || null, set: (v) => { el.__parent = v; } });
    return el;
  };
  const doc = mkEl('html');
  doc.body = mkEl('body');
  doc.head = mkEl('head');
  doc.documentElement = mkEl('html');
  doc.createElement = (tag) => mkEl(tag);
  doc.createTextNode = () => mkEl('#text');
  doc.getElementById = (id) => doc.__byId[id] || (doc.__byId[id] = mkEl('div'));
  doc.querySelector = () => mkEl('div');
  doc.querySelectorAll = () => [];
  doc.__byId = {};
  doc.addEventListener = () => {};
  doc.removeEventListener = () => {};
  doc.elementFromPoint = () => mkEl('div');
  doc.getElementsByTagName = () => [];
  doc.title = 'test';
  return doc;
}

/** 取某页面按序的 js 脚本列表。SPA 形态下 app.html 只有一个 bundle，返回 SPA_ORDER 源文件列表 */
function scriptsOf(html, dir = PUBLIC) {
  if (html === 'app.html') return [...SPA_ORDER];
  const src = fs.readFileSync(path.join(dir, html), 'utf8');
  return [...src.matchAll(/<script\s+src="js\/([^"]+)"><\/script>/g)].map((m) => m[1]);
}

/** 按脚本顺序把整页跑进 sandbox；返回每个文件的加载结果 */
function loadPage(sandbox, html, dir = PUBLIC) {
  const results = [];
  for (const f of scriptsOf(html, dir)) {
    const p = path.join(dir, 'js', f);
    const code = fs.readFileSync(p, 'utf8');
    let err = null;
    try {
      vm.runInContext(code, sandbox, { filename: `public/js/${f}` });
    } catch (e) {
      err = e;
    }
    results.push({ file: f, ok: !err, error: err });
  }
  return results;
}

/**
 * 页面 → 加载完必须存在的关键全局（缺了对应功能会**静默失效**）。
 *
 * SPA 形态（2026-10-09）：单一 `app.html` + `app.bundle.js`，所有页面 View 在同一文档内注册。
 * 这里列的是**全局单例 + 全部 View**——加载完必须全部到位。
 */
const PAGES = {
  'app.html': [
    // 共享内核单例
    'NAV', 'API', 'Settings', 'Sound', 'I18N', 'A11y', 'Router',
    // 棋盘栈
    'ShogiBoard', 'FreeBoard', 'FreeBoardDnd', 'PieceKinds',
    // 页面 View（Views.xxx）
    'Views',
  ],
};

/** SPA 源文件顺序（与 scripts/pack.js 的 APP 清单一致；loadPage 用它逐文件加载） */
const SPA_ORDER = [
  // 共享内核（单例，加载一次）
  'a11y.js', 'settings.js', 'sound.js', 'util.js', 'i18n.js', 'nav.js', 'api.js', 'hovercard.js',
  // 棋盘栈（play/review 共用纯库）
  'pieces.js', 'piece-kinds.js', 'board.js', 'freeboard-dnd.js', 'freeboard.js',
  // 路由
  'router.js',
  // 页面 View
  'home.js', 'lobby.js', 'gallery.js', 'tournaments.js', 'tournament.js',
  'profile.js', 'records-console.js', 'tabs.js', 'review.js',
  // 对局子模块 + play
  'play-clock.js', 'play-chat.js', 'play-demo.js', 'play-views.js', 'play.js',
  // 管理后台子模块 + admin
  'admin-shell.js', 'admin-records.js', 'admin-users.js', 'admin-audit.js',
  'admin-tournaments.js', 'admin-moderation.js', 'admin-console.js', 'admin-items.js', 'admin.js',
  // 启动器（最后：等所有 View 注册完）
  'boot.js',
];

module.exports = { anyValue, makeSandbox, makeDocument, scriptsOf, loadPage, PAGES, PUBLIC, ROOT, SPA_ORDER };
