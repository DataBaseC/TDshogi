'use strict';
/**
 * protocol-contract.test.js — WS 消息契约「双向守门人」
 *
 * `src/messages.js` 与 `src/protocol.js` 的注释都写着"由 tests/messages.test.js
 * 比对 protocol.js 的 case 列表与 C2S 是否一致"——但那个测试此前**根本不存在**
 * （2026-10-03 架构体检 #10/#18 点名的"契约漂移无人守"）。本文件把它补上。
 *
 * 为什么要"双向"：
 *  - C2S 有、protocol 无 → 客户端照契约发消息，却落到 `default`（静默丢弃/模糊报错）；
 *  - protocol 有、C2S 无 → 协议未声明却能调用，校验规则也不会被执行。
 *
 * 做法：**文本提取** `_routeInner` 里的 `case '...':` 列表。
 * （不能 require protocol.js —— 它会连带拉起 rooms/storage，依赖 better-sqlite3。）
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const messages = require('../src/messages');

const PROTOCOL_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'protocol.js'), 'utf8');

/** 从 `_routeInner` 的 switch 里提取分派类型 */
function dispatchCases() {
  const start = PROTOCOL_SRC.indexOf('_routeInner(');
  assert.ok(start > 0, '在 protocol.js 里找不到 _routeInner');
  // switch 只有三十来行；取一段足够覆盖它的窗口即可（避免误抓文件里其它 switch）
  const win = PROTOCOL_SRC.slice(start, start + 4000);
  return [...win.matchAll(/case '([^']+)':/g)].map((m) => m[1]);
}

test('提取到的分派表规模合理（防"窗口切错导致空集"的假通过）', () => {
  const cases = dispatchCases();
  assert.ok(cases.length >= 20, `分派类型太少（${cases.length}），提取逻辑可能失效`);
});

test('契约表里的每个类型都有对应 case 分支（否则落到 default）', () => {
  const cases = new Set(dispatchCases());
  const missing = messages.C2S_TYPES.filter((t) => !cases.has(t));
  assert.deepStrictEqual(missing, [], `[契约有 / protocol 无] ${missing.join(', ')}`);
});

test('protocol 里的每个 case 都登记在契约表（防"能调但未声明"）', () => {
  const declared = new Set(messages.C2S_TYPES);
  const undeclared = [...new Set(dispatchCases())].filter((t) => !declared.has(t));
  assert.deepStrictEqual(undeclared, [], `[protocol 有 / 契约无] ${undeclared.join(', ')}`);
});

test('契约表自身的形状（常量 ↔ 类型列表一一对应）', () => {
  const fromConst = Object.values(messages.C2S);
  assert.deepStrictEqual([...messages.C2S_TYPES], fromConst, 'C2S_TYPES 必须等于 C2S 的值集合');
  const dup = fromConst.filter((t, i) => fromConst.indexOf(t) !== i);
  assert.deepStrictEqual(dup, [], 'C2S 里存在重复类型名');
});
