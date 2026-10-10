'use strict';
/**
 * tests/rooms-binding.test.js — §8.1/§3.2 连接绑定与回位（reconnect 收窄）
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const TMP = path.join(require('node:os').tmpdir(), `.tmpdata-roomsbind-${process.pid}`);
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
}
function mkRoom(id, b, w, status = 'PLAYING') {
  return {
    id, code: id, status, type: 'room', game: newGame(STARTING_SFEN, ['A', 'B']),
    players: { b, w }, clock: { b: 600, w: 600 }, byoyomi: 0,
    curByoyomi: { b: 0, w: 0 }, inByoyomi: { b: false, w: false }, chat: [],
  };
}

test('§3.2 reconnect：preferRoomId 存在的房内回位', () => {
  const rm = mkRm();
  try {
    rm.rooms.set('rA', mkRoom('rA',
      { playerId: 'p1', name: 'A', clientId: null, connected: false },
      { playerId: 'x', name: 'X', clientId: 'cx', connected: true }));
    rm.rooms.set('rB', mkRoom('rB',
      { playerId: 'p1', name: 'A', clientId: null, connected: false },
      { playerId: 'y', name: 'Y', clientId: 'cy', connected: true }));
    rm.byCode.set('rA', 'rA'); rm.byCode.set('rB', 'rB');

    const r = rm.reconnect('c1', 'p1', 'rB');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.roomId, 'rB', '应绑定到 URL 指向的房间');
    assert.strictEqual(r.seat, 'b');
  } finally { stop(rm); }
});

test('§3.2 reconnect：preferRoomId 指向"存在但自己不在其中"的房 → 不跨房兜底', () => {
  const rm = mkRm();
  try {
    rm.rooms.set('rA', mkRoom('rA',
      { playerId: 'p1', name: 'A', clientId: null, connected: false },
      { playerId: 'x', name: 'X', clientId: 'cx', connected: true }));
    rm.rooms.set('rC', mkRoom('rC',
      { playerId: 'z', name: 'Z', clientId: 'cz', connected: true },
      { playerId: 'w', name: 'W', clientId: 'cw', connected: true }));
    rm.byCode.set('rA', 'rA'); rm.byCode.set('rC', 'rC');

    const r = rm.reconnect('c2', 'p1', 'rC');
    assert.strictEqual(r.ok, false, '房存在但自己不在其中 → 不得回落到 rA');
  } finally { stop(rm); }
});

test('§3.2 reconnect：未给 preferRoomId 时仍可跨房回位（兼容）', () => {
  const rm = mkRm();
  try {
    rm.rooms.set('rA', mkRoom('rA',
      { playerId: 'p1', name: 'A', clientId: null, connected: false },
      { playerId: 'x', name: 'X', clientId: 'cx', connected: true }));
    rm.byCode.set('rA', 'rA');
    const r = rm.reconnect('c3', 'p1');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.roomId, 'rA');
  } finally { stop(rm); }
});

test.after(() => {
  try { storage._getDb().close(); } catch (_) {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
});
