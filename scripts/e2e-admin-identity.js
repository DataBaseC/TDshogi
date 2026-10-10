/**
 * e2e-admin-identity.js — 管理端「用户身份」端到端回归（Bug3，2026-09-27 外包项）
 *
 * 锁定两件事：
 *  1. **幽灵游客会话消除**：游客升级账号后，管理端用户列表里这个人**只出现一条**
 *    （账号），旧游客 id 不再作为独立用户出现——否则管理端会出现「同人两条」，
 *    且管理到残影 id 会报「用户不存在」。
 *  2. **管理操作不受 id 形态影响**：用户详情/改名对 **24 hex 账号 id** 与
 *    **账号会话令牌**（`<accountId>.<ts>.<sig>`）都能成功；后者走 http 层
 *    `resolvePlayer` 归一化，杜绝「令牌当 id → 用户不存在」。
 *
 * 用法：服务器运行于 :3999（ADMIN_PASSWORD=admin123）后 `PORT=3999 node scripts/e2e-admin-identity.js`。
 */
'use strict';

const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 3999);
const BASE = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}/ws`;
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'admin123';
const hex24 = () => crypto.randomBytes(12).toString('hex');
const T = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0; let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); }
}

async function adminToken() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}?guest=${hex24()}`);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'admin_login', data: { password: ADMIN_PW } })));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (_) { return; }
      if (m.type === 'admin_logged_in') { resolve(m.data.token); ws.close(); }
      else if (m.type === 'error') { reject(new Error(m.data && m.data.message)); }
    });
    ws.on('error', reject);
  });
}

async function main() {
  console.log('=== 管理端用户身份（Bug3）===');

  // ---- 准备：游客建会话 → 用该 guestId 注册账号 ----
  const guestId = hex24();
  const gws = new WebSocket(`${WS}?guest=${guestId}`);
  await new Promise((r, j) => { gws.on('open', r); gws.on('error', j); });
  await T(150);

  const username = `idtest${Date.now().toString(36).slice(-6)}`;
  const reg = await (await fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'test1234', guestId }),
  })).json();
  ok(reg.ok === true && !!reg.account.id, '注册成功并拿到账号 id');
  const accountId = reg.account.id;
  const token = reg.token;

  const token2 = await adminToken();
  ok(!!token2, '管理员登录成功');
  const aj = { 'Content-Type': 'application/json', 'x-admin-token': token2 };

  // ---- ① 幽灵会话消除：列表里同人只有账号一条 ----
  const users = await (await fetch(`${BASE}/api/admin/users?token=${encodeURIComponent(token2)}`)).json();
  const list = users.users || [];
  const byGuest = list.find((u) => u.id === guestId);
  const byAccount = list.find((u) => u.id === accountId);
  ok(!byGuest, '旧游客 id 不再出现在管理端用户列表（幽灵会话已清）');
  ok(!!byAccount && byAccount.isAccount === true, '账号出现在管理端用户列表');

  // ---- ② 用户详情：账号 id 与令牌两种形态都应可读 ----
  const d1 = await fetch(`${BASE}/api/admin/users/${accountId}?token=${encodeURIComponent(token2)}`);
  ok(d1.status === 200, '按 24 hex 账号 id 读用户详情 → 200');
  const d2 = await fetch(`${BASE}/api/admin/users/${encodeURIComponent(token)}?token=${encodeURIComponent(token2)}`);
  ok(d2.status === 200, '按账号令牌读用户详情 → 200（走 resolvePlayer 归一化）');

  // ---- ③ 改名：账号 id 与令牌两种形态都应成功 ----
  const r1 = await (await fetch(`${BASE}/api/admin/users/${accountId}/rename`, {
    method: 'POST', headers: aj, body: JSON.stringify({ name: '改名甲' }),
  })).json();
  ok(r1.ok === true, `按账号 id 改名成功（${r1.name || r1.error}）`);
  const r2 = await (await fetch(`${BASE}/api/admin/users/${encodeURIComponent(token)}/rename`, {
    method: 'POST', headers: aj, body: JSON.stringify({ name: '改名乙' }),
  })).json();
  ok(r2.ok === true && r2.name === '改名乙', `按令牌改名成功（${r2.name || r2.error}）`);

  // ---- ④ 封禁/解封（同样走两种形态）----
  const b1 = await (await fetch(`${BASE}/api/admin/users/${accountId}/ban`, {
    method: 'POST', headers: aj, body: JSON.stringify({ reason: 'e2e', days: 1 }),
  })).json();
  ok(b1.ok === true, `封禁成功（${b1.error || 'ok'}）`);
  const u1 = await (await fetch(`${BASE}/api/admin/users/${encodeURIComponent(token)}/unban`, {
    method: 'POST', headers: aj, body: '{}',
  })).json();
  ok(u1.ok === true, `解封成功（${u1.error || 'ok'}）`);

  // 先关干净 WS 再退出：process.exit() 时若还有活动句柄，Windows 上会触发
  // libuv 断言崩溃（退出码非 0），e2e-all 会把「断言全过」的脚本判成未通过。
  await new Promise((r) => {
    const done = () => r();
    gws.once('close', done);
    try { gws.close(); } catch (_) { done(); }
    setTimeout(done, 500);
  });

  console.log(`\n========== 管理端身份：${pass} 通过, ${fail} 失败 ==========`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => {
  console.error('运行异常：', e && e.stack || e);
  process.exitCode = 1;
});
