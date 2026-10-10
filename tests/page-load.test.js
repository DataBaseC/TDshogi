/**
 * page-load.test.js — SPA 形态下「app.bundle 按序加载不抛错」的冒烟守护
 *
 * ⚠️ **为什么必须有它**：前端没有模块系统，靠 `public/js/*.js` 的**顺序**
 * 装配全局符号。拆文件最容易犯的三类错——加载顺序写反、注入没生效、
 * 引用了已搬走的符号——**症状全都是静默的**：页面照常渲染、控制台不报错，只是
 * "那个按钮点了没反应"。靠人逐个点页面来验，成本高且必然漏。
 *
 * SPA 形态（2026-10-09）：单一 `app.html` + `app.bundle.js`，所有页面 View 在同一文档内注册。
 * 这里按 `SPA_ORDER` 逐文件加载源码（不跑生成物），谁在**加载期**抛错就立刻报红；
 * 再断言关键全局与 Views 确实挂上了。
 * 运行期行为由 `play-views.test.js` / `e2e` / 人眼覆盖。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { makeSandbox, scriptsOf, loadPage, PAGES, PUBLIC, SPA_ORDER } = require('./helpers/page');

for (const [html, globals] of Object.entries(PAGES)) {
  test(`${html}：按脚本顺序加载不抛错，关键全局到位`, async () => {
    const ignore = () => {};
    process.on('unhandledRejection', ignore);
    try {
      const files = scriptsOf(html);
      assert.ok(files.length > 10, `${html} 应至少有几个脚本文件（SPA 单文档含全部 View）`);
      assert.ok(files.every((f) => fs.existsSync(path.join(PUBLIC, 'js', f))),
        `${html} 引用了不存在的脚本`);
      const sandbox = makeSandbox();
      for (const r of loadPage(sandbox, html)) {
        assert.ok(r.ok, `${html} 加载 js/${r.file} 时抛错：${r.error && r.error.message}\n`
          + '（多半是 脚本顺序、拆分注入、或引用了已搬走的符号）');
      }
      for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
      for (const g of globals) {
        assert.ok(sandbox[g], `${html} 加载完成后 window.${g} 应存在（缺它页面功能会静默失效）`);
      }
      // SPA 额外断言：全部 View 注册到 window.Views
      const views = sandbox.Views;
      assert.ok(views, 'window.Views 应存在');
      for (const v of ['home', 'lobby', 'gallery', 'tournaments', 'tournament', 'profile', 'review', 'play', 'admin']) {
        assert.ok(views[v], `Views.${v} 应注册`);
        assert.ok(typeof views[v].render === 'function', `Views.${v} 应有 render`);
      }
    } finally {
      process.off('unhandledRejection', ignore);
    }
  });
}

test('app.html 引用的 bundle 文件存在（静态）', () => {
  const src = fs.readFileSync(path.join(PUBLIC, 'app.html'), 'utf8');
  const scripts = [...src.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0, 'app.html 应至少有一个 <script>');
  for (const s of scripts) {
    assert.ok(fs.existsSync(path.join(PUBLIC, s)), `app.html 引用了缺失的 ${s}`);
  }
});

test('SPA_ORDER 覆盖 public/js/ 下全部 .js 文件（防漏注册）', () => {
  const allJs = fs.readdirSync(path.join(PUBLIC, 'js'))
    .filter((f) => f.endsWith('.js') && f !== 'app.bundle.js');
  const inOrder = new Set(SPA_ORDER);
  for (const f of allJs) {
    assert.ok(inOrder.has(f), `public/js/${f} 未列入 SPA_ORDER（漏注册 = 功能静默失效）`);
  }
});
