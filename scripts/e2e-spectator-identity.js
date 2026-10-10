/**
 * e2e-spectator-identity.js — 观战者身份隔离回归测试
 *
 * 覆盖用户报告的 bug：
 *  1) 观战者加入后选手 ID 被观战者顶替 → 观战窗口保持观战身份，玩家不变
 *  2) 同 guestId 观战窗口连接不误绑玩家座位
 */
'use strict';
const WebSocket = require('ws');
const crypto = require('crypto');
const T = (ms) => new Promise((r) => setTimeout(r, ms));
const gid = () => crypto.randomBytes(12).toString('hex');
const WS = 'ws://localhost:3999/ws';

class Client {
  constructor(name, guestId) {
    this.name = name;
    this.guestId = guestId || gid();
    this.ws = null;
    this.queue = [];
    this.listeners = [];
    this.latestState = null;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS}?guest=${this.guestId}`);
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
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}
async function section(name) { console.log(`\n=== ${name} ===`); }

async function main() {
  await section('场景 1：独立身份观战不顶替玩家');
  const A = new Client('A');
  const B = new Client('B');
  const C = new Client('C');
  await A.connect(); await B.connect(); await C.connect(); await T(300);
  A.send('create_room', {});
  const created = await A.wait('room_created');
  B.send('join_room', { code: created.code });
  await B.wait('room_joined');
  await A.wait('game_start'); await B.wait('game_start');
  await T(300);
  C.send('spectate', { roomId: created.roomId });
  await C.wait('spectating');
  await C.wait('state');
  await T(300);
  const stC = C.latestState;
  ok(stC && stC.isPlayer === false && stC.seat === null, '观战者保持观战身份（seat=null）');
  const stA = A.latestState;
  ok(stA && stA.isPlayer === true && stA.seat === created.seat, '玩家保持玩家身份');
  const mover = stA.turn === created.seat ? A : B;
  const before = mover.latestState.moves.length;
  mover.send('move', { usi: mover.latestState.legalMoves[0] });
  await T(400);
  ok(mover.latestState.moves.length > before, '观战加入后玩家仍可走子');

  await section('场景 2：同 guestId 观战窗口不误绑玩家');
  const SAME = gid();
  const A2 = new Client('A2(玩家)', SAME);
  const B2 = new Client('B2(对手)');
  await A2.connect(); await B2.connect(); await T(250);
  A2.send('create_room', {});
  const created2 = await A2.wait('room_created');
  B2.send('join_room', { code: created2.code });
  await B2.wait('room_joined');
  await A2.wait('game_start'); await B2.wait('game_start');
  await T(300);
  const C2 = new Client('C2(观战-同id)', SAME);
  await C2.connect();
  await T(150);
  C2.send('spectate', { roomId: created2.roomId });
  await C2.wait('spectating');
  await C2.wait('state');
  await T(300);
  const stC2 = C2.latestState;
  ok(stC2 && stC2.isPlayer === false && stC2.seat === null, '同 guestId 观战窗口保持观战身份');
  const stA2 = A2.latestState;
  ok(stA2 && stA2.isPlayer === true && stA2.seat === created2.seat, '玩家窗口仍保持玩家身份');
  const mover2 = stA2.turn === created2.seat ? A2 : B2;
  const before2 = mover2.latestState.moves.length;
  mover2.send('move', { usi: mover2.latestState.legalMoves[0] });
  await T(400);
  ok(mover2.latestState.moves.length > before2, '同 guestId 观战加入后玩家仍可走子');

  console.log(`\n========== 观战身份隔离：${pass} 通过, ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('异常:', e.message); process.exit(1); });
