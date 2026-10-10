/**
 * i18n-report.js — 多语言覆盖率报告（PLAN §Z5）
 *
 * **为什么需要它**：i18n 是"逐页改文案"的活，靠人肉翻页面找漏译，翻三页就烦了、
 * 也必然漏。这个脚本把"还有哪些界面文案没有词条"变成一份**清单**：
 * 加完文案跑一次，缺哪些一目了然，也就不必靠记忆维护。
 *
 * 用法：
 *   node scripts/i18n-report.js          # 只报 HTML 静态文案（默认）
 *   node scripts/i18n-report.js --js     # 连 JS 里的中文字面量一起报（含提示语/动态文案）
 *   node scripts/i18n-report.js --all    # 不截断输出
 *
 * ⚠️ 判据与运行时**完全一致**：直接调用 `i18n.js` 的查词函数（含空白/前缀 emoji 的宽松匹配），
 * 而不是自己写一套近似规则——否则报告说"已覆盖"、界面却还是中文，比没有报告更糟。
 */
'use strict';

const fs = require('fs');
const path = require('path');

// i18n.js 是浏览器 IIFE：给它最小替身即可加载（默认语言为中文时它不碰 DOM）
global.window = global;
global.document = {};
require(path.join(__dirname, '../public/js/i18n.js'));
const I18N = global.I18N;

const ROOT = path.join(__dirname, '..');
// 提取逻辑抽到 lib（2026-09-26）：共用 + 可单测。⚠️ 原实现有 bug——单行 `/* … */`
// 注释被当成未闭合块注释，settings.js 整个 SCHEMA 都被吃了，报告却显示"0 缺口"（假绿）。
const { CJK, extractJs } = require('./lib/js-extract');

/**
 * **刻意不翻**的条目（报告里跳过，免得一直挂着假缺口）。
 * 判据：页面加载后立刻被 JS 覆盖的静态占位——翻了也没人看见，反而多一条要维护的词条。
 */
const SKIP = new Set([
  '棋',       // 头像占位（实际显示的是玩家名首字/头像字形）
  '经验 0',   // 「经验」数值由 JS 填充
  // 随机昵称词库（`nav.js` 的 `randomName()`）：这些是**生成出来的玩家名**，不是界面文案。
  // 跟着界面语言变，会让同一个人的名字忽中忽日；而且它们与棋种/棋子字形同名（銀将/桂馬…），
  // 翻成英文（"Silver"）当人名更怪。
  '一歩名人', '飛車使い', '銀将', '桂馬', '香車', '角行', '竜王', '棋聖', '玉将',
  // 棋子**编码/字形映射表**（`board.js` 的 `PIECE_CODE`、`freeboard.js` 的 `PROMOTE`）：
  // 键是内部标识，不显示给玩家（棋盘上画的是图片）。翻它只会让映射对不上。
  '成香', '成桂', '成銀',
  // **拼接片段**（2026-09-26）：`'✅ 已报名（' + n + '人）'` 这类运行时拼出来的句子，
  // DOM 里是整句、词典只可能有片段，**永远匹配不上**——挂假缺口只会淹掉真缺口。
  // 要翻得先把拼接改成 t() 带变量，那是独立的技术债，不在报告里冒充"待翻"。
  '✅ 已报名（', '人）', '，报名需主办人审核', '对局结束：', '（人工裁定）',
]);

/**
 * **刻意不翻**的模式（同 SKIP，按前缀判）：
 * `file:xxx` 是音效/BGM 的**选项值**（内部标识，对应 public/sound|music/ 下的文件名），
 * 玩家看到的是旁边的显示名。文件名以后还会加，按模式跳过免得每加一首曲子挂一条假缺口。
 */
const SKIP_RE = /^file:/;

/**
 * **刻意不翻的页面**（用户 2026-09-20 拍板："admin 全中文即可"）。
 * 管理后台只有站长用，而站长就是中文用户——翻它纯属给自己加维护量。
 * 单独列出来是为了让报告能明确说"玩家页面已全覆盖"，而不是把 admin 混在缺口里。
 */
const EXCLUDE_FILES = new Set(['admin.html']);

/**
 * **刻意不翻的 JS**，理由同 `admin.html`（2026-09-23 加）。
 *
 * ⚠️ 不排除它，"玩家页面已 100%"就永远不成立：报告里会一直挂着二十来条
 * **只有管理员看得到**的文案（`已强制下线`、`该座位没有可下线的玩家`、
 * `举办理由至少 10 个字`…）。假缺口会把真缺口淹掉 —— 这正是这份报告最怕的事。
 */
const EXCLUDE_JS = new Set(['admin.js']);

/** 从 HTML 里抠出「会显示给人看」的中文片段（文本 + placeholder/title + <title>） */
function extractHtml(src) {
  const out = new Set();
  const noScript = src
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  // 文本节点
  for (const seg of noScript.replace(/<[^>]+>/g, '\n').split('\n')) {
    const t = seg.replace(/\s+/g, ' ').trim();
    if (t && CJK.test(t)) out.add(t);
  }
  // 会显示出来的属性
  for (const m of noScript.matchAll(/(?:placeholder|title|aria-label)="([^"]+)"/g)) {
    const t = m[1].replace(/\s+/g, ' ').trim();
    if (t && CJK.test(t)) out.add(t);
  }
  return out;
}

const withJs = process.argv.includes('--js') || process.argv.includes('--all');
const full = process.argv.includes('--all');
const LIMIT = full ? 100000 : 40;
/** 目标语言：`--locale=ja`（默认 en）。多语言并存时，覆盖率要**按语言分别看** */
const LOCALE = (process.argv.find((a) => a.startsWith('--locale=')) || '').split('=')[1]
  || (process.argv.includes('--ja') ? 'ja' : 'en');

const groups = [];
const excluded = [];
const htmlFiles = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html'));
for (const f of htmlFiles) {
  if (EXCLUDE_FILES.has(f)) { excluded.push(f); continue; }
  const src = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const miss = [...extractHtml(src)].filter((t) => !SKIP.has(t) && I18N._lookup(LOCALE, t) === undefined);
  if (miss.length) groups.push({ name: `public/${f}`, miss });
}
if (withJs) {
  const jsFiles = fs.readdirSync(path.join(ROOT, 'public/js'))
    .filter((f) => f.endsWith('.js') && f !== 'i18n.js' && !EXCLUDE_JS.has(f));
  const all = new Set();
  for (const f of jsFiles) {
    const src = fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8');
    for (const t of extractJs(src)) all.add(t);
  }
  const miss = [...all].filter((t) => !SKIP.has(t) && !SKIP_RE.test(t) && I18N._lookup(LOCALE, t) === undefined).sort();
  if (miss.length) groups.push({ name: 'public/js/*.js（含提示语/动态文案）', miss });
}

let total = 0;
console.log(`=== 多语言覆盖率报告（${LOCALE}）===`);
console.log(`词条数：${Object.keys(I18N._dict[LOCALE] || {}).length}\n`);
for (const g of groups) {
  total += g.miss.length;
  console.log(`▸ ${g.name} —— 缺 ${g.miss.length} 条`);
  g.miss.slice(0, LIMIT).forEach((t) => console.log(`    ${t}`));
  if (g.miss.length > LIMIT) console.log(`    …（还有 ${g.miss.length - LIMIT} 条，用 --all 看全）`);
  console.log('');
}
if (!total) console.log(`✔ 已扫描的界面文案全部有 ${LOCALE} 词条`);
else console.log(`合计缺 ${total} 条（把要翻的补进 public/js/i18n.js 的 DICT.${LOCALE} 即可）`);
if (excluded.length) {
  console.log(`\n（已排除，刻意不翻：${excluded.join('、')} —— 只有站长用，且站长是中文用户）`);
}
