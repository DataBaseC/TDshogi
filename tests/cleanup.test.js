'use strict';
/**
 * cleanup.test.js — 游客数据清理（`src/cleanup.js`，PLAN §U5）
 *
 * 这是本次需求里**唯一不可逆**的实现，所以断言重点不是"该删的删了"，
 * 而是"**不该删的一个都没删**"：
 *   - 已注册的游客（账号里保留了来源 `guestId`）→ 永不清理；
 *   - 未超期的游客 → 不清理；
 *   - 棋谱只要有一方不在待清理集合里 → 保留。
 * 最后一条判错，就会把**活跃用户的对局记录**一起抹掉。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// ⚠️ 必须在 require storage 之前设定数据目录——storage 首次 getDb() 时就把路径定死了
const TMP = path.join(__dirname, '..', '.tmpdata-cleanup');
process.env.DATA_DIR = TMP;
if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });

const storage = require('../src/storage');
const auth = require('../src/auth');
const cleanup = require('../src/cleanup');

const DAY = 24 * 60 * 60 * 1000;
const id = (n) => String(n).padStart(24, '0');

// 四个身份，覆盖全部分支
const OLD_GUEST = id(1);      // 超期游客（40 天未登录）
const OLD_GUEST2 = id(2);     // 超期游客（40 天未登录）
const RECENT_GUEST = id(3);   // 活跃游客（3 天前还登录过）
const REGISTERED = id(4);     // 超期，但**已注册**（账号里留着 guestId 指向它）

/**
 * ⚠️ 造会话必须写 **kv**（`sessions/<id>.json`，§M4 起唯一来源），
 * 不能用 `storage.putSession()` 写旧 `sessions` **表**。
 * 2026-09-21 审查 P1-5 的教训正在这里：清理逻辑当时读旧表、这个测试也写旧表，
 * 两边"自洽"地全绿，而**线上真实会话（在 kv）一个都没被清理过** ——
 * 测试跟着实现一起走错了源，于是没能拦住 bug。
 * 「测试的数据源必须与生产同一处」比"测试通过"重要得多。
 */
function mkSession(sid, daysAgo) {
  auth.saveSession({
    id: sid,
    name: '游客' + sid.slice(-4),
    createdAt: Date.now() - 400 * DAY,
    lastSeen: Date.now() - daysAgo * DAY,
  });
}
function mkRecord(rid, b, w) {
  storage.putRecord({
    id: rid,
    createdAt: Date.now(),
    playerIds: { b, w },
    names: ['甲', '乙'],
    result: 'b',
    resultDetail: '投了',
    moves: ['7g7f', '3c3d'],
    timeControl: '10:00',
    rated: true,
    winnerId: b,
  });
}

// ---------------- 数据准备（必须在 test 之前，避免 accounts 缓存先被建立） ----------------
mkSession(OLD_GUEST, 40);
mkSession(OLD_GUEST2, 40);
mkSession(RECENT_GUEST, 3);
mkSession(REGISTERED, 40);
// 账号里保留来源 guestId —— 这是"该游客后来注册了没有"的唯一依据
storage.writeJson('accounts.json', {
  [id(99)]: { id: id(99), username: '张三', guestId: REGISTERED, createdAt: Date.now() },
});

mkRecord('r-both-guests', OLD_GUEST, OLD_GUEST2);   // 双方皆待清理游客 → 删
mkRecord('r-vs-registered', OLD_GUEST, REGISTERED); // 一方已注册 → 留
mkRecord('r-vs-recent', OLD_GUEST, RECENT_GUEST);   // 一方仍活跃 → 留

test.after(() => {
  // ⚠️ Windows 上必须**先关掉 SQLite 连接**再删目录，否则文件被占用、删除静默失败，
  // 临时目录会一直残留在仓库根目录（.gitignore 已覆盖 .tmpdata*，但弄脏工作区总归不好）。
  try { storage._getDb().close(); } catch (_) { /* 已关闭或未打开 */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
});

test('§U5 plan：只圈出「超期 且 未注册」的游客', () => {
  const p = cleanup.plan({ days: 30 });
  assert.ok(p.staleIds.has(OLD_GUEST), '超期游客应被圈出');
  assert.ok(p.staleIds.has(OLD_GUEST2), '超期游客应被圈出');
  assert.ok(!p.staleIds.has(RECENT_GUEST), '3 天前还活跃的游客不能清');
  assert.ok(!p.staleIds.has(REGISTERED), '已注册的游客永不清理（账号里留着 guestId 作依据）');
  assert.strictEqual(p.staleSessions.length, 2);
});

test('§U5 plan：棋谱只在「双方都是待清理游客」时才进清单', () => {
  const p = cleanup.plan({ days: 30 });
  assert.deepStrictEqual(p.staleRecords.map((r) => r.id), ['r-both-guests'],
    '只有双方皆待清理游客的棋谱才该删');
});

test('§U5 run(dryRun)：只出清单，一条数据都不动', () => {
  const beforeS = auth.listSessions().length;
  const beforeR = storage.listSummaries({ limit: 999 }).length;

  const s = cleanup.run({ days: 30, dryRun: true });

  assert.strictEqual(s.dryRun, true);
  assert.strictEqual(s.sessions, 2);
  assert.strictEqual(s.records, 1);
  assert.strictEqual(auth.listSessions().length, beforeS, '干跑不得删除会话');
  assert.strictEqual(storage.listSummaries({ limit: 999 }).length, beforeR, '干跑不得删除棋谱');
  assert.strictEqual(s.deletedSessions, undefined, '干跑不应给出 deleted 计数');
});

test('§U5 run：真删时只删清单内的', () => {
  const s = cleanup.run({ days: 30, dryRun: false });

  assert.strictEqual(s.deletedSessions, 2);
  assert.strictEqual(s.deletedRecords, 1);

  const leftSessions = auth.listSessions().map((x) => x.id);
  assert.ok(leftSessions.includes(RECENT_GUEST), '活跃游客必须还在');
  assert.ok(leftSessions.includes(REGISTERED), '已注册游客必须还在');
  assert.ok(!leftSessions.includes(OLD_GUEST), '超期游客应已删除');

  const leftRecords = storage.listSummaries({ limit: 999 }).map((r) => r.id).sort();
  assert.deepStrictEqual(leftRecords, ['r-vs-recent', 'r-vs-registered'],
    '只保留"有一方不在待清理集合"的棋谱');
});

test('§U5 保留期边界：29 天留、31 天删', () => {
  const A = id(11);
  const B = id(12);
  mkSession(A, 29);
  mkSession(B, 31);

  const p = cleanup.plan({ days: 30 });
  assert.ok(!p.staleIds.has(A), '29 天未登录仍在保留期内');
  assert.ok(p.staleIds.has(B), '31 天未登录应被清理');
});
