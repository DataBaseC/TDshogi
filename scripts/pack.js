/**
 * scripts/pack.js — 生成「部署上传区」（PLAN 部署流程）
 *
 * **为什么用目录而不是 zip**：上传到 GitHub / 服务器时整目录拖拽即可，不必"打包 → 传输 → 解压"
 * 三步；每次改完代码跑一次 `npm run pack` 就同步好了，也不会出现「zip 是三天前的」这种事故。
 *
 * **清单不手抄**：内容与 `DEPLOY.md` 第一节「要传哪些文件」严格一致，只在此处维护一份
 * （`ITEMS` 常量）——手抄清单的典型事故是漏掉新增文件，而漏掉的文件往往正是启动时 require 的。
 *
 * 用法：
 *   npm run pack            # 同步上传区（会先清空再复制）
 *   npm run pack -- --check # 只校验：对比源码与上传区是否完全一致，不写入
 *
 * ⚠️ 上传区是**生成物**：不要在 `github-upload/` 里直接改代码，改了下次 pack 会被覆盖。
 * ⚠️ 该目录已在 `.gitignore` 中排除——它是给「拖到 GitHub 上传」用的，
 *    若纳入主仓库会让 src/public 在仓库里出现两份。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'github-upload');

/** 部署清单（与 DEPLOY.md 第一节保持一致；目录会递归展开） */
const ITEMS = [
  'package.json',
  'package-lock.json',
  '.npmrc',
  'server.js',
  'DEPLOY.md',
  'README.md',
  'src',
  'public',
];

const checkOnly = process.argv.includes('--check');

/** 递归列出目录下所有文件（相对路径，统一用 `/`） */
function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(abs, base));
    else out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out.sort();
}

/** 期望出现在上传区的文件清单（以源码树为准展开） */
function expectedFiles() {
  const files = [];
  for (const item of ITEMS) {
    const abs = path.join(ROOT, item);
    if (!fs.existsSync(abs)) {
      console.error('✘ 清单项不存在，请检查 DEPLOY.md / ITEMS：' + item);
      process.exitCode = 1;
      continue;
    }
    if (fs.statSync(abs).isDirectory()) {
      for (const f of listFiles(abs)) files.push(`${item}/${f}`);
    } else {
      files.push(item);
    }
  }
  return files.sort();
}

/** 对比两侧清单；返回差异描述（空数组 = 一致） */
function diff(expected, actual) {
  const expSet = new Set(expected);
  const actSet = new Set(actual);
  const missing = expected.filter((f) => !actSet.has(f)); // 源码有、上传区没有
  const extra = actual.filter((f) => !expSet.has(f));     // 上传区有、源码没有
  return { missing, extra };
}

function summarize(label, files) {
  const perTop = new Map();
  for (const f of files) {
    const top = f.includes('/') ? f.slice(0, f.indexOf('/')) : '(根文件)';
    perTop.set(top, (perTop.get(top) || 0) + 1);
  }
  console.log(`${label}：共 ${files.length} 个文件`);
  for (const [top, n] of [...perTop.entries()].sort()) {
    console.log(`  ${top.padEnd(18, ' ')} ${n}`);
  }
}

const expected = expectedFiles();

if (checkOnly) {
  if (!fs.existsSync(OUT)) {
    console.error('✘ 上传区还不存在，请先运行 `npm run pack`');
    process.exit(1);
  }
  const { missing, extra } = diff(expected, listFiles(OUT));
  if (!missing.length && !extra.length) {
    console.log('✔ 上传区与源码一致（' + expected.length + ' 个文件）');
    process.exit(0);
  }
  if (missing.length) console.error('✘ 上传区缺少 ' + missing.length + ' 个文件：\n  ' + missing.join('\n  '));
  if (extra.length) console.error('✘ 上传区多出 ' + extra.length + ' 个文件（源码里已不存在）：\n  ' + extra.join('\n  '));
  process.exit(1);
}

// 覆盖式同步（**刻意不做整目录删除**）：
//  - 最初实现是「rmSync 整个目录再重建」，但在装有 safe-delete 保护钩子的环境里，
//    递归删除会被直接拦下 → 打包整个失败（本仓库实际踩到过）；
//  - 改成「复制覆盖 + 只删多余文件」后，不再需要递归删除，同样不会留残影。
fs.mkdirSync(OUT, { recursive: true });

for (const item of ITEMS) {
  fs.cpSync(path.join(ROOT, item), path.join(OUT, item), { recursive: true, force: true });
}

// 清掉「源码里已删除、上传区还留着」的旧文件（只删文件，不动目录树）
const stale = diff(expected, listFiles(OUT)).extra;
for (const rel of stale) {
  try { fs.unlinkSync(path.join(OUT, rel)); } catch (_) { /* 删不掉就留给下面的自校报出来 */ }
}

// 复制后立即自校：搬运工具最典型的假安全感就是「我以为复制成功了」
const { missing, extra } = diff(expected, listFiles(OUT));
if (missing.length || extra.length) {
  if (missing.length) {
    console.error('✘ 复制后仍缺少 ' + missing.length + ' 个文件：\n  ' + missing.join('\n  '));
  }
  if (extra.length) {
    console.error('✘ 上传区多出 ' + extra.length + ' 个文件（源码里已不存在），且自动删除失败，请手动清理：\n  ' + extra.join('\n  '));
  }
  process.exit(1);
}

console.log('✔ 部署上传区已同步 → github-upload/');
summarize('  内容', expected);
console.log('');
console.log('  下一步：把 `github-upload/` 整个目录拖到 GitHub 仓库（或 scp/rsync 到服务器）');
console.log('  改了代码后重新执行：npm run pack');
