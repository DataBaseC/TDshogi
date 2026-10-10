/**
 * ratings 契约测试：ELO 结算 + 等级/经验换算。
 *
 * 这是「公平性」核心：算错了影响所有玩家的积分。`expectedScore` 未导出，故通过
 * `applyGameResult` 的**行为契约**（改动量、符号、对称性）来测。
 *
 * ratings 依赖 storage（读写 ratings.json）与 auth，这里注入内存桩。
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
stub('src/auth', { listSessions: () => [] });

const ratings = require('../src/ratings');
const { K, START_RATING, MAX_LEVEL, applyGameResult, levelFromExp, nextLevelExp } = ratings;

test('定级：新玩家从 START_RATING 起算', () => {
  assert.equal(START_RATING, 1500);
});

test('同分对局：胜方 +K/2、负方 -K/2（ELO 基本性质）', () => {
  const d = applyGameResult('elo-a1', 'elo-b1', 'b');
  assert.equal(d.deltaA, K / 2);
  assert.equal(d.deltaB, -K / 2);
});

test('同分对局：和棋双方 0 变动', () => {
  const d = applyGameResult('elo-c1', 'elo-d1', '-');
  assert.equal(d.deltaA, 0);
  assert.equal(d.deltaB, 0);
});

test('胜负对称：by 胜负方向相反且幅度相等', () => {
  const loss = applyGameResult('elo-e1', 'elo-f1', 'w'); // A 负
  assert.equal(loss.deltaA, -K / 2);
  assert.equal(loss.deltaB, K / 2);
});

test('等级：levelFromExp(nextLevelExp(L)) === L+1（换算自洽）', () => {
  for (let L = 0; L < 12; L++) {
    assert.equal(levelFromExp(nextLevelExp(L)), L + 1, `L=${L}`);
  }
});

test('等级：exp=0 → 0 级；单调不减；封顶 MAX_LEVEL', () => {
  assert.equal(levelFromExp(0), 0);
  let prev = -1;
  for (const e of [0, 1, 2, 6, 14, 30, 62, 126, 254, 100000]) {
    const l = levelFromExp(e);
    assert.ok(l >= prev, `exp=${e} 等级应单调不减`);
    prev = l;
  }
  // 注意：2^53 量级只到 52 级，要触及 64 级封顶需要浮点仍可表示的更大指数
  assert.equal(levelFromExp(1e20), MAX_LEVEL);
});

test('等级：非法输入（负数/NaN/字符串）回落到 0，不抛异常', () => {
  assert.equal(levelFromExp(-100), 0);
  assert.equal(levelFromExp(NaN), 0);
  assert.equal(levelFromExp('abc'), 0);
});
