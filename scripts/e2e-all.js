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
  'e2e-handicap.js',
  // 安全边界（2026-09-21 审查 P0/P1 的转正用例）：崩溃向量必须"拒请求但不死进程"、
  // 棋谱越权必须 403、迁移劫持必须被拦 —— 这些都是只能端到端验的。
  'e2e-security.js',
  // 大厅操作幂等性（P1-1，2026-09-23 已修复接入）：重复/失败的 join_room、
  // quick_match 不得把当前对局判负（三段式：先校验后动状态）。
  // 当初暂缓接入的根因已定位：同一 guestId 双连接在同一毫秒握手会生成相同的
  // clientId（纯时间戳后缀），后到连接覆盖先到的注册 → 先到的连接"静默失聪"——
  // clientId 已加自增序号保证唯一（见 protocol.js 的 _connSeq）。
  'e2e-lobby-ops.js',
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
      // 后台入口门禁（P1-4）：设了 key 才能验"编码变形要不要得逞"。
      // 只影响 `/admin.html` 这个页面本身，各 e2e 脚本走的是 WS 与 REST（不拉页面），不受影响。
      ADMIN_ENTRY_KEY: 'e2e-entry-key',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  /**
   * ⚠️ **必须把 stdout 读出来**（2026-09-20 修）。
   *
   * `stdio: 'pipe'` 且**没人读**时，子进程向 stdout 写满管道缓冲区（约 64KB）就会
   * **阻塞在写调用上** —— 整个服务端事件循环停住，后续所有请求都没有响应。
   * 症状极具误导性：某个脚本（`e2e-test.js`）在套件里偶发
   * "create_room 等待回执超时"，而**单独跑必定通过** —— 因为日志量取决于前面跑过哪些脚本。
   * 这里只读走、不打印（避免刷屏），只留一份末尾快照供排障。
   */
  let serverOut = '';   // 末尾快照（排障用）
  let serverOutBytes = 0; // 累计字节数——若曾逼近 64KB，说明这条管道曾经是"堵住的"
  const keepTail = (d) => {
    serverOutBytes += d.length;
    serverOut = (serverOut + d.toString()).slice(-8000);
  };
  server.stdout.on('data', keepTail);
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
    // 脚本自己报的错往往只是"等回执超时"，真正的原因常在服务端——把末尾日志带出来
    console.log(`\n  服务端输出末尾（累计 ${(serverOutBytes / 1024).toFixed(1)} KB）：`);
    (serverOut || '(无)').split('\n').slice(-12).forEach((l) => console.log(`       ${l.slice(0, 150)}`));
    if (serverErr) {
      console.log('  服务端 stderr 末尾：');
      serverErr.split('\n').slice(-8).forEach((l) => console.log(`       ${l.slice(0, 150)}`));
    }
  } else {
    console.log(`\n  服务端输出累计 ${(serverOutBytes / 1024).toFixed(1)} KB（管道缓冲约 64 KB，务必保持被读取）`);
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
