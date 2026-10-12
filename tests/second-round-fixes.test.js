'use strict';
/**
 * second-round-fixes.test.js — 2026-10-12 第二轮缺陷审查（TDShogi-第二轮缺陷审查-2026-10-12.md）
 * 关键修复的回归测试。用**内存 storage 桩**替换真 src/storage（真 storage 依赖 better-sqlite3），
 * 与 items-store.test.js 同一做法：`require.cache[require.resolve(...)]` 注入。
 *
 * 覆盖三条结构性保证：
 *   ① P2-17：`defineCode` 覆盖已有兑换码时**保留** used / redeemedBy（否则已兑换者可重复兑换）；
 *   ② P1-2.1：`adminRename` 对账号用户**同步** account.nickname（否则下次 login 覆盖回旧昵称）；
 *   ③ P0-1.1：`resolveOwner` 对会话不存在的**悬空 id** 不可归属（防认领死者棋谱）。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const STORAGE_PATH = require.resolve(path.join(SRC_DIR, 'storage'));
const PROTOCOL_PATH = require.resolve(path.join(SRC_DIR, 'protocol'));
const ADMIN_PATH = require.resolve(path.join(SRC_DIR, 'admin'));

/** 注入内存 storage 桩并全新加载 src 下模块；同时桩掉 protocol/admin（其依赖链含 shogi.js，非本测试对象） */
function load(seed) {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC_DIR + path.sep)) delete require.cache[key];
  }
  const mem = {};
  if (seed) for (const [k, v] of Object.entries(seed)) mem[k] = JSON.parse(JSON.stringify(v));

  const stub = {
    readJson(name, fallback = null) {
      return Object.prototype.hasOwnProperty.call(mem, name)
        ? JSON.parse(JSON.stringify(mem[name])) : fallback;
    },
    writeJson(name, data) { mem[name] = JSON.parse(JSON.stringify(data)); return true; },
    listJsonByPrefix() { return []; },
    deleteJson(name) { delete mem[name]; return true; },
  };
  require.cache[STORAGE_PATH] = {
    id: STORAGE_PATH, filename: STORAGE_PATH, loaded: true, exports: stub,
  };
  // context.js 顶部会 `new Protocol(...)`；protocol 的依赖链含 game.js → shogi.js（沙箱未装）。
  // 这里只测 context 的纯身份判定，协议实例用空壳顶掉。
  require.cache[PROTOCOL_PATH] = {
    id: PROTOCOL_PATH, filename: PROTOCOL_PATH, loaded: true,
    exports: { Protocol: class Protocol { constructor() { this.rooms = {}; } } },
  };
  require.cache[ADMIN_PATH] = {
    id: ADMIN_PATH, filename: ADMIN_PATH, loaded: true,
    exports: { verify: () => false, isAdmin: () => false },
  };
  return { mem, stub };
}

// ---- ① defineCode 覆盖保留使用状态（P2-17）----
test('defineCode 覆盖已有兑换码保留 used / redeemedBy（防重复兑换）', () => {
  load();
  const store = require(path.join(SRC_DIR, 'items', 'store'));
  const r1 = store.defineCode('EVENT2026', { coin: 10, maxUses: 3 });
  assert.equal(r1.ok, true);
  // 模拟两次兑换后的状态（redeem 内部即写 entry.used / entry.redeemedBy）
  const entry = store.getCode('EVENT2026');
  entry.used = 2;
  entry.redeemedBy = ['accA', 'accB'];
  // 管理员只是想改配置重新定义（maxUses / coin）
  const r2 = store.defineCode('EVENT2026', { coin: 20, maxUses: 5, used: 0, redeemedBy: [] });
  assert.equal(r2.ok, true);
  assert.equal(r2.coin, 20);
  assert.equal(r2.maxUses, 5);
  assert.equal(r2.used, 2, '使用计数不得被覆盖清零');
  assert.deepStrictEqual(r2.redeemedBy, ['accA', 'accB'], '兑换名单不得被覆盖清空');
});

// ---- ② adminRename 双真相源同步（P1-2.1）----
test('adminRename 对账号用户同步 account.nickname（不再被下次 login 覆盖回旧昵称）', () => {
  const ACC = 'aaaaaaaaaaaaaaaaaaaa0001'; // 24 hex（getSessionRaw 只认 24 位）
  const { mem } = load({
    'accounts.json': {
      [ACC]: {
        id: ACC, username: 'alice', nickname: '旧昵称',
        createdAt: 1, profile: {},
      },
    },
    [`sessions/${ACC}.json`]: {
      id: ACC, name: '旧昵称', isAccount: true, createdAt: 1,
    },
  });
  const auth = require(path.join(SRC_DIR, 'auth'));
  const accounts = require(path.join(SRC_DIR, 'accounts'));
  const r = auth.adminRename(ACC, '新名字');
  assert.equal(r.ok, true);
  assert.equal(auth.getSessionRaw(ACC).name, '新名字');
  assert.equal(accounts.getAccount(ACC).nickname, '新名字',
    '账号侧 nickname 必须同步（login() 会用它覆盖会话名，公开卡也只读它）');
  assert.equal(mem['accounts.json'][ACC].nickname, '新名字', '账号侧变更已落盘');
});

// ---- ③ 悬空 id 不可认领（P0-1.1，resolveOwner 口径）----
test('resolveOwner：会话不存在的悬空游客 id 不可归属（防认领死者棋谱）', () => {
  load({
    'accounts.json': {
      aaaaaaaaaaaaaaaaaaaa0002: {
        id: 'aaaaaaaaaaaaaaaaaaaa0002', username: 'bob', nickname: 'Bob', createdAt: 1, profile: {},
      },
    },
  });
  const ctx = require(path.join(SRC_DIR, 'http', 'context'));
  const auth = require(path.join(SRC_DIR, 'auth'));

  // 悬空 id（24 hex，会话不存在）→ 不可归属
  const deadId = 'deaddeaddeaddeaddeaddead';
  assert.strictEqual(auth.getSessionRaw(deadId), null);
  assert.strictEqual(ctx.resolveOwner(deadId), null, '悬空 id 不可认领（否则谁先来谁是死者棋谱的谱主）');

  // 现存游客会话仍维持「id 即凭证」（已知取舍不变）
  const liveId = auth.identify('cafecafecafecafecafecafe').id;
  assert.strictEqual(ctx.resolveOwner(liveId), liveId);

  // 账号 id 依旧不可冒充（一律走令牌）
  assert.strictEqual(ctx.resolveOwner('aaaaaaaaaaaaaaaaaaaa0002'), null);
});
