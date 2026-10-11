'use strict';
/**
 * profile-view.test.js — 个人页「换头像入口移除」与「装扮头像显示」回归（2026-10-11）
 *
 * 问题5：个人页的「换头像」按钮/选择器应整体移除（头像改到「装扮」页统一管理，游客不再能换）。
 * 问题6：个人页头像应显示**当前身份缓存的头像**（含装扮装备的头像），不能因为 SPA 切页
 *        （hello 只发过一次）而回落成默认字形。
 *
 * 这里做两层：① `profile.render()` 的 HTML 断言；② 源码契约断言（myAvatar 的初始化来源）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { makeSandbox, loadPage, PAGES, PUBLIC } = require('./helpers/page');

const tick = () => new Promise((r) => setImmediate(r));

function loadApp() {
  const sandbox = makeSandbox();
  const html = Object.keys(PAGES)[0]; // SPA 单文档
  const results = loadPage(sandbox, html);
  for (const r of results) {
    assert.ok(r.ok, `加载 js/${r.file} 抛错：${r.error && r.error.message}`);
  }
  return sandbox;
}

test('问题5：profile 页不再有「换头像」按钮 / 选择器', async () => {
  const sandbox = loadApp();
  await tick();
  const View = sandbox.Views && sandbox.Views.profile;
  assert.ok(View && typeof View.render === 'function', 'Views.profile 应已注册');
  const html = View.render();
  assert.ok(!/btnPickAvatar/.test(html), '不应再有「换头像」按钮');
  assert.ok(!/avatarPicker/.test(html), '不应再有头像选择器面板');
  assert.ok(!/id="avatarOptions"/.test(html), '不应再有头像候选网格');
  // 头像显示位必须保留（问题6 的落点）
  assert.ok(/id="avatar"/.test(html), '身份卡头像位应保留');
  assert.ok(/id="accountAvatar"/.test(html), '账号卡头像位应保留');
});

test('问题6：myAvatar 以当前身份缓存的头像初始化（SPA 切页不丢装扮头像）', () => {
  const src = fs.readFileSync(path.join(PUBLIC, 'js', 'profile.js'), 'utf8');
  assert.ok(/let myAvatar = \(guest && guest\.avatar\) \|\| null;/.test(src),
    'myAvatar 初值应取 guest.avatar（只等 hello 会在 SPA 切页时拿不到头像）');
  // 装备头像后仍能把新头像刷到头像位（avatar_updated 订阅）
  assert.ok(/sub\('avatar_updated'/.test(src), '应保留 avatar_updated 订阅以刷新头像');
  assert.ok(/paintAvatar\(myAvatar\)/.test(src), 'renderAvatars 应用 myAvatar 画头像');
});
