'use strict';
/**
 * net.test.js — IP 归一化 / 打码（纯函数，无依赖）
 *
 * ⚠️ `canonV6` 是 net.js 的**内部函数**（未导出），故不在此直接测；
 * 它的行为由 `normalizeIp` 的用例间接覆盖。
 */
const test = require('node:test');
const assert = require('node:assert');
const net = require('../src/net');

test('normalizeIp：去 ::ffff: 前缀 / 去空白 / 空值返回 null', () => {
  assert.strictEqual(net.normalizeIp('::ffff:1.2.3.4'), '1.2.3.4');
  assert.strictEqual(net.normalizeIp(' 1.2.3.4 '), '1.2.3.4');
  assert.strictEqual(net.normalizeIp(''), null);
  assert.strictEqual(net.normalizeIp(null), null);
});

test('normalizeIp：IPv6 归一为小写十六进制且幂等', () => {
  assert.strictEqual(net.normalizeIp('2001:db8::1'), '2001:db8:0:0:0:0:0:1');
  const once = net.normalizeIp('2001:0DB8::0001');
  assert.strictEqual(once, '2001:db8:0:0:0:0:0:1');
  assert.strictEqual(net.normalizeIp(once), once, '归一结果必须稳定（幂等）');
});

test('maskIp：默认打码但保留可核对性；非法值 null', () => {
  assert.strictEqual(net.maskIp('1.2.3.4'), '1.2.*.*');   // 保留前两段网段
  assert.strictEqual(net.maskIp(''), null);
  const v6 = net.maskIp('2001:db8::1');
  if (v6) assert.ok(v6.endsWith(':*'), 'IPv6 应只保留前两组');
});

test('normalizeIp：IPv4 去前导零归一（防限流/计数键被变体绕过）', () => {
  assert.strictEqual(net.normalizeIp('010.2.3.4'), '10.2.3.4');
  assert.strictEqual(net.normalizeIp('1.2.3.04'), '1.2.3.4');
  assert.strictEqual(net.normalizeIp('001.002.003.004'), '1.2.3.4');
  const once = net.normalizeIp('010.2.3.4');
  assert.strictEqual(net.normalizeIp(once), once, '归一结果必须幂等');
  assert.strictEqual(net.normalizeIp('1.2.3.256'), null, '越界段仍返回 null');
});
