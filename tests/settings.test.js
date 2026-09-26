/**
 * settings.test.js — 用户设置中心（public/js/settings.js）的回归测试。
 *
 * 重点钉死两类"写错不报错、只是悄悄坏掉"的坑：
 *  1) SCHEMA 是设置面板的唯一描述：键必须在 DEFAULTS 里、select 的默认值必须在
 *     options 白名单内、选项值不得重复——加了设置项忘了补默认值/选项，这里立刻红；
 *  2) `file:<名字>` 选项必须对应**真实存在的音频文件**（soundMove → public/sound/、
 *     bgm → public/music/）：面板里给用户看得见的选项，点了不能没声音。
 *
 * 另外钉住归一化行为：localStorage 可被手改，非法值一律回落默认，不许把垃圾值
 * 一路带到运行时。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT, 'public/js/settings.js');

// 最小浏览器替身：settings.js 加载即 apply()，会摸 documentElement/body/addEventListener。
global.window = global;
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
function fakeEl() {
  return {
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    addEventListener() {},
    appendChild() {},
    setAttribute() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}
global.document = {
  documentElement: { classList: { toggle() {} } },
  body: fakeEl(),
  head: { appendChild() {} },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  createElement: () => fakeEl(),
};

/** 用给定的 localStorage 内容重新加载 settings.js（清掉模块缓存以重置 load() 的 cache） */
function freshSettings(stored) {
  delete require.cache[require.resolve(SETTINGS_PATH)];
  store.clear();
  for (const [k, v] of Object.entries(stored || {})) {
    store.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  require(SETTINGS_PATH);
  return global.Settings;
}

const Settings = freshSettings();

test('SCHEMA：每个键都在 DEFAULTS 里，类型合法，label 非空', () => {
  for (const it of Settings.SCHEMA) {
    assert.ok(Object.prototype.hasOwnProperty.call(Settings.DEFAULTS, it.key),
      `SCHEMA 键 ${it.key} 必须在 DEFAULTS 里有默认值`);
    assert.ok(['bool', 'select'].includes(it.type), `${it.key} 的 type 非法: ${it.type}`);
    assert.ok(typeof it.label === 'string' && it.label.length > 0, `${it.key} 缺 label`);
  }
  // 反向：DEFAULTS 的每个键都要能在面板上出现（否则用户改不了它）
  const schemaKeys = new Set(Settings.SCHEMA.map((it) => it.key));
  for (const k of Object.keys(Settings.DEFAULTS)) {
    assert.ok(schemaKeys.has(k), `DEFAULTS 键 ${k} 在 SCHEMA 里没有对应项（面板上改不了）`);
  }
});

test('SCHEMA：select 的默认值必须在 options 白名单内，选项值不得重复', () => {
  for (const it of Settings.SCHEMA) {
    if (it.type !== 'select') continue;
    const vals = it.options.map(([v]) => String(v));
    assert.strictEqual(new Set(vals).size, vals.length, `${it.key} 的选项值有重复`);
    assert.ok(vals.includes(String(Settings.DEFAULTS[it.key])),
      `${it.key} 的默认值 ${Settings.DEFAULTS[it.key]} 不在选项里`);
  }
});

test('归一化：手改坏的 localStorage 一律回落默认，不把垃圾值带进运行时', () => {
  const s = freshSettings({
    tdshogi_settings: JSON.stringify({
      theme: 'neon', atlas: 'zzz', soundMove: 'file:不存在的音',
      bgm: 'file:不存在的曲', sound: 0, showCoords: 'yes', dragToMove: null,
    }),
  });
  assert.strictEqual(s.get('theme'), 'dark');
  assert.strictEqual(s.get('atlas'), 'kinki');
  assert.strictEqual(s.get('soundMove'), 'default');
  assert.strictEqual(s.get('bgm'), 'off');
  assert.strictEqual(s.get('sound'), false);
  assert.strictEqual(s.get('showCoords'), true, 'bool 项按真值归一化（"yes" 为真）');
  assert.strictEqual(s.get('dragToMove'), false);
});

test('旧键迁移：只在新键缺该字段时搬运，新键优先', () => {
  const s = freshSettings({ tdshogi_theme: 'light', tdshogi_sound: 'off' });
  assert.strictEqual(s.get('theme'), 'light');
  assert.strictEqual(s.get('sound'), false);

  const s2 = freshSettings({
    tdshogi_theme: 'light', tdshogi_sound: 'off',
    tdshogi_settings: JSON.stringify({ theme: 'dark', sound: true }),
  });
  assert.strictEqual(s2.get('theme'), 'dark', '新键已有值时不许被旧键覆盖');
  assert.strictEqual(s2.get('sound'), true);
});

test('set()：白名单外的键拒绝写入；合法写入持久化并通知订阅者', () => {
  const s = freshSettings();
  assert.strictEqual(s.set('不存在的键', 1), false);

  let got = null;
  const off = s.subscribe((all, key) => { got = { all, key }; });
  assert.strictEqual(s.set('theme', 'light'), true);
  assert.strictEqual(s.get('theme'), 'light');
  assert.ok(got && got.key === 'theme', '订阅者应收到变更键');
  assert.strictEqual(got.all.theme, 'light');
  assert.strictEqual(s.set('theme', 'light'), false, '同值写入不算变更');
  off();
});

test('文件选项：`file:<名字>` 必须对应 public/ 下真实存在的 mp3（面板选项点了不能没声音）', () => {
  // 各设置键的音频目录：落子/读秒/分钟提醒在 sound/，BGM 在 music/
  const DIR = { soundMove: 'sound', soundMinute: 'sound', soundByoyomi: 'sound', bgm: 'music' };
  for (const it of Settings.SCHEMA) {
    if (it.type !== 'select') continue;
    for (const [v] of it.options) {
      if (typeof v !== 'string' || !v.startsWith('file:')) continue;
      const dir = DIR[it.key];
      assert.ok(dir, `${it.key} 出现了 file: 选项但没配音频目录`);
      const file = path.join(ROOT, 'public', dir, v.slice(5) + '.mp3');
      assert.ok(fs.existsSync(file), `${it.key} 的选项 ${v} 缺音频文件 ${path.relative(ROOT, file)}`);
    }
  }
});

test('openPanel 在没有 settingsMask 时不抛错（面板 DOM 动态注入前也可安全调用）', () => {
  const s = freshSettings();
  assert.doesNotThrow(() => s.openPanel());
  assert.doesNotThrow(() => s.closePanel());
});
