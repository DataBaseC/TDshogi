'use strict';
/**
 * auth.test.js — 身份/头像/持有证明（安全关键路径）
 *
 * 覆盖三类"出错就很严重"的行为：
 *  1. **头像白名单**：`setAvatar` 只认 `AVATARS ∪ extraAllowed`（道具头像走第 4 参）；
 *  2. **白名单兜底**：`identify` 会把乱写的头像回落，但**不能**误伤"已拥有的道具头像"
 *     （2026-10-03 修的那个 bug：道具头像一重连就被清）；
 *  3. **持有证明（TOFU）**：`verifyKey` 未绑定放行、绑定后必须带对 key。
 *
 * 依赖注入：用内存版 storage 桩替换 `src/storage`（沙箱没装 better-sqlite3），
 * 与仓库既有测试做法一致。
 */
const test = require('node:test');
const assert = require('node:assert');

const sp = require.resolve('../src/storage');
const mem = {};
require.cache[sp] = {
  id: sp, filename: sp, loaded: true,
  exports: {
    readJson: (n, fb) => (Object.prototype.hasOwnProperty.call(mem, n) ? mem[n] : (fb === undefined ? null : fb)),
    writeJson: (n, d) => { mem[n] = d; return true; },
    ensureDataDirs: () => {},
  },
};

const auth = require('../src/auth');
const items = require('../src/items');

test('AVATARS 非空且都是单字形（前端直接渲染它）', () => {
  assert.ok(Array.isArray(auth.AVATARS) && auth.AVATARS.length > 0);
  for (const g of auth.AVATARS) assert.strictEqual(typeof g, 'string');
});

test('setAvatar：白发名单外的字形被拒', () => {
  const id = auth.genId();
  const r = auth.setAvatar(id, '🦄', null, []);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /可选范围/);
});

test('setAvatar：白名单内的字形可设', () => {
  const id = auth.genId();
  assert.strictEqual(auth.setAvatar(id, auth.AVATARS[0], null).ok, true);
});

test('setAvatar：extraAllowed 放行道具字形', () => {
  const id = auth.genId();
  assert.strictEqual(auth.setAvatar(id, '🦄', null, ['🦄']).ok, true);
});

test('identify 不会重置「已拥有的道具头像」（回归：道具头像要留得住）', () => {
  const id = auth.genId();
  // ⚠️ 2026-10-12：`items.grant` 现在内联校验收件人（只发注册账号），本用例是**游客**会话，
  //    且要测的是「头像持久化」而非「发放校验」→ 直接铺库存数据，绕开业务层。
  require('../src/items/store').addItem(id, 'avatar-unicorn'); // 目录里的 🦄 头像道具
  assert.strictEqual(auth.setAvatar(id, '🦄', null, items.avatarOptionsFor(id)).ok, true);
  const s = auth.identify(id); // 下一次连接（此前这里会把头像打回派生字形）
  assert.strictEqual(s.avatar, '🦄');
});

test('identify 仍会把「乱写的」头像回落（白名单兜底没被削弱）', () => {
  const id = auth.genId();
  const s1 = auth.identify(id);
  mem[`sessions/${id}.json`] = { ...s1, avatar: '💩' }; // 模拟老数据 / 手改
  const s2 = auth.identify(id);
  assert.notStrictEqual(s2.avatar, '💩');
  assert.ok(auth.AVATARS.includes(s2.avatar));
});

test('verifyKey：未绑定放行；绑定后必须带对 key', () => {
  const id = auth.genId();
  const key = auth.genKey();
  assert.strictEqual(auth.verifyKey(id, key).bound, false, '首次（未绑定）不应判定为 bound');

  auth.identify(id, { key }); // 首次携带合法 key → 绑定持有证明（TOFU）
  const good = auth.verifyKey(id, key);
  assert.deepStrictEqual(good, { bound: true, ok: true });

  const bad = auth.verifyKey(id, 'f'.repeat(64));
  assert.strictEqual(bad.bound, true);
  assert.strictEqual(bad.ok, false, '绑错 key 必须判失败');
});
