#!/usr/bin/env node
/**
 * tools/check-byoyomi-pack.js — 读秒语音包质检（QC）
 *
 * 校验一个语音包 manifest 及其 13 条音频是否符合《读秒语音包设计 v2》的硬性口径：
 *
 *   必需条目（13）：remain_60(剩1分) / remain_30(剩30秒) / remain_20(剩20秒)
 *                  + count_10 … count_01（十、九、…、一）
 *   时长带：倒数条 0.30–0.60s；节点条 0.60–1.20s
 *   编码  ：OGG/Vorbis，48kHz，单声道，96–128kbps
 *   响度  ：整体 -16 LUFS ±1；峰值 ≤ -1 dBFS；13 条间响度差 ≤ 2 LU
 *   静音  ：每条首尾静音 ≤ 30ms
 *
 * 用法：
 *   node tools/check-byoyomi-pack.js <manifest.json> [--strict]
 *
 *   --strict  把「警告」也当成失败（CI 用；日常自检不必）
 *
 * 退出码：0 = 通过；1 = 有错误（或 --strict 下有警告）；2 = 用法/环境问题。
 *
 * 依赖：ffprobe / ffmpeg 在 PATH 上。缺失时**只做文件存在性与命名校验**并给出提示，
 * 不把「没装 ffmpeg」算成包本身的问题。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ---- 口径常量（与设计 v2 §7 一致） --------------------------------------
const REQUIRED = [
  'remain_60', 'remain_30', 'remain_20',
  'count_10', 'count_09', 'count_08', 'count_07', 'count_06',
  'count_05', 'count_04', 'count_03', 'count_02', 'count_01',
];
const BANDS = { count: [0.30, 0.60], remain: [0.60, 1.20] };
const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const BITRATE_KBPS = [96, 128];
const LUFS_TARGET = -16;
const LUFS_TOL = 1;
const PEAK_MAX_DB = -1;
const LUFS_SPREAD_MAX = 2;
const SILENCE_MS_MAX = 30;

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const manifestPath = args.filter((a) => a !== '--strict')[0];

if (!manifestPath) {
  console.error('用法: node tools/check-byoyomi-pack.js <manifest.json> [--strict]');
  process.exit(2);
}

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

function have(bin) {
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  return r.status === 0;
}
const HAS_FFPROBE = have('ffprobe');
const HAS_FFMPEG = have('ffmpeg');

// ---- 1. manifest 结构 ----------------------------------------------------
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
  console.error(`✗ manifest 读不了：${manifestPath}\n  ${e.message}`);
  process.exit(1);
}

const dir = path.dirname(path.resolve(manifestPath));
console.log(`\n读秒语音包质检  ${path.basename(manifestPath)}`);
console.log(`  目录：${dir}`);
console.log(`  ffmpeg：${HAS_FFMPEG ? '有' : '无'}  ffprobe：${HAS_FFPROBE ? '有' : '无'}\n`);

if (manifest.kind !== 'audiopack') {
  err(`manifest.kind 应为 "audiopack"，实际是 ${JSON.stringify(manifest.kind)}`);
}
if (!manifest.version) warn('manifest 缺 version 字段（建议记打包版本，便于复检）');
if (!manifest.locale) warn('manifest 缺 locale 字段（如 "ja" / "zh-CN"）');
const files = manifest.files && typeof manifest.files === 'object' ? manifest.files : null;
if (!files) {
  err('manifest.files 缺失或不是对象');
  console.log(`✗ 失败：${errors.length} 错误\n`);
  process.exit(1);
}

for (const k of REQUIRED) {
  if (!files[k]) err(`缺必需条目 ${k}`);
}
for (const k of Object.keys(files)) {
  if (!REQUIRED.includes(k)) warn(`多余条目 ${k}（不在 13 条口径内，运行时不会被用到）`);
}

// ---- 2. 逐条文件校验 -----------------------------------------------------
function ffprobe(file) {
  const r = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,sample_rate,channels,bit_rate',
    '-show_entries', 'format=duration',
    '-of', 'json', file,
  ], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch (_) { return null; }
}

function integratedLoudness(file) {
  // ebur128 的 summary 打到 stderr
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file,
    '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  if (r.status !== 0 && r.status !== null && !r.stderr) return null;
  const out = r.stderr || '';
  // ⚠️ ebur128 会**逐帧**打印 `I:`，必须取最后一行（Summary 的 Integrated loudness）。
  // 取第一帧会拿到 -70.0 LUFS 这种假值（起始静音帧），是本脚本第一版的坑。
  const ms = [...out.matchAll(/\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)];
  const ps = [...out.matchAll(/\bPeak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/g)];
  return {
    lufs: ms.length ? parseFloat(ms[ms.length - 1][1]) : null,
    peak: ps.length ? parseFloat(ps[ps.length - 1][1]) : null,
  };
}

function edgeSilenceMs(file) {
  // 首/尾静音时长：用 silencedetect 抓头尾两段
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file,
    '-af', 'silencedetect=noise=-50dB:d=0.01', '-f', 'null', '-'], { encoding: 'utf8' });
  const out = r.stderr || '';
  const head = /silence_start:\s*(\d+(?:\.\d+)?)/.exec(out);
  const starts = [...out.matchAll(/silence_start:\s*(\d+(?:\.\d+)?)/g)].map((x) => parseFloat(x[1]));
  const ends = [...out.matchAll(/silence_end:\s*(\d+(?:\.\d+)?)/g)].map((x) => parseFloat(x[1]));
  const duration = outDuration(file);
  const headMs = starts.length && starts[0] === 0 ? (ends[0] || 0) * 1000 : 0;
  let tailMs = 0;
  if (duration != null && starts.length && ends.length) {
    const lastStart = starts[starts.length - 1];
    const lastEnd = ends[ends.length - 1];
    if (Math.abs(lastEnd - duration) < 0.02) tailMs = (duration - lastStart) * 1000;
  }
  void head;
  return { headMs, tailMs };
}

let cachedDur = {};
function outDuration(file) {
  if (cachedDur[file] !== undefined) return cachedDur[file];
  const p = ffprobe(file);
  cachedDur[file] = p && p.format && p.format.duration ? parseFloat(p.format.duration) : null;
  return cachedDur[file];
}

const loud = [];
for (const key of Object.keys(files).sort()) {
  const rel = String(files[key]);
  const abs = path.resolve(dir, rel);
  const band = key.startsWith('remain_') ? BANDS.remain : BANDS.count;
  const label = `  ${key.padEnd(10)} ${rel.padEnd(22)}`;

  if (!fs.existsSync(abs)) {
    console.log(`${label} ✗ 文件不存在`);
    err(`${key} 指向的文件不存在：${rel}`);
    continue;
  }
  const size = fs.statSync(abs).size;
  if (size === 0) {
    console.log(`${label} ✗ 0 字节`);
    err(`${key} 文件为空：${rel}`);
    continue;
  }
  if (!HAS_FFPROBE) {
    console.log(`${label} ✓ ${(size / 1024).toFixed(1)}KB（无 ffprobe，跳过编码/时长校验）`);
    continue;
  }

  const info = ffprobe(abs);
  if (!info || !info.streams || !info.streams.length) {
    console.log(`${label} ✗ 探不到音频流`);
    err(`${key} 不是可解析的音频：${rel}`);
    continue;
  }
  const st = info.streams[0];
  const dur = info.format && info.format.duration ? parseFloat(info.format.duration) : null;
  const problems = [];

  if ((st.codec_name || '').toLowerCase() !== 'vorbis') {
    problems.push(`编码应为 vorbis(OGG)，实际 ${st.codec_name}`);
  }
  if (Number(st.sample_rate) !== SAMPLE_RATE) problems.push(`采样率应为 ${SAMPLE_RATE}，实际 ${st.sample_rate}`);
  if (Number(st.channels) !== CHANNELS) problems.push(`声道应为 ${CHANNELS}，实际 ${st.channels}`);
  const kbps = st.bit_rate ? Math.round(Number(st.bit_rate) / 1000) : null;
  if (kbps != null && (kbps < BITRATE_KBPS[0] - 4 || kbps > BITRATE_KBPS[1] + 4)) {
    problems.push(`码率应在 ${BITRATE_KBPS[0]}–${BITRATE_KBPS[1]}kbps，实际 ${kbps}kbps`);
  }
  if (dur == null) problems.push('读不到时长');
  else if (dur < band[0] || dur > band[1]) {
    problems.push(`时长应在 ${band[0]}–${band[1]}s，实际 ${dur.toFixed(3)}s`);
  }

  if (HAS_FFMPEG) {
    const L = integratedLoudness(abs);
    if (L && L.lufs != null) {
      loud.push({ key, lufs: L.lufs });
      if (Math.abs(L.lufs - LUFS_TARGET) > LUFS_TOL) {
        problems.push(`响度应为 ${LUFS_TARGET}±${LUFS_TOL} LUFS，实际 ${L.lufs.toFixed(1)} LUFS`);
      }
      if (L.peak != null && L.peak > PEAK_MAX_DB) {
        problems.push(`峰值应 ≤ ${PEAK_MAX_DB} dBFS，实际 ${L.peak.toFixed(1)} dBFS`);
      }
    }
    const S = edgeSilenceMs(abs);
    if (S.headMs > SILENCE_MS_MAX) problems.push(`首静音 ${S.headMs.toFixed(0)}ms > ${SILENCE_MS_MAX}ms`);
    if (S.tailMs > SILENCE_MS_MAX) problems.push(`尾静音 ${S.tailMs.toFixed(0)}ms > ${SILENCE_MS_MAX}ms`);
  }

  const durTxt = dur == null ? '?' : dur.toFixed(2) + 's';
  const lTxt = loud.length && loud[loud.length - 1].key === key
    ? `  ${loud[loud.length - 1].lufs.toFixed(1)} LUFS` : '';
  if (problems.length) {
    console.log(`${label} ✗ ${durTxt}${lTxt}`);
    problems.forEach((p) => { console.log(`               · ${p}`); err(`${key}：${p}`); });
  } else {
    console.log(`${label} ✓ ${durTxt}${lTxt}`);
  }
}

// ---- 3. 条目间响度差 -----------------------------------------------------
if (loud.length >= 2) {
  const vals = loud.map((x) => x.lufs);
  const spread = Math.max(...vals) - Math.min(...vals);
  if (spread > LUFS_SPREAD_MAX) {
    warn(`条目间响度差 ${spread.toFixed(2)} LU > ${LUFS_SPREAD_MAX} LU（${loud
      .sort((a, b) => a.lufs - b.lufs)[0].key} 最轻，${loud[loud.length - 1].key} 最响）`);
    if (strict) err(`条目间响度差超限（--strict）`);
    else console.log(`\n  ⚠ 条目间响度差 ${spread.toFixed(2)} LU（限 ${LUFS_SPREAD_MAX} LU）`);
  }
}

// ---- 汇总 ----------------------------------------------------------------
console.log('');
if (warnings.length) {
  console.log(`警告 ${warnings.length} 条：`);
  warnings.forEach((w) => console.log(`  · ${w}`));
}
if (errors.length) {
  console.log(`✗ 失败：${errors.length} 错误`);
  errors.forEach((e) => console.log(`  · ${e}`));
  process.exit(1);
}
if (strict && warnings.length) {
  console.log('✗ 失败：--strict 下警告也算失败');
  process.exit(1);
}
console.log('✓ 通过：13 条齐全，命名/编码/时长/响度均在口径内');
process.exit(0);
