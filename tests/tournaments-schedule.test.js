/**
 * 赛事时间字段校验契约测试。
 *
 * `validateSchedule` 是「服务端必须再验一遍」的守门函数（前端校验防不了直接构造
 * WS 消息的人）；`numOrNull` 是时间戳归一化的关键小工具。
 *
 * tournaments/store.js 依赖 storage，这里注入空桩。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function stub(rel, exportsObj) {
  const p = require.resolve(path.join(__dirname, '..', rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

stub('src/storage', { readJson: () => ({}), writeJson: () => true });

const { validateSchedule, numOrNull } = require('../src/tournaments/store');

test('numOrNull：合法正数时间戳；空/0/负/NaN/Infinity → null', () => {
  assert.equal(numOrNull(1700000000000), 1700000000000);
  assert.equal(numOrNull('1700000000000'), 1700000000000);
  assert.equal(numOrNull(''), null);
  assert.equal(numOrNull(null), null);
  assert.equal(numOrNull(0), null);
  assert.equal(numOrNull(-5), null);
  assert.equal(numOrNull(NaN), null);
  assert.equal(numOrNull(Infinity), null);
});

test('全空 → 通过（各字段均可选）', () => {
  assert.equal(validateSchedule({}), null);
  assert.equal(validateSchedule(null), null);
});

test('报名区间自洽：结束必须晚于开始', () => {
  assert.equal(validateSchedule({ regStart: 100, regEnd: 200 }), null);
  assert.equal(validateSchedule({ regStart: 200, regEnd: 100 }), '报名结束时间必须晚于报名开始时间');
  assert.equal(validateSchedule({ regStart: 100, regEnd: 100 }), '报名结束时间必须晚于报名开始时间');
});

test('比赛区间自洽：结束必须晚于开始', () => {
  assert.equal(validateSchedule({ matchStart: 100, matchEnd: 200 }), null);
  assert.equal(validateSchedule({ matchStart: 300, matchEnd: 200 }), '比赛结束时间必须晚于比赛开始时间');
});

test('跨区间：比赛开始不得早于报名结束', () => {
  assert.equal(validateSchedule({ regEnd: 200, matchStart: 300 }), null);
  assert.equal(validateSchedule({ regEnd: 300, matchStart: 200 }), '比赛开始时间不能早于报名结束时间');
});

test('字段缺省时不误报（只校验双方都存在的约束）', () => {
  assert.equal(validateSchedule({ regStart: 500 }), null);
  assert.equal(validateSchedule({ matchEnd: 100 }), null);
});
