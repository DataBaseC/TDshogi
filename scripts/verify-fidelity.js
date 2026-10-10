#!/usr/bin/env node
/**
 * verify-fidelity.js — 「功能不丢失」硬校验（开发期）
 *
 * 对每个页面：取出 View.render() 产出的 HTML，与原 public/<page>.html 的**页面主体**
 * 比对元素 id 集合。原主体里出现、而 render() 里缺失的 id = 可能丢内容（抛出告警）。
 * 外壳自带的 id（nav 的 themeToggle/langToggle/… 、toast）不在页面主体里，排除。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const JS_DIR = path.join(ROOT, 'public', 'js');
const PUBLIC = path.join(ROOT, 'public');

function makeClassList() { const s = new Set(); return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), toggle: (c, f) => { if (f) s.add(c); else s.delete(c); }, contains: (c) => s.has(c) }; }
function fakeEl() { return { classList: makeClassList(), style: {}, innerHTML: '', textContent: '', value: '', setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, hasAttribute() { return false; }, appendChild() {}, removeChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }, focus() {}, scrollIntoView() {}, dispatchEvent() { return true; }, contains() { return false; } }; }
const documentEl = { readyState: 'loading', documentElement: Object.assign(fakeEl(), { classList: makeClassList() }), body: fakeEl(), head: fakeEl(), addEventListener() {}, removeEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, createElement: fakeEl, dispatchEvent() { return true; } };
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; };
const sandbox = { console, URL, URLSearchParams, JSON, Math, Date, Promise, Object, Array, String, Number, Boolean, Map, Set, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, Error, TypeError, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout, document: documentEl, location: { protocol: 'http:', host: 'localhost', origin: 'http://localhost', pathname: '/', search: '', hash: '', href: 'http://localhost/' }, history: { pushState() {}, replaceState() {} }, localStorage: store(), sessionStorage: store(), navigator: { userAgent: 'x', language: 'zh' }, performance: { now: () => 0 }, fetch: () => new Promise((r) => setTimeout(() => r({ ok: true, status: 200, json: () => Promise.resolve({}) }), 0)), WebSocket: class { send() {} close() {} }, Audio: class { play() { return Promise.resolve(); } pause() {} addEventListener() {} }, AudioContext: undefined, webkitAudioContext: undefined, crypto: { getRandomValues: (a) => a }, CustomEvent: class { constructor(t) { this.type = t; } }, Event: class { constructor(t) { this.type = t; } }, MutationObserver: class { observe() {} disconnect() {} } };
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(JS_DIR, 'app.bundle.js'), 'utf8'), sandbox, { filename: 'app.bundle.js' });

function idsIn(html) {
  const set = new Set();
  const re = /\bid\s*=\s*["']([^"']+)["']/g;
  let m; while ((m = re.exec(html))) set.add(m[1]);
  return set;
}
function stripShell(html) {
  let s = html;
  s = s.replace(/<header[^>]*class="nav"[\s\S]*?<\/header>/, '');
  s = s.replace(/<footer[^>]*>[\s\S]*?<\/footer>/, '');
  s = s.replace(/<div[^>]*id="toast"[\s\S]*?<\/div>/, '');
  s = s.replace(/<script[\s\S]*?<\/script>/g, '');
  return s;
}

const pages = [
  ['home', 'index.html'], ['lobby', 'lobby.html'], ['gallery', 'gallery.html'],
  ['tournaments', 'tournaments.html'], ['tournament', 'tournament.html'],
  ['profile', 'profile.html'], ['review', 'review.html'], ['play', 'play.html'], ['admin', 'admin.html'],
];

let bad = 0;
for (const [view, file] of pages) {
  const v = sandbox.Views[view];
  const renderHtml = v && v.render ? v.render({ id: '1', room: 'r', tab: 'records' }) : '';
  const srcPath = path.join(PUBLIC, file);
  const srcHtml = fs.existsSync(srcPath) ? stripShell(fs.readFileSync(srcPath, 'utf8')) : '';
  const want = idsIn(srcHtml);
  const got = idsIn(renderHtml);
  const missing = [...want].filter((x) => !got.has(x));
  const extra = [...got].filter((x) => !want.has(x));
  if (missing.length) { bad++; console.log(`✗ ${view} (${file}) render 缺失 id ${missing.length} 个: ${missing.join(', ')}`); }
  else console.log(`✓ ${view} (${file}) 原主体 ${want.size} 个 id 全部保留${extra.length ? `（额外 ${extra.length} 个：${extra.join(',')}）` : ''}`);
}
console.log(bad ? `\n${bad} 页存在 id 缺失 —— 可能丢内容！` : '\n全部页面 id 完整 ✓ 功能未丢失');
process.exit(bad ? 1 : 0);
