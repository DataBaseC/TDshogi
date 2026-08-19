/**
 * lobby.js — 对战页逻辑：快速匹配、创建/加入房间、观战列表
 */
(function () {
  const guest = window.NAV.renderNav('lobby');
  const api = window.API;
  api.connect(guest.id);

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
  }

  // ---- 快速匹配 ----
  document.getElementById('btnQuickMatch').addEventListener('click', () => {
    api.send({ type: 'quick_match' });
    document.getElementById('matchControls').style.display = 'none';
    document.getElementById('matchWait').classList.add('show');
  });
  document.getElementById('btnCancelMatch').addEventListener('click', () => {
    api.send({ type: 'cancel_match' });
    document.getElementById('matchWait').classList.remove('show');
    document.getElementById('matchControls').style.display = 'block';
  });

  // ---- 创建房间 ----
  document.getElementById('btnCreateRoom').addEventListener('click', () => {
    const timeControl = document.getElementById('roomTimeControl').value || '10:00';
    api.send({ type: 'create_room', data: { timeControl } });
  });

  // ---- 加入房间 ----
  document.getElementById('btnJoinRoom').addEventListener('click', () => {
    const code = document.getElementById('joinCode').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return toast('请输入 6 位有效房间码');
    api.send({ type: 'join_room', data: { code } });
  });

  // ---- WS 事件 ----
  api.on('room_created', (data) => {
    document.getElementById('roomCode').textContent = data.code;
    document.getElementById('roomCreated').style.display = 'block';
    toast('房间已创建，等待对手加入');
  });
  api.on('room_joined', (data) => {
    toast('加入成功，对局开始！');
    setTimeout(() => (location.href = `play.html?room=${data.roomId}`), 400);
  });
  api.on('matched', (data) => {
    toast('匹配成功！对局开始');
    setTimeout(() => (location.href = `play.html?room=${data.roomId}`), 400);
  });
  api.on('game_start', (data) => {
    if (location.search.includes('room')) return;
    location.href = `play.html?room=${data.roomId}`;
  });
  api.on('spectating', (data) => {
    location.href = `play.html?room=${data.roomId}`;
  });
  api.on('error', (data) => {
    if (data && data.message) {
      toast(data.message);
      if (data.message.includes('匹配')) {
        document.getElementById('matchWait').classList.remove('show');
        document.getElementById('matchControls').style.display = 'block';
      }
    }
  });

  // ---- 观战列表 ----
  async function loadGames() {
    try {
      const data = await window.ApiUtils.get('/api/lobby');
      renderGames(data.games);
    } catch (e) { console.error(e); }
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
        <div class="meta">${g.moveCount} 手 · ${g.type === 'quick' ? '快速匹配' : '房间对局'} · 观战</div>
      </div>
    `).join('');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  loadGames();
  setInterval(loadGames, 5000);
})();
