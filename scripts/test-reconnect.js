/**
 * test-reconnect.js — 复现「掉线后重连不能回到对局」
 * 流程：建房 → 加入 → joiner 断线 → joiner 新连接 request_state → 应恢复对局
 * 再测：对局中用户尝试 spectate / create_room / join_room 应被限制
 */
'use strict';
const WebSocket = require('ws');
const PORT = process.env.PORT || 3100;
const URL = `ws://localhost:${PORT}/ws?guest=`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const genId = () => { let s=''; for (let i=0;i<24;i++) s += '0123456789abcdef'[Math.floor(Math.random()*16)]; return s; };

class C {
  constructor(id) { this.id=id; this.ws=null; this.inbox=[]; this.waits=[]; }
  async connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(URL + this.id);
      this.ws.on('open', res);
      this.ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); this.inbox.push(m); this.waits = this.waits.filter(w => !w(m)); });
      this.ws.on('error', rej);
    });
  }
  send(t,d){this.ws.send(JSON.stringify({type:t,data:d}))}
  close(){return new Promise(r=>{this.ws.on('close',r);this.ws.close()})}
  wait(t,ms=4000){return new Promise(r=>{const f=this.inbox.find(m=>m.type===t);if(f)return r(f);const tm=setTimeout(()=>r(null),ms);this.waits.push(m=>{if(m.type===t){clearTimeout(tm);r(m);return true}return false})})}
  states(){return this.inbox.filter(m=>m.type==='state')}
}

async function main() {
  const hostId = genId();
  const joinerId = genId();

  const host = new C(hostId);
  const joiner = new C(joinerId);
  await host.connect(); await joiner.connect();

  host.send('create_room', {});
  const c = await host.wait('room_created');
  const { code } = c.data;
  joiner.send('join_room', { code });
  await joiner.wait('room_joined');
  console.log(`[test] 房间 ${code} 对局进行中`);

  // joiner 走一手
  const js0 = (await joiner.wait('state')).data;
  const bC = js0.seat === 'b' ? joiner : host;
  const wC = js0.seat === 'b' ? host : joiner;
  bC.send('move', { usi: '7g7f' });
  await sleep(500);
  console.log('[test] 先手走 7g7f 完成');

  // ===== joiner 掉线 =====
  await joiner.close();
  await sleep(500);
  console.log('[test] joiner 已掉线');

  // ===== joiner 重连（新连接 + request_state） =====
  const joiner2 = new C(joinerId);
  await joiner2.connect();
  await sleep(300);
  const hello = joiner2.inbox.find(m=>m.type==='hello');
  console.log(`[test] 重连 hello.reconnect: ${hello ? JSON.stringify(hello.data.reconnect) : '无 hello'}`);
  joiner2.send('request_state');
  const st = await joiner2.wait('state');
  console.log('\n===== 重连结果 =====');
  if (!st) console.log('[FAIL] 重连后未收到 state —— 无法回到对局');
  else {
    const d = st.data;
    console.log(`重连 state: seat=${d.seat} isPlayer=${d.isPlayer} status=${d.status} moves=${d.moves.length} lastMove=${d.lastMove}`);
    console.log(d.seat && d.isPlayer ? '[OK] 成功回到对局' : '[FAIL] seat/isPlayer 缺失，未真正恢复玩家身份');
  }

  // ===== 限制测试：对局中的用户 =====
  console.log('\n===== 限制测试（host 正在对局中） =====');
  // 1) 观战他人对局
  host.send('spectate', { roomId: 'nonexistent' });
  await sleep(400);
  // 先开一局别人之间对局
  const a = new C(genId()), b = new C(genId());
  await a.connect(); await b.connect();
  a.send('create_room', {});
  const c2 = await a.wait('room_created');
  b.send('join_room', { code: c2.data.code });
  await b.wait('room_joined');
  host.send('spectate', { roomId: c2.data.roomId });
  await sleep(500);
  const spectateRes = host.inbox.filter(m=>m.type==='error'||m.type==='spectating').pop();
  console.log(`对局中用户观战: ${spectateRes ? spectateRes.type + ' → ' + JSON.stringify(spectateRes.data) : '无响应（BUG：静默放行或忽略）'}`);

  // 2) 建新房
  // 注意：inbox 是累积的，早期的 room_created 也会被翻出来造成"假 BUG"，
  // 这里先记录发送前的消息数，只统计新增
  const preErrCount = host.inbox.filter(m=>m.type==='error').length;
  const preCreatedCount = host.inbox.filter(m=>m.type==='room_created').length;
  host.send('create_room', {});
  await sleep(500);
  const err1 = host.inbox.filter(m=>m.type==='error').slice(preErrCount).pop();
  const created2 = host.inbox.filter(m=>m.type==='room_created').length > preCreatedCount;
  // ⚠️ 这里**不是 BUG**：对局中建房 = 先自动认输退出旧局、再建新房，
  //    是 §T2 起刻意保留的行为（`e2e-test.js` 有对应断言：
  //    "对局中建房 = 自动认输退出旧局并创建新房间"）。别再按旧预期"修"回去。
  console.log(`对局中用户建房: ${created2 ? 'OK 自动认输旧局并建新房（预期行为）' : (err1 ? '被拒: ' + err1.data.message : '无响应')}`);

  // 3) 加入其他房间
  host.send('join_room', { code: c2.data.code });
  await sleep(500);
  const errs = host.inbox.filter(m=>m.type==='error');
  console.log(`对局中用户加入其他房间: ${errs.length ? 'OK 被拒: ' + errs[errs.length-1].data.message : 'BUG: 无拒绝（静默或成功）'}`);

  // ===== 对手掉线状态显示 =====
  const hostState = host.states().pop();
  if (hostState) {
    const opp = hostState.data.players[hostState.data.seat === 'b' ? 'w' : 'b'];
    // ⚠️ 判的是**字段是否存在**，不是它的值：对手此刻在线时 `connected === true`，
    //    旧写法（只在 false 时才说"有字段"）会误报"缺字段"。
    console.log(`\n===== 掉线状态字段 =====\n对手(players.w/b) 字段: ${JSON.stringify(opp)}\n${
      opp && 'connected' in opp
        ? `OK 有 connected 字段（当前 ${opp.connected}；对手掉线时会变 false）`
        : '!! 缺 connected 字段，前端无法显示对手断线'}`);
  }

  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
