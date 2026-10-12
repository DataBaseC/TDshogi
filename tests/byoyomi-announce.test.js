/**
 * byoyomi-announce.test.js — 读秒语音包一期（2026-10-12）的回归测试
 *
 * 这条链上任何一环错了都不会"报错"，只会**该出声时不出声 / 不该出声时乱出声**，
 * 上线前极难发现，所以分四层钉死：
 *
 *  ① 服务端报时口径 `rooms/config.js#announceFor` —— 按时间制区分，是本次需求的核心：
 *       · `10+30`（本时+秒读）→ source:'byoyomi'，**进入读秒才开始报数**
 *       · `10分包干`        → source:'main'，**主时钟就报数**，且有「剩1分」
 *  ② 报时决策 `sound.js#chooseCountdown`（纯函数）—— 倒数逐秒、节点首次跨越、
 *     跨多个阈值只播最紧急一条、同秒防抖、逐手清账。
 *  ③ 播报与回退链 `announceCountdown` —— **任何缺失都回退，绝不静音**。
 *  ④ 商品口径 `items/catalog.js#normalizeItem` + QC 脚本自检。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// ==================================================================
// ① 服务端：报时口径按时间制区分
// ==================================================================
const { announceFor, TIME_CONTROLS } = require('../src/rooms/config');

test('① 10+30（本时+秒读）：source=byoyomi —— 进入读秒才开始报数', () => {
  const a = announceFor('10+30');
  assert.strictEqual(a.source, 'byoyomi', '读秒局的报数必须跟读秒计数器走，本时阶段不报');
  assert.deepStrictEqual(a.milestones, [30, 20], '秒读 30 秒不该报「剩1分」（节点不得超计时源长度）');
  assert.strictEqual(a.countFrom, 10);
});

test('① 10分包干：source=main —— 不进读秒就有报数，且必须有「剩1分」', () => {
  const a = announceFor('10:00');
  assert.strictEqual(a.source, 'main', '包干局没有读秒，报数必须跟主时钟走');
  assert.deepStrictEqual(a.milestones, [60, 30, 20], '包干局必须含「剩1分」= remain_60');
  assert.strictEqual(a.countFrom, 10);
});

test('① 15+60：秒读 60 秒，三个节点齐全', () => {
  const a = announceFor('15+60');
  assert.strictEqual(a.source, 'byoyomi');
  assert.deepStrictEqual(a.milestones, [60, 30, 20]);
});

test('① 10sec（0+10，开局即读秒）：秒读仅 10 秒 ⇒ 无节点、只倒数', () => {
  const a = announceFor('10sec');
  assert.strictEqual(a.source, 'byoyomi');
  assert.deepStrictEqual(a.milestones, [], '10 秒的读秒不该报「剩20秒」');
  assert.strictEqual(a.countFrom, 10);
});

test('① 未知时间制回退默认（10:00 包干），不抛错', () => {
  const a = announceFor('不存在的赛制');
  assert.strictEqual(a.source, 'main');
  assert.deepStrictEqual(a, announceFor('10:00'));
});

test('① 四种内置时间制的报时口径都非空、字段齐全', () => {
  for (const id of Object.keys(TIME_CONTROLS)) {
    const a = announceFor(id);
    assert.ok(a && typeof a.source === 'string', `${id} 缺 source`);
    assert.ok(Array.isArray(a.milestones), `${id} 缺 milestones`);
    assert.ok(Number.isInteger(a.countFrom) && a.countFrom >= 1, `${id} countFrom 非法`);
    assert.ok(['main', 'byoyomi'].includes(a.source), `${id} source 非法`);
  }
});

// ==================================================================
// ② 报时决策（纯函数）
// ==================================================================
function freshSound(vals) {
  // sound.js 闭包里有 enabled / voicePack 等状态，必须整模块重载
  delete require.cache[require.resolve(path.join(ROOT, 'public/js/sound.js'))];
  global.window = global;
  global.localStorage = {
    _m: new Map(),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
  };
  global.Settings = { get: (k) => (vals || {})[k], set() {} };
  require(path.join(ROOT, 'public/js/sound.js'));
  return global.Sound;
}

const MAIN_CFG = { source: 'main', milestones: [60, 30, 20], countFrom: 10 };

test('② 节点播报：60/30/20 各报一次，之间静默（静默是有意的）', () => {
  const Sound = freshSound({ sound: true });
  const book = {};
  const got = [];
  // 从 5:00 一路走到 0：每 500ms 一拍
  for (let ms = 300000; ms >= 0; ms -= 500) {
    const p = Sound.chooseCountdown(ms, MAIN_CFG, book);
    if (p) got.push(p.key);
  }
  const nodes = got.filter((k) => k.indexOf('remain_') === 0);
  assert.deepStrictEqual(nodes, ['remain_60', 'remain_30', 'remain_20'], '节点必须按 60→30→20 且只各一次');
  // 倒数：count_10 … count_01 各一次
  const counts = got.filter((k) => k.indexOf('count_') === 0);
  assert.deepStrictEqual(counts, [
    'count_10', 'count_09', 'count_08', 'count_07', 'count_06',
    'count_05', 'count_04', 'count_03', 'count_02', 'count_01',
  ], '十秒倒数必须逐秒各一次、顺序不能乱');
});

test('② 一次跨多个阈值：只播**最紧急**那条，且已跨过的不再补报', () => {
  const Sound = freshSound({ sound: true });
  const book = {};
  assert.strictEqual(Sound.chooseCountdown(300000, MAIN_CFG, book), null);
  // 从 5:00 直接跳到 19.5s —— 一口气跨过 60/30/20
  const p = Sound.chooseCountdown(19500, MAIN_CFG, book);
  assert.strictEqual(p.key, 'remain_20', '跨多个只播最紧急');
  // 下一拍不得补报 remain_60 / remain_30
  assert.strictEqual(Sound.chooseCountdown(19000, MAIN_CFG, book), null);
  assert.strictEqual(Sound.chooseCountdown(18500, MAIN_CFG, book), null);
});

test('② 同一秒内不重复（防抖），跨秒才播下一条', () => {
  const Sound = freshSound({ sound: true });
  const book = {};
  assert.strictEqual(Sound.chooseCountdown(500, MAIN_CFG, book).key, 'count_01');
  assert.strictEqual(Sound.chooseCountdown(400, MAIN_CFG, book), null, '同一秒内不得重播');
  assert.strictEqual(Sound.chooseCountdown(300, MAIN_CFG, book), null);
});

test('② 节点同拍不重复：remain_60 报过一次后，仍在该秒内不再报', () => {
  const Sound = freshSound({ sound: true });
  const book = {};
  assert.strictEqual(Sound.chooseCountdown(59500, MAIN_CFG, book).key, 'remain_60');
  assert.strictEqual(Sound.chooseCountdown(59400, MAIN_CFG, book), null);
});

test('② 换手清账：新的一手从头来，不会补报上一手的节点', () => {
  const Sound = freshSound({ sound: true });
  const bookA = {};
  assert.strictEqual(Sound.chooseCountdown(19500, MAIN_CFG, bookA).key, 'remain_20');
  // 换手 = 新记账对象
  const bookB = {};
  const p = Sound.chooseCountdown(55000, MAIN_CFG, bookB);
  assert.strictEqual(p.key, 'remain_60', '新的一手应重新报节点');
});

test('② countFrom < 10 时倒数条数随之收敛（短读秒不报十、九…）', () => {
  const Sound = freshSound({ sound: true });
  const cfg = { source: 'byoyomi', milestones: [], countFrom: 5 };
  const book = {};
  const got = [];
  for (let ms = 6000; ms >= 0; ms -= 500) {
    const p = Sound.chooseCountdown(ms, cfg, book);
    if (p) got.push(p.key);
  }
  assert.deepStrictEqual(got, ['count_05', 'count_04', 'count_03', 'count_02', 'count_01']);
});

test('② 没有配置（cfg 为空）⇒ 不报，也不抛错', () => {
  const Sound = freshSound({ sound: true });
  assert.strictEqual(Sound.chooseCountdown(3000, null, {}), null);
});

// ==================================================================
// ③ 播报与回退链
// ==================================================================
function stubAudio() {
  const made = [];
  class FakeAudio {
    constructor(url) {
      this.url = url;
      this.volume = 1;
      this.playbackRate = 1;
      this.played = 0;
      made.push(this);
    }
    play() { this.played++; return { catch() {} }; }
    pause() {}
  }
  global.Audio = FakeAudio;
  return made;
}

const MANIFEST = {
  kind: 'audiopack',
  version: '1.0.0',
  files: {
    remain_60: 'remain-60.ogg',
    remain_30: 'remain-30.ogg',
    remain_20: 'remain-20.ogg',
    count_10: 'count-10.ogg',
    count_09: 'count-09.ogg',
    count_08: 'count-08.ogg',
    count_07: 'count-07.ogg',
    count_06: 'count-06.ogg',
    count_05: 'count-05.ogg',
    count_04: 'count-04.ogg',
    count_03: 'count-03.ogg',
    count_02: 'count-02.ogg',
    count_01: 'count-01.ogg',
  },
};

function stubFetch(manifest) {
  const calls = [];
  global.fetch = (url) => {
    calls.push(url);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(manifest) });
  };
  return calls;
}

const flush = () => new Promise((r) => setImmediate(r));

test('③ 装上语音包（.json manifest）后 hasVoicePack() 为真；换回 default 则卸下', async () => {
  const made = stubAudio();
  stubFetch(MANIFEST);
  const Sound = freshSound({ sound: true });
  assert.strictEqual(Sound.hasVoicePack(), false);
  Sound.setByoyomiVariant('/sound/packs/x/manifest.json');
  await flush();
  assert.strictEqual(Sound.hasVoicePack(), true, 'manifest 加载后应识别为语音包');
  Sound.setByoyomiVariant('default');
  assert.strictEqual(Sound.hasVoicePack(), false, '切回合成音应卸下语音包');
  assert.ok(made.length === 0, '加载 manifest 不该建 Audio');
});

test('③ 报时命中语音包条目：按 manifest 的文件名取相对路径', async () => {
  const made = stubAudio();
  stubFetch(MANIFEST);
  const Sound = freshSound({ sound: true });
  Sound.setByoyomiVariant('/sound/packs/x/manifest.json');
  await flush();
  const book = {};
  const key = Sound.announceCountdown(55000, MAIN_CFG, book);
  assert.strictEqual(key, 'remain_60');
  assert.strictEqual(made.length, 1);
  assert.strictEqual(made[0].url, '/sound/packs/x/remain-60.ogg');
});

test('③ 回退链：倒数条目缺失 ⇒ 接最近的更小倒数（count_05 缺 → count_04）', async () => {
  const made = stubAudio();
  const m = JSON.parse(JSON.stringify(MANIFEST));
  delete m.files.count_05;
  stubFetch(m);
  const Sound = freshSound({ sound: true });
  Sound.setByoyomiVariant('/sound/packs/x/manifest.json');
  await flush();
  const cfg = { source: 'main', milestones: [], countFrom: 10 };
  const key = Sound.announceCountdown(5000, cfg, {});
  assert.strictEqual(key, 'count_05', '决策仍是 count_05（口径不因缺素材而变）');
  assert.strictEqual(made.length, 1);
  assert.strictEqual(made[0].url, '/sound/packs/x/count-04.ogg', '缺条目要落到最近的更小倒数');
});

test('③ 回退链：音频加载失败（play 被拒）⇒ 立刻接下一条，且坏条目不再重试', async () => {
  const made = stubAudio();
  const m = JSON.parse(JSON.stringify(MANIFEST));
  stubFetch(m);
  const Sound = freshSound({ sound: true });
  Sound.setByoyomiVariant('/sound/packs/x/manifest.json');
  await flush();
  // 让 count-05 播放失败
  const orig = global.Audio;
  let first = true;
  global.Audio = class extends orig {
    play() {
      if (first) { first = false; return Promise.reject(new Error('404')); }
      return super.play();
    }
  };
  const cfg = { source: 'main', milestones: [], countFrom: 10 };
  Sound.announceCountdown(5000, cfg, {});
  await flush(); await flush();
  const urls = made.map((a) => a.url);
  assert.ok(urls.indexOf('/sound/packs/x/count-05.ogg') >= 0, '先试命中条目');
  assert.ok(urls.indexOf('/sound/packs/x/count-04.ogg') >= 0, '失败后立刻接下一条');
  global.Audio = orig;
});

test('③ 节点条目缺失 ⇒ 不播该条但**不静音**：交给上层合成音兜底', async () => {
  const made = stubAudio();
  const m = JSON.parse(JSON.stringify(MANIFEST));
  delete m.files.remain_30;
  stubFetch(m);
  const Sound = freshSound({ sound: true });
  Sound.setByoyomiVariant('/sound/packs/x/manifest.json');
  await flush();
  const book = {};
  const key = Sound.announceCountdown(29500, MAIN_CFG, book);
  assert.strictEqual(key, 'remain_30');
  assert.strictEqual(made.length, 0, '节点缺素材时不能硬放别的条目');
  assert.strictEqual(book.announced[30], true, '但仍要记账，避免每拍重试');
});

test('③ 语音包整体不可用（fetch 失败）⇒ 不抛错、退回合成音，计时提示照常', async () => {
  const made = stubAudio();
  global.fetch = () => Promise.reject(new Error('offline'));
  const Sound = freshSound({ sound: true });
  Sound.setByoyomiVariant('/sound/packs/x/manifest.json');
  await flush(); await flush();
  assert.strictEqual(Sound.hasVoicePack(), false, '拉不到 manifest 就当没装包');
  // 无包时 announceCountdown 仍要能出声（合成音兜底，不静音）
  const key = Sound.announceCountdown(5000, { source: 'main', milestones: [], countFrom: 10 }, {});
  assert.strictEqual(key, 'count_05');
  assert.strictEqual(made.length, 0, '合成音走 AudioContext，不建 Audio');
});

test('③ 总开关关掉：照常记账、只是不发声', async () => {
  const made = stubAudio();
  stubFetch(MANIFEST);
  const Sound = freshSound({ sound: false }); // 音效总开关 = 关
  Sound.setByoyomiVariant('/sound/packs/x/manifest.json');
  await flush();
  const book = {};
  const key = Sound.announceCountdown(55000, MAIN_CFG, book);
  assert.strictEqual(key, 'remain_60', '决策照做');
  assert.strictEqual(made.length, 0, '静音时不得建 Audio');
  assert.strictEqual(book.announced[60], true, '静音也要记账，重开后不该补一串');
});

test('③ 同一 manifest 并发加载只发一次请求', async () => {
  stubAudio();
  const calls = stubFetch(MANIFEST);
  const Sound = freshSound({ sound: true });
  Sound.setByoyomiVariant('/sound/packs/x/manifest.json');
  Sound.setByoyomiVariant('/sound/packs/x/manifest.json');
  await flush();
  assert.strictEqual(calls.length, 1);
});

// ==================================================================
// ④ 商品口径 + QC 脚本
// ==================================================================
// ⚠️ 脱耦（与 items-store.test.js 同款）：catalog 的 require 链会拖出
//    auth → storage → better-sqlite3（native 依赖，沙箱/CI 不装）。
//    这里注入内存桩，只测**纯校验**逻辑（normalizeItem 本来就不落盘）。
const SRC_DIR = path.join(ROOT, 'src');
const STORAGE_PATH = require.resolve(path.join(SRC_DIR, 'storage'));
const RATINGS_PATH = require.resolve(path.join(SRC_DIR, 'ratings'));
for (const key of Object.keys(require.cache)) {
  if (key.startsWith(SRC_DIR + path.sep)) delete require.cache[key];
}
const memStub = {
  readJson: () => null,
  writeJson: () => true,
  listJsonByPrefix: () => [],
  deleteJson: () => true,
};
require.cache[STORAGE_PATH] = { id: STORAGE_PATH, filename: STORAGE_PATH, loaded: true, exports: memStub };
require.cache[RATINGS_PATH] = {
  id: RATINGS_PATH, filename: RATINGS_PATH, loaded: true,
  exports: {
    profile: () => ({ level: 1, games: 0 }),
    addPoints: () => ({ ok: true }),
    addExp: () => ({ ok: true }),
  },
};

const { normalizeItem, KINDS } = require(path.join(SRC_DIR, 'items', 'catalog'));

test('④ catalog：byoyomi 槽 + .json manifest ⇒ kind 自动归一为 audiopack', () => {
  assert.ok(KINDS.includes('audiopack'), 'KINDS 必须含 audiopack');
  const it = normalizeItem({
    id: 'byo-voice-ja', type: 'byoyomi', name: '读秒语音包·日语',
    asset: { value: '/sound/packs/byoyomi-sample-v1/manifest.json' },
  });
  assert.ok(it, 'byoyomi + manifest 应合法');
  assert.strictEqual(it.asset.kind, 'audiopack');
});

test('④ catalog：audiopack 只能挂在 byoyomi 槽，不能进 bgm / 图片槽', () => {
  assert.strictEqual(normalizeItem({
    id: 'x1', type: 'bgm', asset: { kind: 'audiopack', value: '/a/manifest.json' },
  }), null, 'bgm 不能用 audiopack');
  assert.strictEqual(normalizeItem({
    id: 'x2', type: 'avatar', asset: { kind: 'audiopack', value: '/a/manifest.json' },
  }), null, '头像槽不能用 audiopack');
});

test('④ catalog：byoyomi 槽仍收单文件音（audio）与合成音（synth），老商品不受影响', () => {
  const a = normalizeItem({ id: 'y1', type: 'byoyomi', asset: { kind: 'audio', value: '/sound/tick.mp3' } });
  const s = normalizeItem({ id: 'y2', type: 'byoyomi', asset: { kind: 'synth', value: 'default' } });
  assert.ok(a && a.asset.kind === 'audio');
  assert.ok(s && s.asset.kind === 'synth');
});

test('④ QC 脚本自检：示例包 13 条齐全、口径达标（exit 0）', () => {
  const manifest = path.join(ROOT, 'public/sound/packs/byoyomi-sample-v1/manifest.json');
  const r = spawnSync(process.execPath, [
    path.join(ROOT, 'tools/check-byoyomi-pack.js'), manifest,
  ], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `QC 应通过，实际失败：\n${r.stdout}\n${r.stderr}`);
  assert.ok(/✓ 通过/.test(r.stdout), '应输出通过结论');
});

test('④ QC 脚本能抓出缺条目（拿掉一个文件必须报错）', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'byoqc-'));
  const m = JSON.parse(JSON.stringify(MANIFEST));
  delete m.files.remain_20;
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
  const r = spawnSync(process.execPath, [
    path.join(ROOT, 'tools/check-byoyomi-pack.js'), path.join(dir, 'manifest.json'),
  ], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1, '缺条目必须判失败');
  assert.ok(/remain_20/.test(r.stdout + r.stderr), '应指出缺哪一条');
});

// ==================================================================
// ⑤ play-clock 接线：装了语音包 = 人声接管、旧三层让位
// ==================================================================
function loadPlayClock(soundStub, t) {
  const PC = path.join(ROOT, 'public/js/play-clock.js');
  delete require.cache[require.resolve(PC)];
  const els = {};
  const makeEl = (id) => ({
    id,
    textContent: '',
    classList: {
      _s: new Set(),
      toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); },
      has(c) { return this._s.has(c); },
    },
  });
  // ⚠️ 只给 getElementById：不带 addEventListener，sound.js 的 boot 就不会跑
  global.document = { getElementById: (id) => (els[id] || (els[id] = makeEl(id))) };
  global.UI = { $: (id) => global.document.getElementById(id), esc: (s) => s, toast: () => {} };
  global.window = global;
  global.Sound = soundStub;
  require(PC);
  const api = global.PlayClock;
  // ⚠️ init() 会起 500ms 定时器：不销毁会让 node --test 永不退出（本文件第一版的坑）
  if (t && typeof t.after === 'function') t.after(() => { try { api.destroy(); } catch (_) {} });
  return api;
}

function makeSoundStub(pack) {
  const calls = [];
  const legacy = { byoyomi: 0, mark: 0, minute: 0 };
  const stub = {
    calls,
    legacy,
    hasVoicePack: () => !!pack,
    announceCountdown: (ms, cfg, book) => { calls.push({ ms, cfg, book }); return 'x'; },
    playByoyomi: () => { legacy.byoyomi++; },
    playByoyomiMark: () => { legacy.mark++; },
    playMinuteWarning: () => { legacy.minute++; },
    setPhase: () => {},
    getPhase: () => 'game',
  };
  return stub;
}

const MAIN_ANNOUNCE = { source: 'main', milestones: [60, 30, 20], countFrom: 10 };
const BYO_ANNOUNCE = { source: 'byoyomi', milestones: [30, 20], countFrom: 10 };

test('⑤ 包干局（source=main）：主时钟就报数，且旧三层让位（不双声）', (t) => {
  const stub = makeSoundStub(true);
  const PC = loadPlayClock(stub, t);
  const state = { status: 'PLAYING', turn: 'b' };
  PC.init({ getState: () => state, getViewpoint: () => 'b' });
  PC.syncFromServer({
    clock: { b: 59500, w: 600000 }, byoyomi: 0,
    curByoyomi: null, inByoyomi: null, turn: 'b', announce: MAIN_ANNOUNCE,
  });
  PC.advance(0);
  assert.strictEqual(stub.calls.length, 1, '包干局不进读秒也要报数');
  assert.strictEqual(stub.calls[0].ms, 59500, '报的是主时钟剩余');
  assert.deepStrictEqual(stub.legacy, { byoyomi: 0, mark: 0, minute: 0 }, '装了包就不能再响旧的三层');
});

test('⑤ 10+30（source=byoyomi）：本时阶段不报人声，但旧的整分钟提醒照旧', (t) => {
  const stub = makeSoundStub(true);
  const PC = loadPlayClock(stub, t);
  const state = { status: 'PLAYING', turn: 'b' };
  PC.init({ getState: () => state, getViewpoint: () => 'b' });

  // 本时还剩 1 分 1 秒
  PC.syncFromServer({
    clock: { b: 61000, w: 300000 }, byoyomi: 30000,
    curByoyomi: { b: 30000, w: 30000 }, inByoyomi: { b: false, w: false },
    turn: 'b', announce: BYO_ANNOUNCE,
  });
  PC.advance(0);        // 首次只记录 mm、不补响
  assert.strictEqual(stub.legacy.minute, 0);
  PC.advance(2000);     // 61s → 59s，跨过整分钟
  assert.strictEqual(stub.legacy.minute, 1,
    '装了包也不能把本时的整分钟提醒连带静音（人声不接管这一段）');
  assert.strictEqual(stub.calls.length, 0, '读秒局的本时阶段不得报人声');

  // 本时耗尽、进入读秒
  PC.syncFromServer({
    clock: { b: 0, w: 300000 }, byoyomi: 30000,
    curByoyomi: { b: 29500, w: 30000 }, inByoyomi: { b: true, w: false },
    turn: 'b', announce: BYO_ANNOUNCE,
  });
  PC.advance(0);
  assert.strictEqual(stub.calls.length, 1, '进入读秒后立刻开始报人声');
  assert.strictEqual(stub.calls[0].ms, 29500, '报的是读秒剩余');
  assert.strictEqual(stub.legacy.mark, 0, '人声接管读秒后，旧的读秒「嗒/叮咚」让位');
});

test('⑤ 未装语音包 ⇒ 旧三层照常响（零回归）', (t) => {
  const stub = makeSoundStub(false);
  const PC = loadPlayClock(stub, t);
  const state = { status: 'PLAYING', turn: 'b' };
  PC.init({ getState: () => state, getViewpoint: () => 'b' });
  PC.syncFromServer({
    clock: { b: 65000, w: 600000 }, byoyomi: 0,
    curByoyomi: null, inByoyomi: null, turn: 'b', announce: MAIN_ANNOUNCE,
  });
  PC.advance(0);        // 首次只记录、不补响
  assert.deepStrictEqual(stub.legacy, { byoyomi: 0, mark: 0, minute: 0 });
  PC.advance(6000);     // 65s → 59s，跨过整分钟
  assert.strictEqual(stub.legacy.minute, 1, '未装包时整分钟提醒照旧');
  assert.strictEqual(stub.calls.length, 0, '未装包不得走人声报时');
});

test('⑤ 报时记账逐手独立：换手后不补报上一手已报过的节点', (t) => {
  const stub = makeSoundStub(true);
  const PC = loadPlayClock(stub, t);
  const state = { status: 'PLAYING', turn: 'b' };
  PC.init({ getState: () => state, getViewpoint: () => 'b' });

  // b 手走到 19.5s → 报 remain_20（并把 60/30 一并记掉）
  PC.syncFromServer({
    clock: { b: 19500, w: 600000 }, byoyomi: 0,
    curByoyomi: null, inByoyomi: null, turn: 'b', announce: MAIN_ANNOUNCE,
  });
  PC.advance(0);
  assert.strictEqual(stub.calls.length, 1);
  const bookB = stub.calls[0].book;

  // 换到 w 手，w 还有 55s —— 应重新报 remain_60，而不是复用 b 的账
  state.turn = 'w';   // ⚠️ advance() 读的是本地 state.turn，服务端消息里的 turn 不会改它
  PC.syncFromServer({
    clock: { b: 19500, w: 55000 }, byoyomi: 0,
    curByoyomi: null, inByoyomi: null, turn: 'w', announce: MAIN_ANNOUNCE,
  });
  PC.advance(0);
  assert.strictEqual(stub.calls.length, 2);
  const bookW = stub.calls[1].book;
  assert.notStrictEqual(bookW, bookB, '两手必须各有一本账');
  assert.deepStrictEqual(bookW, {}, '新的一手账本是空的（不复用上一手的记账）');
});
