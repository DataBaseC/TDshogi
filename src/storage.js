/**
 * storage.js — SQLite 存储层（better-sqlite3）
 *
 * 将原先的 JSON 文件存储迁移到单一 SQLite 数据库（data/tdshogi.db），
 * 对外保持与旧版兼容的接口，各业务模块无需改动：
 *
 *  - readJson(name, fallback) / writeJson(name, data)
 *    通用键值存储（ratings/tournaments/accounts/announcements/admin）
 *  - records 表：棋谱（id 主键 + 数据 JSON + createdAt 索引）
 *  - sessions 表：游客/账号会话（id 主键 + 数据 JSON）
 *
 * 首次启动自动把旧 data/*.json 与 data/records/*.json 迁移进库。
 * 依赖：better-sqlite3（node_modules 预编译，无需构建工具）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// 运行时数据根目录（可用环境变量 DATA_DIR 覆盖，便于部署到持久目录）
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'tdshogi.db');
const RECORDS_DIR = path.join(DATA_DIR, 'records'); // 保留（旧数据迁移源 + 兼容）
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// ---------------- 数据库初始化 ----------------
let db = null;

function getDb() {
  if (db) return db;
  ensureDir(DATA_DIR);
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');      // 读写并发友好
  db.pragma('synchronous = NORMAL');    // 性能与安全平衡
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      id        TEXT PRIMARY KEY,
      data      TEXT NOT NULL,
      createdAt INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_records_createdAt ON records(createdAt);
    CREATE TABLE IF NOT EXISTS sessions (
      id   TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gamesnapshots (
      roomId TEXT PRIMARY KEY,
      data   TEXT NOT NULL,
      savedAt INTEGER
    );
  `);
  migrateLegacyJson();
  return db;
}

// ---------------- 旧 JSON 数据一次性迁移 ----------------
function migrateLegacyJson() {
  // 通用 kv 文件（ratings/tournaments/accounts/announcements/admin）
  for (const name of ['ratings.json', 'tournaments.json', 'accounts.json', 'announcements.json', 'admin.json']) {
    const file = path.join(DATA_DIR, name);
    if (!fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && typeof data === 'object') {
        const stmt = db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)');
        stmt.run(name, JSON.stringify(data));
        // 迁移后改名备份，避免重复迁移
        fs.renameSync(file, `${file}.bak`);
      }
    } catch (_) { /* 忽略损坏文件 */ }
  }
  // records/*.json
  if (fs.existsSync(RECORDS_DIR)) {
    const insert = db.prepare('INSERT OR REPLACE INTO records (id, data, createdAt) VALUES (?, ?, ?)');
    const files = fs.readdirSync(RECORDS_DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(RECORDS_DIR, f), 'utf8'));
        if (rec && rec.id) insert.run(rec.id, JSON.stringify(rec), rec.createdAt || Date.now());
      } catch (_) {}
    }
    // 迁移后目录改名（保留备份）
    if (files.length) fs.renameSync(RECORDS_DIR, `${RECORDS_DIR}.bak`);
  }
  // sessions/*.json
  if (fs.existsSync(SESSIONS_DIR)) {
    const insert = db.prepare('INSERT OR REPLACE INTO sessions (id, data) VALUES (?, ?)');
    const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
        if (s && s.id) insert.run(s.id, JSON.stringify(s));
      } catch (_) {}
    }
    if (files.length) fs.renameSync(SESSIONS_DIR, `${SESSIONS_DIR}.bak`);
  }
}

// ---------------- 兼容接口：通用 kv ----------------
/**
 * 读取 JSON（key 形式：'ratings.json' 等）。兼容旧接口。
 */
function readJson(name, fallback = null) {
  const d = getDb();
  try {
    const row = d.prepare('SELECT value FROM kv WHERE key = ?').get(String(name));
    if (!row) return fallback;
    return JSON.parse(row.value);
  } catch (err) {
    console.error(`[storage] 读取 ${name} 失败: ${err.message}`);
    return fallback;
  }
}

/**
 * 写入 JSON（key 形式）。兼容旧接口。
 */
function writeJson(name, data) {
  const d = getDb();
  try {
    d.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)')
      .run(String(name), JSON.stringify(data));
  } catch (err) {
    console.error(`[storage] 写入 ${name} 失败: ${err.message}`);
  }
}

/**
 * 按前缀枚举 kv 中的 JSON（如 'sessions/'）。
 * 会话实际写在此处（identify/upsertSession 走 writeJson），
 * 读取侧（auth.listSessions → ratings.allUsers → admin 用户列表）必须走同一来源。
 */
function listJsonByPrefix(prefix) {
  const d = getDb();
  try {
    const rows = d.prepare('SELECT key, value FROM kv WHERE key LIKE ? ESCAPE ?')
      .all(`${String(prefix).replace(/[\\%_]/g, (c) => `\\${c}`)}%`, '\\');
    return rows.map((r) => JSON.parse(r.value));
  } catch (err) {
    console.error(`[storage] 枚举 ${prefix}* 失败: ${err.message}`);
    return [];
  }
}

/**
 * 删除 kv 项（审计/事件日志裁剪用，PLAN §M3）。
 * 幂等：键不存在时无副作用。
 */
function deleteJson(name) {
  getDb().prepare('DELETE FROM kv WHERE key = ?').run(String(name));
  return true;
}

// ---------------- records / sessions 表接口 ----------------
function recordExists(id) {
  return !!getDb().prepare('SELECT 1 FROM records WHERE id = ?').get(id);
}

function getRecordById(id) {
  const row = getDb().prepare('SELECT data FROM records WHERE id = ?').get(id);
  return row ? JSON.parse(row.data) : null;
}

function putRecord(rec) {
  getDb().prepare('INSERT OR REPLACE INTO records (id, data, createdAt) VALUES (?, ?, ?)')
    .run(rec.id, JSON.stringify(rec), rec.createdAt || Date.now());
}

function listRecords(limit = 500) {
  const rows = getDb()
    .prepare('SELECT data FROM records ORDER BY createdAt DESC, id DESC LIMIT ?')
    .all(limit);
  return rows.map((r) => JSON.parse(r.data));
}

/**
 * 检索棋谱（条件可组合，全部可选）：
 * @param {object} q
 *  - playerId: 按玩家过滤（先手或后手）
 *  - movesMin / movesMax: 手数范围
 *  - result: 'b' | 'w' | '-' | null
 *  - opening: 开局特征（前 N 手 USI 序列，如 '7g7f,3c3d'）
 *  - query: 关键词（选手名 / 走法片段）
 *  - limit
 */
function searchRecords(q = {}) {
  const conds = [];
  const params = [];
  if (q.playerId) {
    conds.push("(json_extract(data, '$.playerIds.b') = ? OR json_extract(data, '$.playerIds.w') = ?)");
    params.push(q.playerId, q.playerId);
  }
  if (Number.isFinite(q.movesMin)) {
    conds.push('json_array_length(json_extract(data, \'$.moves\')) >= ?');
    params.push(q.movesMin);
  }
  if (Number.isFinite(q.movesMax)) {
    conds.push('json_array_length(json_extract(data, \'$.moves\')) <= ?');
    params.push(q.movesMax);
  }
  if (q.result) {
    conds.push("json_extract(data, '$.result') = ?");
    params.push(q.result);
  }
  if (q.opening) {
    // 开局特征：前 N 手完全匹配（USI 序列）
    const seq = String(q.opening).split(',').map((s) => s.trim()).filter(Boolean);
    if (seq.length) {
      // 用 SQL 判断 moves 数组前 N 个元素
      const n = seq.length;
      const checks = seq.map((_, i) => `json_extract(data, '$.moves[' || ${i} || ']') = ?`).join(' AND ');
      conds.push(`json_array_length(json_extract(data, '$.moves')) >= ? AND (${checks})`);
      params.push(n, ...seq);
    }
  }
  if (q.query) {
    const kw = `%${String(q.query)}%`;
    conds.push("(json_extract(data, '$.names[0]') LIKE ? OR json_extract(data, '$.names[1]') LIKE ? OR data LIKE ?)");
    params.push(kw, kw, kw);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const limit = Math.min(q.limit || 100, 500);
  const rows = getDb()
    .prepare(`SELECT data FROM records ${where} ORDER BY createdAt DESC, id DESC LIMIT ${limit}`)
    .all(...params);
  return rows.map((r) => JSON.parse(r.data));
}

function sessionExists(id) {
  return !!getDb().prepare('SELECT 1 FROM sessions WHERE id = ?').get(id);
}

/** 棋谱总数（首页统计胶囊用） */
function countRecords() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM records').get().n;
}

function getSessionById(id) {
  const row = getDb().prepare('SELECT data FROM sessions WHERE id = ?').get(id);
  return row ? JSON.parse(row.data) : null;
}

function putSession(session) {
  getDb().prepare('INSERT OR REPLACE INTO sessions (id, data) VALUES (?, ?)')
    .run(session.id, JSON.stringify(session));
}

function listSessions() {
  const rows = getDb().prepare('SELECT data FROM sessions').all();
  return rows.map((r) => JSON.parse(r.data));
}

// ---------------- gamesnapshots：进行中对局快照（重启恢复） ----------------
function putGameSnapshot(roomId, data) {
  getDb().prepare('INSERT OR REPLACE INTO gamesnapshots (roomId, data, savedAt) VALUES (?, ?, ?)')
    .run(roomId, JSON.stringify(data), Date.now());
}

function getGameSnapshot(roomId) {
  const row = getDb().prepare('SELECT data FROM gamesnapshots WHERE roomId = ?').get(roomId);
  return row ? JSON.parse(row.data) : null;
}

function listGameSnapshots() {
  const rows = getDb().prepare('SELECT roomId, data FROM gamesnapshots').all();
  return rows.map((r) => ({ roomId: r.roomId, data: JSON.parse(r.data) }));
}

function deleteGameSnapshot(roomId) {
  getDb().prepare('DELETE FROM gamesnapshots WHERE roomId = ?').run(roomId);
}

// ---------------- 兼容旧导出（供仍引用 RECORDS_DIR 的代码） ----------------
function ensureDataDirs() {
  ensureDir(DATA_DIR);
  getDb(); // 初始化库（含迁移）
}

function listRecordFiles(exts = ['.json']) {
  // 旧接口返回文件路径数组；SQLite 下返回空（业务已改用表接口）
  return [];
}

module.exports = {
  DATA_DIR,
  RECORDS_DIR,
  SESSIONS_DIR,
  ensureDataDirs,
  readJson,
  writeJson,
  deleteJson,
  listJsonByPrefix,
  listRecordFiles,
  // 表级接口
  recordExists,
  getRecordById,
  putRecord,
  listRecords,
  searchRecords,
  countRecords,
  sessionExists,
  getSessionById,
  putSession,
  listSessions,
  // gamesnapshots
  putGameSnapshot,
  getGameSnapshot,
  listGameSnapshots,
  deleteGameSnapshot,
  // 仅供测试/工具
  _getDb: getDb,
};
