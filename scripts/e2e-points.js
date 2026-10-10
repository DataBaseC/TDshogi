/**
 * e2e-points.js — 用户积分端到端回归（F1，2026-09-27 外包项）
 *
 * 需求：用户有一个「积分」（独立于 ELO），每完成一次对局 +1，个人页/管理端可见。
 * 口径：胜/负/和均计、让子局计、判负/弃权计；**未终局不计**。服务端累计、前端只显示。
 *
 * 用法：服务器运行于 :3999 后 `PORT=3999 node scripts/e2e-points.js`。
 */
'use strict';

const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 3999);
const BASE = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}/ws`;
const hex24 = () => crypto.randomBytes(12).toString('hex');
const T = (ms) => new Promise((r) => setTimeout(r, ms));

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
  c.close = () => { try { c.ws.close(); } catch (_) { /* 忽略 */ } };
  return c;
}

const pointsOf = async (id) => {
  const r = await (await fetch(`${BASE}/api/profile?player=${encodeURIComponent(id)}`)).json();
  return (r.profile && r.profile.points) || 0;
};

async function main() {
  console.log('=== 用户积分（F1）===');

  const A = client('A'); await A.connect(); await A.wait('hello');
  const B = client('B'); await B.connect(); await B.wait('hello');

  const beforeA = await pointsOf(A.guestId);
  const beforeB = await pointsOf(B.guestId);
  ok(beforeA === 0 && beforeB === 0, `开局前积分均为 0（A=${beforeA} B=${beforeB}）`);

  // 未终局不计：建局并加入，但不结束
  A.send('create_room', {}); const room = await A.wait('room_created');
  B.send('join_room', { code: room.code }); await B.wait('room_joined');
  await T(400);
  ok(await pointsOf(A.guestId) === beforeA, '对局进行中（未终局）积分不计');

  // 终局（认输）→ 双方各 +1
  A.send('resign');
  await T(700);
  const afterA = await pointsOf(A.guestId);
  const afterB = await pointsOf(B.guestId);
  ok(afterA === beforeA + 1, `终局后先负/胜方 +1（A: ${beforeA}→${afterA}）`);
  ok(afterB === beforeB + 1, `终局后另一方 +1（B: ${beforeB}→${afterB}）`);

  A.close(); B.close();
  console.log(`\n========== 积分：${pass} 通过, ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('运行异常：', e && e.stack || e); process.exit(1); });
