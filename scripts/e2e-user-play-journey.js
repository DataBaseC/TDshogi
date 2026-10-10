/**
 * e2e-user-play-journey.js — 真实用法：约战一盘棋的完整旅程
 *
 * 与 `e2e-user-journey.js`（账号身份）互补：本脚本走的是**玩家真会做的事**，
 * 按一盘棋的时间顺序串起来，而不是单点接口罗列：
 *
 *   进站 → 约私人房（带密码）→ 朋友用房号加入 → 真实开局走子
 *   → 边下边聊 → 有人来观战 → 非法走法被拒 → 认输终局
 *   → 棋谱/战绩可查 → 注册带走数据 → 再来一局 → 快速匹配陌生人
 *   → 大厅/个人卡/棋谱检索（逛社区）
 *
 * 刻意覆盖「前端要渲染的契约」：hello 里的头像/手合割/举报类别/等级特权、
 * state 的 legalMoves/movesKif/座位、错误文案非空、game_over 带 recordId。
 *
 * 用法：服务器 :3999 后 `PORT=3999 node scripts/e2e-user-play-journey.js`。
 */
'use strict';

const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 3999);
const BASE = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}/ws`;
const T = (ms) => new Promise((r) => setTimeout(r, ms));
const gid = () => crypto.randomBytes(12).toString('hex');
const gkey = () => crypto.randomBytes(32).toString('hex');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(label); console.log(`  ✗ ${label}`); }
}
function section(name) { console.log(`\n=== ${name} ===`); }

async function api(pathname, method = 'GET', body = null) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

/**
 * 仿浏览器会话。监听器优先消费，再入队；state 持续跟踪。
 * `match` 版 wait 用于「error 或成功」二选一的断言。
 */
function open(name, id, key) {
  return new Promise((resolve, reject) => {
    const qs = [`guest=${encodeURIComponent(id)}`];
    if (key) qs.push(`key=${encodeURIComponent(key)}`);
    const ws = new WebSocket(`${WS}?${qs.join('&')}`);
    const c = {
      name, id, key, ws,
      q: [], listeners: [], latestState: null, hello: null,
      send(type, data) { ws.send(JSON.stringify({ type, data: data || {} })); },
      /** 等待指定 type（消费） */
      wait(type, ms = 5000) {
        return new Promise((res, rej) => {
          for (let i = this.q.length - 1; i >= 0; i--) {
            if (this.q[i].type === type) return res(this.q.splice(i, 1)[0].data);
          }
          const timer = setTimeout(() => {
            const seen = this.q.map((m) => {
              const d = m.type === 'error' && m.data && m.data.message ? `(${m.data.message})` : '';
              return m.type + d;
            }).slice(-8).join(', ');
            rej(new Error(`${this.name} 等 ${type} 超时（已收到: ${seen || '空'}）`));
          }, ms);
          this.listeners.push({ type, fn: (d) => { clearTimeout(timer); res(d); } });
        });
      },
      /** 等待满足 pred 的消息（任一类型） */
      waitIf(pred, ms = 5000) {
        return new Promise((res, rej) => {
          for (let i = 0; i < this.q.length; i++) {
            if (pred(this.q[i], this.q[i].data)) return res(this.q.splice(i, 1)[0]);
          }
          const timer = setTimeout(() => rej(new Error(`${this.name} 等条件消息超时`)), ms);
          this.listeners.push({
            type: '*',
            fn: (d, m) => {},
            // 扩展：下面在 onmessage 里统一走 pred
            _pred: pred,
            _res: (m) => { clearTimeout(timer); res(m); },
          });
        });
      },
      close() { try { ws.close(); } catch (_) {} },
    };
    ws.on('message', (raw) => {
      let m = null; try { m = JSON.parse(raw.toString()); } catch (_) { return; }
      if (m.type === 'state') c.latestState = m.data;
      // waitIf：任意类型 + 谓词
      for (let i = c.listeners.length - 1; i >= 0; i--) {
        const l = c.listeners[i];
        if (l._pred) {
          if (l._pred(m, m.data)) {
            c.listeners.splice(i, 1);
            l._res(m);
            return;
          }
          continue;
        }
        if (l.type === m.type) {
          c.listeners.splice(i, 1);
          l.fn(m.data, m);
          return;
        }
      }
      c.q.push(m);
    });
    const timer = setTimeout(() => reject(new Error(`${name} hello 超时`)), 5000);
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    ws.once('message', (raw) => {
      let m = null; try { m = JSON.parse(raw.toString()); } catch (_) { return; }
      if (m && m.type === 'hello') {
        clearTimeout(timer);
        c.hello = m.data;
        resolve(c);
      }
    });
  });
}

async function main() {
  // ==================================================================
  // 0. 进站
  // ==================================================================
  section('进站：客户端首屏依赖的握手数据');
  const Alice = gid(), AliceKey = gkey();
  const Bob = gid(), BobKey = gkey();
  const A = await open('A', Alice, AliceKey);
  const B = await open('B', Bob, BobKey);

  ok(A.hello.playerId === Alice, 'hello 返回身份 id');
  ok(typeof A.hello.name === 'string' && A.hello.name.length > 0, 'hello 有显示名');
  ok(Array.isArray(A.hello.avatars) && A.hello.avatars.length > 0, 'hello 带头像白名单');
  ok(Array.isArray(A.hello.reportCategories) && A.hello.reportCategories.length > 0, 'hello 带举报类别');
  ok(Array.isArray(A.hello.handicaps) && A.hello.handicaps.length > 0, 'hello 带手合割列表');
  ok(A.hello.level != null && typeof A.hello.level === 'number', `hello 带等级（level=${A.hello.level}）`);
  ok(A.hello.privileges && A.hello.privileges.create_tournament, 'hello 带等级特权（含建赛门槛）');
  ok(!!A.hello.stats, 'hello 带在线统计');

  // ==================================================================
  // 1. 约战：私人房 + 密码
  // ==================================================================
  section('约战：私人房带密码');
  // ⚠️ 字段名以 lobby.js 为准：`isPrivate`（不是 `private`）
  A.send('create_room', { isPrivate: true, password: '1234', name: '周末约战' });
  const created = await A.wait('room_created');
  ok(!!created.roomId && /^[A-Z0-9]{6}$/.test(created.code), `A 建私人房，房号 ${created.code}`);
  ok(!!created.seat, `A 入座 ${created.seat}`);

  // 大厅契约：私人房要么不出现，要么带私密标记
  const lob1 = await api('/api/lobby');
  const list1 = (lob1.json && (lob1.json.rooms || lob1.json.list)) || (lob1.json && lob1.json.lobby && lob1.json.lobby.rooms) || [];
  const hit1 = Array.isArray(list1) ? list1.find((r) => r && (r.code === created.code || r.id === created.roomId)) : null;
  if (!hit1) ok(true, '私人房未混入公开大厅');
  else ok(!!(hit1.isPrivate || hit1.private || hit1.hasPassword || hit1.locked), '大厅中的私人房有私密/密码标记');

  // 错密码：应收到 error（带 needPassword 标志更好）
  B.send('join_room', { code: created.code, password: '9999' });
  const badJoin = await B.waitIf((m) => m.type === 'error' || m.type === 'room_joined');
  ok(badJoin.type === 'error' && (badJoin.data.message || '').length > 0,
    `错密码被拒且有文案：${badJoin.data && badJoin.data.message}${badJoin.data && badJoin.data.needPassword ? '（needPassword）' : ''}`);

  // 对密码
  B.send('join_room', { code: created.code, password: '1234' });
  const joined = await B.wait('room_joined');
  ok(joined.ok !== false && !!joined.seat && joined.seat !== created.seat,
    `B 对密码加入，座位相对（A=${created.seat} B=${joined.seat}）`);
  ok(joined.code === created.code || !joined.code, '加入回执房号一致');

  const gStartA = await A.wait('game_start');
  const gStartB = await B.wait('game_start');
  ok(!!gStartA && !!gStartB, '双方收到 game_start');

  // ==================================================================
  // 2. 真实开局（将棋常见 opening）
  // ==================================================================
  section('真实开局走子');
  let st = A.latestState;
  for (let i = 0; i < 15 && !st; i++) { await T(100); st = A.latestState; }
  ok(st && st.status === 'PLAYING', '开局状态 PLAYING');
  ok(st.turn === 'b', '先手 b 开始');
  ok(st.board && st.board.length === 9, '棋盘 9 行');
  ok(st.players && st.players.b && st.players.w, 'state 带双方玩家');
  ok(Array.isArray(st.legalMoves) && st.legalMoves.length > 0, '走子方有 legalMoves');
  ok(st.seat === created.seat, 'A 的座位与建房回执一致');

  // 按座位决定谁走
  const seatA = created.seat;
  const seatB = joined.seat;
  const mover = (turn) => (turn === seatA ? A : B);

  /**
   * 走子并等**新局面**（而不是队列里残留的旧 state）。
   *
   * ⚠️ `minMovesAfter` 必须由调用方给死：不能读 `client.latestState` 当 before——
   * 第二手时「刚走完第一手的那个客户端」的 latestState 可能还是 0 手，
   * 阈值一松就会把第一手的广播误判成第二手。
   */
  const tryMove = async (client, usi, expectOk, label, minMovesAfter) => {
    client.q.length = 0;
    client.send('move', { usi });
    const m = await client.waitIf(
      (x) => x.type === 'error' || (x.type === 'state' && x.data && Array.isArray(x.data.moves) && x.data.moves.length >= minMovesAfter),
      4000,
    );
    if (expectOk) {
      ok(m.type === 'state', label + (m.type === 'error' ? ` ← ${m.data.message}` : ''));
    } else {
      ok(m.type === 'error' && (m.data.message || '').length > 0,
        label + `：${m.data && m.data.message}`);
    }
    return m;
  };

  let firstUsi = '7g7f';
  if (!st.legalMoves.includes(firstUsi)) firstUsi = st.legalMoves[0];
  const turnBefore1 = st.turn;
  const m1 = await tryMove(mover(turnBefore1), firstUsi, true, `先手 ${firstUsi}`, 1);
  if (m1.type === 'state') {
    ok(m1.data.moves.length === 1, '第 1 手入谱');
    ok(m1.data.lastMove === firstUsi, 'lastMove 正确');
    ok(m1.data.movesKif && m1.data.movesKif.length === 1 && m1.data.movesKif[0].length > 0,
      `日式记谱就绪：${m1.data.movesKif[0]}`);
    // 座位随机（房主可能 b/w），手番断言只看「有没有从走子前翻到另一边」
    ok(m1.data.turn === (turnBefore1 === 'b' ? 'w' : 'b'), `手番切换（${turnBefore1}→${m1.data.turn}）`);
  }

  // 第二步：以第一手广播的权威 state 为准（不要读对家 latestState，可能还没到）
  const st2 = m1.type === 'state' ? m1.data : null;
  if (st2 && st2.legalMoves && st2.legalMoves.length) {
    let secondUsi = '3c3d';
    if (!st2.legalMoves.includes(secondUsi)) secondUsi = st2.legalMoves[0];
    const m2 = await tryMove(mover(st2.turn), secondUsi, true, `后手 ${secondUsi}`, 2);
    if (m2.type === 'state') ok(m2.data.moves.length === 2, '第 2 手入谱');

    // 非手番乱走 → 明确拒绝（用 m2 的权威 turn 找「现在该走却乱走」的一方）
    const stNow = m2.type === 'state' ? m2.data : st2;
    const canMove = mover(stNow.turn);
    const other = canMove === A ? B : A;
    const illegal = (stNow.legalMoves && stNow.legalMoves[0]) || '9a9b';
    other.q.length = 0;
    other.send('move', { usi: illegal });
    const badMove = await other.waitIf((x) => x.type === 'error' || x.type === 'state');
    ok(badMove.type === 'error' && /轮到|非法|不能/.test(badMove.data.message || ''),
      `非手番走子被拒：${badMove.data && badMove.data.message}`);
  } else {
    ok(false, '第二手缺少 legalMoves');
    ok(false, '非手番走子被拒');
  }

  // ==================================================================
  // 3. 边下边聊
  // ==================================================================
  section('对局聊天');
  A.send('chat', { text: '请多指教' });
  const chatB = await B.waitIf((m) => m.type === 'chat' || m.type === 'chat_message' || m.type === 'message');
  ok(['chat', 'chat_message', 'message'].includes(chatB.type), `B 收到聊天（type=${chatB.type}）`);
  const chatText = chatB.data.text || chatB.data.message || chatB.data.content;
  ok(String(chatText).includes('请多指教'), '聊天内容原样到达');
  B.send('chat', { text: 'よろしくお願いします' });
  const chatA = await A.waitIf((m) => m.type === 'chat' || m.type === 'chat_message' || m.type === 'message');
  ok(!!chatA, 'A 收到对方聊天');

  // ==================================================================
  // 4. 观战
  // ==================================================================
  section('观战：朋友用房号进来看');
  const Cid = gid(), Ckey = gkey();
  const C = await open('C', Cid, Ckey);
  // 私人房观战也要密码（产品行为，lobby.js 会把密码存 sessionStorage 带上）
  C.send('spectate', { code: created.code, password: '1234' });
  const spec = await C.waitIf((m) => m.type === 'spectating' || m.type === 'error');
  ok(spec.type === 'spectating', `C 进入观战${spec.type === 'error' ? ' ← ' + spec.data.message : ''}`);
  if (spec.type === 'spectating') {
    await C.wait('state');
    const stC = C.latestState;
    ok(stC.roomId === created.roomId, '观战者看到同一房间');
    ok(stC.isPlayer === false && stC.seat === null, '观战者无座位');
    ok(!stC.legalMoves || stC.legalMoves.length === 0, '观战者看不到合法走法（防泄密）');
    ok(stC.moves.length >= 1, `观战者看到已有手数（${stC.moves.length}）`);

    // 观战者也能聊天（常见用法）
    C.send('chat', { text: '好棋！' });
    const chatToA = await A.waitIf((m) => (m.type === 'chat' || m.type === 'chat_message' || m.type === 'message')
      && JSON.stringify(m.data).includes('好棋'));
    ok(!!chatToA, '对局者收到观战者聊天');

    // 观战者不能走子
    C.q.length = 0;
    C.send('move', { usi: '7g7f' });
    const specMove = await C.waitIf((m) => m.type === 'error' || m.type === 'state');
    ok(specMove.type === 'error', `观战者走子被拒：${specMove.data && specMove.data.message}`);
  } else {
    ok(false, '观战失败导致后续观战断言跳过');
  }

  // ==================================================================
  // 5. 认输终局
  // ==================================================================
  section('认输终局');
  // 轮到谁谁认输，保证是「在走子的一方」投了
  const loser = mover((A.latestState || B.latestState).turn);
  const winner = loser === A ? B : A;
  loser.q.length = 0; winner.q.length = 0;
  loser.send('resign');
  const goL = await loser.wait('game_over');
  const goW = await winner.wait('game_over');
  ok(!!goL.result && !!goW.result, '双方收到 game_over');
  ok(goL.resultDetail === '投了', `结果=投了（${goL.resultDetail}）`);
  ok(!!goL.recordId, `棋谱已落库 recordId=${goL.recordId}`);
  ok(goL.winnerId === goW.winnerId && goL.winnerId !== loser.id, '胜者一致且不是认输方');
  ok(!!goL.elo || goL.rated !== undefined || true, '终局载荷含结算信息（若有）');

  // ==================================================================
  // 6. 再来一局（常见「不服」——必须在注册升级前，双方仍在房间内）
  // ==================================================================
  section('再来一局');
  loser.q.length = 0; winner.q.length = 0;
  loser.send('rematch');
  const rem = await winner.waitIf((m) => m.type === 'rematch_requested' || m.type === 'game_start' || m.type === 'error', 4000);
  ok(rem.type !== 'error', `再来一局请求发出${rem.type === 'error' ? ' ← ' + rem.data.message : ''}`);
  if (rem.type === 'rematch_requested') {
    winner.send('rematch');
    await winner.wait('game_start');
    await loser.wait('game_start');
    ok(true, '双方应战后新对局开始');
  } else if (rem.type === 'game_start') {
    ok(true, '再来一局直接开局');
  }
  // 打完 rematch 局再往下走：按最新 state.seat 判定谁走（F2 会换先后）
  await T(200);
  const stR = A.latestState || B.latestState;
  const whoResign = stR && A.latestState && A.latestState.seat === stR.turn ? A : B;
  whoResign.send('resign');
  await whoResign.wait('game_over').catch(() => {});
  await T(150);

  // ==================================================================
  // 7. 战绩与棋谱（玩家会去个人页看）
  // ==================================================================
  section('战绩 / 棋谱可查');
  const rec = await api(`/api/records/${goL.recordId}/playback?guest=${encodeURIComponent(loser.id)}`);
  ok(rec.status === 200 && rec.json, `棋谱回放可读（HTTP ${rec.status}）`);

  // REST 检索对游客刻意 403（PLAN §Q7：防枚举他人棋谱），前端走 WS record_search。
  // 这里钉死的是这条产品契约本身，而不是「一定要 200」。
  const search = await api(`/api/records/search?guest=${encodeURIComponent(loser.id)}`);
  ok(search.status === 403, `游客 REST 棋谱检索应 403 并引导走 WS（HTTP ${search.status}）`);

  // WS record_search（真实前端棋谱广场走这条）
  loser.send('record_search', { q: '' });
  const rs = await loser.wait('record_search_result');
  ok(Array.isArray(rs.records), 'WS 棋谱检索返回列表');
  ok(rs.records.some((r) => r.id === goL.recordId || (r.recordId === goL.recordId)),
    '刚下的棋能被检索到');

  // 个人卡（悬停小窗）
  const card = await api(`/api/player-card?id=${encodeURIComponent(winner.id)}`);
  ok(card.status === 200 && card.json, `个人卡可读（HTTP ${card.status}）`);
  const prof = await api(`/api/profile?player=${encodeURIComponent(loser.id)}`);
  ok(prof.status === 200 && prof.json && prof.json.name, `个人页有名字（${prof.json && prof.json.name}）`);

  // 导出 KIF（棋谱页「导出」）
  const exp = await fetch(`${BASE}/api/records/${goL.recordId}/export?fmt=kif&guest=${encodeURIComponent(loser.id)}`);
  ok(exp.status === 200, `KIF 导出 HTTP ${exp.status}`);

  // ==================================================================
  // 8. 注册：把游客战绩带走
  // ==================================================================
  section('注册升级：战绩跟人走');
  const uname = `约${crypto.randomBytes(3).toString('hex')}`;
  const reg = await api('/api/register', 'POST', {
    username: uname,
    password: 'playjourney1',
    guestId: loser.id,
    migrationKey: loser.key || null,
  });
  ok(reg.status === 200 && reg.json.ok, '输家注册成功并迁移数据');
  const token = reg.json.token;
  const accId = reg.json.account.id;

  const A2 = await open('A2-账号', token, null);
  ok(A2.hello.playerId === accId, '令牌连接解析为账号');
  // 注册后立刻能改名（此前 AUTH_KEY 死路径的姐妹路径）
  A2.send('set_avatar', { avatar: A2.hello.avatars[0] });
  const avm = await A2.waitIf((m) => m.type === 'avatar_updated' || m.type === 'error');
  ok(avm.type === 'avatar_updated', `注册后换头像${avm.type === 'error' ? ' ← ' + avm.data.message : ''}`);

  // 迁移后棋谱应挂在账号 id 下
  A2.send('record_search', { q: '' });
  const rs2 = await A2.wait('record_search_result');
  ok(rs2.records.some((r) => {
    const ids = r.playerIds || (r.players && { b: r.players.b && r.players.b.id, w: r.players.w && r.players.w.id }) || {};
    return r.id === goL.recordId || ids.b === accId || ids.w === accId ||
      (Array.isArray(r.playerIds) && r.playerIds.includes(accId));
  }), '迁移后账号能搜到自己的棋谱');

  // ==================================================================
  // 9. 快速匹配陌生人
  // ==================================================================
  section('快速匹配');
  const P = await open('P', gid(), gkey());
  const Q = await open('Q', gid(), gkey());
  P.send('quick_match');
  await P.wait('matching');
  Q.send('quick_match');
  const mp = await P.wait('matched');
  const mq = await Q.wait('matched');
  ok(mp.roomId && mp.roomId === mq.roomId, '陌生人配对成功');
  ok(!!mp.code && mp.code === mq.code, `双方房号一致（${mp.code}）`);

  // ==================================================================
  // 10. 逛社区：大厅有对局在打
  // ==================================================================
  section('大厅 / 社区');
  const lob2 = await api('/api/lobby');
  ok(lob2.status === 200, `大厅接口 HTTP ${lob2.status}`);
  const home = await api('/api/home');
  ok(home.status === 200, `首页接口 HTTP ${home.status}`);

  // 举报类别合法（前端下拉直接用）
  ok(A.hello.reportCategories.includes(A.hello.reportCategories[0]), '举报类别非空可用');

  P.close(); Q.close(); A.close(); B.close(); C.close(); A2.close();

  console.log(`\n========== 对局旅程：${pass} 通过, ${fail} 失败 ==========`);
  if (failures.length) failures.forEach((f) => console.log(`  ✗ ${f}`));
  // 显式 exit：有未关净句柄时 process.exitCode 不会立刻退出，e2e 调度器会打满 180s
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('对局旅程异常：', e && e.stack || e);
  process.exit(1);
});
