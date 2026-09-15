/**
 * tests/announcements.test.js — 公告读写（PLAN §C5）
 *
 * 重点是那条**删不干净**的老 bug：旧实现用 `Array.isArray(data) && data.length` 判断
 * "有没有数据"，于是管理员把公告删光（写回空数组）后，默认公告会**重新冒出来**——
 * 用户看到的现象就是"删不掉"。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// ⚠️ 必须在 require storage 之前设定数据目录——storage 首次 getDb() 就把路径定死了
const TMP = path.join(__dirname, '..', '.tmpdata-ann');
process.env.DATA_DIR = TMP;
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 首次运行无目录 */ }

const { writeJson } = require('../src/storage');
const ann = require('../src/announcements');

/** 每个用例前清空公告存储 */
function reset() {
  writeJson('announcements.json', []);
}

test('§C5 读取：从未写过时给默认公告', () => {
  writeJson('announcements.json', null); // 模拟"库中没有这个键"
  const list = ann.listAnnouncements();
  assert.ok(list.length >= 2, '首次应有默认公告');
  assert.ok(list.some((a) => a.pinned), '默认公告里应有置顶的');
});

test('§C5 ⚠️ 删空后**不会**退回默认公告（旧实现会，表现为"删不掉"）', () => {
  reset();
  const a = ann.addAnnouncement({ title: '唯一一条', content: '内容' });
  assert.strictEqual(a.ok, true, a.error || '');
  assert.strictEqual(ann.listAnnouncements().length, 1);

  const d = ann.deleteAnnouncement(a.announcement.id);
  assert.strictEqual(d.ok, true, d.error || '');
  assert.strictEqual(ann.listAnnouncements().length, 0,
    '删光后必须真的是空的——不能把空数组当成"还没有数据"而退回默认公告');
});

test('§C5 新增：置顶在前、其余按时间倒序', () => {
  reset();
  ann.addAnnouncement({ title: '早', content: 'x', pinned: false });
  ann.addAnnouncement({ title: '晚', content: 'x', pinned: false });
  ann.addAnnouncement({ title: '置顶的', content: 'x', pinned: true });

  const list = ann.listAnnouncements();
  assert.strictEqual(list[0].title, '置顶的', '置顶必须排最前');
  assert.strictEqual(list[1].title, '晚', '非置顶按时间倒序');
  assert.strictEqual(list[2].title, '早');
});

test('§C5 修改：可只改一部分（例如只切置顶）', () => {
  reset();
  const a = ann.addAnnouncement({ title: '原标题', content: '原内容' }).announcement;

  const r1 = ann.updateAnnouncement(a.id, { pinned: true });
  assert.strictEqual(r1.ok, true, r1.error || '');
  assert.strictEqual(r1.announcement.title, '原标题', '只传 pinned 时标题不应被清空');
  assert.strictEqual(r1.announcement.content, '原内容');
  assert.strictEqual(r1.announcement.pinned, true);
  assert.ok(r1.announcement.updatedAt, '改过要记 updatedAt');

  const r2 = ann.updateAnnouncement(a.id, { title: '新标题', content: '新内容' });
  assert.strictEqual(r2.announcement.title, '新标题');
  assert.strictEqual(r2.announcement.content, '新内容');
  assert.strictEqual(r2.announcement.pinned, true, '没传 pinned 时应保持原值');

  assert.strictEqual(ann.updateAnnouncement(99999, { title: 'x' }).ok, false, '不存在的 id 应报错');
});

test('§C5 参数校验：标题/内容必填、长度与条数上限', () => {
  reset();
  assert.strictEqual(ann.addAnnouncement({ title: '', content: 'x' }).ok, false, '空标题应拒绝');
  assert.strictEqual(ann.addAnnouncement({ title: '  ', content: 'x' }).ok, false, '空白标题应拒绝');
  assert.strictEqual(ann.addAnnouncement({ title: 'x', content: '' }).ok, false, '空内容应拒绝');
  assert.strictEqual(
    ann.addAnnouncement({ title: 'x'.repeat(ann.MAX_TITLE + 1), content: 'y' }).ok, false,
    '超长标题应拒绝');
  assert.strictEqual(
    ann.addAnnouncement({ title: 'x', content: 'y'.repeat(ann.MAX_CONTENT + 1) }).ok, false,
    '超长内容应拒绝');

  // 条数上限：灌满后再加应被拒（公告会被首页全量下发，不能无限涨）
  reset();
  const many = [];
  for (let i = 0; i < ann.MAX_COUNT; i++) many.push({ id: i + 1, title: 't' + i, content: 'c', createdAt: i });
  writeJson('announcements.json', many);
  const over = ann.addAnnouncement({ title: '再一条', content: 'x' });
  assert.strictEqual(over.ok, false, '达到上限后应拒绝新增');
  assert.match(over.error, /上限/);
});

test('§C5 id 自增：删除后新增不复用旧 id', () => {
  reset();
  const a = ann.addAnnouncement({ title: 'A', content: 'x' }).announcement;
  const b = ann.addAnnouncement({ title: 'B', content: 'x' }).announcement;
  assert.notStrictEqual(a.id, b.id);
  ann.deleteAnnouncement(b.id);
  const c = ann.addAnnouncement({ title: 'C', content: 'x' }).announcement;
  assert.strictEqual(c.id > b.id, true, '新 id 应继续自增（复用旧 id 会让前端缓存/引用错乱）');
});

test('§C5 删除不存在的公告应报错', () => {
  reset();
  assert.strictEqual(ann.deleteAnnouncement(12345).ok, false);
});

test('cleanup', () => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
});
