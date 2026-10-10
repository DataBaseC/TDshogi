'use strict';
/**
 * tests/accounts-migration.test.js — 游客升级账号的数据迁移（Bug3 回归）
 *
 * 覆盖 2026-09-27 外包修复：
 *  - **幽灵游客会话**：迁移是「移动」不是「复制」——旧 `sessions/<guestId>.json`
 *    必须删除，否则同一人在 `listSessions()` / 管理端用户列表里出现两条；
 *  - 数据（棋谱 / 评级）确实归属到账号 id、旧游客 id 下不再有；
 *  - 防重复迁移守卫不被破坏：拿「已是注册账号的 id」当 guestId 注册，不得迁移、
 *    更不得删除该账号的会话。
 *
 * ⚠️ 必须在 require storage 之前设定 DATA_DIR（storage 首次 getDb() 即定死路径）；
 *    node --test 每个文件独立进程，不会污染其它测试文件。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const TMP = path.join(require('node:os').tmpdir(), `.tmpdata-accmig-${process.pid}`);
process.env.DATA_DIR = TMP;
fs.mkdirSync(TMP, { recursive: true });
process.env.SESSION_SECRET = 'unit-test-session-secret';

const storage = require('../src/storage');
const auth = require('../src/auth');
const ratings = require('../src/ratings');
const accounts = require('../src/accounts');

test.after(() => {
  try { storage._getDb().close(); } catch (_) { /* 忽略 */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
});

const uname = (p) => `${p}${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 90 + 10)}`;

test('Bug3 幽灵会话：游客升级账号后，旧游客会话被删除、同一人只剩一条', () => {
  const guestId = auth.genId();
  auth.identify(guestId);          // 建立游客会话
  auth.rename(guestId, '旧游客名');
  const otherId = auth.genId();

  // 造一局棋谱（先手=游客）+ 一条评级
  storage.putRecord({
    id: `rec-bug3-${guestId}`,
    createdAt: Date.now(),
    names: ['旧游客名', '对手'],
    result: 'b',
    resultDetail: '投了',
    playerIds: { b: guestId, w: otherId },
    winnerId: guestId,
    moves: ['7g7f'],
    pub: true,
  });
  ratings.applyGameResult(guestId, otherId, 'b');

  const reg = accounts.register(uname('迁移'), 'pw123456', guestId);
  assert.strictEqual(reg.ok, true, '注册应成功');
  const accountId = reg.account.id;

  // 1) 旧游客会话已删除；账号会话存在
  assert.strictEqual(auth.getSessionRaw(guestId), null, '旧游客会话必须被删除（幽灵会话根因）');
  assert.ok(auth.getSessionRaw(accountId), '账号会话应存在');

  // 2) listSessions 里同一人只有账号这一条
  const ids = auth.listSessions().map((s) => s.id);
  assert.ok(!ids.includes(guestId), 'listSessions 不应再含旧游客 id');
  assert.ok(ids.includes(accountId), 'listSessions 应含账号 id');

  // 3) 数据迁移到账号、旧游客名下清空
  assert.strictEqual(ratings.profile(accountId).games, 1, '评级（局数）应迁移到账号');
  assert.strictEqual(ratings.profile(guestId).games, 0, '旧游客评级应已清空');
  assert.strictEqual(storage.listSummaries({ playerId: accountId }).length, 1, '棋谱应归属账号');
  assert.strictEqual(storage.listSummaries({ playerId: guestId }).length, 0, '旧游客名下不应再有棋谱');
});

test('Bug3 防重复迁移守卫：拿已有账号 id 当 guestId 注册不迁移、不误删其会话', () => {
  const a = accounts.register(uname('已有'), 'pw123456');
  assert.strictEqual(a.ok, true);
  const victim = a.account.id;
  assert.ok(auth.getSessionRaw(victim), '前置：账号会话存在');

  const b = accounts.register(uname('新号'), 'pw123456', victim);
  assert.strictEqual(b.ok, true);
  assert.notStrictEqual(b.account.id, victim, '应创建新账号');
  assert.ok(auth.getSessionRaw(victim), '他人账号会话不得被删除（守卫不能破）');
});

test('removeSession：幂等；缺参返回失败', () => {
  assert.strictEqual(auth.removeSession(null).ok, false, '缺参应失败');
  const id = auth.genId();
  auth.identify(id);
  assert.ok(auth.getSessionRaw(id), '前置：会话存在');
  assert.strictEqual(auth.removeSession(id).ok, true);
  assert.strictEqual(auth.getSessionRaw(id), null, '删除后应查不到');
  assert.strictEqual(auth.removeSession(id).ok, true, '重复删除也算成功');
});

// ---- 回归：upsertSession 不得整份覆盖会话（封禁/头像/持有证明/迁移数据）----

test('BUG1 封禁不得被登录抹掉（改密码登录 ≠ 解封）', () => {
  const r = accounts.register(uname('banuser'), 'pw123456');
  assert.strictEqual(r.ok, true);
  const id = r.account.id;
  auth.banPlayer(id, { reason: 'cheating', days: 7 });
  assert.ok(auth.getSessionRaw(id).banned, '前置：已封禁');

  const lg = accounts.login(r.account.username, 'pw123456');
  assert.strictEqual(lg.ok, true);
  const after = auth.getSessionRaw(id);
  assert.ok(after.banned, '登录后封禁字段必须保留');
  assert.strictEqual(after.banned.reason, 'cheating');
});

test('BUG2 登录不得抹掉头像；账号会话不应残留持有证明（B1 只管游客）', () => {
  const r = accounts.register(uname('avuser'), 'pw123456');
  const id = r.account.id;
  auth.setAvatar(id, '🐯');
  const key = auth.genKey();
  // 误把 secret 绑到账号会话（模拟旧数据/迁移残留）
  const s0 = auth.getSessionRaw(id);
  s0.secret = key;
  auth.saveSession(s0);
  assert.strictEqual(auth.getSessionRaw(id).secret, key);

  accounts.login(r.account.username, 'pw123456');
  const after = auth.getSessionRaw(id);
  assert.strictEqual(after.avatar, '🐯', '头像保留');
  assert.ok(!after.secret, '登录后账号会话不得再绑定持有证明（身份凭据是令牌）');
  assert.strictEqual(after.isAccount, true);
  // 无 key 也应能改名（账号放行）
  const rn = auth.rename(id, '新名字', null);
  assert.strictEqual(rn.ok, true, '账号改名不需要持有证明');
});

test('BUG3 游客升级后：头像/原 createdAt 保留；持有证明不迁入账号会话', () => {
  const guestId = auth.genId();
  auth.identify(guestId);
  auth.setAvatar(guestId, '🦊');
  const key = auth.genKey();
  auth.identify(guestId, { key });
  const gCreatedAt = auth.getSessionRaw(guestId).createdAt;

  const r = accounts.register(uname('upguser'), 'pw123456', guestId, key);
  assert.strictEqual(r.ok, true);
  const s = auth.getSessionRaw(r.account.id);
  assert.ok(s, '账号会话存在');
  assert.strictEqual(s.avatar, '🦊', '迁移后头像保留');
  assert.strictEqual(s.createdAt, gCreatedAt, '迁移后 createdAt 保留游客侧');
  assert.strictEqual(s.name, r.account.username, '显示名切到用户名');
  assert.ok(!s.secret, '持有证明不得迁入账号会话（否则改名/换头像报 AUTH_KEY）');
  assert.strictEqual(s.isAccount, true);
  assert.strictEqual(auth.getSessionRaw(guestId), null, '旧游客会话已删');
  // 注册后立刻换头像 / 改名都不应报身份校验失败
  const av = auth.setAvatar(r.account.id, '🐼', null);
  assert.strictEqual(av.ok, true, '注册后换头像不应被 AUTH_KEY 拦');
  const rn = auth.rename(r.account.id, '升级后的名字', null);
  assert.strictEqual(rn.ok, true, '注册后改名不应被 AUTH_KEY 拦');
});

test('BUG4 updateProfile 两项都未传时不得抛异常', () => {
  const r = accounts.register(uname('profuser'), 'pw123456');
  const up = accounts.updateProfile(r.account.id, {});
  assert.strictEqual(up.ok, true);
  assert.deepStrictEqual(up.profile, { phone: '', style: '不设定' });
});

test('BUG5 verifyPassword：坏哈希不抛异常，返回 false', () => {
  // 非 hex 但长度正确（P0-1 同源）：Buffer.from 会变短 → timingSafeEqual 抛 RangeError
  const bad = 'z'.repeat(64);
  assert.strictEqual(accounts.verifyPassword('pw123456', 'salt', bad), false);
  assert.strictEqual(accounts.verifyPassword('pw123456', 'salt', ''), false);
  assert.strictEqual(accounts.verifyPassword('pw123456', 'salt', null), false);
});
