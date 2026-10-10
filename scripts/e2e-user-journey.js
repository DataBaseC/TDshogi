/**
 * e2e-user-journey.js — 正常用户全链路（2026-09-28 用户实测踩坑后补）
 *
 * 按「真人会做的事」串起来，而不是单点接口：
 *   游客进站 → 改名/换头像 → 注册升级 → 注册后立刻改资料 → 登出再登录 → 再改资料
 *
 * 钉死的回归（用户报「注册完了之后提示身份校验失败」）：
 *   游客持有证明（secret）**不得**在升级后残留到账号会话上——
 *   账号连接层刻意不传 key（player.key=null），secret 一留，改名/换头像必进 AUTH_KEY。
 *
 * 用法：服务器 :3999（ADMIN_PASSWORD=admin123）后 `PORT=3999 node scripts/e2e-user-journey.js`。
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

/** 打开 WS 并等 hello（监听必须先挂，见 e2e-account.js 的说明） */
function connect(id, key) {
  return new Promise((resolve, reject) => {
    const qs = [`guest=${encodeURIComponent(id)}`];
    if (key) qs.push(`key=${encodeURIComponent(key)}`);
    const ws = new WebSocket(`${WS}?${qs.join('&')}`);
    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} reject(new Error('hello 超时')); }, 5000);
    const inbox = [];
    const waiters = [];
    ws.on('message', (raw) => {
      let m = null;
      try { m = JSON.parse(raw.toString()); } catch (_) { return; }
      if (!m) return;
      inbox.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].match(m)) {
          const w = waiters.splice(i, 1)[0];
          clearTimeout(w.timer);
          w.resolve(m);
        }
      }
      if (m.type === 'hello') {
        clearTimeout(timer);
        resolve({
          ws,
          hello: m.data,
          send: (type, data) => ws.send(JSON.stringify({ type, data: data || {} })),
          /** 等一条匹配消息（已在收件箱则立刻返回） */
          wait(match, timeoutMs = 4000) {
            const hit = inbox.find(match);
            if (hit) return Promise.resolve(hit);
            return new Promise((res, rej) => {
              const t = setTimeout(() => rej(new Error('等待消息超时')), timeoutMs);
              waiters.push({ match, resolve: res, timer: t });
            });
          },
          close: () => { try { ws.close(); } catch (_) {} },
        });
      }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

async function main() {
  // ==================================================================
  // 1. 新游客：进站就能改名、换头像
  // ==================================================================
  section('新游客进站');
  const g1 = gid();
  const k1 = gkey();
  const a = await connect(g1, k1);
  ok(a.hello && a.hello.playerId === g1, 'hello 返回游客身份');
  ok(!!a.hello.avatars && a.hello.avatars.length > 0, 'hello 带头像白名单');

  a.send('rename', { name: '测试棋士' });
  const rn1 = await a.wait((m) => m.type === 'renamed' || m.type === 'error');
  ok(rn1.type === 'renamed' && rn1.data.name === '测试棋士',
    `游客改名成功（带 key）${rn1.type === 'error' ? ' ← ' + rn1.data.message : ''}`);

  const av1 = a.hello.avatars[1] || a.hello.avatars[0];
  a.send('set_avatar', { avatar: av1 });
  const avm1 = await a.wait((m) => m.type === 'avatar_updated' || m.type === 'error');
  ok(avm1.type === 'avatar_updated' && avm1.data.avatar === av1,
    `游客换头像成功（带 key）${avm1.type === 'error' ? ' ← ' + avm1.data.message : ''}`);

  // 错 key 不得接管原身份（P0-1，2026-10-02）：握手校验持有证明失败 → 按**新游客**处理，
  // 而不是「还挂原 id、只在改名时报 AUTH_KEY」。后者仍会把观战/对局算到原 id 头上。
  const g1b = g1;
  const bad = await connect(g1b, gkey()); // 换一把 key
  ok(bad.hello && bad.hello.playerId !== g1,
    `错 key 不得接管原游客身份（P0-1）${bad.hello ? ' 实际=' + bad.hello.playerId : ''}`);
  bad.send('rename', { name: '冒名顶替' });
  const badM = await bad.wait((m) => m.type === 'renamed' || m.type === 'error');
  // 新游客可以改自己的名，但绝不能改到原身份上
  ok(badM.type === 'renamed' && bad.hello.playerId !== g1,
    '错 key 连接只能操作新身份，不能冒名改原游客');
  bad.close();
  // 原身份未被冒名改掉：本人再改一次名仍然成功
  a.send('rename', { name: '测试棋士·其二' });
  const rn1b = await a.wait((m) => m.type === 'renamed' && m.data.name === '测试棋士·其二');
  ok(rn1b.type === 'renamed', '原游客会话未被错 key 踩掉，本人仍可改名');

  // ==================================================================
  // 2. 注册升级（用户报的死路径：注册后改名/换头像报身份校验失败）
  // ==================================================================
  section('注册升级（游客 → 账号）');
  const username = `旅${crypto.randomBytes(3).toString('hex')}`;
  const reg = await api('/api/register', 'POST', {
    username,
    password: 'journey123',
    guestId: g1,
    migrationKey: k1,
  });
  ok(reg.status === 200 && reg.json.ok, '游客携带数据注册成功');
  const token = reg.json.token;
  const accountId = reg.json.account.id;

  // 模拟前端 applySession：guest.id 换成令牌（key 可丢——账号不靠持有证明）
  const b = await connect(token, null);
  ok(b.hello && b.hello.playerId === accountId, '令牌连接解析为账号 id');

  // ★ 注册后立刻改名 —— 此前必挂
  b.send('rename', { name: '升级后改名' });
  const rn2 = await b.wait((m) => m.type === 'renamed' || m.type === 'error');
  ok(rn2.type === 'renamed' && rn2.data.name === '升级后改名',
    `注册后改名成功（此前报 AUTH_KEY）${rn2.type === 'error' ? ' ← ' + rn2.data.message : ''}`);

  // ★ 注册后立刻换头像 —— 此前必挂
  const av2 = a.hello.avatars[2] || av1;
  b.send('set_avatar', { avatar: av2 });
  const avm2 = await b.wait((m) => m.type === 'avatar_updated' || m.type === 'error');
  ok(avm2.type === 'avatar_updated' && avm2.data.avatar === av2,
    `注册后换头像成功（此前报 AUTH_KEY）${avm2.type === 'error' ? ' ← ' + avm2.data.message : ''}`);

  // 令牌有效、个人资料可写
  const me = await api(`/api/me?token=${encodeURIComponent(token)}`);
  ok(me.status === 200 && me.json.account && me.json.account.id === accountId, '/api/me 令牌有效');
  const prof = await api('/api/account/profile', 'POST', {
    token, phone: '', style: '力战型',
  });
  ok(prof.status === 200 && prof.json.ok && prof.json.profile.style === '力战型', '注册后保存棋风资料');

  // ==================================================================
  // 3. 登出 → 以账号登录 → 再改资料（另一台设备/清缓存后的路径）
  // ==================================================================
  section('账号登录后继续操作');
  const lg = await api('/api/login', 'POST', { username, password: 'journey123' });
  ok(lg.status === 200 && lg.json.ok, '账号密码登录成功');
  const token2 = lg.json.token;

  const c = await connect(token2, null);
  ok(c.hello && c.hello.playerId === accountId, '登录令牌连接到同一账号');
  c.send('set_avatar', { avatar: av1 });
  const avm3 = await c.wait((m) => m.type === 'avatar_updated' || m.type === 'error');
  ok(avm3.type === 'avatar_updated', `登录后换头像成功${avm3.type === 'error' ? ' ← ' + avm3.data.message : ''}`);
  c.send('rename', { name: '再改一名' });
  const rn3 = await c.wait((m) => m.type === 'renamed' || m.type === 'error');
  ok(rn3.type === 'renamed', `登录后改名成功${rn3.type === 'error' ? ' ← ' + rn3.data.message : ''}`);

  // ==================================================================
  // 4. 注册/登录错误要有明确文案（配合 UI.alert）
  // ==================================================================
  section('错误文案（给弹窗用）');
  let e1 = await api('/api/register', 'POST', { username: 'x', password: 'journey123' });
  ok(e1.status === 400 && e1.json && e1.json.error, `短用户名有 error 文案：${e1.json && e1.json.error}`);
  e1 = await api('/api/register', 'POST', { username: uname(), password: '1234' });
  ok(e1.status === 400 && /8/.test(e1.json.error || ''), `短密码有 error 文案：${e1.json && e1.json.error}`);
  e1 = await api('/api/register', 'POST', { username, password: 'other9999' });
  ok(e1.status === 400 && /占用/.test(e1.json.error || ''), `重名有 error 文案：${e1.json && e1.json.error}`);
  e1 = await api('/api/login', 'POST', { username, password: 'wrong999' });
  ok(e1.status === 401 && e1.json && e1.json.error, `错密码有 error 文案：${e1.json && e1.json.error}`);

  // ==================================================================
  // 5. 跨身份隔离：别人不能改我的名
  // ==================================================================
  section('跨身份隔离');
  const g2 = gid();
  const k2 = gkey();
  const d = await connect(g2, k2);
  // 冒用公开 id + 自己的 key 改名 —— 服务端按连接身份，只改自己
  d.send('rename', { name: '路人乙' });
  await d.wait((m) => m.type === 'renamed' || m.type === 'error');
  const who = await api(`/api/profile?player=${encodeURIComponent(accountId)}`);
  // profileData 形状：{ name, profile, records, avatar, honors }
  const theirName = who.json && who.json.name;
  ok(theirName === '再改一名', `路人不能改我的显示名（当前=${theirName}）`);

  a.close(); b.close(); c.close(); d.close();
  console.log(`\n========== 用户全链路：${pass} 通过, ${fail} 失败 ==========`);
  if (failures.length) failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(fail ? 1 : 0);
}

function uname() {
  return `u${crypto.randomBytes(4).toString('hex')}`;
}

main().catch((e) => {
  console.error('用户链路异常：', e && e.stack || e);
  process.exitCode = 1;
});
