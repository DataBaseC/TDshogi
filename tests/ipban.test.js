/**
 * tests/ipban.test.js — IP 封禁（PLAN §X）
 *
 * 重点全在**边界**上：网段的位运算、IPv6 的多种等价写法、到期即时放行、白名单、防自锁。
 * 这些地方写错的后果不是"功能不好用"，而是**封错人**或**封不住人**——
 * 前者得罪正常用户，后者等于没做。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// ⚠️ 必须在 require storage 之前设定数据目录——storage 首次 getDb() 就把路径定死了
const TMP = path.join(__dirname, '..', '.tmpdata-ipban');
process.env.DATA_DIR = TMP;
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 首次运行无此目录 */ }

const ipban = require('../src/ipban');
const { writeJson } = require('../src/storage');

/**
 * 每个用例前清空封禁表。
 *
 * ⚠️ **直接清空存储**，而不是"逐条 `unban`"：逐条解封依赖 `list()` 里的 key 能被
 * `parseRule` 解析——库里一旦有旧格式或脏数据就会**漏清**，用例之间互相污染，
 * 表现为"同样的代码时好时坏"（本轮就踩过）。
 */
function reset() {
  ipban._resetCache();
  writeJson('ipbans.json', {});
  ipban._resetCache();
}

test('§X 网段匹配：IPv4 位运算，且主机位归一到网段', () => {
  reset();
  const r = ipban.ban('203.0.113.7/24', { reason: '测试' });
  assert.strictEqual(r.ok, true, r.error || '');
  assert.strictEqual(r.record.ip, '203.0.113.0/24', '主机位应被掩掉，归一到网段地址');

  assert.strictEqual(ipban.check('203.0.113.1').banned, true, '段内地址应命中');
  assert.strictEqual(ipban.check('203.0.113.255').banned, true, '段内末位也应命中');
  assert.strictEqual(ipban.check('203.0.114.1').banned, false, '段外不该命中');
  assert.strictEqual(ipban.check('203.0.112.255').banned, false, '段外另一侧也不该命中');
});

test('§X 单 IP 封禁：只命中那一个地址', () => {
  reset();
  ipban.ban('198.51.100.5', { reason: '测试' });
  assert.strictEqual(ipban.check('198.51.100.5').banned, true);
  assert.strictEqual(ipban.check('198.51.100.6').banned, false, '同段其他地址不该被牵连');
});

test('§X IPv6：压缩 / 展开 / 大小写是同一个地址，必须都命中', () => {
  reset();
  ipban.ban('2001:db8::/64', { reason: 'IPv6 测试' });
  // ⚠️ 本测试的重点：字符串比对会被这些等价写法轻松绕过
  assert.strictEqual(ipban.check('2001:db8::1').banned, true, '压缩写法');
  assert.strictEqual(ipban.check('2001:0db8:0000:0000:0000:0000:0000:0001').banned, true, '完整展开写法');
  assert.strictEqual(ipban.check('2001:0DB8:0:0:0:0:0:0001').banned, true, '大写 + 混合省略');
  assert.strictEqual(ipban.check('2001:db9::1').banned, false, '段外不该命中');
});

test('§X 到期即时放行（不依赖定时清理）', () => {
  reset();
  ipban.ban('192.0.2.10', { reason: '测试', hours: 1 });
  assert.strictEqual(ipban.check('192.0.2.10').banned, true);
  const later = Date.now() + 2 * 3600 * 1000;
  assert.strictEqual(ipban.check('192.0.2.10', later).banned, false,
    '到期必须立刻放行——若靠定时清理，用户会遇到"明明到期了还进不来"');
});

test('§X 永久封禁：不设 expiresAt', () => {
  reset();
  const r = ipban.ban('192.0.2.20', { reason: '测试', hours: null });
  assert.strictEqual(r.record.expiresAt, null);
  assert.strictEqual(ipban.check('192.0.2.20', Date.now() + 10 * 365 * 24 * 3600 * 1000).banned, true);
});

test('§X 白名单：内网 / 回环永不被封，也不允许被封', () => {
  reset();
  assert.strictEqual(ipban.isWhitelisted('127.0.0.1'), true);
  assert.strictEqual(ipban.isWhitelisted('10.1.2.3'), true);
  assert.strictEqual(ipban.isWhitelisted('172.16.5.5'), true);
  assert.strictEqual(ipban.isWhitelisted('192.168.1.1'), true);
  assert.strictEqual(ipban.isWhitelisted('::1'), true);
  assert.strictEqual(ipban.isWhitelisted('8.8.8.8'), false);

  const r = ipban.ban('10.0.0.0/8', { reason: '不该允许' });
  assert.strictEqual(r.ok, false, '内网段不允许封禁（否则一次误操作就能把自己/监控关在门外）');
});

test('§X 参数校验：理由必填、前缀与时长合法', () => {
  reset();
  assert.strictEqual(ipban.ban('192.0.2.30', { reason: '' }).ok, false, '空理由应拒绝');
  assert.strictEqual(ipban.ban('192.0.2.30', { reason: '   ' }).ok, false, '纯空白理由应拒绝');
  assert.strictEqual(ipban.ban('192.0.2.30', { reason: 'x'.repeat(201) }).ok, false, '超长理由应拒绝');
  assert.strictEqual(ipban.ban('192.0.2.30', { reason: 'ok', hours: 0 }).ok, false, '0 小时不合法');
  assert.strictEqual(ipban.ban('192.0.2.30', { reason: 'ok', hours: -1 }).ok, false, '负数不合法');
  assert.strictEqual(ipban.ban('not-an-ip', { reason: 'ok' }).ok, false, '非法 IP 应拒绝');
  assert.strictEqual(ipban.ban('192.0.2.0/33', { reason: 'ok' }).ok, false, 'IPv4 前缀越界应拒绝');
  assert.strictEqual(ipban.ban('2001:db8::/129', { reason: 'ok' }).ok, false, 'IPv6 前缀越界应拒绝');
  assert.strictEqual(ipban.ban('192.0.2.30', { reason: 'ok' }).ok, true, '合法参数应通过');
});

test('§X 默认时长 24 小时（NAT 共享 IP 的保守默认）', () => {
  reset();
  const r = ipban.ban('192.0.2.40', { reason: '测试' });
  const hours = (r.record.expiresAt - r.record.bannedAt) / 3600000;
  assert.ok(Math.abs(hours - 24) < 0.01, `默认应为 24 小时，实际 ${hours}`);
});

test('§X 解封与延长', () => {
  reset();
  ipban.ban('192.0.2.50', { reason: '测试', hours: 1 });
  const before = ipban.list()[0].expiresAt;

  assert.strictEqual(ipban.extend('192.0.2.50', 24).ok, true);
  const after = ipban.list()[0].expiresAt;
  assert.ok(Math.abs((after - before) / 3600000 - 24) < 0.01, '延长应在原到期时间上叠加 24h');

  assert.strictEqual(ipban.unban('192.0.2.50').ok, true);
  assert.strictEqual(ipban.check('192.0.2.50').banned, false);
  assert.strictEqual(ipban.unban('192.0.2.50').ok, false, '重复解封应报错');
  assert.strictEqual(ipban.extend('192.0.2.50', 1).ok, false, '已解封的不能延长');
});

test('§X 永久封禁不允许延长（无意义）', () => {
  reset();
  ipban.ban('192.0.2.60', { reason: '测试', hours: null });
  assert.strictEqual(ipban.extend('192.0.2.60', 24).ok, false);
});

test('§X 防自锁：covers 用位运算，字符串比对看不出"把自己也封了"', () => {
  // 管理员在 10.0.0.5，想封 10.0.0.0/24 —— 这类判定只有位运算能算对
  assert.strictEqual(ipban.covers('10.0.0.0/24', '10.0.0.5'), true, '自己落在待封网段内');
  assert.strictEqual(ipban.covers('10.0.0.5', '10.0.0.5'), true, '封自己的原地址');
  assert.strictEqual(ipban.covers('10.0.0.0/24', '10.0.1.5'), false, '同段外不受影响');
  assert.strictEqual(ipban.covers('2001:db8::/64', '2001:db8::1'), true);
  assert.strictEqual(ipban.covers('2001:db8::/64', '2001:db9::1'), false);
  assert.strictEqual(ipban.covers('10.0.0.0/8', '2001:db8::1'), false, '跨协议不应误判');
});

test('§X 重启后仍生效（落盘 → 丢缓存重读）', () => {
  reset();
  ipban.ban('198.51.100.99', { reason: '持久化测试', hours: 24 });
  ipban._resetCache(); // 模拟进程重启
  assert.strictEqual(ipban.check('198.51.100.99').banned, true, '重启后必须仍然生效');
  assert.strictEqual(ipban.list().length, 1);
});

test('§X 命中计数：用来判断"这条封禁到底有没有用"', () => {
  reset();
  ipban.ban('192.0.2.70', { reason: '计数测试' });
  ipban.check('192.0.2.70');
  ipban.check('192.0.2.70');
  ipban.check('192.0.2.80'); // 不命中
  const rec = ipban.list()[0];
  assert.strictEqual(rec.hits, 2, '只统计真正命中的请求');
  assert.ok(rec.lastHitAt, '应记录最近命中时刻');
});

test('§X 同一网段重复封禁归并为一条记录', () => {
  reset();
  ipban.ban('203.0.113.7/24', { reason: '第一次' });
  ipban.ban('203.0.113.200/24', { reason: '第二次' });
  const list = ipban.list();
  assert.strictEqual(list.length, 1, '同段不同主机位应归并为一条（后写覆盖）');
  assert.strictEqual(list[0].reason, '第二次');
});

test('§X pruneExpired 只打扫过期已久的记录，不影响生效中的封禁', () => {
  reset();
  const b1 = ipban.ban('192.0.2.90', { reason: '过期很久', hours: 1 });
  const b2 = ipban.ban('192.0.2.91', { reason: '生效中', hours: 24 });
  assert.strictEqual(b1.ok, true, `第 1 条封禁应成功：${b1.error}`);
  assert.strictEqual(b2.ok, true, `第 2 条封禁应成功：${b2.error}`);
  assert.strictEqual(ipban.list().length, 2, '前置条件：应有两条封禁记录');

  // ⚠️ 关键点：`pruneExpired` 清的是"过期时间 + keepMs"都已过去很久的记录。
  // 所以这两条要拉开距离——否则同一个 keepMs 会把它们一起清掉，测不出"保留生效中的"。
  const future = Date.now() + 7.5 * 24 * 3600 * 1000;

  const n = ipban.pruneExpired(future);
  assert.strictEqual(n, 1, '只清掉过期很久的那条');
  const kept = ipban.list();
  assert.strictEqual(kept.length, 1, '较晚到期的那条应保留');
  assert.strictEqual(kept[0].reason, '生效中');
  assert.strictEqual(ipban.check('192.0.2.91', Date.now()).banned, true, '仍在有效期内就必须照常命中');
});

test('§X 非法/空 IP 不炸（返回未封禁）', () => {
  reset();
  assert.strictEqual(ipban.check('').banned, false);
  assert.strictEqual(ipban.check(null).banned, false);
  assert.strictEqual(ipban.check('garbage').banned, false);
  assert.strictEqual(ipban.check('1.2.3.999').banned, false);
  assert.strictEqual(ipban.parseRule(''), null);
  assert.strictEqual(ipban.parseRule('::gggg'), null);
});

test('cleanup', () => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
});
