'use strict';
/**
 * reports.test.js — 举报（2026-09-20 用户要求）
 *
 * 重点盯三类"看起来没问题、上线才发现"的：
 *  1. **被举报人的名字必须由服务端查**——信任客户端传来的名字，
 *     举报记录里的"被举报人"就能被伪造成任意人，管理员据此处理会冤枉无辜；
 *  2. **去重与配额**——按钮在对局页，输棋后连点几下是常态，不能变成刷屏通道；
 *  3. **状态机**——已处理的举报不能再处理一次（否则处理记录会被后一次覆盖）。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// 数据隔离：reports 会连带 require storage（首次 getDb 时定死路径）
const TMP = path.join(__dirname, '..', '.tmpdata-reports');
process.env.DATA_DIR = TMP;
if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });

const reports = require('../src/reports');
const auth = require('../src/auth');
const storage = require('../src/storage');

test.after(() => {
  // Windows 上必须先关 SQLite 连接，否则目录删不掉
  try { storage._getDb().close(); } catch (_) { /* 忽略 */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
});

/** 造两个真实会话（服务端要能从会话表里查到名字） */
function mkPair() {
  const a = auth.identify(null);
  const b = auth.identify(null);
  return { a, b };
}

test('举报：类别与目标校验', () => {
  reports._resetThrottle();
  const { a, b } = mkPair();

  const noCat = reports.submit({ byId: a.id, targetId: b.id, category: '' });
  assert.strictEqual(noCat.ok, false);
  assert.match(noCat.error, /类别/);

  const badCat = reports.submit({ byId: a.id, targetId: b.id, category: 'not-a-category' });
  assert.strictEqual(badCat.ok, false, '未知类别必须拒绝');

  const noTarget = reports.submit({ byId: a.id, targetId: '', category: 'cheat' });
  assert.strictEqual(noTarget.ok, false);
  assert.match(noTarget.error, /被举报人/);

  const self = reports.submit({ byId: a.id, targetId: a.id, category: 'cheat' });
  assert.strictEqual(self.ok, false, '举报自己要被拒（视角翻转时最容易点错）');
  assert.match(self.error, /自己/);

  assert.strictEqual(
    reports.submit({ byId: a.id, targetId: b.id, category: 'cheat' }).ok, true);
});

test('举报：被举报人的名字由服务端查会话，客户端传的名字不作数', () => {
  reports._resetThrottle();
  const { a, b } = mkPair();
  const r = reports.submit({
    byId: a.id, byName: a.name,
    targetId: b.id,
    targetName: '我是受害者（伪造的）',
    category: 'abuse',
  });
  assert.strictEqual(r.ok, true, r.error || '');
  assert.strictEqual(r.report.targetName, b.name, '必须用会话里的真名，而不是客户端传的');
  assert.notStrictEqual(r.report.targetName, '我是受害者（伪造的）');
});

test('举报：同一目标 30 分钟内只收一条（防止连点刷记录）', () => {
  reports._resetThrottle();
  const { a, b } = mkPair();
  const first = reports.submit({ byId: a.id, targetId: b.id, category: 'stall' });
  assert.strictEqual(first.ok, true);
  const again = reports.submit({ byId: a.id, targetId: b.id, category: 'cheat' });
  assert.strictEqual(again.ok, false, '重复举报同一人要被拒');
  assert.match(again.error, /已举报过/);

  // 换一个目标仍可举报（去重是"按目标"而不是"按人"）
  const c = auth.identify(null);
  assert.strictEqual(reports.submit({ byId: a.id, targetId: c.id, category: 'cheat' }).ok, true);
});

test('举报：单人有总量配额，超了要明确拒绝', () => {
  reports._resetThrottle();
  const a = auth.identify(null);
  let okCount = 0;
  let lastErr = '';
  // 对 12 个不同的人举报（去重不拦），配额上限是 10
  for (let i = 0; i < 12; i++) {
    const t = auth.identify(null);
    const r = reports.submit({ byId: a.id, targetId: t.id, category: 'other' });
    if (r.ok) okCount++; else lastErr = r.error;
  }
  assert.strictEqual(okCount, 10, '配额上限应为 10 条/小时');
  assert.match(lastErr, /频繁/);
});

test('举报：处理状态机（处理后不能再次处理）', () => {
  reports._resetThrottle();
  const { a, b } = mkPair();
  const r = reports.submit({ byId: a.id, targetId: b.id, category: 'cheat' });
  const id = r.report.id;

  assert.strictEqual(reports.pendingCount() >= 1, true, '新举报应计入待处理');

  const bad = reports.decide(id, 'whatever', '', 'admin');
  assert.strictEqual(bad.ok, false, '无效处理结果要被拒');

  const okRes = reports.decide(id, 'handled', '已确认作弊，封号处理', 'admin');
  assert.strictEqual(okRes.ok, true, okRes.error || '');
  assert.strictEqual(okRes.report.status, 'handled');
  assert.strictEqual(okRes.report.note, '已确认作弊，封号处理');
  assert.strictEqual(okRes.report.handledBy, 'admin');
  assert.ok(okRes.report.handledAt, '要记处理时间');

  const twice = reports.decide(id, 'rejected', '', 'admin');
  assert.strictEqual(twice.ok, false, '已处理的举报不能再处理（否则备注会被后一次覆盖）');

  assert.strictEqual(reports.decide('nonexistent-id', 'handled', '', 'admin').ok, false);
});

test('举报：列表按状态过滤，新的在前', () => {
  reports._resetThrottle();
  const a = auth.identify(null);
  const t1 = auth.identify(null);
  const t2 = auth.identify(null);
  const r1 = reports.submit({ byId: a.id, targetId: t1.id, category: 'cheat' }).report;
  const r2 = reports.submit({ byId: a.id, targetId: t2.id, category: 'abuse' }).report;
  reports.decide(r1.id, 'handled', '', 'admin');

  const pending = reports.list('pending');
  assert.strictEqual(pending.some((x) => x.id === r1.id), false, '已处理的不该出现在 pending 里');
  assert.strictEqual(pending.some((x) => x.id === r2.id), true);

  const all = reports.list();
  assert.ok(all.length >= 2);
  assert.strictEqual(all[0].id, r2.id, '新的在前');
});

test('举报：类别清单是唯一来源（前端直接用它渲染下拉）', () => {
  assert.ok(Array.isArray(reports.CATEGORIES) && reports.CATEGORIES.length >= 3);
  for (const c of reports.CATEGORIES) {
    assert.ok(c.id && c.label, '每项都要有 id 与中文标签');
    assert.strictEqual(reports.CATEGORY_IDS.includes(c.id), true);
  }
});
