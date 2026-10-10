/**
 * e2e-tournament-admin.js — 赛事管理台端到端测试（PLAN §E）
 *
 * 覆盖：游客创建被拒 / 账号创建进入待审核 / 公共列表隐藏 pending /
 *       非管理员 403 / approve→registration 可报名 / reject 不可报名 /
 *       playing 态 cancel 解散对局（room_closed）/ 幂等 / 公共列表隐藏 cancelled
 *
 * ⚠️ 起服务必须带 `ADMIN_PASSWORD=admin123`（脚本用这个口令登录管理员）：
 *     $env:PORT='3999'; $env:DATA_DIR='<独立目录>'; $env:ADMIN_PASSWORD='admin123'; node server.js
 *
 * ⚠️ 三处**产品行为变更**，别当成 bug：
 *    1. 「报名中」的状态名是 `registration`（旧 `open` 由 normalizeStatus 映射）；
 *    2. **主办人不自动参赛**（2026-09-13 用户要求）——创建者也得自己报名；
 *    3. 建赛默认 `requireApproval: true`，报名进 pending 不占名额；
 *       需要"报名即参赛"的用例要显式传 `requireApproval: false`。
 */
'use strict';
const WebSocket = require('ws');
const crypto = require('crypto');

const HOST = 'ws://localhost:3999/ws';
const BASE = 'http://localhost:3999';
const T = (ms) => new Promise((r) => setTimeout(r, ms));
const gid = () => crypto.randomBytes(12).toString('hex');

class Client {
  constructor(name, identity) {
    this.name = name;
    this.identity = identity || gid(); // WS 连接身份（令牌或游客 id）
    this.ws = null;
    this.queue = [];
    this.listeners = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${HOST}?guest=${this.identity}`);
      this.ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
        this.queue.push(msg);
        this.listeners = this.listeners.filter((l) => {
          if (l.type === msg.type) { l.fn(msg.data); return !l.once; }
          return true;
        });
      });
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });
  }
  send(type, data = {}) { this.ws.send(JSON.stringify({ type, data })); }
  wait(type, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      for (let i = this.queue.length - 1; i >= 0; i--) {
        if (this.queue[i].type === type) return resolve(this.queue[i].data);
      }
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn));
        reject(new Error(`${this.name} 等待 ${type} 超时`));
      }, timeoutMs);
      const fn = (data) => { clearTimeout(timer); resolve(data); };
      this.listeners.push({ type, fn, once: true });
    });
  }
  close() { if (this.ws) { try { this.ws.close(); } catch (_) {} } }
}

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(label); console.log(`  ✗ ${label}`); }
}
async function section(name) { console.log(`\n=== ${name} ===`); }

async function registerAccount(prefix) {
  // 用户名上限 16 字符：前缀 + 时间36进制6位 + 2位随机 ≈ 10 字符
  const username = `${prefix}${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const r = await (await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'test1234' }),
  })).json();
  if (!r.ok) throw new Error('注册失败: ' + (r.error || ''));
  return r; // { token, account }
}

async function publicList() {
  return (await (await fetch(`${BASE}/api/tournaments`)).json()).tournaments || [];
}

async function adminAction(token, id, action, body) {
  return fetch(`${BASE}/api/admin/tournaments/${id}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
    body: JSON.stringify(body || {}),
  });
}

/**
 * 创建赛事并只认"发送之后"到达的 tournament_created。
 * Client.wait 会先扫历史队列——同一连接多次创建时会拿到上一场的老消息
 * （表现为 reject 报「状态已变更」），所以这里先注册监听再发送。
 */
function createTournament(client, name, size, extra) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('tournament_created 超时')), 5000);
    client.listeners.push({
      type: 'tournament_created', once: true,
      fn: (d) => { clearTimeout(timer); resolve(d); },
    });
    // 建赛申请表字段（T2）：reason 是**举办理由**；requireApproval 默认 true
    client.send('create_tournament', Object.assign({
      name, size, reason: 'e2e 管理台测试赛事，用于验证审核与取消链路',
    }, extra || {}));
  });
}

async function main() {
  console.log('=== 赛事管理台验证 ===');

  // 管理员登录
  const adminC = new Client('Admin');
  await adminC.connect();
  adminC.send('admin_login', { password: 'admin123' });
  const adminTok = (await adminC.wait('admin_logged_in')).token;

  // 创建者账号
  const creator = await registerAccount('tnc');
  const creatorClient = new Client('Creator', creator.token);
  await creatorClient.connect();

  // 等级特权（2026-09-20 用户要求）：举办赛事需要 Lv.5，而刚注册的账号是 Lv.0。
  // 这里先用管理接口把经验提上去——顺带把「管理员改等级」这条链路也走了一遍。
  // 等级由经验推导：Lv.5 ⟺ 累计经验 ≥ 2^(5+2) - 2 = 126。
  const grant = await (await fetch(`${BASE}/api/admin/users/${creator.account.id}/elo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminTok },
    body: JSON.stringify({ exp: 128 }),
  })).json();
  if (!grant.ok) throw new Error('提升等级失败: ' + (grant.error || ''));

  // ---- 1. 游客创建被拒 ----
  await section('游客创建被拒（B2 服务端校验）');
  const guest = new Client('Guest');
  await guest.connect();
  guest.send('create_tournament', { name: '游客赛', size: 4 });
  const err = await guest.wait('error');
  ok(/正式账号/.test(err.message || ''), `游客创建被拒（${err.message}）`);

  // ---- 2. 账号创建 → pending_approval ----
  await section('账号创建 → 待审核 → 公共列表隐藏');
  const tA = await createTournament(creatorClient, '管理台测试赛A', 4);
  ok(tA.status === 'pending_approval', `新赛事状态=pending_approval（实际 ${tA.status}）`);
  ok(!(await publicList()).some((t) => t.id === tA.id), '公共列表不展示待审核赛事');

  // ---- 3. 非管理员 403 ----
  const forbidden = await adminAction('bogus-token', tA.id, 'approve');
  ok(forbidden.status === 403, '非管理员 token 调用审核接口 → 403');

  // ---- 4. approve → open → 公共可见 → 可报名 ----
  await section('审核通过 → 报名');
  const ap = await (await adminAction(adminTok, tA.id, 'approve')).json();
  // ⚠️ 状态名是 `registration`：T1 起「报名中」不再叫 `open`（旧数据由 normalizeStatus 映射）
  ok(ap.ok === true && ap.tournament.status === 'registration', 'approve → registration');
  ok((await publicList()).some((t) => t.id === tA.id), '公共列表展示已审核赛事');
  guest.send('join_tournament', { id: tA.id });
  const joined = await guest.wait('tournament_joined');
  ok(joined && joined.id === tA.id, '审核后可正常报名');

  // ---- 5. reject 流程 ----
  await section('拒绝流程');
  const tB = await createTournament(creatorClient, '管理台测试赛B', 4);
  ok(tB.status === 'pending_approval', '测试赛B 进入待审核');
  const rj = await (await adminAction(adminTok, tB.id, 'reject', { reason: '资料不全' })).json();
  ok(rj.ok === true && rj.tournament.status === 'rejected', 'reject → rejected');
  // ⚠️ `reason` 在 T1 改了语义：它现在是**举办理由**，拒绝原因存 `rejectReason`
  // （出口按状态自动归位，旧数据里的 reason 也会被搬到 rejectReason）
  ok(rj.tournament.rejectReason === '资料不全', '拒绝原因已记录到 rejectReason');
  ok(!(await publicList()).some((t) => t.id === tB.id), '公共列表不展示被拒赛事');
  // 全新客户端（队列干净，避免捞到第 1 步的旧 error 消息）
  const guest2 = new Client('Guest2');
  await guest2.connect();
  guest2.send('join_tournament', { id: tB.id });
  const joinErr = await guest2.wait('error');
  ok(/已开赛或结束/.test(joinErr.message || ''), `被拒赛事不可报名（${joinErr.message}）`);

  // ---- 6. playing 态取消 → 解散对局 ----
  await section('比赛中取消 → 解散对局房间');
  // `requireApproval: false` → 报名即参赛（本用例要的是"满员开赛"，不测审批流）
  const tC = await createTournament(creatorClient, '管理台测试赛C', 4, { requireApproval: false });
  await adminAction(adminTok, tC.id, 'approve');
  // ⚠️ 主办人不自动参赛：创建者也要自己报名，否则永远差一人、永远不开赛
  creatorClient.send('join_tournament', { id: tC.id });
  await creatorClient.wait('tournament_joined');
  const guests = [];
  for (let i = 0; i < 3; i++) {
    const g = new Client('G' + i);
    await g.connect();
    g.send('join_tournament', { id: tC.id });
    await g.wait('tournament_joined');
    guests.push(g);
  }
  await T(600); // 满员自动开赛，等 bracket 生成
  let listC = await publicList();
  const tCpub = listC.find((t) => t.id === tC.id);
  ok(tCpub && tCpub.status === 'playing', '满员自动开赛 → playing');
  const matchNode = (tCpub.bracket || []).find((n) => n.matchId);
  ok(!!matchNode, '首轮对局已创建');
  // 创建者进入自己的对局房间（成为房间成员，才能收到 room_closed）
  const myMatch = (tCpub.bracket || []).find((n) => n.matchId && (n.players || []).includes(creator.account.id));
  if (myMatch) {
    creatorClient.send('join_tournament_match', { roomId: myMatch.matchId });
    await creatorClient.wait('state');
  }
  const cancelRes = await adminAction(adminTok, tC.id, 'cancel', { reason: '测试取消' });
  const cancelData = await cancelRes.json();
  ok(cancelRes.status === 200 && cancelData.ok === true && cancelData.tournament.status === 'cancelled',
    'cancel → cancelled');
  ok((cancelData.dissolvedMatches || 0) >= 1, `解散对局房间（${cancelData.dissolvedMatches} 场）`);
  let closed = null;
  try { closed = await creatorClient.wait('room_closed', 4000); } catch (_) {}
  ok(!!closed && closed.reason === 'tournament_cancelled', '房内玩家收到 room_closed 通知');
  ok(!(await publicList()).some((t) => t.id === tC.id), '公共列表不展示已取消赛事');

  // ---- 7. 幂等 ----
  await section('幂等校验');
  const again = await adminAction(adminTok, tC.id, 'cancel', { reason: '重复取消' });
  const againData = await again.json();
  ok(again.status === 400 && /状态已变更/.test(againData.error || ''), '重复取消返回「状态已变更」');

  [adminC, creatorClient, guest, ...guests].forEach((c) => c.close());
  console.log(`\n========== 赛事管理台验证：${pass} 通过, ${fail} 失败 ==========`);
  if (failures.length) {
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
  process.exit(0);
}
main().catch((e) => { console.error('赛事管理台测试异常:', e); process.exit(1); });
