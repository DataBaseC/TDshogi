'use strict';
/**
 * items-grant-safety.test.js — 道具发放与背包（2026-10-12《诊断与改进方案》落地）
 *
 * 守四件事：
 *  ① **孤儿键护栏**：发放类写操作的收件人必须真实存在（`resolveItemTarget`）——
 *     不存在的名字/裸 id 一律 null。这是「发放不出去」（静默写进无人认领的键）的回归防线；
 *  ② **按用户名发放**：`accounts.getAccountByName` + `resolveItemTarget(用户名)`；
 *  ③ **BGM 槽位归一**：缺 role 的 BGM 不再退化成非法槽 'bgm'（BAD_SLOT），
 *     统一由 `slotForItem`（唯一真相源）推导；目录响应带 `equipSlot`；
 *  ④ **背包自愈 + 发放流水**：装备指向失效道具时回落默认；grant/addCoin 会落流水。
 *
 * 与 items-store.test.js 同款：内存 storage 桩 + 惰性 ratings 桩（不碰真库）。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const STORAGE_PATH = require.resolve(path.join(SRC_DIR, 'storage'));
const RATINGS_PATH = require.resolve(path.join(SRC_DIR, 'ratings'));

function load(seed) {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC_DIR + path.sep)) delete require.cache[key];
  }
  const mem = {};
  if (seed) for (const [k, v] of Object.entries(seed)) mem[k] = JSON.parse(JSON.stringify(v));
  const stub = {
    readJson(name, fallback = null) {
      return Object.prototype.hasOwnProperty.call(mem, name) ? JSON.parse(JSON.stringify(mem[name])) : fallback;
    },
    writeJson(name, data) { mem[name] = JSON.parse(JSON.stringify(data)); return true; },
    listJsonByPrefix() { return []; },
    deleteJson(name) { delete mem[name]; return true; },
  };
  require.cache[STORAGE_PATH] = { id: STORAGE_PATH, filename: STORAGE_PATH, loaded: true, exports: stub };
  require.cache[RATINGS_PATH] = {
    id: RATINGS_PATH, filename: RATINGS_PATH, loaded: true,
    exports: {
      profile: () => ({ level: 99, games: 999 }),
      addPoints: () => ({ ok: true }),
      addExp: () => ({ ok: true }),
    },
  };
  return {
    store: require(path.join(SRC_DIR, 'items', 'store')),
    items: require(path.join(SRC_DIR, 'items', 'index')),
    targets: require(path.join(SRC_DIR, 'items', 'targets')),
    accounts: require(path.join(SRC_DIR, 'accounts')),
    auth: require(path.join(SRC_DIR, 'auth')),
    mem,
  };
}

const ITEMS = (over) => ({ wallets: {}, inventory: {}, equipped: {}, codes: {}, ...(over || {}) });
const ACCT_ID = 'a1b2c3d4e5f60718293a4b5c';   // 24 hex（账号 id = 道具存储键）
const ACCOUNTS = {
  [ACCT_ID]: { id: ACCT_ID, username: 'zhangsan', nickname: '张三', createdAt: 1 },
};

// ---------------------------------------------------------------------------
// ① 孤儿键护栏
// ---------------------------------------------------------------------------
test('护栏：不存在的名字 / 不存在的 id → resolveItemTarget 返回 null（绝不写孤儿键）', () => {
  const { targets } = load({ 'items.json': ITEMS(), accounts: ACCOUNTS, 'accounts.json': ACCOUNTS });
  assert.strictEqual(targets.resolveItemTarget('alice'), null, '随机用户名不得解析成收件人');
  assert.strictEqual(targets.resolveItemTarget('zzzzzzzzzzzzzzzzzzzzzzzz'), null, '不存在的 24 hex 不得放行');
  assert.strictEqual(targets.resolveItemTarget(''), null);
  assert.strictEqual(targets.resolveItemTarget(null), null);
});

test('护栏：真实账号 id / 用户名 / 补建会话后都能解析', () => {
  const { targets, auth } = load({ 'items.json': ITEMS(), 'accounts.json': ACCOUNTS });
  // 账号 id（缺会话 → resolveAdminUserId 会补建会话，仍然命中）
  assert.strictEqual(targets.resolveItemTarget(ACCT_ID), ACCT_ID);
  // 按用户名发放
  assert.strictEqual(targets.resolveItemTarget('zhangsan'), ACCT_ID, '应支持按用户名定位收件人');
  assert.strictEqual(targets.resolveItemTarget(' 张三 '), null, '按昵称/带空格不应误命中（用户名精确匹配）');
  // ⚠️ 2026-10-12 产品决策：**禁止发给游客** —— 有会话也不放行（游客升级为账号时不迁 items，
  // 发给游客等于发了就丢；且游客根本没有装扮背包入口）。
  const gid = 'b0b0b0b0b0b0b0b0b0b0b0b0';
  assert.strictEqual(targets.resolveItemTarget(gid), null, '无会话的游客 id 不放行');
  auth.markAccountSession(gid, 'guest');   // 建立会话（成为真实游客）
  assert.strictEqual(targets.resolveItemTarget(gid), null, '⛔ 游客即使有会话也不放行');
  const gd = targets.resolveItemTargetDetail(gid);
  assert.strictEqual(gd.ok, false, '游客必须被拒绝');
  assert.strictEqual(gd.code, 'GUEST', '应给出「游客」这一明确原因，而不是笼统的「不存在」');
  assert.ok(/游客/.test(gd.error), '错误文案要能解释原因，管理员才知道该怎么办');
  // 「不存在」是另一种原因，别混成一句
  const nd = targets.resolveItemTargetDetail('cccccccccccccccccccccccc');
  assert.strictEqual(nd.code, 'NOT_FOUND');
});

test('⛔ 禁止发给游客：发放入口只认注册账号（回归护栏）', () => {
  const { targets, items, store, auth } = load({ 'items.json': ITEMS(), 'accounts.json': ACCOUNTS });
  const gid = 'd0d0d0d0d0d0d0d0d0d0d0d0';
  auth.markAccountSession(gid, 'guest');
  // 入口层拒绝 ⇒ 调用方根本拿不到 id，不会写进游客键
  assert.strictEqual(targets.resolveItemTarget(gid), null, '游客 id 不得作为收件人');
  // 对照组：账号走同一条入口是放行的
  assert.strictEqual(targets.resolveItemTarget(ACCT_ID), ACCT_ID);
  assert.strictEqual(items.grant(ACCT_ID, 'avatar-wolf', 'admin').ok, true);
  assert.deepStrictEqual(store.owned(ACCT_ID), ['avatar-wolf'], '账号正常拿到道具');
  assert.deepStrictEqual(store.owned(gid), [], '游客名下不得出现任何道具');
});

test('按用户名查账号：精确匹配，查不到返回 null', () => {
  const { accounts } = load({ 'items.json': ITEMS(), 'accounts.json': ACCOUNTS });
  assert.strictEqual(accounts.getAccountByName('zhangsan').id, ACCT_ID);
  assert.strictEqual(accounts.getAccountByName('ZhangSan'), null, '区分大小写');
  assert.strictEqual(accounts.getAccountByName('不存在'), null);
  assert.strictEqual(accounts.getAccountByName('   '), null);
});

test('收件人展示名回落：账号用昵称，未知回落 id 前缀', () => {
  const { targets } = load({ 'items.json': ITEMS(), 'accounts.json': ACCOUNTS });
  assert.strictEqual(targets.targetLabel(ACCT_ID), '张三');
  assert.strictEqual(targets.targetLabel('b0b0b0b0b0b0b0b0b0b0b0b0').length, 8);
});

// ---------------------------------------------------------------------------
// ② BGM 槽位归一（"发了用不了"）
// ---------------------------------------------------------------------------
test('BGM 必有 role：缺 role 的 BGM 建档时归一到 game（不丢条目）', () => {
  const { items } = load({ 'items.json': ITEMS() });
  const r = items.upsertItem({ id: 'bgm-x', type: 'bgm', name: '测试曲', asset: { kind: 'audio', value: '/music/x.mp3' } });
  assert.strictEqual(r.ok, true);
  const it = items.catalog().find((x) => x.id === 'bgm-x');
  assert.ok(it, '归一后条目应保留（而不是被丢弃）');
  assert.strictEqual(it.role, 'game', '缺 role 归一到开局曲');
  assert.strictEqual(it.equipSlot, 'bgm-game', '目录响应应带唯一真相源 equipSlot');
});

test('slotForItem 是槽位唯一真相源：缺 role 绝不产生非法槽 bgm', () => {
  const { items } = load({ 'items.json': ITEMS() });
  assert.strictEqual(items.slotForItem({ type: 'bgm' }), 'bgm-game');
  assert.strictEqual(items.slotForItem({ type: 'bgm', role: 'menu' }), 'bgm-menu');
  assert.strictEqual(items.slotForItem({ type: 'bgm', role: 'endgame' }), 'bgm-endgame');
  assert.strictEqual(items.slotForItem({ type: 'bgm' }, 'bgm-endgame'), 'bgm-endgame', '无 role 时尊重显式槽位');
  assert.strictEqual(items.slotForItem({ type: 'avatar' }), 'avatar');
  assert.strictEqual(items.slotForItem({ type: 'avatar' }, 'bgm'), 'avatar', '非 BGM 不吃 hint');
  assert.strictEqual(items.slotForItem(null), null);
});

test('装备缺 role 的 BGM：不再报 BAD_SLOT，自动落到 bgm-game', () => {
  const { items } = load({ 'items.json': ITEMS() });
  items.upsertItem({ id: 'bgm-x', type: 'bgm', name: '测试曲', asset: { kind: 'audio', value: '/music/x.mp3' } });
  const r = items.equip('u1', 'bgm', 'bgm-x');   // 前端在无 role 时会把 slot 传成 'bgm'
  assert.strictEqual(r.ok, true, `应装备成功，实际：${r.error || ''}`);
  assert.strictEqual(r.equipped['bgm-game'], 'bgm-x', '应落到开局曲槽');
});

test('装备有 role 的 BGM：落到唯一场景槽（不受调用方 slot 影响）', () => {
  const { items } = load({ 'items.json': ITEMS() });
  const r = items.equip('u1', 'bgm-game', 'bgm-loop');   // bgm-loop 的 role 是 menu
  assert.strictEqual(r.ok, true, `应装备成功，实际：${r.error || ''}`);
  assert.strictEqual(r.equipped['bgm-menu'], 'bgm-loop', '菜单曲只能落菜单槽');
});

// ---------------------------------------------------------------------------
// ③ 背包自愈 + 发放流水
// ---------------------------------------------------------------------------
test('背包自愈：装备指向失效道具（下架/未拥有/槽位对不上）→ 回落默认', () => {
  const { items } = load({
    'items.json': ITEMS({
      equipped: {
        u1: { 'bgm-menu': 'bgm-gone',           // 已下架
        avatar: 'avatar-wolf' },                 // 未拥有
      },
    }),
    'accounts.json': ACCOUNTS,
  });
  const eq = items.effectiveEquipped('u1');
  assert.strictEqual(eq['bgm-menu'], 'bgm-loop', '下架项应回落默认菜单曲');
  assert.strictEqual(eq.avatar, undefined, '未拥有的付费头像应视为"没装"');
});

test('发放流水：grant / addCoin / buy 都落 append-only 流水', () => {
  const { items, mem } = load({ 'items.json': ITEMS(), 'accounts.json': ACCOUNTS });
  assert.strictEqual(items.grant(ACCT_ID, 'avatar-wolf', 'admin').ok, true);
  assert.strictEqual(items.addCoin(ACCT_ID, 1000).ok, true);
  assert.strictEqual(items.buy(ACCT_ID, 'avatar-unicorn').ok, true);   // 600 币够买
  const logs = items.recentLogs(10);
  const kinds = logs.map((l) => l.kind);
  assert.ok(kinds.includes('item'), '发放道具应有流水');
  assert.ok(kinds.includes('coin'), '加币应有流水');
  assert.ok(kinds.includes('buy'), '购买应有流水');
  const grantLog = logs.find((l) => l.kind === 'item');
  assert.strictEqual(grantLog.accountId, ACCT_ID);
  assert.strictEqual(grantLog.itemId, 'avatar-wolf');
  assert.ok(mem['items.json'].logs, '流水应随 items.json 落盘');
  // 时间倒序
  for (let i = 1; i < logs.length; i++) assert.ok(logs[i - 1].at >= logs[i].at, '流水应按时间倒序');
});

test('目录响应每条都带 equipSlot（前端不再自算）', () => {
  const { items } = load({ 'items.json': ITEMS() });
  for (const it of items.catalog()) {
    assert.ok(it.equipSlot, `${it.id} 缺 equipSlot`);
    assert.ok(items.SLOTS.includes(it.equipSlot), `${it.id} 的 equipSlot 不是合法槽位`);
  }
});
