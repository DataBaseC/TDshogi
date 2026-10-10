/**
 * scripts/bundle.js — 页面脚本合并（§6.1「页面脚本过多与无构建取舍」）
 *
 * **问题**：`play.html` 首屏要发 17 个 `<script src>`，`admin.html` 13 个。无构建是**故意**的
 * （开发时改完刷新即生效，没有构建缓存/热更新那套），但**上线产物**没必要把请求数摊这么大。
 *
 * **策略**（严格按 §6.1 的取舍）：**只在产物层做**。
 *   - 源码 `public/*.html` **一字不动**——开发形态仍是「无构建」，改完刷新即生效；
 *   - 产物 `github-upload/public/` 里，把每页的 `<script src="js/…">` 按**原顺序**合并成
 *     一个 `js/<page>.bundle.js`，HTML 里只留一个 `<script>`。
 *
 * **为什么能安全地「原样拼接」**（不是想当然，是量过的）：
 *   - 每个 `public/js/*.js` 都是**自包含 IIFE**（`(function(global){ 'use strict'; … })(window)`），
 *     顶层作用域几乎无污染 → 合并后**没有重名冲突**，也不会互相踩；
 *   - 每个 IIFE 内的 `'use strict'` 合并后仍在各自函数体的**指令位** → **严格性逐文件保留**
 *     （这点很关键：`§M5` 刚踩过「严格模式丢了，给只读 getter 赋值不报错」的坑）；
 *   - 跨文件通信一律走 `window.Xxx`（上一轮 §4.1 立的规范）→ 合并前后**完全等价**。
 *
 * 因此本模块**不做**转译/压缩/重命名，只做「按序拼接 + 改写 script 标签」——产物可读、可调试、
 * 出错时行号直接对得上源文件（每个文件的边界都有一行 `==== js/xxx.js ====` 分隔注释）。
 *
 * 用法：
 *   node scripts/bundle.js                      # 产物化 github-upload/public（默认）
 *   node scripts/bundle.js <public目录>          # 产物化指定目录（测试用）
 * 库用法：`const { bundleDir, scriptNames } = require('./bundle')`
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** 只认「独占一行的整标签、src 指向 js/ 下、无其它属性」的脚本——与页面里实际写法严格对应 */
const SCRIPT_RE_G = /<script\s+src="js\/([^"]+)"><\/script>/g;

/** 取 HTML 里按出现顺序的 js 脚本名 */
function scriptNames(html) {
  return [...html.matchAll(SCRIPT_RE_G)].map((m) => m[1]);
}

/** 页面 → bundle 文件名，如 play.html → play.bundle.js */
function bundleNameFor(html) {
  return html.replace(/\.html$/, '') + '.bundle.js';
}

/** 按原顺序拼接脚本体，逐文件加边界注释（调试用；注释不影响指令位） */
function bundleSource(dir, names) {
  return names
    .map((n) => `/* ==== js/${n} ==== */\n${fs.readFileSync(path.join(dir, 'js', n), 'utf8')}`)
    .join('\n');
}

/**
 * 产物化一个 public 目录（**原地**）：对每个含 ≥2 个 js 脚本的页面，
 * 生成 `<page>.bundle.js` 并把 HTML 里的多个 `<script>` 收敛成一个。
 *
 * 幂等：已是产物态（只剩 1 个脚本）的页面会跳过——不会二次处理、不会套娃。
 *
 * @returns {Array<{html:string, bundle?:string, count?:number, bytes?:number, skipped?:boolean}>}
 */
function bundleDir(dir) {
  const jsDir = path.join(dir, 'js');
  if (!fs.existsSync(jsDir)) throw new Error(`没有 js 目录：${jsDir}（应先 pack 或指定正确目录）`);
  const report = [];
  const htmls = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
  for (const html of htmls) {
    const p = path.join(dir, html);
    const src = fs.readFileSync(p, 'utf8');
    const names = scriptNames(src);
    if (names.length < 2) {
      // 0 个（无脚本页）或 1 个（已是产物态/本就单脚本）→ 不动
      report.push({ html, skipped: true, count: names.length });
      continue;
    }
    const bundle = bundleNameFor(html);
    const merged = bundleSource(dir, names);
    fs.writeFileSync(path.join(jsDir, bundle), merged);
    let seen = false;
    const out = src.replace(SCRIPT_RE_G, () => {
      if (seen) return '';           // 其余脚本标签删掉（内容已并入 bundle）
      seen = true;
      return `<script src="js/${bundle}"></script>`;
    });
    fs.writeFileSync(p, out);
    report.push({ html, bundle, count: names.length, bytes: Buffer.byteLength(merged) });
  }
  return report;
}

module.exports = { scriptNames, bundleNameFor, bundleSource, bundleDir, SCRIPT_RE_G };

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const dir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(ROOT, 'github-upload', 'public');
  const report = bundleDir(dir);
  let saved = 0;
  console.log(`✔ 页面脚本已合并（${dir}）`);
  for (const r of report) {
    if (r.skipped) {
      console.log(`  ·（跳过，仅 ${r.count} 个脚本）${r.html}`);
    } else {
      saved += r.count - 1;
      console.log(`  ${String(r.count).padStart(2)} → 1 个请求   ${r.html.padEnd(18, ' ')} → js/${r.bundle}（${(r.bytes / 1024).toFixed(1)}KB）`);
    }
  }
  console.log(`  合计减少 ${saved} 个首屏请求`);
}
