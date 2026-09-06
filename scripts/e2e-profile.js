/**
 * e2e-profile.js — 个人资料/玩家信息卡端到端测试（PLAN §F）
 *
 * 覆盖：登录后读/写资料（手机号私密 + 棋风公开 + 注册日期）、
 *       公开 player-card 绝不含手机号、无效令牌 401、手机号格式校验、
 *       state 广播带玩家 id（对局页悬停卡数据源）。
 *
 * 用法：服务器运行于 :3999 且 DATA_DIR 独立，直接 node scripts/e2e-profile.js
 */
'use strict';
const WebSocket = require('ws');
const crypto = require('crypto');

const BASE = 'http://localhost:3999';
const WS = 'ws://localhost:3999/ws';
const T = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(label); console.log(`  ✗ ${label}`); }
}
async function section(name) { console.log(`\n=== ${name} ===`); }

async function registerAccount(prefix) {
  const username = `${prefix}${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const r = await (await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'test1234' }),
  })).json();
  if (!r.ok) throw new Error('注册失败: ' + (r.error || ''));
  return r;
}

async function main() {
  console.log('=== 个人资料/玩家信息卡验证 ===');

  // ---- 1. 注册 + 读本人资料 ----
  await section('本人资料读取（含私密手机号字段）');
  const reg = await registerAccount('prf');
  const token = reg.token;
  const accountId = reg.account.id;
  ok(!!token && !!accountId, '注册成功拿到令牌与账号 id');

  const own = await (await fetch(`${BASE}/api/account/profile?token=${encodeURIComponent(token)}`)).json();
  ok(own.ok === true && own.account.profile.phone === '' && own.account.profile.style === '不设定',
    '新账号默认资料：手机号空 / 棋风「不设定」');
  ok(typeof own.account.createdAt === 'number', '注册日期（createdAt）可读');

  // ---- 2. 写资料：合法手机号 + 棋风 ----
  await section('资料写入与校验');
  const bad = await (await fetch(`${BASE}/api/account/profile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, phone: '12345', style: '振飞车' }),
  })).json();
  ok(bad.ok === false && /手机号/.test(bad.error || ''), `非法手机号被拒（${bad.error}）`);
  const badStyle = await (await fetch(`${BASE}/api/account/profile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, style: '宇宙流' }),
  })).json();
  ok(badStyle.ok === false && /棋风/.test(badStyle.error || ''), `枚举外棋风被拒（${badStyle.error}）`);

  const save = await (await fetch(`${BASE}/api/account/profile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, phone: '13812345678', style: '振飞车' }),
  })).json();
  ok(save.ok === true && save.profile.phone === '13812345678' && save.profile.style === '振飞车',
    '保存手机号 + 棋风成功');

  const own2 = await (await fetch(`${BASE}/api/account/profile?token=${encodeURIComponent(token)}`)).json();
  ok(own2.account.profile.phone === '13812345678', '再次读取本人资料含手机号（私密字段本人可见）');

  // ---- 3. 无效令牌 401 ----
  const unauth = await fetch(`${BASE}/api/account/profile?token=bogus.token.here`);
  ok(unauth.status === 401, '无效令牌访问本人资料 → 401');

  // ---- 4. 公开玩家卡：不含手机号 ----
  await section('公开玩家卡（悬停小窗数据源）');
  const card = await (await fetch(`${BASE}/api/player-card?id=${accountId}`)).json();
  ok(card && card.name && card.isAccount === true, `玩家卡返回基本信息（${card.name}）`);
  ok(card.style === '振飞车', `玩家卡含公开棋风（${card.style}）`);
  ok(typeof card.createdAt === 'number', '玩家卡含注册日期（账号）');
  ok(!('phone' in card) && JSON.stringify(card).indexOf('13812345678') === -1,
    '玩家卡绝不包含手机号');
  ok(Array.isArray(card.recent) && card.rating === 1500 && card.games === 0,
    '玩家卡含 ELO/局数/近局列表');

  // 未知玩家 → 404
  const missing = await fetch(`${BASE}/api/player-card?id=${crypto.randomBytes(12).toString('hex')}`);
  ok(missing.status === 404, '未知玩家 → 404');

  // 游客卡（有会话无账号）：无手机号、无棋风
  const guestId = crypto.randomBytes(12).toString('hex');
  const gc = new WebSocket(`${WS}?guest=${guestId}`);
  await new Promise((r, j) => { gc.on('open', r); gc.on('error', j); });
  await T(200);
  const gcard = await (await fetch(`${BASE}/api/player-card?id=${guestId}`)).json();
  ok(gcard && gcard.isAccount === false && gcard.style === null && !('phone' in gcard),
    '游客玩家卡：无棋风/无手机号');

  // ---- 5. state 广播带玩家 id（对局页悬停卡数据源） ----
  await section('对局 state 携带玩家 id');
  // 复用带超时的 Client 模式（裸轮询无超时会挂死整个套件）
  class C {
    constructor() { this.guestId = crypto.randomBytes(12).toString('hex'); this.q = []; this.listeners = []; }
    connect() {
      return new Promise((resolve, reject) => {
        this.ws = new WebSocket(`${WS}?guest=${this.guestId}`);
        this.ws.on('message', (raw) => {
          const m = JSON.parse(raw.toString());
          this.q.push(m);
          this.listeners = this.listeners.filter((l) => { if (l.type === m.type) { l.fn(m.data); return !l.once; } return true; });
        });
        this.ws.on('open', resolve); this.ws.on('error', reject);
      });
    }
    send(type, data = {}) { this.ws.send(JSON.stringify({ type, data })); }
    wait(type, timeout = 6000) {
      return new Promise((resolve, reject) => {
        for (let i = this.q.length - 1; i >= 0; i--) if (this.q[i].type === type) return resolve(this.q[i].data);
        const timer = setTimeout(() => reject(new Error(`等 ${type} 超时`)), timeout);
        const fn = (d) => { clearTimeout(timer); resolve(d); };
        this.listeners.push({ type, fn, once: true });
      });
    }
  }
  const A = new C(); const B = new C();
  await A.connect(); await B.connect();
  A.send('create_room', { timeControl: '10:00' });
  const created2 = await A.wait('room_created');
  B.send('join_room', { code: created2.code });
  await B.wait('game_start');
  const st = await A.wait('state');
  ok(st.players && st.players.b && st.players.b.id && st.players.w && st.players.w.id,
    'state.players 含 id（供前端 data-player-id）');

  // ---- 6. 管理员可见手机号 ----
  await section('管理员可见手机号');
  const adminWs = new WebSocket(`${WS}?guest=${crypto.randomBytes(12).toString('hex')}`);
  adminWs.q = [];
  adminWs.on('message', (raw) => { adminWs.q.push(JSON.parse(raw.toString())); });
  await new Promise((r) => adminWs.on('open', r));
  adminWs.send(JSON.stringify({ type: 'admin_login', data: { password: 'admin123' } }));
  const adminTok = await new Promise((r) => { const iv = setInterval(() => { const m = adminWs.q.find((x) => x.type === 'admin_logged_in'); if (m) { clearInterval(iv); r(m.data.token); } }, 40); });
  const detail = await (await fetch(`${BASE}/api/admin/users/${accountId}?token=${encodeURIComponent(adminTok)}`)).json();
  ok(detail.phone === '13812345678', `管理员用户详情返回手机号（${detail.phone}）`);

  [gc, A.ws, B.ws, adminWs].forEach((w) => { try { w.close(); } catch (_) {} });
  console.log(`\n========== 个人资料验证：${pass} 通过, ${fail} 失败 ==========`);
  if (failures.length) {
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
  process.exit(0);
}
main().catch((e) => { console.error('个人资料测试异常:', e); process.exit(1); });
