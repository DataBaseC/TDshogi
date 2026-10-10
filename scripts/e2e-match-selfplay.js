/**
 * e2e-match-selfplay.js — 快速匹配「自己匹配到自己」回归（Bug4，2026-09-27 外包项）
 *
 * 现象：注册/改名后快速匹配会匹配到自己（同一人两个身份开局）。
 *
 * 已修复/锁定：
 *  ① 同一 playerId 双连接（同 guestId 多窗口）先后匹配 → 第二人被拒（守卫）；
 *  ② **身份组回归（核心）**：注册前用 guest id 入队、注册后用 account id 入队 →
 *     两者视为**同一人**，不得成局（此前只认 playerId 相等，注册后 id 变了就会自战）；
 *  ③ 入队后断线 → 队列无残留（死条目被清理），后续玩家照常配对；
 *  ④ 不同玩家正常配对（防过度拦截）。
 *
 * 用法：服务器运行于 :3999 后 `PORT=3999 node scripts/e2e-match-selfplay.js`。
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
  c.saw = (type) => c.q.some((m) => m.type === type);
  c.close = () => { try { c.ws.close(); } catch (_) { /* 忽略 */ } };
  return c;
}

async function conn(name, guestId) {
  const c = client(name, guestId);
  await c.connect();
  await c.wait('hello');
  return c;
}

async function register(username, guestId) {
  return (await fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'test1234', guestId }),
  })).json();
}

async function main() {
  console.log('=== 快速匹配自战回归（Bug4）===');

  // ---- ① 同一 playerId 双连接 ----
  console.log('\n--- ① 同 playerId 双连接：第二人被拒 ---');
  const gid = hex24();
  const A1 = await conn('A1', gid);
  const A2 = await conn('A2', gid);
  A1.send('quick_match');
  await A1.wait('matching');
  A2.send('quick_match');
  const e1 = await A2.wait('error');
  ok(/自己|已在匹配队列/.test(e1.message || ''), `第二连接被拒（${e1.message}）`);
  A1.send('cancel_match'); await A1.wait('matching'); await T(150);
  A1.close(); A2.close(); await T(200);

  // ---- ② 注册前后双身份（核心回归）----
  console.log('\n--- ② 注册前 guest 入队 + 注册后 account 入队：不得成局 ---');
  const G = hex24();
  const g = await conn('guest', G);
  g.send('quick_match');
  await g.wait('matching'); // 队列：guest
  const reg = await register(`自战${Date.now().toString(36).slice(-5)}`, G);
  ok(reg.ok === true, '用该 guestId 注册账号成功');
  const acc = await conn('account', reg.token);
  acc.send('quick_match');
  const e2 = await acc.wait('error'); // 身份组判定应拒绝
  ok(/自己|已在匹配队列/.test(e2.message || ''), `账号入队被拒（${e2.message}）`);
  await T(500);
  ok(!acc.saw('matched') && !acc.saw('game_start'), '**未成局**（账号未与旧 guest 身份配对）');
  ok(!g.saw('matched') && !g.saw('game_start'), '旧 guest 连接也未开局');
  g.send('cancel_match'); await g.wait('matching'); await T(150);
  g.close(); acc.close(); await T(200);

  // ---- ③ 入队后断线：队列无残留 ----
  console.log('\n--- ③ 入队后断线：死条目清理，后续正常配对 ---');
  const G2 = hex24();
  const g2 = await conn('guest2', G2);
  g2.send('quick_match');
  await g2.wait('matching'); // 队列：guest2
  g2.close();
  await T(700); // 等断线处理
  const P = await conn('P');
  const Q = await conn('Q');
  P.send('quick_match');
  await P.wait('matching');
  Q.send('quick_match');
  const mp = await P.wait('matched');
  const mq = await Q.wait('matched');
  ok(mp.roomId && mp.roomId === mq.roomId, `P/Q 正常配对到同一房间（${mp.roomId}）——队列无死残留`);
  ok(mp.code === mq.code, `双方房号一致（${mp.code}）`);
  P.close(); Q.close(); await T(200);

  // ---- ④ 不同玩家正常配对（防过度拦截）：③ 已覆盖 ----
  console.log(`\n========== 匹配自战回归：${pass} 通过, ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('运行异常：', e && e.stack || e); process.exit(1); });
