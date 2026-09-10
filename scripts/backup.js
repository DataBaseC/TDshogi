#!/usr/bin/env node
/**
 * scripts/backup.js — 手动备份入口（`npm run backup`）
 *
 * 服务端已内置每日自动备份（`src/backup.js` 的 `startAutoBackup`），本脚本用于：
 *  - **部署 / 升级 / 改数据结构前手动打一份**（最常用，出事能一键回滚）
 *  - 查看已有备份列表
 *
 * 用法：
 *   npm run backup                   备份一次
 *   npm run backup -- --list         列出已有备份（不执行备份）
 *   npm run backup -- --keep=30      本次备份后保留 30 份（默认 14）
 *   npm run backup -- --quiet        静默（仅失败时输出）
 */
'use strict';

const backup = require('../src/backup');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const numArg = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return def;
  const n = parseInt(hit.split('=')[1], 10);
  return Number.isFinite(n) ? n : def;
};

if (has('--help') || has('-h')) {
  console.log([
    '用法：npm run backup [-- 选项]',
    '',
    '  --list        列出已有备份（不执行备份）',
    '  --keep=N      保留最近 N 份（默认 14）',
    '  --quiet       静默模式',
    '  --help        显示本帮助',
    '',
    `备份目录：${backup.BACKUP_DIR}`,
  ].join('\n'));
  process.exit(0);
}

if (has('--list')) {
  const all = backup.listBackups();
  if (!all.length) {
    console.log(`暂无备份（目录：${backup.BACKUP_DIR}）`);
  } else {
    console.log(`共 ${all.length} 份备份（目录：${backup.BACKUP_DIR}）：`);
    for (const e of all) {
      console.log(`  ${e.file.padEnd(36)} ${backup.fmtSize(e.size).padStart(10)}`);
    }
  }
  process.exit(0);
}

const res = backup.runBackup({
  keep: numArg('keep', backup.DEFAULT_KEEP),
  quiet: has('--quiet'),
});

if (!res.ok) {
  console.error(`[backup] 备份失败：${res.reason}`);
  process.exit(1);
}
if (has('--quiet')) console.log(`[backup] 已备份 ${res.file}（${backup.fmtSize(res.size)}）`);
