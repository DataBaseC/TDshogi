/**
 * tests/swiss.test.js — 瑞士制配对（PLAN §V-T8）
 *
 * 配对算法的正确性只能靠单测钉死：它全是边界（不重复对阵、奇数轮空、
 * 配不出来时的退让、同分时的确定性排序）。这些地方错了的表现是
 * "两个人被安排打第二次"或"同样的数据两次算出不同对阵"——
 * 前者破坏公平，后者让赛程无法复现。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const swiss = require('../src/swiss');

/** 造 n 个选手 */
function players(n) {
  return Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), name: '选手' + (i + 1) }));
}

/**
 * 造一轮：pairs 用 [1,2] 这种编号（内部转成 p1/p2）。
 * winner 传编号（胜方）、`'-'`（和棋）或 `null`（尚未出结果）。
 * ⚠️ 和棋的标记就是裸的 `'-'`，不能拼成 `'p-'`——与 `ratings.applyGameResult` 同一约定。
 */
function round(roundNo, pairs, winners, byes) {
  const results = {};
  (pairs || []).forEach((pair, i) => {
    const [a, b] = pair.map((x) => 'p' + x);
    const w = winners ? winners[i] : null;
    results[swiss.pairKey(a, b)] = (w == null) ? undefined : (w === '-' ? '-' : 'p' + w);
  });
  return {
    round: roundNo,
    pairs: (pairs || []).map(([a, b]) => ['p' + a, 'p' + b]),
    byes: (byes || []).map((x) => 'p' + x),
    results,
  };
}

test('§T8 积分：胜 1 / 和 0.5 / 负 0，轮空得 1 分且计入胜场', () => {
  const st = swiss.computeStandings(players(4), [
    round(1, [[1, 2], [3, 4]], [1, '-']),  // 1 胜；3-4 和
    round(2, [[1, 3]], [3], [4]),          // 3 胜；4 轮空
  ]);
  assert.strictEqual(st.get('p1').score, 1, '一胜');
  assert.strictEqual(st.get('p2').score, 0, '一负');
  assert.strictEqual(st.get('p3').score, 1.5, '一胜(1) + 一和(0.5)');
  assert.strictEqual(st.get('p4').score, 1.5, '一和(0.5) + 轮空(视同胜，1)');
  assert.strictEqual(st.get('p4').byes, 1, '轮空次数要单独记（用于"不让同一个人反复轮空"）');
});

test('§T8 积分：未出结果的对局双方都不得分', () => {
  const st = swiss.computeStandings(players(2), [round(1, [[1, 2]], [null])]);
  assert.strictEqual(st.get('p1').score, 0, '还没出结果不得分');
  assert.strictEqual(st.get('p2').score, 0);
  assert.deepStrictEqual(st.get('p1').opponents, ['p2'], '但对手关系要记下（用于避免重复对阵）');
});

test('§T8 名次：积分 → 对手分 → 参赛序（**确定性**）', () => {
  const st = swiss.computeStandings(players(4), [
    round(1, [[1, 2], [3, 4]], [1, 3]),
  ]);
  const ranked = swiss.rankStandings(Array.from(st.values()));
  assert.strictEqual(ranked.length, 4);
  assert.strictEqual(ranked[0].score, 1);
  // ⚠️ 同分同对手分时，必须按**参赛顺序**兜底——否则两次调用可能得到不同顺序，
  // 配对就会跟着变（测试会随机失败，线上会莫名换对手）。
  const again = swiss.rankStandings(Array.from(st.values()));
  assert.deepStrictEqual(ranked.map((e) => e.id), again.map((e) => e.id), '同样输入必须得到同样顺序');
  assert.strictEqual(ranked[0].id, 'p1', '同为 1 分时，参赛序靠前者排前');
});

test('§T8 配对：首轮按 1-2、3-4、5-6 相邻配', () => {
  const st = swiss.computeStandings(players(6), []);
  const r = swiss.pairRound({ standings: st });
  assert.deepStrictEqual(r.pairs, [['p1', 'p2'], ['p3', 'p4'], ['p5', 'p6']]);
  assert.deepStrictEqual(r.byes, []);
  assert.strictEqual(r.degraded, false);
});

test('§T8 配对：**不重复对阵**（瑞士制的核心）', () => {
  // 4 人打了两轮后，第 3 轮必须避开已交手过的组合
  const st = swiss.computeStandings(players(4), [
    round(1, [[1, 2], [3, 4]], [1, 3]),
    // 第 2 轮：胜者相遇（1 vs 3）、负者相遇（2 vs 4）
    round(2, [[1, 3], [2, 4]], [1, 2]),
  ]);
  const r = swiss.pairRound({ standings: st });
  const pairs = r.pairs.map((p) => p.slice().sort().join('-')).sort();
  assert.deepStrictEqual(pairs, ['p1-p4', 'p2-p3'], '第 3 轮应为 1-4 与 2-3（都没打过）');
});

test('§T8 配对：奇数人 → 最低分且未轮空者轮空', () => {
  const st = swiss.computeStandings(players(5), [
    round(1, [[1, 2], [3, 4]], [1, 3], [5]), // p5 已轮空过
    round(2, [[1, 3], [2, 5]], [1, 2]),
  ]);
  const r = swiss.pairRound({ standings: st });
  assert.strictEqual(r.pairs.length, 2, '5 人 → 2 场 + 1 轮空');
  assert.strictEqual(r.byes.length, 1);
  assert.notStrictEqual(r.byes[0], 'p5', '应优先让**没轮空过**的人轮空');
  assert.strictEqual(r.byes[0], 'p4', '当年最低分且未轮空的是 p4');
});

test('§T8 配对：全都轮空过时仍能推出一个（不让赛事卡住）', () => {
  const st = swiss.computeStandings(players(3), [
    round(1, [[1, 2]], [1], [3]),
    round(2, [[1, 3]], [1], [2]),
  ]);
  const r = swiss.pairRound({ standings: st });
  assert.strictEqual(r.byes.length, 1, '3 人时必须有人轮空（否则配不成）');
  assert.ok(r.pairs.length === 1);
});

test('§T8 配对：配不出新对手时**退让**并标注 degraded，绝不抛错', () => {
  // 2 人打了一轮后，第 2 轮只有重复对阵这一个选择
  const st = swiss.computeStandings(players(2), [
    round(1, [[1, 2]], [1]),
  ]);
  const r = swiss.pairRound({ standings: st });
  assert.strictEqual(r.pairs.length, 1, '2 人必须能配上');
  assert.deepStrictEqual(r.pairs[0].slice().sort(), ['p1', 'p2']);
  // 2 人赛重复对阵是**唯一可行解**，属于合理退让而不是 bug
  assert.strictEqual(r.degraded, true, '应标注为退让解，让主办人知道这轮不完美');
});

test('§T8 配对：人数不足 2 不抛错', () => {
  assert.doesNotThrow(() => swiss.pairRound({ standings: swiss.computeStandings(players(1), []) }));
  const r = swiss.pairRound({ standings: swiss.computeStandings(players(1), []) });
  assert.deepStrictEqual(r.pairs, []);
  assert.deepStrictEqual(r.byes, ['p1'], '独苗应轮空而不是报错');

  const empty = swiss.pairRound({ standings: swiss.computeStandings([], []) });
  assert.deepStrictEqual(empty.pairs, []);
});

test('§T8 配对：奇数人且不允许轮空 → 明确返回 degraded 与原因', () => {
  const st = swiss.computeStandings(players(3), []);
  const r = swiss.pairRound({ standings: st, allowBye: false });
  assert.strictEqual(r.degraded, true);
  assert.match(r.reason, /轮空/);
  assert.deepStrictEqual(r.pairs, []);
});

test('§T8 配对：8 人连打 3 轮，全程不重复对阵', () => {
  let rounds = [];
  const ps = players(8);
  for (let i = 0; i < 3; i++) {
    const st = swiss.computeStandings(ps, rounds);
    const r = swiss.pairRound({ standings: st });
    assert.strictEqual(r.degraded, false, `第 ${i + 1} 轮不应退让（8 人打 3 轮有充裕的组合）`);
    assert.strictEqual(r.pairs.length, 4, `第 ${i + 1} 轮应有 4 场`);
    // 每轮把先手方判胜，制造分数分化（更接近真实赛程）
    rounds = rounds.concat([{
      round: i + 1,
      pairs: r.pairs,
      byes: r.byes,
      results: r.pairs.reduce((acc, [a, b]) => { acc[swiss.pairKey(a, b)] = a; return acc; }, {}),
    }]);
  }
  // 汇总检查：任意两人最多交手一次
  const seen = new Set();
  for (const rd of rounds) {
    for (const [a, b] of rd.pairs) {
      const k = swiss.pairKey(a, b);
      assert.strictEqual(seen.has(k), false, `${k} 被重复安排了对阵`);
      seen.add(k);
    }
  }
  assert.strictEqual(seen.size, 12, '3 轮 × 4 场 = 12 对不同组合');
});

test('§T8 建议轮数：ceil(log2(n))，最少 3 轮', () => {
  assert.strictEqual(swiss.suggestRounds(2), 3);
  assert.strictEqual(swiss.suggestRounds(4), 3);
  assert.strictEqual(swiss.suggestRounds(8), 3);
  assert.strictEqual(swiss.suggestRounds(16), 4);
  assert.strictEqual(swiss.suggestRounds(32), 5);
  assert.strictEqual(swiss.suggestRounds(0), 3, '异常输入不应炸');
});
