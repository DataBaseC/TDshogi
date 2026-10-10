'use strict';
/**
 * tests/perf-leaderboard.test.js — §5.2 排行榜/用户列表不再逐条落盘读
 *
 * 固化：leaderboard() 取名字走**进程内会话名缓存**，不再对每条记录 `auth.load`（逐条磁盘读）。
 * 写点（改名/迁移/封禁）应调用 `invalidateSessionCache()` 使缓存失效以尽快反映新名字。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const TMP = path.join(require('node:os').tmpdir(), `.tmpdata-perflb-${process.pid}`);
process.env.DATA_DIR = TMP;
fs.mkdirSync(TMP, { recursive: true });

const storage = require('../src/storage');
const auth = require('../src/auth');
const ratings = require('../src/ratings');

const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;

test('§5.2 leaderboard 取名字不再逐条 auth.load（N 条记录 → 0 次 load）', () => {
  const ids = [];
  for (let i = 0; i < 30; i++) {
    const id = uid('lb');
    auth.upsertSession(id, `棋手${i}`);
    ratings.applyGameResult(id, uid('o'), 'b'); // games>0 才进榜
    ids.push(id);
  }
  ratings.flush();

  let loads = 0;
  const orig = auth.load;
  auth.load = (...a) => { loads++; return orig(...a); };
  try {
    ratings.invalidateSessionCache(); // 强制冷一次缓存
    const res = ratings.leaderboard(null, 10);
    assert.ok(res.list.length > 0, '应有榜单条目');
    assert.strictEqual(loads, 0, `取名字不应逐条落盘读（实际 ${loads} 次）`);
  } finally {
    auth.load = orig;
  }
});

test('§5.2 invalidateSessionCache：改名后刷新缓存能看到新名字', () => {
  const id = uid('nm');
  auth.upsertSession(id, '旧名');
  ratings.applyGameResult(id, uid('o'), 'w');
  ratings.flush();
  ratings.invalidateSessionCache();
  const self1 = ratings.leaderboard(id, 10).self;
  assert.strictEqual(self1.name, '旧名');

  auth.upsertSession(id, '新名');
  ratings.invalidateSessionCache(); // 写点应调用它
  const self2 = ratings.leaderboard(id, 10).self;
  assert.strictEqual(self2.name, '新名', '失效缓存后应看到新名字');
});

test.after(() => {
  try { storage._getDb().close(); } catch (_) {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
});
