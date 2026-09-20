/**
 * 駒落ち（让子）单元测试（PLAN §D 玩法项）
 *
 * 这些断言的存在意义：手合割就是一张**坐标表**，写错一格不会报错，
 * 只会生成一个"看起来正常、其实少错了一枚棋子"的局面——而让子局的对局结果、
 * 棋谱导出都建立在这张表上。所以这里逐条钉：**落点为空、其余同类棋子还在、手番正确**。
 *
 * 尤其 `香落ち` 落的是**与上手角行同侧**的那枚香（连盟：「上手左侧（角のあるほう）の香」）
 * ——这是最容易搞反的一处（`9i` 而不是 `1i`）。
 */
const test = require('node:test');
const assert = require('node:assert');

const H = require('../src/handicap');
const { Game, STARTING_SFEN } = require('../src/game');

/** 数某个座位上还剩多少枚棋子 */
function countPieces(g, color) {
  let n = 0;
  for (const row of g.state().board) {
    for (const cell of row) if (cell && cell.piece && cell.color === color) n++;
  }
  return n;
}

/** 取某一格的棋子（USI 格名）；空格返回 null */
function pieceAt(g, sq) {
  for (const row of g.state().board) {
    for (const cell of row) if (cell && cell.sq === sq) return cell.piece || null;
  }
  return null;
}

test('让子表自检：id 唯一、落子在棋盘内、互不重复', () => {
  const ids = new Set();
  for (const d of H.list()) {
    assert.ok(!ids.has(d.id), `id 重复: ${d.id}`);
    ids.add(d.id);
    assert.ok(d.label, `${d.id} 缺 label`);
    const seen = new Set();
    for (const sq of d.removed) {
      assert.match(sq, /^[1-9][a-i]$/, `${d.id} 的格名非法: ${sq}`);
      assert.ok(!seen.has(sq), `${d.id} 的落点重复: ${sq}`);
      seen.add(sq);
    }
  }
  assert.strictEqual(H.list()[0].id, 'even', '第一项应是平手（前端下拉的默认项）');
});

test('平手：局面与 `STARTING_SFEN` 完全一致', () => {
  assert.strictEqual(H.get('even').startSfen, STARTING_SFEN, '平手必须是既有常量本身，不能另算一份');
  assert.deepStrictEqual(H.get('even').removed, []);
});

test('每个手合割：上手少掉的棋子数正好等于落子数，下手一枚不少', () => {
  for (const d of H.list()) {
    const g = new Game(d.startSfen);
    assert.strictEqual(countPieces(g, 'w'), 20, `${d.label}: 下手（w）应始终 20 枚`);
    assert.strictEqual(countPieces(g, 'b'), 20 - d.removed.length,
      `${d.label}: 上手（b）应为 ${20 - d.removed.length} 枚`);
    assert.strictEqual(g.turn, 'b', `${d.label}: 让子局应为上手（b）先手`);
    assert.strictEqual(d.startSfen.split(' ')[1], 'b', `${d.label}: SFEN 手番应为 b`);
    // 上手有棋可下（存在合法着法）——否则这个手合割根本没法开局
    assert.ok(g.legalMovesUsi().length > 0, `${d.label}: 上手应有合法着法`);
  }
});

test('香落ち：落的是与上手角行同侧的那枚香（9i，不是 1i）', () => {
  const g = new Game(H.get('lance').startSfen);
  assert.strictEqual(pieceAt(g, '9i'), null, '9i（角同侧）应被落掉');
  assert.strictEqual(pieceAt(g, '1i'), '香', '1i 的另一枚香必须还在');
  assert.strictEqual(pieceAt(g, '8h'), '角', '角行不受香落ち影响');

  // 「角のあるほう」= 9 筋侧：这条断言就是为了防"把左右搞反"
  const right = new Game(H.get('lance-right').startSfen);
  assert.strictEqual(pieceAt(right, '1i'), null, '右香落ち落 1i');
  assert.strictEqual(pieceAt(right, '9i'), '香', '右香落ち时 9i 仍在');
});

test('标准阶梯：二枚 ⊂ 四枚 ⊂ 六枚 ⊂ 八枚 ⊂ 十枚（逐级累加）', () => {
  const order = ['two', 'four', 'six', 'eight', 'ten'];
  for (let i = 1; i < order.length; i++) {
    const prev = new Set(H.get(order[i - 1]).removed);
    const cur = H.get(order[i]).removed;
    for (const sq of prev) assert.ok(cur.includes(sq), `${order[i]} 应包含 ${order[i - 1]} 的落点 ${sq}`);
    assert.ok(cur.length > prev.size, `${order[i]} 应比上一级多落子`);
  }
});

test('十枚落ち：上手只剩玉与歩（1 玉 + 9 歩）', () => {
  const g = new Game(H.get('ten').startSfen);
  const mine = [];
  for (const row of g.state().board) {
    for (const cell of row) if (cell && cell.piece && cell.color === 'b') mine.push(cell.piece);
  }
  assert.strictEqual(mine.length, 10, '上手应为 10 枚');
  assert.strictEqual(mine.filter((p) => p === '玉').length, 1, '有且只有一枚玉');
  assert.strictEqual(mine.filter((p) => p === '歩').length, 9, '其余全是歩');
});

test('生成的局面能被规则引擎正常驱动（走一手后手番与记谱都正常）', () => {
  const g = new Game(H.get('two').startSfen);
  const moves = g.legalMovesUsi();
  const mv = moves.find((m) => /^[1-9][a-i][1-9][a-i]$/.test(m)) || moves[0];
  const r = g.applyMove(mv);
  assert.strictEqual(r.ok, true, `上手第一手 ${mv} 应当合法（${r.error || ''}）`);
  assert.strictEqual(g.turn, 'w', '走完一手应轮到下手');
  assert.strictEqual(g.moves.length, 1);

  // 记谱链路（棋谱导出用的就是它）也要能跑：它就是拿 startSfen 重放的
  const { movesToKif } = require('../src/records');
  const kif = movesToKif(g.startSfen, [mv]);
  assert.strictEqual(kif.length, 1, '应能算出 1 手记谱');
  assert.ok(kif[0], '记谱内容不能为空');
});

test('normalize：空/平手 → null（不让子），未知 id → false（调用方据此拒绝）', () => {
  assert.strictEqual(H.normalize(''), null);
  assert.strictEqual(H.normalize(null), null);
  assert.strictEqual(H.normalize(undefined), null);
  assert.strictEqual(H.normalize('even'), null);
  assert.strictEqual(H.normalize('平手'), null);
  assert.strictEqual(H.normalize('nope'), false, '未知手合割必须与"不让子"区分开');
  assert.strictEqual(H.normalize('bishop').id, 'bishop');
});

test('数据表写错时立刻抛错，而不是生成一个"看起来正常"的局面', () => {
  // 落点是空格（`5d` 在初形里是空的：中间三行都是 `9`）→ 说明表错了
  assert.throws(() => H.buildSfen({ id: 'x', removed: ['5d'] }), /原本就是空格/);
  // 格名非法
  assert.throws(() => H.buildSfen({ id: 'x', removed: ['0a'] }), /非法格名/);
  assert.throws(() => H.buildSfen({ id: 'x', removed: ['9j'] }), /非法格名/);
});

test('棋谱导出（KIF）：手合割必须写明，且用下手/上手代替先手/後手', () => {
  const { exportKif } = require('../src/records');
  const base = {
    id: 'r1', moves: ['7g7f'], moveTimes: [3], timeControl: '10:00',
    names: ['阿花', '阿呆'], result: 'b', resultDetail: '投了', createdAt: Date.now(),
  };
  // 让子局
  const kif = exportKif(Object.assign({}, base, {
    startSfen: H.get('lance').startSfen, handicap: 'lance', handicapLabel: '香落ち',
  }));
  assert.match(kif, /^手合割：香落ち$/m, '手合割行必须写明落子（平手是写死的默认值，别再写死）');
  assert.match(kif, /^下手：阿呆$/m, '下手 = 座位 w（用全部棋子的一方）');
  assert.match(kif, /^上手：阿花$/m, '上手 = 座位 b（落子方，先手）');
  assert.match(kif, /まで1手で上手の勝ち/, '让子局的胜者按上手/下手记');
  assert.doesNotMatch(kif, /先手：|後手：/, '让子局不该再出现先手/後手字段');

  // 平手局（回归：原有行为不能被让子改动带歪）
  const even = exportKif(base);
  assert.match(even, /^手合割：平手$/m);
  assert.match(even, /^先手：阿花$/m);
  assert.match(even, /^後手：阿呆$/m);
  assert.match(even, /まで1手で阿花の勝ち/, '平手局沿用"写胜者名"的既有格式');
});

test('棋谱导出（KIF）：只给 handicap id 时也能推出显示名', () => {
  const { exportKif } = require('../src/records');
  const kif = exportKif({
    id: 'r2', startSfen: H.get('bishop').startSfen, moves: ['7g7f'], moveTimes: [1],
    timeControl: '10:00', names: ['A', 'B'], result: 'w', resultDetail: '詰み',
    createdAt: Date.now(), handicap: 'bishop',
  });
  assert.match(kif, /^手合割：角落ち$/m, '没有 handicapLabel 时应回表里查');
  assert.match(kif, /まで1手で下手の勝ち/, 'w（下手）获胜应记为下手');
});

test('盘面字段的解析与序列化互逆（含成駒与空格合并）', () => {
  const rows = H.parseBoardField(STARTING_SFEN.split(' ')[0]);
  assert.strictEqual(rows.length, 9);
  assert.strictEqual(H.serializeBoardField(rows), STARTING_SFEN.split(' ')[0]);
  // 拿掉角侧的三枚（`9i`/`8i`/`7i` = L N S）后应合并成 `3GKGSNL`
  rows[8][0] = ''; rows[8][1] = ''; rows[8][2] = '';
  assert.strictEqual(H.serializeBoardField(rows).split('/')[8], '3GKGSNL');
  // 成駒带 '+' 的解析
  const promo = H.parseBoardField('+P8/9/9/9/9/9/9/9/9');
  assert.strictEqual(promo[0][0], '+P');
  assert.strictEqual(H.serializeBoardField(promo), '+P8/9/9/9/9/9/9/9/9');
});
