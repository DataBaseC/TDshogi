#!/usr/bin/env node
/**
 * scripts/release.js — 发布自动化（§7.3）
 *
 * 用法：
 *   node scripts/release.js --help          查看用法
 *   node scripts/release.js --version       仅打印当前版本
 *   node scripts/release.js patch|minor|major   递增 package.json 版本并打包
 *
 * 只做"安全"的事：改 `package.json` 的 version、复用 `scripts/pack.js` 生成发布包。
 * **不自动 git tag / push** —— 发布到哪、何时发由人决定（自动化越界反而危险）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PKG = path.join(ROOT, 'package.json');

function usage() {
  console.log([
    'TDShogi 发布脚本',
    '',
    '用法：',
    '  node scripts/release.js --help',
    '  node scripts/release.js --version',
    '  node scripts/release.js <patch|minor|major>   递增版本并打包',
    '',
    '说明：仅递增 package.json 版本并复用打包脚本，不自动 git tag / push。',
  ].join('\n'));
}

/** x.y.z 语义化版本递增 */
function bump(v, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || ''));
  if (!m) return null;
  let a = Number(m[1]); let b = Number(m[2]); let c = Number(m[3]);
  if (kind === 'major') { a += 1; b = 0; c = 0; }
  else if (kind === 'minor') { b += 1; c = 0; }
  else { c += 1; }
  return `${a}.${b}.${c}`;
}

function main(argv) {
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h') { usage(); return 0; }

  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  if (cmd === '--version') { console.log(pkg.version); return 0; }

  if (!['patch', 'minor', 'major'].includes(cmd)) {
    console.error(`未知参数：${cmd}（用 --help 查看用法）`);
    return 2;
  }
  const next = bump(pkg.version, cmd);
  if (!next) { console.error(`package.json 的 version 不是 x.y.z 形式：${pkg.version}`); return 1; }
  pkg.version = next;
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`版本已递增：${next}`);

  try {
    execFileSync(process.execPath, [path.join(__dirname, 'pack.js')], { cwd: ROOT, stdio: 'inherit' });
  } catch (err) {
    console.error('打包失败（版本已递增）：', err.message);
    return 1;
  }
  console.log(`发布包已生成（版本 ${next}）`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
