/**
 * inspect-db.js — 检查默认数据库的棋谱记录与 session id 是否匹配
 */
'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const DB = path.join(__dirname, '..', 'data', 'tdshogi.db');
const fs = require('fs');
if (!fs.existsSync(DB)) { console.log('数据库不存在:', DB); process.exit(0); }
const db = new Database(DB, { readonly: true });

const recs = db.prepare('SELECT id, data, createdAt FROM records ORDER BY createdAt DESC LIMIT 20').all();
console.log('=== 棋谱记录数:', recs.length, '===');
for (const r of recs) {
  try {
    const d = JSON.parse(r.data);
    console.log(`id=${r.id} | playerIds=${JSON.stringify(d.playerIds)} | names=${JSON.stringify(d.names)} | result=${d.result} | createdAt=${new Date(d.createdAt).toISOString()}`);
  } catch (_) { console.log(`id=${r.id} | <JSON解析失败>`); }
}

const sessions = db.prepare('SELECT id, data FROM sessions ORDER BY id LIMIT 30').all();
console.log('\n=== 会话数:', sessions.length, '===');
for (const s of sessions) {
  try {
    const d = JSON.parse(s.data);
    console.log(`id=${s.id} | name=${d.name}`);
  } catch (_) { console.log(`id=${s.id} | <JSON解析失败>`); }
}
db.close();
