/**
 * storage.js — 轻量 JSON 文件存储工具
 *
 * 平台不依赖数据库，所有持久化数据以 JSON 文件落盘到 data/ 目录。
 * 本模块提供统一的读取 / 写入 / 原子保存能力，并对读取失败做优雅降级
 * （返回默认值而不是抛异常），确保服务端健壮、易测试。
 */
'use strict';

const fs = require('fs');
const path = require('path');

// 运行时数据根目录（可用环境变量 DATA_DIR 覆盖，便于部署到持久目录）
// 默认相对项目根目录 data/
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const RECORDS_DIR = path.join(DATA_DIR, 'records');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureDataDirs() {
  ensureDir(DATA_DIR);
  ensureDir(RECORDS_DIR);
  ensureDir(SESSIONS_DIR);
}

/**
 * 读取 JSON 文件，文件不存在或解析失败时返回 fallback。
 * @param {string} name 文件名（相对 data/）
 * @param {*} fallback 默认值
 * @returns {*}
 */
function readJson(name, fallback = null) {
  const file = path.join(DATA_DIR, name);
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`[storage] 读取 ${name} 失败: ${err.message}`);
    return fallback;
  }
}

/**
 * 原子写入 JSON 文件（先写临时文件再 rename，避免半写损坏）。
 * @param {string} name 文件名（相对 data/）
 * @param {*} data 任意可 JSON 序列化的数据
 */
function writeJson(name, data) {
  ensureDataDirs();
  const file = path.join(DATA_DIR, name);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * 读取记录文件列表（records/ 目录），返回文件绝对路径数组。
 * @param {string[]} [exts] 允许的扩展名，缺省为 .json
 */
function listRecordFiles(exts = ['.json']) {
  try {
    if (!fs.existsSync(RECORDS_DIR)) return [];
    return fs.readdirSync(RECORDS_DIR)
      .filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)))
      .map((f) => path.join(RECORDS_DIR, f))
      .sort();
  } catch (err) {
    console.error(`[storage] 读取 records 目录失败: ${err.message}`);
    return [];
  }
}

module.exports = {
  DATA_DIR,
  RECORDS_DIR,
  SESSIONS_DIR,
  ensureDataDirs,
  readJson,
  writeJson,
  listRecordFiles,
};
