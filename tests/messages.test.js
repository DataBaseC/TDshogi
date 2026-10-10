/**
 * tests/messages.test.js — WS 消息契约（PLAN §P5）
 *
 * 分两个层面：
 *  1. `validate()` 规则本身：未知类型、缺必填参数、空串、类型不对、data 缺失；
 *  2. **契约一致性**：`messages.C2S` 与 `src/protocol.js` 的 switch 分支必须**双向**一致——
 *     这是 §P5 防漂移的关键：新增消息时忘了登记（会导致校验误拒），
 *     或登记了却没实现（会落到 default 回"未知消息类型"），都会被这条测试拦下。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const messages = require('../src/messages');

const { C2S, validate } = messages;

test('未知消息类型一律拒绝', () => {
  for (const bad of ['nope', 'move_x', '', null, undefined, 123, {}]) {
    const r = validate(bad, {});
    assert.strictEqual(r.ok, false, `${String(bad)} 应被拒绝`);
    assert.match(r.error, /未知消息类型/);
  }
});

test('缺必填参数时给出「含类型名 + 字段名」的明确错误', () => {
  const cases = [
    [C2S.MOVE, {}, 'usi'],
    [C2S.MOVE, { usi: '' }, 'usi'],
    [C2S.MOVE, { usi: '   ' }, 'usi'],
    [C2S.MOVE, { usi: 123 }, 'usi'],
    [C2S.CHAT, {}, 'text'],
    [C2S.RENAME, {}, 'name'],
    [C2S.ADMIN_LOGIN, {}, 'password'],
    [C2S.JOIN_ROOM, {}, 'code'],
    [C2S.JOIN_TOURNAMENT, {}, 'id'],
    [C2S.JOIN_TOURNAMENT_MATCH, {}, 'roomId'],
    [C2S.DEMO_MOVE, {}, 'usi'],
  ];
  for (const [type, data, field] of cases) {
    const r = validate(type, data);
    assert.strictEqual(r.ok, false, `${type} 应校验失败`);
    assert.match(r.error, new RegExp(type), '错误信息应含类型名，便于前端/日志定位');
    assert.match(r.error, new RegExp(field), `错误信息应含字段名 ${field}`);
  }
});

test('data 缺失或不是对象时按「缺参数」处理，而不是抛异常', () => {
  for (const data of [undefined, null, 'usi=7g7f', ['7g7f'], 42]) {
    const r = validate(C2S.MOVE, data);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /缺少参数 data\.usi/);
  }
});

test('合法消息通过校验', () => {
  assert.strictEqual(validate(C2S.MOVE, { usi: '7g7f' }).ok, true);
  assert.strictEqual(validate(C2S.MOVE, { usi: '7g7f', extra: '忽略' }).ok, true, '多余字段不应导致失败');
  assert.strictEqual(validate(C2S.CHAT, { text: '你好' }).ok, true);
  assert.strictEqual(validate(C2S.RENAME, { name: '小明' }).ok, true);
  assert.strictEqual(validate(C2S.JOIN_ROOM, { code: 'ABC234' }).ok, true);
  assert.strictEqual(validate(C2S.DEMO_MOVE, { usi: '7g7f', index: 3 }).ok, true);
  assert.strictEqual(validate(C2S.MOVE, { usi: '  7g7f  ' }).ok, true, '前后空白应视为有效');
});

test('spectate：roomId 与 code 二选一即可', () => {
  assert.strictEqual(validate(C2S.SPECTATE, { roomId: 'r1' }).ok, true);
  assert.strictEqual(validate(C2S.SPECTATE, { code: 'ABC234' }).ok, true);
  assert.strictEqual(validate(C2S.SPECTATE, { roomId: 'r1', code: 'ABC234', password: 'x' }).ok, true);
  const bad = validate(C2S.SPECTATE, {});
  assert.strictEqual(bad.ok, false);
  assert.match(bad.error, /roomId 或 data\.code/);
});

test('无必填参数的消息一律放行（含完全不带 data）', () => {
  const noArg = [
    C2S.CREATE_ROOM, C2S.QUICK_MATCH, C2S.CANCEL_MATCH, C2S.RESIGN, C2S.REMATCH,
    C2S.LEAVE, C2S.RANDOM_SPECTATE, C2S.DECLARE_NYUGYOKU, C2S.REQUEST_STATE,
    C2S.DEMO_ENTER, C2S.DEMO_UNDO, C2S.DEMO_TRANSFER, C2S.DEMO_CLAIM, C2S.DEMO_RESET,
    C2S.DEMO_LEGAL, C2S.RECORD_SEARCH,
  ];
  for (const type of noArg) {
    assert.strictEqual(validate(type).ok, true, `${type} 不应有必填参数`);
    assert.strictEqual(validate(type, {}).ok, true, `${type} 空 data 应放行`);
  }
});

test('【回归】demo_enter 不得要求 roomId（前端与 e2e 均以空 data 调用）', () => {
  // 设成必填的后果：感想战直接进不去，且 `e2e-freeboard.js` 的
  // `send('demo_enter', {})` 当场失败——roomId 由服务端按连接身份定位。
  assert.strictEqual(validate(C2S.DEMO_ENTER).ok, true, '不带 data 也必须放行');
  assert.strictEqual(validate(C2S.DEMO_ENTER, {}).ok, true);
  assert.strictEqual(validate(C2S.DEMO_ENTER, { roomId: 'r1' }).ok, true, '显式传 roomId 也应放行');
});

test('isClientType：只认登记过的字符串类型', () => {
  assert.strictEqual(messages.isClientType(C2S.MOVE), true);
  assert.strictEqual(messages.isClientType('move_x'), false);
  assert.strictEqual(messages.isClientType(''), false);
  assert.strictEqual(messages.isClientType(null), false);
  assert.strictEqual(messages.isClientType(undefined), false);
});

test('契约一致性：messages.C2S 与 protocol.js 的 switch 分支双向一致', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'protocol.js'), 'utf8');
  const handled = new Set();
  for (const m of src.matchAll(/case '([a-z_]+)':/g)) handled.add(m[1]);
  const declared = new Set(messages.C2S_TYPES);

  const notDeclared = [...handled].filter((t) => !declared.has(t));
  const notHandled = [...declared].filter((t) => !handled.has(t));

  assert.deepStrictEqual(notDeclared, [],
    `protocol.js 处理了但 messages.C2S 未登记（校验会误拒合法请求）: ${notDeclared.join(', ')}`);
  assert.deepStrictEqual(notHandled, [],
    `messages.C2S 登记了但 protocol.js 未处理（请求会落到 default）: ${notHandled.join(', ')}`);
});

test('契约一致性：C2S 取值无重复', () => {
  const values = Object.values(C2S);
  assert.strictEqual(new Set(values).size, values.length, 'C2S 存在重复取值，会让校验表互相覆盖');
});
