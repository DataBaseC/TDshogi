#!/usr/bin/env node
/**
 * audit-apis.js — 「静默失效」审计器（开发期）
 *
 * 专抓这类 bug：`if (X && X.someMethod) X.someMethod()` —— 若 X 从未导出 someMethod，
 * 守卫静默短路，功能悄悄失效、零报错（实例：boot.js 曾误用 Settings.reapplyAll）。
 *
 * 做法：先剥注释，再对每个「对象字面量」命名空间比对「被调用方法 vs 导出表」，
 * 另做结构性体检（View 生命周期、单 WS、无整页 reload）。注释里的示例调用不计入。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', 'public', 'js');
const files = fs.readdirSync(JS).filter((f) => f.endsWith('.js') && !f.endsWith('.bundle.js'));

/** 剥掉 // 行注释 与 块注释（尊重字符串/模板字面量/正则字面量） */
function stripComments(src) {
  let out = '', i = 0, prevSig = '';
  const REGEX_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>', '\n', '']);
  while (i < src.length) {
    const c = src[i], c2 = src[i + 1];
    if (c === '/' && c2 === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') { out += src[i]; i++; } out += src[i]; i++; }
      out += q; i++; prevSig = q; continue;
    }
    if (c === '/' && REGEX_AFTER.has(prevSig)) {
      // 正则字面量：跳到未转义的 /（忽略字符类 [...] 内的 /），再吃 flags
      out += c; i++;
      let inClass = false;
      while (i < src.length) {
        const r = src[i];
        if (r === '\\') { out += r + (src[i + 1] || ''); i += 2; continue; }
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) { out += r; i++; break; }
        else if (r === '\n') break; // 安全：没找到闭合就当不是正则
        out += r; i++;
      }
      while (i < src.length && /[a-z]/.test(src[i])) { out += src[i]; i++; }
      prevSig = '/'; continue;
    }
    out += c; i++;
    if (!/\s/.test(c)) prevSig = c;
  }
  return out;
}

const raw = {};
for (const f of files) raw[f] = fs.readFileSync(path.join(JS, f), 'utf8');
const sources = {};
for (const f of files) sources[f] = stripComments(raw[f]);

const NAMESPACES = {
  Settings: 'global.Settings', Sound: 'global.Sound', UI: 'global.UI', NAV: 'global.NAV',
  ApiUtils: 'global.ApiUtils', Router: 'global.Router', A11y: 'global.A11y',
  PieceKinds: 'global.PieceKinds', PlayClock: 'window.PlayClock', PlayChat: 'window.PlayChat',
  PlayDemo: 'window.PlayDemo', PlayViews: 'global.PlayViews',
};

function extractObjectKeys(src, assignPrefix) {
  const re = new RegExp(assignPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*\\{');
  const m = re.exec(src);
  if (!m) return null;
  let depth = 0, end = -1;
  for (let j = m.index + m[0].length - 1; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = j; break; } }
    else if (c === '"' || c === "'" || c === '`') { const q = c; j++; while (j < src.length && src[j] !== q) { if (src[j] === '\\') j++; j++; } }
  }
  if (end < 0) return null;
  const body = src.slice(m.index + m[0].length, end);
  const parts = [];
  let d = 0, cur = '';
  for (const ch of body) {
    if ('([{'.includes(ch)) d++;
    else if (')]}'.includes(ch)) d--;
    if (ch === ',' && d === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  const keys = [];
  for (const p of parts) {
    const seg = p.trim();
    if (!seg) continue;
    // 关键：get/set 只有「后跟空格」才算访问器前缀；`setPhase` 这种 shorthand 整体是名
    const km = seg.match(/^(?:(?:get|set)\s+)?([A-Za-z_$][\w$]*)\s*(?:\(|:|,|$)/);
    if (km) keys.push(km[1]);
  }
  return keys;
}

function extractClassMethods(src, clsName) {
  const re = new RegExp('class\\s+' + clsName + '\\s*\\{');
  const m = re.exec(src);
  if (!m) return [];
  let depth = 0, end = -1;
  for (let j = m.index + m[0].length - 1; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  return [...src.slice(m.index, end).matchAll(/(?:^|\s)(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g)]
    .map((x) => x[1]).filter((n) => !['constructor', clsName, 'if', 'for', 'while', 'switch', 'catch'].includes(n));
}

const exported = {};
for (const [name, prefix] of Object.entries(NAMESPACES)) {
  for (const f of files) {
    const keys = extractObjectKeys(sources[f], prefix);
    if (keys) { exported[name] = new Set(keys); break; }
  }
}
exported.API = new Set(extractClassMethods(sources['api.js'], 'Client'));

const used = {};
for (const name of Object.keys(exported)) used[name] = new Map();
for (const f of files) {
  for (const name of Object.keys(exported)) {
    const re = new RegExp('\\b(?:global|window)\\.' + name + '\\.([A-Za-z_$][\\w$]*)\\s*\\(', 'g');
    let m;
    while ((m = re.exec(sources[f]))) {
      if (!used[name].has(m[1])) used[name].set(m[1], []);
      used[name].get(m[1]).push(f);
    }
  }
}

let bad = 0;
console.log('== API 面审计：被调用但未导出的方法（静默失效高危）==');
for (const name of Object.keys(exported)) {
  const missing = [...used[name].keys()].filter((m) => !exported[name].has(m));
  for (const m of missing) { bad++; console.log(`  ✗ ${name}.${m}() 被 ${[...new Set(used[name].get(m))].join(',')} 调用，但 ${name} 未导出它`); }
}
if (!bad) console.log('  ✓ 无 —— 所有 X.method() 调用都有对应导出');

console.log('\n== 结构性体检（已剥注释）==');
function check(name, cond, extra) { console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? ' — ' + extra : '')); if (!cond) bad++; }
const viewNames = ['home', 'lobby', 'gallery', 'tournaments', 'tournament', 'profile', 'review', 'play', 'admin'];
const all = Object.values(sources).join('\n');
check('9 个 View 都注册', viewNames.every((n) => new RegExp('global\\.Views\\.' + n + '\\s*=').test(all)));
const reloads = files.filter((f) => /location\.reload\s*\(/.test(sources[f]));
check('无 location.reload', reloads.length === 0, reloads.join(','));
const pageNav = files.map((f) => { const m = sources[f].match(/location\.href\s*=\s*[`'"][^`'"]*\.html/g); return m ? f + '(' + m.length + ')' : null; }).filter(Boolean);
check('无 location.href 整页跳 .html', pageNav.length === 0, pageNav.join(','));
const connects = files.filter((f) => /(?:global\.)?API\.connect\s*\(|api\.connect\s*\(/.test(sources[f]));
check('仅 boot.js 建 WS', connects.join(',') === 'boot.js' || connects.length === 0, connects.join(','));
const renderNavs = files.filter((f) => !['nav.js', 'boot.js'].includes(f) && /\.renderNav\s*\(/.test(sources[f]));
check('页面不调 NAV.renderNav', renderNavs.length === 0, renderNavs.join(','));

console.log(`\n结果：${bad ? bad + ' 处需人工确认' : '全部通过 ✓'}`);
process.exit(bad ? 1 : 0);
