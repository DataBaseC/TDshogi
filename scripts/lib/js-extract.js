/**
 * js-extract.js — 从 JS 源码里抠出「会显示给人看」的中文字符串字面量。
 *
 * 供 `scripts/i18n-report.js`（覆盖率报告）与测试共用。
 *
 * ⚠️ 为什么单独成模块（2026-09-26）：原实现藏在 i18n-report.js 里不可 require，
 * 于是它悄悄出错时没人发现——2026-09-26 就出过一次：
 * `stripComments` 遇到**单行** `/* … *\/` 注释时当作"未闭合块注释"，
 * 把后续所有行都当注释吃掉。settings.js 的整个 SCHEMA（'深色'、'落子音'…）
 * 因此从未被提取，报告却一直显示"0 缺口"——**假绿比报红更糟**。
 */
'use strict';

/** 匹配任意 CJK 统一表意文字（含扩展 A） */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/**
 * 去掉注释：**引号感知**的逐行扫描。
 *
 * ⚠️ 为什么必须这么做（2026-09-23）：原实现对整份源码做字符串匹配，
 * 于是**注释里的中文**也被当成"缺词条的界面文案" —— 实测 306 条缺口里有一百多条是注释
 * （`一次批一批`、`不会爆炸`、`抄多份、改一处漏九处`…）。报告的价值全在"能信"：
 * 假缺口一多，真缺口就被淹了，看的人会直接放弃这份清单。
 *
 * 实现：把注释字符**替换成空格**（保留行结构），代码原样保留。
 * 引号内的一切不动；`//` 抹掉到行尾；`/* … *\/` 跨行，但**同行闭合的立即结束**
 * （2026-09-26 修：此前同行闭合会被漏掉，导致后续整段被误当注释）。
 */
function stripComments(src) {
  const out = [];
  let inBlock = false;
  for (const line of src.split('\n')) {
    const chars = line.split('');
    let quote = null;
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (inBlock) {
        if (c === '*' && chars[i + 1] === '/') { chars[i] = chars[i + 1] = ' '; i++; inBlock = false; }
        else chars[i] = ' ';
        continue;
      }
      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if (c === '/' && chars[i + 1] === '/') {
        for (let j = i; j < chars.length; j++) chars[j] = ' ';
        break;
      }
      if (c === '/' && chars[i + 1] === '*') { chars[i] = chars[i + 1] = ' '; i++; inBlock = true; }
    }
    out.push(chars.join(''));
  }
  return out.join('\n');
}

/** 从 JS 里抠出中文字符串字面量（提示语、动态文案） */
function extractJs(src) {
  const out = new Set();
  for (const m of stripComments(src).matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\]*)`/g)) {
    const t = (m[1] || m[2] || m[3] || '').replace(/\s+/g, ' ').trim();
    if (!t || !CJK.test(t)) continue;
    if (t.length < 2 || t.length > 80) continue; // 太短/太长多半不是界面文案
    if (/[{}<>]/.test(t)) continue;             // 含插值/标签的留给人工判断
    if (/^\[.+\]/.test(t)) continue;            // 内部日志前缀（[PieceKinds] / [settings] …），不给玩家看
    out.add(t);
  }
  return out;
}

module.exports = { CJK, stripComments, extractJs };
