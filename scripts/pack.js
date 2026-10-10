#!/usr/bin/env node
/**
 * pack.js — 前端打包器（无构建链，纯拼接）
 *
 * 背景：仓库的 `public/js/*.bundle.js` 是把 `public/js/` 下的散源文件按
 * 「js/xxx.js」分节标记（形如 `* ==== js/xxx.js ==== *`，两端补斜杠）**顺序拼接**
 * 成的产物。此前打包脚本未提交，导致「改了源码无法复现产物、无法验证」。
 * 本文件把它补回来，并做到**逐字节可复现**。
 *
 * 拼接格式（已对仓库现有 9 个 bundle 逐字节验证）：
 *   bundle = "\n".join( marker(name) + readFile(name)  for name in order )
 *   其中 marker(name) = 分节标记行（含行尾 "\n"）
 *   —— 即段间用单个 "\n" 连接，**末尾不额外补换行**（各源文件自身已以 "\n" 结尾）。
 *
 * 产物 / 动作（两件）：
 *  1) 前端 SPA 单文档 bundle（`app.bundle.js`）——共享内核单例 + 路由 + 所有页面 View。
 *  2) 部署上传区同步（README §部署上传区）——按清单把要部署的文件同步到 `github-upload/`。
 *
 * 用法：
 *   node scripts/pack.js            # 打 bundle + 同步部署上传区
 *   node scripts/pack.js --check    # 校验：bundle 逐字节可复现 + 上传区与源码一致
 *   node scripts/pack.js app        # 只打 bundle（不同步）
 *   node scripts/pack.js deploy     # 只同步部署上传区（不打 bundle）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'public', 'js');

/** 单个源文件 → 带标记的段 */
function segment(name) {
  const src = fs.readFileSync(path.join(JS_DIR, name));
  const marker = Buffer.from(`/* ==== js/${name} ==== */\n`, 'utf8');
  return Buffer.concat([marker, src]);
}

/** 顺序拼接：段间单个 "\n"，末尾不补 */
function build(order) {
  return Buffer.concat(order.map(segment).flatMap((seg, i) => (i === 0 ? [seg] : [Buffer.from('\n'), seg])));
}

// ------------------------------------------------------------------
// 清单：bundle 文件名 → 源文件顺序（顺序即依赖顺序，勿随意调换）
// ------------------------------------------------------------------

// （旧的 9 个 per-page bundle 已随全量 SPA 迁移移除；它们的逐字节复现性已在迁移前
//   验证通过，见 git 历史。现在只保留 SPA 单文档 bundle。）
const APP = {
  'app.bundle.js': [
    // —— 共享内核（单例，加载一次）——
    'a11y.js',
    'settings.js',
    'sound.js',      // BGM 常驻（跨路由不销毁）
    'util.js',
    'i18n.js',
    'nav.js',        // 导航只渲染一次，之后仅改 active 态
    'api.js',        // 唯一 WebSocket + 订阅/退订
    'hovercard.js',
    // —— 棋盘栈（play / review 共用）——
    'pieces.js',
    'piece-kinds.js',
    'board.js',
    'freeboard-dnd.js',
    'freeboard.js',
    // —— 路由（View 注册表 + History API）——
    'router.js',
    // —— 页面 View（各自注册 window.Views.<name>）——
    'home.js',
    'lobby.js',
    'gallery.js',
    'tournaments.js',
    'tournament.js',
    'profile.js',
    'records-console.js',
    'tabs.js',
    'review.js',
    'play-clock.js',
    'play-chat.js',
    'play-demo.js',
    'play-views.js',
    'play.js',
    'admin-shell.js',
    'admin-records.js',
    'admin-users.js',
    'admin-audit.js',
    'admin-tournaments.js',
    'admin-moderation.js',
    'admin-console.js',
    'admin-items.js',
    'admin.js',
    // —— 启动器（最后：等所有 View 注册完）——
    'boot.js',
  ],
};

const TARGETS = APP;

// ==================================================================
// 部署上传区（README §部署上传区）：`npm run pack` 同步部署清单到 `github-upload/`。
// 整目录拖到 GitHub / scp 到服务器即可。清单**只在此一处维护** ——
// 手抄易漏掉新增的、被服务端 require 的文件。
// ==================================================================
const DEPLOY_OUT = path.join(ROOT, 'github-upload');
const DEPLOY_MANIFEST = [
  'package.json', 'package-lock.json', '.npmrc',
  'server.js', 'DEPLOY.md', 'README.md',
  'src', 'public', // 目录，递归复制
];

/** 递归列出目录下所有文件（相对 rel 路径） */
function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = base ? path.join(base, name) : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) walk(abs, rel, out);
    else out.push(rel);
  }
  return out;
}

function deploySourceFiles() {
  const files = [];
  for (const entry of DEPLOY_MANIFEST) {
    const abs = path.join(ROOT, entry);
    if (!fs.existsSync(abs)) {
      console.error(`✗ 部署清单缺失: ${entry}`);
      process.exit(1);
    }
    if (fs.statSync(abs).isDirectory()) walk(abs, entry, files);
    else files.push(entry);
  }
  return files;
}

/** 同步（或校验）部署上传区。返回失败数。 */
function syncDeploy(check) {
  const want = deploySourceFiles();
  if (!check) {
    fs.rmSync(DEPLOY_OUT, { recursive: true, force: true });
    for (const rel of want) {
      const src = path.join(ROOT, rel);
      const dst = path.join(DEPLOY_OUT, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
    console.log(`✓ 同步部署上传区 github-upload/（${want.length} 个文件）`);
    return 0;
  }
  let bad = 0;
  for (const rel of want) {
    const src = path.join(ROOT, rel);
    const dst = path.join(DEPLOY_OUT, rel);
    if (!fs.existsSync(dst)) { console.error(`✗ 上传区缺少: ${rel}`); bad++; continue; }
    if (!fs.readFileSync(src).equals(fs.readFileSync(dst))) { console.error(`✗ 上传区与源码不一致: ${rel}`); bad++; }
  }
  const have = fs.existsSync(DEPLOY_OUT) ? walk(DEPLOY_OUT, '', []) : [];
  const wantSet = new Set(want.map((r) => path.normalize(r)));
  for (const rel of have) {
    if (!wantSet.has(path.normalize(rel))) { console.error(`✗ 上传区多余: ${rel}`); bad++; }
  }
  if (bad) { console.error(`\n上传区不同步（${bad} 处）—— 跑 npm run pack 重新同步`); return 1; }
  console.log(`✓ 部署上传区同步一致（${want.length} 个文件）`);
  return 0;
}

function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const scope = argv.find((a) => !a.startsWith('--')); // 'app' 只打 bundle / 'deploy' 只同步 / 缺省两者

  let failed = 0;

  // 1) 前端 SPA bundle（先打，保证同步进上传区的是最新产物）
  if (scope !== 'deploy') {
    for (const [out, order] of Object.entries(TARGETS)) {
      for (const name of order) {
        if (!fs.existsSync(path.join(JS_DIR, name))) {
          console.error(`✗ ${out}: 源文件缺失 public/js/${name}`);
          process.exit(1);
        }
      }
      const buf = build(order);
      const outFile = path.join(JS_DIR, out);
      if (check) {
        const onDisk = fs.existsSync(outFile) ? fs.readFileSync(outFile) : null;
        if (onDisk && onDisk.equals(buf)) {
          console.log(`✓ ${out} 与源码逐字节一致（${buf.length} 字节）`);
        } else {
          console.error(`✗ ${out} 与源码重打不一致（磁盘 ${onDisk ? onDisk.length : -1} 字节 / 重打 ${buf.length} 字节）`);
          failed++;
        }
      } else {
        fs.writeFileSync(outFile, buf);
        console.log(`✓ 写入 ${out}（${buf.length} 字节，${order.length} 模块）`);
      }
    }
  }

  // 2) 部署上传区
  if (scope !== 'app') {
    failed += syncDeploy(check);
  }

  if (check) {
    if (failed) {
      console.error(`\n${failed} 处不一致 —— 请先 npm run pack 重建/同步。`);
      process.exit(1);
    }
    console.log('\n打包与上传区均可复现/已同步 ✓');
  } else {
    console.log('\n打包完成');
  }
}

main();
