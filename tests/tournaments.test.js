'use strict';
/**
 * tournaments.test.js — 赛事状态机与权限（`src/tournaments.js`，PLAN §V-T1）
 *
 * T1 的核心产出是 **`canManage()` 单点权限**与**状态机**。这两样东西的特点是：
 * 「写对了没人夸，写错了就是越权或数据损坏」。所以这里**逐格断言权限矩阵**，
 * 而不是只测"某条正常路径能跑通"——矩阵里漏判一格，就是一个越权后门。
 *
 * 断言直接从 `ACTION_ROLES` 推导出"应该允许谁"，再与实际判定比对：
 * 将来加新动作时，只要忘了补测试，这里的遍历就会暴露出来。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// 数据隔离：tournaments 会连带 require storage（首次 getDb 时定死路径）
const TMP = path.join(__dirname, '..', '.tmpdata-tournaments');
process.env.DATA_DIR = TMP;
if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });

const T = require('../src/tournaments');
const storage = require('../src/storage');
const ratings = require('../src/ratings');

// ---- 等级特权（2026-09-20）：举办赛事需要 Lv.5 ----
// 测试里的 owner 都是临时造的 id、等级为 0，会被门槛直接拒掉。
// 这里统一把用到的 owner 抬到门槛所需等级（**`owner-low` 故意不抬**，留给门槛用例）。
const LV5_EXP = ratings.nextLevelExp(ratings.LEVEL_PRIVILEGES.create_tournament - 1);
for (const id of ['owner-x', 'owner-y', 'owner-1', 'owner-s', 'o', 'owner']) {
  ratings.adminSetPlayer(id, { exp: LV5_EXP + 1000 });
}

test.after(() => {
  // Windows 上必须先关掉 SQLite 连接，否则目录删不掉（见 cleanup.test.js 的同款处理）
  try { storage._getDb().close(); } catch (_) { /* 忽略 */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
});

// ---------------- 测试替身 ----------------

function mkTournament(over) {
  return Object.assign({
    id: 't1',
    name: '测试赛',
    size: 8,
    ownerId: 'owner-1',
    status: 'registration',
    entrants: [{ id: 'player-1', status: 'approved' }],
    players: [{ id: 'player-1' }],
  }, over || {});
}

const actor = {
  admin: { id: 'admin-1', isAdmin: true },
  owner: { id: 'owner-1' },
  player: { id: 'player-1' },
  stranger: { id: 'nobody' },
};

/** 只有管理员能做的动作（含需求 10 被用户修正的"设冠军"） */
const ADMIN_ONLY = ['approve_tournament', 'reject_tournament', 'set_champion', 'archive', 'edit_archived'];
/** 管理员与主办人（未结束时）共有的管理动作 */
const ADMIN_OR_OWNER = ['decide_entrant', 'kick_player', 'void_player', 'assign_round', 'decide_rematch', 'cancel'];

// ---------------- 断言 ----------------

test('T1 canManage：参数缺失 / 未知动作一律拒绝', () => {
  assert.strictEqual(T.canManage(mkTournament(), actor.admin, 'no_such_action'), false);
  assert.strictEqual(T.canManage(null, actor.admin, 'cancel'), false);
  assert.strictEqual(T.canManage(mkTournament(), null, 'cancel'), false);
  assert.strictEqual(T.canManage(mkTournament(), actor.admin, ''), false);
});

test('T1 canManage：仅管理员可用的动作 —— 主办人/选手/路人都不可', () => {
  const t = mkTournament();
  for (const a of ADMIN_ONLY) {
    // 先确认这个动作确实登记在表里，避免拼错动作名导致"测试通过但没测到东西"
    assert.ok(T.ACTION_ROLES[a], `${a} 应登记在 ACTION_ROLES`);
    if (a === 'edit_archived') {
      // T6：这个动作**额外要求赛事已存档**——存档前有正常管理操作可用，
      // 那时走"编辑"会把还没定论的东西记成"赛后更正"，所以未存档时连管理员也不放行。
      assert.strictEqual(T.canManage(t, actor.admin, a), false, `未存档时 admin 也不该能 ${a}`);
      const archived = Object.assign({}, t, { status: 'archived' });
      assert.strictEqual(T.canManage(archived, actor.admin, a), true, `存档后 admin 应可 ${a}`);
      continue;
    }
    assert.strictEqual(T.canManage(t, actor.admin, a), true, `admin 应可 ${a}`);
    assert.strictEqual(T.canManage(t, actor.owner, a), false, `主办人不可 ${a}（需求 10 已修正为仅管理员）`);
    assert.strictEqual(T.canManage(t, actor.player, a), false, `选手不可 ${a}`);
    assert.strictEqual(T.canManage(t, actor.stranger, a), false, `路人不可 ${a}`);
  }
});

test('T1 canManage：管理员与主办人共有的管理动作', () => {
  const t = mkTournament();
  for (const a of ADMIN_OR_OWNER) {
    assert.ok(T.ACTION_ROLES[a], `${a} 应登记在 ACTION_ROLES`);
    assert.strictEqual(T.canManage(t, actor.admin, a), true, `admin 应可 ${a}`);
    assert.strictEqual(T.canManage(t, actor.owner, a), true, `主办人应可 ${a}（赛事未结束）`);
    assert.strictEqual(T.canManage(t, actor.player, a), false, `选手不可 ${a}`);
    assert.strictEqual(T.canManage(t, actor.stranger, a), false, `路人不可 ${a}`);
  }
});

test('T1 canManage：存档后主办人只读、管理员仍可编辑（需求 11）', () => {
  const t = mkTournament({ status: 'archived' });
  for (const a of ADMIN_OR_OWNER) {
    assert.strictEqual(T.canManage(t, actor.owner, a), false, `已存档 → 主办人不可 ${a}`);
  }
  // 管理员仍保有全权（cancel 除外——已收尾的赛事谁都不能取消）
  assert.strictEqual(T.canManage(t, actor.admin, 'decide_entrant'), true, '管理员对已存档赛事仍有全权');
  assert.strictEqual(T.canManage(t, actor.admin, 'edit_archived'), true, '管理员仍可编辑存档赛事');
  assert.strictEqual(T.canManage(t, actor.owner, 'edit_archived'), false, '主办人不可编辑存档赛事');
  assert.strictEqual(T.canManage(t, actor.owner, 'cancel'), false, '已存档更不可取消');
});

test('T1 canManage：主办人「结束后不能取消」（用户 2026-09-13 明确）', () => {
  for (const st of ['finished', 'archived', 'cancelled', 'rejected']) {
    const t = mkTournament({ status: st });
    assert.strictEqual(T.canManage(t, actor.owner, 'cancel'), false, `${st} 状态主办人不可取消`);
    // 管理员对已收尾的赛事同样不可取消（与主办人限制保持一致）
    assert.strictEqual(T.canManage(t, actor.admin, 'cancel'), false, `${st} 状态管理员也不可取消`);
  }
  // finished 是"收尾窗口"：其他管理动作主办人仍可做
  assert.strictEqual(T.canManage(mkTournament({ status: 'finished' }), actor.owner, 'decide_entrant'), true,
    'finished 仍属收尾期，主办人应可处理报名等事务');
});

test('T1 canManage：选手只在「比赛中」可申请重赛', () => {
  assert.strictEqual(T.canManage(mkTournament({ status: 'playing' }), actor.player, 'request_rematch'), true);
  assert.strictEqual(T.canManage(mkTournament({ status: 'registration' }), actor.player, 'request_rematch'), false,
    '还没开赛谈不上重赛');
  assert.strictEqual(T.canManage(mkTournament({ status: 'playing' }), actor.stranger, 'request_rematch'), false,
    '非参赛者不能申请重赛');
  assert.strictEqual(T.canManage(mkTournament({ status: 'playing' }), actor.owner, 'request_rematch'), false,
    '主办人若未参赛，不能替选手申请重赛');
});

test('T1 状态机：合法迁移', () => {
  assert.strictEqual(T.canTransition('pending_approval', 'registration'), true);
  assert.strictEqual(T.canTransition('pending_approval', 'rejected'), true);
  assert.strictEqual(T.canTransition('registration', 'playing'), true);
  assert.strictEqual(T.canTransition('registration', 'cancelled'), true);
  assert.strictEqual(T.canTransition('playing', 'finished'), true);
  assert.strictEqual(T.canTransition('playing', 'cancelled'), true);
  assert.strictEqual(T.canTransition('finished', 'archived'), true);
});

test('T1 状态机：非法迁移一律拒绝', () => {
  assert.strictEqual(T.canTransition('pending_approval', 'playing'), false, '不能跳过报名直接开赛');
  assert.strictEqual(T.canTransition('pending_approval', 'finished'), false);
  assert.strictEqual(T.canTransition('archived', 'playing'), false, 'archived 是终态');
  assert.strictEqual(T.canTransition('archived', 'finished'), false);
  assert.strictEqual(T.canTransition('rejected', 'registration'), false);
  assert.strictEqual(T.canTransition('cancelled', 'playing'), false);
  assert.strictEqual(T.canTransition('registration', 'archived'), false, '必须先打完（finished）才能存档');
});

test('T1 状态机：旧状态名 open 映射为 registration（历史数据不能卡死）', () => {
  assert.strictEqual(T.normalizeStatus('open'), 'registration');
  assert.strictEqual(T.normalizeStatus('playing'), 'playing');
  assert.strictEqual(T.normalizeStatus(undefined), 'pending_approval');
  assert.strictEqual(T.canTransition('open', 'playing'), true, '旧数据（open）应能正常开赛');
  assert.strictEqual(T.canTransition('open', 'registration'), false, 'open 已经等价于 registration');
});

test('T1 数据模型：新建赛事带上申请表字段，且默认"报名需审核"', () => {
  const r = T.createTournament('集成测试赛', 8, { id: 'owner-x', name: '主办人' }, {
    reason: '这是一条足够长的举办理由说明',
    registerStart: 1000,
    registerEnd: 2000,
    matchStart: 3000,
    matchEnd: 4000,
    format: 'single-elimination',
  });
  assert.strictEqual(r.ok, true, r.error || '');
  const t = r.tournament;
  assert.strictEqual(t.status, 'pending_approval');
  assert.strictEqual(t.size, 8);
  assert.strictEqual(t.requireApproval, true, '未显式关闭时应默认需审核');
  assert.strictEqual(t.reason, '这是一条足够长的举办理由说明');
  assert.strictEqual(t.registerEnd, 2000);
  assert.strictEqual(t.ownerName, '主办人');
  // 2026-09-13 用户要求：主办人**不自动参赛**（办赛与参赛是两件事）
  assert.strictEqual(t.entrants.length, 0, '主办人不自动进入报名池');
  assert.strictEqual(t.players.length, 0, '主办人不自动占一个参赛名额');
  assert.strictEqual(t.ownerId, 'owner-x', '但主办人身份仍要记下（权限判定要用）');
});

test('T1 数据模型：服务端二次校验（时间自洽 / 人数档位 / 赛制）', () => {
  const owner = { id: 'owner-y', name: '主办人' };
  // 时间倒置
  let r = T.createTournament('x', 8, owner, { registerStart: 5000, registerEnd: 1000 });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /报名结束时间/);

  r = T.createTournament('x', 8, owner, { matchStart: 9000, matchEnd: 8000 });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /比赛结束时间/);

  // 比赛开始早于报名结束
  r = T.createTournament('x', 8, owner, { registerEnd: 5000, matchStart: 3000 });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /报名结束时间/);

  // 人数档位（6 不是 2 的幂）
  r = T.createTournament('x', 6, owner, {});
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /参赛人数/);

  // 赛制（T8）：瑞士制已实装，但**未实装的赛制仍必须拒绝**（别把校验一并放开）
  r = T.createTournament('x', 8, owner, { format: 'round-robin' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /赛制/);
  assert.strictEqual(
    T.createTournament('瑞士制赛', 8, owner, { format: 'swiss', reason: '理由要够长才能过校验' }).ok,
    true, '瑞士制已实装（T8）');

  // 4 / 32 档应放行（Q3 用户确认扩到 32）
  assert.strictEqual(T.createTournament('小赛', 4, owner, {}).ok, true);
  assert.strictEqual(T.createTournament('大赛', 32, owner, {}).ok, true);
});

test('T1 数据模型：publicInfo 对旧数据兜底（缺字段不炸、reason 语义归位）', () => {
  // 模拟一条 T1 之前的旧数据：没有 entrants/logs/rejectReason，状态写的是 open
  // 且 reason 存的是"拒绝原因"（旧语义）
  const legacy = {
    id: 'old', name: '旧赛事', size: 4, status: 'rejected', ownerId: 'o1',
    players: [{ id: 'o1', name: '主办' }], bracket: [], championId: null, reason: '资料不全',
  };
  const info = T.publicInfo(legacy);
  assert.strictEqual(info.status, 'rejected');
  assert.deepStrictEqual(info.entrants, [], '缺字段应兜底为空数组而不是 undefined');
  assert.strictEqual(info.rejectReason, '资料不全', '旧 reason 应归位到 rejectReason');
  assert.strictEqual(info.reason, '', '旧数据的 reason 不应被显示成"举办理由"');
  assert.strictEqual(info.requireApproval, true, '缺字段时默认需审核');

  // 非终态的旧数据（open）：reason 归为举办理由
  const open = T.publicInfo({ id: 'o2', name: 'x', size: 4, status: 'open', reason: '办个比赛' });
  assert.strictEqual(open.status, 'registration', 'open 应映射为 registration');
  assert.strictEqual(open.reason, '办个比赛');
});

// ======================================================================
// T3 报名两段式 + 未满员轮空
// ======================================================================

/** 造一个已通过管理员审核（registration 状态）的赛事，返回其 id */
function mkApproved(over) {
  const r = T.createTournament('T3 测试赛', 4, { id: 'owner-1', name: '主办' }, Object.assign({
    reason: '用于验证报名与轮空逻辑的测试赛事',
  }, over || {}));
  assert.strictEqual(r.ok, true, r.error || '');
  T.approveTournament(r.tournament.id);
  return r.tournament.id;
}

test('T3 免审核报名：报名即参赛，满员才自动开赛', () => {
  const id = mkApproved({ requireApproval: false });
  const j = (n) => T.joinTournament(id, { id: 'p' + n, name: '棋手' + n });

  const first = j(1);
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.pending, false, '免审核应当立即通过');
  assert.strictEqual(T.getTournament(id).status, 'registration', '没满员不该开赛');

  j(2); j(3);
  assert.strictEqual(T.getTournament(id).status, 'registration');
  const last = j(4);
  assert.strictEqual(last.started, true, '满员应自动开赛');
  const t = T.getTournament(id);
  assert.strictEqual(t.status, 'playing');
  assert.strictEqual(t.players.length, 4, '开赛时把 approved 冻结进 players');
});

test('T3 需审核报名：进报名池等待，pending 不占名额也不进 players', () => {
  const id = mkApproved({ requireApproval: true });
  const r = T.joinTournament(id, { id: 'q1', name: '甲' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.pending, true, '需审核时应是 pending');

  const t = T.getTournament(id);
  assert.strictEqual(t.entrants.length, 1);
  assert.strictEqual(t.entrants[0].status, 'pending');
  assert.strictEqual(t.players.length, 0, '还没批准，不该进 players');
  assert.strictEqual(T.approvedCount(t), 0, 'pending 不计入已批准人数');

  assert.strictEqual(T.joinTournament(id, { id: 'q1', name: '甲' }).ok, false, '重复报名应被拒');
});

test('T3 名额按「已批准」计：一堆 pending 不会把名额占满', () => {
  const id = mkApproved({ requireApproval: true }); // size = 4
  for (let i = 1; i <= 4; i++) T.joinTournament(id, { id: 'r' + i, name: '乙' + i });
  assert.strictEqual(T.joinTournament(id, { id: 'r5', name: '乙5' }).ok, true,
    '待审核的人不该把名额占满（否则真正被批准的反而报不进来）');
  assert.strictEqual(T.getTournament(id).status, 'registration', '全是 pending，不能开赛');
});

test('T3 批准 / 拒绝报名：权限只在主办人与管理员', () => {
  const id = mkApproved({ requireApproval: true });
  T.joinTournament(id, { id: 's1', name: '丙' });
  const owner = { id: 'owner-1' };
  const admin = { id: 'adm', isAdmin: true };
  const stranger = { id: 'nobody' };

  assert.strictEqual(T.decideEntrant(id, 's1', 'approve', stranger).ok, false, '路人不能批准');
  assert.strictEqual(T.decideEntrant(id, 's1', 'approve', { id: 'p-other' }).ok, false, '非主办人不能批准');
  assert.strictEqual(T.decideEntrant(id, 's1', 'approve', admin).ok, true, '管理员可以批准');
  assert.strictEqual(T.getTournament(id).entrants[0].status, 'approved');
  assert.strictEqual(T.decideEntrant(id, 's1', 'reject', owner).ok, false, '已处理过的报名不该能二次处置');

  T.joinTournament(id, { id: 's2', name: '丁' });
  assert.strictEqual(T.decideEntrant(id, 's2', 'reject', owner).ok, true);
  assert.strictEqual(T.getTournament(id).entrants.find((e) => e.id === 's2').status, 'rejected');
});

test('T3 踢出报名者：仅报名阶段可用，被踢后不能立刻再报', () => {
  const id = mkApproved({ requireApproval: false });
  T.joinTournament(id, { id: 'k1', name: '戊' });
  assert.strictEqual(T.kickPlayer(id, 'k1').ok, true);
  assert.strictEqual(T.getTournament(id).entrants[0].status, 'kicked');
  assert.strictEqual(T.joinTournament(id, { id: 'k1', name: '戊' }).ok, false);
  assert.strictEqual(T.kickPlayer(id, 'nobody').ok, false, '踢不存在的人应报错');
});

test('T3 未满员开赛：多出的位置首轮轮空，但**绝不能**直接判成冠军', () => {
  const id = mkApproved({ requireApproval: false }); // size = 4，只来 3 人
  T.joinTournament(id, { id: 'a1', name: 'A' });
  T.joinTournament(id, { id: 'a2', name: 'B' });
  T.joinTournament(id, { id: 'a3', name: 'C' });
  assert.strictEqual(T.getTournament(id).status, 'registration', '未满员不该自动开赛');

  let n = 0;
  T.setMatchFactory(() => ({ roomId: 'room-' + (++n) })); // 建房替身：不碰真实房间
  const r = T.startTournament(id, { byRole: 'owner', action: 'start' });
  assert.strictEqual(r.ok, true, r.error || '');

  const t = T.getTournament(id);
  assert.strictEqual(t.status, 'playing');
  assert.strictEqual(t.players.length, 3);

  // 4 人档 / 3 名选手：一棵子树有两人（建房）、另一棵只有一人（轮空）
  const byeNodes = t.bracket.filter((x) => x.winnerId && !x.players);
  assert.strictEqual(byeNodes.length, 1, '应恰好有 1 个轮空位');
  assert.strictEqual(byeNodes[0].winnerId, 'a3', '轮空应判给唯一的那个人');

  // 这是本测试的重点：轮空者**不能**因此在决赛被直接判成冠军
  const root = t.bracket[0];
  assert.strictEqual(root.winnerId, null, '另一场还没打完，冠军不该产生');
  assert.strictEqual(root.matchId, null, '决赛应等另一场出结果后再建房');
  assert.strictEqual(t.championId, null, '绝不能提前产生冠军');

  // 另一场打完后，决赛才该建房
  const liveMatch = t.bracket.find((x) => x.matchId);
  assert.ok(liveMatch, '两个真选手之间应已建房');
  const finished = T.onMatchFinished(id, liveMatch.matchId, 'a1');
  assert.strictEqual(finished.ok, true);
  const after = T.getTournament(id);
  const finalNode = after.bracket[0];
  assert.ok(finalNode.matchId, '另一场结束后，决赛才建房');
});

test('T3 开赛门槛：不足 2 名通过审核者不能开赛', () => {
  const id = mkApproved({ requireApproval: false });
  T.joinTournament(id, { id: 'b1', name: '独占' });
  const r = T.startTournament(id, { byRole: 'owner', action: 'start' });
  assert.strictEqual(r.ok, false, '只有 1 人时不该能开赛');
  assert.match(r.error, /2 名/);
});

// ======================================================================
// T8 瑞士制：逐轮配对与推进
// ======================================================================

/**
 * 造一个已审核通过的瑞士制赛事（**已开赛**），返回其 id。
 *
 * ⚠️ 人数档故意用 32：免审核路径下"报名满 size"会**自动开赛**，
 * 那样测试里再显式调 `startTournament` 就会撞到"状态已变更"。
 * 用远大于参赛人数的档位，既避免了自动开赛，也更贴近真实（未满员开赛是允许的）。
 */
function mkSwiss(playerCount, over, idPrefix) {
  const pre = idPrefix || 's';
  const r = T.createTournament('瑞士制测试赛', 32, { id: 'owner-s', name: '主办' }, Object.assign({
    reason: '用于验证瑞士制逐轮配对与推进的测试赛事',
    format: 'swiss',
    requireApproval: false,
    totalRounds: 3,
  }, over || {}));
  assert.strictEqual(r.ok, true, r.error || '');
  const id = r.tournament.id;
  T.approveTournament(id);
  for (let i = 1; i <= playerCount; i++) {
    const j = T.joinTournament(id, { id: pre + i, name: '棋手' + i });
    assert.strictEqual(j.ok, true, j.error || '');
  }
  return id;
}

/** 建房替身：瑞士制每轮都会建房，用一个自增计数器给出门牌号 */
function stubRooms() {
  let n = 0;
  T.setMatchFactory(() => ({ roomId: 'sw-' + (++n) }));
}

test('T8 建赛：瑞士制轮数默认按人数给建议值，越界要拒绝', () => {
  const r1 = T.createTournament('瑞士制A', 8, { id: 'o', name: '主办' }, {
    reason: '这条理由足够长可以通过服务端校验',
    format: 'swiss',
  });
  assert.strictEqual(r1.ok, true, r1.error || '');
  assert.strictEqual(r1.tournament.format, 'swiss');
  assert.strictEqual(r1.tournament.totalRounds, 3, '8 人 → max(3, ceil(log2 8)) = 3');
  assert.strictEqual(r1.tournament.currentRound, 0, '未开赛时轮次为 0');
  assert.deepStrictEqual(r1.tournament.rounds, []);
  assert.deepStrictEqual(r1.tournament.bracket, [], '瑞士制不该有淘汰树');

  const bad = T.createTournament('瑞士制B', 8, { id: 'o', name: '主办' }, {
    reason: '这条理由足够长可以通过服务端校验', format: 'swiss', totalRounds: 20,
  });
  assert.strictEqual(bad.ok, false, '轮数超上限应拒绝');
  assert.match(bad.error, /轮数/);

  const bad2 = T.createTournament('瑞士制C', 8, { id: 'o', name: '主办' }, {
    reason: '这条理由足够长可以通过服务端校验', format: 'swiss', totalRounds: 1,
  });
  assert.strictEqual(bad2.ok, false, '轮数少于 3 应拒绝');
});

test('T8 开赛：首轮按名次配对建房，不生成对阵树', () => {
  stubRooms();
  const id = mkSwiss(8);
  const r = T.startTournament(id, { byRole: 'owner', action: 'start' });
  assert.strictEqual(r.ok, true, r.error || '');

  const t = T.getTournament(id);
  assert.strictEqual(t.status, 'playing');
  assert.strictEqual(t.format, 'swiss');
  assert.strictEqual(t.currentRound, 1);
  assert.strictEqual(t.rounds.length, 1, '应只有第 1 轮');
  assert.strictEqual(t.rounds[0].pairs.length, 4, '8 人 → 4 场');
  assert.strictEqual(t.rounds[0].matchIds.filter(Boolean).length, 4, '4 场都要有房间');
  assert.strictEqual(t.bracket.length, 0, '瑞士制不生成对阵树');
});

test('T8 推进：一轮没打完不配下一轮，打完整轮才配', () => {
  stubRooms();
  const id = mkSwiss(8);
  T.startTournament(id, { byRole: 'owner', action: 'start' });

  let t = T.getTournament(id);
  const r1ids = t.rounds[0].matchIds.slice();
  assert.strictEqual(r1ids.length, 4);

  // 只打 3 场 → 仍是第 1 轮
  for (let i = 0; i < 3; i++) {
    const res = T.onMatchFinished(id, r1ids[i], t.rounds[0].pairs[i][0]);
    assert.strictEqual(res.ok, true, res.error || '');
  }
  t = T.getTournament(id);
  assert.strictEqual(t.currentRound, 1, '还差一场，不该进入第 2 轮');
  assert.strictEqual(t.rounds.length, 1);

  // 打完第 4 场 → 自动进入第 2 轮
  T.onMatchFinished(id, r1ids[3], t.rounds[0].pairs[3][0]);
  t = T.getTournament(id);
  assert.strictEqual(t.currentRound, 2, '整轮打完应自动配下一轮');
  assert.strictEqual(t.rounds.length, 2);
  assert.strictEqual(t.rounds[1].pairs.length, 4);
});

test('T8 收尾：轮数跑完按名次定冠军，并与名次表一致', () => {
  stubRooms();
  const id = mkSwiss(4, { totalRounds: 3 });
  T.startTournament(id, { byRole: 'owner', action: 'start' });

  // 每轮把"组内前一人"判胜，制造分数分化
  for (let round = 1; round <= 3; round++) {
    const t = T.getTournament(id);
    const rec = t.rounds[round - 1];
    assert.ok(rec, `第 ${round} 轮应存在`);
    rec.pairs.forEach(([a], i) => {
      const res = T.onMatchFinished(id, rec.matchIds[i], a);
      assert.strictEqual(res.ok, true, res.error || '');
    });
  }

  const t = T.getTournament(id);
  assert.strictEqual(t.status, 'finished', '轮数跑完应结束');
  assert.ok(t.championId, '应产生冠军');
  assert.strictEqual(t.championId, t.standings[0].id, '冠军必须是名次表第一');
  assert.ok(t.endedAt, '结束要记 endedAt（自动存档依赖它）');
  assert.strictEqual(t.rounds.length, 3, '不该多配出第 4 轮');
});

test('T8 名次表：胜 1 / 和 0.5 / 负 0，轮空得 1 分；奇数人有一个轮空', () => {
  stubRooms();
  const id = mkSwiss(5); // 奇数人
  T.startTournament(id, { byRole: 'owner', action: 'start' });

  let t = T.getTournament(id);
  assert.strictEqual(t.rounds[0].pairs.length, 2, '5 人 → 2 场 + 1 轮空');
  assert.strictEqual(t.rounds[0].byes.length, 1, '奇数人必须恰好一人轮空');

  const byeId = t.rounds[0].byes[0];
  const byeRow = t.standings.find((s) => s.id === byeId);
  assert.strictEqual(byeRow.score, 1, '轮空视同胜，得 1 分');
  assert.strictEqual(byeRow.byes, 1);

  // 打完全部对局 + 第 2、3 轮，确认名次表仍是自洽的
  for (let round = 1; round <= 3; round++) {
    const cur = T.getTournament(id);
    const rec = cur.rounds[round - 1];
    rec.pairs.forEach(([a], i) => T.onMatchFinished(id, rec.matchIds[i], a));
  }
  t = T.getTournament(id);
  assert.strictEqual(t.status, 'finished');
  const total = t.standings.reduce((s, x) => s + x.score, 0);
  // 每轮总得分是固定的：3 场/轮（2 场分出胜负 + 1 个轮空得 1）= 3 分/轮
  assert.strictEqual(total, 9, `3 轮总得分应为 9，实际 ${total}`);
});

test('T8 确定性：同样输入两次配对结果一致', () => {
  stubRooms();
  const id = mkSwiss(8);
  T.startTournament(id, { byRole: 'owner', action: 'start' });
  const before = JSON.stringify(T.getTournament(id).rounds[0].pairs);
  const again = JSON.stringify(T.getTournament(id).rounds[0].pairs);
  assert.strictEqual(before, again, '同样输入必须得到同样配对（否则测试会随机失败）');
});

test('T8 取消赛事：必须把**瑞士制的未结束房间**也交出来解散', () => {
  stubRooms();
  const id = mkSwiss(8);
  T.startTournament(id, { byRole: 'owner', action: 'start' });

  const t = T.getTournament(id);
  const live = t.rounds[0].matchIds.filter(Boolean);
  assert.strictEqual(live.length, 4, '前置条件：第 1 轮 4 场都有房间');

  // 打完一场 → 这一场不再是"进行中"
  T.onMatchFinished(id, live[0], t.rounds[0].pairs[0][0]);

  const r = T.cancelTournament(id, '测试取消');
  assert.strictEqual(r.ok, true, r.error || '');
  assert.strictEqual(r.tournament.status, 'cancelled');
  // ⚠️ 本测试的重点：房间只在 `rounds` 里、不在 `bracket` 里。
  // 若取消逻辑只看 `bracket`，这里会返回**空数组**——赛事显示已取消，
  // 而参赛者还在房内下棋。
  assert.strictEqual(r.matchIds.length, 3, '应交出剩余 3 个仍在进行中的房间');
  assert.strictEqual(r.matchIds.indexOf(live[0]) >= 0, false, '已打完的那场不该包含在内');
});

test('T8 取消选手成绩：判对手胜，名次随之变化', () => {
  stubRooms();
  const id = mkSwiss(4, { totalRounds: 3 });
  T.startTournament(id, { byRole: 'owner', action: 'start' });

  let t = T.getTournament(id);
  const rec = t.rounds[0];
  const [a, b] = rec.pairs[0];
  T.onMatchFinished(id, rec.matchIds[0], a); // a 先赢一场
  t = T.getTournament(id);
  assert.strictEqual(t.standings.find((s) => s.id === a).score, 1);

  const r = T.voidPlayer(id, a, { id: 'owner-s' });
  assert.strictEqual(r.ok, true, r.error || '');
  assert.strictEqual(r.affected, 1, '只影响到他打过的这一场');

  t = T.getTournament(id);
  assert.strictEqual(t.standings.find((s) => s.id === a).score, 0, '成绩取消后不得分');
  assert.strictEqual(t.standings.find((s) => s.id === b).score, 1, '应改判对手胜');
});

test('T8 重赛：只允许对当前轮申请，且批准后该场回到未完赛', () => {
  stubRooms();
  const id = mkSwiss(4, { totalRounds: 3 });
  T.startTournament(id, { byRole: 'owner', action: 'start' });

  let t = T.getTournament(id);
  const rec1 = t.rounds[0];
  const m0 = rec1.matchIds[0];
  // 打完第 1 轮 → 进入第 2 轮
  rec1.pairs.forEach(([a], i) => T.onMatchFinished(id, rec1.matchIds[i], a));
  t = T.getTournament(id);
  assert.strictEqual(t.currentRound, 2);

  // 第 1 轮的场次：现在已不是当前轮 → 拒绝申请
  const late = T.requestRematch(id, m0, '想重打上一轮', { id: rec1.pairs[0][0], name: 'x' });
  assert.strictEqual(late.ok, false, '之前轮次不允许申请重赛');
  assert.match(late.error, /当前第 2 轮/);

  // 第 2 轮的场次：可以申请，且只有本场选手能申请
  const rec2 = t.rounds[1];
  const m2 = rec2.matchIds[0];
  const [pa, pb] = rec2.pairs[0];
  const stranger = T.requestRematch(id, m2, '路人凑热闹', { id: 'not-in-this-match' });
  assert.strictEqual(stranger.ok, false, '非本场选手不能申请');

  const reqOk = T.requestRematch(id, m2, '掉线了', { id: pa, name: 'x' });
  assert.strictEqual(reqOk.ok, true, reqOk.error || '');
  assert.strictEqual(reqOk.rematch.round, 2, '要记下是第几轮');

  // 先打完这一场，再批准重赛 → 该场应回到"未完赛"
  T.onMatchFinished(id, m2, pa);
  t = T.getTournament(id);
  assert.strictEqual(t.rounds[1].results[[pa, pb].sort().join('|')], pa, '前置条件：这一场已判 pa 胜');

  const decided = T.decideRematch(id, reqOk.rematch.id, 'approve', { id: 'owner-s' }, '同意');
  assert.strictEqual(decided.ok, true, decided.error || '');
  t = T.getTournament(id);
  const key = [pa, pb].sort().join('|');
  assert.strictEqual(t.rounds[1].results[key], undefined, '重赛批准后该场赛果应被抹掉');
  assert.ok(t.rounds[1].matchIds[0], '应重建房间');
  assert.strictEqual(t.currentRound, 2, '仍停在第 2 轮（这一场没打完）');
});

test('T8 重赛：非当前轮的申请无法被批准（即使绕过了申请阶段的限制）', () => {
  stubRooms();
  const id = mkSwiss(4, { totalRounds: 3 });
  T.startTournament(id, { byRole: 'owner', action: 'start' });

  const t0 = T.getTournament(id);
  const rec1 = t0.rounds[0];
  const m0 = rec1.matchIds[0];
  const [pa, pb] = rec1.pairs[0];
  const req = T.requestRematch(id, m0, '理由', { id: pa });
  assert.strictEqual(req.ok, true, req.error || '');

  // 打完第 1 轮进入第 2 轮后，再批准这条"第 1 轮"的申请
  rec1.pairs.forEach(([a], i) => T.onMatchFinished(id, rec1.matchIds[i], a));
  const decided = T.decideRematch(id, req.rematch.id, 'approve', { id: 'owner-s' }, '');
  assert.strictEqual(decided.ok, false, '已过轮次的申请不该被批准');
  assert.match(decided.error, /当前轮/);

  // 失败不应把申请留在"已批准但没生效"的坏状态
  const t = T.getTournament(id);
  const rm = t.rematches.find((r) => r.id === req.rematch.id);
  assert.strictEqual(rm.status, 'pending', '批准失败要退回 pending，不能留在 approved');
});

// ======================================================================
// T4 取消选手成绩 / 设置冠军
// ======================================================================

test('T4 设置冠军：**仅管理员**（主办人也不行）', () => {
  const id = mkApproved({ requireApproval: false });
  for (let i = 1; i <= 4; i++) T.joinTournament(id, { id: 'c' + i, name: '选手' + i });
  assert.strictEqual(T.getTournament(id).status, 'playing');

  assert.strictEqual(T.setChampion(id, 'c1', { id: 'owner-1' }).ok, false, '主办人不能设冠军（用户 2026-09-13 明确）');
  assert.strictEqual(T.setChampion(id, 'c1', { id: 'passer-by' }).ok, false, '路人不能设冠军');

  const r = T.setChampion(id, 'c1', { id: 'adm', isAdmin: true });
  assert.strictEqual(r.ok, true, r.error || '');
  const t = T.getTournament(id);
  assert.strictEqual(t.championId, 'c1');
  assert.strictEqual(t.championManual, true, '人工裁定要打标，避免被自动收尾覆盖');
  assert.strictEqual(T.setChampion(id, 'nobody', { id: 'adm', isAdmin: true }).ok, false, '不在名单里的人不能当冠军');
});

test('T4 取消选手成绩：判对手胜，且下游重算（冠军不该是已取消的人）', () => {
  const id = mkApproved({ requireApproval: false }); // size = 4
  for (let i = 1; i <= 4; i++) T.joinTournament(id, { id: 'v' + i, name: '选手' + i });
  let n = 0;
  T.setMatchFactory(() => ({ roomId: 'vroom-' + (++n) }));
  T.startTournament(id, { byRole: 'owner', action: 'start' });

  let t = T.getTournament(id);
  assert.strictEqual(t.status, 'playing');
  const semis = t.bracket.filter((x) => x.matchId);
  assert.strictEqual(semis.length, 2, '4 人首轮应有两场');

  // 让第一场（v1 vs v2）由 v1 胜出 → v1 站到决赛位
  const m0 = semis[0];
  const finished = T.onMatchFinished(id, m0.matchId, 'v1');
  assert.strictEqual(finished.ok, true, finished.error || '');
  t = T.getTournament(id);
  assert.strictEqual(t.bracket.find((x) => x.index === m0.index).winnerId, 'v1');

  // 取消 v1 的成绩 → 对手 v2 应改为晋级
  const r = T.voidPlayer(id, 'v1', { id: 'owner-1' });
  assert.strictEqual(r.ok, true, r.error || '');
  t = T.getTournament(id);
  assert.strictEqual(
    t.bracket.find((x) => x.index === m0.index).winnerId, 'v2',
    '取消成绩后应判对手晋级'
  );
  assert.strictEqual(
    t.bracket.filter((x) => x.winnerId === 'v1').length, 0,
    'v1 不该残留在任何"已晋级"位置上（下游必须一起清）'
  );
  assert.notStrictEqual(t.championId, 'v1', '冠军绝不能是已被取消成绩的人');
});

test('T4 取消选手成绩：权限与名单校验', () => {
  const id = mkApproved({ requireApproval: false });
  for (let i = 1; i <= 4; i++) T.joinTournament(id, { id: 'z' + i, name: '选手' + i });

  assert.strictEqual(T.voidPlayer(id, 'z1', { id: 'passer-by' }).ok, false, '路人不能取消成绩');
  assert.strictEqual(T.voidPlayer(id, 'z1', { id: 'owner-1' }).ok, true, '主办人可以在开赛后取消成绩');
  assert.strictEqual(T.voidPlayer(id, 'ghost', { id: 'owner-1' }).ok, false, '不在参赛名单里的人应报错');
});

// ======================================================================
// T6 重赛 / 赛后存档 / 管理员编辑
// ======================================================================

/** 造一个 4 人已开赛的赛事，返回首场的 matchId（建房替身在开赛前就位） */
function mkPlaying() {
  let n = 0;
  T.setMatchFactory(() => ({ roomId: 'room-' + (++n) })); // 必须先于开赛
  const id = mkApproved({ requireApproval: false });
  for (let i = 1; i <= 4; i++) T.joinTournament(id, { id: 'r' + i, name: '选手' + i });
  const t = T.getTournament(id);
  assert.strictEqual(t.status, 'playing', '4 人满员应自动开赛');
  const first = t.bracket.filter((x) => x.matchId)[0];
  assert.ok(first, '首轮应已建房');
  return { id, matchId: first.matchId };
}

test('T6 重赛申请：只有本场选手能提（同赛事的其他选手也不行）', () => {
  const { id, matchId } = mkPlaying();
  T.onMatchFinished(id, matchId, 'r1'); // 首场结束（r1 vs r2）

  // ⚠️ 这是本测试的重点：同样是"参赛者"，没打这一场的人不能对别人的对局申诉
  const other = T.requestRematch(id, matchId, '我也想重赛', { id: 'r3', name: '选手3' });
  assert.strictEqual(other.ok, false, '非本场选手不能申请重赛');
  assert.match(other.error, /本场参赛者/);

  const mine = T.requestRematch(id, matchId, '网络卡顿', { id: 'r1', name: '选手1' });
  assert.strictEqual(mine.ok, true, mine.error || '');
  assert.strictEqual(mine.rematch.status, 'pending');

  // 同一场不能重复申请（对手也不行，否则主办人要处理一堆重复申诉）
  assert.strictEqual(T.requestRematch(id, matchId, '再来一次', { id: 'r2', name: '选手2' }).ok, false);
});

test('T6 重赛裁决：批准后作废该场结果并重建这一局', () => {
  const { id, matchId } = mkPlaying();
  T.onMatchFinished(id, matchId, 'r1');
  const rm = T.requestRematch(id, matchId, '掉线了', { id: 'r1', name: '选手1' }).rematch;

  assert.strictEqual(T.decideRematch(id, rm.id, 'approve', { id: 'not-owner' }).ok, false, '路人不能裁决');

  const r = T.decideRematch(id, rm.id, 'approve', { id: 'owner-1' }, '同意重赛');
  assert.strictEqual(r.ok, true, r.error || '');

  const t = T.getTournament(id);
  const node = t.bracket.find((x) => x.index === rm.nodeIndex);
  assert.strictEqual(node.winnerId, null, '批准后该场结果应被作废');
  assert.ok(node.matchId, '应重新建房');
  assert.notStrictEqual(node.matchId, matchId, '应是新房间，而不是把旧房间挂回去');
  assert.strictEqual(t.rematches.find((x) => x.id === rm.id).status, 'approved');
  // 旧申请不能二次处置
  assert.strictEqual(T.decideRematch(id, rm.id, 'reject', { id: 'owner-1' }).ok, false);
});

test('T6 重赛裁决：驳回则对阵原样不动', () => {
  const { id, matchId } = mkPlaying();
  T.onMatchFinished(id, matchId, 'r1');
  const rm = T.requestRematch(id, matchId, '手滑', { id: 'r2', name: '选手2' }).rematch;

  const r = T.decideRematch(id, rm.id, 'reject', { id: 'owner-1' }, '结果有效');
  assert.strictEqual(r.ok, true, r.error || '');
  const node = T.getTournament(id).bracket.find((x) => x.index === rm.nodeIndex);
  assert.strictEqual(node.winnerId, 'r1', '驳回后结果应保持不变');
  assert.strictEqual(node.matchId, null, '不该重新建房');
});

/**
 * 造一个**已结束**（finished）的 4 人赛事，返回其 id。
 *
 * ⚠️ 不能用 2 人档走捷径：`SIZE_OPTIONS` 只认 4/8/16/32（2 的幂且下限 4），
 * 所以最小的"打完一场即结束"也是 4 人赛 → 半决赛两场 + 决赛一场。
 */
function mkFinished() {
  let n = 0;
  T.setMatchFactory(() => ({ roomId: 'fin-' + (++n) }));
  const id = mkApproved({ requireApproval: false });
  for (let i = 1; i <= 4; i++) T.joinTournament(id, { id: 'w' + i, name: '选手' + i });

  const semis = T.getTournament(id).bracket.filter((x) => x.matchId);
  assert.strictEqual(semis.length, 2, '4 人首轮应有两场');
  T.onMatchFinished(id, semis[0].matchId, 'w1');
  T.onMatchFinished(id, semis[1].matchId, 'w3');

  const finalNode = T.getTournament(id).bracket.filter((x) => x.index === 0 && x.matchId)[0];
  assert.ok(finalNode, '半决赛出结果后决赛应建房');
  T.onMatchFinished(id, finalNode.matchId, 'w1');

  const t = T.getTournament(id);
  assert.strictEqual(t.status, 'finished', '决赛结束应产生冠军');
  assert.ok(t.endedAt, '结束时要记 endedAt，否则自动存档无从计算');
  return id;
}

test('T6 存档：仅管理员；存档后主办人只读、管理员仍可编辑', () => {
  const id = mkFinished();
  const owner = { id: 'owner-1' };
  const admin = { id: null, isAdmin: true };

  assert.strictEqual(T.archiveTournament(id, owner).ok, false, '主办人不能存档');
  assert.strictEqual(T.archiveTournament(id, admin).ok, true, '管理员可以存档');
  assert.strictEqual(T.getTournament(id).status, 'archived');

  const t = T.getTournament(id);
  assert.strictEqual(T.canManage(t, owner, 'void_player'), false, '存档后主办人不能取消成绩');
  assert.strictEqual(T.canManage(t, owner, 'cancel'), false, '存档后主办人不能取消赛事');
  assert.strictEqual(T.canManage(t, owner, 'decide_entrant'), false, '存档后主办人不能批报名');
  assert.strictEqual(T.canManage(t, admin, 'edit_archived'), true, '管理员仍可编辑');
});

test('T6 自动存档：过了收尾窗口才会触发', () => {
  const id = mkFinished();
  const ended = T.getTournament(id);

  const H = T.ARCHIVE_AFTER_HOURS;
  assert.strictEqual(T.autoArchiveDue(ended.endedAt + (H - 1) * 3600 * 1000), 0, '窗口内不该存档');
  assert.strictEqual(T.getTournament(id).status, 'finished');

  // ⚠️ 这里**不能断言"恰好存档 1 个"**：`autoArchiveDue` 扫的是**全局**所有已结束赛事，
  // 而本文件里别的用例（如 T8 瑞士制）也会留下已结束的赛事，它们同样落在窗口外。
  // 断言"数量 == 1"就变成了"依赖这个文件里没有别的已结束赛事"——加个用例就会挂。
  // 真正要验的是：**这一个**到期后被存档了（数量只保证至少 1）。
  const n = T.autoArchiveDue(ended.endedAt + (H + 1) * 3600 * 1000);
  assert.ok(n >= 1, `超过窗口应自动存档，实际存档 ${n} 个`);
  assert.strictEqual(T.getTournament(id).status, 'archived', '本赛事必须被存档');
});

test('T6 管理员编辑已存档赛事：仅管理员、仅 archived、每次留痕', () => {
  const id = mkFinished();
  const owner = { id: 'owner-1' };
  const admin = { id: null, isAdmin: true };

  assert.strictEqual(T.editArchived(id, 'note', 'x', admin).ok, false, '未存档不该走编辑通道');

  T.archiveTournament(id, admin);
  assert.strictEqual(T.editArchived(id, 'note', '赛后更正', owner).ok, false, '主办人不能编辑已存档赛事');

  const r = T.editArchived(id, 'note', '赛后更正说明', admin, '补充说明');
  assert.strictEqual(r.ok, true, r.error || '');
  const t = T.getTournament(id);
  assert.strictEqual(t.note, '赛后更正说明');
  assert.strictEqual((t.adminEditLog || []).length, 1, '每次编辑必须留痕');
  assert.strictEqual(t.adminEditLog[0].field, 'note');
  assert.strictEqual(t.adminEditLog[0].to, '赛后更正说明');
  assert.strictEqual(t.adminEditLog[0].note, '补充说明');

  assert.strictEqual(T.editArchived(id, 'size', 8, admin).ok, false, '人数档位不是可编辑字段');
  assert.strictEqual(T.editArchived(id, 'note', '赛后更正说明', admin).ok, false, '内容没变化应拒绝');
});

// ======================================================================
// 等级特权（2026-09-20 用户要求：等级 5 才能举办赛事）
// ======================================================================

test('等级特权：建赛门槛在服务端拦住等级不足者', () => {
  const low = 'owner-low'; // 故意没在文件顶部被抬等级
  assert.strictEqual(ratings.levelOf(low), 0, '前置条件：Lv.0');

  const r = T.createTournament('等级不足', 4, { id: low, name: '新人' }, {
    reason: '这是一条足够长的举办理由，用于验证等级门槛',
  });
  assert.strictEqual(r.ok, false, 'Lv.0 不该能建赛');
  assert.strictEqual(r.code, 'LEVEL_REQUIRED', '要给出机器可判的错误码，前端才能针对性提示');
  assert.match(r.error, /Lv\.5/, '文案要写清需要几级');
  assert.match(r.error, /Lv\.0/, '文案要写清当前几级');

  // 补足经验 → 放行
  ratings.adminSetPlayer(low, { exp: LV5_EXP });
  assert.ok(ratings.levelOf(low) >= 5, '前置条件：已到 5 级');
  const ok = T.createTournament('等级达标', 4, { id: low, name: '老手' }, {
    reason: '这是一条足够长的举办理由，用于验证等级门槛',
  });
  assert.strictEqual(ok.ok, true, ok.error || '');
});

test('等级特权：门槛表是唯一判定来源，未定义的门槛不限制', () => {
  assert.strictEqual(ratings.LEVEL_PRIVILEGES.create_tournament, 5, '门槛值只在表里');
  // 未定义 = 不限制：新加特权时默认放开，避免"悄悄拦住老功能"
  assert.strictEqual(ratings.hasPrivilege('whoever', 'some_future_privilege'), true);
  assert.strictEqual(ratings.hasPrivilege('owner-low-but-fresh', 'create_tournament'), false);
});

// ======================================================================
// 赛事荣誉（个人页"赛事荣誉栏"）
// ======================================================================

/**
 * 4 人淘汰赛打到底，返回 { id, champ, runner, semiLosers }。
 *
 * ⚠️ 房间号前缀与选手 id 前缀**分开**：要验"同一人多次夺冠"时，
 * 必须让两场赛事的选手 id 相同、而房间号不同（房间号必须全局唯一）。
 */
function playOutElim(roomPrefix, playerPrefix) {
  let n = 0;
  T.setMatchFactory(() => ({ roomId: `${roomPrefix}-${++n}` }));
  const id = mkApproved({ requireApproval: false }); // size = 4
  for (let i = 1; i <= 4; i++) T.joinTournament(id, { id: playerPrefix + i, name: '棋手' + i });
  assert.strictEqual(T.getTournament(id).status, 'playing', '满员应自动开赛');

  // ⚠️ 必须先快照半决赛的双方：对局结束后 `players` 会被清空，之后就只能读 `lastPlayers`
  const semis = T.getTournament(id).bracket
    .filter((x) => x.matchId)
    .map((x) => ({ matchId: x.matchId, players: x.players.slice() }));
  assert.strictEqual(semis.length, 2, '4 人首轮应有两场');

  const champ = semis[0].players[0];
  const runner = semis[1].players[0];
  const semiLosers = [semis[0].players[1], semis[1].players[1]];

  T.onMatchFinished(id, semis[0].matchId, champ);
  T.onMatchFinished(id, semis[1].matchId, runner);

  const finalNode = T.getTournament(id).bracket.find((x) => x.matchId);
  assert.ok(finalNode, '半决赛结束后应建出决赛');
  T.onMatchFinished(id, finalNode.matchId, champ);
  return { id, champ, runner, semiLosers };
}

test('赛事荣誉：淘汰赛的冠军 / 亚军 / 四强都要算对', () => {
  const { id, champ, runner, semiLosers } = playOutElim('hn', 'hn');
  const t = T.getTournament(id);
  assert.strictEqual(t.status, 'finished');
  assert.strictEqual(t.championId, champ);

  assert.strictEqual(T.placeOf(t, champ), 1, '冠军');
  assert.strictEqual(T.placeOf(t, runner), 2, '亚军 = 决赛失利者');
  assert.strictEqual(T.placeOf(t, semiLosers[0]), 3, '半决赛失利 = 四强');
  assert.strictEqual(T.placeOf(t, semiLosers[1]), 3, '半决赛失利 = 四强');

  const h = T.honorsOf(champ);
  assert.strictEqual(h.stats.joined, 1);
  assert.strictEqual(h.stats.finished, 1);
  assert.strictEqual(h.stats.titles, 1);
  assert.strictEqual(h.stats.runnerUps, 0);
  assert.strictEqual(h.stats.winRate, 100);
  assert.strictEqual(h.items.length, 1);
  assert.strictEqual(h.items[0].place, 1);
  assert.strictEqual(h.items[0].placeLabel, '冠军');
  assert.strictEqual(h.items[0].tournamentId, id);

  assert.strictEqual(T.honorsOf(runner).stats.runnerUps, 1);
  assert.strictEqual(T.honorsOf(runner).items[0].placeLabel, '亚军');
  assert.strictEqual(T.honorsOf(semiLosers[0]).stats.top4, 1);
  assert.strictEqual(T.honorsOf(semiLosers[0]).items[0].placeLabel, '四强');

  // 没参加过的人：全零，不报错
  const none = T.honorsOf('never-played-someone');
  assert.deepStrictEqual(none.stats, { joined: 0, finished: 0, titles: 0, runnerUps: 0, top4: 0, winRate: 0 });
  assert.deepStrictEqual(none.items, []);
});

test('赛事荣誉：进行中的赛事只计入"参赛"，不产生名次', () => {
  let n = 0;
  T.setMatchFactory(() => ({ roomId: 'hprog-' + (++n) }));
  const id = mkApproved({ requireApproval: false });
  for (let i = 1; i <= 4; i++) T.joinTournament(id, { id: 'pg' + i, name: '棋手' + i });

  // 半决赛打了一场：此时"打过半决赛的人"绝不能算成四强
  const t0 = T.getTournament(id);
  assert.strictEqual(t0.status, 'playing');
  const semi = t0.bracket.find((x) => x.matchId);
  T.onMatchFinished(id, semi.matchId, semi.players[0]);

  const h = T.honorsOf('pg1');
  assert.strictEqual(h.stats.joined, 1, '进行中的赛事要算进"参赛赛事"');
  assert.strictEqual(h.stats.finished, 0, '还没结束');
  assert.strictEqual(h.items.length, 0, '没有结论就不该出现在荣誉明细里');
  assert.strictEqual(T.placeOf(T.getTournament(id), 'pg1'), null, '进行中不产生名次');
});

test('赛事荣誉：取消的赛事不算参赛', () => {
  const id = mkApproved({ requireApproval: false });
  T.joinTournament(id, { id: 'cx1', name: '棋手' });
  assert.strictEqual(T.honorsOf('cx1').stats.joined, 1, '前置条件：已报名');
  assert.strictEqual(T.cancelTournament(id, '测试取消').ok, true);
  assert.strictEqual(T.honorsOf('cx1').stats.joined, 0, '取消的赛事不该算作参赛经历');
});

test('赛事荣誉：瑞士制名次取自积分榜，前四之外不算荣誉', () => {
  stubRooms();
  // ⚠️ 选手 id 必须用**本测试专属前缀**：荣誉是**跨赛事聚合**的，
  // 而测试共享同一个赛事缓存 —— 用通用的 `s1`/`s2` 会把别的用例里的冠军也算进来
  //（本测试就因为这个数到了 3 次夺冠）。
  const id = mkSwiss(8, { totalRounds: 3 }, 'swhon');
  T.startTournament(id, { byRole: 'owner', action: 'start' });

  for (let round = 1; round <= 3; round++) {
    const rec = T.getTournament(id).rounds[round - 1];
    rec.pairs.forEach(([a], i) => T.onMatchFinished(id, rec.matchIds[i], a));
  }

  const t = T.getTournament(id);
  assert.strictEqual(t.status, 'finished');
  assert.strictEqual(t.standings.length, 8);
  assert.strictEqual(T.placeOf(t, t.standings[0].id), 1, '积分榜第一 = 冠军');
  assert.strictEqual(T.placeOf(t, t.standings[1].id), 2, '积分榜第二 = 亚军');
  assert.strictEqual(T.placeOf(t, t.standings[2].id), 3, '3~4 名 = 四强');
  assert.strictEqual(T.placeOf(t, t.standings[4].id), null, '第 5 名起不算荣誉');

  const h = T.honorsOf(t.standings[0].id);
  assert.strictEqual(h.stats.titles, 1);
  assert.strictEqual(h.items[0].formatLabel, '瑞士制（积分编排）', '荣誉明细要带上赛制');
  assert.strictEqual(h.items[0].size, 32);
});

test('赛事荣誉：同一人多次夺冠会累积，明细按结束时间倒序', () => {
  // 两场赛事的**房间号不同、选手 id 相同** —— 这样才是"同一个人打了两场"
  const a = playOutElim('ha', 'same');
  const b = playOutElim('hb', 'same');
  const who = a.champ;
  assert.strictEqual(b.champ, who, '同一批选手、同样的比赛顺序 → 冠军应当是同一人');

  const h = T.honorsOf(who);
  assert.strictEqual(h.stats.joined, 2, '两场都算参赛');
  assert.strictEqual(h.stats.finished, 2);
  assert.strictEqual(h.stats.titles, 2, '两次夺冠要累积');
  assert.strictEqual(h.stats.winRate, 100);
  assert.strictEqual(h.items.length, 2);
  assert.ok((h.items[0].endedAt || 0) >= (h.items[1].endedAt || 0), '新的在前');
});

test('赛事荣誉：荣誉明细条数受 limit 限制（个人页是概览，不铺全量）', () => {
  for (let i = 0; i < 3; i++) playOutElim('hl' + i, 'lim');
  const h = T.honorsOf('lim1', 2);
  assert.strictEqual(h.stats.joined, 3, '统计要覆盖全部');
  assert.strictEqual(h.items.length, 2, '明细只给前 2 条');
});
