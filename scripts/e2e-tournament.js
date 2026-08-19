/**
 * e2e-tournament.js — 赛事端到端测试（4 人单败淘汰全流程）
 *
 * 流程：4 名玩家报名 → 满员开赛 → 首轮 2 场对局自动创建 →
 *       对局各自走完/认输 → 胜者晋级 → 决赛 → 冠军产生。
 *
 * 用法：服务器运行于 :3999 且 DATA_DIR 独立，直接 node scripts/e2e-tournament.js
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
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${HOST}?guest=${this.guestId}`);
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
  // ============ 报名阶段 ============
  await section('4 人报名 → 满员自动开赛');
  const players = [];
  for (let i = 0; i < 4; i++) {
    const p = new Client(`P${i + 1}`);
    await p.connect();
    await T(120);
    players.push(p);
  }
  players[0].send('create_tournament', { name: '测试赛', size: 4 });
  const created = await players[0].wait('tournament_created');
  ok(!!created.id, '赛事创建成功');
  const tid = created.id;

  for (let i = 1; i < 4; i++) {
    players[i].send('join_tournament', { id: tid });
    await players[i].wait('tournament_joined');
  }
  await T(500);
  // 满员后应自动开赛并创建首轮对局
  const data = await (await fetch('http://localhost:3999/api/tournaments')).json();
  const t = data.tournaments.find((x) => x.id === tid);
  ok(t && t.status === 'playing', '满员后赛事进入 playing 状态');
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
