/**
 * 棋种映射单元测试（PLAN §P1）
 *
 * 这些断言的存在意义：PLAN §J3「吃馬却多出飞车」就是 DEMOTE 表里写错一个字，
 * 潜伏到用户在棋盘上吃子才暴露。现在映射一改错，这里立刻红。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// 浏览器环境最小替身：piece-kinds.js 以 IIFE 挂到 window（Node 下回落到 globalThis）
globalThis.window = globalThis.window || {};
require(path.join(__dirname, '../public/js/piece-kinds.js'));
const K = globalThis.window.PieceKinds;

test('映射自检通过（PROMOTE 与 DEMOTE 严格互逆）', () => {
  assert.deepStrictEqual(K.validate(), []);
});

test('每个基本棋种升变后再还原会得到自己', () => {
  for (const base of ['歩', '香', '桂', '銀', '角', '飛']) {
    assert.strictEqual(K.rawOf(K.PROMOTE[base]), base, `${base} 升变还原失败`);
  }
});

test('成駒还原为正确的原始棋种（J3 回归）', () => {
  assert.strictEqual(K.rawOf('馬'), '角');   // 曾错写成 '飛'
  assert.strictEqual(K.rawOf('龍'), '飛');
  assert.strictEqual(K.rawOf('と'), '歩');
  // 日式别名
  assert.strictEqual(K.rawOf('杏'), '香');
  assert.strictEqual(K.rawOf('圭'), '桂');
  assert.strictEqual(K.rawOf('全'), '銀');
  // 中文写法
  assert.strictEqual(K.rawOf('成香'), '香');
  assert.strictEqual(K.rawOf('成桂'), '桂');
  assert.strictEqual(K.rawOf('成銀'), '銀');
});

test('未成棋种与不可升变棋种还原为自己', () => {
  for (const name of ['歩', '金', '玉', '角', '飛']) {
    assert.strictEqual(K.rawOf(name), name);
  }
});

test('金与玉不可升变', () => {
  assert.strictEqual(K.promoteOf('金'), null);
  assert.strictEqual(K.promoteOf('玉'), null);
  assert.strictEqual(K.promoteOf('歩'), 'と');
});

test('成駒判定', () => {
  assert.ok(K.isPromoted('馬'));
  assert.ok(K.isPromoted('杏'));
  assert.ok(!K.isPromoted('角'));
  assert.ok(!K.isPromoted('金'));
});

test('打子符号双向映射覆盖七种', () => {
  const syms = ['P', 'L', 'N', 'S', 'G', 'B', 'R'];
  for (const s of syms) {
    const name = K.nameOfDrop(s);
    assert.ok(name, `${s} 缺少中文名`);
    assert.strictEqual(K.dropSymOf(name), s, `${name} 反查符号失败`);
  }
  // 成駒与玉不可打入
  assert.strictEqual(K.dropSymOf('馬'), null);
  assert.strictEqual(K.dropSymOf('玉'), null);
});

test('NAME_TO_KEY 覆盖所有可出现的棋名', () => {
  const names = ['歩', '香', '桂', '銀', '金', '角', '飛', '玉', '王',
    'と', '成香', '杏', '成桂', '圭', '成銀', '全', '馬', '龍'];
  for (const n of names) {
    assert.ok(K.NAME_TO_KEY[n], `${n} 缺少 kind 映射`);
  }
});
