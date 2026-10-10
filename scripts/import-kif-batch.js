/**
 * scripts/import-kif-batch.js — 批量导入 KIF 棋谱到平台棋谱库
 *
 * 用法：node scripts/import-kif-batch.js <kif目录> [--dry-run]
 * 示例：node scripts/import-kif-batch.js 参考文件/shogi-app/data/records
 *
 * 把指定目录下所有 .kif 文件解析并保存为平台棋谱记录（source='kif-import'）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { importKif } = require('../src/records');

const dir = process.argv[2] || path.join(__dirname, '..', '参考文件', 'shogi-app', 'data', 'records');
const dryRun = process.argv.includes('--dry-run');
if (!dir && !process.argv[2]) {
  console.log(`使用默认目录: ${dir}`);
}

if (!fs.existsSync(dir)) {
  console.error(`目录不存在: ${dir}`);
  process.exit(1);
}

const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.kif'));
console.log(`发现 ${files.length} 个 KIF 文件（${dryRun ? '模拟运行' : '正式导入'}）`);

let ok = 0, fail = 0;
for (const f of files) {
  try {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const res = importKif(text);
    if (res.ok) {
      ok++;
      if (!dryRun) console.log(`✔ 已导入: ${f} → ${res.record.names[0]} vs ${res.record.names[1]} (${res.record.moves.length}手)`);
    } else {
      fail++;
      console.log(`✘ ${f}: ${res.error}`);
    }
  } catch (e) {
    fail++;
    console.log(`✘ ${f}: ${e.message}`);
  }
}
console.log(`\n完成：成功 ${ok}，失败 ${fail}${dryRun ? '（模拟，未写入）' : ''}`);
