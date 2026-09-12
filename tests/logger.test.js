/**
 * tests/logger.test.js — 统一日志模块（PLAN §P4）
 *
 * 纯函数测试，不起服、不写磁盘。
 * 用 `setOutput()` 注入收集器捕获输出（这是 logger 专门为可测性留的口子），
 * 因此**不依赖 console 劫持**，也不会污染测试输出。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const log = require('../src/logger');

/** 捕获一组日志调用产生的行；结束后恢复默认输出与级别、格式 */
function capture(fn) {
  const lines = [];
  const prevLevel = log.getLevel();
  const prevFormat = log.getFormat();
  log.setOutput((level, line) => lines.push({ level, line }));
  try {
    fn();
    return lines;
  } finally {
    log.setOutput(null);
    log.setLevel(prevLevel);
    log.setFormat(prevFormat);
  }
}

test('logger：级别过滤——低于当前级别的调用不产生输出', () => {
  const lines = capture(() => {
    log.setLevel('warn');
    log.debug('t', '不该出现');
    log.info('t', '不该出现');
    log.warn('t', '警告');
    log.error('t', '错误');
  });
  assert.deepStrictEqual(lines.map((l) => l.level), ['warn', 'error']);
});

test('logger：级别过滤——debug 级别时四档全出', () => {
  const lines = capture(() => {
    log.setLevel('debug');
    log.debug('t', 'd');
    log.info('t', 'i');
    log.warn('t', 'w');
    log.error('t', 'e');
  });
  assert.deepStrictEqual(lines.map((l) => l.level), ['debug', 'info', 'warn', 'error']);
});

test('logger：text 输出含时间戳 / 级别 / scope / 消息 / 字段', () => {
  const lines = capture(() => {
    log.setFormat('text');
    log.setLevel('info');
    log.info('rooms', '房间销毁', { roomId: 'abc123', retries: 3 });
  });
  assert.strictEqual(lines.length, 1);
  const line = lines[0].line;
  // `HH:mm:ss.SSS INFO  [rooms] 房间销毁 roomId=abc123 retries=3`
  assert.match(line, /^\d{2}:\d{2}:\d{2}\.\d{3} INFO {2}\[rooms\] 房间销毁 /);
  assert.match(line, /roomId=abc123/);
  assert.match(line, /retries=3/);
  assert.ok(!line.includes('\n'), '普通日志应为单行');
});

test('logger：json 输出是单行可解析 JSON，字段齐全', () => {
  const lines = capture(() => {
    log.setFormat('json');
    log.setLevel('info');
    log.warn('clock', '时钟异常', { roomId: 'r1', playerId: 'p1' });
  });
  assert.strictEqual(lines.length, 1);
  assert.ok(!lines[0].line.includes('\n'), 'JSON 模式必须一行一条，否则日志系统无法逐行解析');
  const rec = JSON.parse(lines[0].line);
  assert.match(rec.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.strictEqual(rec.level, 'warn');
  assert.strictEqual(rec.ctx, 'clock');
  assert.strictEqual(rec.msg, '时钟异常');
  assert.strictEqual(rec.roomId, 'r1');
  assert.strictEqual(rec.playerId, 'p1');
});

test('logger：Error 字段被结构化（json 带 name / message / stack）', () => {
  const lines = capture(() => {
    log.setFormat('json');
    log.setLevel('error');
    log.error('storage', '写入失败', { err: new Error('磁盘满了'), name: 'kv' });
  });
  const rec = JSON.parse(lines[0].line);
  assert.strictEqual(rec.name, 'kv', '普通字段不受影响');
  assert.strictEqual(rec.err.name, 'Error');
  assert.strictEqual(rec.err.message, '磁盘满了');
  assert.match(rec.err.stack, /磁盘满了/);
});

test('logger：text 模式 Error 的堆栈另起行输出', () => {
  const lines = capture(() => {
    log.setFormat('text');
    log.setLevel('error');
    log.error('storage', '写入失败', { err: new Error('磁盘满了') });
  });
  const line = lines[0].line;
  assert.match(line, /err="磁盘满了"/);
  assert.match(line, /\n\s+at /, '应带缩进的调用栈行');
});

test('logger：child 自动携带上下文，本次字段可覆盖', () => {
  const lines = capture(() => {
    log.setFormat('json');
    log.setLevel('info');
    const rl = log.child({ roomId: 'r1' });
    rl.info('rooms', 'a');
    rl.info('rooms', 'b', { roomId: 'r2', extra: 1 });
  });
  const [first, second] = lines.map((l) => JSON.parse(l.line));
  assert.strictEqual(first.roomId, 'r1');
  assert.strictEqual(first.extra, undefined);
  assert.strictEqual(second.roomId, 'r2', '调用时传入的字段应覆盖 child 的默认值');
  assert.strictEqual(second.extra, 1);
});

test('logger：child 的上下文不影响父 logger', () => {
  const lines = capture(() => {
    log.setFormat('json');
    log.setLevel('info');
    log.child({ roomId: 'r1' }).info('rooms', 'child 调用');
    log.info('rooms', '父级调用');
  });
  const [first, second] = lines.map((l) => JSON.parse(l.line));
  assert.strictEqual(first.roomId, 'r1');
  assert.strictEqual(second.roomId, undefined, '父 logger 不应被 child 污染');
});

test('logger：undefined 字段不写入输出', () => {
  const lines = capture(() => {
    log.setFormat('json');
    log.setLevel('info');
    log.info('t', 'm', { a: 1, b: undefined, c: null });
  });
  const rec = JSON.parse(lines[0].line);
  assert.strictEqual(rec.a, 1);
  assert.ok(!('b' in rec), 'undefined 应被跳过');
  assert.strictEqual(rec.c, null, 'null 是有效值，应保留');
});

test('logger：非法级别 / 格式被拒绝且不改变现状', () => {
  const prevLevel = log.getLevel();
  assert.strictEqual(log.setLevel('verbose'), false);
  assert.strictEqual(log.getLevel(), prevLevel, '非法级别不得改动当前级别');

  log.setFormat('text');
  assert.strictEqual(log.setFormat('xml'), false);
  assert.strictEqual(log.getFormat(), 'text', '非法格式不得改动当前格式');

  assert.strictEqual(log.setLevel('DEBUG'), true, '级别名应大小写不敏感');
  assert.strictEqual(log.getLevel(), 'debug');
  log.setLevel(prevLevel);
});

test('logger：text 模式含空格的值加引号，且不破坏 key=value 结构', () => {
  const lines = capture(() => {
    log.setFormat('text');
    log.setLevel('info');
    log.info('t', 'm', { reason: 'no member' });
  });
  assert.match(lines[0].line, /reason="no member"/);
});
