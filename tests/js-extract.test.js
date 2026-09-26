/**
 * js-extract.test.js — 词条提取器（`scripts/lib/js-extract.js`）的回归测试。
 *
 * ⚠️ 为什么必须有这些用例（2026-09-26 实测踩过）：
 * 提取器原来藏在 `i18n-report.js` 里没法单测，于是它悄悄出错时**没人发现**——
 * `stripComments` 遇到**单行** `/* … *​/` 注释当作"未闭合块注释"，
 * 把后续所有行都当注释吃掉：settings.js 的整个 SCHEMA（'深色'、'落子音'…）
 * 从未被提取，覆盖率报告却一直显示"0 缺口"。**假绿比报红更糟**：
 * 报告的价值全在"能信"。
 *
 * 所以这里把两类错误都钉死：
 *  1) 单行块注释必须在**同一行**闭合，后续代码照常提取；
 *  2) 注释里的中文必须真的被剔除（不能矫枉过正把它们当界面文案）。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { CJK, stripComments, extractJs } = require('../scripts/lib/js-extract');

test('回归：单行 `/* … *​/` 注释不得吞掉后续代码（2026-09-26 假绿事故）', () => {
  const src = [
    '/** 单行注释（内部含 中文 示例） */',
    'const a = "后面还有词条：落子音";',
    'const b = 1; /* 同行闭合 */ const c = "再后面：读秒音";',
    '/* 跨行注释 中文 示例',
    '   还在注释里 */',
    'const d = "跨行之后：分钟提醒音";',
  ].join('\n');
  const got = [...extractJs(src)].sort();
  assert.deepStrictEqual(got, [
    '再后面：读秒音',
    '后面还有词条：落子音',
    '跨行之后：分钟提醒音',
  ].sort());
});

test('stripComments：注释变空白但行结构保留，引号里的注释符号不是注释', () => {
  const src = [
    'const s = "字符串里的 // 不是注释，/* 也不是 */";',
    'const n = 1; // 这才是注释',
  ].join('\n');
  const out = stripComments(src);
  assert.ok(out.includes('字符串里的 // 不是注释，/* 也不是 */'), '引号内应原样保留');
  assert.ok(!out.includes('这才是注释'), '行注释应被抹掉');
  assert.strictEqual(out.split('\n').length, 2, '行数不变');
});

test('extractJs 过滤规则：插值/标签/日志前缀/过短过长都不是界面文案', () => {
  const src = [
    'const a = `带 ${x} 插值的模板`; ',
    'const b = "<div>含标签</div>";',
    'const c = "[PieceKinds] 内部日志前缀";',
    'const d = "短";',
    'const e = "' + '长'.repeat(81) + '";',
  ].join('\n');
  const got = [...extractJs(src)];
  assert.deepStrictEqual(got, [], '这些都不该被当成待翻文案');
});

test('CJK 覆盖扩展 A，假名不算（ja 词典值不该被误扫成待翻文案）', () => {
  assert.ok(CJK.test('龘'), '扩展 A 区汉字应命中');
  assert.ok(!CJK.test('ホーム'), '片假名不该命中');
  assert.ok(CJK.test('投了'), '常用汉字应命中');
});
