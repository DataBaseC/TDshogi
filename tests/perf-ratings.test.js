'use strict';
/**
 * tests/perf-ratings.test.js — §5.1 评级落盘策略与 history 有界
 *
 * 固化三件事：
 *  1. history 有上界（200），不会随时间无界增长；
 *  2. persist() 为去抖写（窗口内的连续改动合并），flush() 立即落盘；
 *  3. refreshCache() 以磁盘为权威（契约：调用前需 flush，否则丢弃内存改动）。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const TMP = path.join(require('node:os').tmpdir(), `.tmpdata-perfratings-${process.pid}`);
process.env.DATA_DIR = TMP;
fs.mkdirSync(TMP, { recursive: true });

const storage = require('../src/storage');
const ratings = require('../src/ratings');

const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;

test('§5.1 history 有上界：连续 250 局后 history ≤ 200', () => {
  const a = uid('h');
  for (let i = 0; i < 250; i++) {
    ratings.applyGameResult(a, uid('o'), i % 2 ? 'b' : 'w');
  }
  ratings.flush();
  const raw = storage.readJson('ratings.json', {})[a];
  assert.ok(raw.history.length <= 200, `history 应 ≤ 200，实际 ${raw.history.length}`);
  assert.ok(raw.history.length >= 190, `history 应接近上限，实际 ${raw.history.length}`);
});

test('§5.1 去抖写：flush 前磁盘可能未更新，flush 后一定更新', () => {
  const id = uid('d');
  ratings.addPoints(id, 5);
  ratings.flush();
  assert.strictEqual(storage.readJson('ratings.json', {})[id].points, 5, 'flush 后磁盘应有最新值');
});

test('§5.1 refreshCache 以磁盘为权威（契约：先 flush 再 reload 才不丢）', () => {
  const id = uid('r');
  ratings.addPoints(id, 3);
  ratings.flush();
  ratings.refreshCache();
  assert.strictEqual(ratings.profile(id).points, 3, 'flush+refreshCache 后仍在');
});

test.after(() => {
  try { storage._getDb().close(); } catch (_) {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
});
