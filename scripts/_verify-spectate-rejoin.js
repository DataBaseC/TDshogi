/**
 * 针对性回归验证：进行中对局列表入口（spectate 消息）选手回位
 * 场景：A 建房、B 加入开局 → 走一手 → A 断线 → A 全新连接发 spectate
 * 期望：spectating 带 rebind=true + seat；state isPlayer=true；后续走子收发正常
 * （先手可能落在任意一方，走子按手番轮转，不假定 A 是先手）
 */
'use strict';
const WebSocket = require('ws');
const crypto = require('crypto');

const HOST = 'ws://localhost:3999/ws';
const T = (ms) => new Promise((r) => setTimeout(r, ms));
const gid = () => crypto.randomBytes(12).toString('hex');

class Client {
  constructor(name, guestId) {
    this.name = name;
    this.guestId = guestId || gid();
    this.ws = null;
    this.queue = [];
    this.latestState = null;
    this.hello = null;
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
        if (msg.type === 'hello') this.hello = msg.data;
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
  wait(type, timeoutMs = 3000) {
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
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
};

async function main() {
  const GA = gid(); // A 的持久身份（重连复用）
  const A = new Client('A', GA);
  const B = new Client('B');
  await A.connect(); await B.connect();
  await T(200);

  A.send('create_room', {});
  const created = await A.wait('room_created');
  ok(!!created.roomId, `A 建房成功 roomId=${created.roomId}，A 座位=${created.seat}`);

  B.send('join_room', { code: created.code });
  await B.wait('room_joined');
  await A.wait('game_start'); await B.wait('game_start');
  await T(300);
  ok(A.latestState && A.latestState.status === 'PLAYING', '开局 PLAYING');

  // 手番轮转走子：偶数手=先手(b)，奇数手=後手(w)
  const holder = (s, aClient, bClient) => s === created.seat ? aClient : bClient;

  // 第 1 手（断线前）
  {
    const mover = holder('b', A, B);
    const watcher = mover === A ? B : A;
    const usi = mover.latestState.legalMoves[0];
    mover.send('move', { usi });
    await watcher.wait('state');
    await T(150);
    ok(watcher.latestState.moves.length === 1, `第 1 手 ${usi} 成功`);
  }

  // ---- A 掉线（close → unbind → connected=false）----
  A.close();
  await T(500);

  // 大厅 REST 下发 playerIds（前端按钮区分选手/观众的数据来源）
  const lobby = await fetch('http://localhost:3999/api/lobby').then((r) => r.json());
  const entry = lobby.games.find((g) => g.roomId === created.roomId);
  ok(!!entry, '进行中对局列表包含该房');
  ok(!!(entry && entry.playerIds && entry.playerIds.b && entry.playerIds.w), '列表下发 playerIds');

  // ---- A 全新连接（新 clientId）+ spectate 重进（复现用户操作路径）----
  const A2 = new Client('A2', GA);
  await A2.connect();
  await T(200);
  ok(!!A2.hello && !!A2.hello.playerId, '新连接 hello 下发 playerId');
  A2.send('spectate', { roomId: created.roomId });
  const spec = await A2.wait('spectating');
  ok(spec.rebind === true, `spectating.rebind === true (got ${JSON.stringify(spec)})`);
  ok(spec.seat === created.seat, `回位到原座位 ${created.seat}`);
  await A2.wait('state');
  ok(A2.latestState.isPlayer === true, 'state.isPlayer === true（不是观战）');
  ok(A2.latestState.seat === created.seat, 'state.seat 与原座位一致');
  ok(B.latestState && B.latestState.players[created.seat].connected === true, '对手侧看到 A connected=true');

  // 回位后继续对局：第 2、3 手按手番轮转（覆盖 A2 行棋与 A2 收子两个方向）
  {
    const m2 = holder('w', A2, B);
    const w2 = m2 === A2 ? B : A2;
    const usi = m2.latestState.legalMoves[0];
    m2.send('move', { usi });
    await w2.wait('state');
    await T(150);
    ok(w2.latestState.moves.length === 2, `第 2 手 ${usi} 成功（${m2.name} 行棋）`);
  }
  {
    const m3 = holder('b', A2, B);
    const w3 = m3 === A2 ? B : A2;
    const usi = m3.latestState.legalMoves[0];
    m3.send('move', { usi });
    await w3.wait('state');
    await T(150);
    ok(w3.latestState.moves.length === 3, `第 3 手 ${usi} 成功（${m3.name} 行棋）`);
  }

  // ---- 对照组：纯观众 spectate 同一房间 → 仍进观战席，不抢座位 ----
  const C = new Client('C');
  await C.connect();
  await T(200);
  C.send('spectate', { roomId: created.roomId });
  const specC = await C.wait('spectating');
  await C.wait('state');
  ok(!specC.rebind && C.latestState.isPlayer === false, '纯观众 spectate 保持观战身份');

  // ---- 对照组：座位已连接时，同身份第二窗口 spectate → 不顶座位，进观战 ----
  const A3 = new Client('A3', GA);
  await A3.connect();
  await T(200);
  A3.send('spectate', { roomId: created.roomId });
  const specA3 = await A3.wait('spectating');
  await A3.wait('state');
  ok(!specA3.rebind && A3.latestState.isPlayer === false, '座位占用中同身份新窗口进观战（不顶座位）');

  [A, B, A2, C, A3].forEach((c) => c.close());
  console.log(`\n========== 结果：${pass} 通过, ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('脚本异常:', e); process.exit(1); });
