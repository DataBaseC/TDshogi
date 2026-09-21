'use strict';
/**
 * tests/security.test.js — 2026-09-21 安全审查（建议 v1.4.5）的回归用例
 *
 * 每条对应报告里一个**已实测复现**的漏洞。断言的是"修好之后的行为"，
 * 并且**尽量配一条正向对照**——只验"坏输入被拒"很容易把功能一起关掉还不知道
 * （例如 P0-3 的迁移开关：拦掉劫持的同时，正常游客升级必须照常工作）。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

// ⚠️ 必须在 require storage 之前设定数据目录（同 cleanup.test.js）：
// storage 首次 getDb() 就把路径定死了。
// ⚠️ 目录名带 pid：**不要**在加载时递归删除旧目录 —— 本环境的 safe-delete 钩子会拦下
// `fs.rmSync(dir, {recursive:true})` 并让整个测试文件加载失败（cleanup.test.js 那套写法在本机跑不通）。
const TMP = path.join(__dirname, '..', `.tmpdata-security-${process.pid}`);
process.env.DATA_DIR = TMP;
fs.mkdirSync(TMP, { recursive: true });
// 密钥全部走环境变量，避免用例之间互相影响（"未配置时自动生成"单独有一条用例）
process.env.SESSION_SECRET = 'unit-test-session-secret';
process.env.ADMIN_SECRET = 'unit-test-admin-secret';
process.env.ADMIN_PASSWORD = 'unit-test-admin-pw';
process.env.ADMIN_ENTRY_KEY = 'unit-test-entry-key';

const accounts = require('../src/accounts');
const admin = require('../src/admin');
const auth = require('../src/auth');
// ⚠️ 这里**不要** require `src/http/middleware`：它经 `context` 构造了 Protocol 实例
// （内含定时器），会让 `node --test` 跑完用例后**一直不退出**。
// 后台门禁（P1-4）属 HTTP 层，已放到 `scripts/e2e-security.js` 上验。

const ACCOUNTS_PATH = require.resolve('../src/accounts');

test('P0-1 令牌校验不会被多字节签名打崩（原先抛 RangeError → 整个进程退出）', () => {
  const r = accounts.register('安全测试甲', 'pw1234');
  assert.strictEqual(r.ok, true);
  const token = accounts.issueToken(r.account.id);
  // 正向对照：合法令牌必须照常通过
  assert.strictEqual(accounts.verifyToken(token), r.account.id);

  // 攻击载荷：签名段塞 32 个 emoji —— UTF-16 长度 64（等于期望签名长度，长度校验通过），
  // UTF-8 字节数 128（≠ 64）→ 旧实现的 timingSafeEqual 抛 RangeError。
  // ⚠️ 这个抛出点在 WS 握手回调里，没人接 → 进程退出、全部在线对局断线。
  const [aid, ts] = token.split('.');
  const evil = `${aid}.${ts}.${'😀'.repeat(32)}`;
  assert.doesNotThrow(() => accounts.verifyToken(evil), '绝不能抛出');
  assert.strictEqual(accounts.verifyToken(evil), null);

  // 其它畸形形态同样不许抛
  const others = ['', 'a.b.c', `${aid}.${ts}.${'a'.repeat(63)}`,
    `${aid}.${ts}.${'Z'.repeat(64)}`, `${aid}.${ts}.👻`, `${aid}.${ts}.${'0'.repeat(64)}`];
  for (const bad of others) {
    assert.doesNotThrow(() => accounts.verifyToken(bad), `不能抛：${JSON.stringify(bad)}`);
    assert.strictEqual(accounts.verifyToken(bad), null, `必须拒绝：${JSON.stringify(bad)}`);
  }
});

test('P0-1 同款：admin.verify 对多字节签名也不抛（同源写法，一并收紧）', () => {
  const t = admin.login('unit-test-admin-pw');
  assert.strictEqual(t.ok, true, '正向：正确口令应能登录');
  assert.strictEqual(admin.verify(t.token), true, '正向：合法 token 通过');
  const evil = `admin:${Date.now()}.${'😀'.repeat(32)}`;
  assert.doesNotThrow(() => admin.verify(evil));
  assert.strictEqual(admin.verify(evil), false);
  assert.strictEqual(admin.verify('admin:1.' + '😀'.repeat(32)), false);
});

test('P0-2 未配置 SESSION_SECRET 时**不复用源码常量**，而是随机生成并持久化', () => {
  const saved = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  const storage = require('../src/storage');
  // ⚠️ 本项目里 `readJson/writeJson` 走的是**单一 SQLite 的 kv 表**，不是磁盘上的 JSON 文件
  // （以为会多出 data/secret.json 文件是错的——审查报告给的建议稿是文件式，这里按本项目的存储层来）。
  storage.writeJson('secret.json', null); // 清掉可能存在的旧值
  assert.strictEqual(storage.readJson('secret.json', null), null, '前置：尚无密钥记录');

  delete require.cache[ACCOUNTS_PATH];
  require(ACCOUNTS_PATH); // 重新加载 → 走"没有环境变量"的分支
  const rec1 = storage.readJson('secret.json', null);
  assert.ok(rec1 && typeof rec1.key === 'string', '应写入随机会话密钥记录');
  assert.match(rec1.key, /^[0-9a-f]{64}$/, '应是 32 字节随机 hex');
  assert.notStrictEqual(rec1.key, 'tdshogi_session_secret_change_me', '绝不能是源码里的默认常量');

  // ⚠️ 再加载一次必须**复用**同一把密钥：否则每次重启都会让全部旧令牌失效
  delete require.cache[ACCOUNTS_PATH];
  require(ACCOUNTS_PATH);
  const rec2 = storage.readJson('secret.json', null);
  assert.strictEqual(rec2.key, rec1.key, '重新加载必须复用已持久化的密钥');

  process.env.SESSION_SECRET = saved;
  delete require.cache[ACCOUNTS_PATH]; // 还原模块，别影响后续用例
  require(ACCOUNTS_PATH);
});

test('P0-3 拿别人的账号 id 当 guestId 注册：不迁移任何东西（且不影响正常升级）', () => {
  const victim = accounts.register('受害者乙', 'pw1234');
  assert.strictEqual(victim.ok, true);
  const before = auth.getSessionRaw(victim.account.id);
  assert.ok(before, '受害者名下有会话');

  // 攻击：用受害者的公开 id 当 guestId 注册
  const attacker = accounts.register('攻击者丙', 'pw1234', victim.account.id);
  assert.strictEqual(attacker.ok, true, '注册本身仍应成功（只是拒绝迁移）');
  const after = auth.getSessionRaw(victim.account.id);
  assert.ok(after, '受害者的会话必须仍在自己名下');
  assert.strictEqual(after.name, before.name, '受害者会话内容未被改动');
  assert.notStrictEqual(attacker.account.id, victim.account.id);

  // 正向对照：真实的游客 id 仍能正常迁移（别把功能一起关掉）
  const guestId = 'fedcba9876543210fedcba98';
  auth.upsertSession(guestId, '游客丁');
  const upgraded = accounts.register('正常升级戊', 'pw1234', guestId);
  assert.strictEqual(upgraded.ok, true);
  // ⚠️ 断言要挑**真实可观测**的东西：
  //  - `getAccount()` 走的是 `publicInfo`，**不含 `guestId`**（写成 `.guestId` 恒为 undefined ✗）；
  //  - 会话是"复制"而不是"移动"，且 `register` 已先用用户名建了会话，
  //    `migrateGuestData` 第 3 步会跳过复制 —— 所以不要断言"昵称变成游客昵称"。
  assert.ok(auth.getSessionRaw(upgraded.account.id), '账号名下有会话');
  assert.strictEqual(accounts.verifyToken(upgraded.token || accounts.issueToken(upgraded.account.id)),
    upgraded.account.id, '新账号的令牌可正常签发与校验');
});

test('P0-3 补充：劫持尝试不得改动受害者的**评级资产**', () => {
  // 上面的用例验的是"会话没被搬走"，这里补最直接的资产：评级表。
  // `migrateGuestData` 第 1 步会把 `ratings[guestId]` 搬到 accountId —— 劫持成功的话
  // 受害者会被清成默认分。断言前后**逐字段相等**即可，不必知道具体分值。
  const ratings = require('../src/ratings');
  const owner = accounts.register('资产拥有者己', 'pw1234');
  const before = ratings.profile(owner.account.id);
  accounts.register('冒名者庚', 'pw1234', owner.account.id); // 拿受害者 id 当来源
  const after = ratings.profile(owner.account.id);
  assert.deepStrictEqual(after, before, '受害者的评级档案必须分毫未动');
  assert.strictEqual(after.games, 0, '受害者仍是 0 局（没有被搬走战绩）');
});
