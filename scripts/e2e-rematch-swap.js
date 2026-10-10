/**
 * e2e-rematch-swap.js — 「再来一局：先后手互换」端到端回归（F2，2026-09-27 外包项）
 *
 * 需求：双方点「再来一局」后**先后手互换**（上局先手变后手、后手变先手）；
 *       连续 rematch 交替（1先→2后→3先）；让子局连上下手一并互换并在 UI 标注。
 *
 * 断言口径：`state.seat` 是「这条连接坐哪边」的权威值（前端据它定棋盘朝向/先手标识），
 * 因此换先 = 双方 `state.seat` 互换、且仍是同一人（players[seat].id 不变）。
 *
 * 用法：服务器运行于 :3999 后 `PORT=3999 node scripts/e2e-rematch-swap.js`。
 */
'use strict';

const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 3999);
const WS = `ws://localhost:${PORT}/ws`;
const hex24 = () => crypto.randomBytes(12).toString('hex');
const T = (ms) => new Promise((r) => setTimeout(r, ms));
const flip = (s) => (s === 'b' ? 'w' : 'b');

let pass = 0; let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); }
}

function client(name, guestId) {
  const c = { name, guestId: guestId || hex24(), q: [], listeners: [] };
  c.connect = () => new Promise((res, rej) => {
    c.ws = new WebSocket(`${WS}?guest=${c.guestId}`);
    c.ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (_) { return; }
      const li = c.listeners.findIndex((l) => l.type === m.type);
      if (li >= 0) { c.listeners.splice(li, 1)[0].fn(m.data); return; }
      c.q.push(m);
    });
    c.ws.on('open', res); c.ws.on('error', rej);
  });
  c.send = (type, data) => c.ws.send(JSON.stringify({ type, data: data || {} }));
  c.wait = (type, ms = 6000) => new Promise((resolve, reject) => {
    const i = c.q.findIndex((m) => m.type === type);
    if (i >= 0) return resolve(c.q.splice(i, 1)[0].data);
    const timer = setTimeout(() => reject(new Error(`${name} 等 ${type} 超时`)), ms);
    c.listeners.push({ type, fn: (d) => { clearTimeout(timer); resolve(d); } });
  });
  c.drain = () => { c.q.length = 0; };
  c.close = () => { try { c.ws.close(); } catch (_) { /* 忽略 */ } };
  return c;
}

async function conn(name, guestId) {
  const c = client(name, guestId);
  await c.connect(); await c.wait('hello');
  return c;
}

async function main() {
  console.log('=== 再来一局：先后手互换（F2）===');

  // ==================================================================
  console.log('\n--- ① 普通局：rematch 双方换先，连续两次回到原位 ---');
  // ==================================================================
  const A = await conn('A');
  const B = await conn('B');
  A.send('create_room', {});
  const created = await A.wait('room_created');
  B.send('join_room', { code: created.code });
  await B.wait('room_joined');

  const sA0 = await A.wait('state');
  const sB0 = await B.wait('state');
  const seatA0 = sA0.seat; const seatB0 = sB0.seat;
  const idA = sA0.players[seatA0] && sA0.players[seatA0].id;
  ok(seatA0 && seatB0 && seatA0 !== seatB0, `开局座位互斥（A=${seatA0} B=${seatB0}）`);
  ok(sA0.turn === 'b', '开局先手为 b');

  // 第一局结束 + rematch
  A.drain(); B.drain();
  A.send('resign'); await T(500);
  A.drain(); B.drain();
  A.send('rematch'); B.send('rematch');
  const sA1 = await A.wait('state');
  const sB1 = await B.wait('state');
  ok(sA1.status === 'PLAYING' && sA1.turn === 'b', 'rematch 后新局开始、先手仍为 b');
  ok(sA1.seat === flip(seatA0), `A 换先（${seatA0}→${sA1.seat}）`);
  ok(sB1.seat === flip(seatB0), `B 换先（${seatB0}→${sB1.seat}）`);
  ok(sA1.players[sA1.seat] && sA1.players[sA1.seat].id === idA, 'A 仍是原人（仅换座）');

  // 第二局结束 + rematch（应回到原位）
  A.drain(); B.drain();
  A.send('resign'); await T(500);
  A.drain(); B.drain();
  A.send('rematch'); B.send('rematch');
  const sA2 = await A.wait('state');
  ok(sA2.seat === seatA0, `连续第二次 rematch 回到原位（${sA2.seat}===${seatA0}）`);
  A.close(); B.close(); await T(200);

  // ==================================================================
  console.log('\n--- ② 让子局：连上下手一并互换，手合标注保留 ---');
  // ==================================================================
  const C = await conn('C');
  const D = await conn('D');
  C.send('create_room', { handicap: 'lance' }); // 香落ち
  const croom = await C.wait('room_created');
  ok(croom.handicapLabel === '香落ち' && croom.seat === 'b', '让子局：上手固定为先手 b');
  D.send('join_room', { code: croom.code });
  await D.wait('room_joined');
  const sC0 = await C.wait('state');
  ok(sC0.handicapLabel === '香落ち', 'state 带手合标注');

  C.drain(); D.drain();
  C.send('resign'); await T(500);
  C.drain(); D.drain();
  C.send('rematch'); D.send('rematch');
  const sC1 = await C.wait('state');
  ok(sC1.seat === 'w', `让子局换先：上手由 b 变 w（C: b→${sC1.seat}）`);
  ok(sC1.handicapLabel === '香落ち', '换先后手合标注仍在（连上下手一起互换）');
  ok(sC1.turn === 'b', '让子局换先后再开，起手仍为 b（新冠军=新上手先走）');
  C.close(); D.close();

  console.log(`\n========== 再来一局换先：${pass} 通过, ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('运行异常：', e && e.stack || e); process.exit(1); });
