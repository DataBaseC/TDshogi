/**
 * e2e-player-features.js — 玩家侧功能端到端验证（2026-09-20 一批）
 *
 * 覆盖四件事，都是**只能端到端验**的（跨 WS / REST / 房间状态三处）：
 *  1. **等级特权**：Lv.0 建赛被服务端拒绝 → 管理员提等级后放行；
 *  2. **头像**：`set_avatar` 走会话文件（游客也能换）、白名单校验、状态里带得出去；
 *  3. **举报**：`report` 提交 + 去重 + 管理端查询与处理；
 *  4. **选手脱离页面的聊天区状态提示**：掉线 / 重连各播报一条系统消息。
 *
 * ⚠️ 起服务必须带 `ADMIN_PASSWORD=admin123`（用这个口令登录管理员）；
 *    本脚本由 `npm run e2e` 统一拉起隔离实例，一般不必手动跑。
 */
'use strict';

const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3999);
const BASE = `http://localhost:${PORT}`;
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

function mkClient(name, guestId) {
  const c = { name, guestId: guestId || gid(), ws: null, msgs: [], listeners: [], state: null };
  /** @param {string} [identity] 传账号会话令牌即以该账号身份连接（游客则留空） */
  c.connect = (identity) => new Promise((res, rej) => {
    c.ws = new WebSocket(`${HOST}?guest=${encodeURIComponent(identity || c.guestId)}`);
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
  /**
   * 等某类消息（**会先翻队列里的旧消息**）。
   * 只适合 `hello` 这类"连上就该来"的一次性消息。
   */
  c.wait = (type, ms = 4000) => new Promise((resolve, reject) => {
    const hit = c.msgs.filter((m) => m.type === type).pop();
    if (hit) return resolve(hit.data);
    const timer = setTimeout(() => reject(new Error(`${name} 等 ${type} 超时`)), ms);
    const fn = (data) => { clearTimeout(timer); resolve(data); };
    c.listeners.push({ type, fn, once: true });
  });
  /**
   * 只认**调用之后**到达的消息。
   *
   * ⚠️ 断言"这次收到了 X"必须用它，不能用 `wait()`：`wait()` 会翻出队列里**旧的同类消息**
   * （例如先验"重复举报被拒"，再验"举报自己被拒"，后者会捞到前一条 `error` 而**假通过**——
   * 本脚本第一版就这么错了，两处断言实际验的是同一句话）。
   */
  c.waitNew = (type, ms = 4000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} 等新的 ${type} 超时`)), ms);
    const fn = (data) => { clearTimeout(timer); resolve(data); };
    c.listeners.push({ type, fn, once: true });
  });
  /** 自某时刻起收到的、符合条件的 chat 消息（系统播报用） */
  c.chatsSince = (n, kind) => c.msgs.slice(n)
    .filter((m) => m.type === 'chat' && (!kind || m.data.kind === kind))
    .map((m) => m.data);
  c.close = () => { try { c.ws.close(); } catch (_) { /* 忽略 */ } };
  return c;
}

async function registerAccount(prefix) {
  const username = `${prefix}${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const r = await (await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'test1234' }),
  })).json();
  if (!r.ok) throw new Error('注册失败: ' + (r.error || ''));
  return r;
}

async function main() {
  console.log('=== 玩家侧功能验证 ===');

  const adminC = mkClient('Admin');
  await adminC.connect();
  adminC.send('admin_login', { password: 'admin123' });
  const adminTok = (await adminC.wait('admin_logged_in')).token;

  // ==================================================================
  await section('等级特权：建赛门槛');
  // ==================================================================
  const accA = await registerAccount('fa');
  // ⚠️ 账号连 WS 用的是**会话令牌**（含点号），服务端据此解析出 accountId；
  //    用 account.id 连会变成另一个游客身份，等级与建赛权限都对不上。
  const A = mkClient('A');
  await A.connect(accA.token);

  const hello = await A.wait('hello');
  // ⚠️ 不能断言"恰好 Lv.0"：连上就发**每日登录经验**（`addExp(..., 'daily-login')`），
  //    新账号首连就升到 Lv.1。这里要验的是"低于建赛门槛"。
  ok(hello.level < 5, `新账号等级低于门槛（Lv.${hello.level}）`);
  ok(!!hello.privileges && hello.privileges.create_tournament.need === 5, 'hello 下发建赛门槛 need=5');
  ok(hello.privileges.create_tournament.ok === false, 'Lv.0 的建赛特权应为 false');

  A.send('create_tournament', { name: '等级不足赛', size: 4, reason: '这是一条足够长的举办理由用于验证门槛' });
  const gateErr = await A.waitNew('error');
  ok(/Lv\.5/.test(gateErr.message || ''), `Lv.0 建赛被拒且提示门槛（${gateErr.message}）`);

  // 管理员提等级后再试
  const grant = await (await fetch(`${BASE}/api/admin/users/${accA.account.id}/elo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminTok },
    body: JSON.stringify({ exp: 128 }),
  })).json();
  ok(grant.ok && grant.level >= 5, `管理员提等级成功（Lv.${grant.level}）`);

  A.send('create_tournament', { name: '等级达标赛', size: 4, reason: '这是一条足够长的举办理由用于验证门槛' });
  const created = await A.waitNew('tournament_created');
  ok(!!created.id, '提等级后可以建赛');

  // ==================================================================
  await section('头像：白名单、游客可用、状态里带得出去');
  // ==================================================================
  const G = mkClient('G');
  await G.connect();
  const gHello = await G.wait('hello');
  ok(!!gHello.avatar, `游客也默认有头像（${gHello.avatar}）`);
  ok(Array.isArray(gHello.avatars) && gHello.avatars.length >= 8, 'hello 下发头像白名单');

  G.send('set_avatar', { avatar: '🚀' }); // 不在白名单里
  const avErr = await G.waitNew('error');
  ok(/头像/.test(avErr.message || ''), `白名单外的头像被拒（${avErr.message}）`);

  G.msgs.length = 0;
  G.send('set_avatar', { avatar: gHello.avatars[0] });
  const avUpd = await G.waitNew('avatar_updated');
  ok(avUpd.avatar === gHello.avatars[0], '合法头像设置成功并回执');

  // ⚠️ 越权回归（2026-09-20 用户报「我可以更新其他玩家的头像」）：
  // 服务端只认**连接身份**——客户端硬塞 `targetId` 也必须改到自己头上。
  // 当时的实际症状是**界面误导**（前端把新字形画在了对方名字旁边的身份卡上），
  // 但"服务端不读 targetId"这条更该钉死：哪天有人改成读 `data.targetId`，就真越权了。
  const Z = mkClient('Z');
  await Z.connect();
  const zHello = await Z.wait('hello');
  Z.send('set_avatar', { avatar: zHello.avatars[1] });
  await Z.waitNew('avatar_updated');
  G.send('set_avatar', {
    avatar: zHello.avatars[2], targetId: zHello.playerId, playerId: zHello.playerId, id: zHello.playerId,
  });
  const mineAv = await G.waitNew('avatar_updated');
  ok(mineAv.avatar === zHello.avatars[2], '硬塞 targetId 时改的仍是**自己**（回执发给我）');
  const zProf = await (await fetch(`${BASE}/api/profile?player=${encodeURIComponent(zHello.playerId)}`)).json();
  ok(zProf.avatar === zHello.avatars[1], `被点名的人头像纹丝不动（${zProf.avatar}）`);

  // 个人页接口必须下发**被查看者**的头像：身份卡就是靠它画的，
  // 不下发时前端只能画自己的 → 看起来就像"我改了别人的头像"（同一条 bug 的另一半）
  // ⚠️ 比对的是 G **当前**的头像（上面那步"硬塞 targetId"已经把 G 自己改成了 avatars[2]），
  //    不是最初设的 avatars[0]——顺序写错就会得出"接口没下发"的假结论。
  const gProf = await (await fetch(`${BASE}/api/profile?player=${encodeURIComponent(gHello.playerId)}`)).json();
  ok(gProf.avatar === mineAv.avatar,
    `/api/profile 下发被查看者的头像（接口 ${gProf.avatar} / 实际 ${mineAv.avatar}）`);

  // ==================================================================
  await section('举报：提交 / 去重 / 管理端处理');
  // ==================================================================
  const victim = mkClient('Victim');
  await victim.connect();
  const vHello = await victim.wait('hello');

  G.msgs.length = 0;
  G.send('report', { targetId: vHello.playerId, category: 'cheat', detail: 'e2e 用例' });
  const reported = await G.waitNew('reported');
  ok(!!reported.id, '举报提交成功并返回 id');

  G.send('report', { targetId: vHello.playerId, category: 'abuse' });
  const dupErr = await G.waitNew('error');
  ok(/已举报过/.test(dupErr.message || ''), `同一目标重复举报被拒（${dupErr.message}）`);

  G.send('report', { targetId: gHello.playerId, category: 'cheat' });
  const selfErr = await G.waitNew('error');
  ok(/自己/.test(selfErr.message || ''), '举报自己被拒');

  // 类别校验要用**另一个目标**：同一目标会被上一层的去重先拦下，验不到类别分支
  G.send('report', { targetId: 'someone-else-id', category: 'not-a-category' });
  const catErr = await G.waitNew('error');
  ok(/类别/.test(catErr.message || ''), `未知类别被拒（${catErr.message}）`);

  const listRes = await (await fetch(`${BASE}/api/admin/reports?status=pending`, {
    headers: { 'x-admin-token': adminTok },
  })).json();
  const mine = (listRes.reports || []).find((r) => r.id === reported.id);
  ok(!!mine, '管理端能查到刚提交的举报');
  ok(mine && mine.targetName === vHello.name, '被举报人名字由服务端查会话写入（未被客户端伪造）');

  const decided = await (await fetch(`${BASE}/api/admin/reports/${encodeURIComponent(reported.id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminTok },
    body: JSON.stringify({ status: 'handled', note: 'e2e 处理' }),
  })).json();
  ok(decided.ok === true && decided.report.status === 'handled', '管理端可标记已处理');

  // ⚠️ `adminWrite` 的**失败**响应是 `HTTP 400 + {error}`，**不带 `ok` 字段**
  //    （只有成功才是 `{ok:true, ...}`）。所以这里判状态码，不能写 `body.ok === false`。
  const twiceRes = await fetch(`${BASE}/api/admin/reports/${encodeURIComponent(reported.id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminTok },
    body: JSON.stringify({ status: 'rejected' }),
  });
  const twice = await twiceRes.json();
  ok(twiceRes.status === 400 && /已处理过/.test(twice.error || ''),
    `已处理的举报不能再次处理（HTTP ${twiceRes.status}：${twice.error}）`);

  // ==================================================================
  await section('选手脱离页面：聊天区状态提示');
  // ==================================================================
  const P1 = mkClient('P1');
  const P2 = mkClient('P2');
  await P1.connect(); await P2.connect();
  P1.send('create_room', {});
  const room = await P1.wait('room_created');
  P2.send('join_room', { code: room.code });
  await P2.wait('room_joined');
  await P1.wait('game_start'); await P2.wait('game_start');
  await T(400);

  // P2 的对局状态里应带双方头像
  ok(!!(P1.state && P1.state.players && P1.state.players.b && 'avatar' in P1.state.players.b),
    '对局状态里带上双方头像字段');

  // 模拟"P2 关掉页面"（WS 断开）
  const beforeLeave = P1.msgs.length;
  P2.close();
  await T(700);
  const leaves = P1.chatsSince(beforeLeave, 'player-leave');
  ok(leaves.length === 1, `对手掉线时聊天区留痕（收到 ${leaves.length} 条）`);
  ok(leaves[0] && /已离开页面/.test(leaves[0].text || ''), `掉线提示文案正确（${leaves[0] && leaves[0].text}）`);
  // ⚠️ 座位要从 `state.seat` 推：**建房者不一定是先手**（本脚本里创建者拿到的是 `w`），
  //    把 'w' 写死会验错人（甚至验到自己）。
  const p1Seat = P1.state && P1.state.seat;
  const oppSeat = p1Seat === 'b' ? 'w' : 'b';
  ok(P1.state && P1.state.players[oppSeat] && P1.state.players[oppSeat].connected === false,
    `同时推送了断线状态（对手座位 ${oppSeat}）`);

  // P2 重连（同身份）
  const beforeReturn = P1.msgs.length;
  const P2b = mkClient('P2b', P2.guestId);
  await P2b.connect();
  P2b.send('request_state', {});
  await T(700);
  const returns = P1.chatsSince(beforeReturn, 'player-return');
  ok(returns.length === 1, `回归时聊天区留痕（收到 ${returns.length} 条）`);
  ok(returns[0] && /已回到对局/.test(returns[0].text || ''), `回归提示文案正确（${returns[0] && returns[0].text}）`);

  P1.close(); P2b.close(); G.close(); victim.close(); A.close(); adminC.close();
  await T(200);

  console.log(`\n========== 玩家侧功能：${pass} 通过, ${fail} 失败 ==========`);
  if (failures.length) failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('异常: ' + e.message); process.exit(1); });
