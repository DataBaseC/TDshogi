/**
 * e2e-all.js — 一键跑端到端验证（P0-1「实机验收」里可自动化的那部分）
 *
 * **为什么需要它**：`scripts/` 下有十几个 e2e 脚本，但各自要"先起服、端口对、DATA_DIR 独立"，
 * 而且**两个赛事脚本还需要 `ADMIN_PASSWORD=admin123`**——少一个就会卡在
 * "Admin 等待 admin_logged_in 超时"，看起来像代码坏了（第一次跑就踩过）。
 * 把这些前提固化成一条命令，验收才不会因为"没配对环境"而误判。
 *
 * 用法：
 *   npm run e2e                 # 起隔离实例 → 跑全部 → 汇总 → 停服
 *   npm run e2e -- --keep       # 跑完不删临时 DATA_DIR（排障用）
 *
 * ⚠️ 有两个脚本**自带服务器**（`e2e-snapshot` 重启进程验证快照、`e2e-freeboard` 起 demo 服），
 *    和本脚本起的实例会抢端口，所以不并入本轮，末尾会提示单独跑。
 *
 * ⚠️ 全程使用 **os.tmpdir() 下的临时 DATA_DIR**，绝不碰 `data/` 里的真实库。
 */
'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 3999;
const ADMIN_PASSWORD = 'admin123'; // 赛事脚本写死的口令，必须与它们一致
const BASE = `http://localhost:${PORT}`;

/** 需要外部服务器（本脚本负责起停）的用例 */
const SUITES = [
  'e2e-account.js',
  'e2e-profile.js',
  'e2e-spectator-identity.js',
  'e2e-chat.js',
  'e2e-timecontrol.js',
  'e2e-test.js',
  'e2e-tournament.js',
  'e2e-tournament-admin.js',
  'e2e-player-features.js',
  'test-records.js',
  'test-reconnect.js',
  'test-spectate-rejoin.js',
  '_verify-spectate-rejoin.js',
  'test-drop.js',
];

/** 自带服务器、需单独跑 */
const STANDALONE = ['e2e-snapshot.js', 'e2e-freeboard.js'];

const keep = process.argv.includes('--keep');
const DATA_DIR = path.join(os.tmpdir(), `tdshogi-e2e-${Date.now().toString(36)}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/home`);
      if (r.ok) return true;
    } catch (_) { /* 还没起来 */ }
    await sleep(300);
  }
  return false;
}

/** 从脚本输出里抠出「N 通过, M 失败」（各脚本格式一致）；抠不到返回 null */
function parseSummary(out) {
  const m = out.match(/(\d+)\s*通过\s*,\s*(\d+)\s*失败/);
  return m ? { pass: Number(m[1]), fail: Number(m[2]) } : null;
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`隔离实例：PORT=${PORT}  DATA_DIR=${DATA_DIR}`);

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      DATA_DIR,
      ADMIN_PASSWORD,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverErr = '';
  server.stderr.on('data', (d) => { serverErr += d.toString(); });

  const stop = () => { try { server.kill(); } catch (_) {} };
  process.on('exit', stop);
  process.on('SIGINT', () => { stop(); process.exit(1); });

  if (!(await waitUp())) {
    console.error('✗ 服务未在 20s 内就绪。stderr：\n' + serverErr.slice(0, 800));
    stop();
    process.exit(1);
  }
  console.log('✔ 服务就绪\n');

  const results = [];
  for (const file of SUITES) {
    if (!fs.existsSync(path.join(ROOT, 'scripts', file))) {
      results.push({ file, skipped: true });
      continue;
    }
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join('scripts', file)], {
      cwd: ROOT,
      // 两个自检脚本按 `PORT` 选地址（默认 3100），其余脚本写死 3999
      env: Object.assign({}, process.env, { PORT: String(PORT) }),
      encoding: 'utf8',
      timeout: 180000,
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const sum = parseSummary(out);
    results.push({
      file,
      pass: sum ? sum.pass : null,
      fail: sum ? sum.fail : (r.status === 0 && !sum ? 0 : null),
      exitCode: r.status,
      timedOut: r.error && r.error.code === 'ETIMEDOUT',
      ms: Date.now() - t0,
      out,
    });
    const mark = sum ? (sum.fail === 0 ? '✓' : '✗') : (r.status === 0 ? '·' : '✗');
    const detail = sum ? `${sum.pass} 通过, ${sum.fail} 失败` : (r.status === 0 ? '无汇总（自检脚本）' : `退出码 ${r.status}`);
    console.log(`  ${mark} ${file.padEnd(30)} ${detail}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }

  stop();
  await sleep(400);

  // ---- 汇总 ----
  const bad = results.filter((x) => !x.skipped && ((x.fail != null && x.fail > 0) || x.exitCode !== 0 || x.timedOut));
  const totalPass = results.reduce((s, x) => s + (x.pass || 0), 0);
  const totalFail = results.reduce((s, x) => s + (x.fail || 0), 0);
  console.log(`\n================ e2e 汇总 ================`);
  console.log(`  脚本 ${results.length - results.filter((x) => x.skipped).length} 个 · 断言 ${totalPass} 通过 / ${totalFail} 失败`);
  if (bad.length) {
    console.log('\n  未通过的脚本：');
    for (const b of bad) {
      console.log(`   - ${b.file}${b.timedOut ? '（超时）' : ''}`);
      const lines = (b.out || '').split('\n').filter((l) => /✗|FAIL|异常|Error/.test(l)).slice(0, 4);
      lines.forEach((l) => console.log(`       ${l.trim().slice(0, 130)}`));
    }
  }
  if (STANDALONE.length) {
    console.log(`\n  需单独跑（自带服务器）：${STANDALONE.join('、')}`);
  }

  if (!keep) {
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* Windows 偶发占用，忽略即可 */ }
  } else {
    console.log(`  临时数据保留：${DATA_DIR}`);
  }

  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { console.error('运行器异常：', e); process.exit(1); });
