/**
 * protocol.js — WebSocket 消息路由
 *
 * 负责：
 *  - 连接管理（建立/关闭/断线重连）
 *  - 游客鉴权（根据客户端 guestId 建立会话）
 *  - 客户端 → 服务端消息分发（调用 rooms 层）
 *  - 服务端 → 客户端消息回发（广播）
 *
 * 客户端消息（type 字段）：
 *   create_room / join_room / quick_match / cancel_match /
 *   move / resign / rematch / spectate / random_spectate /
 *   leave / rename / request_state / create_tournament / join_tournament
 *
 * 服务端消息（type 字段）：
 *   hello / matched / game_start / state / clock / move_invalid /
 *   game_over / elo_updated / spectator_update / tournament_update / error
 */
'use strict';

const auth = require('./auth');
const accounts = require('./accounts');
const admin = require('./admin');
const ratings = require('./ratings');
const { RoomManager } = require('./rooms');
const tournaments = require('./tournaments');
const { listRecords, listPlayerRecords, getRecord, exportRecord } = require('./records');
const { listAnnouncements } = require('./announcements');

class Protocol {
  constructor({ onBroadcast }) {
    // clientId -> ws
    this.clients = new Map();
    // clientId -> { playerId, name, guestId }
    this.playerRegistry = new Map();
    // guestId -> clientId
    this.guestToClient = new Map();

    this.rooms = new RoomManager((clientId, payload) => {
      const ws = this.clients.get(clientId);
      if (ws && ws.readyState === 1) {
        try { ws.send(JSON.stringify(payload)); } catch (_) {}
      }
    });
    // 供 rooms 层在匹配配对时取会话
    this.rooms.playerRegistry = (clientId) => {
      const info = this.playerRegistry.get(clientId);
      if (!info) return null;
      return { clientId, playerId: info.playerId, name: info.name };
    };
  }

  // ==================================================================
  // 连接管理
  // ==================================================================
  handleConnection(ws, guestId) {
    // guestId 可能是：游客 id（24 hex）或账号会话令牌（三段 . 分隔）
    // 会话令牌 → 解析为账号 id，使对局/评级/棋谱都绑定到账号
    let effectiveId = guestId;
    const accountId = accounts.verifyToken(guestId);
    if (accountId) effectiveId = accountId;
    // 建立游客/账号会话
    const session = auth.identify(effectiveId);
    const clientId = `${session.id}_${Date.now().toString(36)}`;
    this.clients.set(clientId, ws);
    this.playerRegistry.set(clientId, {
      playerId: session.id,
      name: session.name,
      guestId: session.id,
    });
    if (this.guestToClient.has(session.id)) {
      // 旧连接被新连接顶替（重连），通知旧连接下线
      const oldClient = this.guestToClient.get(session.id);
      const oldWs = this.clients.get(oldClient);
      if (oldWs && oldWs !== ws) {
        try { oldWs.send(JSON.stringify({ type: 'replaced' })); } catch (_) {}
      }
    }
    this.guestToClient.set(session.id, clientId);

    // 尝试断线重连（如果该玩家有一局未结束的对局）
    const reconnect = this.rooms.reconnect(clientId, session.id);

    // 发送欢迎消息 + 初始状态
    ws.send(JSON.stringify({
      type: 'hello',
      data: {
        clientId,
        playerId: session.id,
        name: session.name,
        reconnect: reconnect.ok ? reconnect : null,
        stats: this.rooms.stats(),
      },
    }));

    if (reconnect.ok) {
      const state = this.rooms.getRoomStateForClient(clientId);
      ws.send(JSON.stringify({ type: 'state', data: state }));
    }

    this._sendToPlayer(session.id, { type: 'player_updated', data: { id: session.id, name: session.name } });

    ws.on('message', (raw) => this._onMessage(clientId, raw));
    ws.on('close', () => this._onClose(clientId));
    ws.on('error', () => this._onClose(clientId));

    this._broadcastStats();
  }

  _onClose(clientId) {
    const info = this.playerRegistry.get(clientId);
    if (info && this.guestToClient.get(info.guestId) === clientId) {
      this.guestToClient.delete(info.guestId);
    }
    this.clients.delete(clientId);
    this.playerRegistry.delete(clientId);
    // 通知 rooms 层该客户端断开（对局中则开始 60 秒重连期）
    this.rooms._unbindClient(clientId);
    this._broadcastStats();
  }

  _onMessage(clientId, raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (_) {
      return this._error(clientId, '消息格式错误');
    }
    const info = this.playerRegistry.get(clientId);
    if (!info) return;
    const player = { clientId, playerId: info.playerId, name: info.name };
    this._route(clientId, player, msg);
  }

  // ==================================================================
  // 路由
  // ==================================================================
  _route(clientId, player, msg) {
    try {
      this._routeInner(clientId, player, msg);
    } catch (err) {
      console.error(`[protocol] 处理 ${msg && msg.type} 出错:`, err);
      this._error(clientId, '服务器内部错误');
    }
  }

  _routeInner(clientId, player, msg) {
    const { type, data } = msg;
    const r = this.rooms;
    switch (type) {
      case 'create_room': {
        const tc = data && data.timeControl;
        const res = r.createRoom(player, tc);
        this._send(clientId, { type: 'room_created', data: res });
        this._broadcastToRoomState(res.roomId);
        break;
      }
      case 'join_room': {
        const res = r.joinRoom(player, data && data.code);
        if (res.ok) {
          this._send(clientId, { type: 'room_joined', data: res });
        } else {
          this._error(clientId, res.error);
        }
        break;
      }
      case 'quick_match': {
        const res = r.quickMatch(player);
        if (!res.ok) this._error(clientId, res.error);
        else this._send(clientId, { type: 'matching', data: { ok: true } });
        break;
      }
      case 'cancel_match': {
        r.cancelMatch(clientId);
        this._send(clientId, { type: 'matching', data: { ok: false } });
        break;
      }
      case 'move': {
        const res = r.makeMove(clientId, data && data.usi);
        if (!res.ok) this._error(clientId, res.error || '走子失败');
        break;
      }
      case 'resign': {
        const res = r.resign(clientId);
        if (!res.ok) this._error(clientId, res.error);
        break;
      }
      case 'rematch': {
        r.rematch(clientId);
        break;
      }
      case 'spectate': {
        const res = r.spectate(clientId, data && data.roomId);
        if (res.ok) {
          this._send(clientId, { type: 'spectating', data: { roomId: res.roomId } });
          const state = r.getRoomStateForClient(clientId);
          this._send(clientId, { type: 'state', data: state });
        } else {
          this._error(clientId, res.error);
        }
        break;
      }
      case 'random_spectate': {
        const res = r.randomSpectate(clientId);
        if (res.ok) {
          this._send(clientId, { type: 'spectating', data: { roomId: res.roomId } });
          const state = r.getRoomStateForClient(clientId);
          this._send(clientId, { type: 'state', data: state });
        } else {
          this._error(clientId, res.error);
        }
        break;
      }
      case 'leave': {
        r.leave(clientId);
        this._send(clientId, { type: 'left' });
        break;
      }
      case 'rename': {
        const res = auth.rename(player.playerId, data && data.name);
        if (res.ok) {
          player.name = res.name;
          const info = this.playerRegistry.get(clientId);
          if (info) info.name = res.name;
          this._send(clientId, { type: 'renamed', data: { name: res.name } });
          // 同步进行中对局里该玩家的名字（对手即时看到新名）
          this.rooms.updatePlayerName(player.playerId, res.name);
          this._broadcastStats();
        } else {
          this._error(clientId, res.error);
        }
        break;
      }
      case 'request_state': {
        let state = r.getRoomStateForClient(clientId);
        // 页面跳转竞态兜底：新连接先于旧连接 close 到达时无绑定，
        // 按 playerId 强制绑回进行中的对局，避免页面空棋盘/时钟不动
        if (!state) {
          const bound = r.bindToActiveGame(clientId, player.playerId);
          if (bound && bound.ok) state = r.getRoomStateForClient(clientId);
        }
        if (state) this._send(clientId, { type: 'state', data: state });
        break;
      }
      case 'chat': {
        // 房间聊天（玩家/观战者）
        const res = r.chat(clientId, data && data.text);
        if (!res.ok) this._error(clientId, res.error);
        break;
      }
      case 'admin_login': {
        const res = admin.login(data && data.password);
        if (res.ok) {
          // 记录该连接的管理员 token（存客户端）
          this._send(clientId, { type: 'admin_logged_in', data: { token: res.token } });
        } else {
          this._error(clientId, res.error);
        }
        break;
      }
      case 'create_tournament': {
        const res = tournaments.createTournament(data && data.name, data && data.size, { id: player.playerId, name: player.name });
        if (res.ok) {
          this._send(clientId, { type: 'tournament_created', data: res.tournament });
        } else {
          this._error(clientId, res.error);
        }
        break;
      }
      case 'join_tournament': {
        const res = tournaments.joinTournament(data && data.id, { id: player.playerId, name: player.name });
        if (res.ok) {
          this._send(clientId, { type: 'tournament_joined', data: res.tournament });
        } else {
          this._error(clientId, res.error);
        }
        break;
      }
      case 'join_tournament_match': {
        // 玩家主动进入自己的赛事对局（建局时可能不在线）
        const res = r.joinTournamentMatch(clientId, data && data.roomId, player.playerId);
        if (!res.ok) this._error(clientId, res.error);
        break;
      }
      default:
        this._error(clientId, `未知消息类型: ${type}`);
    }
  }

  // ==================================================================
  // REST 辅助（供 server.js 调用）
  // ==================================================================
  lobbyData() {
    return {
      stats: this.rooms.stats(),
      games: this.rooms.activeGames(),
      announcements: listAnnouncements(),
      leaderboard: ratings.leaderboard(null, 10),
    };
  }

  homeData() {
    const lb = ratings.leaderboard(null, 10);
    return {
      stats: this.rooms.stats(),
      games: this.rooms.activeGames(),
      announcements: listAnnouncements(),
      leaderboard: lb,
    };
  }

  /**
   * 历史对局数据（权限隔离）：
   *  - 管理员（携带有效 token）→ 返回全部棋谱
   *  - 普通用户 → 只能返回自己的棋谱；未提供 playerId 且非管理员返回空
   * @param {string|null} playerId 请求方玩家 id
   * @param {string|null} adminToken 管理员 token
   */
  historyData(playerId, adminToken) {
    if (admin.verify(adminToken)) {
      // 管理员：返回全部棋谱（含公共 kif-import 库与所有用户对局）
      return { records: listRecords(1000), isAdmin: true };
    }
    // 普通用户：严格只能看自己的棋谱
    const own = playerId ? listPlayerRecords(playerId, 50) : [];
    return { records: own, isAdmin: false };
  }

  /**
   * 管理员：全部用户数据（评级 + 会话）。
   * 普通用户无权访问。
   */
  adminUsersData(adminToken) {
    if (!admin.verify(adminToken)) return null;
    return { users: ratings.allUsers() };
  }

  /**
   * 管理员：查看指定用户数据。
   */
  adminUserData(userId, adminToken) {
    if (!admin.verify(adminToken)) return null;
    if (!userId) return null;
    const prof = ratings.profile(userId);
    const records = listPlayerRecords(userId, 200);
    const session = auth.load(userId) || { name: userId };
    return { profile: prof, records, name: session.name };
  }

  exportData(recordId, fmt) {
    const rec = getRecord(recordId);
    if (!rec) return null;
    return { text: exportRecord(rec, fmt === 'csa' ? 'csa' : 'kif'), fmt: fmt === 'csa' ? 'csa' : 'kif' };
  }

  tournamentsData() {
    return { tournaments: tournaments.listTournaments() };
  }

  profileData(playerId) {
    const prof = ratings.profile(playerId);
    const records = require('./records').listPlayerRecords(playerId, 20);
    const session = auth.load(playerId) || { name: '无名棋士' };
    return { profile: prof, records, name: session.name };
  }

  // ==================================================================
  // 发送辅助
  // ==================================================================
  _send(clientId, payload) {
    const ws = this.clients.get(clientId);
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify(payload)); } catch (_) {}
    }
  }

  _error(clientId, message) {
    this._send(clientId, { type: 'error', data: { message } });
  }

  _sendToPlayer(playerId, payload) {
    const clientId = this.guestToClient.get(playerId);
    if (clientId) this._send(clientId, payload);
  }

  _broadcastToRoomState(roomId) {
    const state = this.rooms.getRoomStateForClient();
    void state;
  }

  _broadcastStats() {
    // 简易广播统计（对战页用 REST 轮询，这里可留空或推送给大厅）
  }

  getOnlineCount() {
    return this.clients.size;
  }
}

module.exports = { Protocol };
