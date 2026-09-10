/**
 * util.js — 跨页面公共工具（PLAN §M5 附带的收敛）
 *
 * 此前这三段代码被**逐字复制**到各个页面脚本里：
 *   - `$`      3 份（home / play / play-clock）
 *   - `esc`   10 份（lobby / tournaments / hovercard / home / history / review /
 *                    gallery / profile（**同一文件里还定义了两次**）/ admin）
 *   - `toast`  8 份（连 `2500` 这个提示时长都硬编码了 8 次）
 *
 * 重复本身还不是最要紧的——**`esc` 是 XSS 防护函数**才是关键。它被抄了 10 份，意味着
 * 哪天要补一个转义字符（比如单引号），你得改 10 个地方，**漏掉一个就是那个页面的 XSS 漏洞**，
 * 而且不会有任何报错、页面照常工作，只是安静地等一个恶意昵称。收敛为唯一实现后，
 * 这类「改一处漏九处」的风险从结构上消失。
 *
 * 用法：各页面删掉原来的本地定义，换成一行绑定——**所有调用点一行都不用改**：
 *   const { $, esc, toast } = window.UI;
 *
 * ⚠️ 加载顺序：必须早于 `nav.js` 与所有页面脚本（它们都会用到这些函数）。
 */
(function (global) {
  'use strict';

  /** 取元素：`$('id')` → `document.getElementById('id')` */
  function $(id) { return document.getElementById(id); }

  /** HTML 转义（防 XSS）：用于所有拼接进 innerHTML 的动态文本 */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    }[c]));
  }

  /**
   * 轻提示：写入 `#toast` 并显示 2.5 秒。
   * 找不到 `#toast` 时静默返回（原各份实现会直接抛错——提示失败不该拖垮整页逻辑）。
   */
  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
  }

  global.UI = { $, esc, toast };
})(window);
