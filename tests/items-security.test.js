'use strict';
/**
 * items-security.test.js — 道具安全回归（2026-10-05 审查修复）
 *
 * 守：
 *   1) 兑换码原型污染 + 伪成功：`__proto__`/`constructor` 等保留键既不能读成合法码，也不能写脏原型；
 *   2) 兑换码格式白名单（拒绝怪字符）；
 *   3) 每账号一次（重复兑换 → ALREADY_REDEEMED）；
 *   4) unlock 门槛真正生效（等级不足 → LOCKED）。
 *
 * 与 items-store.test.js 同款：内存 storage 桩 + 惰性 ratings 桩（避免加载真模块）。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const STORAGE_PATH = require.resolve(path.join(SRC_DIR, 'storage'));
const RATINGS_PATH = require.resolve(path.join(SRC_DIR, 'ratings'));

function load(seed) {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC_DIR + path.sep)) delete require.cache[key];
  }
  const mem = {};
  if (seed) for (const [k, v] of Object.entries(seed)) mem[k] = JSON.parse(JSON.stringify(v));
  const stub = {
    readJson(name, fallback = null) {
      return Object.prototype.hasOwnProperty.call(mem, name) ? JSON.parse(JSON.stringify(mem[name])) : fallback;
    },
    writeJson(name, data) { mem[name] = JSON.parse(JSON.stringify(data)); return true; },
    listJsonByPrefix() { return []; }, deleteJson(name) { delete mem[name]; return true; },
  };
  require.cache[STORAGE_PATH] = { id: STORAGE_PATH, filename: STORAGE_PATH, loaded: true, exports: stub };
  const store = require(path.join(SRC_DIR, 'items', 'store'));
  const items = require(path.join(SRC_DIR, 'items', 'index'));
  // 惰性 ratings 桩：新玩家 level/games 均为 0（用于 unlock 门槛判定）
  require.cache[RATINGS_PATH] = { id: RATINGS_PATH, filename: RATINGS_PATH, loaded: true, exports: { profile: () => ({ level: 0, games: 0 }) } };
  return { store, items, stub, mem };
}

const ITEMS = (over) => ({ wallets: {}, inventory: {}, equipped: {}, codes: {}, ...(over || {}) });

test('原型污染：getCode("__proto__")/defineCode("__proto__") 均被拒', () => {
  const { store } = load({ 'items.json': ITEMS() });
  assert.strictEqual(store.getCode('__proto__'), null);
  assert.strictEqual(store.getCode('constructor'), null);
  const d = store.defineCode('__proto__', { coin: 1 });
  assert.strictEqual(d.ok, false);
  assert.strictEqual(d.code, 'BAD_CODE');
});

test('原型污染：redeem("__proto__") 不成功、且不污染 Object.prototype', () => {
  const { items } = load({ 'items.json': ITEMS() });
  const r = items.redeem('u1', '__proto__');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(Object.prototype.used, undefined, 'Object.prototype.used 不得被写入');
  assert.strictEqual(Object.prototype.coin, undefined);
});

test('兑换码白名单：怪字符/超长 → BAD_CODE', () => {
  const { items } = load({ 'items.json': ITEMS() });
  assert.strictEqual(items.redeem('u1', 'bad code!').code, 'BAD_CODE');
  assert.strictEqual(items.redeem('u1', 'x'.repeat(33)).code, 'BAD_CODE');
});

test('每账号一次：同账号兑换两次 → 第二次 ALREADY_REDEEMED', () => {
  const { items } = load({ 'items.json': ITEMS({
    wallets: { u1: { coin: 0 } },
    codes: { HI: { itemId: null, coin: 50, maxUses: 5, used: 0, redeemedBy: [] } },
  }) });
  const a = items.redeem('u1', 'HI');
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.wallet.coin, 50);
  const b = items.redeem('u1', 'HI');
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.code, 'ALREADY_REDEEMED');
  // 换账号仍可兑
  assert.strictEqual(items.redeem('u2', 'HI').ok, true);
});

test('unlock 门槛生效：等级不足 → LOCKED（board-01 需 Lv3）', () => {
  const { items } = load({ 'items.json': ITEMS({ wallets: { u1: { coin: 99999 } } }) });
  const r1 = items.buy('u1', 'board-01');
  assert.strictEqual(r1.ok, false);
  assert.strictEqual(r1.code, 'LOCKED');
  // 无 unlock 的道具（bgm-shen）不受影响
  assert.strictEqual(items.buy('u1', 'bgm-shen').ok, true);
  // ⚠️ 2026-10-08：默认棋子图集（pieces-kinki）自带且无 unlock —— 不该被门槛拦住
  assert.strictEqual(items.buy('u1', 'pieces-kinki').code, 'NOT_FOR_SALE', '自带项 price=null 不可买');
  assert.strictEqual(items.equip('u1', 'pieces', 'pieces-kinki').ok, true);
});

// ---------------- 2026-10-08：三首默认 BGM 自带且默认装备 ----------------

test('默认装备：三首自带 BGM + 棋子/读秒音未显式装备时自动生效', () => {
  const { items } = load({ 'items.json': ITEMS() });
  const eq = items.effectiveEquipped('nobody');
  assert.strictEqual(eq['bgm-menu'], 'bgm-loop');
  assert.strictEqual(eq['bgm-game'], 'bgm-jingyi');
  assert.strictEqual(eq['bgm-endgame'], 'bgm-zhisheng');
  assert.strictEqual(eq.pieces, 'pieces-kinki');
  assert.strictEqual(eq.byoyomi, 'byoyomi-tick');

  const tracks = items.bgmTracksFor('nobody');
  assert.strictEqual(tracks.menu, '/music/loop.mp3');
  assert.strictEqual(tracks.game, '/music/静弈.mp3');
  assert.strictEqual(tracks.endgame, '/music/制勝.mp3');

  const ap = items.appearanceFor('nobody');
  assert.strictEqual(ap.atlas, 'pieces/kinki.png');
  assert.strictEqual(ap.byoyomi, 'default');
  assert.strictEqual(ap.bgm.menu, '/music/loop.mp3');
});
