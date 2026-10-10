'use strict';
/**
 * tournament-bracket.test.js — 单败淘汰对阵表回归
 *
 * 守两点（2026-10-05 审查修复）：
 *   P1：轮空一路走到根时**必须收尾**（设冠军 + status=finished），否则赛事永久卡 playing；
 *   P2：标准**种子布点**——不满员时空位优先落在高种子对面，而非全挤在叶序最右端。
 *
 * 依赖桩：真 src/storage 依赖 better-sqlite3（沙箱未装），用内存桩替换。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
function stub(rel, exports) {
  const p = require.resolve(path.join(SRC, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
stub('storage', { readJson: () => ({}), writeJson: () => true, listJsonByPrefix: () => [], deleteJson: () => true });
stub('logger', { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } });

const store = require(path.join(SRC, 'tournaments', 'store'));
const bracket = require(path.join(SRC, 'tournaments', 'bracket'));
store.setMatchFactory(() => ({})); // 满足 assignNextMatches 的守卫（本测试不建房）

test('makeBracket 标准种子布点(size=8)：1、2 号种子分处两端', () => {
  const players = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + (i + 1), name: 'P' + (i + 1) }));
  const nodes = bracket.makeBracket(8, players);
  const leafStart = 7;
  const at = (pos) => nodes[leafStart + pos].playerId;
  // seedOrder(8) = [1,8,5,4,3,6,7,2]
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 6, 7].map(at),
    ['p1', 'p8', 'p5', 'p4', 'p3', 'p6', 'p7', 'p2']);
});

test('childState：子节点为叶子/空位判 settled；两位种子分处不同半区', () => {
  const nodes = bracket.makeBracket(4, [{ id: 'A' }, { id: 'B' }]); // seed1→pos0, seed2→pos3
  const s1 = bracket.childState(nodes, 1);
  const s2 = bracket.childState(nodes, 2);
  assert.strictEqual(s1.settled, true);
  assert.strictEqual(s2.settled, true);
  assert.ok(s1.winner && s2.winner);
  assert.notStrictEqual(s1.winner, s2.winner, '两位选手分处不同半区（种子布点）');
});

test('P1 回归：轮空到根 ⇒ 收尾（championId + status=finished），不再卡死', () => {
  // size=4 仅 1 名选手：根的两个子树皆由轮空定出胜者、根亦“一边空” → 本无决赛
  const t = { id: 'T1', size: 4, status: 'playing', bracket: bracket.makeBracket(4, [{ id: 'A', name: 'A' }]) };
  bracket.assignNextMatches(t);
  assert.strictEqual(t.championId, 'A', '轮空到根必须产生冠军');
  assert.strictEqual(t.status, 'finished', '必须收尾为 finished');
});

test('P2 回归：不满员时空位不集中在最右（seedOrder 生效）', () => {
  const players = Array.from({ length: 5 }, (_, i) => ({ id: 'p' + (i + 1) })); // 种子 1..5
  const nodes = bracket.makeBracket(8, players);
  const leafStart = 7;
  const at = (pos) => nodes[leafStart + pos].playerId;
  // seedOrder(8)=[1,8,5,4,3,6,7,2] → 种子 8/6/7 空缺 → pos1 / pos5 / pos6 为空
  assert.deepStrictEqual([1, 5, 6].map(at), [null, null, null]);
  assert.strictEqual(at(0), 'p1');
  assert.strictEqual(at(3), 'p4'); // 不是“空位全在最右”
  assert.strictEqual(at(7), 'p2');
});
