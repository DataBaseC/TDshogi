'use strict';
/**
 * backup.test.js — 数据库备份（`src/backup.js`）
 *
 * ⚠️ `src/storage.js` 在 **require 时**就用 `DATA_DIR` 算好了库路径，所以必须在 require
 * 之前把 `process.env.DATA_DIR` 指向临时目录，否则测试会动到真实库。
 * （`node --test` 每个测试文件跑在独立进程，所以这里的赋值不会污染其他测试文件。）
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tdshogi-backup-'));
process.env.DATA_DIR = TMP;

const storage = require('../src/storage');
const backup = require('../src/backup');

const BACKUP_DIR = path.join(TMP, 'backups');

test('runBackup：产出一份通过完整性校验的备份', () => {
  // 先写点数据，确保库存在且非空
  storage.putRecord({
    id: 'bk-1',
    names: ['先手', '後手'],
    playerIds: { b: 'pb', w: 'pw' },
    moves: ['7g7f', '3c3d'],
    result: 'b',
    createdAt: Date.now(),
    visibility: 'public',
  });

  const res = backup.runBackup({ dir: BACKUP_DIR, quiet: true });
  assert.strictEqual(res.ok, true, res.reason);
  assert.ok(res.size > 0, '备份文件不应为空');
  assert.ok(fs.existsSync(res.path));
  assert.deepStrictEqual(backup.verifyBackup(res.path), { ok: true });
});

test('备份内容与源库一致（records 可读回，含 summary 列）', () => {
  const latest = backup.latestBackup(BACKUP_DIR);
  assert.ok(latest, '应存在备份');
  const Database = require('better-sqlite3');
  const db = new Database(latest.path, { readonly: true });
  try {
    const row = db.prepare('SELECT data, playerB, moveCount FROM records WHERE id = ?').get('bk-1');
    assert.ok(row, '备份里应含源库记录');
    assert.strictEqual(JSON.parse(row.data).names[0], '先手');
    assert.strictEqual(row.playerB, 'pb');
    assert.strictEqual(row.moveCount, 2);
  } finally {
    db.close();
  }
});

test('verifyBackup：非数据库文件判定为失败', () => {
  const bad = path.join(TMP, 'not-db.db');
  fs.writeFileSync(bad, '这不是一个 SQLite 文件');
  const res = backup.verifyBackup(bad);
  assert.strictEqual(res.ok, false);
  assert.ok(res.reason, '应给出失败原因');
});

test('listBackups / latestBackup / backupDay：按时间升序且忽略干扰文件', () => {
  const dir = path.join(TMP, 'list-test');
  fs.mkdirSync(dir, { recursive: true });
  for (const d of ['20260101-000001', '20260103-000001', '20260102-000001']) {
    fs.writeFileSync(path.join(dir, `tdshogi-${d}.db`), 'x');
  }
  fs.writeFileSync(path.join(dir, 'not-a-backup.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'tdshogi-20260101-000001.db-wal'), 'x');

  const all = backup.listBackups(dir);
  assert.strictEqual(all.length, 3, '只统计 tdshogi-*.db');
  assert.strictEqual(all[0].file, 'tdshogi-20260101-000001.db');
  assert.strictEqual(all[2].file, 'tdshogi-20260103-000001.db');
  assert.strictEqual(backup.latestBackup(dir).file, 'tdshogi-20260103-000001.db');
  assert.strictEqual(backup.backupDay(all[0]), '20260101');
  assert.strictEqual(backup.backupDay(null), null);
});

test('prune：按份数裁剪，只留最新的 N 份', () => {
  const dir = path.join(TMP, 'prune-count');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= 5; i++) {
    fs.writeFileSync(path.join(dir, `tdshogi-2026010${i}-000000.db`), 'x'.repeat(10));
  }
  const removed = backup.prune({ dir, keep: 2, maxBytes: 1e9 });
  assert.strictEqual(removed.length, 3);
  const left = backup.listBackups(dir);
  assert.strictEqual(left.length, 2);
  assert.strictEqual(left[0].file, 'tdshogi-20260104-000000.db', '应先删最旧的');
  assert.strictEqual(left[1].file, 'tdshogi-20260105-000000.db');
});

test('prune：总量超限继续删最旧的，但永远保留最新一份', () => {
  const dir = path.join(TMP, 'prune-size');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= 5; i++) {
    fs.writeFileSync(path.join(dir, `tdshogi-2026010${i}-000000.db`), 'x'.repeat(100));
  }
  // 总 500B、上限 250B → 留 2 份（keep 给大值，确保是总量在起作用）
  backup.prune({ dir, keep: 99, maxBytes: 250 });
  assert.strictEqual(backup.listBackups(dir).length, 2);

  // 极端：上限 0 → 至少保住最新 1 份
  backup.prune({ dir, keep: 99, maxBytes: 0 });
  const left = backup.listBackups(dir);
  assert.strictEqual(left.length, 1);
  assert.strictEqual(left[0].file, 'tdshogi-20260105-000000.db');
});

test('startAutoBackup：同一天重复启动不会重复备份', () => {
  const dir = path.join(TMP, 'auto');
  assert.strictEqual(backup.listBackups(dir).length, 0);

  const t1 = backup.startAutoBackup({ dir, intervalMs: 3600000 });
  clearInterval(t1);
  assert.strictEqual(backup.listBackups(dir).length, 1, '首次启动应补一份');

  const t2 = backup.startAutoBackup({ dir, intervalMs: 3600000 });
  clearInterval(t2);
  assert.strictEqual(backup.listBackups(dir).length, 1, '当天再次启动不应新增（重启不重复备份）');
});
