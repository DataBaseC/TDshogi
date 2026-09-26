/**
 * sound.test.js — 音效/BGM 音频链路（public/js/sound.js）的回归测试。
 *
 * `file:<名字>` 方案是「设置值 → 文件 URL → <audio>」这条链：
 * 中间任何一环写错（少个 `.mp3`、目录写成 music/、忘了 loop）都不报错，
 * 只是**没声音**，上线前极难发现。这里用 Audio 桩把链路钉死：
 *  - `file:pieces/pieces_wood` → `sound/pieces/pieces_wood.mp3`（吃子降速高 = 更沉）；
 *  - BGM `file:loop` → `music/loop.mp3`、`loop=true`、对局结束暂停；
 *  - `default` 变体不建 Audio（走合成音，无 AudioContext 时静默跳过）；
 *  - 总开关关掉后不再发声，重开后 BGM 恢复。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const SOUND_PATH = path.join(__dirname, '../public/js/sound.js');

// 最小浏览器替身
global.window = global;
global.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

/** 记录所有被构造的 Audio（桩），断言 URL/音量/循环等 */
const made = [];
class FakeAudio {
  constructor(url) {
    this.url = url;
    this.volume = 1;
    this.playbackRate = 1;
    this.loop = false;
    this.paused = true;
    this.played = 0;
    made.push(this);
  }
  play() { this.paused = false; this.played++; return { catch() {} }; }
  pause() { this.paused = true; }
}
global.Audio = FakeAudio;

/** 用给定设置重新加载 sound.js（模块闭包里有 enabled/bgmEl 等状态，必须重置） */
function freshSound(vals) {
  delete require.cache[require.resolve(SOUND_PATH)];
  global.Settings = { get: (k) => vals[k], set() {} };
  made.length = 0;
  require(SOUND_PATH);
  return global.Sound;
}

test('落子/吃子的 file: 方案：`file:pieces/pieces_wood` → `sound/pieces/pieces_wood.mp3`，吃子降速高', () => {
  const Sound = freshSound({ sound: true, soundMove: 'file:pieces/pieces_wood' });

  Sound.playMove();
  assert.strictEqual(made.length, 1, 'playMove 应建一个 Audio');
  assert.strictEqual(made[0].url, encodeURI('sound/pieces/pieces_wood.mp3'));
  assert.strictEqual(made[0].volume, 0.9);
  assert.strictEqual(made[0].playbackRate, 1);
  assert.strictEqual(made[0].played, 1);

  Sound.playCapture();
  assert.strictEqual(made.length, 2);
  assert.strictEqual(made[1].url, encodeURI('sound/pieces/pieces_wood.mp3'));
  assert.strictEqual(made[1].playbackRate, 0.82, '吃子降速高 = 音色更沉');
});

test('default 变体不建 Audio（合成音路径；无 AudioContext 时静默跳过、不抛错）', () => {
  const Sound = freshSound({ sound: true, soundMove: 'default', bgm: 'off' });
  assert.doesNotThrow(() => {
    Sound.playMove(); Sound.playCapture(); Sound.playByoyomi();
    Sound.playStart(); Sound.playEnd(); Sound.playMinuteWarning(); Sound.playByoyomiMark();
  });
  assert.strictEqual(made.length, 0, 'default 变体不该碰 Audio');
});

test('BGM：`file:loop` → `music/loop.mp3` 循环播放；bgmStart 幂等，bgmStop 暂停', () => {
  const Sound = freshSound({ sound: true, bgm: 'file:loop' });

  Sound.bgmStart();
  assert.strictEqual(made.length, 1);
  assert.strictEqual(made[0].url, encodeURI('music/loop.mp3'));
  assert.strictEqual(made[0].loop, true, 'BGM 必须循环');
  assert.strictEqual(made[0].volume, 0.35, 'BGM 不许盖过落子/读秒提示音');
  assert.strictEqual(made[0].paused, false);

  Sound.bgmStart(); // 幂等：对局开始事件重复触发不该重头播放
  assert.strictEqual(made.length, 1, '曲目没变时不许新建 Audio');

  Sound.bgmStop();
  assert.strictEqual(made[0].paused, true);
  assert.strictEqual(made.length, 1);
});

test('BGM 切曲：旧曲暂停，新曲换 URL（`file:制勝` → `music/制勝.mp3`）', () => {
  const vals = { sound: true, bgm: 'file:loop' };
  const Sound = freshSound(vals);

  Sound.bgmStart();
  vals.bgm = 'file:制勝';
  Sound.bgmSync();

  assert.strictEqual(made.length, 2);
  assert.strictEqual(made[0].paused, true, '旧曲必须停');
  assert.strictEqual(made[1].url, encodeURI('music/制勝.mp3'));
  assert.strictEqual(made[1].paused, false);
});

test('总开关：关掉后不发声且 BGM 停；重开后对局进行中则恢复 BGM', () => {
  const vals = { sound: true, soundMove: 'file:pieces/pieces_wood', bgm: 'file:loop' };
  const Sound = freshSound(vals);

  Sound.bgmStart();
  assert.strictEqual(made.length, 1);

  Sound.applyEnabled(false); // Settings 订阅回调入口（内部不同步 setEnabled，防递归）
  assert.strictEqual(Sound.isEnabled(), false);
  assert.strictEqual(made[0].paused, true, '关音效时 BGM 也要停');
  const n = made.length;
  Sound.playMove();
  assert.strictEqual(made.length, n, '关掉后 playMove 不该发声');

  Sound.applyEnabled(true);
  Sound.bgmSync();
  assert.strictEqual(Sound.isEnabled(), true);
  assert.ok(made.length > n, '重开后应恢复 BGM');
  assert.strictEqual(made[made.length - 1].url, encodeURI('music/loop.mp3'));
  assert.strictEqual(made[made.length - 1].paused, false);
});

test('bgm: off / 未开始对局时，任何路径都不建 BGM Audio', () => {
  const Sound = freshSound({ sound: true, bgm: 'off' });
  Sound.bgmStart(); // 对局开始了，但设置是关闭
  Sound.bgmSync();
  assert.strictEqual(made.length, 0, 'bgm=off 不许出声');

  const Sound2 = freshSound({ sound: true, bgm: 'file:loop' });
  Sound2.bgmStop(); // 没开始过就 stop：无操作、不抛错
  assert.strictEqual(made.length, 0);
});

test('Settings 未加载时 variant 回退 default，不抛错', () => {
  delete global.Settings;
  delete require.cache[require.resolve(SOUND_PATH)];
  made.length = 0;
  require(SOUND_PATH);
  const Sound = global.Sound;
  assert.strictEqual(Sound.variant('soundMove'), 'default');
  assert.doesNotThrow(() => Sound.playMove());
  assert.strictEqual(made.length, 0);
});
