'use strict';
/**
 * coords.test.js — USI 坐标转换（纯函数，无依赖）
 * 跑法：node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const coords = require('../src/coords');

test('rank 字母 ↔ y 坐标双向一致（a=一段 … i=九段）', () => {
  assert.strictEqual(coords.rankCharToY('a'), 1);
  assert.strictEqual(coords.rankCharToY('i'), 9);
  for (let y = 1; y <= 9; y += 1) {
    assert.strictEqual(coords.rankCharToY(coords.yToRankChar(y)), y);
  }
});

test('81 个格子的 USI ↔ (x,y) 往返一致', () => {
  for (let x = 1; x <= 9; x += 1) {
    for (let y = 1; y <= 9; y += 1) {
      const sq = coords.xyToUsiSquare(x, y);
      assert.deepStrictEqual(coords.usiSquareToXY(sq), { x, y });
    }
  }
});

test('越界坐标/非法格子名抛错', () => {
  assert.throws(() => coords.xyToUsiSquare(0, 5));
  assert.throws(() => coords.xyToUsiSquare(5, 10));
  assert.throws(() => coords.usiSquareToXY('0a'));
  assert.throws(() => coords.usiSquareToXY('7j'));
  assert.throws(() => coords.parseUsiMove('7g7j'));
});

test('parseUsiMove：移动 / 升变 / 打子', () => {
  assert.deepStrictEqual(coords.parseUsiMove('7g7f'), { type: 'move', from: '7g', to: '7f', promote: false });
  assert.deepStrictEqual(coords.parseUsiMove('8h2b+'), { type: 'move', from: '8h', to: '2b', promote: true });
  assert.deepStrictEqual(coords.parseUsiMove('P*5e'), { type: 'drop', piece: 'P', to: '5e', promote: false });
});

test('moveToUsi 与 parseUsiMove 往返一致', () => {
  for (const usi of ['7g7f', '8h2b+', 'P*5e', 'L*1a', 'R*9i']) {
    assert.strictEqual(coords.moveToUsi(coords.parseUsiMove(usi)), usi);
  }
});
