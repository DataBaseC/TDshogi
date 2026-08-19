/**
 * rooms.js — 房间 / 匹配 / 对局状态机（服务端核心）
 *
 * 房间是实时对局的载体：
 *  - code: 6 位房间码（邀请好友）
 *  - game: Game 实例（shogi.js 权威规则）
 *  - players: { b, w } 玩家会话信息
 *  - spectators: 观战者 id 集合
 *
 * 对局状态机：WAITING → PLAYING → FINISHED（将死/投了/超时/离开），支持再来一局。
 * 快速匹配队列：两名玩家即可配对建房。
 * 广播：房间级 fan-out，避免全局广播。
 */
'use strict';

const { newGame, STARTING_SFEN } = require('./game');
const { saveRecord, getRecord } = require('./records');
const ratings = require('./ratings');
const { genId } = require('./auth');
const tournaments = require('./tournaments');

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去除易混淆字符
const RECONNECT_GRACE_MS = 60 * 1000; // 断线 60 秒重连期
const TICK_MS = 1000;                   // 棋钟 tick
const SNAPSHOT_INTERVAL_MS = parseInt(process.env.SNAPSHOT_INTERVAL_MS || '30000', 10) || 30000; // 进行中对局快照间隔（可配，默认 30s）

// 时间控制预设（房间 / 快速匹配可选）
//  - main: 本时（每方思考时间，ms）
//  - byoyomi: 秒读（本时用尽后每手限时，ms；0 = 包干，本时用尽即判负）
const TIME_CONTROLS = {
  '15+60': { id: '15+60', name: '15分钟 + 60秒', main: 15 * 60 * 1000, byoyomi: 60 * 1000 },
  '10+30': { id: '10+30', name: '10分钟 + 30秒', main: 10 * 60 * 1000, byoyomi: 30 * 1000 },
  '10:00': { id: '10:00', name: '10分钟包干',   main: 10 * 60 * 1000, byoyomi: 0 },
  '10sec': { id: '10sec', name: '10秒快棋',      main: 0,             byoyomi: 10 * 1000 }, // 0+10：每手 10 秒读秒
};

/**
 * 由时间控制生成房间时钟初始状态。
 * 0+10 快棋（main=0, byoyomi>0）：开局即进入读秒（本时恒 0，每手读秒）。
 */
function initClockState(tc) {
  return {
    clock: { b: tc.main, w: tc.main },
    byoyomi: tc.byoyomi,
    curByoyomi: { b: tc.byoyomi, w: tc.byoyomi },
    // main=0 且 byoyomi>0 → 开局即读秒；否则等待本时耗尽进入
    inByoyomi: { b: tc.main <= 0 && tc.byoyomi > 0, w: tc.main <= 0 && tc.byoyomi > 0 },
  };
}
const DEFAULT_TIME_CONTROL = '10:00'; // 快速匹配 / 默认标准对局：10 分钟包干

// 持驹中文名 -> 打子符号（与 game.js legalTargets 的 drop 符号一致）
const DROP_SYMBOL_BY_NAME = { '歩': 'P', '香': 'L', '桂': 'N', '銀': 'S', '金': 'G', '角': 'B', '飛': 'R' };

class RoomManager {
  constructor(broadcaster) {
    this.broadcaster = broadcaster; // (clientId, payload) => void
    this.rooms = new Map();         // roomId -> room
    this.byCode = new Map();        // code -> roomId
    this.matchQueue = [];           // 快速匹配队列（clientId 数组）
    this.clientToRoom = new Map();  // clientId -> roomId（含观战）
    this.clientToPlayer = new Map();// clientId -> {roomId, seat}
    this.playerToClient = new Map();// playerId -> clientId（当前活跃连接）
    this.spectatorsByRoom = new Map();// roomId -> Set<clientId>
    this._clockTimers = new Map();  // roomId -> interval
    this._disconnectTimers = new Map(); // roomId -> Map<seat, timer>（断线宽限期）
    // 对局快照定时器（进行中对局定期落盘，重启可恢复）
    this._snapshotTimer = setInterval(() => this._snapshotAll(), SNAPSHOT_INTERVAL_MS);
    // 赛事建房工厂：供 tournaments 层推进对阵表时创建对局
    tournaments.setMatchFactory((tournamentId, playerIds) =>
      this.createTournamentMatch(tournamentId, playerIds));
  }

  // ==================================================================
  // 工具
  // ==================================================================
  _genRoomCode() {
    let code;
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      }
    } while (this.byCode.has(code));
    return code;
  }

  _room(roomId) {
    return this.rooms.get(roomId);
  }

  _broadcast(roomId, payload) {
    const room = this._room(roomId);
    if (!room) return;
    const ids = new Set();
    if (room.players.b) ids.add(room.players.b.clientId);
    if (room.players.w) ids.add(room.players.w.clientId);
    const specs = this.spectatorsByRoom.get(roomId) || new Set();
    for (const sid of specs) ids.add(sid);
    for (const cid of ids) this.broadcaster(cid, payload);
  }

  _broadcastLobby() {
    // 对战页进行中对局列表、首页统计由 REST 轮询，这里省略
  }

  _gameState(room, includeLegal = true) {
    const st = room.game.state();
    st.roomId = room.id;
    st.code = room.code;
    st.status = room.status;
    // 日式记谱（如「７六歩(77)」「同　銀(33)」），前端走子列表直接可读
    try {
      const { movesToKif } = require('./records');
      st.movesKif = movesToKif(room.game.startSfen || STARTING_SFEN, room.game.moves || []);
    } catch (_) {
      st.movesKif = [];
    }
    st.players = {
      b: room.players.b ? { name: room.players.b.name, rating: ratings.profile(room.players.b.playerId).rating } : null,
      w: room.players.w ? { name: room.players.w.name, rating: ratings.profile(room.players.w.playerId).rating } : null,
    };
    st.clock = { b: room.clock.b, w: room.clock.w };
    st.timeControl = room.timeControl || DEFAULT_TIME_CONTROL;
    st.byoyomi = room.byoyomi || 0;
    st.curByoyomi = room.curByoyomi ? { ...room.curByoyomi } : null;
    st.inByoyomi = room.inByoyomi ? { ...room.inByoyomi } : null;
    st.roomType = room.type;
    st.seat = null;
    if (!includeLegal || room.status !== 'PLAYING') {
      st.legalMoves = [];
      st.legalTargetsBySq = {};
    } else {
      st.legalMoves = room.game.legalMovesUsi();
      // 当前走子方各起点的合法目标（含打子符号）
      st.legalTargetsBySq = this._legalTargetsMap(room.game);
    }
    return st;
  }

  _legalTargetsMap(game) {
    const map = {};
    const color = game.turn;
    // 盘上起点
    const board = game.state().board;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = board[r][c];
        if (cell && cell.piece && cell.color === color) {
          map[cell.sq] = game.legalTargets(cell.sq);
        }
      }
    }
    // 打子符号（有持驹时）
    const hands = game.hands();
    (hands[color] || []).forEach((h) => {
      const sym = DROP_SYMBOL_BY_NAME[h.piece];
      if (sym) map[sym] = game.legalTargets(sym);
    });
    return map;
  }

  // ==================================================================
  // 对局创建 / 加入
  // ==================================================================

  /**
   * 创建房间（host 作为先手或随机）。
   * @param {object} host { clientId, playerId, name }
   * @returns {{roomId:string, code:string, seat:'b'|'w'}}
   */
  createRoom(host, timeControlId) {
    // 若在已结束的对局中则自动退出，允许直接建房
    this._autoLeaveFinished(host.clientId);
    const tc = TIME_CONTROLS[timeControlId] || TIME_CONTROLS[DEFAULT_TIME_CONTROL];
    const code = this._genRoomCode();
    const roomId = genId();
    const room = {
      id: roomId,
      code,
      game: newGame(),
      players: { b: null, w: null },
      status: 'WAITING',       // WAITING | PLAYING | FINISHED
      type: 'room',
      creatorId: host.playerId,
      createdAt: Date.now(),
      timeControl: tc.id,
      ...initClockState(tc),
      lastMoveTs: null,
      lastActiveAt: Date.now(),
      result: null,
      resultDetail: null,
      rated: true,
      tournamentId: null,
    };
    // host 随机执先手
    const seat = Math.random() < 0.5 ? 'b' : 'w';
    room.players[seat] = {
      clientId: host.clientId,
      playerId: host.playerId,
      name: host.name,
      connected: true,
    };
    this.rooms.set(roomId, room);
    this.byCode.set(code, roomId);
    this._bindClient(host.clientId, roomId, seat);
    return { roomId, code, seat };
  }

  /**
   * 加入房间（按房间码）。
   * @param {object} player { clientId, playerId, name }
   * @param {string} code
   */
  joinRoom(player, code) {
    // 若在已结束的对局中则自动退出，允许加入新房间
    this._autoLeaveFinished(player.clientId);
    const roomId = this.byCode.get(code.trim().toUpperCase());
    if (!roomId) return { ok: false, error: '房间不存在或房间码错误' };
    const room = this._room(roomId);
    if (room.status !== 'WAITING') return { ok: false, error: '对局已经开始，无法加入' };
    // 空位
    let seat = null;
    if (!room.players.b) seat = 'b';
    else if (!room.players.w) seat = 'w';
    else return { ok: false, error: '房间已满' };
    if (room.players[seat] && room.players[seat].playerId === player.playerId) {
      return { ok: false, error: '你已在房间中' };
    }
    room.players[seat] = {
      clientId: player.clientId,
      playerId: player.playerId,
      name: player.name,
      connected: true,
    };
    this._bindClient(player.clientId, roomId, seat);
    this._startGame(room);
    return { ok: true, roomId, code, seat };
  }

  /**
   * 快速匹配：将玩家放入队列，两人即配对。
   */
  quickMatch(player) {
    // 若在已结束的对局中则自动退出（否则会误报"你已在房间中"）
    this._autoLeaveFinished(player.clientId);
    // 已在对局中
    const cur = this.clientToRoom.get(player.clientId);
    if (cur) return { ok: false, error: '你已在房间中' };
    if (this.matchQueue.includes(player.clientId)) return { ok: false, error: '已在匹配队列中' };
    this.matchQueue.push(player.clientId);
    // 配对
    if (this.matchQueue.length >= 2) {
      const c1 = this.matchQueue.shift();
      const c2 = this.matchQueue.shift();
      // 从广播器/玩家表取会话信息（由 protocol 层注入 player registry）
      const p1 = this.playerRegistry ? this.playerRegistry(c1) : null;
      const p2 = this.playerRegistry ? this.playerRegistry(c2) : null;
      if (p1 && p2) {
        this._startQuickMatch(p1, p2);
      } else {
        // 无法配对则回退到创建房间
        const p = p1 || p2;
        if (p) this.createRoom(p);
      }
    }
    return { ok: true };
  }

  cancelMatch(clientId) {
    const idx = this.matchQueue.indexOf(clientId);
    if (idx >= 0) this.matchQueue.splice(idx, 1);
    return { ok: true };
  }

  /**
   * 若玩家当前绑定的房间已结束（FINISHED），自动解除绑定。
   * 这样赢家/输家无需手动点「退出」即可再次匹配或建房。
   * @returns {boolean} 是否发生了解绑
   */
  _autoLeaveFinished(clientId) {
    const curRoomId = this.clientToRoom.get(clientId);
    if (!curRoomId) return false;
    const room = this._room(curRoomId);
    if (room && room.status === 'FINISHED') {
      // 从结束房间的座位记录中移除该客户端（避免继续广播到此连接）
      const seat = this.clientToPlayer.get(clientId);
      if (seat && room.players[seat.seat]) {
        this.playerToClient.delete(room.players[seat.seat].playerId);
        room.players[seat.seat] = null;   // 清空座位，房间可被再次加入（若 WAITING 已不可能，但保持干净）
      }
      this._unbindClient(clientId);
      return true;
    }
    return false;
  }

  _startQuickMatch(p1, p2) {
    const code = this._genRoomCode();
    const roomId = genId();
    const tc = TIME_CONTROLS[DEFAULT_TIME_CONTROL]; // 快速匹配固定 10 分钟包干
    const room = {
      id: roomId,
      code,
      game: newGame(),
      players: { b: null, w: null },
      status: 'PLAYING',
      type: 'quick',
      creatorId: null,
      createdAt: Date.now(),
      timeControl: tc.id,
      ...initClockState(tc),
      lastMoveTs: Date.now(),
      lastActiveAt: Date.now(),
      result: null,
      resultDetail: null,
      rated: true,
      tournamentId: null,
    };
    const seatB = Math.random() < 0.5 ? p1 : p2;
    const seatW = seatB === p1 ? p2 : p1;
    room.players.b = { ...seatB, connected: true, clientId: seatB.clientId };
    room.players.w = { ...seatW, connected: true, clientId: seatW.clientId };
    this.rooms.set(roomId, room);
    this.byCode.set(code, roomId);
    this._bindClient(seatB.clientId, roomId, 'b');
    this._bindClient(seatW.clientId, roomId, 'w');
    this._startClock(room);
    // 通知双方开赛
    this._broadcast(roomId, { type: 'game_start', data: { roomId, code, seat: this.clientToPlayer.get(seatB.clientId).seat } });
    this._send(seatB.clientId, { type: 'matched', data: { roomId, code } });
    this._send(seatW.clientId, { type: 'matched', data: { roomId, code } });
    this._pushState(room);
  }

  _startGame(room) {
    room.status = 'PLAYING';
    room.lastMoveTs = Date.now();
    this._startClock(room);
    this._broadcast(room.id, { type: 'game_start', data: { roomId: room.id, code: room.code } });
    this._pushState(room);
  }

  // ==================================================================
  // 赛事对局
  // ==================================================================

  /**
   * 为赛事创建一场对局（双方由 playerId 指定，系统直接建房，无等待期）。
   * @param {string} tournamentId
   * @param {string[]} playerIds [先手, 后手]
   * @returns {{roomId:string}|null}
   */
  createTournamentMatch(tournamentId, playerIds) {
    if (!tournamentId || !Array.isArray(playerIds) || playerIds.length !== 2) return null;
    const code = this._genRoomCode();
    const roomId = genId();
    const tc = TIME_CONTROLS[DEFAULT_TIME_CONTROL];
    const room = {
      id: roomId,
      code,
      game: newGame(),
      players: { b: null, w: null },
      status: 'PLAYING',
      type: 'tournament',
      creatorId: null,
      createdAt: Date.now(),
      timeControl: tc.id,
      ...initClockState(tc),
      lastMoveTs: Date.now(),
      lastActiveAt: Date.now(),
      result: null,
      resultDetail: null,
      rated: false, // 赛事对局不计 ELO
      tournamentId,
    };
    // 绑定双方（若在线；不在线则由其主动 joinTournamentMatch 进入）
    const attach = (seat, playerId) => {
      const clientId = this.playerToClient.get(playerId);
      if (clientId) {
        room.players[seat] = { clientId, playerId, name: this._playerName(playerId), connected: true };
        this._bindClient(clientId, roomId, seat);
      } else {
        room.players[seat] = { clientId: null, playerId, name: this._playerName(playerId), connected: false };
      }
    };
    const seatB = Math.random() < 0.5 ? playerIds[0] : playerIds[1];
    const seatW = seatB === playerIds[0] ? playerIds[1] : playerIds[0];
    attach('b', seatB);
    attach('w', seatW);
    this.rooms.set(roomId, room);
    this.byCode.set(code, roomId);
    this._startClock(room);
    this._broadcast(roomId, { type: 'game_start', data: { roomId, code } });
    this._pushState(room);
    return { roomId };
  }

  _playerName(playerId) {
    const sess = require('./auth').load(playerId);
    return sess && sess.name ? sess.name : playerId.slice(0, 6);
  }

  /**
   * 玩家主动进入自己的赛事对局（建局时可能不在线）。
   */
  joinTournamentMatch(clientId, roomId, playerId) {
    const room = this._room(roomId);
    if (!room || room.type !== 'tournament') return { ok: false, error: '赛事对局不存在' };
    let seat = null;
    for (const s of ['b', 'w']) {
      const p = room.players[s];
      if (p && p.playerId === playerId) { seat = s; break; }
    }
    if (!seat) return { ok: false, error: '你不是该对局的参赛者' };
    if (room.players[seat].connected && room.players[seat].clientId !== clientId) {
      return { ok: false, error: '该座位已有连接' };
    }
    const p = room.players[seat];
    p.clientId = clientId;
    p.connected = true;
    p.name = this._playerName(playerId);
    this._bindClient(clientId, roomId, seat);
    this._pushState(room);
    return { ok: true, roomId, seat };
  }

  // ==================================================================
  // 走子 / 认输 / 再来一局 / 离开
  // ==================================================================

  /**
   * 走子。返回 {ok, error?}。
   */
  makeMove(clientId, usi) {
    const seat = this.clientToPlayer.get(clientId);
    if (!seat) return { ok: false, error: '你不在对局中' };
    const room = this._room(seat.roomId);
    if (!room || room.status !== 'PLAYING') return { ok: false, error: '对局未在进行' };
    const game = room.game;
    if (seat.seat !== game.turn) return { ok: false, error: '还没轮到你' };
    if (!game.isGameOver()) {
      const r = game.applyMove(usi);
      if (!r.ok) return { ok: false, error: r.error || '非法走法' };
      room.lastMoveTs = Date.now();
      room.lastActiveAt = Date.now();
      // 走子后重置下一手玩家的读秒（进入新回合计时）
      if (room.inByoyomi) {
        const nextTurn = game.turn;
        room.inByoyomi[nextTurn] = false;
        room.curByoyomi[nextTurn] = room.byoyomi;
      }
      this._checkGameOver(room);
      this._pushState(room);
      return { ok: true };
    }
    return { ok: false, error: '对局已结束' };
  }

  resign(clientId) {
    const seat = this.clientToPlayer.get(clientId);
    if (!seat) return { ok: false, error: '你不在对局中' };
    const room = this._room(seat.roomId);
    if (!room || room.status !== 'PLAYING') return { ok: false, error: '对局未在进行' };
    if (room.game.isGameOver()) return { ok: false, error: '对局已结束' };
    // 认输：判「认输座位」负，而不是当前手番方（避免非手番方认输误判对手）
    room.game.result = seat.seat === 'b' ? 'w' : 'b';
    room.game.resultDetail = '投了';
    this._checkGameOver(room);
    this._pushState(room);
    return { ok: true };
  }

  /**
   * 房间聊天：玩家或观战者发言，广播给房间内所有人（含观战者）。
   * 防刷屏：单客户端 2 秒内最多 1 条。
   */
  chat(clientId, text) {
    const msg = String(text || '').trim().slice(0, 200);
    if (!msg) return { ok: false, error: '消息为空' };
    const roomId = this.clientToRoom.get(clientId);
    if (!roomId) return { ok: false, error: '你不在任何房间中' };
    const room = this._room(roomId);
    if (!room) return { ok: false, error: '房间不存在' };
    // 节流
    const now = Date.now();
    if (this._lastChatTs && this._lastChatTs[clientId] && now - this._lastChatTs[clientId] < 2000) {
      return { ok: false, error: '发言太频繁，请稍候' };
    }
    this._lastChatTs = this._lastChatTs || {};
    this._lastChatTs[clientId] = now;
    // 发言者名字
    const seat = this.clientToPlayer.get(clientId);
    const name = seat && room.players[seat.seat] ? room.players[seat.seat].name : '观众';
    this._broadcast(roomId, {
      type: 'chat',
      data: { name, text: msg, ts: now },
    });
    return { ok: true };
  }

  _checkGameOver(room) {
    const game = room.game;
    if (!game.isGameOver()) return;
    if (room.status === 'FINISHED') return;
    room.status = 'FINISHED';
    room.result = game.result;
    room.resultDetail = game.resultDetail;
    this._stopClock(room);
    // 对局结束：清理断线宽限计时器 + 清除快照（对局已落盘 records，无需恢复）
    const timers = this._disconnectTimers.get(room.id);
    if (timers) {
      for (const t of timers.values()) clearTimeout(t);
      this._disconnectTimers.delete(room.id);
    }
    this._clearSnapshot(room.id);
    this._finalize(room);
  }

  _finalize(room) {
    const game = room.game;
    const b = room.players.b;
    const w = room.players.w;
    // 胜者 id（与 rated 无关：赛事对局虽不计 ELO，但必须推进对阵表）
    let winnerId = null;
    if (game.result === 'b') winnerId = b ? b.playerId : null;
    else if (game.result === 'w') winnerId = w ? w.playerId : null;
    // ELO 结算（仅 rated 房间）
    if (room.rated && b && w && game.result) {
      ratings.applyGameResult(b.playerId, w.playerId, game.result);
    }
    // 保存棋谱
    const record = saveRecord({
      startSfen: game.startSfen,
      moves: game.moves,
      names: [b ? b.name : '先手', w ? w.name : '後手'],
      result: game.result,
      resultDetail: game.resultDetail,
      playerIds: { b: b ? b.playerId : null, w: w ? w.playerId : null },
      winnerId,
      durationSec: Math.round((Date.now() - room.createdAt) / 1000),
    });
    room.recordId = record.id;
    // 赛事回调
    if (room.tournamentId && winnerId) {
      const { onMatchFinished } = require('./tournaments');
      onMatchFinished(room.tournamentId, room.id, winnerId);
    }
    // 广播对局结束
    this._broadcast(room.id, {
      type: 'game_over',
      data: {
        roomId: room.id,
        result: game.result,
        resultDetail: game.resultDetail,
        winnerId,
        recordId: record.id,
        names: [b ? b.name : '先手', w ? w.name : '後手'],
      },
    });
    this._pushState(room);
  }

  rematch(clientId) {
    const seat = this.clientToPlayer.get(clientId);
    if (!seat) return { ok: false, error: '你不在对局中' };
    const room = this._room(seat.roomId);
    if (!room || room.status !== 'FINISHED') return { ok: false, error: '对局尚未结束' };
    room.rematchVotes = room.rematchVotes || {};
    const already = !!room.rematchVotes[seat.seat];
    room.rematchVotes[seat.seat] = true;
    if (room.rematchVotes.b && room.rematchVotes.w) {
      // 双方同意，重置对局
      room.game = newGame();
      room.status = 'PLAYING';
      room.result = null;
      room.resultDetail = null;
      const tc = TIME_CONTROLS[room.timeControl] || TIME_CONTROLS[DEFAULT_TIME_CONTROL];
      Object.assign(room, initClockState(tc));
      room.lastMoveTs = Date.now();
      room.lastActiveAt = Date.now();
      room.recordId = null;
      room.rematchVotes = {};
      this._startClock(room);
      this._broadcast(room.id, { type: 'game_start', data: { roomId: room.id, code: room.code } });
      this._pushState(room);
    } else if (!already) {
      // 仅一方请求：通知对手「对手请求再来一局」
      const requester = room.players[seat.seat];
      const oppSeat = seat.seat === 'b' ? 'w' : 'b';
      const opp = room.players[oppSeat];
      const payload = {
        type: 'rematch_requested',
        data: {
          requesterName: requester ? requester.name : '对手',
          seat: seat.seat,
        },
      };
      if (opp && opp.clientId) this._send(opp.clientId, payload);
    }
    return { ok: true };
  }

  leave(clientId) {
    this.cancelMatch(clientId);
    // 观战者：从观战列表移除并解绑（否则残留导致继续收广播 + 内存泄漏）
    const specRoomId = this.clientToRoom.get(clientId);
    if (specRoomId && !this.clientToPlayer.has(clientId)) {
      const specs = this.spectatorsByRoom.get(specRoomId);
      if (specs) {
        specs.delete(clientId);
        if (specs.size === 0) this.spectatorsByRoom.delete(specRoomId);
      }
      this.clientToRoom.delete(clientId);
      return { ok: true };
    }
    const seat = this.clientToPlayer.get(clientId);
    if (!seat) return { ok: true };
    const room = this._room(seat.roomId);
    if (!room) return { ok: true };
    // 对局中离开 → 判「离开座位」负（而不是当前手番方）
    if (room.status === 'PLAYING' && !room.game.isGameOver()) {
      room.game.result = seat.seat === 'b' ? 'w' : 'b';
      room.game.resultDetail = '投了';
      this._checkGameOver(room);
    }
    this._unbindClient(clientId);
    return { ok: true };
  }

  // ==================================================================
  // 观战
  // ==================================================================
  spectate(clientId, roomId) {
    const room = this._room(roomId);
    if (!room) return { ok: false, error: '对局不存在' };
    // 已在房间（玩家）则不重复
    if (this.clientToPlayer.has(clientId)) return { ok: true, roomId };
    if (!this.spectatorsByRoom.has(roomId)) this.spectatorsByRoom.set(roomId, new Set());
    this.spectatorsByRoom.get(roomId).add(clientId);
    this.clientToRoom.set(clientId, roomId);
    return { ok: true, roomId };
  }

  randomSpectate(clientId) {
    const playing = [...this.rooms.values()].filter((r) => r.status === 'PLAYING');
    if (!playing.length) return { ok: false, error: '当前没有进行中的对局' };
    const room = playing[Math.floor(Math.random() * playing.length)];
    const res = this.spectate(clientId, room.id);
    return res;
  }

  // ==================================================================
  // 客户端绑定 / 广播辅助
  // ==================================================================
  _bindClient(clientId, roomId, seat) {
    this.clientToRoom.set(clientId, roomId);
    this.clientToPlayer.set(clientId, { roomId, seat });
    const room = this._room(roomId);
    if (room && room.players[seat]) {
      this.playerToClient.set(room.players[seat].playerId, clientId);
      // 重连成功：清除断线宽限计时器
      this._clearDisconnectTimer(roomId, seat);
    }
  }

  _unbindClient(clientId) {
    // 观战者断线：同样清理（否则残留收广播 + 泄漏）
    const specRoomId = this.clientToRoom.get(clientId);
    if (specRoomId && !this.clientToPlayer.has(clientId)) {
      const specs = this.spectatorsByRoom.get(specRoomId);
      if (specs) {
        specs.delete(clientId);
        if (specs.size === 0) this.spectatorsByRoom.delete(specRoomId);
      }
    }
    const seat = this.clientToPlayer.get(clientId);
    if (seat) {
      const room = this._room(seat.roomId);
      if (room && room.players[seat.seat]) {
        this.playerToClient.delete(room.players[seat.seat].playerId);
        room.players[seat.seat].connected = false;
        // 对局中玩家断线：启动宽限期计时，超时未重连则判负
        if (room.status === 'PLAYING' && !room.game.isGameOver()) {
          this._scheduleDisconnectLoss(room.id, seat.seat);
        }
      }
    }
    this.clientToPlayer.delete(clientId);
    this.clientToRoom.delete(clientId);
  }

  _send(clientId, payload) {
    this.broadcaster(clientId, payload);
  }

  /**
   * 断线宽限期：对局中玩家断线后，超过 RECONNECT_GRACE_MS 未重连则判负。
   * 重连成功时由 _bindClient 清除对应计时器。
   */
  _scheduleDisconnectLoss(roomId, seat) {
    const room = this._room(roomId);
    if (!room) return;
    const timers = this._disconnectTimers.get(roomId) || new Map();
    // 幂等：同座位已有计时器则跳过
    if (timers.has(seat)) return;
    const timer = setTimeout(() => {
      const cur = this._room(roomId);
      if (!cur || cur.status !== 'PLAYING' || cur.game.isGameOver()) return;
      const p = cur.players[seat];
      // 仍未重连 → 判该座位负
      if (p && !p.connected) {
        cur.game.result = seat === 'b' ? 'w' : 'b';
        cur.game.resultDetail = '投了';
        this._checkGameOver(cur);
      }
      timers.delete(seat);
      if (timers.size === 0) this._disconnectTimers.delete(roomId);
    }, RECONNECT_GRACE_MS);
    timers.set(seat, timer);
    this._disconnectTimers.set(roomId, timers);
  }

  _clearDisconnectTimer(roomId, seat) {
    const timers = this._disconnectTimers.get(roomId);
    if (!timers) return;
    const t = timers.get(seat);
    if (t) { clearTimeout(t); timers.delete(seat); }
    if (timers.size === 0) this._disconnectTimers.delete(roomId);
  }

  // 玩家改名同步：更新对局中双方的名字并推送
  updatePlayerName(playerId, newName) {
    for (const room of this.rooms.values()) {
      let updated = false;
      for (const seat of ['b', 'w']) {
        const p = room.players[seat];
        if (p && p.playerId === playerId && p.name !== newName) {
          p.name = newName;
          updated = true;
        }
      }
      if (updated) {
        console.log(`[rooms] 玩家 ${playerId} 改名→${newName}，房间 ${room.id} state 广播`);
        this._pushState(room);
      }
    }
  }

  _pushState(room) {
    // 对每个客户端单独推送（带各自 seat，观战者不带合法走法信息）
    const clientIds = new Set();
    for (const seat of ['b', 'w']) {
      const p = room.players[seat];
      if (p) clientIds.add(p.clientId);
    }
    const specs = this.spectatorsByRoom.get(room.id) || new Set();
    for (const sid of specs) clientIds.add(sid);
    for (const cid of clientIds) {
      const info = this.clientToPlayer.get(cid);
      const state = this._gameState(room, info ? true : false);
      state.seat = info ? info.seat : null;
      state.isPlayer = !!info;
      this.broadcaster(cid, { type: 'state', data: state });
    }
  }

  // ==================================================================
  // 棋钟
  // ==================================================================
  _startClock(room) {
    this._stopClock(room.id);
    const timer = setInterval(() => this._tick(room.id), TICK_MS);
    this._clockTimers.set(room.id, timer);
  }

  _stopClock(roomId) {
    const timer = this._clockTimers.get(roomId);
    if (timer) clearInterval(timer);
    this._clockTimers.delete(roomId);
  }

  _tick(roomId) {
    const room = this._room(roomId);
    if (!room || room.status !== 'PLAYING') return;
    const turn = room.game.turn;
    const byoyomi = room.byoyomi || 0;

    if (room.clock[turn] > 0) {
      // 本时消耗
      room.clock[turn] -= TICK_MS;
      if (room.clock[turn] <= 0) {
        room.clock[turn] = 0;
        if (byoyomi > 0) {
          // 本时耗尽 → 进入读秒：给当前手完整的 byoyomi
          room.inByoyomi[turn] = true;
          room.curByoyomi[turn] = byoyomi;
          this._broadcast(roomId, { type: 'clock', data: this._clockData(room) });
        } else {
          // 包干：本时用尽即判负
          const game = room.game;
          game.result = turn === 'b' ? 'w' : 'b';
          game.resultDetail = '時間切れ';
          this._checkGameOver(room);
        }
      } else {
        this._broadcast(roomId, { type: 'clock', data: this._clockData(room) });
      }
    } else if (byoyomi > 0) {
      // 本时已为 0（含 0+10 快棋：初始即读秒）
      if (!room.inByoyomi[turn]) {
        room.inByoyomi[turn] = true;
        room.curByoyomi[turn] = byoyomi;
      }
      // 读秒中
      room.curByoyomi[turn] -= TICK_MS;
      if (room.curByoyomi[turn] <= 0) {
        room.curByoyomi[turn] = 0;
        const game = room.game;
        game.result = turn === 'b' ? 'w' : 'b';
        game.resultDetail = '時間切れ';
        this._checkGameOver(room);
      } else {
        this._broadcast(roomId, { type: 'clock', data: this._clockData(room) });
      }
    }
    // byoyomi === 0 且 clock === 0 的包干情况：已在上一分支 clock 耗尽时判负，无需处理
  }

  _clockData(room) {
    return {
      clock: { ...room.clock },
      byoyomi: room.byoyomi || 0,
      curByoyomi: room.curByoyomi ? { ...room.curByoyomi } : null,
      inByoyomi: room.inByoyomi ? { ...room.inByoyomi } : null,
      turn: room.game.turn,
    };
  }

  // ==================================================================
  // 断线重连
  // ==================================================================

  /**
   * 探测玩家是否有未结束的对局（不绑定，仅报告；绑定由 request_state 完成，
   * 避免同 guestId 的观战窗口连接时误绑玩家座位）。
   * @returns {{roomId:string, seat:string}|null}
   */
  findPendingGame(playerId) {
    for (const room of this.rooms.values()) {
      if (room.status !== 'PLAYING') continue;
      for (const seat of ['b', 'w']) {
        const p = room.players[seat];
        if (p && p.playerId === playerId) {
          return { roomId: room.id, seat };
        }
      }
    }
    return null;
  }

  reconnect(clientId, playerId) {
    // 根据 playerId 找到其所在房间（可能断线）
    for (const room of this.rooms.values()) {
      for (const seat of ['b', 'w']) {
        const p = room.players[seat];
        if (p && p.playerId === playerId && !p.connected) {
          // 找到断线的对局，重连
          p.clientId = clientId;
          p.connected = true;
          this._bindClient(clientId, room.id, seat);
          return { ok: true, roomId: room.id, seat, reconnect: true };
        }
      }
    }
    return { ok: false };
  }

  /**
   * 兜底绑定：玩家页面跳转时，新连接可能先于旧连接 close 到达，
   * 此时 reconnect() 找不到 connected=false 的座位。这里按 playerId
   * 强制把新连接绑回其进行中的对局（顶替旧连接，不依赖 close 时序）。
   * @returns {{roomId:string, seat:string}|null}
   */
  bindToActiveGame(clientId, playerId) {
    for (const room of this.rooms.values()) {
      if (room.status === 'FINISHED') continue;
      for (const seat of ['b', 'w']) {
        const p = room.players[seat];
        if (p && p.playerId === playerId) {
          // 若旧连接仍在（竞态），先解除旧 clientId 的绑定关系
          if (p.clientId && p.clientId !== clientId) {
            this.clientToRoom.delete(p.clientId);
            this.clientToPlayer.delete(p.clientId);
            this.playerToClient.delete(p.playerId);
          }
          p.clientId = clientId;
          p.connected = true;
          this._bindClient(clientId, room.id, seat);
          return { ok: true, roomId: room.id, seat };
        }
      }
    }
    return { ok: false };
  }

  // ==================================================================
  // 列表 / 信息
  // ==================================================================
  activeGames() {
    return [...this.rooms.values()]
      .filter((r) => r.status === 'PLAYING')
      .map((r) => ({
        roomId: r.id,
        code: r.code,
        players: {
          b: r.players.b ? r.players.b.name : null,
          w: r.players.w ? r.players.w.name : null,
        },
        moveCount: r.game.moves.length,
        type: r.type,
        createdAt: r.createdAt,
      }));
  }

  getRoomStateForClient(clientId) {
    const roomId = this.clientToRoom.get(clientId);
    if (!roomId) return null;
    const room = this._room(roomId);
    if (!room) return null;
    const info = this.clientToPlayer.get(clientId);
    const state = this._gameState(room, info ? true : false);
    state.seat = info ? info.seat : null;
    state.isPlayer = !!info;
    return state;
  }

  // ==================================================================
  // 对局快照 / 重启恢复
  // ==================================================================

  /**
   * 序列化房间为可恢复的快照（不包含连接态：clientId/spectators 等运行时信息）。
   */
  _serializeRoom(room) {
    const game = room.game;
    return {
      id: room.id,
      code: room.code,
      status: room.status,
      type: room.type,
      creatorId: room.creatorId,
      createdAt: room.createdAt,
      timeControl: room.timeControl,
      clock: { ...room.clock },
      byoyomi: room.byoyomi,
      curByoyomi: room.curByoyomi ? { ...room.curByoyomi } : null,
      inByoyomi: room.inByoyomi ? { ...room.inByoyomi } : null,
      rated: room.rated,
      tournamentId: room.tournamentId,
      // 对局数据：startSfen + moves 可完整重放恢复 Game
      startSfen: game.startSfen,
      moves: [...game.moves],
      result: game.result,
      resultDetail: game.resultDetail,
      // 玩家（仅持久身份，不存 clientId）
      players: {
        b: room.players.b ? { playerId: room.players.b.playerId, name: room.players.b.name } : null,
        w: room.players.w ? { playerId: room.players.w.playerId, name: room.players.w.name } : null,
      },
    };
  }

  /** 保存单个房间快照（仅 PLAYING 与 WAITING） */
  _snapshotRoom(room) {
    if (!room || (room.status !== 'PLAYING' && room.status !== 'WAITING')) return;
    try {
      require('./storage').putGameSnapshot(room.id, this._serializeRoom(room));
    } catch (err) {
      console.error('[rooms] 快照失败:', err.message);
    }
  }

  /** 定期快照所有进行中的对局 */
  _snapshotAll() {
    for (const room of this.rooms.values()) {
      this._snapshotRoom(room);
    }
  }

  /** 对局结束/删除时清除快照 */
  _clearSnapshot(roomId) {
    try { require('./storage').deleteGameSnapshot(roomId); } catch (_) {}
  }

  /**
   * 启动时恢复全部快照（服务器重启后续局）。
   * 玩家重连时由 protocol.reconnect 找到恢复的房间。
   * @returns {number} 恢复的房间数
   */
  restoreSnapshots() {
    let restored = 0;
    let snapshots = [];
    try { snapshots = require('./storage').listGameSnapshots(); } catch (_) { return 0; }
    for (const { roomId, data } of snapshots) {
      try {
        const room = this._restoreRoom(data);
        if (!room) { this._clearSnapshot(roomId); continue; }
        this.rooms.set(room.id, room);
        this.byCode.set(room.code, room.id);
        // 重新绑定玩家（若在线）
        for (const seat of ['b', 'w']) {
          const p = room.players[seat];
          if (p && p.playerId) {
            const clientId = this.playerToClient.get(p.playerId);
            if (clientId) {
              p.clientId = clientId;
              p.connected = true;
              this._bindClient(clientId, room.id, seat);
            } else {
              p.clientId = null;
              p.connected = false;
            }
          }
        }
        if (room.status === 'PLAYING') this._startClock(room);
        restored++;
      } catch (err) {
        console.error('[rooms] 恢复房间失败:', err.message, roomId);
        this._clearSnapshot(roomId);
      }
    }
    return restored;
  }

  /** 从快照重建房间对象（Game 用 startSfen+moves 重放） */
  _restoreRoom(snap) {
    if (!snap || !snap.id) return null;
    const game = newGame(snap.startSfen || STARTING_SFEN, [
      snap.players && snap.players.b ? snap.players.b.name : '先手',
      snap.players && snap.players.w ? snap.players.w.name : '後手',
    ]);
    // 重放走法
    for (const usi of snap.moves || []) {
      const r = game.applyMove(usi);
      if (!r.ok) return null; // 走法无法重放 → 快照无效
    }
    const room = {
      id: snap.id,
      code: snap.code,
      game,
      players: {
        b: snap.players && snap.players.b ? { clientId: null, playerId: snap.players.b.playerId, name: snap.players.b.name, connected: false } : null,
        w: snap.players && snap.players.w ? { clientId: null, playerId: snap.players.w.playerId, name: snap.players.w.name, connected: false } : null,
      },
      status: snap.status || 'FINISHED',
      type: snap.type || 'room',
      creatorId: snap.creatorId || null,
      createdAt: snap.createdAt || Date.now(),
      timeControl: snap.timeControl || DEFAULT_TIME_CONTROL,
      clock: snap.clock ? { ...snap.clock } : { b: 0, w: 0 },
      byoyomi: snap.byoyomi || 0,
      curByoyomi: snap.curByoyomi ? { ...snap.curByoyomi } : { b: 0, w: 0 },
      inByoyomi: snap.inByoyomi ? { ...snap.inByoyomi } : { b: false, w: false },
      lastMoveTs: Date.now(),
      lastActiveAt: Date.now(),
      result: snap.result || null,
      resultDetail: snap.resultDetail || null,
      rated: snap.rated !== false,
      tournamentId: snap.tournamentId || null,
    };
    return room;
  }

  stats() {
    return {
      online: this.rooms.size + (this.clientToRoom.size - this.rooms.size),
      playing: [...this.rooms.values()].filter((r) => r.status === 'PLAYING').length,
      waiting: [...this.rooms.values()].filter((r) => r.status === 'WAITING').length,
      matching: this.matchQueue.length,
      totalGames: this.rooms.size,
    };
  }
}

module.exports = { RoomManager };
