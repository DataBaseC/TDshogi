'use strict';
/**
 * tests/ratings-points.test.js — 用户积分（F1）回归
 *
 * 积分与 ELO **独立**，每完成一局 +1；累计只在服务端；老库缺字段按历史局数回填。
 * ⚠️ 必须在 require storage 前设定 DATA_DIR。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const TMP = path.join(require('node:os').tmpdir(), `.tmpdata-points-${process.pid}`);
process.env.DATA_DIR = TMP;
fs.mkdirSync(TMP, { recursive: true });
process.env.SESSION_SECRET = 'unit-test-session-secret';

const storage = require('../src/storage');
const ratings = require('../src/ratings');

test.after(() => {
  try { storage._getDb().close(); } catch (_) { /* 忽略 */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
});

const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;

test('F1：addPoints 累计积分、与 ELO 独立、profile 暴露 points', () => {
  const id = uid('p');
  assert.strictEqual(ratings.profile(id).points, 0, '默认积分 0');
  assert.strictEqual(ratings.addPoints(id, 1).points, 1);
  ratings.addPoints(id, 1);
  const prof = ratings.profile(id);
  assert.strictEqual(prof.points, 2, '累计到 2');
  assert.strictEqual(prof.rating, 1500, '积分不影响 ELO');
  assert.strictEqual(ratings.addPoints(id, 0).ok, false, '非法参数被拒');
  assert.strictEqual(ratings.addPoints('', 1).ok, false, '空 id 被拒');
});

test('F1：与 ELO 结算解耦——applyGameResult 不动积分（积分由终局链路单独累计）', () => {
  const a = uid('a'); const b = uid('b');
  ratings.applyGameResult(a, b, 'b');
  assert.strictEqual(ratings.profile(a).points, 0, 'applyGameResult 不改积分');
  // 终局链路（_finalize）对双方各调一次 addPoints
  ratings.addPoints(a, 1); ratings.addPoints(b, 1);
  assert.strictEqual(ratings.profile(a).points, 1);
  assert.strictEqual(ratings.profile(b).points, 1, '和局/胜负都各 +1');
});

test('F1 兼容：老库缺 points 字段 → 按历史局数一次性回填（幂等）', () => {
  storage.writeJson('ratings.json', {
    olduser: { rating: 1550, games: 7, wins: 3, losses: 3, draws: 1, exp: 10, level: 3, history: [] },
  });
  ratings.refreshCache();
  assert.strictEqual(ratings.profile('olduser').points, 7, '缺字段按 games 回填');
  ratings.addPoints('olduser', 1);
  ratings.flush(); // §5.1：ratings 改为去抖写；refreshCache 以磁盘为权威，改动需先落盘
  ratings.refreshCache();
  assert.strictEqual(ratings.profile('olduser').points, 8, '回填后再累计不丢失');
});
