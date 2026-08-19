/**
 * nav.js — 全局导航渲染与游客身份
 *
 * 页面共用：左上品牌 TDShogi，右上 首页/对战/棋谱/赛事/个人 五页导航。
 * 游客身份存 localStorage（键 tdshogi_guest）。
 */
(function (global) {
  const GUEST_KEY = 'tdshogi_guest';
  const THEME_KEY = 'tdshogi_theme';

  function getGuest() {
    let g = null;
    try { g = JSON.parse(localStorage.getItem(GUEST_KEY)); } catch (_) {}
    if (!g || !g.id) {
      g = { id: genId(), name: randomName() };
      saveGuest(g);
    }
    return g;
  }

  function saveGuest(g) {
    localStorage.setItem(GUEST_KEY, JSON.stringify(g));
  }

  function genId() {
    let s = '';
    const hex = '0123456789abcdef';
    for (let i = 0; i < 24; i++) s += hex[Math.floor(Math.random() * 16)];
    return s;
  }

  function randomName() {
    const list = ['无名棋士', '一歩名人', '飛車使い', '銀将', '桂馬', '香車', '角行', '竜王', '棋聖', '玉将'];
    return list[Math.floor(Math.random() * list.length)];
  }

  const NAV = [
    { id: 'home', label: '首页', href: 'index.html' },
    { id: 'lobby', label: '对战', href: 'lobby.html' },
    { id: 'history', label: '棋谱', href: 'history.html' },
    { id: 'tournaments', label: '赛事', href: 'tournaments.html' },
    { id: 'profile', label: '个人页面', href: 'profile.html' },
  ];

  /**
   * 渲染导航栏。
   * @param {string} current 当前页 id（'home'|'lobby'|'history'|'tournaments'|'profile'）
   */
  function getTheme() {
    return localStorage.getItem(THEME_KEY) || 'dark';
  }

  function applyTheme() {
    const theme = getTheme();
    document.documentElement.classList.toggle('theme-light', theme === 'light');
    const btn = document.querySelector('.theme-toggle');
    if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
  }

  function renderNav(current) {
    const guest = getGuest();
    const isAccount = typeof guest.id === 'string' && guest.id.includes('.');
    const userBadge = isAccount ? '🔐' : '👤';
    const nav = document.querySelector('.nav');
    if (nav) {
      nav.innerHTML = `
        <a class="brand" href="index.html">
          <span class="brand-logo">TDShogi</span>
          <span class="brand-stamp">将棋</span>
        </a>
        <nav class="nav-links">
          ${NAV.map((n) => `<a href="${n.href}" class="${n.id === current ? 'active' : ''}" data-nav="${n.id}">${n.label}</a>`).join('')}
        </nav>
        <div style="display:flex;align-items:center;gap:10px;">
          <button class="theme-toggle" title="切换主题" onclick="NAV.toggleTheme()">🌙</button>
          <a class="admin-entry" href="admin.html" title="管理后台">🛡️</a>
          <a class="nav-user" href="profile.html" title="个人页面/账号">
            <span>${guest.name}</span>
            <span class="nav-avatar">${userBadge}</span>
          </a>
        </div>
      `;
    } else {
      // 某些页面可能没有 nav 容器，动态创建
      const n = document.createElement('header');
      n.className = 'nav';
      n.innerHTML = `
        <a class="brand" href="index.html"><span class="brand-logo">TDShogi</span><span class="brand-stamp">将棋</span></a>
        <nav class="nav-links">
          ${NAV.map((x) => `<a href="${x.href}" class="${x.id === current ? 'active' : ''}">${x.label}</a>`).join('')}
        </nav>
        <div style="display:flex;align-items:center;gap:10px;">
          <button class="theme-toggle" title="切换主题" onclick="NAV.toggleTheme()">🌙</button>
          <a class="admin-entry" href="admin.html" title="管理后台">🛡️</a>
        </div>
      `;
      document.body.insertBefore(n, document.body.firstChild);
    }
    applyTheme();
    return guest;
  }

  function toggleTheme() {
    const next = getTheme() === 'light' ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, next);
    applyTheme();
  }

  global.NAV = { renderNav, getGuest, saveGuest, randomName, genId, GUEST_KEY, THEME_KEY, toggleTheme, getTheme, applyTheme };
})(window);
