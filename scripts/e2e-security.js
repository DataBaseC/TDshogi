/**
 * e2e-security.js — 安全边界端到端回归（2026-09-21 审查 P0/P1 的"转正用例"）
 *
 * 覆盖三件**只能在真进程上验**的事：
 *  1. **P0-1 崩溃向量**：多字节签名令牌 / 畸形 Host 头 —— 请求可以被拒，
 *     但**进程必须活着**（原先这两条都能一条命令打崩全站）。
 *  2. **P0-4 棋谱越权（IDOR）**：凭**公开的账号 id** 不能读/写他人棋谱，
 *     而**带令牌**的本人必须照常可用（正向对照，别把功能一起关掉）。
 *  3. **P0-3 迁移劫持**：拿别人的账号 id 当 guestId 注册，受害者数据不能被搬走。
 *
 * ⚠️ 由 `npm run e2e` 统一拉起隔离实例（带 ADMIN_PASSWORD=admin123），一般不必手动跑。
 */
'use strict';

const crypto = require('crypto');
const net = require('net');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 3999);
const BASE = `http://localhost:${PORT}`;
const HOST = `ws://localhost:${PORT}`;

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); }
}
const T = (ms) => new Promise((r) => setTimeout(r, ms));
const hex24 = () => crypto.randomBytes(12).toString('hex');

/** 极简 WS 客户端（只用到本脚本需要的几个动作） */
function client(name) {
  const c = { name, msgs: [], listeners: [] };
  c.connect = (identity) => new Promise((res, rej) => {
    c.ws = new WebSocket(`${HOST}/ws?guest=${encodeURIComponent(identity || c.guestId)}`);
    c.ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (_) { return; }
      c.msgs.push(m);
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
  c.close = () => { try { c.ws.close(); } catch (_) { /* 忽略 */ } };
  return c;
}

/** 原始 TCP 发一次 WS 握手，可自定义 Host 头（`ws` 客户端不方便造畸形 Host） */
function rawHandshake(hostHeader) {
  return new Promise((resolve) => {
    const s = net.connect(PORT, '127.0.0.1', () => {
      s.write('GET /ws?guest=aa HTTP/1.1\r\n'
        + `Host: ${hostHeader}\r\n`
        + 'Upgrade: websocket\r\nConnection: Upgrade\r\n'
        + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    let buf = '';
    const done = () => { try { s.destroy(); } catch (_) { /* 忽略 */ } resolve(buf); };
    s.on('data', (d) => { buf += d.toString(); });
    s.on('close', done);
    s.on('error', done);
    setTimeout(done, 2000);
  });
}

const alive = async () => {
  try {
    const r = await fetch(`${BASE}/api/home`);
    return r.status === 200;
  } catch (_) { return false; }
};

async function main() {
  console.log('=== 安全边界回归 ===');

  // ==================================================================
  console.log('\n--- P0-1 崩溃向量：请求可拒，进程必须活着 ---');
  // ==================================================================
  ok(await alive(), '起始状态：服务在跑');

  // 向量一：签名段 32 个 emoji（UTF-16 长度 64 == 期望签名长度，但 UTF-8 字节数 128）
  const evilToken = `aa.${Date.now()}.${'😀'.repeat(32)}`;
  const badWs = new WebSocket(`${HOST}/ws?guest=${encodeURIComponent(evilToken)}`);
  const badResult = await new Promise((resolve) => {
    const done = (r) => resolve(r);
    badWs.on('open', () => done('open'));
    badWs.on('error', () => done('rejected'));
    setTimeout(() => done('timeout'), 2500);
  });
  try { badWs.close(); } catch (_) { /* 忽略 */ }
  // ⚠️ **不要求"连接被拒"**：令牌解析失败会退化成游客身份（现状设计），连接照样能开。
  // 这条用例真正要验的是**进程活着** —— 旧实现在这一步直接抛 RangeError 退出。
  ok(badResult !== 'timeout', `多字节签名令牌有了明确结果（${badResult}），没把服务挂住`);
  await T(300);
  ok(await alive(), '**进程存活**（原先这里已因 RangeError 退出）');

  // 向量二：畸形 Host 头
  const resp = await rawHandshake('a b');
  const firstLine = (resp.split('\r\n')[0] || '(无响应)').slice(0, 46);
  // ⚠️ 同样**不要求"升级失败"**：改成固定基地址后 Host 已无影响力，握手正常成功才是预期 ——
  // 这正是修复意图（Host 只用来凑基地址）。要验的是"有响应且进程活着"。
  ok(resp.length > 0, `畸形 Host 的握手有响应（${firstLine}）`);
  await T(300);
  ok(await alive(), '**进程存活**（原先 new URL 抛 ERR_INVALID_URL → 退出）');

  // 正向对照：正常连接照常可用
  const normal = client('Normal');
  normal.guestId = hex24();
  await normal.connect();
  const hello = await normal.wait('hello');
  ok(!!hello.playerId, `正常 WS 握手仍然可用（playerId=${String(hello.playerId).slice(0, 8)}…）`);
  normal.close();

  // ==================================================================
  console.log('\n--- P0-3 迁移劫持：拿别人账号 id 注册，数据不能被搬走 ---');
  // ==================================================================
  const victim = await (await fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `sec${Date.now().toString(36).slice(-6)}v`, password: 'test1234' }),
  })).json();
  ok(victim.ok, '受害者账号注册成功');
  const victimId = victim.account.id;
  const victimBefore = await (await fetch(`${BASE}/api/profile?player=${victimId}`)).json();

  const attacker = await (await fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: `sec${Date.now().toString(36).slice(-6)}a`, password: 'test1234', guestId: victimId,
    }),
  })).json();
  ok(attacker.ok, '攻击者注册成功（只是拒绝迁移）');
  const victimAfter = await (await fetch(`${BASE}/api/profile?player=${victimId}`)).json();
  ok(victimAfter.name === victimBefore.name && victimAfter.profile.rating === victimBefore.profile.rating,
    `受害者资料未被搬走（${victimAfter.name} / ${victimAfter.profile.rating}）`);
  ok(attacker.account.id !== victimId, '攻击者拿到的是自己的 id');

  // ==================================================================
  console.log('\n--- P0-4 棋谱越权：公开账号 id 不能当凭证，令牌必须能用 ---');
  // ==================================================================
  // 让受害者账号打一局（账号侧的 guest 参数是**会话令牌**），产生一条私有棋谱
  const vicWs = client('Victim');
  await vicWs.connect(victim.token);
  const vHello = await vicWs.wait('hello');
  ok(vHello.playerId === victimId, '账号连线后 playerId 解析为 accountId');

  const opp = client('Opp');
  opp.guestId = hex24();
  await opp.connect();
  await opp.wait('hello');
  vicWs.send('create_room', { timeControl: '10:00' });
  const room = await vicWs.wait('room_created');
  opp.send('join_room', { code: room.code });
  await vicWs.wait('game_start');
  await opp.wait('game_start');
  await T(300);
  opp.send('resign', {});            // 对手认输 → 本局落盘
  await vicWs.wait('game_over');
  await T(800);

  const prof = await (await fetch(`${BASE}/api/profile?player=${victimId}`)).json();
  const recId = prof.records && prof.records[0] && prof.records[0].id;
  ok(!!recId, `受害者有了棋谱（${String(recId).slice(0, 10)}…）`);

  const code = async (url, opts) => (await fetch(url, opts)).status;
  const idPart = encodeURIComponent(victimId);          // 公开的账号 id
  const tokPart = encodeURIComponent(victim.token);     // 本人令牌
  // ⚠️ "无关"要真的是无关：`opp` 是**这局的对手**，他是谱主之一，本就该能看（别拿他当越权样本）。
  const bystander = hex24();
  ok(await code(`${BASE}/api/records/${recId}/review?guest=${idPart}`) === 403,
    '**凭公开账号 id 复盘他人棋谱 → 403**（原先 200）');
  ok(await code(`${BASE}/api/records/${recId}/export?fmt=kif&guest=${idPart}`) === 403,
    '凭公开账号 id 导出 → 403');
  ok(await code(`${BASE}/api/records/${recId}/review?guest=${bystander}`) === 403,
    '凭无关游客 id 复盘 → 403');
  ok(await code(`${BASE}/api/records/${recId}/comment`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guest: victimId, moveNo: 1, text: '伪造评论' }),
  }) === 403, '凭公开账号 id 写评论 → 403（原先会以受害者名义落盘）');
  ok(await code(`${BASE}/api/records/${recId}/bookmark`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guest: victimId, moveNo: 1, on: true }),
  }) === 403, '凭公开账号 id 改书签 → 403');
  ok(await code(`${BASE}/api/records/${recId}/variation`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guest: victimId, parent: 0, move: '7g7f' }),
  }) === 403, '凭公开账号 id 加变着 → 403');

  // 正向对照：本人令牌必须照常可用（别把功能一起关掉）
  ok(await code(`${BASE}/api/records/${recId}/review?guest=${tokPart}`) === 200,
    '**本人令牌复盘自己的棋谱 → 200**（正向对照）');
  ok(await code(`${BASE}/api/records/${recId}/export?fmt=kif&guest=${tokPart}`) === 200,
    '本人令牌导出 → 200');
  // 对手（本局的另一位参与者）本就该能看 —— 顺带证明上面的 403 是"越权被拦"而不是"接口全关"
  ok(await code(`${BASE}/api/records/${recId}/review?guest=${encodeURIComponent(opp.guestId)}`) === 200,
    '对局对手（谱主之一）仍可复盘 → 200');
  vicWs.close();
  opp.close();

  // ==================================================================
  console.log('\n--- P1-4 后台入口门禁：百分号编码变形不能绕过 ---');
  // ==================================================================
  const entryKey = process.env.ADMIN_ENTRY_KEY || 'e2e-entry-key';
  ok(await code(`${BASE}/%61dmin.html`) === 404, '/%61dmin.html 无 key → 404（原先 200，门禁形同虚设）');
  ok(await code(`${BASE}/admin.html`) === 404, '/admin.html 无 key → 404');
  ok(await code(`${BASE}/admin.html?k=${encodeURIComponent(entryKey)}`) === 200, '带对 key → 200');
  ok(await code(`${BASE}/index.html`) === 200, '其它页面不受影响');

  console.log(`\n========== 安全回归：${pass} 通过, ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('异常: ' + e.message); process.exit(1); });
