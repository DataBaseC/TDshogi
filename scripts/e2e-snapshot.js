/**
 * e2e-snapshot.js — 对局快照/重启恢复端到端验证
 *
 * 流程：A 建房 → B 加入 → 走 2 手 → 等快照落盘 → 杀服务器 →
 *       重启（同 DATA_DIR）→ A 重连 → 应恢复原对局（moves=2、座位正确）
 */
'use strict';
const WebSocket = require('ws');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const path = require('path');

const T = (ms) => new Promise((r) => setTimeout(r, ms));
const gid = () => crypto.randomBytes(12).toString('hex');
const BASE = 'http://localhost:3997';
const WS = 'ws://localhost:3997/ws';
const ROOT = path.resolve(__dirname, '..'); // 项目根（自动推导，避免换机器/换目录后失效）
const DATA_DIR = path.join(ROOT, 'data', 'snap-test');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}

function mkClient(name, guestId) {
  const c = { name, guestId, ws: null, queue: [], listeners: [], latest: null, hello: null };
  c.connect = () => new Promise((res, rej) => {
    c.ws = new WebSocket(`${WS}?guest=${guestId}`);
    c.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      c.queue.push(m);
      if (m.type === 'state') c.latest = m.data;
      if (m.type === 'hello') c.hello = m.data;
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
  c.close = () => { try { c.ws.close(); } catch (_) {} };
  return c;
}

function startServer() {
  const p = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: '3997', DATA_DIR, SNAPSHOT_INTERVAL_MS: '2000' },
    stdio: 'ignore',
    detached: true,
  });
  return p;
}

async function waitServerUp(timeout = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const r = await fetch(`${BASE}/api/home`);
      if (r.ok) return true;
    } catch (_) {}
    await T(300);
  }
  return false;
}

async function main() {
  console.log('=== 对局快照 / 重启恢复验证 ===');
  // 清理历史残留（避免上次运行未清干净）
  try { execSync(`rmdir /s /q "${DATA_DIR}" 2>nul`); } catch (_) {}
  // 启动服务器
  let server = startServer();
  await waitServerUp();
  console.log('服务器 1 启动');

  const A = mkClient('A', gid());
  const B = mkClient('B', gid());
  await A.connect(); await B.connect(); await T(250);
  A.send('create_room', {});
  const created = await A.wait('room_created');
  B.send('join_room', { code: created.code });
  await B.wait('room_joined');
  await A.wait('game_start'); await B.wait('game_start');
  await T(300);

  // 走 2 手
  const st0 = A.latest;
  const moverOf = (turn) => (turn === created.seat ? A : B);
  const m1 = moverOf(st0.turn);
  m1.send('move', { usi: st0.legalMoves[0] });
  await T(400);
  const st1 = A.latest;
  const m2 = moverOf(st1.turn);
  m2.send('move', { usi: st1.legalMoves[0] });
  await T(400);
  const movesBefore = A.latest.moves.length;
  ok(movesBefore === 2, `对局进行中（moves=${movesBefore}）`);

  // 等快照落盘（间隔 2s）
  await T(3000);
  // 杀掉服务器（模拟崩溃）— Windows 用 taskkill 树杀
  try { execSync(`taskkill /PID ${server.pid} /T /F 2>nul`); } catch (_) {}
  await T(1200);
  console.log('服务器 1 已杀');

  // 重启（同 DATA_DIR）
  server = startServer();
  const up = await waitServerUp();
  ok(up, '服务器重启成功');
  await T(500);
  // 确认快照已恢复为内存房间
  const stats = await (await fetch(`${BASE}/api/home`)).json();
  ok(stats.stats.playing >= 1, `重启后恢复进行中对局（playing=${stats.stats.playing}）`);

  // A 重连 → 应恢复对局
  const A2 = mkClient('A2', A.guestId);
  await A2.connect();
  const hello = await A2.wait('hello');
  ok(hello.reconnect && hello.reconnect.ok, '重连检测到未完成对局（已恢复）');
  A2.send('request_state');
  const reState = await A2.wait('state');
  ok(reState.status === 'PLAYING', '恢复对局状态 PLAYING');
  ok(reState.moves.length === movesBefore, `恢复对局手数一致（moves=${reState.moves.length}）`);
  ok(reState.seat === created.seat, '恢复座位正确');

  // B 也重连验证双方
  const B2 = mkClient('B2', B.guestId);
  await B2.connect();
  const helloB = await B2.wait('hello');
  ok(helloB.reconnect && helloB.reconnect.ok, 'B 也检测到恢复的对局');
  B2.send('request_state');
  const reB = await B2.wait('state');
  ok(reB.moves.length === movesBefore, 'B 恢复对局手数一致');

  // ===== 恢复局治理（幽灵复活循环回归：修复「重启后新对局被旧局劫持」）=====
  console.log('\n=== 恢复局治理 ===');
  // (c) 玩家重连后直接开新局：旧恢复局应被放弃（对手在线 → 判负推进，保对手结算）
  A2.send('create_room', {});
  const newRoom = await A2.wait('room_created', 5000);
  ok(!!newRoom, '玩家重连后开新局：旧恢复局被放弃，新房间创建成功');
  const bOver = await B2.wait('game_over', 5000).catch(() => null);
  ok(!!bOver, '被放弃的恢复局对在线对手正常结算（game_over）');
  A2.close(); B2.close();

  // (a) WAITING 快照不应被复活：带等待房杀服务器 → 重启 → 等待房应被清理
  const C = mkClient('C', gid());
  await C.connect(); await T(250);
  C.send('create_room', {});
  await C.wait('room_created');
  await T(2500); // 等快照落盘
  try { execSync(`taskkill /PID ${server.pid} /T /F 2>nul`); } catch (_) {}
  await T(1200);
  server = startServer();
  ok(await waitServerUp(), '服务器重启（第 2 次）');
  await T(500);
  const stats2 = await (await fetch(`${BASE}/api/home`)).json();
  ok(stats2.stats.waiting === 0, `WAITING 快照不被复活（waiting=${stats2.stats.waiting}）`);
  C.close();

  // (b) PLAYING 恢复局无人回归 → 60s 自愈判负，快照清空
  const A3 = mkClient('A3', A.guestId);
  const B3 = mkClient('B3', B.guestId);
  await A3.connect(); await B3.connect(); await T(250);
  A3.send('create_room', {});
  const r3 = await A3.wait('room_created', 5000);
  B3.send('join_room', { code: r3.code });
  await B3.wait('room_joined');
  await A3.wait('game_start'); await B3.wait('game_start');
  const st3 = await A3.wait('state');
  const m3 = r3.seat === st3.turn ? A3 : B3;
  m3.send('move', { usi: st3.legalMoves[0] });
  await T(3000); // 等快照落盘
  try { execSync(`taskkill /PID ${server.pid} /T /F 2>nul`); } catch (_) {}
  await T(1200);
  server = startServer();
  ok(await waitServerUp(), '服务器重启（第 3 次）');
  console.log('  等待 65s 观察恢复局自愈…');
  await T(65000); // 双方都不回归
  const stats3 = await (await fetch(`${BASE}/api/home`)).json();
  ok(stats3.stats.playing === 0, `无人回归的恢复局 60s 判负自愈（playing=${stats3.stats.playing}）`);
  // ⚠️ `/api/history?player=` 自 §Q7-1 起仅管理员可用（匿名 403，响应里没有 records），
  //    玩家查自己的棋谱改走 `/api/profile?player=`。
  const hist = await (await fetch(`${BASE}/api/profile?player=${encodeURIComponent(A.guestId)}`)).json();
  const lastRec = (hist.records || [])[0];
  ok(lastRec && lastRec.resultDetail === '接続切断', `自愈判负原因=接続切断（${lastRec && lastRec.resultDetail}）`);
  A3.close(); B3.close();

  console.log(`\n========== 快照验证：${pass} 通过, ${fail} 失败 ==========`);
  // 清理
  try { execSync(`taskkill /PID ${server.pid} /T /F 2>nul`); } catch (_) {}
  try { execSync(`rmdir /s /q "${DATA_DIR}" 2>nul`); } catch (_) {}
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('异常:', e.message); process.exit(1); });
