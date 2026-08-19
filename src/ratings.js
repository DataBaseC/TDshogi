/**
 * ratings.js — ELO 评级系统（参考 81Dojo 的 R300 评级形态）
 *
 * 人人对战计入积分：
 *  - 起始 1500，K=32
 *  - 胜 R' = R + K×(1-E)，负 R' = R + K×(0-E)，平各 0.5
 *  - E = 1/(1+10^((Rb-Ra)/400))
 *
 * 数据以 ratings.json 落盘，内存缓存避免频繁 I/O。
 */
'use strict';

const { readJson, writeJson } = require('./storage');
const auth = require('./auth');

const START_RATING = 1500;
const K = 32;

function defaultRating() {
  return {
    rating: START_RATING,
    games: 0,     // 总对局数
    wins: 0,
    losses: 0,
    draws: 0,
    // 历史采样点（供个人页 ELO 走势图）：[{t, rating}]
    history: [],
  };
}

/**
 * 加载全部评级表（内存缓存）。
 */
function loadRatings() {
  const data = readJson('ratings.json', {});
  if (!data || typeof data !== 'object') return {};
  return data;
}

let cache = null;

function getCache() {
  if (!cache) cache = loadRatings();
  return cache;
}

function persist() {
  writeJson('ratings.json', getCache());
}

/** 强制刷新内存缓存（账号迁移游客数据后调用） */
function refreshCache() {
  cache = loadRatings();
}

function ensurePlayer(ratings, playerId) {
  if (!ratings[playerId]) ratings[playerId] = defaultRating();
  return ratings[playerId];
}

function expectedScore(rA, rB) {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

/**
 * 记录一局结果并更新双方评级。
 * @param {string} playerA 先手 id
 * @param {string} playerB 后手 id
 * @param {'b'|'w'|'-'} winner 胜者；b=先手 w=后手 -=平
 */
function applyGameResult(playerA, playerB, winner) {
  const ratings = getCache();
  const a = ensurePlayer(ratings, playerA);
  const b = ensurePlayer(ratings, playerB);

  const rA = a.rating;
  const rB = b.rating;
  const scoreA = winner === 'b' ? 1 : winner === '-' ? 0.5 : 0;
  const scoreB = 1 - scoreA;

  const eA = expectedScore(rA, rB);
  const eB = expectedScore(rB, rA);

  a.rating = Math.round(rA + K * (scoreA - eA));
  b.rating = Math.round(rB + K * (scoreB - eB));
  a.games++; b.games++;
  if (winner === 'b') a.wins++, b.losses++;
  else if (winner === 'w') a.losses++, b.wins++;
  else { a.draws++; b.draws++; }

  const now = Date.now();
  a.history.push({ t: now, rating: a.rating });
  b.history.push({ t: now, rating: b.rating });

  persist();
  return { deltaA: a.rating - rA, deltaB: b.rating - rB };
}

/**
 * 排行榜（按 ELO 降序），limit 控制条数。
 * 附带该玩家自身信息（含排名），用于首页"自己高亮"。
 */
function leaderboard(playerId, limit = 10) {
  const ratings = getCache();
  const withName = (e) => {
    const s = auth.load(e.id);
    e.name = s ? s.name : e.id;
    return e;
  };
  const entries = Object.entries(ratings)
    .filter(([, r]) => r.games > 0)
    .map(([id, r]) => ({
      id,
      rating: r.rating,
      games: r.games,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
    }))
    .sort((x, y) => y.rating - x.rating)
    .map(withName);

  const top = entries.slice(0, limit);
  let self = null;
  if (playerId) {
    const idx = entries.findIndex((e) => e.id === playerId);
    if (idx >= 0) {
      self = { ...withName({ ...entries[idx] }), rank: idx + 1 };
    }
  }
  return { list: top, self };
}

/**
 * 个人评级与战绩统计。
 */
function profile(playerId) {
  const ratings = getCache();
  const r = ratings[playerId] || defaultRating();
  const games = r.games;
  const winRate = games ? Math.round((r.wins / games) * 100) : 0;
  return {
    rating: r.rating,
    games,
    wins: r.wins,
    losses: r.losses,
    draws: r.draws,
    winRate,
    history: r.history.slice(-50),
  };
}

/**
 * 全部用户列表（管理员用）：合并评级 + 会话名。
 * 包含所有有评级记录或会话存在的用户。
 */
function allUsers() {
  const ratings = getCache();
  const sessions = auth.listSessions();
  const map = new Map();
  for (const s of sessions) {
    map.set(s.id, { id: s.id, name: s.name, lastSeen: s.lastSeen, createdAt: s.createdAt });
  }
  for (const [id, r] of Object.entries(ratings)) {
    const cur = map.get(id) || { id, name: id, lastSeen: null, createdAt: null };
    cur.rating = r.rating;
    cur.games = r.games;
    cur.wins = r.wins;
    cur.losses = r.losses;
    cur.draws = r.draws;
    cur.winRate = r.games ? Math.round((r.wins / r.games) * 100) : 0;
    map.set(id, cur);
  }
  return [...map.values()].sort((a, b) => (b.games || 0) - (a.games || 0) || (b.lastSeen || 0) - (a.lastSeen || 0));
}

module.exports = {
  START_RATING,
  K,
  applyGameResult,
  leaderboard,
  profile,
  allUsers,
  getCache,
  persist,
  refreshCache,
};
