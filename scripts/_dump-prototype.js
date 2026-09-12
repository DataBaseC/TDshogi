/**
 * _dump-prototype.js — 临时工具（§M1 拆分期间使用，拆分完成后删除）
 *
 * 用途：把 `RoomManager.prototype` 的方法名逐个打印出来，供拆分前后做 diff——
 * 这是「纯搬运」的**机器证明**：方法个数与名字必须一模一样，少一个就是漏搬，
 * 多一个就是凭空造出来的。
 *
 * 用法：node scripts/_dump-prototype.js > .tmp-proto-before.txt
 */
'use strict';

const { RoomManager } = require('../src/rooms');

const names = Object.getOwnPropertyNames(RoomManager.prototype).filter((n) => n !== 'constructor').sort();
console.log('COUNT=' + names.length);
for (const n of names) console.log(n);
