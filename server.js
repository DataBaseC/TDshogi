/**
 * server.js — TDShogi 服务端入口
 *
 * 单进程运行：Express（REST + 静态资源）+ ws（WebSocket）同端口。
 * 启动：npm start 或 node server.js（端口可用 PORT 环境变量覆盖，默认 3000）。
 */
'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { ensureDataDirs } = require('./src/storage');
const admin = require('./src/admin');
const accounts = require('./src/accounts');
const { Protocol } = require('./src/protocol');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

ensureDataDirs();

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// REST API
const protocol = new Protocol({ onBroadcast: () => {} });

// 首页数据
app.get('/api/home', (req, res) => {
  res.json(protocol.homeData());
});

// 大厅数据（进行中对局 / 公告 / 排行）
app.get('/api/lobby', (req, res) => {
  res.json(protocol.lobbyData());
});

// 对局状态（供历史页/观战初始加载）；权限隔离：管理员看全部，普通用户只看自己的
app.get('/api/history', (req, res) => {
  const playerId = req.query.player;
  const adminToken = req.query.adminToken || req.headers['x-admin-token'] || null;
  res.json(protocol.historyData(playerId, adminToken));
});

// 管理员：全部用户数据
app.get('/api/admin/users', (req, res) => {
  const token = req.query.token || req.headers['x-admin-token'] || null;
  const data = protocol.adminUsersData(token);
  if (!data) return res.status(403).json({ error: '无管理员权限' });
  res.json(data);
});

// 管理员：指定用户数据
app.get('/api/admin/users/:id', (req, res) => {
  const token = req.query.token || req.headers['x-admin-token'] || null;
  const data = protocol.adminUserData(req.params.id, token);
  if (!data) return res.status(403).json({ error: '无管理员权限或用户不存在' });
  res.json(data);
});

// 管理员：导入 KIF 棋谱
app.post('/api/admin/records/import', (req, res) => {
  const token = req.headers['x-admin-token'] || (req.query && req.query.token) || null;
  if (!admin.verify(token)) return res.status(403).json({ error: '无管理员权限' });
  const text = req.body && req.body.text;
  if (!text || typeof text !== 'string') return res.status(400).json({ error: '缺少 KIF 文本' });
  const result = require('./src/records').importKif(text);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, record: result.record });
});

// 棋谱导出（权限：owner 或管理员）
app.get('/api/records/:id/export', (req, res) => {
  const fmt = req.query.fmt === 'csa' ? 'csa' : 'kif';
  const records = require('./src/records');
  const rec = records.getRecord(req.params.id);
  if (!rec) return res.status(404).json({ error: '棋谱不存在' });
  const token = req.query.token || req.headers['x-admin-token'];
  const guest = req.query.guest;
  if (!admin.verify(token) && !records.isOwner(rec, guest)) {
    return res.status(403).json({ error: '无权导出他人的棋谱' });
  }
  const data = protocol.exportData(req.params.id, fmt);
  if (!data) return res.status(404).json({ error: '棋谱不存在' });
  res.set('Content-Type', 'text/plain; charset=utf-8');
  // 文件名：先手名_后手名_对局日期.格式（中文用 RFC 5987 编码，兼容各浏览器）
  const recNames = (rec.names && rec.names[0] && rec.names[1])
    ? `${sanitize(rec.names[0])}_vs_${sanitize(rec.names[1])}`
    : req.params.id;
  const dateStr = rec.createdAt ? new Date(rec.createdAt).toISOString().slice(0, 10) : 'nodate';
  const base = `${recNames}_${dateStr}`;
  const ascii = base.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  res.set('Content-Disposition',
    `attachment; filename="${ascii}.${fmt}"; filename*=UTF-8''${encodeURIComponent(base)}.${fmt}`);
  res.send(data.text);
});

/** 文件名清洗：去掉路径分隔与危险字符 */
function sanitize(s) {
  return String(s || '').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 20) || '无名';
}

// 棋谱回放数据（权限：owner 或管理员）
app.get('/api/records/:id/playback', (req, res) => {
  const records = require('./src/records');
  const rec = records.getRecord(req.params.id);
  if (!rec) return res.status(404).json({ error: '棋谱不存在' });
  const token = req.query.token || req.headers['x-admin-token'];
  const guest = req.query.guest;
  if (!admin.verify(token) && !records.isOwner(rec, guest)) {
    return res.status(403).json({ error: '只能回放自己的棋谱' });
  }
  res.json(records.playbackData(rec));
});

// 复盘数据（完整：含书签/评论/变着）。权限：owner 或管理员。
app.get('/api/records/:id/review', (req, res) => {
  const token = req.query.token || req.headers['x-admin-token'];
  const guest = req.query.guest;
  const records = require('./src/records');
  const rec = records.getRecord(req.params.id);
  if (!rec) return res.status(404).json({ error: '棋谱不存在' });
  if (!admin.verify(token) && !records.isOwner(rec, guest)) {
    return res.status(403).json({ error: '只能复盘自己的棋谱' });
  }
  res.json(records.reviewData(req.params.id));
});

// 书签（toggle）
app.post('/api/records/:id/bookmark', (req, res) => {
  const token = req.headers['x-admin-token'] || (req.query && req.query.token);
  const guest = req.body && req.body.guest;
  const moveNo = req.body && req.body.moveNo;
  const on = !!(req.body && req.body.on);
  const records = require('./src/records');
  const rec = records.getRecord(req.params.id);
  if (!rec) return res.status(404).json({ error: '棋谱不存在' });
  if (!admin.verify(token) && !records.isOwner(rec, guest)) {
    return res.status(403).json({ error: '无权操作' });
  }
  const r = records.toggleBookmark(req.params.id, moveNo, on);
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});

// 评论（text 为空表示删除）
app.post('/api/records/:id/comment', (req, res) => {
  const token = req.headers['x-admin-token'] || (req.query && req.query.token);
  const guest = req.body && req.body.guest;
  const moveNo = req.body && req.body.moveNo;
  const text = req.body && req.body.text;
  const records = require('./src/records');
  const rec = records.getRecord(req.params.id);
  if (!rec) return res.status(404).json({ error: '棋谱不存在' });
  if (!admin.verify(token) && !records.isOwner(rec, guest)) {
    return res.status(403).json({ error: '无权操作' });
  }
  const r = records.setComment(req.params.id, moveNo, text);
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});

// 变着（添加一条变着走法）
app.post('/api/records/:id/variation', (req, res) => {
  const token = req.headers['x-admin-token'] || (req.query && req.query.token);
  const guest = req.body && req.body.guest;
  const parent = req.body && req.body.parent;
  const move = req.body && req.body.move;
  const records = require('./src/records');
  const rec = records.getRecord(req.params.id);
  if (!rec) return res.status(404).json({ error: '棋谱不存在' });
  if (!admin.verify(token) && !records.isOwner(rec, guest)) {
    return res.status(403).json({ error: '无权操作' });
  }
  const r = records.addVariation(req.params.id, parent, move);
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});

// 赛事列表
app.get('/api/tournaments', (req, res) => {
  res.json(protocol.tournamentsData());
});

// 个人数据
app.get('/api/profile', (req, res) => {
  const playerId = req.query.player;
  if (!playerId) return res.status(400).json({ error: '缺少 player 参数' });
  res.json(protocol.profileData(playerId));
});

// ==================================================================
// 账号系统 REST
// ==================================================================

// 注册：{username, password, guestId?}（guestId 用于游客升级保留数据）
app.post('/api/register', (req, res) => {
  const { username, password, guestId } = req.body || {};
  const r = accounts.register(username, password, guestId || null);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true, token: accounts.issueToken(r.account.id), account: r.account });
});

// 登录：{username, password}
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const r = accounts.login(username, password);
  if (!r.ok) return res.status(401).json({ error: r.error });
  res.json({ ok: true, token: r.token, account: r.account });
});

// 令牌校验/账号信息：GET /api/me?token=xxx
app.get('/api/me', (req, res) => {
  const token = req.query.token || req.headers['x-session-token'] || null;
  const accountId = accounts.verifyToken(token);
  if (!accountId) return res.status(401).json({ error: '未登录或令牌已失效' });
  res.json({ ok: true, account: accounts.getAccount(accountId) });
});

// 服务器（同一实例承载 HTTP 与 WS）
const server = http.createServer(app);

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // 解析 guestId（从查询参数）
  const url = new URL(req.url, `http://${req.headers.host}`);
  const guestId = url.searchParams.get('guest') || null;
  protocol.handleConnection(ws, guestId);
});

server.listen(PORT, () => {
  console.log(`TDShogi server running at http://localhost:${PORT}`);
  console.log(`WebSocket listening on ws://localhost:${PORT}/ws`);
  // 恢复上次运行未结束的对局（快照重启恢复）
  const restored = protocol.rooms.restoreSnapshots();
  if (restored > 0) console.log(`[rooms] 已恢复 ${restored} 场未完成对局`);
});
