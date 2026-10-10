'use strict';
/**
 * privacy.test.js — 隐私字段出口白名单（纯函数，无依赖）
 *
 * 这是 §K/§F 的**结构性保证**：出口必须干净。用它守住"新接口忘了剔除隐私字段"这一类回归。
 */
const test = require('node:test');
const assert = require('node:assert');
const privacy = require('../src/privacy');

test('stripPrivate 剔除隐私键并保留其它字段', () => {
  const out = privacy.stripPrivate({
    name: '甲', phone: '13800000000', ip: '1.2.3.4', token: 'x',
    nested: { ua: 'UA', rating: 1500 },
  });
  assert.deepStrictEqual(out, { name: '甲', nested: { rating: 1500 } });
});

test('stripPrivate 不修改入参（出口级剔除，数据源保持完整）', () => {
  const src = { phone: '138' };
  privacy.stripPrivate(src);
  assert.strictEqual(src.phone, '138');
});

test('stripPrivate 支持 allow 白名单放行（本人/管理员场景）', () => {
  const out = privacy.stripPrivate({ phone: '138', ip: '1.2.3.4' }, { allow: ['phone'] });
  assert.deepStrictEqual(out, { phone: '138' });
});

test('stripPrivate 递归处理数组与深层嵌套', () => {
  const out = privacy.stripPrivate({ list: [{ ip: '1.1.1.1', id: 1 }, { id: 2, deep: { secret: 's' } }] });
  assert.deepStrictEqual(out, { list: [{ id: 1 }, { id: 2, deep: {} }] });
});

test('assertNoPrivate 返回命中路径；干净数据为空数组', () => {
  assert.deepStrictEqual(privacy.assertNoPrivate({ a: 1 }), []);
  assert.deepStrictEqual(privacy.assertNoPrivate({ a: { phone: '1' } }), ['a.phone']);
  assert.deepStrictEqual(
    privacy.assertNoPrivate(privacy.stripPrivate({ a: { phone: '1' } })),
    [],
  );
});

test('键名大小写不敏感，且连字符/去连字符写法都拦', () => {
  assert.strictEqual(privacy.isPrivateKey('Phone'), true);
  assert.strictEqual(privacy.isPrivateKey('xforwardedfor'), true);
  // ⚠️ 2026-10-03：带连字符的头名写法同样视为隐私（体检发现原表只写了去连字符的写法）
  assert.strictEqual(privacy.isPrivateKey('X-Forwarded-For'), true);
  assert.strictEqual(privacy.isPrivateKey('X-Real-IP'), true);
  assert.strictEqual(privacy.isPrivateKey('User-Agent'), true);
  assert.strictEqual(privacy.isPrivateKey('rating'), false);
});
