/**
 * test-records.js — 棋谱检索链路自检（PLAN §Q7 越权修复后）
 *
 * 验证三件事：
 *  1. WS `record_search` 能按**连接身份**查到自己的棋谱（功能等价于旧 REST 链路）
 *  2. REST `/api/records/search?player=<他人 id>` 对游客返回 **403**（不再能枚举他人棋谱）
 *  3. REST `/api/history?player=<任意 id>` 对游客返回 **403**（该出口已收归管理员专用）
 *
 * 流程：A 建房 → B 加入 → B 认输 → 对局落盘 → A 用 WS 检索自己的棋谱。
 * 用法：先起服（PORT 默认 3100），再 `node scripts/test-records.js`
 */
'use strict';
const WebSocket = require('ws');
const http = require('http');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const genId = () => { let s = ''; for (let i = 0; i < 24; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)]; return s; };

const PORT = process.env.PORT || 3100;
const WS_URL = `ws://localhost:${PORT}/ws?guest=`;

class C {
  constructor(id) { this.id = id; this.ws = null; this.inbox = []; this.waits = []; }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(WS_URL + this.id);
      this.ws.on('open', res);
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        this.inbox.push(m);
        this.waits = this.waits.filter((w) => !w(m));
      });
      this.ws.on('error', rej);
    });
  }
  send(t, d) { this.ws.send(JSON.stringify({ type: t, data: d })); }
  wait(t, ms = 4000) {
    return new Promise((r) => {
      const f = this.inbox.find((m) => m.type === t);
      if (f) return r(f);
      const tm = setTimeout(() => r(null), ms);
      this.waits.push((m) => { if (m.type === t) { clearTimeout(tm); r(m); return true; } return false; });
    });
  }
}

/** REST 请求，返回 { status, body }（不抛异常，便于断言状态码） */
function rest(path) {
  return new Promise((resolve) => {
    http.get(`http://localhost:${PORT}${path}`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch (_) { parsed = { raw: body }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    }).on('error', (e) => resolve({ status: 0, body: { error: e.message } }));
  });
}

let failed = 0;
function check(label, cond, detail) {
  console.log(`${cond ? '  ✔' : '  ✘'} ${label}${detail ? '  → ' + detail : ''}`);
  if (!cond) failed += 1;
}

async function main() {
  const A = new C(genId());
  const B = new C(genId());
  await A.connect();
  await B.connect();

  // ---- 造一局棋并让它落盘 ----
  A.send('create_room', {});
  const c = await A.wait('room_created');
  B.send('join_room', { code: c.data.code });
  await B.wait('room_joined');
  const st0 = (await B.wait('state')).data;
  const bC = st0.seat === 'b' ? A : B;
  const wC = st0.seat === 'b' ? B : A;
  bC.send('move', { usi: '7g7f' });
  await sleep(400);
  wC.send('resign', {});
  await A.wait('game_over');
  await sleep(500);

  console.log(`A.id = ${A.id}\nB.id = ${B.id}\n`);

  // ---- 1. WS 检索：应按连接身份拿到自己的棋谱 ----
  console.log('[1] WS record_search（本人）');
  A.send('record_search', {});
  const res = await A.wait('record_search_result');
  const recs = (res && res.data && res.data.records) || [];
  check('能取到检索结果', !!res);
  check('包含刚结束的对局', recs.length >= 1, `${recs.length} 条`);
  check('每条都含自己（服务端按连接身份过滤）',
    recs.every((r) => r.playerIds && (r.playerIds.b === A.id || r.playerIds.w === A.id)));

  // ---- 2. REST 检索：游客身份不得枚举他人棋谱 ----
  console.log('\n[2] REST /api/records/search（越权尝试）');
  const s1 = await rest(`/api/records/search?player=${B.id}`);
  check('用他人 guestId 查询 → 403', s1.status === 403, `HTTP ${s1.status} ${JSON.stringify(s1.body)}`);
  const s2 = await rest('/api/records/search?player=' + A.id);
  check('游客用自己 guestId 查询同样 → 403（改走 WS）', s2.status === 403, `HTTP ${s2.status}`);

  // ---- 3. 管理员专供出口：非管理员不得访问 ----
  console.log('\n[3] REST /api/history（已收归管理员）');
  const h1 = await rest(`/api/history?player=${A.id}`);
  check('游客访问 → 403', h1.status === 403, `HTTP ${h1.status} ${JSON.stringify(h1.body)}`);

  console.log(`\n${failed === 0 ? '全部通过' : failed + ' 项未通过'}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
