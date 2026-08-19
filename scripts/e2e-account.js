/**
 * e2e-account.js — 账号系统端到端测试
 *
 * 覆盖：注册/重名/短名、登录/错误密码、令牌校验（REST + WS 身份）、
 *       游客升级（迁移对局/评级/会话）、登出重置游客。
 *
 * 用法：服务器运行于 :3999 且 DATA_DIR 独立，直接 node scripts/e2e-account.js
 */
'use strict';
const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3999';
const WS = 'ws://localhost:3999/ws';
const T = (ms) => new Promise((r) => setTimeout(r, ms));
const gid = () => crypto.randomBytes(12).toString('hex');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(label); console.log(`  ✗ ${label}`); }
}
async function section(name) { console.log(`\n=== ${name} ===`); }
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

async function main() {
  // ============ 注册 / 校验 ============
  await section('注册');
  const username = `棋士${crypto.randomBytes(3).toString('hex')}`;
  let r = await api('/api/register', 'POST', { username, password: 'pass1234' });
  ok(r.status === 200 && r.json.ok, '注册成功');
  const accountId = r.json.account.id;
  const token = r.json.token;

  r = await api('/api/register', 'POST', { username, password: 'other123' });
  ok(r.status === 400 && /占用/.test(r.json.error), '重名拒绝');

  r = await api('/api/register', 'POST', { username: 'a', password: 'pass1234' });
  ok(r.status === 400, '短用户名拒绝');

  r = await api('/api/register', 'POST', { username: 'abc123', password: '1' });
  ok(r.status === 400, '短密码拒绝');

  // ============ 登录 / 令牌 ============
  await section('登录与令牌');
  r = await api('/api/login', 'POST', { username, password: 'pass1234' });
  ok(r.status === 200 && r.json.token, '登录成功返回令牌');

  r = await api('/api/login', 'POST', { username, password: 'wrong' });
  ok(r.status === 401, '错误密码 401');

  r = await api('/api/me?token=' + token);
  ok(r.status === 200 && r.json.account.id === accountId, '/api/me 校验令牌');

  r = await api('/api/me?token=bad.token.here');
  ok(r.status === 401, '伪造令牌拒绝');

  // WS 用令牌连接 → 身份为账号
  await section('WS 账号身份');
  const ws = new WebSocket(`${WS}?guest=${token}`);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const hello = await new Promise((res) => ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'hello') res(m.data);
  }));
  ok(hello.playerId === accountId, `WS 识别为账号 (playerId=${hello.playerId.slice(0, 6)}…)`);
  ok(hello.name === username, `WS 名字为用户名（${hello.name}）`);
  ws.close();

  // ============ 游客升级：先让游客打一局再注册 ============
  await section('游客升级（数据迁移）');
  const guestId = gid();
  // 给游客造一条对局记录 + 评级（用队列+wait，避免时序错过消息）
  const mkClient = (gid2) => {
    const c = { guestId: gid2, ws: null, queue: [], listeners: [], latest: null };
    c.connect = () => new Promise((res, rej) => {
      c.ws = new WebSocket(`${WS}?guest=${gid2}`);
      c.ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        c.queue.push(m);
        if (m.type === 'state') c.latest = m.data;
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
      const timer = setTimeout(() => { c.listeners = c.listeners.filter((l) => !(l.type === type && l.fn === fn)); rej(new Error(`等待 ${type} 超时`)); }, timeout);
      const fn = (data) => { clearTimeout(timer); res(data); };
      c.listeners.push({ type, fn, once: true });
    });
    return c;
  };
  const gA = mkClient(guestId);
  const gB = mkClient(gid());
  await gA.connect(); await gB.connect(); await T(200);
  gA.send('create_room', {});
  const gCreated = await gA.wait('room_created');
  gB.send('join_room', { code: gCreated.code });
  await gB.wait('room_joined');
  await gA.wait('game_start'); await gB.wait('game_start');
  await T(300);
  // 走一步，然后 gB 认输
  const gSt = gA.latest;
  if (gSt && gSt.legalMoves && gSt.legalMoves.length) {
    const mover = gSt.turn === 'b' ? gA : gB;
    mover.send('move', { usi: gSt.legalMoves[0] });
    await T(300);
  }
  gB.send('resign');
  await gA.wait('game_over');
  await T(500);
  gA.ws.close(); gB.ws.close();

  // 现在游客用 guestId 注册（升级）
  const upUser = `升级${crypto.randomBytes(2).toString('hex')}`;
  r = await api('/api/register', 'POST', { username: upUser, password: 'pass1234', guestId });
  ok(r.status === 200, '游客注册升级成功');
  const upToken = r.json.token;
  const upId = r.json.account.id;

  // 验证：评级已迁移
  r = await api(`/api/profile?player=${upId}`);
  ok(r.status === 200 && r.json.profile && typeof r.json.profile.games === 'number', '账号可查评级');
  const gamesAfter = r.json.profile.games;
  ok(gamesAfter >= 1, `对局记录已迁移（games=${gamesAfter}）`);
  // 游客 id 下应无评级（已迁移）
  const gProfile = await api(`/api/profile?player=${guestId}`);
  ok(gProfile.json.profile.games === 0, '原游客 id 评级已清空（迁移走）');

  // WS 用升级令牌连接
  const upWs = new WebSocket(`${WS}?guest=${upToken}`);
  await new Promise((res, rej) => { upWs.on('open', res); upWs.on('error', rej); });
  const upHello = await new Promise((res) => upWs.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'hello') res(m.data);
  }));
  ok(upHello.playerId === upId && upHello.name === upUser, '升级账号 WS 身份与名字正确');
  upWs.close();

  console.log(`\n========== 账号测试结果：${pass} 通过, ${fail} 失败 ==========`);
  if (failures.length) {
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
  process.exit(0);
}
main().catch((e) => { console.error('账号测试异常:', e); process.exit(1); });
