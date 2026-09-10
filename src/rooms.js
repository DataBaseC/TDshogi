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
const NO_MEMBER_CLEANUP_MS = parseInt(process.env.NO_MEMBER_CLEANUP_MS || '', 10) || 2 * 60 * 1000;   // 完全无连接的房间 2 分钟后清理（可配）
const FINISHED_TTL_MS = parseInt(process.env.FINISHED_TTL_MS || '', 10) || 30 * 60 * 1000;            // 感想战中（FINISHED 有连接成员）自最后活动起 30 分钟（可配）

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
    // FINISHED 房间定期清理（已结束 5 分钟以上即从内存/byCode 删除）
    // 修复：原先 FINISHED 房间永远留在 rooms Map，导致内存泄漏 + 进行中列表残留
    this._finishedCleanupTimer = setInterval(() => this._cleanupFinished(), 60 * 1000);
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

  _broadcast(roomId, payload, exceptClientId = null) {
    const room = this._room(roomId);
    if (!room) return;
    const ids = new Set();
    if (room.players.b) ids.add(room.players.b.clientId);
    if (room.players.w) ids.add(room.players.w.clientId);
    const specs = this.spectatorsByRoom.get(roomId) || new Set();
    for (const sid of specs) ids.add(sid);
    for (const cid of ids) {
      if (exceptClientId && cid === exceptClientId) continue;
      this.broadcaster(cid, payload);
    }
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
    const profB = room.players.b ? ratings.profile(room.players.b.playerId) : null;
    const profW = room.players.w ? ratings.profile(room.players.w.playerId) : null;
    st.players = {
      // connected：该座位当前是否在线（前端据此显示「对手断线，等待重连」）
      // level：等级系统（PLAN §K7），供对局页玩家栏展示
      b: room.players.b ? { id: room.players.b.playerId, name: room.players.b.name, rating: profB.rating, level: profB.level, connected: room.players.b.connected !== false } : null,
      w: room.players.w ? { id: room.players.w.playerId, name: room.players.w.name, rating: profW.rating, level: profW.level, connected: room.players.w.connected !== false } : null,
    };
    st.clock = { b: room.clock.b, w: room.clock.w };
    st.timeControl = room.timeControl || DEFAULT_TIME_CONTROL;
    st.byoyomi = room.byoyomi || 0;
    st.curByoyomi = room.curByoyomi ? { ...room.curByoyomi } : null;
    st.inByoyomi = room.inByoyomi ? { ...room.inByoyomi } : null;
    st.roomType = room.type;
    st.seat = null;
    // 观战者名单（对局页右列观众列表，PLAN §G v7）
    st.spectators = this._spectatorList(room);   // §R：带 id/等级的对象数组（按人去重）
    st.moveTimes = room.moveTimes || [];  // 每手耗时（秒）——棋谱列表与 KIF 时间
    // 感想战演示状态（仅终局后携带，重连/观战初载即可拿到推演谱与合法走法，PLAN §G）
    if (room.status === 'FINISHED' && room.demo) {
      const dSeat = room.demo.demonstratorSeat;
      const g = this._demoGame(room);
      st.demo = {
        moves: room.demo.moves,
        kif: room.demo.kif,
        baseIndex: room.demo.baseIndex,
        baseCount: room.demo.baseCount,
        legalMoves: g.legalMovesUsi(),
        legalTargetsBySq: this._legalTargetsMap(g),
        turn: g.turn,
        demonstratorSeat: dSeat || null,
        demonstratorName: dSeat && room.players[dSeat] ? room.players[dSeat].name : null,
      };
    }
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
   * @returns {{ok:true, roomId, code, seat}|{ok:false, error}}
   */
  createRoom(host, timeControlId) {
    // 若在已结束的对局中则自动退出；对局中自动认输退出（用户确认，PLAN §H）
    this._autoLeaveFinished(host.clientId);
    this._autoResignAndLeave(host.clientId);
    this._autoLeaveAllRooms(host.playerId, host.clientId); // 旧连接残留的座位一并退出（幽灵房修复）
    this._abandonRestoredFor(host.playerId);
    // 同一 playerId 名下已有进行中房间（另一连接/另一窗口）→ 拒绝；
    // 仅等待中的旧房 → 视为放弃并销毁（防止一人占多个房间）
    for (const room of [...this.rooms.values()]) {
      if (room.status === 'FINISHED') continue;
      const seat = ['b', 'w'].find((s) => room.players[s] && room.players[s].playerId === host.playerId);
      if (!seat) continue;
      if (room.status === 'PLAYING' && !room.game.isGameOver()) {
        return { ok: false, error: '你已在对局中，请先结束当前对局' };
      }
      this._broadcast(room.id, { type: 'room_closed', data: { roomId: room.id, reason: 'host_switch' } });
      this._dissolveRoom(room.id, 'host_recreate_other_connection');
    }
    // 同一玩家已处于进行中/等待中房间 → 阻止重复建房
    // 修复：原先未拦截，导致同连接连建多房，留下大量幽灵 WAITING 房间，
    //      其他人用旧 code 加入会「开局但对手是断连的空壳」（即"加进来的人不能正常游戏"）
    const curRoomId = this.clientToRoom.get(host.clientId);
    if (curRoomId) {
      const cur = this._room(curRoomId);
      if (cur && cur.status === 'PLAYING') {
        return { ok: false, error: '你已在对局中，请先结束当前对局' };
      }
      if (cur && cur.status === 'WAITING') {
        // 旧等待房已存在 → 立即销毁，再建新房（避免幽灵）
        this._dissolveRoom(curRoomId, 'host_recreate');
        this._unbindClient(host.clientId);
      }
    }
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
    return { ok: true, roomId, code, seat };
  }

  /**
   * 加入房间（按房间码）。
   * @param {object} player { clientId, playerId, name }
   * @param {string} code
   */
  joinRoom(player, code) {
    // 若在已结束的对局中则自动退出；对局中自动认输退出（用户确认，PLAN §H）
    this._autoLeaveFinished(player.clientId);
    this._autoResignAndLeave(player.clientId);
    this._autoLeaveAllRooms(player.playerId, player.clientId); // 旧连接残留的座位一并退出（幽灵房修复）
    this._abandonRestoredFor(player.playerId);
    const roomId = this.byCode.get(code.trim().toUpperCase());
    if (!roomId) return { ok: false, error: '房间不存在或房间码错误' };
    // 同一身份不能加入自己的房间（房主座位已是自己的 playerId → 再加入即一人占两位）
    const target = this._room(roomId);
    if (target && ['b', 'w'].some((s) => target.players[s] && target.players[s].playerId === player.playerId)) {
      return { ok: false, error: '这是你自己创建/所在的房间，同一身份不能加入（可在对局结束后再来，或换一个身份测试）' };
    }
    const curId = this.clientToRoom.get(player.clientId);
    if (curId) {
      const curRoom = this._room(curId);
      if (curRoom && curRoom.status === 'PLAYING') {
        return { ok: false, error: '你正在对局中，请先结束当前对局' };
      }
      // 自己的等待房未开赛：换房 → 销毁旧等待房（避免幽灵房）；
      // 若目标就是自己的等待房，按"已在房间中"处理（不动原房间）
      if (curRoom && curRoom.status === 'WAITING') {
        if (curId === roomId) return { ok: false, error: '你已在房间中' };
        this._dissolveRoom(curId, 'switch_room');
        this._unbindClient(player.clientId);
      }
    }
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
  /** 对局中自动认输并退出（用户确认：匹配/建房时若在对局中自动退出，PLAN §H） */
  _autoResignAndLeave(clientId) {
    const seat = this.clientToPlayer.get(clientId);
    if (!seat) return;
    const room = this._room(seat.roomId);
    if (!room || room.status !== 'PLAYING' || room.game.isGameOver()) return;
    room.game.result = seat.seat === 'b' ? 'w' : 'b';
    room.game.resultDetail = '投了';
    this._checkGameOver(room);
    this._autoLeaveFinished(clientId);
  }

  quickMatch(player) {
    // 若在已结束的对局中则自动退出；对局中自动认输退出（用户确认，PLAN §H）
    this._autoLeaveFinished(player.clientId);
    this._autoResignAndLeave(player.clientId);
    this._autoLeaveAllRooms(player.playerId, player.clientId); // 旧连接残留的座位一并退出（幽灵房修复）
    this._abandonRestoredFor(player.playerId);
    // 已绑在某房间：进行中 → 拒绝；自己的等待房（未开赛）→ 销毁后再匹配
    // （否则房主换玩法后 WAITING 房残留，其他人凭旧 code 加入会开局但对手是空壳）
    const curId = this.clientToRoom.get(player.clientId);
    if (curId) {
      const cur = this._room(curId);
      if (cur && cur.status === 'WAITING') {
        this._dissolveRoom(curId, 'switch_to_match');
        this._unbindClient(player.clientId);
      } else {
        return { ok: false, error: '你已在房间中' };
      }
    }
    // 同一身份已在队列 → 拒绝（防止同浏览器双窗口/双标签自己和自己配对，占两个位置）
    if (this.matchQueue.some((cid) => {
      const p = this.playerRegistry(cid);
      return p && p.playerId === player.playerId;
    })) {
      return { ok: false, error: '同一身份已在匹配队列中——不能自己和自己对弈' };
    }
    if (this.matchQueue.includes(player.clientId)) return { ok: false, error: '已在匹配队列中' };
    this.matchQueue.push(player.clientId);
    // 配对
    if (this.matchQueue.length >= 2) {
      const c1 = this.matchQueue.shift();
      const c2 = this.matchQueue.shift();
      // 从广播器/玩家表取会话信息（由 protocol 层注入 player registry）
      const p1 = this.playerRegistry ? this.playerRegistry(c1) : null;
      const p2 = this.playerRegistry ? this.playerRegistry(c2) : null;
      // 配对安全网：同 playerId 永远不配到一起
      if (p1 && p2 && p1.playerId === p2.playerId) {
        this.matchQueue.unshift(c1);
        return { ok: false, error: '同一身份不能自己和自己对弈' };
      }
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

  /**
   * 自动退出该身份名下所有其他房间的座位（按 playerId，含已断线的旧连接座位——幽灵房修复）。
   * 既有 _autoLeaveFinished/_autoResignAndLeave 只查「当前连接」绑定的房间，覆盖不到
   * 已关闭旧连接留下的座位；这些座位残留在回位扫描里，会把新连接绑回旧对局（幽灵房）。
   *  - PLAYING 未终局 → 自动认输（投了，PLAN §H 同款）
   *  - FINISHED（含复盘中）→ 移除座位记录（与 _autoLeaveFinished 口径一致）；
   *    由此大厅列表不再把他认作该局选手，重访旧局走观战入口
   *  - 复盘中持有演示权 → 释放
   * exceptClientId：当前连接所在的房间不动（WAITING 换房/对局中认输由既有逻辑处理）
   */
  _autoLeaveAllRooms(playerId, exceptClientId = null) {
    if (!playerId) return;
    const keepRoomId = exceptClientId ? this.clientToRoom.get(exceptClientId) : null;
    for (const room of this.rooms.values()) {
      if (room.restored) continue;               // 恢复局由 _abandonRestoredFor 专门处理
      if (keepRoomId && room.id === keepRoomId) continue;
      for (const seat of ['b', 'w']) {
        const p = room.players[seat];
        if (!p || p.playerId !== playerId) continue;
        if (room.status === 'PLAYING' && !room.game.isGameOver()) {
          room.game.result = seat === 'b' ? 'w' : 'b';
          room.game.resultDetail = '投了';
          this._checkGameOver(room);
        }
        if (room.status !== 'FINISHED') continue; // WAITING 房间由既有换房/销毁逻辑处理
        if (room.demo && room.demo.demonstratorSeat === seat) {
          room.demo.demonstratorSeat = null;
          room.demo.updatedAt = Date.now();
          this._broadcastDemo(room);
        }
        if (p.clientId) {
          // 该 clientId 若仍连着（多窗口场景），同步解除其房间绑定
          this.clientToRoom.delete(p.clientId);
          this.clientToPlayer.delete(p.clientId);
        }
        this.playerToClient.delete(playerId);
        room.players[seat] = null;
        this._pushState(room);
      }
    }
  }

  /**
   * 放弃玩家名下的「恢复局」（服务器重启时从快照恢复的旧局，room.restored = true）。
   * 在玩家主动开启新对局（建房/加入/匹配）时调用——否则 request_state 的重连兜底
   * 会按 playerId 把玩家绑回僵尸恢复局，表现为新对局「双方锁死、计时器不动」。
   *  - 对手仍在线 → 按接続切断判负推进（保留对手的结算与复盘）
   *  - 对手不在线/无对手/WAITING → 直接解散
   */
  _abandonRestoredFor(playerId) {
    if (!playerId) return;
    for (const room of [...this.rooms.values()]) {
      if (!room.restored || room.status === 'FINISHED') continue;
      const seat = ['b', 'w'].find((s) => room.players[s] && room.players[s].playerId === playerId);
      if (!seat) continue;
      const otherSeat = seat === 'b' ? 'w' : 'b';
      const other = room.players[otherSeat];
      const otherConnected = !!(other && other.connected);
      if (room.status === 'WAITING' || !otherConnected || room.game.isGameOver()) {
        this._broadcast(room.id, { type: 'room_closed', data: { roomId: room.id, reason: 'abandoned_restored' } });
        this._dissolveRoom(room.id, 'player_started_new_game');
      } else {
        room.game.result = seat === 'b' ? 'w' : 'b';
        room.game.resultDetail = '接続切断';
        this._checkGameOver(room);
      }
    }
  }

  /**
   * 销毁房间：清理所有绑定与资源，避免 WAITING 房间永远残留成为「幽灵房间」。
   * 修复：原先 leave()/断线/重复建房均不销毁 WAITING 房间，导致：
   *  1) 房主刷新/离开后，房间码仍可被其他人加入 → 出现「开局但对手是空壳」
   *  2) 进行中列表内存泄漏（rooms Map 永远增长）
   * @param {string} roomId
   * @param {string} reason 用于日志
   */
  _dissolveRoom(roomId, reason = 'dissolve') {
    const room = this._room(roomId);
    if (!room) return;
    this.rooms.delete(roomId);
    this.byCode.delete(room.code);
    this._stopClock(roomId);
    // 清理所有玩家绑定（先于清座位，避免 unbind 误判）
    for (const seat of ['b', 'w']) {
      const p = room.players[seat];
      if (p && p.clientId) {
        this.clientToRoom.delete(p.clientId);
        this.clientToPlayer.delete(p.clientId);
      }
      if (p && p.playerId) this.playerToClient.delete(p.playerId);
    }
    // 观战者
    const specs = this.spectatorsByRoom.get(roomId);
    if (specs) {
      for (const sid of specs) this.clientToRoom.delete(sid);
      this.spectatorsByRoom.delete(roomId);
    }
    // 清理该房间的所有定时器
    const dt = this._disconnectTimers.get(roomId);
    if (dt) { for (const t of dt.values()) clearTimeout(t); this._disconnectTimers.delete(roomId); }
    const wt = this._waitingTimers && this._waitingTimers.get(roomId);
    if (wt) { clearTimeout(wt); this._waitingTimers.delete(roomId); }
    this._clearSnapshot(roomId);
    console.log(`[rooms] 房间 ${roomId} (${room.code}) 销毁 (${reason})`);
  }

  /**
   * 安排 WAITING 房间在 N 秒后自动销毁（若仍无玩家重连）。
   * 给玩家一个「刷新页面重连」的机会；超时后清理，避免幽灵。
   */
  _scheduleWaitingDissolve(roomId, ms = 20000) {
    if (!this._waitingTimers) this._waitingTimers = new Map();
    if (this._waitingTimers.has(roomId)) return;
    const t = setTimeout(() => {
      this._waitingTimers && this._waitingTimers.delete(roomId);
      const r = this._room(roomId);
      if (!r || r.status !== 'WAITING') return;
      // 仍有连接的玩家 → 不销毁（可能加入了第二个玩家）
      const anyConnected = (r.players.b && r.players.b.connected) || (r.players.w && r.players.w.connected);
      if (anyConnected) return;
      this._dissolveRoom(roomId, 'waiting_timeout');
    }, ms);
    this._waitingTimers.set(roomId, t);
  }

  _clearWaitingTimer(roomId) {
    if (!this._waitingTimers) return;
    const t = this._waitingTimers.get(roomId);
    if (t) { clearTimeout(t); this._waitingTimers.delete(roomId); }
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
    room.demo = null;      // 新对局开始：清除上一局的感想战演示状态
    room.emptySince = null;
    this._startClock(room);
    this._broadcast(room.id, { type: 'game_start', data: { roomId: room.id, code: room.code } });
    this._pushState(room);
    // 若任一座位开局时已失联（典型场景：房主建房后断线 → joiner 凭 code 加入），
    // 立即为该座位启动断线判负计时，避免「开局但对手是空壳、永远等不到走子」。
    for (const seat of ['b', 'w']) {
      const p = room.players[seat];
      if (p && !p.connected && !room.game.isGameOver()) {
        this._scheduleDisconnectLoss(room.id, seat);
      }
    }
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
      // 每手耗时（秒）：自该方上一手（或开局）起算——KIF 消費時間/累計時間用
      const now = Date.now();
      const spent = Math.max(0, Math.round((now - (room.lastMoveTs || room.createdAt)) / 1000));
      const r = game.applyMove(usi);
      if (!r.ok) return { ok: false, error: r.error || '非法走法' };
      room.moveTimes = room.moveTimes || [];
      room.moveTimes.push(spent);
      room.lastMoveTs = now;
      room.lastActiveAt = now;
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
    // 发言者身份：玩家用座位名；观战者用其会话真名（旧实现一律显示"观众"，互动体验差）
    const seat = this.clientToPlayer.get(clientId);
    let name = '观众';
    let role = 'spectator';
    if (seat && room.players[seat.seat]) {
      name = room.players[seat.seat].name;
      role = seat.seat === 'b' ? 'player-b' : 'player-w';
    } else {
      const info = this.playerRegistry ? this.playerRegistry(clientId) : null;
      if (info && info.name) name = info.name;
    }
    this._broadcast(roomId, {
      type: 'chat',
      data: { name, text: msg, ts: now, role },
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
    // 感想战：终局自动初始化演示状态（演示权归房主，见 PLAN §G）
    this._initDemo(room);
    // 向全场推送终局 state（含 demo）——双方与观战者据此统一自动进入感想战；
    // 否则只有触发终局的那个连接能进入（其余成员停在旧画面）
    this._pushState(room);
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
    // 对局经验（PLAN §K7）：完成一局双方 +1（含赛事对局；离开/断线判负同样算完成）
    try {
      if (b) ratings.addExp(b.playerId, 1, 'game');
      if (w) ratings.addExp(w.playerId, 1, 'game');
    } catch (_) {}
    // 保存棋谱
    const record = saveRecord({
      startSfen: game.startSfen,
      moves: game.moves,
      moveTimes: room.moveTimes || [],
      timeControl: room.timeControl,
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
      room.moveTimes = [];
      room.demo = null; // 再来一局：退出感想战，清空推演
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
    // 等待中房间：房主/玩家主动离开 → 立即销毁整个房间（关键修复）
    // 否则房间永远残留成为「幽灵房间」，其他人用 code 加入会开局但对手是空壳
    if (room.status === 'WAITING') {
      // 通知仍在房间里的观战者（若有）
      this._broadcast(room.id, { type: 'room_closed', data: { roomId: room.id, reason: 'host_left' } });
      this._dissolveRoom(room.id, 'host_left');
      this.clientToPlayer.delete(clientId);
      this.clientToRoom.delete(clientId);
      return { ok: true };
    }
    // 对局中离开 → 判「离开座位」负（而不是当前手番方）
    // 修复：原 resultDetail 写「投了」误导对手；中途退出/断线超时应提示「接続切断」
    if (room.status === 'PLAYING' && !room.game.isGameOver()) {
      room.game.result = seat.seat === 'b' ? 'w' : 'b';
      room.game.resultDetail = '接続切断';
      this._checkGameOver(room);
    }
    this._unbindClient(clientId);
    return { ok: true };
  }

  // ==================================================================
  // 观战
  // ==================================================================
  spectate(clientId, roomId, playerId) {
    const room = this._room(roomId);
    if (!room) return { ok: false, error: '对局不存在' };
    // 座位回位（PLAN §H）：本连接 playerId 命中本房间座位 → 回到座位（对局中/复盘中皆可），不进观战席
    const seatInfo = this.clientToPlayer.get(clientId);
    if (seatInfo && seatInfo.roomId === roomId) {
      const mySeat = seatInfo.seat;
      const p = room.players[mySeat];
      if (p) {
        p.clientId = clientId;
        p.connected = true;
        this._bindClient(clientId, roomId, mySeat);
        this._pushState(room);
        return { ok: true, roomId, seat: mySeat, rebind: true };
      }
    }
    // 掉线重进（进行中对局列表入口）：新连接的 clientId 映射已被 _unbindClient 清除，
    // 必须按持久 playerId 匹配座位才能回位（与 reconnect()/bindToActiveGame() 同口径）
    if (playerId && !(room.status === 'FINISHED' && !room.demo)) {
      for (const seat of ['b', 'w']) {
        const p = room.players[seat];
        if (p && p.playerId === playerId && !p.connected) {
          // 旧连接仍挂着时先解除其绑定（页面跳转竞态：新连接先于旧 close 到达）
          if (p.clientId && p.clientId !== clientId) {
            this.clientToRoom.delete(p.clientId);
            this.clientToPlayer.delete(p.clientId);
            this.playerToClient.delete(p.playerId);
          }
          p.clientId = clientId;
          p.connected = true;
          this._bindClient(clientId, roomId, seat);
          this._pushState(room);
          return { ok: true, roomId, seat, rebind: true };
        }
      }
    }
    // 正在对局的玩家禁止观战其他对局：
    // 原先静默返回 ok，前端会跳转到别人的对局页，导致玩家"丢失"自己的对局、
    // 重连混乱（表现为"掉线后回不到对局"）。这里直接拒绝并引导回对局。
    const seat = this.clientToPlayer.get(clientId);
    if (seat) {
      const myRoom = this._room(seat.roomId);
      if (myRoom && myRoom.status === 'PLAYING') {
        return { ok: false, error: '你正在对局中，不能观战其他对局', backRoomId: myRoom.id };
      }
    }
    if (!this.spectatorsByRoom.has(roomId)) this.spectatorsByRoom.set(roomId, new Set());
    this.spectatorsByRoom.get(roomId).add(clientId);
    this._broadcastSpectators(room); // 观众列表实时更新（PLAN §G v7）
    this.clientToRoom.set(clientId, roomId);
    return { ok: true, roomId };
  }

  randomSpectate(clientId, playerId) {
    const playing = [...this.rooms.values()].filter((r) => r.status === 'PLAYING');
    if (!playing.length) return { ok: false, error: '当前没有进行中的对局' };
    const room = playing[Math.floor(Math.random() * playing.length)];
    const res = this.spectate(clientId, room.id, playerId);
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
      // 关键：必须更新座位记录的 clientId，否则 _pushState 广播会发到已断开的旧连接
      // 修复：原先 reconnect() 显式设置 p.clientId，bindToActiveGame() 也设置，
      //       但统一收敛到 _bindClient 后遗漏了 p.clientId，导致重连后收不到 state 推送
      room.players[seat].clientId = clientId;
      room.players[seat].connected = true;
      // 重连成功：清除断线宽限计时器 + WAITING 销毁定时器
      this._clearDisconnectTimer(roomId, seat);
      this._clearWaitingTimer(roomId);
    }
  }

  _unbindClient(clientId) {
    // 匹配队列清理：断线/退出的排队者必须移出，否则僵尸条目会毒化后续配对
    const qIdx = this.matchQueue.indexOf(clientId);
    if (qIdx >= 0) this.matchQueue.splice(qIdx, 1);
    // 观战者断线：同样清理（否则残留收广播 + 泄漏）
    const specRoomId = this.clientToRoom.get(clientId);
    if (specRoomId && !this.clientToPlayer.has(clientId)) {
      const specs = this.spectatorsByRoom.get(specRoomId);
      if (specs) {
        specs.delete(clientId);
        if (specs.size === 0) this.spectatorsByRoom.delete(specRoomId);
        const room = this._room(specRoomId);
        if (room) this._broadcastSpectators(room); // 观众列表实时更新
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
          // 立即推送状态（players.connected=false），让对手实时看到「对手断线」
          this._pushState(room);
        }
        // 等待中房间的玩家断线：20s 宽限后销毁（避免幽灵房间）
        // 修复：原先断线只置 connected=false，房间永远残留，其他人用 code 加入会开局但对手是空壳
        if (room.status === 'WAITING') {
          this._scheduleWaitingDissolve(room.id, 20000);
        }
        // 感想战中演示者断线：演示权置空并广播（任何玩家可认领，PLAN §G）
        if (room.status === 'FINISHED' && room.demo && room.demo.demonstratorSeat === seat.seat) {
          room.demo.demonstratorSeat = null;
          room.demo.updatedAt = Date.now();
          this._broadcastDemo(room);
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
      // 仍未重连 → 判该座位负（接続切断，与主动投了区分）
      if (p && !p.connected) {
        cur.game.result = seat === 'b' ? 'w' : 'b';
        cur.game.resultDetail = '接続切断';
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

  reconnect(clientId, playerId, preferRoomId = null) {
    // 根据 playerId 查座位表回位（含「复盘中」房间——掉线/刷新/重进都回到自己座位，PLAN §G v7）
    // 纯 FINISHED（无感想战）的房间仍跳过
    // preferRoomId：客户端 URL 指向的房间优先。重新匹配进入新对局时，旧对局
    // （复盘中）的断线座位不能凭 Map 插入顺序抢先绑定（幽灵房修复）
    if (preferRoomId) {
      const hit = this._findDisconnectedSeat(preferRoomId, playerId);
      if (hit) {
        this._bindClient(clientId, hit.room.id, hit.seat);
        return { ok: true, roomId: hit.room.id, seat: hit.seat, reconnect: true };
      }
    }
    for (const room of this.rooms.values()) {
      if (room.status === 'FINISHED' && (!room.demo || preferRoomId)) continue;
      for (const seat of ['b', 'w']) {
        const p = room.players[seat];
        if (p && p.playerId === playerId && !p.connected) {
          // 找到断线的对局，重连
          this._bindClient(clientId, room.id, seat);
          return { ok: true, roomId: room.id, seat, reconnect: true };
        }
      }
    }
    return { ok: false };
  }

  /** 在指定房间内找 playerId 的断线座位（复盘中房间也算，回位口径与 reconnect 一致） */
  _findDisconnectedSeat(roomId, playerId) {
    const room = this._room(roomId);
    if (!room) return null;
    if (room.status === 'FINISHED' && !room.demo) return null;
    for (const seat of ['b', 'w']) {
      const p = room.players[seat];
      if (p && p.playerId === playerId && !p.connected) return { room, seat };
    }
    return null;
  }

  /**
   * 兜底绑定：玩家页面跳转时，新连接可能先于旧连接 close 到达，
   * 此时 reconnect() 找不到 connected=false 的座位。这里按 playerId
   * 强制把新连接绑回其进行中的对局（顶替旧连接，不依赖 close 时序）。
   * preferRoomId：URL 指向的房间优先（幽灵房修复，同 reconnect）；且带
   * preferRoomId 时不再兜底绑定到旧的「复盘中」房间。
   * @returns {{roomId:string, seat:string}|null}
   */
  bindToActiveGame(clientId, playerId, preferRoomId = null) {
    const ordered = [];
    if (preferRoomId) {
      const r0 = this._room(preferRoomId);
      if (r0) ordered.push(r0);
    }
    for (const room of this.rooms.values()) {
      if (room.id !== preferRoomId) ordered.push(room);
    }
    for (const room of ordered) {
      if (room.status === 'FINISHED' && (!room.demo || preferRoomId)) continue;
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
    return null;
  }

  // ==================================================================
  // 列表 / 信息
  // ==================================================================
  activeGames() {
    // 进行中对局 + 感想战中的房间（终局后未清理，type='reviewing' 复盘中，可继续观战）
    return [...this.rooms.values()]
      .filter((r) => r.status === 'PLAYING' || (r.status === 'FINISHED' && r.demo))
      .map((r) => ({
        roomId: r.id,
        code: r.code,
        players: {
          b: r.players.b ? r.players.b.name : null,
          w: r.players.w ? r.players.w.name : null,
        },
        // 玩家 id（大厅观战列表悬停信息卡用，PLAN §F3）
        playerIds: {
          b: r.players.b ? r.players.b.playerId : null,
          w: r.players.w ? r.players.w.playerId : null,
        },
        moveCount: r.game.moves.length,
        type: r.status === 'FINISHED' ? 'reviewing' : r.type,
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
   * 管理员取消赛事：解散其全部进行中/等待中的对局房间。
   * 由 server 路由在 tournaments.cancelTournament 返回 matchIds 后调用。
   * 房内所有人收到 room_closed 通知。
   */
  dissolveTournamentMatches(matchIds, reason = 'tournament_cancelled') {
    let n = 0;
    for (const roomId of matchIds || []) {
      const room = this._room(roomId);
      if (!room) continue;
      this._broadcast(roomId, { type: 'room_closed', data: { roomId, reason } });
      this._dissolveRoom(roomId, reason);
      n++;
    }
    return n;
  }

  // ==================================================================
  // 感想战演示行棋（PLAN §G）
  // ==================================================================

  /**
   * 观战者名单（对局页观众列表用，PLAN §R）。
   * 修复两处体验缺陷：
   *  1. 旧实现只给名字 → 前端无法做悬停卡片、无法区分同名、无法展示等级
   *  2. 同一身份开多个窗口观战会被重复计数 → 现按 playerId 去重
   * @returns {Array<{id:string, name:string, rating:number, level:number}>}
   */
  _spectatorList(room) {
    const specs = this.spectatorsByRoom.get(room.id) || new Set();
    const map = new Map();
    for (const cid of specs) {
      const info = this.playerRegistry ? this.playerRegistry(cid) : null;
      if (!info || !info.playerId) continue;
      if (map.has(info.playerId)) continue; // 同人多窗口只算一个观众
      const prof = ratings.profile(info.playerId);
      map.set(info.playerId, {
        id: info.playerId,
        name: info.name || '观众',
        rating: prof.rating,
        level: prof.level,
      });
    }
    return [...map.values()];
  }

  /** 兼容旧调用：只要名字数组 */
  _spectatorNames(room) {
    return this._spectatorList(room).map((s) => s.name);
  }

  /** 观战者名单变动广播（对局页观众列表实时更新） */
  _broadcastSpectators(room) {
    this._broadcast(room.id, { type: 'spectator_update', data: { spectators: this._spectatorList(room) } });
  }

  _hostSeat(room) {
    if (room.creatorId) {
      for (const seat of ['b', 'w']) {
        const p = room.players[seat];
        if (p && p.playerId === room.creatorId) return seat;
      }
    }
    return 'b';
  }

  /**
   * 终局后初始化演示状态（推演谱：可变基点分支模型，PLAN §G v4）。
   * baseIndex/baseSfen：推演谱的起点（默认=原对局终局）；在棋谱历史手处下出
   * 不同的棋 → 起点回退到该手、之后的推演截断（新分支覆盖）。
   */
  _initDemo(room) {
    const moves = room.game.moves || [];
    room.demo = {
      baseIndex: moves.length,               // 推演起点 = 原谱第 N 手后
      baseCount: moves.length,               // 原对局总手数（不变，用于界面区分本谱/推演）
      baseSfen: room.game.state().sfen,      // 起点局面 SFEN
      moves: [],                             // 推演着法（USI，规则合法，服务端校验）
      kif: [],                               // 推演着法日式记谱
      demonstratorSeat: this._hostSeat(room),
      updatedAt: Date.now(),
      _game: null,                           // 推演 Game（懒重建）
    };
  }

  /** 原谱第 k 手后的局面 SFEN（k=0 即初始局面） */
  _sfenAtOriginal(room, k) {
    const g = newGame(room.game.startSfen || STARTING_SFEN, ['先手', '後手']);
    const moves = room.game.moves || [];
    for (let i = 0; i < k && i < moves.length; i++) g.applyMove(moves[i]);
    return g.state().sfen;
  }

  /** 推演 Game 实例：起点 SFEN + 重放推演着法（懒重建） */
  _demoGame(room) {
    const demo = room.demo;
    if (!demo._game) {
      const g = newGame(demo.baseSfen, ['先手', '後手']);
      for (const usi of demo.moves) g.applyMove(usi);
      demo._game = g;
    }
    return demo._game;
  }

  /** 推演谱日式记谱（相对起点重放） */
  _refreshDemoKif(room) {
    const demo = room.demo;
    try {
      const { movesToKif } = require('./records');
      demo.kif = movesToKif(demo.baseSfen, demo.moves);
    } catch (_) {
      demo.kif = demo.moves.map((u, i) => `${u}`);
    }
  }

  /** 推演谱第 k 手后的 Game 实例（k ≤ baseIndex 用本谱重放；> baseIndex 叠推演） */
  _demoGameAt(room, k) {
    let g;
    if (k <= room.demo.baseIndex) {
      g = newGame(room.game.startSfen || STARTING_SFEN, ['先手', '後手']);
      const moves = room.game.moves || [];
      for (let i = 0; i < k && i < moves.length; i++) g.applyMove(moves[i]);
    } else {
      g = this._demoGame(room);
      const moves = room.demo.moves;
      for (let i = room.demo.baseIndex; i < k && i < moves.length; i++) g.applyMove(moves[i]);
    }
    return g;
  }

  _broadcastDemo(room, exceptClientId = null) {
    if (!room.demo) return;
    const seat = room.demo.demonstratorSeat;
    const g = this._demoGame(room);
    this._broadcast(room.id, {
      type: 'demo_state',
      data: {
        moves: room.demo.moves,
        kif: room.demo.kif,
        baseIndex: room.demo.baseIndex,
        baseCount: room.demo.baseCount,
        legalMoves: g.legalMovesUsi(),
        legalTargetsBySq: this._legalTargetsMap(g),
        turn: g.turn,
        demonstratorSeat: seat || null,
        demonstratorName: seat && room.players[seat] ? room.players[seat].name : null,
      },
    }, exceptClientId);
  }

  /**
   * 感想战演示操作分发（仅 FINISHED 房间）。
   * action: move（演示者按规则行棋）/ undo（待った）/ transfer / claim / reset（清空推演）
   */
  /**
   * 进入感想战页：返回该客户端视角的完整载荷（独立感想战页 demo.html 用）。
   * 玩家带座位与演示权；观战者/离开者以旁观身份进入。
   */
  demoEnter(clientId, roomId) {
    const seatInfo = this.clientToPlayer.get(clientId);
    const rid = roomId || (seatInfo ? seatInfo.roomId : this.clientToRoom.get(clientId));
    const room = this._room(rid);
    if (!room) return { ok: false, error: '对局房间不存在（可能已清理，请到棋谱页复盘）' };
    if (room.status !== 'FINISHED') return { ok: false, error: '对局尚未结束' };
    if (!room.demo) this._initDemo(room);
    const demo = room.demo;
    const g = this._demoGame(room);
    const mySeat = seatInfo ? seatInfo.seat : null;
    const { movesToKif } = require('./records');
    const gameKif = movesToKif(room.game.startSfen || STARTING_SFEN, room.game.moves || []);
    return {
      ok: true,
      demo: {
        roomId: room.id,
        mySeat,
        isPlayer: !!mySeat,
        startSfen: room.game.startSfen || STARTING_SFEN,
        gameMoves: room.game.moves || [],
        gameKif,
        moves: demo.moves,
        kif: demo.kif,
        baseIndex: demo.baseIndex,
        baseCount: demo.baseCount,
        legalMoves: g.legalMovesUsi(),
        legalTargetsBySq: this._legalTargetsMap(g),
        turn: g.turn,
        demonstratorSeat: demo.demonstratorSeat || null,
        demonstratorName: demo.demonstratorSeat ? (room.players[demo.demonstratorSeat] || {}).name : null,
        names: (room.game.names && room.game.names.length === 2) ? room.game.names : ['先手', '後手'],
        result: room.game.result,
        resultDetail: room.game.resultDetail,
      },
    };
  }

  /** 感想战：按需下发指定手数局面的合法走法（历史手行棋，PLAN §H） */
  demoLegal(clientId, data = {}) {
    const seatInfo = this.clientToPlayer.get(clientId);
    const roomId = seatInfo ? seatInfo.roomId : this.clientToRoom.get(clientId);
    const room = this._room(roomId);
    if (!room) return { ok: false, error: '房间不存在' };
    if (room.status !== 'FINISHED') return { ok: false, error: '对局尚未结束' };
    if (!room.demo) this._initDemo(room);
    const idx = Math.max(0, Math.min(Number(data.index) || 0, room.demo.baseIndex + room.demo.moves.length));
    const g = this._demoGameAt(room, idx);
    return {
      ok: true,
      data: {
        index: idx,
        legalMoves: g.legalMovesUsi(),
        legalTargetsBySq: this._legalTargetsMap(g),
        turn: g.turn,
      },
    };
  }

  demoAction(clientId, action, data = {}) {
    const seatInfo = this.clientToPlayer.get(clientId);
    const roomId = seatInfo ? seatInfo.roomId : this.clientToRoom.get(clientId);
    const room = this._room(roomId);
    if (!room) return { ok: false, error: '房间不存在' };
    if (room.status !== 'FINISHED') return { ok: false, error: '对局尚未结束' };
    if (!room.demo) this._initDemo(room);
    const demo = room.demo;
    const mySeat = seatInfo ? seatInfo.seat : null; // 观战者为 null
    const isDemo = !!mySeat && demo.demonstratorSeat === mySeat;
    const curName = demo.demonstratorSeat ? (room.players[demo.demonstratorSeat] || {}).name : null;
    switch (action) {
      case 'move': {
        if (!isDemo) return { ok: false, error: curName ? `正在由 ${curName} 演示` : '演示权空闲，请先认领' };
        const usi = String(data.usi || '');
        // 分支：携带 index（在该手之后的局面下行棋）。与既有推演不同 → 截断/重设起点开新分支
        if (Number.isInteger(data.index) && data.index !== demo.baseIndex + demo.moves.length) {
          const idx = Math.max(0, Math.min(data.index, demo.baseCount));
          if (idx <= demo.baseIndex) {
            demo.baseIndex = idx;
            demo.baseSfen = this._sfenAtOriginal(room, idx);
            demo.moves = [];
          } else {
            demo.moves = demo.moves.slice(0, idx - demo.baseIndex);
          }
          demo._game = null;
        }
        const res = this._demoGame(room).applyMove(usi); // 服务端规则校验（含王手过滤）
        if (!res.ok) return { ok: false, error: res.error || '非法走法' };
        demo.moves.push(usi);
        this._refreshDemoKif(room);
        demo.updatedAt = Date.now();
        this._broadcastDemo(room); // 全员回显（含演示者）——客户端统一以服务端回执渲染
        return { ok: true };
      }
      case 'undo': {
        // 待った：优先回退推演手；推演谱为空且起点在本谱内 → 跨界回退本谱一手（PLAN §H）
        if (demo.moves.length) {
          demo.moves.pop();
        } else if (demo.baseIndex > 0) {
          demo.baseIndex -= 1;
          demo.baseSfen = this._sfenAtOriginal(room, demo.baseIndex);
        } else {
          return { ok: false, error: '没有可回退的推演手' };
        }
        demo._game = null; // 强制重建
        this._refreshDemoKif(room);
        demo.updatedAt = Date.now();
        this._broadcastDemo(room); // 全员（含请求方）按新推演谱重绘
        return { ok: true };
      }
      case 'transfer': {
        if (!isDemo) return { ok: false, error: '只有演示者可以交接演示权' };
        demo.demonstratorSeat = mySeat === 'b' ? 'w' : 'b';
        demo.updatedAt = Date.now();
        this._broadcastDemo(room);
        return { ok: true };
      }
      case 'claim': {
        if (!mySeat) return { ok: false, error: '观战者不能获得演示权' };
        if (demo.demonstratorSeat) return { ok: false, error: '演示权已被占用' };
        demo.demonstratorSeat = mySeat;
        demo.updatedAt = Date.now();
        this._broadcastDemo(room);
        return { ok: true };
      }
      case 'reset': {
        if (!isDemo) return { ok: false, error: '只有演示者可以清空推演' };
        demo.baseIndex = demo.baseCount;
        demo.baseSfen = this._sfenAtOriginal(room, demo.baseCount);
        demo.moves = [];
        demo.kif = [];
        demo._game = null;
        demo.updatedAt = Date.now();
        this._broadcastDemo(room); // 全员回到本谱终局
        return { ok: true };
      }
      default:
        return { ok: false, error: '未知演示操作' };
    }
  }

  /**
   * 清理已结束超过 N 分钟的 FINISHED 房间，避免 rooms Map 无限增长
   * 与「进行中对局」列表幽灵残留。
   */
  /**
   * 房间清理（PLAN §G6 改版，用户建议）：
   *  - 完全无连接（玩家+观战者均 0）：缓冲 NO_MEMBER_CLEANUP_MS（默认 2 分钟，
   *    覆盖刷新/闪断）后清理，任何状态一律适用
   *  - FINISHED（感想战中）且有连接成员：自最后活动起 FINISHED_TTL_MS（默认 30 分钟）后清理
   *  - WAITING/PLAYING 的断线场景仍走各自的 20s/60s 宽限（现状不变）
   */
  _cleanupFinished() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      const members = this._connectedMemberCount(room);
      if (members === 0) {
        if (!room.emptySince) {
          room.emptySince = now;
        } else if (now - room.emptySince >= NO_MEMBER_CLEANUP_MS) {
          this._dissolveRoom(room.id, 'no_members_cleanup');
        }
        continue;
      }
      room.emptySince = null;
      if (room.status !== 'FINISHED') continue;
      const lastActive = Math.max(
        room.demo ? room.demo.updatedAt || 0 : 0,
        room.lastActiveAt || 0,
        room.createdAt || 0
      );
      if (now - lastActive >= FINISHED_TTL_MS) {
        this._dissolveRoom(room.id, 'finished_ttl_cleanup');
      }
    }
  }

  /** 房间当前连接成员数（在线玩家 + 观战者） */
  _connectedMemberCount(room) {
    let n = 0;
    for (const seat of ['b', 'w']) {
      const p = room.players[seat];
      if (p && p.connected !== false) n++;
    }
    const specs = this.spectatorsByRoom.get(room.id);
    if (specs) n += specs.size;
    return n;
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
        // 恢复局自愈（防幽灵复活循环，修复「重启后新对局被旧局劫持」）：
        //  - WAITING 恢复房：没有需要保留的对局，立即销毁
        //  - PLAYING 恢复局：对未连接座位启动 60s 判负计时——
        //    及时重连可续局；都不回来则判负收尾并清快照，
        //    否则僵尸恢复局每次重启复活，request_state 重连兜底会把
        //    玩家绑进死局（表现为新对局「双方锁死、计时器不动」）
        room.restored = true;
        if (room.status === 'WAITING') {
          this._dissolveRoom(room.id, 'restored_waiting_cleanup');
          continue;
        }
        if (room.status === 'PLAYING') {
          this._startClock(room);
          for (const seat of ['b', 'w']) {
            const p = room.players[seat];
            if (p && p.connected === false && !room.game.isGameOver()) {
              this._scheduleDisconnectLoss(room.id, seat);
            }
          }
        }
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
      reviewing: [...this.rooms.values()].filter((r) => r.status === 'FINISHED' && r.demo).length,
      waiting: [...this.rooms.values()].filter((r) => r.status === 'WAITING').length,
      matching: this.matchQueue.length,
      totalGames: this.rooms.size,
    };
  }
}

module.exports = { RoomManager };
