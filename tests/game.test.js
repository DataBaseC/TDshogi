/**
 * game.js 规则引擎单元测试（PLAN §P1）
 *
 * 覆盖范围**刻意收窄到可确证的规则**：
 *   - 初始局面 / 开局合法着法数 / 走子与吃子 / 非法着法拒绝
 *   - 自玉王手过滤（王手放置禁止）
 *   - 升变区判定、吃子进驹台
 *
 * 规则边界（困毙判定 / 强制升变 / 连续王手千日手）已于 2026-09-10 经用户拍板确认，
 * 断言见文件末尾「用户拍板后补充」一节。
 * 持将棋点数判定（入玉宣言法 **27 点法**：先手 28 / 后手 27）已于 2026-09-10 拍板实现，
 * 断言同样见文件末尾「持将棋 / 入玉宣言法」一节。
 */
const test = require('node:test');
const assert = require('node:assert');

const { Game, newGame, STARTING_SFEN } = require('../src/game');

test('初始局面：先手行棋、40 枚棋子、双方无持驹', () => {
  const g = newGame();
  assert.strictEqual(g.turn, 'b');
  const st = g.state();
  assert.strictEqual(st.board.length, 9);
  assert.ok(st.board.every((row) => row.length === 9), '棋盘应为 9x9');
  assert.deepStrictEqual(st.hands, { b: [], w: [] });
  const pieces = st.board.flat().filter((c) => c.piece).length;
  assert.strictEqual(pieces, 40, '平手初始共 40 枚棋子');
  assert.strictEqual(st.check, false, '开局不应有王手');
  assert.strictEqual(st.result, null);
});

test('初始盘面坐标映射：sq 为 USI（筋=横坐标，段字母=a..i）', () => {
  const st = newGame().state();
  // board[y][x] 按 x=1..9 / y=1..9 顺序填充，sq 即该格的 USI 名
  assert.strictEqual(st.board[0][0].sq, '1a');
  assert.strictEqual(st.board[8][8].sq, '9i');
  // 1a 是后手香（敌阵最上段右侧），9i 是先手香
  assert.strictEqual(st.board[0][0].piece, '香');
  assert.strictEqual(st.board[0][0].color, 'w');
  assert.strictEqual(st.board[8][8].piece, '香');
  assert.strictEqual(st.board[8][8].color, 'b');
});

test('开局合法着法数 = 30', () => {
  // 手工核算：歩 9 + 香 2 + 桂 0（前方两格被己方歩占）+ 銀 4 + 金 6 + 玉 3 + 角 0（斜向被己方子挡）+ 飛 6 = 30
  assert.strictEqual(newGame().legalMovesUsi().length, 30);
});

test('走子：手数 +1、手番切换、lastMove 更新', () => {
  const g = newGame();
  assert.deepStrictEqual(g.applyMove('7g7f'), { ok: true });
  assert.deepStrictEqual(g.moves, ['7g7f']);
  assert.strictEqual(g.turn, 'w');
  assert.strictEqual(g.lastMove, '7g7f');
  assert.strictEqual(g.state().lastMove, '7g7f');
});

test('非法着法被拒且不留痕：歩走两格 / 起点空格 / 目标为己方子', () => {
  const g = newGame();
  assert.strictEqual(g.applyMove('7g7e').ok, false, '歩不能前进两格');
  assert.strictEqual(g.applyMove('5e5d').ok, false, '起点无子');
  assert.strictEqual(g.applyMove('7g7h').ok, false, '目标是己方行进方向之外的空格（歩不能后退）');
  assert.strictEqual(g.moves.length, 0, '被拒的着法不应进入历史');
  assert.strictEqual(g.turn, 'b', '被拒后手番不变');
});

test('非法着法被拒：无持驹时不能打子', () => {
  const g = newGame();
  assert.strictEqual(g.applyMove('P*5e').ok, false);
  assert.deepStrictEqual(g.legalTargets('P'), [], '开局无持驹，打子目标应为空');
});

test('升变区：未入敌阵的歩没有「成」的选项', () => {
  const g = newGame();
  const targets = g.legalTargets('5g');
  assert.ok(targets.some((t) => t.to === '5f'), '歩应能前进一格');
  assert.ok(targets.every((t) => !t.promote), '5f 不在敌阵三行，不应有升变选项');
});

test('升变区：歩踏入敌阵三行时同时给出「成」与「不成」', () => {
  // 先手歩在 5d（y=4），走到 5c（y=3，敌阵）
  const g = new Game('4k4/9/9/4P4/9/9/9/9/4K4 b - 1');
  const at5c = g.legalTargets('5d').filter((t) => t.to === '5c');
  assert.strictEqual(at5c.length, 2, '入敌阵应有成/不成两种走法');
  assert.ok(at5c.some((t) => t.promote), '含「成」');
  assert.ok(at5c.some((t) => !t.promote), '含「不成」');
  assert.ok(at5c.some((t) => t.usi === '5d5c+'));
  assert.ok(at5c.some((t) => t.usi === '5d5c'));
});

test('升变执行：带 + 的 USI 落子后为成駒', () => {
  const g = new Game('4k4/9/9/4P4/9/9/9/9/4K4 b - 1');
  assert.deepStrictEqual(g.applyMove('5d5c+'), { ok: true });
  const cell = g.state().board.find((r) => r.some((c) => c.sq === '5c')).find((c) => c.sq === '5c');
  assert.strictEqual(cell.piece, 'と', '歩升变后为「と」');
  assert.strictEqual(cell.promoted, true);
});

test('王手过滤（王手放置禁止）：被将时不能走与解将无关的子', () => {
  // 后手飛在 5a，5 线对先手玉 5i 全空 → 先手正被将；4h 的歩与解将无关
  const g = new Game('k3r4/9/9/9/9/9/9/3P5/4K4 b - 1');
  assert.strictEqual(g.isCheck(), true, '应先处于王手状态');
  const targets = g.legalTargets('4h');
  assert.strictEqual(targets.length, 0, '被将时该歩的移动都不能解将，应被全部过滤');
  assert.strictEqual(g.applyMove('4h4g').ok, false, '不解决王手的着法必须被拒');
  // 对照：玉离开 5 线是合法应将，说明是"过滤"而非"整体失效"
  assert.ok(g.legalTargets('5i').some((t) => t.to === '4i' || t.to === '6i'));
});

test('吃子进入驹台：吃掉对方歩后己方持驹多一枚歩', () => {
  // 先手飛 5e 吃掉后手歩 5c（5c 属敌阵，但此处先测「不成」路径）
  const g = new Game('4k4/9/4p4/9/4R4/9/9/9/4K4 b - 1');
  assert.deepStrictEqual(g.applyMove('5e5c'), { ok: true });
  const hands = g.state().hands;
  const fu = hands.b.find((h) => h.piece === '歩');
  assert.ok(fu && fu.count === 1, '吃掉的歩应进入先手持驹');
  assert.deepStrictEqual(hands.w, [], '后手不应有持驹');
});

test('持驹展示顺序：飛 角 金 銀 桂 香 歩（与前端驹台渲染顺序一致）', () => {
  // SFEN 第 3 段为持驹：大写=先手，小写=后手；此处给先手全部七种各一枚
  const g = new Game('4k4/9/9/9/9/9/9/9/4K4 b RBGSNLP 1');
  assert.deepStrictEqual(
    g.hands().b.map((h) => h.piece),
    ['飛', '角', '金', '銀', '桂', '香', '歩']
  );
  assert.deepStrictEqual(g.hands().w, []);
});

test('认输：当前手番方判负', () => {
  const g = newGame();
  g.resign();
  assert.strictEqual(g.result, 'w', '先手认输 → 后手胜');
  assert.strictEqual(g.resultDetail, '投了');
  assert.strictEqual(g.isGameOver(), true);
});

test('STARTING_SFEN 可被 Game 正确解析', () => {
  const g = new Game(STARTING_SFEN);
  assert.strictEqual(g.turn, 'b');
  assert.strictEqual(g.state().board.flat().filter((c) => c.piece).length, 40);
});

// ======================================================================
// 用户拍板后补充（2026-09-10 确认；这 3 条是规则级修正，勿凭印象改动）
// ======================================================================

test('规则 R-a：困毙（未被将却无步可走）判负，不是和棋', () => {
  // 先手玉 1a 被己方歩(1b)/香(2a)/桂(2b) 堵死，且这三子自身也无路可走；后手玉在 9i 不构成王手
  const g = new Game('KL7/PN7/9/9/9/9/9/9/8k b - 1');
  assert.strictEqual(g.isCheck(), false, '应为「未被将」');
  assert.strictEqual(g.legalMovesUsi().length, 0, '应无任何合法着法');
  g.updateResult();
  assert.strictEqual(g.result, 'w', '困毙方（先手）判负 → 后手胜');
  assert.strictEqual(g.resultDetail, '困毙');
});

test('规则 R-b：歩到最底线只提供「成」（强制升变）', () => {
  // 先手歩在 5b，走 5a（先手底线）；到此该歩再无路可走 → 必须升变
  const g = new Game('3k5/4P4/9/9/9/9/9/9/8K b - 1');
  const toA = g.legalTargets('5b').filter((t) => t.to === '5a');
  assert.strictEqual(toA.length, 1, '应只给出「成」一种走法');
  assert.strictEqual(toA[0].usi, '5b5a+');
  assert.strictEqual(g.applyMove('5b5a').ok, false, '不带 + 的着法必须被拒');
  assert.strictEqual(g.applyMove('5b5a+').ok, true, '带 + 的着法应合法');
});

test('规则 R-b：桂跳到最下两段同样强制升变', () => {
  // 先手桂在 5c，跳至 4a / 6a（y=1，先手最底线）
  const g = new Game('3k5/9/4N4/9/9/9/9/9/8K b - 1');
  const targets = g.legalTargets('5c');
  assert.ok(targets.length > 0, '桂应有可走目标');
  assert.ok(targets.every((t) => t.promote), '桂跳到最底线应全部为「成」');
  assert.ok(targets.every((t) => t.usi.endsWith('+')));
});

test('规则 R-b 反面：已成子走底线**不该**被判「必须升变」（2026-09-20 修）', () => {
  // ⚠️ 曾经的 bug：强制升变守卫用 `Piece.unpromote(piece.kind)` 判棋子种类，
  // 于是把**已成子还原成原始种类**（と金→歩、成香→香、成桂→桂）再判定，
  // 必然得到"必须升变" → 把合法的「と金进底线」判成非法。
  // 而 `candidateMovesFrom` 的 `canPromote` 明确排除了已成子（只提供"不成"一种），
  // 两条路径口径不一致 → **前端高亮可点、服务端却拒绝**，
  // 还回一句对と金毫无意义的"该棋子走到此位置必须升变"。
  // と金进底线在终盘是常见着法，所以这不是边角案例。
  const cases = [
    ['と金', '8k/4+P4/9/9/9/9/9/9/K8 b - 1'],
    ['成香', '8k/4+L4/9/9/9/9/9/9/K8 b - 1'],
    ['成桂', '8k/4+N4/9/9/9/9/9/9/K8 b - 1'],
  ];
  for (const [label, sfen] of cases) {
    const g = new Game(sfen);
    const list = g.legalMovesUsi();
    assert.ok(list.indexOf('5b5a') >= 0, `${label}：候选里应提供 5b5a`);
    const r = g.applyMove('5b5a');
    assert.strictEqual(r.ok, true, `${label} 走 5b5a 应当合法（实际：${r.error || 'ok'}）`);
    // 已成子不能再次升变 → 不该提供带 + 的变体
    assert.strictEqual(list.indexOf('5b5a+'), -1, `${label}：不该提供带 + 的走法`);
  }
  // 对照组：金本来就不可升变，修复前后都应正常（确认没有把校验整条废掉）
  const gold = new Game('8k/4G4/9/9/9/9/9/9/K8 b - 1');
  assert.strictEqual(gold.applyMove('5b5a').ok, true, '金走底线应当合法');
});

test('不变量：候选列表里的每一个着法，applyMove 都必须接受', () => {
  // 这条不变量是「前端高亮可点、服务端却拒绝」这类 bug 的**唯一护栏**：
  // `candidateMovesFrom`（候选生成）与 `applyMove`（执行校验）是两条独立代码路径，
  // 一旦判定口径漂移（上面 R-b 反面那条就是这么来的），玩家就会遇到
  // "点了没反应 / 莫名报错"。只挑固定局面写用例发现不了，必须靠随机抽样兜。
  //
  // ⚠️ 用**定种子**的伪随机：既可复现，又不会偶发失败（测试里用 Math.random 是禁忌）。
  let seed = 20260920;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  let checked = 0;
  for (let game = 0; game < 3; game++) {
    const g = new Game();
    for (let ply = 0; ply < 200 && !g.isGameOver(); ply++) {
      const list = g.legalMovesUsi();
      if (!list.length) break;
      const mv = list[Math.floor(rnd() * list.length)];
      const r = g.applyMove(mv);
      assert.strictEqual(r.ok, true,
        `第 ${game + 1} 局第 ${ply + 1} 手：${mv} 在候选列表里，applyMove 却拒绝（${r.error}）`);
      checked++;
    }
  }
  // 抽到的着法要足够多才有意义（修复前那条 bug 在第 175 手才暴露）
  assert.ok(checked > 300, `抽样应覆盖足够多着法，实际 ${checked}`);
});

test('规则 R-c：普通千日手（双方均无将军）判和', () => {
  // 双方玉在相邻两格来回走（4 步一循环），重复 4 次后同一局面出现 5 次
  const g = new Game('4k4/9/9/9/9/9/9/9/4K4 b - 1');
  const cyc = ['5i4i', '5a4a', '4i5i', '4a5a'];
  for (let i = 0; i < 16; i++) {
    const r = g.applyMove(cyc[i % 4]);
    assert.ok(r.ok, `第 ${i + 1} 手 ${cyc[i % 4]} 应合法：${r.error || ''}`);
  }
  assert.strictEqual(g.resultDetail, '千日手');
  assert.strictEqual(g.result, '-', '普通千日手判和');
});

test('规则 R-c：连续王手千日手判王手方负', () => {
  // 先手飛反复将军、后手玉来回躲避（4 步一循环）；区间内先手每一步都在将军
  const g = new Game('4k4/9/9/9/4R4/9/9/9/8K w - 1');
  const cyc = ['5a4a', '5e4e', '4a5a', '4e5e'];
  for (let i = 0; i < 16; i++) {
    const r = g.applyMove(cyc[i % 4]);
    assert.ok(r.ok, `第 ${i + 1} 手 ${cyc[i % 4]} 应合法：${r.error || ''}`);
  }
  const rep = g.detectRepetition();
  assert.strictEqual(rep.repeated, true, '应判定为千日手');
  assert.strictEqual(rep.perpCheckBy, 'b', '先手为连续王手方');
  assert.strictEqual(g.result, 'w', '连续王手方（先手）判负 → 后手胜');
});

// ======================================================================
// 持将棋 / 入玉宣言法（PLAN §P1 R-d）
//
// 口径：AJSA **27 点法**（对齐 81Dojo）——先手 28 点、后手 27 点。
// ⚠️ 最容易搞错的三个点，专门留了回归用例：
//   1. 点数**只统计**「宣言方在敌阵内的棋子（不含玉）+ 宣言方持驹」，
//      敌阵**以外**的盘上棋子**一律不计**；
//   2. 持驹**计分**但**不计入**「敌阵内 10 枚」；
//   3. 己方非玉棋子满员也只有 27 点，先手的 28 点必然依赖持驹。
// ======================================================================

test('入玉宣言：先手满足全部条件（敌阵内 11 枚 / 28 点）可宣言', () => {
  // 先手玉在敌阵(5a)；敌阵内 11 枚 = 飛角金金銀銀桂桂香香歩(19 点) + 持驹 9 歩(9 点) = 28 点
  const g = new Game('2GBKRG2/2SN1NS2/2L1P1L2/9/9/9/9/9/8k b 9P 1');
  const d = g.canDeclareNyugyoku('b');
  assert.strictEqual(d.ok, true, d.reason || '');
  assert.strictEqual(d.points, 28, '点数 = 敌阵内 19 + 持驹 9 = 28（必须含持驹）');
  assert.strictEqual(d.count, 11, '敌阵内除玉外应为 11 枚');
});

test('入玉宣言：先手 27 点差 1 点不可宣言（28 为硬边界）', () => {
  const g = new Game('2GBKRG2/2SN1NS2/2L1P1L2/9/9/9/9/9/8k b 8P 1');
  const d = g.canDeclareNyugyoku('b');
  assert.strictEqual(d.ok, false, '27 点不应达标');
  assert.strictEqual(d.points, 27);
  assert.match(d.reason, /点数不足/);
});

test('入玉宣言：后手 27 点即可宣言（后手门槛比先手低 1 点）', () => {
  // 与先手用例镜像；后手持驹 8 歩 → 19 + 8 = 27 点
  const g = new Game('8K/9/9/9/9/9/2l1p1l2/2sn1ns2/2gbkrg2 w 8p 1');
  const d = g.canDeclareNyugyoku('w');
  assert.strictEqual(d.ok, true, d.reason || '');
  assert.strictEqual(d.points, 27);
  // 对照：同一局面先手既非手番、也不满足 28 点门槛
  assert.strictEqual(g.canDeclareNyugyoku('b').ok, false, '非手番方不应可宣言');
});

test('入玉宣言：玉不在敌阵时不可宣言', () => {
  const g = new Game('2GB1RG2/2SN1NS2/2L1P1L2/9/4K4/9/9/9/8k b 9P 1');
  const d = g.canDeclareNyugyoku('b');
  assert.strictEqual(d.ok, false);
  assert.match(d.reason, /玉还不在敌阵/);
});

test('入玉宣言：敌阵内不足 10 枚时不可宣言', () => {
  // 敌阵内仅 9 枚（3 段的香只保留 1 枚）
  const g = new Game('2GBKRG2/2SN1NS2/2L6/9/9/9/9/9/8k b 9P 1');
  const d = g.canDeclareNyugyoku('b');
  assert.strictEqual(d.ok, false);
  assert.match(d.reason, /10 枚以上/);
});

test('入玉宣言：被王手时不可宣言', () => {
  // 5 线全空，后手飛 5i 直接将军先手玉 5a
  const g = new Game('2GBKRG2/2SN1NS2/2L3L2/9/9/9/9/9/4r3K b 9P 1');
  assert.strictEqual(g.isCheck(), true, '应先处于王手');
  const d = g.canDeclareNyugyoku('b');
  assert.strictEqual(d.ok, false);
  assert.match(d.reason, /王手/);
});

test('入玉宣言【回归】：敌阵以外的盘上棋子不计分、持驹不凑「10 枚」', () => {
  // 敌阵内 10 枚小駒 = 10 点；敌阵外另有 龍 5e + 馬 4f（10 点）——后者不得计分。
  // 若误按「盘上全体」统计会得到 27 点，故断言精确到 17（= 敌阵内 10 + 持驹 7 歩）。
  const g = new Game('2G1K1G2/2SN1NS2/2LP1PL2/9/4+R4/5+B3/9/9/8k b 7P 1');
  const d = g.canDeclareNyugyoku('b');
  assert.strictEqual(d.points, 17, '只计敌阵内 10 + 持驹 7，敌阵外的龍馬不计');
  assert.strictEqual(d.count, 10);
});
