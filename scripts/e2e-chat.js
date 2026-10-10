/** verify-chat.js — 观战聊天端到端验证（临时） */
'use strict';
const WebSocket = require('ws');
const crypto = require('crypto');
const T = (ms) => new Promise((r) => setTimeout(r, ms));
const gid = () => crypto.randomBytes(12).toString('hex');
const WS = 'ws://localhost:3999/ws';

function mkClient(name, guestId) {
  const c = { name, guestId, ws: null, queue: [], listeners: [], msgs: [] };
  c.connect = () => new Promise((res, rej) => {
    c.ws = new WebSocket(`${WS}?guest=${guestId}`);
    c.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      c.queue.push(m);
      if (m.type === 'chat') c.msgs.push(m.data);
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
  console.log('=== 观战聊天验证 ===');
  const A = mkClient('A(先手)', gid());
  const B = mkClient('B(后手)', gid());
  const C = mkClient('C(观战)', gid());
  await A.connect(); await B.connect(); await C.connect(); await T(300);
  // 会话名由服务端在 hello 里下发（游客会被分配随机日式棋手名）
  const aName = (await A.wait('hello')).name;
  const bName = (await B.wait('hello')).name;
  const cName = (await C.wait('hello')).name;

  A.send('create_room', {});
  const created = await A.wait('room_created');
  B.send('join_room', { code: created.code });
  await B.wait('room_joined');
  await A.wait('game_start'); await B.wait('game_start');
  await T(300);
  C.send('spectate', { roomId: created.roomId });
  await C.wait('spectating');
  await T(300);

  // 三方各发一条
  A.send('chat', { text: '你好，后手！' });
  await T(300);
  B.send('chat', { text: '请多指教' });
  await T(300);
  C.send('chat', { text: '围观中，加油！' });
  await T(300);

  // ⚠️ 只数**用户发言**：`chat` 通道里还混着系统播报（`sys: true`，如 §R3 的
  //    "XX 进入观战"）。按总数断言会被任何新增的系统提示搞挂——本脚本就踩过
  //    （观战者进场播报让期望的 3 变成了 4）。
  const userMsgs = (c) => c.msgs.filter((m) => !m.sys);
  ok(userMsgs(A).length === 3, `A 收到 3 条用户发言（含自己的，实际 ${userMsgs(A).length}）`);
  ok(userMsgs(B).length === 3, `B 收到 3 条用户发言（实际 ${userMsgs(B).length}）`);
  ok(userMsgs(C).length === 3, `观战者 C 收到 3 条用户发言（实际 ${userMsgs(C).length}）`);
  // 名字与内容
  const aMsgs = userMsgs(A).map((m) => m.text);
  ok(aMsgs.includes('你好，后手！') && aMsgs.includes('请多指教') && aMsgs.includes('围观中，加油！'), 'A 收到的内容完整');
  const c0 = A.msgs.find((m) => m.text === '你好，后手！');
  ok(!!c0 && c0.name === aName, `玩家消息用座位名（期望 ${aName}，实际 ${c0 ? c0.name : '?'}）`);

  // ⚠️ 观战者发言显示的是**自己的会话真名**——旧实现一律显示"观众"，
  //    §R 起改成真名（互动体验更好）。所以这里比对 hello 下发的会话名，而不是写死"观众"。
  const cMsg = B.msgs.find((m) => m.text === '围观中，加油！');
  ok(!!cMsg && cMsg.name === cName, `观战者用会话真名发言（期望 ${cName}，实际 ${cMsg ? cMsg.name : '?'}）`);

  // 后手也用自己的座位名（两侧都验，避免"只有先手对"这种半边正确）
  const bMsg = C.msgs.find((m) => m.text === '请多指教');
  ok(!!bMsg && bMsg.name === bName, `后手消息用座位名（期望 ${bName}，实际 ${bMsg ? bMsg.name : '?'}）`);

  // 节流：A 连发两条，第二条应被拒
  A.queue.length = 0;
  A.send('chat', { text: '第一条' });
  await T(100);
  A.send('chat', { text: '第二条（应被拒）' });
  let throttled = false;
  try { await A.wait('error', 1500); throttled = true; } catch (_) {}
  ok(throttled, '2 秒内连发被节流拒绝');

  console.log(`\n========== 聊天验证：${pass} 通过, ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('异常:', e.message); process.exit(1); });
