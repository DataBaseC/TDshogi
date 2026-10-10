/**
 * bundle.test.js — SPA 单文档 bundle 的验收
 *
 * SPA 形态（2026-10-09）：`app.html` 只加载 `app.bundle.js`（由 scripts/pack.js 从散源文件拼接）。
 * 验收要点：
 *   1. app.html 只有一个 `<script src="js/app.bundle.js">`；
 *   2. bundle 内容 = 源脚本**按 APP 清单顺序逐字节拼接**（没有增删改，合并即搬家）；
 *   3. **功能不回归**：把源文件按 SPA_ORDER 逐个跑进 sandbox，关键全局与 Views 仍到位；
 *   4. 重复构建幂等（同一输入必得同一输出）。
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { makeSandbox, loadPage, PUBLIC, ROOT, SPA_ORDER } = require('./helpers/page');

const JS_DIR = path.join(PUBLIC, 'js');
const BUNDLE = path.join(JS_DIR, 'app.bundle.js');

/** 与 scripts/pack.js 的 build() 同逻辑：段间单个 "\n"，末尾不补 */
function buildBundle(order) {
  const segs = order.map((name) => {
    const src = fs.readFileSync(path.join(JS_DIR, name));
    const marker = Buffer.from(`/* ==== js/${name} ==== */\n`, 'utf8');
    return Buffer.concat([marker, src]);
  });
  return Buffer.concat(segs.flatMap((seg, i) => (i === 0 ? [seg] : [Buffer.from('\n'), seg])));
}

let hasBundle = false;
before(() => {
  hasBundle = fs.existsSync(BUNDLE);
  if (!hasBundle) {
    // 如果 bundle 不存在，先构建一次（等价于 npm run pack app）
    fs.writeFileSync(BUNDLE, buildBundle(SPA_ORDER));
  }
});

after(() => {
  // 不删 bundle：它应该是仓库的一部分或由 pack 生成
});

test('app.html 只加载一个 script（js/app.bundle.js）', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'app.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.strictEqual(scripts.length, 1, 'SPA 形态下 app.html 应只有 1 个 <script>');
  assert.strictEqual(scripts[0], 'js/app.bundle.js');
});

test('bundle 内容 = 源脚本按 SPA_ORDER 逐字节拼接', () => {
  const got = fs.readFileSync(BUNDLE);
  const want = buildBundle(SPA_ORDER);
  assert.ok(got.equals(want), 'app.bundle.js 应与源码按序拼接逐字节一致');
  // 每个源文件都应有边界注释
  for (const name of SPA_ORDER) {
    assert.ok(got.includes(Buffer.from(`/* ==== js/${name} ==== */`)), `bundle 应含 js/${name} 的边界注释`);
  }
});

test('功能不回归：源文件按序加载后关键全局与 Views 到位', async () => {
  const ignore = () => {};
  process.on('unhandledRejection', ignore);
  try {
    const sandbox = makeSandbox();
    const rs = loadPage(sandbox, 'app.html');
    const bad = rs.find((r) => !r.ok);
    assert.ok(!bad, `加载 js/${bad && bad.file} 失败：${bad && bad.error && bad.error.message}`);
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
    // 全局单例
    for (const g of ['NAV', 'API', 'Router', 'Sound', 'Views']) {
      assert.ok(sandbox[g], `window.${g} 应存在`);
    }
    // 全部 View 注册
    const views = sandbox.Views;
    for (const v of ['home', 'lobby', 'gallery', 'tournaments', 'tournament', 'profile', 'review', 'play', 'admin']) {
      assert.ok(views[v], `Views.${v} 应注册`);
    }
  } finally {
    process.off('unhandledRejection', ignore);
  }
});

test('构建幂等：同一输入两次构建结果一致', () => {
  const a = buildBundle(SPA_ORDER);
  const b = buildBundle(SPA_ORDER);
  assert.ok(a.equals(b), '构建应幂等');
});
