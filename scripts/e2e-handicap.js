/**
 * e2e-handicap.js — 駒落ち（让子）端到端验证（PLAN §D 玩法项）
 *
 * 只能端到端验的部分：手合割要在**建房 → 状态下发 → 行棋顺序 → 再来一局**整条链路上都保住。
 * 单测只能验"局面生成对不对"，验不了"房间有没有把它带下去"。
 *
 * ⚠️ 起服务必须带 `ADMIN_PASSWORD` 吗？—— 不需要（本脚本不碰管理接口），
 *    由 `npm run e2e` 统一拉起隔离实例。
 */
'use strict';

const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3999);
const HOST = `ws://localhost:${PORT}/ws`;
const T = (ms) => new Promise((r) => setTimeout(r, ms));
const gid = () => crypto.randomBytes(12).toString('hex');

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; failures.push(label); console.log(`  ✗ ${label}`); }
}
const section = async (n) => console.log(`\n=== ${n} ===`);

function mkClient(name) {
  const c = { name, id: gid(), ws: null, msgs: [], listeners: [], state: null };
  c.connect = () => new Promise((res, rej) => {
    c.ws = new WebSocket(`${HOST}?guest=${c.id}`);
    c.ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (_) { return; }
      c.msgs.push(m);
      if (m.type === 'state') c.state = m.data;
      c.listeners = c.listeners.filter((l) => {
        if (l.type === m.type) { l.fn(m.data, m); return !l.once; }
        return true;
      });
    });
    c.ws.on('open', res);
    c.ws.on('error', rej);
  });
  c.send = (type, data) => c.ws.send(JSON.stringify({ type, data: data || {} }));
  /** 只认**调用之后**到达的消息（旧消息会让"这次收到了 X"的断言假通过） */
  c.waitNew = (type, ms = 4000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} 等新的 ${type} 超时`)), ms);
    const fn = (data) => { clearTimeout(timer); resolve(data); };
    c.listeners.push({ type, fn, once: true });
  });
  /**
   * 会先翻队列里的旧消息——**只给 `hello` 这类"连上就该来"的消息用**。
   * ⚠️ `hello` 可能在 `connect()` 的 promise 返回**之前**就到达（服务端在升级完成即发送），
   * 此时用 `waitNew` 会永远等不到（本脚本第一版就卡在这里）。
   */
  c.wait = (type, ms = 4000) => new Promise((resolve, reject) => {
    const hit = c.msgs.filter((m) => m.type === type).pop();
    if (hit) return resolve(hit.data);
    const timer = setTimeout(() => reject(new Error(`${name} 等 ${type} 超时`)), ms);
    const fn = (data) => { clearTimeout(timer); resolve(data); };
    c.listeners.push({ type, fn, once: true });
  });
  /** 数某个座位还剩多少枚棋子（从 `state.board` 数，与前端渲染同源） */
  c.countPieces = (color) => {
    let n = 0;
    for (const row of (c.state && c.state.board) || []) {
      for (const cell of row) if (cell && cell.piece && cell.color === color) n++;
    }
    return n;
  };
  c.close = () => { try { c.ws.close(); } catch (_) { /* 忽略 */ } };
  return c;
}

/**
 * 建房 + 对手加入，返回两方 client（已开局）。
 *
 * ⚠️ **所有 wait 都要在 send 之前注册**：若写成 `B.send(join); await B.wait(room_joined);
 * await A.wait(game_start)`，那么 A 的 `game_start` 很可能在等 `room_joined` 的**期间**就已经到达，
 * 之后才注册的监听器永远等不到它（本脚本第二版就卡在这里，报"Host 等新的 game_start 超时"）。
 */
async function openRoom(opts) {
  const A = mkClient('Host');
  const B = mkClient('Guest');
  await A.connect(); await B.connect();
  await A.wait('hello'); await B.wait('hello');

  const pCreated = A.waitNew('room_created');
  A.send('create_room', opts || {});
  const created = await pCreated;

  const pAStart = A.waitNew('game_start');
  const pBJoined = B.waitNew('room_joined');
  const pBStart = B.waitNew('game_start');
  B.send('join_room', { code: created.code });
  await pBJoined; await pAStart; await pBStart;
  await T(300);
  return { A, B, created };
}

async function main() {
  console.log('=== 駒落ち（让子）验证 ===');

  // ==================================================================
  await section('未知手合割必须被拒（不能静默当成平手）');
  // ==================================================================
  const X = mkClient('X');
  await X.connect();
  await X.wait('hello');
  X.send('create_room', { handicap: 'not-a-handicap' });
  const err = await X.waitNew('error');
  ok(/手合割/.test(err.message || ''), `未知手合割被拒（${err.message}）`);
  X.close();

  // ==================================================================
  await section('二枚落ち：局面、标签、先手方、不计评分');
  // ==================================================================
  const { A, B, created } = await openRoom({ handicap: 'two' });
  ok(created.handicap === 'two', `建房回执带 handicap（${created.handicap}）`);
  ok(created.handicapLabel === '二枚落ち', `建房回执带显示名（${created.handicapLabel}）`);
  ok(created.seat === 'b', '让子局：房主固定执 b（上手）——上手必须先行');
  ok(created.rated === false, '让子局不计 ELO');

  ok(A.state.handicap === 'two' && B.state.handicap === 'two', '双方 state 都带 handicap');
  ok(A.state.handicapLabel === '二枚落ち', 'state 带显示名（前端据此提示）');
  ok(A.state.rated === false && B.state.rated === false, 'state 标明不计评分');
  ok(A.countPieces('b') === 18, `上手（b）应为 18 枚，实际 ${A.countPieces('b')}`);
  ok(A.countPieces('w') === 20, `下手（w）应为 20 枚，实际 ${A.countPieces('w')}`);
  ok(B.countPieces('b') === 18 && B.countPieces('w') === 20, '对手视角看到的盘面一致');

  // ==================================================================
  await section('行棋顺序：上手先走，下手先走会被拒');
  // ==================================================================
  B.send('move', { usi: '7g7f' });
  const notYet = await B.waitNew('error');
  ok(/还没轮到你/.test(notYet.message || ''), `下手抢先走被拒（${notYet.message}）`);

  // ⚠️ 走子没有独立的广播消息，状态变更一律走 `state`（`movesKif` 就是记谱列表）
  A.send('move', { usi: '7g7f' });
  await T(400);
  ok((A.state.movesKif || []).length === 1, `上手先走成功（记谱 ${(A.state.movesKif || []).length} 手）`);
  ok(A.state.turn === 'w', `走完轮到下手（turn=${A.state.turn}）`);

  // ==================================================================
  await section('终局：不计评分 → 不应下发 elo_updated；棋谱记下手合割');
  // ==================================================================
  B.send('resign', {});
  const over = await B.waitNew('game_over');
  ok(!!over, '认输后收到 game_over');
  await T(600);
  const eloMsgs = B.msgs.filter((m) => m.type === 'elo_updated');
  ok(eloMsgs.length === 0, `让子局不该结算 ELO（收到 ${eloMsgs.length} 条 elo_updated）`);
  ok(B.state.handicap === 'two', '终局后 state 仍带 handicap（棋谱与复盘要据此标注）');

  // ==================================================================
  await section('再来一局：必须仍是同一个手合割');
  // ==================================================================
  // 同样：先注册再发送（"再来一局"的 game_start 是本局的第二条，必须只认新的）
  const pRestart = A.waitNew('game_start', 5000);
  A.send('rematch', {}); B.send('rematch', {});
  await pRestart;
  await T(400);
  ok(A.state.status === 'PLAYING', '重开后回到对局中');
  ok(A.countPieces('b') === 18, `重开后上手仍是 18 枚（实际 ${A.countPieces('b')}）——不能被重置成平手`);
  ok(A.countPieces('w') === 20, '重开后下手仍是 20 枚');
  ok(A.state.handicap === 'two', '重开后 handicap 仍在下发');
  A.close(); B.close();
  await T(200);

  // ==================================================================
  await section('对照：平手局不受影响（随机执先手、计评分、20/20）');
  // ==================================================================
  const even = await openRoom({});
  ok(even.created.handicap === null, '平手局 handicap 为 null');
  ok(even.created.handicapLabel === null, '平手局没有手合标签');
  ok(even.created.rated === true, '平手局计 ELO');
  ok(even.A.countPieces('b') === 20 && even.A.countPieces('w') === 20, '平手局双方各 20 枚');
  ok(even.A.state.turn === 'b', '平手局仍是 b 先手（初始手番未受影响）');
  even.A.close(); even.B.close();
  await T(200);

  console.log(`\n========== 駒落ち：${pass} 通过, ${fail} 失败 ==========`);
  if (failures.length) failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('异常: ' + e.message); process.exit(1); });
