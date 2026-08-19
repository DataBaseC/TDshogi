/**
 * auth.js — 游客会话管理
 *
 * v1 采用"游客免注册"模式：浏览器首次访问生成 guest_id（localStorage），
 * 服务端据此维护会话（名字、创建时间、最后在线）。
 *
 * 设计上预留了真实账号体系的扩展位：
 *  - identify() 目前基于 guest_id，后续可替换为 token / 账号 id
 *  - 所有对局、评分、棋谱均以 playerId 关联，升级账号时无需改动上层逻辑
 */
'use strict';

const { randomBytes } = require('crypto');
const { readJson, writeJson, listSessions: dbListSessions } = require('./storage');

const DEFAULT_NAMES = [
  '无名棋士', '一歩名人', '飛車使い', '銀将', '桂馬',
  '香車', '角行', '竜王', '棋聖', '玉将',
];

function genId() {
  return randomBytes(12).toString('hex');
}

/**
 * 解析 / 校验游客身份，返回会话对象（不存在则创建）。
 * @param {string|null} guestId 客户端携带的游客 id
 * @returns {{id: string, name: string, createdAt: number}}
 */
function identify(guestId) {
  let id = guestId && /^[0-9a-f]{24}$/.test(guestId) ? guestId : genId();
  const relPath = `sessions/${id}.json`;
  let session;
  try {
    session = readJson(relPath, null);
  } catch (_) {
    session = null;
  }

  if (!session || !session.id) {
    session = {
      id,
      name: DEFAULT_NAMES[Math.floor(Math.random() * DEFAULT_NAMES.length)],
      createdAt: Date.now(),
    };
  }

  // 名称兜底（账号用户名最长 16；游客改名接口仍限 12）
  session.name = typeof session.name === 'string' && session.name.trim()
    ? session.name.slice(0, 16)
    : '无名棋士';
  session.lastSeen = Date.now();

  // 持久化（每个会话独立文件，避免并发写同一文件）
  writeJson(relPath, session);
  return session;
}

/**
 * 校验一个 guest_id 是否合法（存在则返回会话，否则 null）。
 * 用于 WS 断线重连时定位对局。
 */
function load(guestId) {
  if (!guestId || !/^[0-9a-f]{24}$/.test(guestId)) return null;
  return readJson(`sessions/${guestId}.json`, null);
}

/**
 * 修改游客名字。
 * @param {string} guestId
 * @param {string} name 新名字
 * @returns {{ok: boolean, name?: string, error?: string}}
 */
function rename(guestId, name) {
  const session = identify(guestId);
  name = String(name || '').trim();
  if (!name) return { ok: false, error: '名字不能为空' };
  if (name.length > 12) return { ok: false, error: '名字最多 12 个字符' };
  session.name = name;
  writeJson(`sessions/${session.id}.json`, session);
  return { ok: true, name };
}

/**
 * 统一的玩家信息对外形状（不含内部字段）。
 */
function publicInfo(session) {
  return { id: session.id, name: session.name };
}

/**
 * 创建/更新会话（账号系统用：注册/登录后写入，名字为用户名）。
 * 与 identify 不同：不校验 guest id 格式，name 不做游客改名长度限制（上限 16）。
 */
function upsertSession(id, name) {
  if (!id) return null;
  const session = {
    id,
    name: String(name || '无名棋士').slice(0, 16) || '无名棋士',
    createdAt: Date.now(),
  };
  writeJson(`sessions/${id}.json`, session);
  return session;
}

/**
 * 列出全部游客会话（管理员用）。
 * @returns {Array<{id, name, lastSeen, createdAt}>}
 */
function listSessions() {
  try {
    return dbListSessions();
  } catch (_) {
    return [];
  }
}

module.exports = { identify, load, rename, publicInfo, genId, listSessions, upsertSession };
