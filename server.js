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
const auth = require('./src/auth');
const ratings = require('./src/ratings');
const tournaments = require('./src/tournaments');
const netInfo = require('./src/net');
const audit = require('./src/audit');
const rateLimit = require('./src/ratelimit');
const { Protocol } = require('./src/protocol');

const VERSION = require('./package.json').version;
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

ensureDataDirs();

const app = express();
app.use(express.json());
// 客户端信息（IP/UA）地基，PLAN §M3：供 §K 的登录记录与管理员审计使用。
// 未配置 TRUST_PROXY 时不信任任何代理头——否则伪造 X-Forwarded-For 即可伪装 IP。
app.set('trust proxy', netInfo.trustProxySetting());
app.use(netInfo.attachClientInfo);
// 速率限制（PLAN §Q7）：/api 全局兜底（宽松，默认 600 次/分钟/IP），
// 登录与重查询在各自路由上再叠加更严的档位。
// ⚠️ 限流键为 clientIp（遵守 TRUST_PROXY）——反代部署若未配置 TRUST_PROXY，
//    所有请求会被视作同一个 IP，务必按 DEPLOY.md 配置。
app.use('/api', rateLimit.expressMiddleware(rateLimit.api));
// 管理后台入口门禁（PLAN §J5）：设置 ADMIN_ENTRY_KEY 后，访问 /admin.html 必须带 ?k=<key>，
// 否则按 404 处理——连"后台存在"这件事都不暴露。未设置该变量时保持开放（避免把自己锁在门外）。
// 注：这层只是入口隐蔽，真正的权限校验仍在 src/admin.js 的 verify（所有 /api/admin/* 均校验）。
const ADMIN_ENTRY_KEY = process.env.ADMIN_ENTRY_KEY || '';
app.use((req, res, next) => {
  if (ADMIN_ENTRY_KEY && req.path === '/admin.html' && req.query.k !== ADMIN_ENTRY_KEY) {
    return res.status(404).send('Not Found');
  }
  next();
});
// 静态资源禁用强缓存（协商缓存）：防止服务进程与磁盘文件版本错位时
// 浏览器还拿着旧脚本（实机『感想战瘫痪』类问题的环境性根因）
app.use(express.static(PUBLIC_DIR, {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

// REST API
const protocol = new Protocol({ onBroadcast: () => {} });

/**
 * 统一身份解析：把客户端传来的"身份参数"解析为服务端真正认识的对局玩家 id。
 *  - 游客：guest.id 本身即 24 hex 玩家 id，原样返回；
 *  - 账号：guest.id 是会话令牌（形如 `<accountId>.<ts>.<sig>`，含点），
 *    必须解析为 accountId——因为对局落盘的 playerIds / winnerId 存的是
 *    服务端 verifyToken 后的账号 id（24 hex），若直接用 token 匹配会查不到
 *    自己的棋谱（历史页空白 / 复盘 403 "只能复盘自己的棋谱"）。
 * @param {string|null} raw
 * @returns {string|null}
 */
function resolvePlayer(raw) {
  if (!raw) return null;
  if (String(raw).includes('.')) {
    const accountId = accounts.verifyToken(raw);
    // 解析失败（token 过期/伪造）回退原值：匹配不上自然返回空，不破坏现有行为
    return accountId || raw;
  }
  return raw;
}

// 首页数据（附版本号——排障时用 curl 即可确认进程跑的是哪份代码）
app.get('/api/home', (req, res) => {
  res.json({ ...protocol.homeData(), version: VERSION });
});

// 大厅数据（进行中对局 / 公告 / 排行）
app.get('/api/lobby', (req, res) => {
  res.json(protocol.lobbyData());
});

// 全量棋谱（管理后台"全部棋谱"专供）：**仅管理员**。
// 此前允许 ?player=<任意 id> 查询，而游客 id 在大厅/观战页是公开的
// → 任何人可枚举他人棋谱（PLAN §Q7）。普通用户的检索一律走 WS `record_search`
// （连接握手时已由 identify() 绑定身份，服务端强制按该身份过滤）。
app.get('/api/history', rateLimit.expressMiddleware(rateLimit.heavy), adminOnly, (req, res) => {
  res.json(protocol.historyData(req.adminToken));
});

// 管理员：全部用户数据
app.get('/api/admin/users', rateLimit.expressMiddleware(rateLimit.heavy), adminOnly, (req, res) => {
  res.json(protocol.adminUsersData(req.adminToken));
});

// 管理员：指定用户数据
app.get('/api/admin/users/:id', adminOnly, (req, res) => {
  const data = protocol.adminUserData(req.params.id, req.adminToken);
  if (!data) return res.status(403).json({ error: '无管理员权限或用户不存在' });
  res.json(data);
});

// ---------------- 管理接口统一鉴权（PLAN §Q7-5）----------------

/**
 * 管理身份判定：通过返回 token，失败返回 null。**全项目唯一的判定入口。**
 *
 * 此前每个管理接口都手抄 `req.query.token || req.headers['x-admin-token']` + `admin.verify`，
 * 于是「新增接口忘记写校验」成了一个迟早会发生的错误类别（PLAN §Q7-1 的越权正是同源问题），
 * 而且这类疏漏**不报错、不被测试发现**，只会静默存在。收敛到这一处后，结构上消除了它。
 */
function checkAdmin(req) {
  const token = req.headers['x-admin-token'] || req.query.token || req.query.adminToken || null;
  return admin.verify(token) ? token : null;
}

/**
 * Express 中间件版：`app.get(path, adminOnly, handler)`。
 * 鉴权通过后把 token 放进 `req.adminToken`，handler 直接取用，不必再解析一次。
 */
function adminOnly(req, res, next) {
  const token = checkAdmin(req);
  if (!token) return res.status(403).json({ error: '无管理员权限' });
  req.adminToken = token;
  next();
}

// ---------------- 用户管理写操作（PLAN §K3，全部写审计日志）----------------

/**
 * 管理写路由统一包装：鉴权交给 `adminOnly` → 执行业务 → audit.adminAction 落审计。
 * handler(req, body) 返回 {ok, action, error?, audit?, ...data}；
 * ok=false 时返回 400 与 error。
 *
 * 返回**处理函数数组**，Express 会依次执行 → 调用处 `app.post(path, adminWrite(fn))` 无需改动，
 * 而鉴权与读接口走的是**同一个 `adminOnly`**（不在这里再判一次，避免两套判定并存）。
 */
function adminWrite(handler) {
  const h = (req, res) => {
    let r;
    try {
      r = handler(req, req.body || {}) || { ok: false, error: '无结果' };
    } catch (err) {
      console.error('[admin] 写操作异常:', err);
      // 带上真实原因：吞成笼统的"服务器内部错误"会让排障无从下手（2026-09-05 备注/封禁报障教训）
      r = { ok: false, error: `服务器内部错误: ${err.message}`, action: 'unknown' };
    }
    const { action, audit: detail, ...data } = r;
    audit.adminAction({
      adminIp: req.clientIp || null,
      action: action || 'unknown',
      targetId: req.params.id || null,
      ok: !!r.ok,
      detail: detail || null,
    });
    if (!r.ok) return res.status(400).json({ error: r.error || '操作失败' });
    res.json({ ok: true, ...data });
  };
  return [adminOnly, h];
}

// 封禁（days>0 有期，否则永久；同时踢掉该身份全部在线连接）
app.post('/api/admin/users/:id/ban', adminWrite((req, body) => {
  const r = auth.banPlayer(req.params.id, { reason: body.reason, days: body.days, by: 'admin' });
  let kicked = 0;
  if (r.ok) {
    const untilTxt = r.banned.until ? `，至 ${new Date(r.banned.until).toLocaleString('zh-CN')}` : '';
    kicked = protocol.kickPlayer(req.params.id, `你的账号已被封禁${r.banned.reason ? '：' + r.banned.reason : ''}${untilTxt}`);
  }
  return { ...r, action: 'ban', kicked };
}));

app.post('/api/admin/users/:id/unban', adminWrite((req) => {
  const r = auth.unbanPlayer(req.params.id);
  return { ...r, action: 'unban' };
}));

// 改名（显示名；同步进行中对局内双方看到的名字）
app.post('/api/admin/users/:id/rename', adminWrite((req, body) => {
  const r = auth.adminRename(req.params.id, body.name);
  if (r.ok) {
    try { protocol.rooms.updatePlayerName(req.params.id, r.name); } catch (_) {}
  }
  return { ...r, action: 'rename', audit: { to: r.name } };
}));

// 重置 ELO 与战绩
app.post('/api/admin/users/:id/reset-rating', adminWrite((req) => {
  const r = ratings.resetPlayer(req.params.id);
  return { ...r, action: 'reset-rating' };
}));

// 编辑 ELO / 经验（等级随经验自动推导，PLAN §K7）
app.post('/api/admin/users/:id/elo', adminWrite((req, body) => {
  const r = ratings.adminSetPlayer(req.params.id, { rating: body.rating, exp: body.exp });
  return { ...r, action: 'edit-elo', audit: { rating: body.rating, exp: body.exp } };
}));

// 重置密码（仅账号；新明文密码仅本次响应返回；同时使旧会话令牌全部失效）
app.post('/api/admin/users/:id/reset-password', adminWrite((req, body) => {
  const r = accounts.adminResetPassword(req.params.id, body.newPassword);
  return { ...r, action: 'reset-password', audit: { manual: !!body.newPassword } };
}));

// 编辑资料（手机号/棋风存账号；用户称号存会话，展示为「名称（称号）」——游客账号统一）
app.post('/api/admin/users/:id/profile', adminWrite((req, body) => {
  let r = { ok: true, action: 'update-profile' };
  if (body.phone !== undefined || body.style !== undefined) {
    r = accounts.adminUpdateProfile(req.params.id, { phone: body.phone, style: body.style });
  }
  if (r.ok && body.title !== undefined) {
    const tr = auth.adminSetTitle(req.params.id, body.title);
    if (!tr.ok) r = tr;
  }
  return { ...r, action: 'update-profile', audit: { hasPhone: body.phone !== undefined, hasStyle: body.style !== undefined, hasTitle: body.title !== undefined } };
}));

// 删除账号（高危：body.confirm 必须为该账号用户名或 'DELETE'；棋谱保留、评级清空）
app.delete('/api/admin/users/:id', adminWrite((req, body) => {
  const acct = accounts.getAccount(req.params.id);
  if (!acct) return { ok: false, error: '账号不存在（游客请直接删除会话对应记录）', action: 'delete-account' };
  if (body.confirm !== acct.username && body.confirm !== 'DELETE') {
    return { ok: false, error: `确认失败：请提交账号用户名「${acct.username}」或 DELETE`, action: 'delete-account' };
  }
  const kicked = protocol.kickPlayer(req.params.id, '你的账号已被删除');
  const r = accounts.deleteAccount(req.params.id);
  return { ...r, action: 'delete-account', kicked, audit: { username: r.username } };
}));

// 管理员操作审计日志（PLAN §K4「操作审计」tab 数据源）
app.get('/api/admin/audit', rateLimit.expressMiddleware(rateLimit.heavy), adminOnly, (req, res) => {
  res.json({ events: audit.query({ type: 'admin', limit: 200 }) });
});

// 管理员：导入 KIF 棋谱
app.post('/api/admin/records/import', adminOnly, (req, res) => {
  const text = req.body && req.body.text;
  if (!text || typeof text !== 'string') return res.status(400).json({ error: '缺少 KIF 文本' });
  const result = require('./src/records').importKif(text);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, record: result.record });
});

// ---------------- 赛事管理（管理员，见 PLAN §E） ----------------

// 全量列表（含 pending_approval/rejected/cancelled）
app.get('/api/admin/tournaments', adminOnly, (req, res) => {
  res.json({ tournaments: tournaments.listAllTournaments() });
});

// 审核/取消动作（幂等：状态已变更返回 400）
function tournamentAction(action) {
  const h = (req, res) => {
    const id = req.params.id;
    let r;
    if (action === 'approve') r = tournaments.approveTournament(id);
    else if (action === 'reject') r = tournaments.rejectTournament(id, req.body && req.body.reason);
    else r = tournaments.cancelTournament(id, req.body && req.body.reason);
    if (!r.ok) return res.status(400).json(r);
    // 取消时解散其进行中/等待中的对局房间（房内收 room_closed）
    if (r.matchIds && r.matchIds.length) {
      r.dissolvedMatches = protocol.rooms.dissolveTournamentMatches(r.matchIds);
    }
    res.json(r);
  };
  return [adminOnly, h]; // 同 adminWrite：返回数组，调用处不变，鉴权走同一个 adminOnly
}
app.post('/api/admin/tournaments/:id/approve', tournamentAction('approve'));
app.post('/api/admin/tournaments/:id/reject', tournamentAction('reject'));
app.post('/api/admin/tournaments/:id/cancel', tournamentAction('cancel'));

// 棋谱导出（权限：owner 或管理员）
app.get('/api/records/:id/export', (req, res) => {
  const fmt = req.query.fmt === 'csa' ? 'csa' : 'kif';
  const records = require('./src/records');
  const rec = records.getRecord(req.params.id);
  if (!rec) return res.status(404).json({ error: '棋谱不存在' });
  const guest = resolvePlayer(req.query.guest);
  // §L2：管理员 / 谱主 / 已公开棋谱 均可导出（管理员判定统一走 checkAdmin）
  if (!records.canView(rec, { playerId: guest, isAdmin: !!checkAdmin(req) })) {
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
  const guest = resolvePlayer(req.query.guest);
  // §L2：公开棋谱任何人可回放（管理员判定统一走 checkAdmin）
  if (!records.canView(rec, { playerId: guest, isAdmin: !!checkAdmin(req) })) {
    return res.status(403).json({ error: '只能回放自己的棋谱' });
  }
  res.json(records.playbackData(rec));
});

// 复盘数据（完整：含书签/评论/变着）。权限：owner 或管理员。
app.get('/api/records/:id/review', (req, res) => {
  const guest = resolvePlayer(req.query.guest);
  const records = require('./src/records');
  const rec = records.getRecord(req.params.id);
  if (!rec) return res.status(404).json({ error: '棋谱不存在' });
  // §L2：公开棋谱任何人可复盘（管理员判定统一走 checkAdmin）
  if (!records.canView(rec, { playerId: guest, isAdmin: !!checkAdmin(req) })) {
    return res.status(403).json({ error: '只能复盘自己的棋谱' });
  }
  res.json(records.reviewData(req.params.id));
});

// ---------- §L 公开棋谱广场 ----------

// 广场列表（公开棋谱，无需登录）：?tag=&q=&page=&limit=
app.get('/api/gallery', (req, res) => {
  const records = require('./src/records');
  res.json(records.listPublic({
    tag: req.query.tag || '',
    query: req.query.q || req.query.query || '',
    page: req.query.page || 1,
    limit: req.query.limit || 20,
  }));
});

// 设置公开/私有（管理员）
app.post('/api/admin/records/:id/visibility', adminOnly, (req, res) => {
  const records = require('./src/records');
  const r = records.setVisibility(req.params.id, (req.body || {}).visibility);
  audit.adminAction({ adminIp: req.clientIp || null, action: 'record-visibility', targetId: req.params.id, ok: !!r.ok, detail: { visibility: (req.body || {}).visibility } });
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json(r);
});

// 编辑展示信息（管理员）：标题/赛事/轮次/日期/标签/简介/双方名覆盖/结果说明/置顶
app.post('/api/admin/records/:id/meta', adminOnly, (req, res) => {
  const records = require('./src/records');
  const r = records.setMeta(req.params.id, req.body || {});
  audit.adminAction({ adminIp: req.clientIp || null, action: 'record-meta', targetId: req.params.id, ok: !!r.ok, detail: { fields: Object.keys(req.body || {}) } });
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json(r);
});

// 书签（toggle）
app.post('/api/records/:id/bookmark', (req, res) => {
  const guest = req.body && req.body.guest;
  const moveNo = req.body && req.body.moveNo;
  const on = !!(req.body && req.body.on);
  const records = require('./src/records');
  const rec = records.getRecord(req.params.id);
  if (!rec) return res.status(404).json({ error: '棋谱不存在' });
  if (!checkAdmin(req) && !records.isOwner(rec, guest)) {
    return res.status(403).json({ error: '无权操作' });
  }
  const r = records.toggleBookmark(req.params.id, moveNo, on);
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});

// 评论（§L3 升级）：新增 / 编辑（带 commentId）/ 删除（带 commentId 且 text 为空）
// 权限：谱主可写自己的评论；管理员可写、编辑、删除任意评论（force）
app.post('/api/records/:id/comment', (req, res) => {
  const isAdmin = !!checkAdmin(req); // 管理员判定统一走 checkAdmin
  const guest = resolvePlayer(req.body && req.body.guest);
  const moveNo = req.body && req.body.moveNo;
  const text = req.body && req.body.text;
  const commentId = (req.body && req.body.commentId) || null;
  const records = require('./src/records');
  const rec = records.getRecord(req.params.id);
  if (!rec) return res.status(404).json({ error: '棋谱不存在' });
  // §L：公开棋谱的评论仅管理员可维护（访客只读，避免展示内容被随意改动）
  if (records.isPublic(rec) && !isAdmin) {
    return res.status(403).json({ error: '公开棋谱的评论仅管理员可维护' });
  }
  if (!isAdmin && !records.isOwner(rec, guest)) {
    return res.status(403).json({ error: '无权操作（仅谱主与管理员可评论）' });
  }
  const session = auth.load(guest) || null;
  const authorName = isAdmin ? '管理员' : (session ? session.name : null);
  const r = records.setComment(req.params.id, moveNo, text, {
    authorId: guest,
    authorName,
    commentId,
    force: isAdmin,
  });
  if (isAdmin) {
    audit.adminAction({
      adminIp: req.clientIp || null,
      action: commentId ? 'record-comment-edit' : 'record-comment-add',
      targetId: req.params.id,
      ok: !!r.ok,
      detail: { moveNo, commentId, hasText: !!(text && String(text).trim()) },
    });
  }
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});

// 变着（添加一条变着走法）
app.post('/api/records/:id/variation', (req, res) => {
  const guest = req.body && req.body.guest;
  const parent = req.body && req.body.parent;
  const move = req.body && req.body.move;
  const records = require('./src/records');
  const rec = records.getRecord(req.params.id);
  if (!rec) return res.status(404).json({ error: '棋谱不存在' });
  if (!checkAdmin(req) && !records.isOwner(rec, guest)) {
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
  const playerId = resolvePlayer(req.query.player);
  if (!playerId) return res.status(400).json({ error: '缺少 player 参数' });
  res.json(protocol.profileData(playerId));
});

// 棋谱检索（REST 版，保留给管理后台/外部工具）：
//   ?query=关键词&player=&movesMin=&movesMax=&result=&opening=前N手(逗号分隔)&limit=
// 权限（PLAN §Q7 越权修复）：
//   - 管理员（adminToken）→ 可检索全部，或按 player 指定任一人
//   - 非管理员 → player 参数**必须是可验证的账号令牌**，且只能查该令牌自己的棋谱
//   - 游客 → 一律 403（游客 id 无法自证身份），前端改走 WS `record_search`
app.get('/api/records/search', rateLimit.expressMiddleware(rateLimit.heavy), (req, res) => {
  const isAdmin = !!checkAdmin(req); // 管理员判定统一走 checkAdmin
  const raw = req.query.player || null;

  let playerId = null;
  if (isAdmin) {
    playerId = raw ? resolvePlayer(raw) : null; // 管理员：可传 id，也可传账号令牌
  } else {
    const accountId = raw ? accounts.verifyToken(raw) : null;
    if (!accountId) {
      return res.status(403).json({
        error: '无权检索：请使用页面内的棋谱检索（已按你的登录身份过滤）',
      });
    }
    playerId = accountId; // 只允许查令牌自身的棋谱，忽略请求者可能夹带的其他 id
  }

  const q = {
    playerId,
    movesMin: req.query.movesMin != null ? parseInt(req.query.movesMin, 10) : undefined,
    movesMax: req.query.movesMax != null ? parseInt(req.query.movesMax, 10) : undefined,
    result: req.query.result || undefined,
    opening: req.query.opening || undefined,
    query: req.query.query || undefined,
    limit: req.query.limit != null ? parseInt(req.query.limit, 10) : 100,
  };
  res.json({ records: require('./src/records').searchRecords(q), isAdmin });
});

// ==================================================================
// 账号系统 REST
// ==================================================================

// 注册：{username, password, guestId?}（guestId 用于游客升级保留数据）
app.post('/api/register', rateLimit.expressMiddleware(rateLimit.auth), (req, res) => {
  const { username, password, guestId } = req.body || {};
  const r = accounts.register(username, password, guestId || null);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true, token: accounts.issueToken(r.account.id), account: r.account });
});

// 登录：{username, password}
app.post('/api/login', rateLimit.expressMiddleware(rateLimit.auth), (req, res) => {
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

// ==================================================================
// 个人资料（PLAN §F：手机号[私密]/棋风/注册日期）
// ==================================================================

// 本人资料（含手机号私密字段；需有效令牌）
app.get('/api/account/profile', (req, res) => {
  const accountId = accounts.verifyToken(req.query.token || '');
  if (!accountId) return res.status(401).json({ error: '未登录或令牌已失效' });
  res.json({ ok: true, account: accounts.getOwnProfile(accountId) });
});

// 更新资料（phone 传空串=清除；style 需在预设枚举内）
app.post('/api/account/profile', (req, res) => {
  const body = req.body || {};
  const accountId = accounts.verifyToken(body.token || '');
  if (!accountId) return res.status(401).json({ error: '未登录或令牌已失效' });
  const r = accounts.updateProfile(accountId, { phone: body.phone, style: body.style });
  if (!r.ok) return res.status(400).json(r);
  res.json({ ok: true, profile: r.profile });
});

// 玩家信息卡（公开，悬停小窗数据源；绝不返回手机号）
app.get('/api/player-card', (req, res) => {
  const card = protocol.playerCardData(String(req.query.id || ''));
  if (!card) return res.status(404).json({ error: '玩家不存在' });
  res.json(card);
});

// 服务器（同一实例承载 HTTP 与 WS）
const server = http.createServer(app);

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // 解析 guestId（从查询参数）
  const url = new URL(req.url, `http://${req.headers.host}`);
  const guestId = url.searchParams.get('guest') || null;
  // 传入客户端 IP/UA（PLAN §K1：登录记录与管理员审计的数据来源）
  protocol.handleConnection(ws, guestId, netInfo.clientInfo(req));
});

server.listen(PORT, () => {
  console.log(`TDShogi server v${VERSION} running at http://localhost:${PORT}`);
  console.log(`WebSocket listening on ws://localhost:${PORT}/ws`);
  // 注：棋谱摘要列回填已在 storage 初始化时完成（PLAN §Q7-2，见 src/storage.js initDb）
  // 数据库每日自动备份（PLAN §Q7-4）：全部资产在一个 SQLite 里，没有备份等于没保险。
  // 启动时补一次（今天没备过才备）+ 每 6 小时检查；失败只记日志，绝不影响对局服务。
  try {
    require('./src/backup').startAutoBackup();
  } catch (err) {
    console.error('[backup] 自动备份启动失败:', err.message);
  }
  // 清理过期的登录/审计日志（保留期与容量上限见 src/audit.js）
  try {
    const pruned = audit.prune();
    if (pruned.expired || pruned.overflow) {
      console.log(`[audit] 清理日志：过期 ${pruned.expired} 条，超出容量 ${pruned.overflow} 条，保留 ${pruned.kept} 条`);
    }
  } catch (err) {
    console.error('[audit] 日志清理失败:', err.message);
  }
  // 恢复上次运行未结束的对局（快照重启恢复）
  const restored = protocol.rooms.restoreSnapshots();
  if (restored > 0) console.log(`[rooms] 已恢复 ${restored} 场未完成对局`);
});
