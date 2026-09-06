/**
 * e2e-test.js — TDShogi 端到端测试（双端对局 + 观战）
 *
 * 用 ws 客户端模拟：建房方 A、加入方 B、观战者 C。
 * 覆盖：建房/加入/开局、走子同步、观战数据隔离、观战离开、
 *       认输/再来一局、断线重连、快速匹配。
 *
 * 用法：先启动服务器（PORT=3999, DATA_DIR=独立目录），再 node scripts/e2e-test.js
 */
'use strict';

const WebSocket = require('ws');
const crypto = require('crypto');

const HOST = 'ws://localhost:3999/ws';
const T = (ms) => new Promise((r) => setTimeout(r, ms));
const gid = () => crypto.randomBytes(12).toString('hex');

class Client {
  constructor(name, guestId) {
    this.name = name;
    this.guestId = guestId || gid();
    this.ws = null;
    this.queue = [];        // 已接收消息（不消费）
    this.latestState = null; // 最新 state（持续跟踪）
    this.listeners = [];    // {type, fn, once}
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${HOST}?guest=${this.guestId}`);
      this.ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
        this.queue.push(msg);
        if (msg.type === 'state') this.latestState = msg.data;
        this.listeners = this.listeners.filter((l) => {
          if (l.type === msg.type) {
            l.fn(msg.data, msg);
            return !l.once;
          }
          return true;
        });
      });
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });
  }
  send(type, data = {}) {
    this.ws.send(JSON.stringify({ type, data }));
  }
  /** 等待某类型消息（注册监听器；已在队列中的立即返回最新一条，不消费队列） */
  wait(type, timeoutMs = 3000) {
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
  close() {
    if (this.ws) { try { this.ws.close(); } catch (_) {} }
  }
}

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(label); console.log(`  ✗ ${label}`); }
}
async function section(name) {
  console.log(`\n=== ${name} ===`);
}

async function main() {
  // ============ 场景 1：建房 → 加入 → 开局 ============
  await section('建房/加入/开局');
  const A = new Client('A');
  const B = new Client('B');
  await A.connect(); await B.connect();
  await T(200);

  A.send('create_room', {});
  const created = await A.wait('room_created');
  ok(!!created.roomId && created.code.length === 6, 'A 建房成功，6位房间码');
  const seatA = created.seat;
  const seatB = seatA === 'b' ? 'w' : 'b';

  B.send('join_room', { code: created.code });
  const joined = await B.wait('room_joined');
  ok(joined.ok && joined.seat === seatB, `B 加入且座位与 A 相反 (A=${seatA}, B=${joined.seat})`);

  await A.wait('game_start'); await B.wait('game_start');
  ok(true, '双方收到 game_start');

  // 等待双方都拿到开局 state
  let stA = null, stB = null;
  for (let i = 0; i < 20 && (!stA || !stB); i++) {
    stA = A.latestState; stB = B.latestState;
    if (!stA || !stB) await T(100);
  }
  ok(stA && stB && stA.status === 'PLAYING' && stB.status === 'PLAYING', '双方状态 PLAYING');
  ok(stA.turn === 'b' && stA.board && stA.board.length === 9, '初始手番 b，棋盘 9 行');
  ok(stA.players.b.name && stA.players.w.name, 'state 含双方玩家名');
  ok(!!stA.legalMoves && stA.legalMoves.length > 0, '走子方收到 legalMoves');

  // ============ 场景 2：观战者 ============
  await section('观战（数据隔离 + 同步）');
  const C = new Client('C');
  await C.connect(); await T(200);
  C.send('spectate', { roomId: created.roomId });
  await C.wait('spectating');
  await C.wait('state');
  const stC = C.latestState;
  ok(stC.roomId === created.roomId, '观战者进入同一房间');
  ok(!stC.isPlayer && stC.seat === null, '观战者 isPlayer=false, seat=null');
  ok(!stC.legalMoves || stC.legalMoves.length === 0, '观战者不收到合法走法（隔离）');
  ok(stC.board.length === 9 && stC.players.b, '观战者收到棋盘与玩家信息');

  // ============ 场景 3：走子同步（按 turn 决定走子方） ============
  await section('走子同步（双端交替，观战同步）');
  const moverOf = (turn) => (turn === seatA ? A : B);

  const firstMover = moverOf('b');
  const firstMove = stA.legalMoves[0];
  firstMover.send('move', { usi: firstMove });
  await T(400);
  const stA2 = A.latestState, stB2 = B.latestState, stC2 = C.latestState;
  ok(stA2.moves.length === 1 && stB2.moves.length === 1 && stC2.moves.length === 1, '三方 moves 长度同步=1');
  ok(Array.isArray(stA2.movesKif) && stA2.movesKif.length === 1 && typeof stA2.movesKif[0] === 'string' && stA2.movesKif[0].length > 0, 'state 携带日式记谱 movesKif');
  const firstMoverSeat = firstMover === A ? seatA : seatB;
  ok(stA2.turn !== firstMoverSeat, '走子后轮到另一方');
  ok(stA2.lastMove === firstMove && stB2.lastMove === firstMove && stC2.lastMove === firstMove, '三方 lastMove 一致');
  const sameBoard = JSON.stringify(stA2.board) === JSON.stringify(stB2.board) && JSON.stringify(stB2.board) === JSON.stringify(stC2.board);
  ok(sameBoard, '三方棋盘渲染数据一致');

  // 第二手（对方走）
  const secondMover = firstMover === A ? B : A;
  const secondMove = stA2.legalMoves[0];
  secondMover.send('move', { usi: secondMove });
  await T(400);
  const stA3 = A.latestState;
  ok(stA3.moves.length === 2 && stA3.lastMove === secondMove, '第二手同步（moves=2）');

  // 非法走子：刚走完的 secondMover 已非手番，再走必须被拒
  const notTurn = secondMover;
  notTurn.send('move', { usi: notTurn.latestState.legalMoves[0] });
  const errB = await notTurn.wait('error');
  ok(errB.message && /轮到你|非法/.test(errB.message), '非手番走子被拒绝');

  // ============ 场景 3b：打入（驹台棋子可打） ============
  await section('打入（持驹 → 打子目标 → 执行）');
  let dropExecuted = false;
  for (let i = 0; i < 60 && !dropExecuted; i++) {
    const st = (A.latestState || B.latestState);
    const mover = moverOf(st.turn);
    const mv = st.legalMoves && st.legalMoves[0];
    if (!mv) break;
    mover.send('move', { usi: mv });
    await T(120);
    const cur = moverOf((A.latestState || B.latestState).turn);
    const s = cur.latestState;
    if (s && s.legalTargetsBySq) {
      const dropKeys = Object.keys(s.legalTargetsBySq).filter((k) => /^[PLNSGBR]$/.test(k));
      if (dropKeys.length && s.legalTargetsBySq[dropKeys[0]].length) {
        const dropUsi = s.legalTargetsBySq[dropKeys[0]][0].usi;
        ok(/^[PLNSGBR]\*[1-9][a-i]$/.test(dropUsi), `打子目标可用（${dropUsi}，第 ${i + 1} 手）`);
        cur.send('move', { usi: dropUsi });
        await T(300);
        ok(cur.latestState.lastMove === dropUsi, `打子执行成功（${dropUsi}）`);
        dropExecuted = true;
      }
    }
  }
  ok(dropExecuted, '对局中出现可执行的打入');

  // ============ 场景 4：观战者离开（应停止接收广播） ============
  await section('观战者离开');
  C.send('leave');
  await C.wait('left');
  await T(300);
  const cCountBefore = C.queue.length;
  const stNow = A.latestState;
  const nowMover = moverOf(stNow.turn);
  nowMover.send('move', { usi: stNow.legalMoves[0] });
  await A.wait('state');
  await T(600);
  ok(C.queue.length === cCountBefore, '观战者离开后不再收到广播');

  // ============ 场景 4b：观战者断线重连（前端 open 重发 spectate 的前提） ============
  await section('观战者断线重连');
  const C2 = new Client('C2');
  await C2.connect(); await T(200);
  C2.send('spectate', { roomId: created.roomId });
  await C2.wait('spectating');
  await C2.wait('state');
  const stC2a = C2.latestState;
  ok(stC2a.roomId === created.roomId, 'C2 观战进入');
  // 断线
  C2.ws.close(); C2.ws = null;
  await T(400);
  // 重连后重新 spectate（模拟前端 open 重发）
  const C3 = new Client('C3');
  await C3.connect(); await T(200);
  C3.send('spectate', { roomId: created.roomId });
  await C3.wait('spectating');
  await C3.wait('state');
  const stC3a = C3.latestState;
  ok(stC3a.roomId === created.roomId && stC3a.moves.length === stC2a.moves.length, '观战者重连后重新进入并拿到最新局面');
  ok(!stC3a.isPlayer && stC3a.seat === null, '重连后仍是观战身份');

  // ============ 场景 5：认输 → 再来一局 ============
  await section('认输 / game_over / rematch');
  B.send('resign');
  const goA = await A.wait('game_over');
  const goB = await B.wait('game_over');
  ok(goA.result && goB.result, '双方收到 game_over');
  ok(goA.resultDetail === '投了', '结果=投了');
  ok(goA.winnerId === goB.winnerId, '双方 winnerId 一致');
  ok(!!goA.recordId, '棋谱已保存');
  ok((goA.result === (seatB === 'b' ? 'w' : 'b')), '认输方(B)判负');

  // 导出文件名应含选手名与日期（优化：文件名规范）
  try {
    const exp = await fetch(`http://localhost:3999/api/records/${goA.recordId}/export?fmt=kif&guest=${A.guestId}`);
    const cd = exp.headers.get('content-disposition') || '';
    const decoded = decodeURIComponent((cd.split("''")[1] || '').split(';')[0]);
    ok(/filename\*=UTF-8''/.test(cd) && /_\d{4}-\d{2}-\d{2}\.kif/.test(cd), `导出文件名含选手与日期（${decoded.slice(0, 40)}）`);
  } catch (e) {
    ok(false, '导出文件名断言异常: ' + e.message);
  }

  // 一方请求再来一局 → 对手应收到 rematch_requested 提示
  B.queue.length = 0;
  A.send('rematch');
  const remReq = await B.wait('rematch_requested');
  ok(!!remReq.requesterName, '对手收到「请求再来一局」通知（rematch_requested）');
  B.send('rematch');
  await A.wait('game_start'); await B.wait('game_start');
  await T(300);
  const remA = A.latestState;
  ok(remA.status === 'PLAYING' && remA.moves.length === 0, 'rematch 后新对局开局');
  ok(remA.turn === 'b', '新对局先手开始');

  // ============ 场景 6：断线重连 ============
  await section('断线重连');
  const rMover = moverOf(remA.turn);
  rMover.send('move', { usi: remA.legalMoves[0] });
  await B.wait('state'); await T(300);
  const A_old = A;
  A_old.ws.close(); A_old.ws = null;
  await T(500);
  const A2 = new Client('A2', A.guestId);  // 重连必须复用原 guestId
  await A2.connect();
  const helloA2 = await A2.wait('hello');
  ok(helloA2.reconnect && helloA2.reconnect.ok, '重连检测到未结束对局');
  A2.send('request_state');  // 真实前端 play.js 连接后即发 request_state
  await A2.wait('state');
  const reState = A2.latestState;
  ok(reState.status === 'PLAYING' && reState.moves.length >= 1, '重连拿到当前对局状态');
  ok(reState.seat === seatA, '重连恢复原座位');

  // ============ 场景 6b：页面跳转竞态（新连接先于旧连接 close 到达） ============
  await section('页面跳转竞态（空棋盘 bug 回归）');
  // 模拟：A 的另一个页面新连接立即 request_state，旧连接（A2）尚未关闭
  const A3 = new Client('A3(竞态)', A.guestId);
  await A3.connect();
  await T(150);
  A3.send('request_state');
  const raceState = await A3.wait('state');
  ok(!!raceState && raceState.board && raceState.board.length === 9, '竞态新连接拿到 state（不再空棋盘）');
  ok(raceState.board.some((row) => row.some((c) => c && c.piece)), 'state 棋盘含棋子');
  ok(raceState.status === 'PLAYING', '竞态连接绑定到进行中对局');

  // ============ 场景 7：快速匹配 ============
  await section('快速匹配');
  const D = new Client('D');
  const E = new Client('E');
  await D.connect(); await E.connect(); await T(200);
  D.send('quick_match'); E.send('quick_match');
  await D.wait('matched'); await E.wait('matched');
  await D.wait('game_start'); await E.wait('game_start');
  await T(300);
  const stD = D.latestState;
  const stE = E.latestState;
  ok(stD.status === 'PLAYING' && stE.status === 'PLAYING', '快速匹配对局开始');
  ok((stD.seat === 'b' && stE.seat === 'w') || (stD.seat === 'w' && stE.seat === 'b'), '双方座位互斥');

  // ============ 场景 7b：对局结束后不退出再次匹配（自动解绑已结束房间） ============
  await section('对局结束后不退出再次匹配');
  // D 认输结束与 E 的对局
  D.send('resign');
  await D.wait('game_over'); await E.wait('game_over');
  await T(300);
  // D 不退出直接再匹配（此前误报"你已在房间中"）
  const F = new Client('F');
  await F.connect(); await T(200);
  F.send('quick_match');
  D.send('quick_match');
  let dMatched = false, fMatched = false;
  try { await D.wait('matched', 3000); dMatched = true; } catch (_) {}
  try { await F.wait('matched', 3000); fMatched = true; } catch (_) {}
  ok(dMatched && fMatched, '对局结束后不退出可直接再次匹配（修复前报"你已在房间中"）');
  // 注意：上一步成功后 D 已进入新的进行中对局 → 再建房 = 自动认输退出旧局（用户确认行为，PLAN §H）
  D.send('create_room', {});
  let reCreated2 = null;
  try { reCreated2 = await D.wait('room_created', 3000); } catch (_) {}
  ok(!!reCreated2, '对局中建房 = 自动认输退出旧局并创建新房间');
  const oldGame = (await (await fetch('http://localhost:3999/api/history?player=' + D.guestId)).json()).records[0];
  ok(oldGame && oldGame.resultDetail === '投了', `旧对局被自动认输（${oldGame && oldGame.resultDetail}）`);
  // E 不退出直接建房也应成功（E 仍绑定在刚结束的房间里，_autoLeaveFinished 应先解绑）
  E.send('create_room', {});
  let reCreated = null;
  try { reCreated = await E.wait('room_created', 3000); } catch (_) {}
  ok(!!reCreated, '对局结束后不退出可直接建房');

  // ===== 同身份占用防护（同一 guestId 双连接）=====
  console.log('\n=== 同身份占用防护 ===');
  const sameId = gid();
  const G1 = new Client('G1', sameId);
  const G1b = new Client('G1b', sameId); // 同一身份的第二连接（模拟同浏览器双标签）
  await G1.connect(); await G1b.connect(); await T(250);
  G1.send('create_room', {});
  const gRoom = await G1.wait('room_created');
  G1b.send('join_room', { code: gRoom.code });
  const jErr = await G1b.wait('error', 3000);
  ok(/自己|同一身份/.test(jErr.message || ''), `同身份加入自己的房间被拒（${jErr.message}）`);
  G1.send('quick_match', {}); // G1 解散等待房并进入匹配队列
  await T(300);
  G1b.send('quick_match', {});
  const mErr = await G1b.wait('error', 3000);
  ok(/自己|同一身份/.test(mErr.message || ''), `同身份快速匹配被拒（${mErr.message}）`);
  G1.send('cancel_match', {});
  await T(200);

  console.log(`\n========== 结果：${pass} 通过, ${fail} 失败 ==========`);
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  // 关闭所有连接并退出（避免 ws 保持事件循环导致进程挂起）
  [A, B, C, C2, C3, A2, A3, D, E, F].forEach((c) => c && c.close && c.close());
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('测试异常:', e && e.message);
  process.exit(1);
});
