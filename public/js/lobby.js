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
  // 回车直接加入
  document.getElementById('joinCode').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btnJoinRoom').click();
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
    // §R4 热门优先：观众多的排前面（Array.sort 稳定，同人数保持服务端原序）。
    // 注意：渲染与点击绑定必须共用同一个数组（list），否则点击会张冠李戴。
    const list = [...games].sort((a, b) => (b.spectatorCount || 0) - (a.spectatorCount || 0));
    // 显示房间码 + 对局类型 + 走子数 + 观战人数，便于区分重名玩家；名字带悬停信息卡
    el.innerHTML = list.map((g) => {
      const typeName = g.type === 'reviewing' ? '🎤 复盘中' : g.type === 'quick' ? '快速匹配' : g.type === 'tournament' ? '赛事' : '房间对局';
      const pid = g.playerIds || {};
      const sc = g.spectatorCount || 0;
      const spec = sc > 0 ? ` · 👁 <b style="color:var(--gold-light);">${sc}</b> 人观战` : ' · 观战';
      return `
      <div class="game-card" data-room="${esc(g.roomId)}">
        <div class="players">
          <span data-player-id="${esc(pid.b || '')}">${esc(g.players.b || '先手')}</span>
          <span class="vs">vs</span>
          <span data-player-id="${esc(pid.w || '')}">${esc(g.players.w || '後手')}</span>
        </div>
        <div class="meta">房间 ${esc(g.code)} · ${typeName} · ${g.moveCount} 手${spec}</div>
      </div>
    `;
    }).join('');
    // 点击卡片进入对局：自己是该局选手 → 不带 spectate（走 request_state 由服务端按
    // playerId 回位到选手座位）；否则才以观战身份进入。playerId 在 hello 时由服务端下发。
    el.querySelectorAll('.game-card').forEach((card, i) => {
      const g = list[i];
      card.addEventListener('click', () => {
        const mine = api.playerId && g.playerIds && (g.playerIds.b === api.playerId || g.playerIds.w === api.playerId);
        location.href = `play.html?room=${encodeURIComponent(g.roomId)}${mine ? '' : '&spectate=1'}`;
      });
    });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  loadGames();
  setInterval(loadGames, 5000);
})();
