/**
 * admin-tabs.test.js — 管理后台 SPA 形态下的**跨模块装配**回归。
 *
 * SPA 形态：admin 拆成 `AdminParts.{shell,records,users,audit,tournaments,moderation,console,items}`
 * 子模块（各自 `{ mount, unmount }`），由 `Views.admin` 统一驱动。
 * 这里断言：① 所有子模块都挂在 `AdminParts` 上；② 每个子模块有 `mount`/`unmount`。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { makeSandbox, loadPage } = require('./helpers/page');

const PARTS = ['shell', 'records', 'users', 'audit', 'tournaments', 'moderation', 'console', 'items'];

function load() {
  const sandbox = makeSandbox();
  const rs = loadPage(sandbox, 'app.html');
  const bad = rs.find((r) => !r.ok);
  assert.ok(!bad, `加载 js/${bad && bad.file} 失败：${bad && bad.error && bad.error.message}`);
  return sandbox;
}

test('admin：8 个子模块都已装配（AdminParts.* 存在）', () => {
  const s = load();
  assert.ok(s.AdminParts, 'window.AdminParts 应存在');
  for (const p of PARTS) {
    assert.ok(s.AdminParts[p], `AdminParts.${p} 应由对应脚本提供`);
    assert.ok(typeof s.AdminParts[p].mount === 'function', `AdminParts.${p}.mount 应为函数`);
    assert.ok(typeof s.AdminParts[p].unmount === 'function', `AdminParts.${p}.unmount 应为函数`);
  }
});

test('admin：Views.admin 已注册且有 render/mount/unmount', () => {
  const s = load();
  assert.ok(s.Views && s.Views.admin, 'Views.admin 应注册');
  assert.ok(typeof s.Views.admin.render === 'function', 'Views.admin.render 应为函数');
  assert.ok(typeof s.Views.admin.mount === 'function', 'Views.admin.mount 应为函数');
  assert.ok(typeof s.Views.admin.unmount === 'function', 'Views.admin.unmount 应为函数');
});
