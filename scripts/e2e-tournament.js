/**
 * e2e-tournament.js — 赛事端到端测试（4 人单败淘汰全流程）
 *
 * 流程：创建赛事 → 管理员审核 → 4 人报名（**默认需主办人批准**）→ 逐个批准 →
 *       满员自动开赛 → 首轮 2 场对局自动创建 → 各自认输 → 胜者晋级 → 决赛 → 冠军产生。
 *
 * ⚠️ 起服务必须带 `ADMIN_PASSWORD=admin123`（脚本用这个口令登录管理员）；
 *    不设则落到内置默认口令，`admin_login` 会一直等不到 `admin_logged_in`：
 *        $env:PORT='3999'; $env:DATA_DIR='<独立目录>'; $env:ADMIN_PASSWORD='admin123'; node server.js
 *
 * ⚠️ 下面两条是**产品行为变更**后的写法，改动时别看错成 bug：
 *    1. 「报名中」的状态名是 `registration`（旧数据里的 `open` 由 normalizeStatus 映射），
 *       所以创建/审核后拿到的 `status` 不再是 `open`；
 *    2. **主办人不自动参赛**（2026-09-13 用户要求）——创建者也要自己报名，
 *       否则人数永远差一个、永远不开赛；
 *    3. 建赛默认 `requireApproval: true`，报名先进 pending，**必须显式批准**才计入名额。
 */
'use strict';
const WebSocket = require('ws');
const crypto = require('crypto');

const HOST = 'ws://localhost:3999/ws';
const T = (ms) => new Promise((r) => setTimeout(r, ms));
const gid = () => crypto.randomBytes(12).toString('hex');

class Client {
  constructor(name) {
    this.name = name;
    this.guestId = gid();
    this.ws = null;
    this.queue = [];
    this.latestState = null;
    this.listeners = [];
  }
  connect(identity) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${HOST}?guest=${identity || this.guestId}`);
      this.ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
        this.queue.push(msg);
        if (msg.type === 'state') this.latestState = msg.data;
        this.listeners = this.listeners.filter((l) => {
          if (l.type === msg.type) { l.fn(msg.data, msg); return !l.once; }
          return true;
        });
      });
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });
  }
  send(type, data = {}) { this.ws.send(JSON.stringify({ type, data })); }
  wait(type, timeoutMs = 4000) {
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

async function main() {
  // ============ 准备：创建者注册正式账号（B2 要求）+ 管理员登录 ============
  // 用户名上限 16 字符：前缀 + 时间36进制6位 + 2位随机 ≈ 10 字符
  const suffix = `${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const reg = await (await fetch('http://localhost:3999/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `tno${suffix}`, password: 'test1234' }),
  })).json();
  if (!reg.ok) throw new Error('注册失败: ' + (reg.error || ''));

  const adminClient = new Client('Admin');
  await adminClient.connect();
  adminClient.send('admin_login', { password: 'admin123' });
  const adminTok = (await adminClient.wait('admin_logged_in')).token;

  // 等级特权（2026-09-20 用户要求）：举办赛事需要 Lv.5，而刚注册的账号是 Lv.0。
  // 这里先用管理接口把经验提上去——顺带把「管理员改等级」这条链路也走了一遍。
  // 等级由经验推导：Lv.5 ⟺ 累计经验 ≥ 2^(5+2) - 2 = 126。
  const grant = await (await fetch(`http://localhost:3999/api/admin/users/${reg.account.id}/elo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminTok },
    body: JSON.stringify({ exp: 128 }),
  })).json();
  if (!grant.ok) throw new Error('提升等级失败: ' + (grant.error || ''));

  // ============ 报名阶段 ============
  await section('4 人报名 → 满员自动开赛');
  const players = [];
  // P1 为正式账号（创建者）：以令牌连接，guestId 用 accountId（对局名单按 accountId 匹配）
  const p1 = new Client('P1');
  p1.guestId = reg.account.id;
  await p1.connect(reg.token);
  players.push(p1);
  for (let i = 1; i < 4; i++) {
    const p = new Client(`P${i + 1}`);
    await p.connect();
    await T(120);
    players.push(p);
  }
  ok(grant.level >= 5, `管理员可提升等级（当前 Lv.${grant.level}），满足建赛门槛`);

  players[0].send('create_tournament', {
    name: '测试赛', size: 4, reason: 'e2e 端到端测试用赛事，走完整报名与淘汰流程',
  });
  const created = await players[0].wait('tournament_created');
  ok(!!created.id, '账号创建赛事成功');
  ok(created.status === 'pending_approval', '新赛事进入待审核状态（B3）');
  ok(created.requireApproval === true, '默认「报名需主办人批准」');

  // 管理员审核通过 → registration（**不是旧名 `open`**，T1 起出口已归一）
  const ap = await (await fetch(`http://localhost:3999/api/admin/tournaments/${created.id}/approve`, {
    method: 'POST',
    headers: { 'x-admin-token': adminTok },
  })).json();
  ok(ap.ok === true && ap.tournament && ap.tournament.status === 'registration', '管理员审核通过 → 报名中');

  const tid = created.id;

  // ⚠️ 4 人全部报名（含创建者）：主办人**不自动参赛**，否则永远差一人、永远不开赛
  for (let i = 0; i < 4; i++) {
    players[i].send('join_tournament', { id: tid });
    const joined = await players[i].wait('tournament_joined');
    if (i === 0) ok(joined.pending === true, '需审核时报名先进 pending（不占名额）');
  }
  await T(300);
  let t = (await (await fetch('http://localhost:3999/api/tournaments')).json())
    .tournaments.find((x) => x.id === tid);
  ok(t && t.status === 'registration', '全是 pending，赛事尚未开赛');
  ok((t.entrants || []).filter((e) => e.status === 'approved').length === 0, 'pending 不计入已批准人数');

  // 主办人逐个批准（走 T3 新增的 REST 接口，身份用账号 token）
  for (const e of t.entrants) {
    const r = await (await fetch(
      `http://localhost:3999/api/tournaments/${tid}/entrants/${encodeURIComponent(e.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-account-token': reg.token },
        body: JSON.stringify({ decision: 'approve' }),
      })).json();
    if (!r.ok) ok(false, `批准 ${e.name || e.id} 失败：${r.error}`);
  }
  await T(500);
  // 批准到满员应自动开赛并创建首轮对局
  const data = await (await fetch('http://localhost:3999/api/tournaments')).json();
  t = data.tournaments.find((x) => x.id === tid);
  ok(t && t.status === 'playing', '满员后赛事进入 playing 状态');
  ok((t.players || []).length === 4, `名单冻结为 4 人（实际 ${(t.players || []).length}）`);
  const firstRound = (t.bracket || []).filter((n) => n.pair && n.matchId);
  ok(firstRound.length === 2, `首轮创建 2 场对局（实际 ${firstRound.length}）`);

  // ============ 首轮对局：P1 vs 胜者流 ============
  await section('首轮对局进行');
  // 每场对局：双方进入 → 先手走 3 手 → 后手认输（判先手胜）
  const matches = firstRound.map((n) => ({ node: n, roomId: n.matchId }));
  for (const m of matches) {
    const roomId = m.roomId;
    // 找到该对局的两位参赛者
    const roomPlayers = (await (await fetch('http://localhost:3999/api/tournaments')).json())
      .tournaments.find((x) => x.id === tid).bracket.find((n) => n.matchId === roomId).players;
    // 客户端进入对局（join_tournament_match）
    const clients = players.filter((p) => roomPlayers.includes(p.guestId));
    ok(clients.length === 2, `对局 ${roomId.slice(0, 6)} 找到双方参赛客户端`);
    if (clients.length !== 2) continue;
    // 由在线的已绑定；未绑定的需要 join（这里连接后可能已被 createTournamentMatch 绑定）
    for (const c of clients) {
      c.send('join_tournament_match', { roomId });
      await c.wait('state');
    }
    await T(400);
    // 先手走一着（若轮到先手）
    const st = clients[0].latestState;
    const mover = st.turn === 'b' ? clients[0] : clients[1];
    const moverSt = mover.latestState;
    if (moverSt && moverSt.legalMoves && moverSt.legalMoves.length) {
      mover.send('move', { usi: moverSt.legalMoves[0] });
      await T(300);
    }
    // 后手认输（认输者判负，与手番无关）
    const resigner = mover === clients[0] ? clients[1] : clients[0];
    resigner.send('resign');
    await clients[0].wait('game_over');
    ok(true, `对局 ${roomId.slice(0, 6)} 结束（一方认输）`);
  }
  await T(500);

  // ============ 推进检查 ============
  await section('胜者晋级 / 决赛');
  let t2 = (await (await fetch('http://localhost:3999/api/tournaments')).json())
    .tournaments.find((x) => x.id === tid);
  const round2 = (t2.bracket || []).filter((n) => n.pair && n.matchId);
  const winnerCount = (t2.bracket || []).filter((n) => n.winnerId).length;
  ok(winnerCount === 2, `首轮产生 2 名胜者（实际 ${winnerCount}）`);
  ok(round2.length === 1, `决赛对局已创建（实际 ${round2.length}）`);

  // ============ 决赛 ============
  await section('决赛 → 冠军');
  const finalMatch = round2[0];
  const finalPlayers = t2.bracket.find((n) => n.matchId === finalMatch.matchId).players;
  const finalClients = players.filter((p) => finalPlayers.includes(p.guestId));
  ok(finalClients.length === 2, '决赛双方参赛客户端就绪');
  for (const c of finalClients) {
    c.send('join_tournament_match', { roomId: finalMatch.matchId });
    await c.wait('state');
  }
  await T(300);
  const fst = finalClients[0].latestState;
  const fmover = fst.turn === 'b' ? finalClients[0] : finalClients[1];
  const fmoverSt = fmover.latestState;
  if (fmoverSt && fmoverSt.legalMoves && fmoverSt.legalMoves.length) {
    fmover.send('move', { usi: fmoverSt.legalMoves[0] });
    await T(300);
  }
  const fresigner = fmover === finalClients[0] ? finalClients[1] : finalClients[0];
  fresigner.send('resign');
  await finalClients[0].wait('game_over');
  await T(600);
  const t3 = (await (await fetch('http://localhost:3999/api/tournaments')).json())
    .tournaments.find((x) => x.id === tid);
  ok(t3.status === 'finished', '赛事进入 finished 状态');
  ok(!!t3.championId, '冠军已产生');
  const champ = t3.players.find((p) => p.id === t3.championId);
  ok(!!champ, `冠军：${champ ? champ.name : '未知'}`);

  console.log(`\n========== 赛事测试结果：${pass} 通过, ${fail} 失败 ==========`);
  if (failures.length) {
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
  players.forEach((c) => c.close());
  process.exit(0);
}
main().catch((e) => { console.error('赛事测试异常:', e); process.exit(1); });
