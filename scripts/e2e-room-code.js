/**
 * e2e-room-code.js — 房号显示一致性 + 幽灵绑定回归（Bug2，2026-09-27 外包项）
 *
 * 用户报障：「加入房间后页面显示的房间 ID/房号与房主给出的房号对不上」。
 *
 * 本脚本锁定的是**房号在各方之间的一致性**这条契约：
 *   1. 建房返回的 `code`、加入返回的 `code`、双方 `state.code` **四方必须相等**；
 *   2. 加入方跳转进对局页（新 WS 连接 + `request_state {roomId}`）后，显示的仍是**新房号**——
 *      即「幽灵绑定」回归：B 先玩过别的房（含终局感想战），再加入新房，绝不能显示旧房号；
 *   3. 即便 `request_state` 漏带了 roomId（历史怀疑点），也必须回到**进行中的新房**，
 *      不能因为旧房残留绑定而回错房间。
 *
 * ⚠️ 本环境文件系统冷启动极慢（express 单模块 require 可达 20s+），单独跑时服务器需已就绪。
 * 用法：起好隔离实例后 `PORT=3999 node scripts/e2e-room-code.js`。
 */
'use strict';

const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 3999);
const HOST = `ws://localhost:${PORT}`;
const hex24 = () => crypto.randomBytes(12).toString('hex');
const T = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0; let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); }
}

function client(name, guestId) {
  const c = { name, q: [], listeners: [] };
  c.guestId = guestId || hex24();
  c.connect = () => new Promise((res, rej) => {
    c.ws = new WebSocket(`${HOST}/ws?guest=${c.guestId}`);
    c.ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (_) { return; }
      // 优先满足等待者（消费）；否则入队。二者只能其一，避免同一消息被取两次。
      const li = c.listeners.findIndex((l) => l.type === m.type);
      if (li >= 0) { c.listeners.splice(li, 1)[0].fn(m.data); return; }
      c.q.push(m);
    });
    c.ws.on('open', res);
    c.ws.on('error', rej);
  });
  c.send = (type, data) => c.ws.send(JSON.stringify({ type, data: data || {} }));
  /** 等待并**消费**一条指定类型的消息 */
  c.wait = (type, ms = 6000) => new Promise((resolve, reject) => {
    const i = c.q.findIndex((m) => m.type === type);
    if (i >= 0) return resolve(c.q.splice(i, 1)[0].data);
    const timer = setTimeout(() => reject(new Error(`${name} 等 ${type} 超时`)), ms);
    c.listeners.push({ type, fn: (d) => { clearTimeout(timer); resolve(d); } });
  });
  c.close = () => { try { c.ws.close(); } catch (_) { /* 忽略 */ } };
  return c;
}

async function connect(name, guestId) {
  const c = client(name, guestId);
  await c.connect();
  await c.wait('hello');
  return c;
}

async function main() {
  console.log('=== 房号显示一致性 + 幽灵绑定回归（Bug2）===');

  // ==================================================================
  console.log('\n--- ① 建房 → 加入：四方房号一致 ---');
  // ==================================================================
  const A = await connect('A');
  A.send('create_room', {});
  const created = await A.wait('room_created');
  ok(!!created.code && /^[A-Z0-9]{6}$/.test(created.code), `建房返回 6 位房号（${created.code}）`);
  ok(!!created.roomId, '建房返回 roomId');

  const B = await connect('B');
  B.send('join_room', { code: created.code });
  const joined = await B.wait('room_joined');
  await T(300);
  ok(joined.roomId === created.roomId, '加入返回的 roomId 与建房一致');
  ok(joined.code === created.code, `加入返回的房号与建房一致（${joined.code}）`);

  // 模拟双方「跳转进对局页」：各用一条新连接 + request_state {roomId}
  const A2 = await connect('A-进入', A.guestId);
  A2.send('request_state', { roomId: created.roomId });
  const stA = await A2.wait('state');
  const B2 = await connect('B-进入', B.guestId);
  B2.send('request_state', { roomId: joined.roomId });
  const stB = await B2.wait('state');
  ok(stA.code === created.code, `房主 state.code 一致（${stA.code}）`);
  ok(stB.code === created.code, `加入方 state.code 一致（${stB.code}）`);
  ok(stA.roomId === created.roomId && stB.roomId === created.roomId, '双方 state.roomId 同为建房房间');
  ok(stA.seat && stB.seat && stA.seat !== stB.seat, `双方座位互斥（${stA.seat}/${stB.seat}）`);
  A.close(); B.close(); A2.close(); B2.close();
  await T(200);

  // ==================================================================
  console.log('\n--- ② 幽灵绑定回归：B 先玩过别的房，再加入新房 ---');
  // ==================================================================
  const Bguest = hex24();
  // room1：A1 vs B，随后终局（进入感想战/复盘中）
  const A1 = await connect('A1');
  A1.send('create_room', {});
  const r1 = await A1.wait('room_created');
  const Bg = await connect('B', Bguest);
  Bg.send('join_room', { code: r1.code });
  await Bg.wait('room_joined');
  await T(300);
  A1.send('resign'); // 终局 → FINISHED + 感想战
  await T(600);

  // room2：A2 vs B（B 加入新房）
  const A2b = await connect('A2');
  A2b.send('create_room', {});
  const r2 = await A2b.wait('room_created');
  Bg.send('join_room', { code: r2.code });
  const j2 = await Bg.wait('room_joined');
  ok(j2.code === r2.code && j2.roomId === r2.roomId, `新房加入返回正确（${j2.code}）`);

  // B 跳转进新房对局页（新连接、带 roomId）：必须显示新房号
  const B2b = await connect('B-进入新房', Bguest);
  B2b.send('request_state', { roomId: j2.roomId });
  const stB2 = await B2b.wait('state');
  ok(stB2.code === r2.code, `B 进入新房显示新房号（${stB2.code}，旧房 ${r1.code}）`);
  ok(stB2.code !== r1.code, '**未回落到旧房号**（幽灵绑定回归）');

  // 容错：漏带 roomId 也必须回到进行中的新房（历史怀疑点）
  const B3 = await connect('B-漏带roomId', Bguest);
  B3.send('request_state', {});
  let stB3 = null;
  try { stB3 = await B3.wait('state', 4000); } catch (_) { /* 允许 no_room */ }
  ok(!stB3 || stB3.code === r2.code,
    `漏带 roomId 时也不回到旧房号（得到 ${stB3 ? stB3.code : 'no_room'}）`);

  A1.close(); A2b.close(); Bg.close(); B2b.close(); B3.close();
  await T(200);

  console.log(`\n========== 房号一致性：${pass} 通过, ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('运行异常：', e && e.stack || e); process.exit(1); });
