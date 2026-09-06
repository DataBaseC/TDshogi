/** verify-10sec.js — 验证 0+10 快棋：开局即读秒、每手 10 秒、超时判负、读秒状态推送 */
'use strict';
const WebSocket = require('ws');
const crypto = require('crypto');
const T = (ms) => new Promise((r) => setTimeout(r, ms));
const gid = () => crypto.randomBytes(12).toString('hex');
const WS = 'ws://localhost:3999/ws';

function mkClient(name, guestId) {
  const c = { name, guestId, ws: null, queue: [], listeners: [], latest: null, clocks: [] };
  c.connect = () => new Promise((res, rej) => {
    c.ws = new WebSocket(`${WS}?guest=${guestId}`);
    c.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      c.queue.push(m);
      if (m.type === 'state') c.latest = m.data;
      if (m.type === 'clock') c.clocks.push(m.data);
      c.listeners = c.listeners.filter((l) => {
        if (l.type === m.type) { l.fn(m.data); return !l.once; }
        return true;
      });
    });
    c.ws.on('open', res); c.ws.on('error', rej);
  });
  c.send = (type, data = {}) => c.ws.send(JSON.stringify({ type, data }));
  c.wait = (type, timeout = 4000) => new Promise((res, rej) => {
    for (let i = c.queue.length - 1; i >= 0; i--) {
      if (c.queue[i].type === type) return res(c.queue[i].data);
    }
    const timer = setTimeout(() => { c.listeners = c.listeners.filter((l) => !(l.type === type && l.fn === fn)); rej(new Error(`${name} 等 ${type} 超时`)); }, timeout);
    const fn = (data) => { clearTimeout(timer); res(data); };
    c.listeners.push({ type, fn, once: true });
  });
  return c;
}

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}

async function main() {
  console.log('=== 0+10 快棋验证 ===');
  const A = mkClient('A', gid());
  const B = mkClient('B', gid());
  await A.connect(); await B.connect(); await T(250);

  // A 建房选 10sec
  A.send('create_room', { timeControl: '10sec' });
  const created = await A.wait('room_created');
  B.send('join_room', { code: created.code });
  await B.wait('room_joined');
  await A.wait('game_start'); await B.wait('game_start');
  await T(400);

  const st0 = A.latest;
  ok(st0.clock.b === 0 && st0.clock.w === 0, '本时恒 0（main=0）');
  ok(st0.byoyomi === 10000, '读秒时长 10 秒');
  ok(st0.inByoyomi && st0.inByoyomi.b === true && st0.inByoyomi.w === true, '开局即进入读秒状态');

  // 等 ~2 秒，确认读秒在递减（clock 消息）
  await T(2200);
  const lastClock = A.clocks[A.clocks.length - 1];
  const curB = lastClock ? lastClock.curByoyomi.b : null;
  ok(typeof curB === 'number' && curB < 10000 && curB > 0, `读秒递减中（剩余 ${curB}ms）`);
  ok(lastClock.inByoyomi.b === true, 'clock 消息标记读秒');

  // 先手走一步 → 轮到后手，后手读秒重新满 10 秒（每手独立）
  // 座位是随机的（rooms.createRoom 随机先手）——必须按 created.seat 映射客户端。
  // 旧写法假设房主 A=先手：A 抽到后手时走子被服务端拒绝，st1 停在旧局面，
  // nextSeat 误取仍在倒数的 b 方时钟 → 断言 8000ms/7.4s（历史"偶发 8/10"的真因）。
  const seatClient = (s) => (created.seat === s ? A : B);
  const mover = seatClient(st0.turn);
  const t0 = Date.now();  // 从走子时刻起算对手读秒
  mover.send('move', { usi: st0.legalMoves[0] });
  await T(300);  // 等走子后的第一条 clock（重置后 10 秒）
  const st1 = A.latest;
  const clockAfter = A.clocks[A.clocks.length - 1];
  const nextSeat = st1.turn;
  ok(clockAfter.curByoyomi[nextSeat] >= 9000, `走子后对手读秒重置为 ~10 秒（实际 ${clockAfter.curByoyomi[nextSeat]}ms）`);

  // 超时判负：轮到的一方不走了，等读秒耗尽（10 秒读秒 = 约 10 次 tick 判负）
  const loserSeat = nextSeat;
  let gameOver = null;
  try {
    const go = await seatClient(loserSeat).wait('game_over', 15000);
    gameOver = go;
  } catch (_) {}
  const elapsed = Date.now() - t0;
  ok(!!gameOver, '超时判负触发');
  if (gameOver) {
    ok(gameOver.resultDetail === '時間切れ', '判负原因=时间切れ');
    ok(elapsed >= 9000 && elapsed <= 11500, `走子后约 10 秒判负（实际 ${(elapsed / 1000).toFixed(1)}s）`);
    ok(gameOver.result === (loserSeat === 'b' ? 'w' : 'b'), '判负方正确');
  }

  console.log(`\n========== 0+10 验证：${pass} 通过, ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('异常:', e.message); process.exit(1); });
