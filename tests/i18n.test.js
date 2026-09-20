/**
 * 多语言单元测试（PLAN §Z5）
 *
 * 这里最值钱的是**词典自检**：词典是一张"数据表"，写错了不会报错，
 * 只会让界面出现「半句中文半句英文」或整段没翻——没人会去逐条核对两百条词条。
 * 所以：值不许为空、不许与键完全相同（复制粘贴忘改）、英文里不许残留中文（漏翻）、
 * 每个键在源码里只能定义一次（**重复键会被 JS 静默覆盖**，是这类表最阴的坑）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// 最小浏览器替身：默认语言是中文时，`i18n.js` 的加载路径**不应触碰 DOM**
// （这本身就是要保住的性质：中文用户不该付任何多语言开销）
global.window = global;
global.document = {};
const I18N_PATH = path.join(__dirname, '../public/js/i18n.js');
require(I18N_PATH);
const I18N = global.I18N;
const DICT = I18N._dict;

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/g;

test('默认语言是中文：原样返回，且加载过程不依赖 DOM', () => {
  assert.strictEqual(I18N.current().id, 'zh-CN');
  assert.strictEqual(I18N.t('首页'), '首页');
  assert.strictEqual(I18N.t('从来没翻译过的一句话'), '从来没翻译过的一句话');
  assert.strictEqual(I18N.t(''), '');
  assert.strictEqual(I18N.t(null), null);
});

test('切到英文后能翻出词条；查不到的原样返回（宁可显示中文也不显示 key）', () => {
  assert.strictEqual(I18N.setLocale('en'), true);
  assert.strictEqual(I18N.t('首页'), 'Home');
  assert.strictEqual(I18N.t('开始比赛'), 'Start tournament');
  assert.strictEqual(I18N.t('这句词典里没有'), '这句词典里没有', '未收录的文案必须原样返回');
  assert.strictEqual(I18N.setLocale('nope'), false, '未知语言应拒绝');
  assert.strictEqual(I18N.setLocale('zh-CN'), true);
  assert.strictEqual(I18N.t('首页'), '首页', '切回中文应恢复原文');
});

test('变量替换：`{n}` 占位；未收录的句子也会做替换，缺值则保留占位符', () => {
  assert.strictEqual(I18N.setLocale('en'), true);
  assert.strictEqual(I18N.t('剩 {n} 秒', { n: 30 }), '剩 30 秒',
    '未收录 → 原样返回，但**仍要做变量替换**（中文文案里带数字是常态）');
  assert.strictEqual(I18N.t('{a}/{b}', { a: 1 }), '1/{b}', '缺值的占位符保留，不显示 undefined');
  assert.strictEqual(I18N.t('没有占位符', { n: 1 }), '没有占位符');
  I18N.setLocale('zh-CN');
  assert.strictEqual(I18N.t('剩 {n} 秒', { n: 30 }), '剩 30 秒', '中文下同样替换');
});

test('查词宽松匹配：空白差异与"开头 emoji"都能命中（不必为同一句话抄两条）', () => {
  I18N.setLocale('en');
  assert.strictEqual(I18N.t('天锻将棋道场'), 'TDShogi Dojo');
  assert.strictEqual(I18N.t('天锻将棋 道场'), 'TDShogi Dojo', '内部空格不该影响命中');
  assert.strictEqual(I18N.t('  创建房间  '), 'Create a room', '首尾空白同理');
  assert.strictEqual(I18N.t('🏠 创建房间'), '🏠 Create a room', '前缀 emoji 原样保留');
  assert.strictEqual(I18N.t('🏠创建房间'), '🏠Create a room', 'emoji 后没空格也保留原样');
  assert.strictEqual(I18N.t('🚩 举报对手'), '🚩 Report opponent');
  // 宽松匹配**只能跨过排版差异**，不能把另一句话当成同一句
  assert.strictEqual(I18N.t('创建房间并邀请好友'), '创建房间并邀请好友', '长句不该被部分匹配');
  assert.strictEqual(I18N.t('房间号'), 'Room code');
  I18N.setLocale('zh-CN');
});

/** 取某个语言在源码里的那一段（重复键要**按语言分别数**：同一个键在各语言里各出现一次是正常的） */
function blockOf(locale) {
  const src = fs.readFileSync(I18N_PATH, 'utf8');
  const start = src.indexOf(`\n    ${locale}: {`);
  assert.ok(start > 0, `源码里找不到 ${locale} 词典块`);
  const others = Object.keys(DICT)
    .map((l) => src.indexOf(`\n    ${l}: {`))
    .filter((i) => i > start);
  const end = others.length ? Math.min(...others) : src.indexOf('\n  };');
  return src.slice(start, end);
}

test('词典自检：各语言值非空，且**本语言块内**键不重复', () => {
  for (const [loc, dict] of Object.entries(DICT)) {
    const block = blockOf(loc);
    const keys = Object.keys(dict);
    assert.ok(keys.length >= 100, `${loc} 词条数量偏少（${keys.length}）——是不是漏了一大块？`);
    for (const k of keys) {
      const v = dict[k];
      assert.strictEqual(typeof v, 'string', `${loc}「${k}」的译文必须是字符串`);
      assert.ok(v.trim().length > 0, `${loc}「${k}」的译文不能为空`);
      // 重复键：JS 对象字面量里后一个会**静默覆盖**前一个，表现为"改了没生效"
      const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^\\s{6}(?:'${esc}'|${esc})\\s*:`, 'gm');
      const n = (block.match(re) || []).length;
      assert.strictEqual(n, 1, `${loc} 的词条「${k}」在本语言块里出现 ${n} 次（重复键会被静默覆盖）`);
    }
  }
});

test('词典自检 en：译文与原文相同 = 漏翻（日语不适用：将棋术语本就同形）', () => {
  const same = Object.entries(DICT.en).filter(([k, v]) => k === v).map(([k]) => k);
  assert.deepStrictEqual(same, [], '以下英文词条与原文完全相同（复制粘贴漏改？）：\n' + same.join('\n'));
});

test('词典自检 en：值里不许残留中文（漏翻的高频形态）', () => {
  const bad = [];
  for (const [k, v] of Object.entries(DICT.en)) {
    const cjk = (v.match(CJK) || []).length;
    if (!cjk) continue;
    // 允许少量"本来就得写成日文/中文"的专有名词（如引号里的「詰み」），
    // 但占比过高基本就是整条没翻。
    const ratio = cjk / v.replace(/\s/g, '').length;
    if (ratio > 0.15) bad.push(`${k} → ${v}（中文占比 ${(ratio * 100).toFixed(0)}%）`);
  }
  assert.deepStrictEqual(bad, [], '以下词条的英文里残留中文过多：\n' + bad.join('\n'));
});

test('词典自检 ja：不许出现明显的简体字（照抄中文忘了改日文写法）', () => {
  // ⚠️ 黑名单只放**确定不在日文里使用**的字。像「学 / 画 / 声 / 連 / 通 / 数 / 体」这些
  //    中日同形字一旦进黑名单，就会把正确译文误判成错的 —— 这个自检要的是"能信"，
  //    不是"查得全"。
  const SIMPLIFIED_ONLY = '飞车让时图标准样员问题录详击举变处备关开长门间从众决办务单发复头应总报择无显术机权极构检电确种积签类紧经结续统编联节见观规计记论设证评词试说读课调谢贝财责费边过运还这进远选递邮';
  const bad = [];
  for (const [k, v] of Object.entries(DICT.ja)) {
    for (const ch of v) {
      if (SIMPLIFIED_ONLY.includes(ch)) { bad.push(`${k} → ${v}（含简体字「${ch}」）`); break; }
    }
  }
  assert.deepStrictEqual(bad, [], '以下日语词条里出现简体字：\n' + bad.join('\n'));
});

test('语言列表自检：id 唯一、有可显示的短标签（导航按钮要用）', () => {
  const ids = new Set();
  for (const l of I18N.LOCALES) {
    assert.ok(!ids.has(l.id), `语言 id 重复: ${l.id}`);
    ids.add(l.id);
    assert.ok(l.label && l.short, `${l.id} 缺 label/short`);
  }
  assert.strictEqual(I18N.LOCALES[0].id, 'zh-CN', '第一种应是默认语言（中文）');
  assert.ok(ids.has('en'), '应包含英文');
});
