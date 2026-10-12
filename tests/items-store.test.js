'use strict';
/**
 * items-store.test.js — 道具持久化「写失败可感知 + 原子回滚」（架构体检 #4）
 *
 * 为什么要有这个文件：storage.writeJson 曾**吞掉写失败**（接口回 200、磁盘却没变），
 * 道具层内存被改动而落盘失败时，会出现"钱包扣了、重启后又是原样"的**静默假成功**。
 * 本测试用**内存 storage 桩**替换真 src/storage（真 storage 依赖 better-sqlite3，此处不测），
 * 与仓库既有做法一致：通过 `require.cache[require.resolve(...)]` 注入。
 *
 * 覆盖三条结构性保证：
 *   1) storage.writeJson 返回 boolean（成功 true / 失败 false，仍不抛）；
 *   2) store.withRollback：落盘失败 ⇒ 内存回滚到快照（内存 == 磁盘）；
 *   3) items/index.js 把落盘失败冒泡成 {ok:false, code:'PERSIST_FAILED'}，绝不假成功。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const STORAGE_PATH = require.resolve(path.join(SRC_DIR, 'storage'));

/**
 * 用内存桩替换 src/storage，并**全新加载** items 模块（store 内部有 cache，必须每次重载）。
 * @param {object} [seed] 预置到桩里的 kv（如 { 'items.json': {...} }），模拟"磁盘已有数据"
 * @returns {{store:object, items:object, stub:object, mem:object}}
 */
function load(seed) {
  // 清掉 src 下已缓存的模块，保证拿到干净的内存态（尤其 store 的 cache）
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC_DIR + path.sep)) delete require.cache[key];
  }
  const mem = {};
  if (seed) for (const [k, v] of Object.entries(seed)) mem[k] = JSON.parse(JSON.stringify(v));

  const stub = {
    _failWrites: false,
    _writeCount: 0,
    readJson(name, fallback = null) {
      return Object.prototype.hasOwnProperty.call(mem, name)
        ? JSON.parse(JSON.stringify(mem[name])) : fallback;
    },
    writeJson(name, data) {
      stub._writeCount += 1;
      if (stub._failWrites) return false;           // 模拟落盘失败
      mem[name] = JSON.parse(JSON.stringify(data)); // 成功才真正"落盘"
      return true;
    },
    listJsonByPrefix() { return []; },
    deleteJson(name) { delete mem[name]; return true; },
  };

  // 注入桩：此后任何 require('../storage' / './storage') 都命中它
  require.cache[STORAGE_PATH] = {
    id: STORAGE_PATH, filename: STORAGE_PATH, loaded: true, exports: stub,
  };

  const store = require(path.join(SRC_DIR, 'items', 'store'));
  const items = require(path.join(SRC_DIR, 'items', 'index'));
  return { store, items, stub, mem };
}

const ITEMS = (over) => ({
  wallets: {}, inventory: {}, equipped: {}, codes: {}, ...(over || {}),
});

// ---------------- 1) storage.writeJson 的形状 ----------------

test('storage.writeJson 返回 boolean：成功 true / 失败 false，且失败不抛', () => {
  const { stub } = load();
  assert.strictEqual(typeof stub.writeJson('k', { a: 1 }), 'boolean');
  assert.strictEqual(stub.writeJson('k', { a: 1 }), true);
  stub._failWrites = true;
  assert.strictEqual(stub.writeJson('k', { a: 2 }), false);
  assert.doesNotThrow(() => stub.writeJson('k', { a: 3 }));
});

// ---------------- 2) 正常路径 ----------------

test('正常路径：buyItem 成功 ⇒ 钱包扣款 + 入库，仅落盘一次', () => {
  const { store, items, stub } = load({ 'items.json': ITEMS({ wallets: { u1: { coin: 500 } } }) });
  stub._writeCount = 0;
  const r = items.buy('u1', 'bgm-shen'); // 内置 BGM 深层沉浸 价 150
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.wallet.coin, 350);
  assert.deepStrictEqual(r.owned, ['bgm-shen']);
  assert.strictEqual(stub._writeCount, 1, '扣币 + 入库应只落盘一次');
  assert.strictEqual(store.wallet('u1').coin, 350);
  assert.strictEqual(store.has('u1', 'bgm-shen'), true);
});

test('正常路径：applyCode 兑换发放 + 计次，仅落盘一次', () => {
  const { store, items, stub } = load({ 'items.json': ITEMS({
    wallets: { u1: { coin: 10 } },
    codes: { HELLO: { itemId: 'bgm-shen', coin: 50, maxUses: 5, used: 0 } },
  }) });
  stub._writeCount = 0;
  const r = items.redeem('u1', 'HELLO');
  assert.strictEqual(r.ok, true);
  assert.ok(r.owned.includes('bgm-shen'));
  assert.strictEqual(r.wallet.coin, 60);
  assert.strictEqual(stub._writeCount, 1);
  assert.strictEqual(store.getCode('HELLO').used, 1);
});

// ---------------- 3) 失败路径（关键：回滚生效） ----------------

test('失败路径：buyItem 落盘失败 ⇒ PERSIST_FAILED，且钱包/库存全部回滚', () => {
  const { store, items, stub, mem } = load({ 'items.json': ITEMS({ wallets: { u1: { coin: 500 } } }) });
  stub._failWrites = true;
  const r = items.buy('u1', 'bgm-shen');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'PERSIST_FAILED');
  // 回滚：内存与"磁盘"都回到调用前
  assert.strictEqual(store.wallet('u1').coin, 500, '扣款必须回滚');
  assert.deepStrictEqual(store.owned('u1'), [], '入库必须回滚');
  assert.strictEqual(store.has('u1', 'bgm-shen'), false);
  assert.strictEqual(mem['items.json'].wallets.u1.coin, 500, '磁盘未被改动');
});

test('失败路径：applyCode 落盘失败 ⇒ 回滚（含 codes.used 不被 +1）', () => {
  const { store, items, stub } = load({ 'items.json': ITEMS({
    wallets: { u1: { coin: 10 } },
    codes: { HELLO: { itemId: 'bgm-shen', coin: 50, maxUses: 5, used: 0 } },
  }) });
  stub._failWrites = true;
  const r = items.redeem('u1', 'HELLO');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'PERSIST_FAILED');
  assert.deepStrictEqual(store.owned('u1'), [], '发放道具必须回滚');
  assert.strictEqual(store.wallet('u1').coin, 10, '加币必须回滚');
  assert.strictEqual(store.getCode('HELLO').used, 0, 'codes.used 必须回滚，未被 +1');
});

test('失败路径：equip 落盘失败 ⇒ PERSIST_FAILED 且装备回滚', () => {
  const { store, items, stub } = load({ 'items.json': ITEMS({
    inventory: { u1: { 'bgm-shen': { at: 1, source: 'grant' } } },
    equipped: { u1: { 'bgm-game': 'bgm-shen' } },
  }) });
  stub._failWrites = true;
  const r = items.equip('u1', 'bgm-game', null); // 卸下（回落自带默认曲）
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'PERSIST_FAILED');
  assert.strictEqual(store.equipped('u1')['bgm-game'], 'bgm-shen', '卸下必须回滚');
});

test('失败路径：grant / addCoin 落盘失败同样冒泡 PERSIST_FAILED', () => {
  // ⚠️ 2026-10-12：grant/addCoin 增加**内联收件人校验**（只发注册账号，禁游客/禁孤儿键）
  //    → 收件人必须是真实账号，故这里先铺一个账号再测落盘失败的回滚。
  const ACCT = 'a1b2c3d4e5f60718293a4b5c';
  const { store, items, stub } = load({
    'items.json': ITEMS({ wallets: { [ACCT]: { coin: 100 } } }),
    'accounts.json': { [ACCT]: { id: ACCT, username: 'tester', createdAt: 1 } },
  });
  stub._failWrites = true;
  const g = items.grant(ACCT, 'bgm-shen');
  assert.strictEqual(g.ok, false);
  assert.strictEqual(g.code, 'PERSIST_FAILED');
  assert.deepStrictEqual(store.owned(ACCT), []);
  const a = items.addCoin(ACCT, 100);
  assert.strictEqual(a.ok, false);
  assert.strictEqual(a.code, 'PERSIST_FAILED');
  assert.strictEqual(store.wallet(ACCT).coin, 100);
});

test('defineCode：成功字段仍在顶层（兼容 admin/CLI 读 def.itemId/coin/maxUses）；失败冒泡 PERSIST_FAILED', () => {
  const ok = load();
  const def = ok.items.defineCode('X1', { itemId: 'bgm-shen', coin: 5, maxUses: 3 });
  assert.strictEqual(def.ok, true);
  assert.strictEqual(def.itemId, 'bgm-shen');
  assert.strictEqual(def.coin, 5);
  assert.strictEqual(def.maxUses, 3);

  const bad = load();
  bad.stub._failWrites = true;
  const def2 = bad.items.defineCode('X1', { itemId: 'bgm-shen', coin: 5, maxUses: 3 });
  assert.strictEqual(def2.ok, false);
  assert.strictEqual(def2.code, 'PERSIST_FAILED');
});
