/**
 * test-drop.js — 验证打子判定：把金打入对方王旁边（打将，应合法）
 */
'use strict';
const { newGame } = require('../src/game');

// 后手玉 5a（SFEN 第一行 = y=1 = 段1 最上排），先手持金，先手走
const sfen = '4k4/9/9/9/9/9/9/9/9 b G 1';

function tryDrop(usi) {
  const g = newGame(sfen);
  const r = g.applyMove(usi);
  console.log(`${usi}（打入王侧，构成打将）:`, r.ok ? 'OK 合法' : `被拒!! ${r.error}`);
}

tryDrop('G*5b');   // 金打 5b：攻击 5a 的王 → 打将，应合法
tryDrop('G*4b');   // 金打 4b：攻击 5a 的王（斜前）→ 打将，应合法
tryDrop('G*5e');   // 远处打，不将王，应合法
