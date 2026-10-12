#!/usr/bin/env node
/**
 * tools/item-admin.js — 道具系统发放 CLI（管理员 / 活动用）
 *
 * ⚠️ 2026-10-03 新功能：道具系统骨架 —— 一期没有后台发放界面，"发道具/发币/发兑换码"
 * 先由这个 CLI 承担（二期可挪进管理后台）。
 *
 * 用法：
 *   node tools/item-admin.js items                        # 列出目录（id / 类型 / 价格 / 稀有度）
 *   node tools/item-admin.js list  <account>              # 看某账号的钱包 / 拥有 / 装备
 *   node tools/item-admin.js grant <account> <itemId>     # 直接发一件道具
 *   node tools/item-admin.js coin  <account> <±n>         # 加减货币
 *   node tools/item-admin.js code  <CODE> <itemId|--> [--coin N] [--max N]
 *                                                         # 定义兑换码（itemId 传 - 表示只发币）
 *
 * 说明：<account> 可以是 **账号 id / 会话令牌 / 登录用户名**（不必再手抄 24 hex）。
 *       ⚠️ 2026-10-12 产品决策：**道具只发给注册账号，游客一律拒绝** —— 游客没有装扮背包
 *       入口，且游客升级为账号时不迁移 items（`accounts.migrateGuestData` 只迁 评级/棋谱/会话），
 *       发给游客等于发了就丢。本 CLI 与后台走**同一套**收件人终检（`items/targets.js`）。
 *       本 CLI 需要已安装依赖（走 src/items → src/storage）。
 */
'use strict';

const items = require('../src/items');
const targets = require('../src/items/targets');

function usage() {
  console.log([
    '用法：',
    '  node tools/item-admin.js items',
    '  node tools/item-admin.js list  <account>',
    '  node tools/item-admin.js grant <account> <itemId>',
    '  node tools/item-admin.js coin  <account> <±n>',
    '  node tools/item-admin.js code  <CODE> <itemId|--> [--coin N] [--max N]',
    '',
    '<account> = 账号 id / 会话令牌 / 登录用户名（道具只发给注册账号，游客拒绝）',
  ].join('\n'));
  process.exit(1);
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, def) => {
  const i = rest.indexOf(name);
  return i >= 0 && i + 1 < rest.length ? rest[i + 1] : def;
};

/**
 * 把命令行传来的 <account> 解析成**注册账号 id**。
 * ⚠️ 与后台同一个收件人终检：解析不出 / 是游客 → 打印原因并退出，绝不写孤儿键或游客键。
 */
function resolveAccount(raw) {
  const t = targets.resolveItemTargetDetail(raw);
  if (!t.ok) {
    console.log(`失败：${t.error}`);
    process.exit(1);
  }
  return t.id;
}

switch (cmd) {
  case 'items': {
    const rows = items.catalog().map((it) => ({
      id: it.id,
      type: it.type,
      price: it.price === null ? '免费' : it.price,
      rarity: it.rarity || '-',
      name: it.name || '',
    }));
    console.table(rows);
    break;
  }

  case 'list': {
    const raw = rest[0];
    if (!raw) usage();
    const accountId = resolveAccount(raw);
    const snap = items.snapshot(accountId);
    console.log(`账号 ${accountId}（${targets.targetLabel(accountId)}）`);
    console.log('  货币：', snap.wallet.coin);
    console.log('  拥有：', snap.owned.length ? snap.owned.join(', ') : '(无)');
    const eq = Object.entries(snap.equipped).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
    console.log('  装备：', eq.length ? eq.join(', ') : '(无)');
    break;
  }

  case 'grant': {
    const [raw, itemId] = rest;
    if (!raw || !itemId) usage();
    const accountId = resolveAccount(raw);
    // 操作者随流水落盘（`--by <name>` 指定，便于后台对账知道是谁发的）
    const r = items.grant(accountId, itemId, 'admin', { adminId: flag('--by', 'cli') });
    console.log(r.ok
      ? `已发放 ${itemId} → ${accountId}（${targets.targetLabel(accountId)}，现拥有 ${r.owned.length} 件）`
      : `失败：${r.error}`);
    process.exit(r.ok ? 0 : 1);
    break;
  }

  case 'coin': {
    const [raw, nRaw] = rest;
    const n = Number(nRaw);
    if (!raw || !Number.isFinite(n)) usage();
    const accountId = resolveAccount(raw);
    const r = items.addCoin(accountId, n, { adminId: flag('--by', 'cli') });
    console.log(r.ok ? `${accountId}（${targets.targetLabel(accountId)}）货币现为 ${r.wallet.coin}` : `失败：${r.error}`);
    process.exit(r.ok ? 0 : 1);
    break;
  }

  case 'code': {
    const [code, itemId] = rest;
    if (!code || !itemId) usage();
    const coin = Number(flag('--coin', 0)) || 0;
    const maxUses = Number(flag('--max', 1)) || 1;
    const def = items.defineCode(code, {
      itemId: itemId === '-' ? null : itemId,
      coin,
      maxUses,
    });
    console.log(`兑换码 ${code} 已定义：道具=${def.itemId || '（无）'} 币=${def.coin} 上限=${def.maxUses}`);
    break;
  }

  default:
    usage();
}
