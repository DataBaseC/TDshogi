'use strict';
/**
 * tests/guest-identity.test.js — B1 游客持有证明 / B2 迁移凭据（2026-09 优化）
 *
 * 背景：会话 id（guestId / 账号 id）是**公开数据**，任何拿到 id 的人若无需额外凭据就能
 * 改名/换头像/迁移数据，就等于身份可被冒用。本文件固化"修好之后"的行为：
 *  - 首次连接携带的 `key` 绑定为会话 secret（TOFU），此后改名/换头像必须带对；
 *  - 游客升级账号时，迁移必须携带正确 `migrationKey`（已绑定时）；
 *  - 未绑定（老会话/账号）走兼容放行——别为了安全把功能一起关掉。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

// ⚠️ 必须在 require storage 之前设定数据目录（storage 首次 getDb() 就把路径定死了）
const TMP = path.join(require('node:os').tmpdir(), `.tmpdata-guest-${process.pid}`);
process.env.DATA_DIR = TMP;
fs.mkdirSync(TMP, { recursive: true });
process.env.SESSION_SECRET = 'guest-identity-test-session-secret-0001';
process.env.ADMIN_SECRET = 'guest-identity-test-admin-secret-000001';
process.env.ADMIN_PASSWORD = 'guest-identity-test-admin-pw';

const auth = require('../src/auth');
const accounts = require('../src/accounts');
const ratings = require('../src/ratings');

test('B1 genKey：产出 64 位小写 hex，且每次不同', () => {
  const k = auth.genKey();
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(auth.genKey(), k);
});

test('B1 首次携带 key 即绑定 secret（TOFU）；已绑定不可被覆盖，未绑定放行', () => {
  const guestId = 'a1b2c3d4e5f6a7b8c9d0e1f2';
  const key = auth.genKey();
  const s1 = auth.identify(guestId, { key });
  assert.strictEqual(s1.secret, key, '首次携带合法 key 应绑定为 secret');

  assert.deepStrictEqual(auth.verifyKey(guestId, key), { ok: true, bound: true });
  assert.deepStrictEqual(auth.verifyKey(guestId, auth.genKey()), { ok: false, bound: true });
  assert.deepStrictEqual(auth.verifyKey(guestId, null), { ok: false, bound: true });
  assert.deepStrictEqual(auth.verifyKey(guestId, '😀'.repeat(32)), { ok: false, bound: true }, '畸形 key 不抛异常');

  // 再次 identify 带不同 key，不得覆盖已绑定的 secret
  const s2 = auth.identify(guestId, { key: auth.genKey() });
  assert.strictEqual(s2.secret, key, '已绑定 secret 不可被后续请求覆盖');

  // 未绑定会话：verifyKey 放行（bound=false）
  const g2 = 'b2c3d4e5f6a7b8c9d0e1f2a3';
  auth.identify(g2, {});
  assert.deepStrictEqual(auth.verifyKey(g2, null), { ok: true, bound: false });
});

test('B1 改名/换头像：已绑定必须带对 key（否则 AUTH_KEY），未绑定放行', () => {
  const guestId = 'c3d4e5f6a7b8c9d0e1f2a3b4';
  const key = auth.genKey();
  auth.identify(guestId, { key });

  const bad = auth.rename(guestId, '新名字', auth.genKey());
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.code, 'AUTH_KEY');
  const missing = auth.setAvatar(guestId, '🐯', null);
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(missing.code, 'AUTH_KEY');

  assert.strictEqual(auth.rename(guestId, '新名字', key).ok, true, '对 key 应放行');
  assert.strictEqual(auth.setAvatar(guestId, '🐯', key).ok, true, '对 key 应放行');

  // 未绑定会话（老数据 / 账号）：兼容放行
  const legacy = 'd4e5f6a7b8c9d0e1f2a3b4c5';
  auth.identify(legacy, {});
  assert.strictEqual(auth.rename(legacy, '老用户', null).ok, true, '未绑定应兼容放行');
});

test('B2 迁移凭据：已绑定游客，凭据不符则不迁移；凭据相符才迁移', () => {
  // —— 已绑定 + 错凭据 → 拒绝迁移（资产留在原游客名下）——
  const guestId = 'e5f6a7b8c9d0e1f2a3b4c5d6';
  const key = auth.genKey();
  auth.identify(guestId, { key });
  ratings.addPoints(guestId, 10);
  const before = ratings.profile(guestId);
  const wrong = accounts.register('B2拒绝', 'pw123456', guestId, auth.genKey());
  assert.strictEqual(wrong.ok, true, '注册本身应成功（只是拒绝迁移）');
  assert.deepStrictEqual(ratings.profile(guestId), before, '凭据不符：资产分毫未动');

  // —— 已绑定 + 对凭据 → 迁移（资产转到账号名下）——
  const guestId2 = 'f6a7b8c9d0e1f2a3b4c5d6e7';
  const key2 = auth.genKey();
  auth.identify(guestId2, { key: key2 });
  ratings.addPoints(guestId2, 7);
  const g2before = ratings.profile(guestId2);
  const right = accounts.register('B2通过', 'pw123456', guestId2, key2);
  assert.strictEqual(right.ok, true);
  assert.deepStrictEqual(ratings.profile(right.account.id), g2before, '凭据相符：资产迁到账号名下');

  // —— 未绑定老会话：无凭据也迁移（兼容期）——
  const guestId3 = 'a7b8c9d0e1f2a3b4c5d6e7f8';
  auth.upsertSession(guestId3, '老游客');
  ratings.addPoints(guestId3, 3);
  const g3before = ratings.profile(guestId3);
  const legacy = accounts.register('B2兼容', 'pw123456', guestId3);
  assert.strictEqual(legacy.ok, true);
  assert.deepStrictEqual(ratings.profile(legacy.account.id), g3before, '未绑定老会话：无凭据也迁移（兼容期）');
});
