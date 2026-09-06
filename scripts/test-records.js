/**
 * test-records.js — 复现「普通用户棋谱页看不到自己的棋谱」
 * 流程：A 建房 → B 加入 → B 认输 → 对局结束落盘 → 用 A/B 的 guestId 查 /api/records/search
 */
'use strict';
const WebSocket = require('ws');
const http = require('http');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const genId = () => { let s=''; for (let i=0;i<24;i++) s += '0123456789abcdef'[Math.floor(Math.random()*16)]; return s; };

const URL = 'ws://localhost:3100/ws?guest=';
class C {
  constructor(id) { this.id=id; this.ws=null; this.inbox=[]; this.waits=[]; }
  connect() { return new Promise((res,rej)=>{ this.ws=new WebSocket(URL+this.id); this.ws.on('open',res); this.ws.on('message',(raw)=>{const m=JSON.parse(raw.toString());this.inbox.push(m);this.waits=this.waits.filter(w=>!w(m));}); this.ws.on('error',rej); }); }
  send(t,d){this.ws.send(JSON.stringify({type:t,data:d}))}
  wait(t,ms=4000){return new Promise(r=>{const f=this.inbox.find(m=>m.type===t);if(f)return r(f);const tm=setTimeout(()=>r(null),ms);this.waits.push(m=>{if(m.type===t){clearTimeout(tm);r(m);return true}return false})})}
}

function search(player) {
  return new Promise((resolve) => {
    http.get(`http://localhost:3100/api/records/search?player=${player}`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (_) { resolve({ raw: body }); } });
    }).on('error', (e) => resolve({ error: e.message }));
  });
}

async function main() {
  const A = new C(genId());
  const B = new C(genId());
  await A.connect(); await B.connect();
  A.send('create_room', {});
  const c = await A.wait('room_created');
  B.send('join_room', { code: c.data.code });
  await B.wait('room_joined');
  const st0 = (await B.wait('state')).data;
  const bC = st0.seat === 'b' ? A : B;
  const wC = st0.seat === 'b' ? B : A;
  bC.send('move', { usi: '7g7f' });
  await sleep(400);
  // 后手认输 → 对局结束
  wC.send('resign', {});
  const over = await A.wait('game_over');
  console.log('game_over:', over ? JSON.stringify(over.data) : '无');
  await sleep(500);

  console.log('A.id =', A.id);
  console.log('B.id =', B.id);
  const ra = await search(A.id);
  const rb = await search(B.id);
  console.log('A 搜索自己的棋谱:', ra.records ? ra.records.length + ' 条 → ' + JSON.stringify(ra.records.map(r=>r.playerIds)) : JSON.stringify(ra));
  console.log('B 搜索自己的棋谱:', rb.records ? rb.records.length + ' 条 → ' + JSON.stringify(rb.records.map(r=>r.playerIds)) : JSON.stringify(rb));

  // 也测试 /api/history
  const history = await new Promise((resolve) => {
    http.get(`http://localhost:3100/api/history?player=${A.id}`, (res) => {
      let body=''; res.on('data',(c)=>body+=c); res.on('end',()=>{try{resolve(JSON.parse(body))}catch(_){resolve({raw:body})}});
    }).on('error',(e)=>resolve({error:e.message}));
  });
  console.log('A /api/history:', history.records ? history.records.length + ' 条' : JSON.stringify(history));
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1)});
