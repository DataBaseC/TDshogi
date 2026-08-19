/**
 * tournaments.js — 赛事页：创建、加入、对阵表渲染
 */
(function () {
  const guest = window.NAV.renderNav('tournaments');
  const api = window.API;
  api.connect(guest.id);

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
  }

  document.getElementById('btnCreateTournament').addEventListener('click', () => {
    const name = document.getElementById('tName').value.trim();
    const size = parseInt(document.getElementById('tSize').value, 10);
    api.send({ type: 'create_tournament', data: { name: name || '未命名赛事', size } });
  });

  api.on('tournament_created', (data) => {
    toast(`赛事「${data.name}」已创建`);
    loadTournaments();
  });
  api.on('tournament_joined', () => {
    toast('已加入赛事');
    loadTournaments();
  });
  api.on('error', (data) => {
    if (data && data.message) toast(data.message);
  });

  // 赛事对局开始：在线参赛者自动进入对局页
  api.on('game_start', (data) => {
    if (data && data.roomId && !location.search.includes('room=')) {
      location.href = `play.html?room=${data.roomId}&join=1`;
    }
  });

  async function loadTournaments() {
    try {
      const data = await window.ApiUtils.get('/api/tournaments');
      renderList(data.tournaments || []);
    } catch (e) { console.error(e); }
  }

  function renderList(list) {
    const el = document.getElementById('tournamentList');
    if (!list.length) {
      el.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">暂无赛事，创建第一个吧！</div>';
      return;
    }
    el.innerHTML = list.map((t) => {
      const statusText = t.status === 'open' ? '报名中' : t.status === 'playing' ? '进行中' : '已结束';
      const isIn = t.players.some((p) => p.id === guest.id);
      const joinBtn = t.status === 'open' && !isIn
        ? `<button class="btn btn-primary btn-sm" onclick="joinTournament('${t.id}')">加入</button>`
        : t.status === 'open' && isIn
          ? `<span style="color:var(--gold-light);font-size:13px;">已报名 (${t.players.length}/${t.size})</span>`
          : '';
      return `
        <div class="card tournament-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div style="font-weight:700;font-size:17px;">${esc(t.name)}</div>
            <div style="display:flex;gap:12px;align-items:center;">
              <span style="font-size:13px;color:var(--text-dim);">${statusText} · ${t.players.length}/${t.size} 人</span>
              ${joinBtn}
            </div>
          </div>
          <div style="font-size:12px;color:var(--text-dim);margin-bottom:12px;">
            参赛者：${t.players.map((p) => esc(p.name)).join('、') || '暂无'}
          </div>
          ${t.status !== 'open' ? renderBracket(t) : ''}
          ${t.status === 'finished' && t.championId ? `<div style="margin-top:12px;color:var(--gold-light);font-weight:700;">🏆 冠军：${esc(getName(t, t.championId))}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  function getName(t, id) {
    const p = (t.players || []).find((x) => x.id === id);
    return p ? p.name : '未知';
  }

  // 渲染对阵表（平铺树 → 分层）
  function renderBracket(t) {
    const bracket = t.bracket || [];
    if (!bracket.length) return '';
    // 按层级分组：满二叉树，叶子在最下层
    const depth = Math.log2(t.size);
    const levels = [];
    for (let d = 0; d <= depth; d++) {
      const start = Math.pow(2, d) - 1;
      const count = Math.pow(2, d);
      const nodes = bracket.slice(start, start + count);
      levels.push(nodes);
    }
    const myId = guest.id;
    return `
      <div class="bracket">
        ${levels.map((levelNodes, li) => `
          <div class="bracket-col">
            ${levelNodes.map((n) => {
              const isLeaf = !n.pair;
              const p1 = n.players && n.players[0] ? getName(t, n.players[0]) : null;
              const p2 = n.players && n.players[1] ? getName(t, n.players[1]) : null;
              const mine = n.matchId && n.players && n.players.includes(myId);
              const inMatch = n.matchId && n.players;
              const winnerName = n.winnerId ? getName(t, n.winnerId) : null;
              let body = '';
              if (winnerName) {
                body = `<div class="p winner">${esc(winnerName)} 晋级</div>`;
              } else if (inMatch) {
                const enter = mine
                  ? `<a class="btn btn-primary btn-sm" href="play.html?room=${n.matchId}&join=1" style="margin-top:6px;">进入对局</a>`
                  : `<div style="font-size:11px;color:var(--gold-light);margin-top:6px;">对局进行中</div>`;
                body = `<div class="p">${esc(p1 || '?')} vs ${esc(p2 || '?')}</div>${enter}`;
              } else if (isLeaf && n.name) {
                body = `<div class="p">${esc(n.name)}</div>`;
              } else {
                body = `<div class="p" style="color:var(--text-dim);">待定</div>`;
              }
              return `<div class="bracket-match" style="${n.winnerId ? 'border-color:var(--gold);' : ''}">${body}</div>`;
            }).join('')}
          </div>
        `).join('')}
      </div>
    `;
  }

  window.joinTournament = (id) => {
    api.send({ type: 'join_tournament', data: { id } });
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  loadTournaments();
  setInterval(loadTournaments, 5000);  // 轮询：检测新对局安排/对阵推进
})();
