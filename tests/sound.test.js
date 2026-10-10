/**
 * sound.test.js — 音效/BGM 音频链路（public/js/sound.js）的回归测试。
 *
 * `file:<名字>` 方案是「设置值 → 文件 URL → <audio>」这条链：
 * 中间任何一环写错（少个 `.mp3`、目录写成 music/、忘了 loop）都不报错，
 * 只是**没声音**，上线前极难发现。这里用 Audio 桩把链路钉死：
 *  - `file:pieces/pieces_wood` → `sound/pieces/pieces_wood.mp3`（吃子降速高 = 更沉）；
 *  - BGM `file:loop` → `music/loop.mp3`、`loop=true`、对局结束暂停；
 *  - `default` 变体不建 Audio（走合成音，无 AudioContext 时静默跳过）；
 *  - 总开关关掉后不再发声，重开后 BGM 恢复；
 *  - BGM 素材**缺失**（error 事件 / `play()` 被拒）→ 静默降级到合成 pad：不抛错、
 *    不反复重试 404、旧曲迟到的失败也不误伤新曲（public/music/ 是可选素材）。
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

test('BGM 三轨：setTracks + setPhase(game) → 开局曲循环；setPhase(menu) 切菜单曲', () => {
  const Sound = freshSound({ sound: true, music: true });
  Sound.setTracks({
    menu: '/music/loop.mp3',
    game: '/music/静弈.mp3',
    endgame: '/music/制勝.mp3',
  });
  // setTracks 会同步当前 phase（默认 menu）→ 起菜单曲
  assert.strictEqual(made.length, 1);
  assert.strictEqual(made[0].url, encodeURI('/music/loop.mp3'));
  assert.strictEqual(made[0].loop, true, 'BGM 必须循环');
  assert.strictEqual(made[0].volume, 0.35, 'BGM 不许盖过落子/读秒提示音');

  Sound.setPhase('game');
  assert.strictEqual(made.length, 2);
  assert.strictEqual(made[1].url, encodeURI('/music/静弈.mp3'), '开局轨应播对局曲');
  assert.strictEqual(made[1].paused, false);

  Sound.setPhase('game'); // 幂等
  assert.strictEqual(made.length, 2, '同 phase 不许新建 Audio');

  Sound.setPhase('endgame');
  assert.strictEqual(made[made.length - 1].url, encodeURI('/music/制勝.mp3'), '终盘轨（读秒）应切高潮曲');
  assert.strictEqual(Sound.getPhase(), 'endgame');

  Sound.setPhase('menu');
  assert.strictEqual(made[made.length - 1].url, encodeURI('/music/loop.mp3'), '回菜单切菜单曲');
});

test('BGM 切曲：旧曲暂停，新曲换 URL', () => {
  const Sound = freshSound({ sound: true, music: true });
  Sound.setTracks({ menu: '/music/loop.mp3', game: '/music/loop.mp3', endgame: null });
  Sound.setPhase('game');
  assert.strictEqual(made[made.length - 1].url, encodeURI('/music/loop.mp3'));

  Sound.setTracks({ menu: '/music/loop.mp3', game: '/music/制勝.mp3', endgame: null });
  assert.strictEqual(made[made.length - 1].url, encodeURI('/music/制勝.mp3'));
  assert.strictEqual(made[made.length - 2].paused, true, '旧曲必须停');
});

test('全局音乐开关：关掉后 BGM 停；重开后恢复当前轨（独立于行棋音效）', () => {
  const vals = { sound: true, soundMove: 'file:pieces/pieces_wood', music: true };
  const Sound = freshSound(vals);
  Sound.setTracks({ menu: null, game: '/music/loop.mp3', endgame: null });
  Sound.setPhase('game');
  assert.strictEqual(made.length, 1);
  assert.strictEqual(made[0].url, encodeURI('/music/loop.mp3'));

  Sound.applyMusicOn(false); // Settings 订阅回调入口
  assert.strictEqual(Sound.isMusicOn(), false);
  assert.strictEqual(made[0].paused, true, '关音乐时 BGM 要停');

  const n = made.length;
  Sound.playMove();
  assert.strictEqual(made.length, n + 1, '关音乐不影响行棋音效');

  vals.music = true;
  Sound.applyMusicOn(true);
  Sound.bgmSync();
  assert.ok(made.length > n, '重开后应恢复 BGM');
  assert.strictEqual(made[made.length - 1].url, encodeURI('/music/loop.mp3'));
  assert.strictEqual(made[made.length - 1].paused, false);
});

test('music:false / 无曲目时，任何路径都不建 BGM Audio', () => {
  const Sound = freshSound({ sound: true, music: false });
  Sound.setTracks({ menu: '/music/loop.mp3', game: '/music/loop.mp3', endgame: null });
  Sound.setPhase('game');
  assert.strictEqual(made.length, 0, 'music=off 不许出声');

  // ⚠️ 2026-10-08：三轨默认自带 loop/静弈/制勝，「无曲」必须显式置 null
  const Sound2 = freshSound({ sound: true, music: true });
  Sound2.setTracks({ menu: null, game: null, endgame: null });
  Sound2.setPhase('menu');
  assert.strictEqual(made.length, 0, '三轨皆 null 时不建 Audio');
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

// ======================================================================
// Bug5 回归（2026-09-27 外包修复）：真实音频失败**必须回退合成音**
//
// 旧实现 `const p = a.play(); return true;`（reject 被 `.catch(()=>{})` 吞掉）
// 破坏了"失败即回退"的契约：文件 404 / 自动播放被拦时调用方永不回退 → 完全没声音。
// 这里用会失败/会触发 error 的 Audio 桩，验证两条失败路径都能退到合成音（有振荡器）。
// ======================================================================
test('Bug5：file 方案播放失败时回退合成音（play() reject 与 error 事件两条路径）', async () => {
  const savedAudio = global.Audio;
  const savedAC = global.AudioContext;
  const acCalls = { osc: 0, buf: 0 };

  // 记录型 AudioContext：用来判定"合成音确实被触发"（创建了振荡器/缓冲）
  class RecordingAC {
    constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = {}; }
    resume() {}
    createGain() {
      return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() { return this; } };
    }
    createOscillator() {
      acCalls.osc++;
      return {
        type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() { return this; }, start() {}, stop() {},
      };
    }
    createBuffer() { acCalls.buf++; return { getChannelData() { return new Float32Array(8); } }; }
    createBufferSource() { return { buffer: null, connect() { return this; }, start() {} }; }
    createBiquadFilter() { return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() { return this; } }; }
  }
  global.AudioContext = RecordingAC;

  // (a) play() 返回 reject 的 Promise（自动播放被拦 / 解码失败）
  class RejectAudio {
    constructor(url) { this.url = url; this.volume = 1; this.playbackRate = 1; this.paused = true; made.push(this); }
    play() { return Promise.reject(new Error('blocked')); }
    pause() {}
  }
  global.Audio = RejectAudio;
  let Sound = freshSound({ sound: true, soundMove: 'file:pieces/pieces_wood', bgm: 'off' });
  acCalls.osc = 0;
  Sound.playMove();
  await new Promise((r) => setTimeout(r, 0)); // 等 promise.catch 执行
  assert.ok(acCalls.osc > 0, 'play() reject 后应回退合成音（不应静默无声）');

  // (b) play() 不返回 Promise，但音频元素触发 error 事件（404 常走这条）
  class ErrAudio {
    constructor(url) { this.url = url; this.volume = 1; this.playbackRate = 1; this.paused = true; made.push(this); }
    play() { return undefined; }
    pause() {}
  }
  global.Audio = ErrAudio;
  Sound = freshSound({ sound: true, soundMove: 'file:pieces/pieces_wood', bgm: 'off' });
  acCalls.osc = 0;
  Sound.playMove();
  const el = made[made.length - 1];
  assert.ok(el && typeof el.onerror === 'function', '应给音频元素挂 onerror 回退');
  el.onerror();
  assert.ok(acCalls.osc > 0, 'error 事件后应回退合成音');

  // (c) 对照：play() 正常 → 不回退（不重复发声）
  class OkAudio {
    constructor(url) { this.url = url; this.volume = 1; this.playbackRate = 1; this.paused = true; made.push(this); }
    play() { this.paused = false; return { catch() {} }; }
    pause() {}
  }
  global.Audio = OkAudio;
  Sound = freshSound({ sound: true, soundMove: 'file:pieces/pieces_wood', bgm: 'off' });
  acCalls.osc = 0;
  Sound.playMove();
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(acCalls.osc, 0, '正常播放时不应回退（不重复发声）');

  global.Audio = savedAudio;
  if (savedAC === undefined) delete global.AudioContext; else global.AudioContext = savedAC;
});

// ======================================================================
// BGM 素材兜底（2026-09-28）：public/music/ 是**可选素材**——仓库默认不带 mp3
// （27MB 音频不该成为 clone/部署门槛）。任何失败路径都不许抛错、不许把对局搞哑：
// 必须静默降级到实时合成的 ambient pad（见 sound.js 的 synthPadStart）。
// ======================================================================

/** 记录型 AudioContext：判定「合成兜底确实启动」（创建了振荡器） */
function recordingAC(calls) {
  return class {
    constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = {}; }
    resume() {}
    createGain() {
      return {
        gain: {
          value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {},
          setTargetAtTime() {}, cancelScheduledValues() {},
        },
        connect() { return this; },
      };
    }
    createOscillator() {
      calls.osc++;
      return {
        type: '',
        frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        detune: { value: 0 },
        connect() { return this; }, start() {}, stop() {},
      };
    }
    createBiquadFilter() {
      return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() { return this; } };
    }
    createBuffer() { return { getChannelData() { return new Float32Array(8); } }; }
    createBufferSource() { return { buffer: null, connect() { return this; }, start() {} }; }
  };
}

// ======================================================================
// 2026-10-08 用户要求「去掉默认的合成电子音」：BGM 素材缺失/被拦时**静默**，
// 不再降级 ambient pad（那玩意儿听起来就是电子嗡鸣）。以下用例钉死静默契约。
// ======================================================================
test('BGM 素材缺失（error 事件）→ 静默：不抛错、不反复重试 404、不起合成 pad', () => {
  const savedAudio = global.Audio;
  const savedAC = global.AudioContext;
  const calls = { osc: 0 };
  const built = [];
  class ErrAudio {
    constructor(url) { this.url = url; this.paused = true; this.loop = false; this.volume = 1; built.push(this); }
    play() { this.paused = false; return undefined; } // 无 promise → 只能靠 error 事件
    pause() { this.paused = true; }
  }
  global.AudioContext = recordingAC(calls);
  global.Audio = ErrAudio;
  try {
    const Sound = freshSound({ sound: true, music: true });
    Sound.setTracks({ menu: null, game: '/music/loop.mp3', endgame: null });
    Sound.setPhase('game');
    assert.doesNotThrow(() => Sound.bgmSync(), '素材缺失绝不许抛错');
    assert.strictEqual(built.length, 1);
    assert.strictEqual(built[0].url, encodeURI('/music/loop.mp3'));
    assert.strictEqual(built[0].loop, true, 'BGM 元素必须循环');
    assert.strictEqual(built[0].volume, 0.35, 'BGM 不许盖过落子/读秒提示音');
    assert.strictEqual(typeof built[0].onerror, 'function', '必须给素材元素挂 onerror 兜底');

    built[0].onerror(); // 404
    assert.strictEqual(Sound.bgmState().mode, null, '素材失败后静默（mode=null，不起合成 pad）');
    assert.strictEqual(calls.osc, 0, '不许起合成 pad 振荡器');

    Sound.setPhase('game'); // 幂等重入
    Sound.bgmSync();
    assert.strictEqual(built.length, 1, '已确认缺失的素材不得反复重试 404');
    assert.strictEqual(Sound.bgmState().mode, null, '重入后仍静默');
  } finally {
    global.Audio = savedAudio;
    if (savedAC === undefined) delete global.AudioContext; else global.AudioContext = savedAC;
  }
});

test('BGM play() 被拒（自动播放策略）→ 静默，但不记 bgmFailed（手势后可重试）', async () => {
  const savedAudio = global.Audio;
  const savedAC = global.AudioContext;
  const calls = { osc: 0 };
  class RejAudio {
    constructor(url) { this.url = url; this.paused = true; this.loop = false; }
    play() { this.paused = false; return Promise.reject(new Error('blocked')); }
    pause() { this.paused = true; }
  }
  global.AudioContext = recordingAC(calls);
  global.Audio = RejAudio;
  try {
    const Sound = freshSound({ sound: true, music: true });
    Sound.setTracks({ menu: null, game: '/music/空弦.mp3', endgame: null });
    Sound.setPhase('game');
    assert.doesNotThrow(() => Sound.bgmSync(), 'play() 拒绝也不许抛错');
    await new Promise((r) => setTimeout(r, 0)); // 等 promise.catch 执行
    assert.strictEqual(Sound.bgmState().mode, null, 'play() 被拒后静默（无合成 pad）');
    assert.strictEqual(calls.osc, 0, '不许起合成 pad');
  } finally {
    global.Audio = savedAudio;
    if (savedAC === undefined) delete global.AudioContext; else global.AudioContext = savedAC;
  }
});

test('BGM 素材缺失：无 AudioContext 时静默跳过（绝不抛错）', () => {
  const savedAudio = global.Audio;
  const savedAC = global.AudioContext;
  const built = [];
  class ErrAudio {
    constructor(url) { this.url = url; this.paused = true; this.loop = false; built.push(this); }
    play() { this.paused = false; return undefined; }
    pause() { this.paused = true; }
  }
  delete global.AudioContext;
  global.Audio = ErrAudio;
  try {
    const Sound = freshSound({ sound: true, music: true });
    Sound.setTracks({ menu: null, game: '/music/静弈.mp3', endgame: null });
    Sound.setPhase('game');
    assert.doesNotThrow(() => built[built.length - 1].onerror(), '无 AudioContext 时静默也不许抛错');
    assert.strictEqual(Sound.bgmState().mode, null);
  } finally {
    global.Audio = savedAudio;
    if (savedAC === undefined) delete global.AudioContext; else global.AudioContext = savedAC;
  }
});

test('BGM 对照：素材可播时正常出声；旧曲迟到的失败不误伤新曲', () => {
  const savedAudio = global.Audio;
  const savedAC = global.AudioContext;
  const calls = { osc: 0 };
  const built = [];
  class OkAudio {
    constructor(url) { this.url = url; this.paused = true; this.loop = false; built.push(this); }
    play() { this.paused = false; return { catch() {} }; }
    pause() { this.paused = true; }
  }
  global.AudioContext = recordingAC(calls);
  global.Audio = OkAudio;
  try {
    const Sound = freshSound({ sound: true, music: true });
    Sound.setTracks({ menu: null, game: '/music/loop.mp3', endgame: '/music/制勝.mp3' });
    Sound.setPhase('game');
    assert.strictEqual(Sound.bgmState().mode, 'file');
    assert.strictEqual(calls.osc, 0, '素材正常时不该起合成 pad');

    const first = built[0];
    Sound.setTracks({ menu: null, game: '/music/制勝.mp3', endgame: '/music/制勝.mp3' });
    assert.strictEqual(built.length, 2, '切曲应新建元素');
    assert.strictEqual(Sound.bgmState().url, '/music/制勝.mp3', 'bgmState 报的是逻辑路径');

    first.onerror(); // 旧曲此刻才报 404（迟到的失败）
    assert.strictEqual(Sound.bgmState().mode, 'file', '旧曲的失败不得打断新曲');
    assert.strictEqual(Sound.bgmState().url, '/music/制勝.mp3');
    assert.strictEqual(built.length, 2, '旧曲失败不得引发重新构建');
  } finally {
    global.Audio = savedAudio;
    if (savedAC === undefined) delete global.AudioContext; else global.AudioContext = savedAC;
  }
});
