'use strict';
/**
 * tests/rooms-snapshot.test.js — §8.1 快照往返与恢复（恢复局治理）
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const TMP = path.join(require('node:os').tmpdir(), `.tmpdata-roomsnap-${process.pid}`);
process.env.DATA_DIR = TMP;
fs.mkdirSync(TMP, { recursive: true });

const storage = require('../src/storage');
const { RoomManager } = require('../src/rooms');
const { newGame, STARTING_SFEN } = require('../src/game');

function mkRm() {
  const rm = new RoomManager(() => {});
  rm.playerRegistry = () => null;
  return rm;
}
function stop(rm) {
  try { clearInterval(rm._snapshotTimer); } catch (_) {}
  try { clearInterval(rm._finishedCleanupTimer); } catch (_) {}
  for (const t of (rm._clockTimers || new Map()).values()) clearInterval(t);
  for (const m of (rm._disconnectTimers || new Map()).values()) for (const t of m.values()) clearTimeout(t);
  for (const t of (rm._waitingTimers || new Map()).values()) clearTimeout(t);
}

test('§8.1 快照往返：serialize → restore 保持手数/座位/私人房属性', () => {
  const rm = mkRm();
  try {
    const game = newGame(STARTING_SFEN, ['A', 'B']);
    game.applyMove('7g7f');
    const room = {
      id: 'room-1', code: 'AAAAAA', game, status: 'PLAYING', type: 'room',
      creatorId: 'p1', createdAt: 1, timeControl: { main: 600, byoyomi: 0 },
      clock: { b: 600, w: 600 }, byoyomi: 0, curByoyomi: { b: 0, w: 0 }, inByoyomi: { b: false, w: false },
      rated: true, isPrivate: true, passwordHash: 'h',
      players: { b: { playerId: 'p1', name: 'A' }, w: { playerId: 'p2', name: 'B' } },
    };
    const snap = rm._serializeRoom(room);
    const back = rm._restoreRoom(snap);
    assert.strictEqual(back.game.moves.length, 1, '手数一致');
    assert.strictEqual(back.code, 'AAAAAA');
    assert.strictEqual(back.players.b.playerId, 'p1');
    assert.strictEqual(back.players.w.name, 'B');
    assert.strictEqual(back.isPrivate, true, '私人房属性随快照持久化');
  } finally { stop(rm); }
});

test('§8.1 restoreSnapshots：WAITING 不复活，PLAYING 恢复', () => {
  storage.putGameSnapshot('w1', {
    id: 'w1', code: 'WWWWWW', status: 'WAITING', moves: [], players: { b: null, w: null },
  });
  storage.putGameSnapshot('g1', {
    id: 'g1', code: 'GGGGGG', status: 'PLAYING', startSfen: STARTING_SFEN, moves: ['7g7f'],
    players: { b: { playerId: 'a', name: 'A' }, w: { playerId: 'b', name: 'B' } },
  });
  const rm = mkRm();
  try {
    rm.restoreSnapshots();
    assert.ok(!rm.rooms.has('w1'), 'WAITING 恢复房应被清理（不复活）');
    assert.ok(rm.rooms.has('g1'), 'PLAYING 恢复局应在内存');
    assert.strictEqual(rm.rooms.get('g1').restored, true, '标记为恢复局');
    assert.strictEqual(rm.rooms.get('g1').game.moves.length, 1);
  } finally { stop(rm); }
});

test.after(() => {
  try { storage._getDb().close(); } catch (_) {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
});
