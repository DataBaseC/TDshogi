'use strict';
/**
 * room-password.test.js — 私人房间密码（`src/room-password.js`，PLAN §T2）
 *
 * 这是**安全相关**逻辑：多放一个人进来 = 隐私泄露，错挡一个合法用户 = 功能坏了。
 * 抽成纯函数模块后，两条边界都能在这里守住（这也是当初把它从 rooms.js 抽出来的原因）。
 */
const test = require('node:test');
const assert = require('node:assert');
const rp = require('../src/room-password');

test('hash：同一密码两次哈希结果不同（随机盐），但都能通过校验', () => {
  const a = rp.hash('1234');
  const b = rp.hash('1234');
  assert.notStrictEqual(a, b, '盐随机 → 相同密码的哈希不应相同（防彩虹表）');
  assert.strictEqual(rp.verify(a, '1234'), true);
  assert.strictEqual(rp.verify(b, '1234'), true);
});

test('hash：结果里不含明文密码，格式为 salt:hash', () => {
  const h = rp.hash('secret77');
  assert.ok(!h.includes('secret77'), '哈希串不应出现明文');
  assert.strictEqual(h.split(':').length, 2, '应为 salt:hash');
});

test('verify：密码错误 / 缺失 / 类型不对，一律拒绝', () => {
  const h = rp.hash('1234');
  assert.strictEqual(rp.verify(h, '1235'), false, '错误密码');
  assert.strictEqual(rp.verify(h, ''), false, '空密码');
  assert.strictEqual(rp.verify(h, undefined), false, '未提供');
  assert.strictEqual(rp.verify(h, 1234), false, '非字符串');
  assert.strictEqual(rp.verify(h, '1234 '), false, '前后空格算不同密码');
});

test('verify：房间未设密码（stored 为空）时一律放行', () => {
  assert.strictEqual(rp.verify(null, ''), true);
  assert.strictEqual(rp.verify(null, undefined), true);
  assert.strictEqual(rp.verify('', '随便填'), true);
});

test('verify：损坏的哈希串只判否，绝不抛错', () => {
  // 这几条走的是「长度不等 → 提前返回」分支；
  // 若实现改成直接 timingSafeEqual，长度不等会抛错，本用例即是护栏
  assert.strictEqual(rp.verify('garbage', '1234'), false);
  assert.strictEqual(rp.verify(':', '1234'), false);
  assert.strictEqual(rp.verify('salt:', '1234'), false);
  assert.strictEqual(rp.verify('只有盐没有哈希', '1234'), false);
});

test('isValid：4–8 位合法；留空也合法（表示不设密码）', () => {
  assert.strictEqual(rp.isValid(''), true, '留空 = 不设密码');
  assert.strictEqual(rp.isValid(null), true);
  assert.strictEqual(rp.isValid('abc'), false, '少于 4 位');
  assert.strictEqual(rp.isValid('abcd'), true, '恰好 4 位');
  assert.strictEqual(rp.isValid('abcdefgh'), true, '恰好 8 位');
  assert.strictEqual(rp.isValid('abcdefghi'), false, '超过 8 位');
});

test('非 ASCII 密码（中文）同样可用', () => {
  const h = rp.hash('密码测试');
  assert.strictEqual(rp.verify(h, '密码测试'), true);
  assert.strictEqual(rp.verify(h, '密码测'), false);
});

test('MIN / MAX 常量与实际校验一致', () => {
  assert.strictEqual(rp.isValid('a'.repeat(rp.MIN)), true);
  assert.strictEqual(rp.isValid('a'.repeat(rp.MIN - 1)), false);
  assert.strictEqual(rp.isValid('a'.repeat(rp.MAX)), true);
  assert.strictEqual(rp.isValid('a'.repeat(rp.MAX + 1)), false);
});
