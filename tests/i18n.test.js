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

test('词典自检：值非空、不是键的复制、键在源码里只定义一次', () => {
  const src = fs.readFileSync(I18N_PATH, 'utf8');
  const keys = Object.keys(DICT.en);
  assert.ok(keys.length >= 150, `词条数量偏少（${keys.length}）——是不是漏了一大块？`);
  for (const k of keys) {
    const v = DICT.en[k];
    assert.strictEqual(typeof v, 'string', `「${k}」的译文必须是字符串`);
    assert.ok(v.trim().length > 0, `「${k}」的译文不能为空`);
    assert.notStrictEqual(v, k, `「${k}」的译文与原文完全相同（复制粘贴漏改？）`);
    // 重复键：JS 对象字面量里后一个会**静默覆盖**前一个，表现为"改了没生效"
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^\\s{6}(?:'${esc}'|${esc})\\s*:`, 'gm');
    const n = (src.match(re) || []).length;
    assert.strictEqual(n, 1, `词条「${k}」在源码里出现 ${n} 次（重复键会被静默覆盖）`);
  }
});

test('词典自检：英文词条里不许残留中文（漏翻的高频形态）', () => {
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
