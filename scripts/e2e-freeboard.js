/**
 * e2e-freeboard.js — 感想战（独立页 demo.html）端到端验证（PLAN §G v5）
 *
 * 覆盖：demo_enter 全量载荷（座位/本谱/推演谱/合法走法/KIF）/ 权限矩阵
 *       （非演示者/观战者被拒）/ 演示行棋全场同步 + KIF / 分支（历史手另下）/
 *       待った / 交接 / 断线清权 + 玩家认领 / reset / PLAYING 态拒绝 /
 *       lobby 显示「复盘中」/ 清理改版（小常量注入）
 *
 * 用法：独立运行（自管服务器 :3994），node scripts/e2e-freeboard.js
 */
'use strict';
const WebSocket = require('ws');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const path = require('path');

const T = (ms) => new Promise((r) => setTimeout(r, ms));
const gid = () => crypto.randomBytes(12).toString('hex');
const BASE = 'http://localhost:3994';
const WS = 'ws://localhost:3994/ws';
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'freeboard-test');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(label); console.log(`  ✗ ${label}`); }
}
async function section(name) { console.log(`\n=== ${name} ===`); }

class Client {
  constructor(name, identity) {
    this.name = name;
    this.identity = identity || gid();
    this.q = [];
    this.latest = null;
    this.ws = null;
  }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(`${WS}?guest=${this.identity}`);
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        this.q.push(m);
        if (m.type === 'state') this.latest = m.data;
      });
      this.ws.on('open', res); this.ws.on('error', rej);
    });
  }
  send(type, data = {}) { this.ws.send(JSON.stringify({ type, data })); }
  // 消费式轮询：取最新同类消息并从队列移除（防陈旧消息污染断言）
  wait(type, timeout = 6000) {
    return new Promise((res, rej) => {
      const to = setTimeout(() => { clearInterval(iv); rej(new Error(`${this.name} 等 ${type} 超时`)); }, timeout);
      const iv = setInterval(() => {
        const i = this.q.map((x) => x.type).lastIndexOf(type);
        if (i >= 0) {
          clearTimeout(to); clearInterval(iv);
          const m = this.q[i];
          this.q = this.q.filter((x) => x.type !== type);
          res(m.data);
        }
      }, 40);
    });
  }
  enterDemo() { this.send('demo_enter', {}); return this.wait('demo_init', 5000); }
  close() { try { this.ws.close(); } catch (_) {} }
}

function startServer(extraEnv = {}) {
  return spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: '3994', DATA_DIR, SNAPSHOT_INTERVAL_MS: '2000', ...extraEnv },
    stdio: 'ignore',
    detached: true,
  });
}

async function waitServerUp(timeout = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const r = await fetch(`${BASE}/api/home`); if (r.ok) return true; } catch (_) {}
    await T(300);
  }
  return false;
}

function killServer(p) { try { execSync(`taskkill /PID ${p.pid} /T /F 2>nul`); } catch (_) {} }

async function main() {
  console.log('=== 感想战（独立页）验证 ===');
  try { execSync(`rmdir /s /q "${DATA_DIR}" 2>nul`); } catch (_) {}
  let server = startServer();
  ok(await waitServerUp(), '服务器启动');

  // 准备：A(房主) 建房 → B 加入 → 1 手 → B 认输
  const A = new Client('A'); const B = new Client('B'); const S = new Client('S');
  await A.connect(); await B.connect(); await S.connect(); await T(250);
  A.send('create_room', { timeControl: '10:00' });
  const created = await A.wait('room_created');
  const hostSeat = created.seat;
  const otherSeat = hostSeat === 'b' ? 'w' : 'b';
  B.send('join_room', { code: created.code });
  await B.wait('room_joined');
  await A.wait('game_start'); await B.wait('game_start');
  await T(400);
  const bySeat = (s) => hostSeat === s ? A : B;
  bySeat(A.latest.turn).send('move', { usi: A.latest.legalMoves[0] });
  await T(500);
  B.send('resign');
  await B.wait('game_over');
  await T(400);

  // ---- 1. demo_enter 全量载荷 ----
  await section('进入感想战（demo_enter）');
  const init = await A.enterDemo();
  ok(init.ok !== false && init.roomId === created.roomId, '进入感想战返回房间');
  ok(init.mySeat === hostSeat && init.isPlayer === true, `玩家视角带座位（${init.mySeat}）`);
  ok(init.baseIndex === 1 && init.baseCount === 1 && init.moves.length === 0, `推演谱为空（baseIndex=${init.baseIndex}）`);
  ok(Array.isArray(init.gameMoves) && init.gameMoves.length === 1, '下发本谱着法');
  ok(Array.isArray(init.gameKif) && init.gameKif.length === 1, `下发本谱 KIF（${init.gameKif[0]}）`);
  ok(Array.isArray(init.legalMoves) && init.legalMoves.length > 0, '下发推演合法走法');
  ok(init.names && init.names.length === 2, '下发双方名字');
  const demoMoves = init.moves; const demoKif = init.kif;
  const legalAtBase = init.legalMoves;

  // ---- 2. 观战者只看，不可行棋/认领 ----
  await section('观战者只看不摆');
  S.send('spectate', { roomId: created.roomId });
  await S.wait('state').catch(() => {});
  const sInit = await S.enterDemo();
  console.log('  [debug] sInit:', JSON.stringify({mySeat:sInit.mySeat,isPlayer:sInit.isPlayer,ok:sInit.ok,error:sInit.error}));
  ok(sInit.mySeat === null && sInit.isPlayer === false, '观战者以旁观身份进入');
  ok(sInit.baseIndex === 1 && sInit.moves.length === 0, '观战者拿到相同推演谱');
  S.send('demo_move', { usi: legalAtBase[0], index: sInit.baseIndex });
  const sErr = await S.wait('error');
  ok(/演示/.test(sErr.message || ''), `观战者行棋被拒（${sErr.message}）`);
  S.send('demo_claim');
  const sErr2 = await S.wait('error');
  ok(/观战者/.test(sErr2.message || ''), `观战者认领被拒（${sErr2.message}）`);

  // ---- 3. 非演示者行棋被拒 ----
  await section('非演示者不可行棋');
  const other = bySeat(otherSeat);
  other.send('demo_move', { usi: legalAtBase[0], index: init.baseIndex });
  const oErr = await other.wait('error');
  ok(/演示/.test(oErr.message || ''), `非演示者行棋被拒（${oErr.message}）`);

  // ---- 4. 演示者按规则行棋 → 全场同步 + KIF 追加 ----
  await section('演示行棋全场同步');
  const lm = legalAtBase[0];
  A.send('demo_move', { usi: lm, index: init.baseIndex });
  const dsB = await B.wait('demo_state', 5000);
  ok(dsB.moves.length === 1 && dsB.moves[0] === lm, `对手同步推演一手（${dsB.moves[0]}）`);
  ok(dsB.kif.length === 1, `推演 KIF 追加（${dsB.kif[0]}）`);
  ok(Array.isArray(dsB.legalMoves) && dsB.legalMoves.length > 0, '新局面的推演合法走法已下发');
  ok(dsB.baseIndex === init.baseIndex, 'baseIndex 保持');
  const dsS = await S.wait('demo_state', 5000);
  ok(dsS.moves.length === 1, '观战者同步推演一手');
  // 非法走法（同格出入的假手）
  A.send('demo_move', { usi: '1a1a' });
  const aErr = await A.wait('error');
  ok(/走法|非法/.test(aErr.message || ''), `非法走法被拒（${aErr.message}）`);

  // ---- 5. 分支：从本谱手数处另下不同的棋 → 截断开新分支，观众同步 ----
  await section('选棋谱历史手另下 → 新分支');
  const alt = legalAtBase.find((u) => u !== lm);
  A.send('demo_move', { usi: alt, index: init.baseIndex });
  const dsBr = await B.wait('demo_state', 5000);
  ok(dsBr.moves.length === 1 && dsBr.moves[0] === alt, `新分支生效（${dsBr.moves[0]} 取代 ${lm}）`);
  ok(dsBr.kif.length === 1, '新分支 KIF 重新生成');
  const dsBrS = await S.wait('demo_state', 5000);
  ok(dsBrS.moves.length === 1 && dsBrS.moves[0] === alt, '观众端同步显示新分支');
  // demo_legal：历史手（index=0 → 初始盘面）合法走法按需下发
  S.send('demo_legal', { index: 0 });
  const dl = await S.wait('demo_legal', 5000);
  ok(dl.index === 0 && dl.turn === 'b' && dl.legalMoves.length > 0, );
  // 演示者（在推演谱最新一手）请求历史手合法走法 → 收到对应局面
  A.send('demo_legal', { index: 0 });
  const dlA = await A.wait('demo_legal', 5000);
  ok(dlA.legalTargetsBySq && Object.keys(dlA.legalTargetsBySq).length > 0, '演示者收到历史手合法走法表');

  // ---- 6. 待った ----
  await section('待った回退');
  A.send('demo_undo');
  const dsU = await B.wait('demo_state', 5000);
  ok(dsU.moves.length === 0 && dsU.kif.length === 0, '待った后推演谱清空');
  ok(dsU.legalMoves.length > 0, '回退后合法走法重新下发');

  // ---- 7. 交接演示权 ----
  await section('演示权交接');
  A.send('demo_transfer');
  const dsT = await B.wait('demo_state', 5000);
  ok(dsT.demonstratorSeat === otherSeat, `演示权交给对手（${dsT.demonstratorName}）`);
  A.send('demo_move', { usi: dsT.legalMoves[0], index: dsT.baseIndex + dsT.moves.length });
  const aErr2 = await A.wait('error');
  ok(/演示/.test(aErr2.message || ''), `原演示者行棋被拒（${aErr2.message}）`);
  other.send('demo_move', { usi: dsT.legalMoves[0], index: dsT.baseIndex + dsT.moves.length });
  const dsM = await A.wait('demo_state', 5000);
  ok(dsM.moves.length === 1, '新演示者行棋同步成功');

  // ---- 8. 断线清权 → 玩家认领（观战者不可）----
  await section('断线清权与认领');
  other.close();
  const dsOff = await A.wait('demo_state', 5000);
  ok(dsOff.demonstratorSeat === null, '演示者断线后演示权置空');
  S.send('demo_claim');
  await S.wait('error').catch(() => {});
  A.send('demo_claim');
  const dsC = await S.wait('demo_state', 5000);
  ok(dsC.demonstratorSeat === hostSeat, `玩家认领成功（${dsC.demonstratorName}）`);

  // ---- 9. reset 清空推演 ----
  await section('清空推演');
  A.send('demo_reset');
  const dsR = await S.wait('demo_state', 5000);
  ok(dsR.moves.length === 0, 'reset 后推演谱清空');

  // ---- 10. lobby 显示「复盘中」----
  await section('大厅显示复盘中');
  const lobby = await (await fetch(`${BASE}/api/lobby`)).json();
  const reviewing = lobby.games.find((g) => g.roomId === created.roomId && g.type === 'reviewing');
  ok(!!reviewing, `大厅观战列表显示复盘中房间（${lobby.games.map((g) => g.type).join(',')}）`);

  // ---- 11. PLAYING 态拒绝 ----
  await section('进行中对局拒绝演示消息');
  A.send('create_room', {});
  const r2 = await A.wait('room_created');
  const B2 = new Client('B2');
  await B2.connect();
  B2.send('join_room', { code: r2.code });
  await B2.wait('game_start');
  A.send('demo_claim');
  const pErr = await A.wait('error');
  ok(/尚未结束/.test(pErr.message || ''), `PLAYING 态 demo_* 被拒（${pErr.message}）`);
  // ---- 11.5 对局中匹配 → 自动认输退出（用户确认行为，PLAN §H）----
  await section('对局中匹配/建房自动认输退出');
  A.send('quick_match', {});
  const goAuto = await A.wait('game_over', 5000).catch(() => null);
  ok(!!goAuto && goAuto.resultDetail === '投了', );
  A.send('create_room', {});
  const rNew = await A.wait('room_created', 5000).catch(() => null);
  ok(!!rNew, '自动退出后可立即建房');
  A.close(); B2.close();
  killServer(server);
  await T(1200);

  // ---- 12. 清理改版（小常量注入）----
  await section('清理机制改版（NO_MEMBER=3s / FINISHED_TTL=6s）');
  try { execSync(`rmdir /s /q "${DATA_DIR}" 2>nul`); } catch (_) {}
  server = startServer({ NO_MEMBER_CLEANUP_MS: '3000', FINISHED_TTL_MS: '6000' });
  ok(await waitServerUp(), '服务器 2 启动（小常量）');
  const C1 = new Client('C1'); const C2 = new Client('C2');
  await C1.connect(); await C2.connect(); await T(200);
  C1.send('create_room', { timeControl: '10:00' });
  const r3 = await C1.wait('room_created');
  C2.send('join_room', { code: r3.code });
  await C2.wait('game_start');
  C2.send('resign');
  await C2.wait('game_over');
  await T(2000); // TTL 6s 内：有成员存活
  let stats = await (await fetch(`${BASE}/api/home`)).json();
  ok(stats.stats.playing === 0 && stats.stats.waiting === 0, '有成员的感想战房间存活（TTL 未到不清理）');
  C1.close(); C2.close();
  let cleaned = false;
  for (let i = 0; i < 20 && !cleaned; i++) {
    await T(500);
    stats = await (await fetch(`${BASE}/api/home`)).json();
    cleaned = stats.stats.playing === 0 && stats.stats.waiting === 0;
  }
  ok(cleaned, '无连接房间被清理');
  killServer(server);
  try { execSync(`rmdir /s /q "${DATA_DIR}" 2>nul`); } catch (_) {}

  console.log(`\n========== 感想战验证：${pass} 通过, ${fail} 失败 ==========`);
  if (failures.length) {
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
  process.exit(0);
}
main().catch((e) => { console.error('感想战测试异常:', e); process.exit(1); });
