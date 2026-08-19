/**
 * home.js — 首页逻辑：随机观战、系统公告、ELO 排行榜、进行中对局
 */
(function () {
  const guest = window.NAV.renderNav('home');

  // 初始化 WS
  const api = window.API;
  api.connect(guest.id);

  // Toast
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
  }

  // 随机观战
  document.getElementById('btnRandomWatch').addEventListener('click', () => {
    api.send({ type: 'random_spectate' });
  });
  api.on('spectating', (data) => {
    location.href = `play.html?room=${data.roomId}&spectate=1`;
  });
  api.on('error', (data) => {
    if (data && data.message) toast(data.message);
  });

  // 加载首页数据
  async function loadHome() {
    try {
      const data = await window.ApiUtils.get('/api/home');
      renderAnnouncements(data.announcements);
      renderLeaderboard(data.leaderboard, guest.id);
      renderGames(data.games);
    } catch (e) {
      console.error('load home failed', e);
    }
  }

  function renderAnnouncements(list) {
    const el = document.getElementById('announcements');
    if (!list || !list.length) {
      el.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">暂无公告</div>';
      return;
    }
    el.innerHTML = list.slice(0, 5).map((a) => `
      <div class="announce-card">
        <div class="announce-title">${esc(a.title)}</div>
        <div class="announce-content">${esc(a.content)}</div>
        <div class="announce-date">${new Date(a.createdAt).toLocaleDateString('zh-CN')}</div>
      </div>
    `).join('');
  }

  function renderLeaderboard(lb, myId) {
    const el = document.getElementById('leaderboard');
    const list = lb.list || [];
    if (!list.length) {
      el.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">暂无对局记录</div>';
      return;
    }
    el.innerHTML = list.map((r, i) => `
      <div class="rank-row ${r.id === myId ? 'self' : ''}">
        <span class="rank-no ${i < 3 ? `top${i + 1}` : ''}">${i + 1}</span>
        <span class="rank-name">${esc(r.id === myId ? '我 (' + (guest.name) + ')' : r.name || r.id)}</span>
        <span class="rank-rating">${r.rating}</span>
      </div>
    `).join('');
    if (lb.self && !list.find((r) => r.id === myId)) {
      el.insertAdjacentHTML('beforeend', `
        <div class="rank-row self">
          <span class="rank-no">${lb.self.rank}</span>
          <span class="rank-name">我 (${esc(guest.name)})</span>
          <span class="rank-rating">${lb.self.rating}</span>
        </div>
      `);
    }
  }

  function renderGames(games) {
    const el = document.getElementById('activeGames');
    if (!games || !games.length) {
      el.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">当前没有进行中的对局</div>';
      return;
    }
    el.innerHTML = games.map((g) => `
      <div class="game-card" onclick="location.href='play.html?room=${g.roomId}&spectate=1'">
        <div class="players">
          <span>${esc(g.players.b || '先手')}</span>
          <span class="vs">vs</span>
          <span>${esc(g.players.w || '後手')}</span>
        </div>
        <div class="meta">${g.moveCount} 手 · ${g.type === 'quick' ? '匹配' : '房间'}</div>
      </div>
    `).join('');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  loadHome();
  setInterval(loadHome, 5000);  // 进行中对局/排行/公告定时刷新
})();
