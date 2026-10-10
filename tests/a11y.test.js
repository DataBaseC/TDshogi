/**
 * a11y.test.js — §6.3 可访问性的验收（2026-09-28）
 *
 * 分两层验：
 *  - **静态**：弹层语义（role/aria）、棋盘 grid 部件、以及"鼠标与键盘共用同一处走子逻辑"
 *    这个结构约束（防止将来有人只改一路）。
 *  - **行为**：把 `a11y.js` 跑进带桩 document 的环境，真调 onDialogOpen/Close + 真发一个 Esc，
 *    断言焦点移入/归还与关闭回调。
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { makeSandbox, PUBLIC } = require('./helpers/page');

const read = (p) => fs.readFileSync(path.join(PUBLIC, p), 'utf8');

// ─────────────── 静态 ───────────────

test('§6.3 弹层：核心弹层具备 role="dialog" + aria-modal + aria-label', () => {
  // SPA 形态：弹层 HTML 在 View 模块的模板字符串里（不再有独立 .html 页面）
  const cases = [
    ['js/play.js', 'promoteOverlay'],
    ['js/admin.js', 'userDetailModal'],
    ['js/tournaments.js', 'createModal'],
  ];
  for (const [file, id] of cases) {
    const src = read(file);
    const m = new RegExp(`<[^>]*id="${id}"[^>]*>`).exec(src);
    assert.ok(m, `${file} 应含 #${id}`);
    const tag = m[0];
    assert.match(tag, /role="dialog"/, `${file} #${id} 缺 role="dialog"`);
    assert.match(tag, /aria-modal="true"/, `${file} #${id} 缺 aria-modal`);
    assert.match(tag, /aria-label="[^"]+"/, `${file} #${id} 缺 aria-label`);
  }
});

test('§6.3 键盘：棋盘容器是可聚焦的 grid 部件，格子是 gridcell 且有 id', () => {
  const fb = read('js/freeboard.js');
  assert.match(fb, /setAttribute\('role', 'grid'\)/, 'freeboard 应把棋盘标为 role=grid');
  assert.match(fb, /setAttribute\('tabindex', '0'\)/, '棋盘应可 Tab 聚焦');
  assert.match(fb, /addEventListener\('keydown'/, '棋盘应监听 keydown');
  const bd = read('js/board.js');
  assert.match(bd, /setAttribute\('role', 'gridcell'\)/, '格子应为 gridcell');
  assert.match(bd, /cell\.id = /, '格子应有 id（供 aria-activedescendant 引用）');
});

test('§6.3 键盘：鼠标点击与键盘 Enter 共用 _activateSq（杜绝两套走子逻辑分叉）', () => {
  const dnd = read('js/freeboard-dnd.js');
  assert.match(dnd, /function _activateSq\(/, '应抽出 _activateSq');
  assert.match(dnd, /this\._activateSq\(cell\.dataset\.sq\)/, '点击应走 _activateSq');
  assert.match(dnd, /this\._activateSq\(this\._kbSq\)/, '键盘 Enter 也应走 _activateSq');
  assert.match(dnd, /ArrowUp|ArrowDown|ArrowLeft|ArrowRight/, '应支持方向键移动');
});

// ─────────────── 行为（A11y 模块） ───────────────

function loadA11y() {
  const sandbox = makeSandbox();
  const handlers = {};
  const doc = {
    activeElement: null,
    addEventListener: (t, fn) => { (handlers[t] = handlers[t] || []).push(fn); },
    removeEventListener: () => {},
    querySelector: () => null,
    __fire: (t, ev) => { (handlers[t] || []).forEach((fn) => fn(ev)); },
  };
  sandbox.document = doc;   // 覆盖脚手架默认桩：本测试需要"真的"注册 keydown
  sandbox.window = sandbox;
  vm.runInContext(read('js/a11y.js'), sandbox, { filename: 'public/js/a11y.js' });
  return { sandbox, doc };
}

function stubEl() {
  const el = { _attrs: {}, __focused: 0 };
  el.setAttribute = (k, v) => { el._attrs[k] = String(v); };
  el.getAttribute = (k) => (k in el._attrs ? el._attrs[k] : null);
  el.querySelector = () => null;
  el.querySelectorAll = () => [];
  el.focus = () => { el.__focused++; };
  return el;
}

test('§6.3 A11y：打开弹层 → aria-hidden=false 且焦点移入', () => {
  const { sandbox } = loadA11y();
  const el = stubEl();
  sandbox.A11y.onDialogOpen(el);
  assert.equal(el.getAttribute('aria-hidden'), 'false');
  assert.ok(el.__focused >= 1, '焦点应移入弹层');
  assert.ok(sandbox.A11y.hasOpenDialog());
});

test('§6.3 A11y：Esc 触发该弹层注册的 onClose', () => {
  const { sandbox, doc } = loadA11y();
  const el = stubEl();
  let closed = 0;
  sandbox.A11y.onDialogOpen(el, { onClose: () => { closed++; } });
  doc.__fire('keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(closed, 1, 'Esc 应调用 onClose');
});

test('§6.3 A11y：关闭弹层 → aria-hidden=true 且焦点归还触发者', () => {
  const { sandbox } = loadA11y();
  const trigger = stubEl();
  sandbox.document.activeElement = trigger;   // 打开前的焦点所在
  const el = stubEl();
  sandbox.A11y.onDialogOpen(el);
  sandbox.A11y.onDialogClose(el);
  assert.equal(el.getAttribute('aria-hidden'), 'true');
  assert.ok(trigger.__focused >= 1, '焦点应归还触发者');
  assert.ok(!sandbox.A11y.hasOpenDialog());
});

test('§6.3 A11y：未注册 onClose 的弹层，Esc 不会误关（如升变选择）', () => {
  const { sandbox, doc } = loadA11y();
  const el = stubEl();
  sandbox.A11y.onDialogOpen(el);              // 不传 onClose
  let threw = false;
  try { doc.__fire('keydown', { key: 'Escape', preventDefault() {} }); } catch (_) { threw = true; }
  assert.ok(!threw, 'Esc 对无 onClose 的弹层应安静无操作');
  assert.ok(sandbox.A11y.hasOpenDialog(), '弹层仍应处于打开状态');
});
