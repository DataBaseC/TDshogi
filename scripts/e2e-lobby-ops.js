/**
 * e2e-lobby-ops.js — 大厅操作幂等性回归（2026-09-21 安全审查 P1-1）
 *
 * ⚠️⚠️ **本脚本目前刻意未接入 `npm run e2e`**（见 `e2e-all.js` 的注释）：
 * 它断言的是**修复后**的行为，而修复版本会连带弄红 `e2e-test.js` 的「同身份占用防护」段，
 * 已按"先保绿"把 `src/rooms/lifecycle.js` 回退到 HEAD。
 * **它是下一轮做 P1-1 的验收目标 —— 修好后把它加回 `e2e-all.js` 的清单即可。**
 * 用法：起好隔离实例后 `PORT=3999 node scripts/e2e-lobby-ops.js`。
 *
 * 原始缺陷：`joinRoom` / `quickMatch` **一上来就 `_autoResignAndLeave()`**（先把自己判负），
 * 然后再校验目标 —— 于是下面三种"必然失败/重复"的请求都会把**当前对局判负**：
 *   ① 重复 join_room ② 双击 quick_match ③ 输错房间码再试
 * 审查实测：双击 quick_match 后对手立刻收到 `game_over detail=投了`。
 *
 * 修复后要求（用户决定：**重复请求 no-op**）：这三种请求只能**报错**，
 * 当前对局必须**分毫不动**（仍在进行中、没有 game_over）。
 * 同时要保住正常路径：注册房、加入房、配对、正常认输都照常工作（别一刀切关掉）。
 *
 * ⚠️ 已证伪的做法：**不要**用"N 秒内算重复"的时间窗 ——
 * `e2e-test.js`「对局结束后不退出可直接再次匹配」会当场挂（匹配→认输→再匹配可能落在 2 秒内）。
 * "重复请求"靠**状态**判定（已在同一房间 / 已在队列 / 正在对局）才准。
 */
'use strict';

const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 3999);
const HOST = `ws://localhost:${PORT}`;

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); }
}
const T = (ms) => new Promise((r) => setTimeout(r, ms));
const hex24 = () => crypto.randomBytes(12).toString('hex');

function client(name) {
  const c = { name, msgs: [], listeners: [] };
  c.connect = () => new Promise((res, rej) => {
    c.ws = new WebSocket(`${HOST}/ws?guest=${c.guestId}`);
    c.ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (_) { return; }
      c.msgs.push(m);
      if (m.type === 'state') c.state = m.data;
      c.listeners = c.listeners.filter((l) => { if (l.type === m.type) { l.fn(m.data); return false; } return true; });
    });
    c.ws.on('open', res);
    c.ws.on('error', rej);
  });
  c.send = (type, data) => c.ws.send(JSON.stringify({ type, data: data || {} }));
  c.wait = (type, ms = 5000) => new Promise((resolve, reject) => {
    const hit = c.msgs.filter((m) => m.type === type).pop();
    if (hit) return resolve(hit.data);
    const timer = setTimeout(() => reject(new Error(`${name} 等 ${type} 超时`)), ms);
    c.listeners.push({ type, fn: (d) => { clearTimeout(timer); resolve(d); } });
  });
  c.waitNew = (type, ms = 5000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} 等新的 ${type} 超时`)), ms);
    c.listeners.push({ type, fn: (d) => { clearTimeout(timer); resolve(d); } });
  });
  /** 某类消息在这次调用**之后**是否出现过（用于断言"没有 game_over"） */
  c.sawSince = (mark, type) => c.msgs.slice(mark).some((m) => m.type === type);
  c.close = () => { try { c.ws.close(); } catch (_) { /* 忽略 */ } };
  return c;
}

async function main() {
  console.log('=== 大厅操作幂等性（P1-1）===');

  // ---- 准备：A 建房、B 加入 → 一局进行中的对局 ----
  const A = client('A');
  const B = client('B');
  A.guestId = hex24();
  B.guestId = hex24();
  await A.connect();
  await A.wait('hello');
  await B.connect();
  await B.wait('hello');
  A.send('create_room', { timeControl: '10:00' });
  const room = await A.wait('room_created');
  B.send('join_room', { code: room.code });
  await A.wait('game_start');
  await B.wait('game_start');
  await T(300);
  ok(A.state && A.state.seat, `已进入对局（A 座位 ${A.state && A.state.seat}）`);

  // ==================================================================
  console.log('\n--- ① 对局中重复 join_room：只能报错，不能判负 ---');
  // ==================================================================
  let mark = A.msgs.length;
  A.send('join_room', { code: room.code }); // 重复加入自己所在的房
  const e1 = await A.waitNew('error');
  await T(500);
  ok(!!e1.message, `重复 join_room 收到错误（${e1.message}）`);
  ok(!A.sawSince(mark, 'game_over'), '**没有触发 game_over**（原先直接判负「投了」）');
  ok(A.state && !A.state.result, '对局仍在进行中');

  // ==================================================================
  console.log('\n--- ② 输错房间码：也只能报错 ---');
  // ==================================================================
  mark = A.msgs.length;
  A.send('join_room', { code: 'ZZZZZZ' });
  const e2 = await A.waitNew('error');
  await T(500);
  ok(/房间不存在|房间码/.test(e2.message || ''), `房间码错误被拒（${e2.message}）`);
  ok(!A.sawSince(mark, 'game_over'), '**没有触发 game_over**');

  // ==================================================================
  console.log('\n--- ③ 双击 quick_match：第二次必须被忽略 ---');
  // ==================================================================
  mark = A.msgs.length;
  A.send('quick_match', {});
  const e3 = await A.waitNew('error');
  await T(500);
  ok(!!e3.message, `对局中点匹配被拒（${e3.message}）`);
  A.ws.send(JSON.stringify({ type: 'quick_match', data: {} })); // 连发第二下
  let e4 = null;
  try { e4 = await A.waitNew('error', 2000); } catch (_) { /* 没回错也算"被忽略" */ }
  await T(500);
  ok(!A.sawSince(mark, 'game_over'), '**双击也没有触发 game_over**');
  ok(!!e4, `第二下也给了明确回应（${e4 ? e4.message : '无'}）——没有静默吞掉`);
  ok(A.state && !A.state.result, '对局仍在进行中');

  // ==================================================================
  console.log('\n--- 正向对照：正常路径没被误伤 ---');
  // ==================================================================
  // 对局照样"活着且可继续"（对局没被悄悄结束）
  // ⚠️ 别让"对手走子"来验：**建房者不一定是先手**，走子可能被判"还没轮到你"（本脚本第一版就这么误报过）。
  // "能查回状态且没有结果"是不依赖手番的健壮判据。
  mark = A.msgs.length;
  A.send('request_state', {});
  const st = await A.waitNew('state');
  ok(st && !st.result, `对局仍可查询、仍在进行中（未被执行结果污染）`);
  // 正常认输仍应判负
  const C = client('C');
  C.guestId = hex24();
  await C.connect();
  await C.wait('hello');
  A.send('resign', {});
  const over = await A.waitNew('game_over');
  ok(!!over && !!over.result, `正常认输仍判负（result=${over && over.result}）`);

  // 结束后加入新房间照常（同一身份、不同房 → 不算重复请求）
  const C2 = client('C2');
  C2.guestId = hex24();
  await C2.connect();
  await C2.wait('hello');
  C.send('create_room', { timeControl: '10:00' });
  const r2 = await C.wait('room_created');
  C2.send('join_room', { code: r2.code });
  const joined = await C2.wait('room_joined').catch(() => null);
  ok(!!joined, '对局结束后加入新房间照常可用');

  A.close(); B.close(); C.close(); C2.close();
  console.log(`\n========== 大厅幂等性：${pass} 通过, ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('异常: ' + e.message); process.exit(1); });
