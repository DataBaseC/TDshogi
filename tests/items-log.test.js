'use strict';
/**
 * items-log.test.js — 发放流水与「内联收件人护栏」（2026-10-12 二轮补齐）
 *
 * 守四件事：
 *  ① **内联护栏**：`items.grant` / `items.addCoin` 自身必须拒绝游客与不存在的收件人 ——
 *     不再只靠 HTTP/CLI 入口拦（否则任何新调用者都会再造出孤儿键/游客键，即"发放不出去"的根因）；
 *  ② **流水记操作人**（`adminId`）—— 缺了它就无法对账/追责，只能拿时间戳去跟 adminAction 对齐；
 *  ③ **流水上限**（LOG_MAX）—— 只增不减会让 items.json 的整块重写成本持续恶化；
 *  ④ **key 唯一** —— `logSeq` 重启归零后不应覆盖已有流水。
 *
 * 与 items-store.test.js 同款：内存 storage 桩（不碰真库）。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const STORAGE_PATH = require.resolve(path.join(SRC_DIR, 'storage'));
const RATINGS_PATH = require.resolve(path.join(SRC_DIR, 'ratings'));

function load(seed) {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC_DIR + path.sep)) delete require.cache[key];
  }
  const mem = {};
  if (seed) for (const [k, v] of Object.entries(seed)) mem[k] = JSON.parse(JSON.stringify(v));
  const stub = {
    readJson(name, fallback = null) {
      return Object.prototype.hasOwnProperty.call(mem, name) ? JSON.parse(JSON.stringify(mem[name])) : fallback;
    },
    writeJson(name, data) { mem[name] = JSON.parse(JSON.stringify(data)); return true; },
    listJsonByPrefix() { return []; },
    deleteJson(name) { delete mem[name]; return true; },
  };
  require.cache[STORAGE_PATH] = { id: STORAGE_PATH, filename: STORAGE_PATH, loaded: true, exports: stub };
  require.cache[RATINGS_PATH] = {
    id: RATINGS_PATH, filename: RATINGS_PATH, loaded: true,
    exports: { profile: () => ({ level: 9, games: 9 }), addPoints: () => ({ ok: true }), addExp: () => ({ ok: true }) },
  };
  return {
    store: require(path.join(SRC_DIR, 'items', 'store')),
    items: require(path.join(SRC_DIR, 'items', 'index')),
    accounts: require(path.join(SRC_DIR, 'accounts')),
    auth: require(path.join(SRC_DIR, 'auth')),
    mem,
  };
}

const ITEMS = (over) => ({ wallets: {}, inventory: {}, equipped: {}, codes: {}, ...(over || {}) });
const ACCT_ID = 'a1b2c3d4e5f60718293a4b5c';
const ACCOUNTS = { [ACCT_ID]: { id: ACCT_ID, username: 'zhangsan', nickname: '张三', createdAt: 1 } };
const GUEST_ID = 'e1e1e1e1e1e1e1e1e1e1e1e1';

// -----------------------------------------------------------------------
// ① 内联护栏：items.grant / addCoin 自己就要拒绝
// -----------------------------------------------------------------------
test('⛔ 内联护栏：items.grant/addCoin 直接拒绝游客与不存在的收件人（不再依赖入口拦）', () => {
  const { items, store, auth } = load({ 'items.json': ITEMS(), 'accounts.json': ACCOUNTS });
  auth.markAccountSession(GUEST_ID, 'guest');

  const g1 = items.grant(GUEST_ID, 'avatar-wolf', 'admin');
  assert.strictEqual(g1.ok, false);
  assert.strictEqual(g1.code, 'GUEST', '游客必须被拒绝');

  const g2 = items.grant('ghost-user', 'avatar-wolf', 'admin');
  assert.strictEqual(g2.ok, false);
  assert.strictEqual(g2.code, 'NOT_FOUND', '不存在的收件人必须被拒绝');

  const g3 = items.addCoin('ghost-user', 10);
  assert.strictEqual(g3.ok, false);
  assert.strictEqual(g3.code, 'NOT_FOUND');

  const g4 = items.addCoin(GUEST_ID, 10);
  assert.strictEqual(g4.ok, false);
  assert.strictEqual(g4.code, 'GUEST');

  // 对照组：真实账号正常发放
  const ok = items.grant(ACCT_ID, 'avatar-wolf', 'admin');
  assert.strictEqual(ok.ok, true);
  assert.deepStrictEqual(store.owned(ACCT_ID), ['avatar-wolf']);
  // 绝不写孤儿键 / 游客键
  assert.deepStrictEqual(store.owned(GUEST_ID), [], '游客名下不得出现道具');
  assert.deepStrictEqual(store.owned('ghost-user'), [], '不存在的收件人名下不得出现道具');
});

// -----------------------------------------------------------------------
// ② 流水记操作人
// -----------------------------------------------------------------------
test('流水必须记操作人 adminId（对账/追责的依据）', () => {
  const { items } = load({ 'items.json': ITEMS(), 'accounts.json': ACCOUNTS });
  assert.strictEqual(items.grant(ACCT_ID, 'avatar-wolf', 'admin', { adminId: 'admin-A' }).ok, true);
  assert.strictEqual(items.addCoin(ACCT_ID, 50, { adminId: 'admin-B' }).ok, true);
  const logs = items.recentLogs(10);
  assert.strictEqual(logs.length, 2, '发放 + 加币各一条');
  const byKind = Object.fromEntries(logs.map((l) => [l.kind, l]));
  assert.strictEqual(byKind.item.adminId, 'admin-A', '发放那条要记发放人');
  assert.strictEqual(byKind.coin.adminId, 'admin-B', '加币那条要记操作人');
  assert.strictEqual(byKind.item.accountId, ACCT_ID);
});

test('不传 actor 时不写 adminId 字段（不会留空字符串冒充）', () => {
  const { items } = load({ 'items.json': ITEMS(), 'accounts.json': ACCOUNTS });
  items.grant(ACCT_ID, 'avatar-wolf', 'admin');
  const l = items.recentLogs(1)[0];
  assert.strictEqual('adminId' in l, false);
});

// -----------------------------------------------------------------------
// ③ 流水上限
// -----------------------------------------------------------------------
test('流水有上限：超过 LOG_MAX 自动删最旧，不再无限增长', () => {
  const { store } = load({ 'items.json': ITEMS() });
  const c = store.getCache();
  for (let i = 0; i < 2100; i++) store.writeLog(c, { kind: 'item', accountId: 'x', itemId: `i${i}` });
  const keys = Object.keys(c.logs);
  assert.strictEqual(keys.length, 2000, `流水条数必须封顶，实际 ${keys.length}`);
  const oldest = keys.slice().sort()[0];
  assert.strictEqual(c.logs[oldest].itemId !== 'i0', true, '最旧的应被裁掉');
  assert.strictEqual(c.logs[keys.slice().sort().pop()].itemId, 'i2099', '最新的必须保留');
});

// -----------------------------------------------------------------------
// ④ key 唯一（同毫秒 / 重启后 seq 归零不得覆盖）
// -----------------------------------------------------------------------
test('流水 key 不得互相覆盖（同毫秒批量写入也要条数正确）', () => {
  const { store } = load({ 'items.json': ITEMS() });
  const c = store.getCache();
  for (let i = 0; i < 500; i++) store.writeLog(c, { kind: 'coin', accountId: 'y', coinDelta: i });
  assert.strictEqual(Object.keys(c.logs).length, 500, '500 条写入应得到 500 条，无覆盖');
});
