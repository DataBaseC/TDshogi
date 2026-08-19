/**
 * tournaments.js — 轻量单败淘汰赛
 *
 * 支持 4 / 8 / 16 人单败淘汰：
 *  - 创建赛事（名称 + 人数上限）
 *  - 玩家加入（名额满则自动开赛，生成对阵表）
 *  - 对局结束回调推进晋级
 *  - 决出冠军
 *
 * 赛事对局复用房间对局基础设施（rooms.js），对局结束后通过回调推进。
 * 数据以 tournaments.json 落盘。
 */
'use strict';

const { readJson, writeJson } = require('./storage');
const { genId } = require('./auth');

function loadTournaments() {
  const data = readJson('tournaments.json', {});
  return data && typeof data === 'object' ? data : {};
}

let cache = null;
function getCache() {
  if (!cache) cache = loadTournaments();
  return cache;
}
function persist() {
  writeJson('tournaments.json', getCache());
}

const SIZE_OPTIONS = [4, 8, 16];

// 建房工厂：由 rooms.js 注入，避免循环依赖
// (tournamentId, playerIds) => { roomId } | null
let matchFactory = null;
function setMatchFactory(fn) {
  matchFactory = fn;
}

/**
 * 创建赛事。
 * @param {string} name
 * @param {number} size 4/8/16
 * @param {object} owner { id, name }
 * @returns {{ok:boolean, tournament?:object, error?:string}}
 */
function createTournament(name, size, owner) {
  if (!SIZE_OPTIONS.includes(size)) return { ok: false, error: '人数必须为 4/8/16' };
  const tournaments = getCache();
  const id = genId().slice(0, 8);
  tournaments[id] = {
    id,
    name: String(name || '未命名赛事').slice(0, 20),
    size,
    status: 'open',            // open | playing | finished
    players: [],               // [{id, name}]
    bracket: [],               // 对阵表（平铺树），见 makeBracket
    ownerId: owner ? owner.id : null,
    createdAt: Date.now(),
    championId: null,
  };
  if (owner) {
    tournaments[id].players.push({ id: owner.id, name: owner.name });
  }
  if (tournaments[id].players.length >= size) {
    startTournament(id);
  }
  persist();
  return { ok: true, tournament: publicInfo(tournaments[id]) };
}

/**
 * 加入赛事。
 * @returns {{ok:boolean, tournament?:object, error?:string}}
 */
function joinTournament(tournamentId, player) {
  const t = getCache()[tournamentId];
  if (!t) return { ok: false, error: '赛事不存在' };
  if (t.status !== 'open') return { ok: false, error: '赛事已开赛或结束' };
  if (t.players.some((p) => p.id === player.id)) return { ok: false, error: '已在赛事中' };
  if (t.players.length >= t.size) return { ok: false, error: '赛事名额已满' };
  t.players.push({ id: player.id, name: player.name });
  if (t.players.length >= t.size) {
    startTournament(tournamentId);
  }
  persist();
  return { ok: true, tournament: publicInfo(t) };
}

/**
 * 生成对阵表（平铺满二叉树，节点索引从 0 开始）。
 * 叶节点存玩家，父节点存胜者 id。
 * bracket[i] = { playerId|null, matchId|null, winnerId|null, pair:[childIdx1, childIdx2] }
 */
function makeBracket(size, players) {
  // 构建完美二叉树（叶子数为 size）
  const nodes = [];
  const total = size * 2 - 1;
  for (let i = 0; i < total; i++) nodes.push({ playerId: null, matchId: null, winnerId: null, pair: null, index: i });
  const leafStart = size - 1; // 叶子节点起始索引（满二叉树）
  for (let i = 0; i < size; i++) {
    nodes[leafStart + i].playerId = players[i] ? players[i].id : null;
    nodes[leafStart + i].name = players[i] ? players[i].name : null;
  }
  // 从下往上建立父子关系
  for (let i = leafStart - 1; i >= 0; i--) {
    nodes[i].pair = [2 * i + 1, 2 * i + 2];
  }
  return nodes;
}

function startTournament(tournamentId) {
  const t = getCache()[tournamentId];
  if (!t) return;
  t.status = 'playing';
  t.bracket = makeBracket(t.size, t.players);
  assignNextMatches(t);
}

/** 子节点就绪 → 父节点 players 回填（叶节点直接用 playerId） */
function readyPlayer(node) {
  return node ? (node.winnerId || node.playerId) : null;
}

/**
 * 为可开赛的对局分配 matchId（对局 id，由 rooms.js 创建时回填）。
 * 遍历对阵树：父节点两个子节点都已确定参赛者、且父节点尚无对局/胜者 → 建房。
 */
function assignNextMatches(t) {
  if (!t || !t.bracket || !matchFactory) return;
  let created = 0;
  for (const n of t.bracket) {
    if (n.matchId || n.winnerId || !n.pair) continue; // 已有对局/已出结果/叶子
    const [c1, c2] = n.pair;
    const p1 = readyPlayer(t.bracket[c1]);
    const p2 = readyPlayer(t.bracket[c2]);
    if (!p1 || !p2) continue;
    n.players = [p1, p2];
    const res = matchFactory(t.id, n.players);
    if (res && res.roomId) {
      n.matchId = res.roomId;
      created++;
    }
  }
  if (created) persist();
  return created;
}

/**
 * 由对局结束回调调用，推进对阵表。
 * @param {string} tournamentId
 * @param {string} matchId 房间/对局 id
 * @param {string} winnerId 胜者玩家 id
 */
function onMatchFinished(tournamentId, matchId, winnerId) {
  const t = getCache()[tournamentId];
  if (!t) return { ok: false, error: '赛事不存在' };
  // 找到包含该 matchId 的节点，填入胜者
  let node = t.bracket.find((n) => n.matchId === matchId);
  if (!node) return { ok: false, error: '对局不属于该赛事' };
  node.winnerId = winnerId;
  node.playerId = winnerId;
  node.matchId = null;
  node.players = null;
  // 向上传播：父节点两个子节点都出胜者 → 安排下一轮对局
  const parent = t.bracket.find((n) => n.pair && n.pair.includes(node.index));
  if (!parent) {
    // 根节点已填 → 冠军产生
    t.championId = winnerId;
    t.status = 'finished';
    persist();
    return { ok: true, tournament: publicInfo(t), finished: true };
  }
  assignNextMatches(t);
  persist();
  return { ok: true, tournament: publicInfo(t) };
}

/**
 * 列出所有赛事（公开信息）。
 */
function listTournaments() {
  const data = getCache();
  return Object.values(data).map(publicInfo).sort((a, b) => b.createdAt - a.createdAt);
}

function getTournament(tournamentId) {
  const t = getCache()[tournamentId];
  return t ? publicInfo(t) : null;
}

function publicInfo(t) {
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    size: t.size,
    status: t.status,
    players: t.players,
    bracket: t.bracket,
    ownerId: t.ownerId,
    createdAt: t.createdAt,
    championId: t.championId,
    playerCount: t.players ? t.players.length : 0,
  };
}

module.exports = {
  createTournament,
  joinTournament,
  onMatchFinished,
  listTournaments,
  getTournament,
  setMatchFactory,
  assignNextMatches,
};
