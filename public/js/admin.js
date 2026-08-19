/**
 * admin.js — 管理后台：管理员登录、查看全部棋谱与用户数据
 */
(function () {
  const guest = window.NAV.renderNav(null);
  const ADMIN_KEY = 'tdshogi_admin_token';
  const api = window.API;
  api.connect(guest.id);

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
  }

  function getToken() {
    return localStorage.getItem(ADMIN_KEY);
  }
  function setToken(t) {
    if (t) localStorage.setItem(ADMIN_KEY, t);
    else localStorage.removeItem(ADMIN_KEY);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // 初始化：检测是否已登录
  function initUI() {
    const isAdmin = !!getToken();
    document.getElementById('adminLoginCard').style.display = isAdmin ? 'none' : 'block';
    document.getElementById('adminPanel').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('btnAdminLogout').style.display = isAdmin ? 'inline-block' : 'none';
    if (isAdmin) {
      loadRecords();
      loadUsers();
    }
  }

  // ---- 登录 / 登出 ----
  document.getElementById('btnAdminLogin').addEventListener('click', () => {
    const password = document.getElementById('adminPassword').value;
    if (!password) return toast('请输入管理密码');
    api.send({ type: 'admin_login', data: { password } });
  });
  api.on('admin_logged_in', (data) => {
    setToken(data.token);
    toast('管理员登录成功');
    initUI();
  });
  api.on('error', (data) => {
    if (data && data.message) toast(data.message);
  });
  document.getElementById('btnAdminLogout').addEventListener('click', () => {
    setToken(null);
    toast('已退出管理员');
    initUI();
  });

  // ---- 标签切换 ----
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.classList.toggle('btn-ghost', b !== btn);
      });
      document.getElementById('tab-records').style.display = btn.dataset.tab === 'records' ? 'block' : 'none';
      document.getElementById('tab-users').style.display = btn.dataset.tab === 'users' ? 'block' : 'none';
    });
  });

  // ---- 导入 KIF ----
  document.getElementById('btnImportKif').addEventListener('click', () => {
    document.getElementById('kifFileInput').click();
  });
  document.getElementById('kifFileInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    let okCount = 0, failCount = 0;
    const resultEl = document.getElementById('importResult');
    resultEl.textContent = `正在导入 ${files.length} 个棋谱...`;
    for (const file of files) {
      const text = await file.text();
      try {
        const res = await fetch('/api/admin/records/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-token': getToken() },
          body: JSON.stringify({ text }),
        });
        const data = await res.json();
        if (res.ok && data.ok) okCount++;
        else failCount++;
      } catch (_) { failCount++; }
    }
    resultEl.textContent = `导入完成：成功 ${okCount}，失败 ${failCount}`;
    e.target.value = '';
    loadRecords();
    if (failCount === 0 && okCount > 0) toast(`成功导入 ${okCount} 个棋谱`);
    else if (failCount > 0) toast(`导入完成：${okCount} 成功 / ${failCount} 失败`);
  });

  // ---- 全部棋谱 ----
  let allRecords = [];
  async function loadRecords() {
    try {
      const data = await window.ApiUtils.get(`/api/history?adminToken=${encodeURIComponent(getToken())}`);
      allRecords = data.records || [];
      renderRecords(allRecords);
    } catch (e) {
      // token 失效则回到登录
      if (e.message && e.message.includes('403')) setToken(null);
      toast('加载棋谱失败');
      initUI();
    }
  }

  function renderRecords(records) {
    document.getElementById('recordCount').textContent = records.length;
    const el = document.getElementById('adminRecordList');
    if (!records.length) {
      el.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">暂无棋谱</div>';
      return;
    }
    el.innerHTML = records.map((r) => {
      const names = r.names || ['先手', '後手'];
      const res = r.result === 'b' ? `${names[0]} 胜` : r.result === 'w' ? `${names[1]} 胜` : (r.resultDetail || '和棋');
      return `
        <div class="record-item">
          <div style="font-size:13px;">${esc(names[0])} vs ${esc(names[1])} <span style="color:var(--text-dim);font-size:11px;">（${(r.moves||[]).length}手）</span></div>
          <div class="r-result result-win">${esc(res)}</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:3px;">${new Date(r.createdAt).toLocaleString('zh-CN')}</div>
          <div style="display:flex;gap:6px;margin-top:6px;">
            <button class="btn btn-ghost btn-sm" onclick="adminPlayback('${r.id}')">回放</button>
            <button class="btn btn-ghost btn-sm" onclick="adminExport('${r.id}','kif')">KIF</button>
            <button class="btn btn-ghost btn-sm" onclick="adminExport('${r.id}','csa')">CSA</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // 回放/导出必须携带管理员 token（否则 403）
  window.adminPlayback = (id) => {
    location.href = `review.html?id=${id}&adminToken=${encodeURIComponent(getToken() || '')}`;
  };
  window.adminExport = (id, fmt) => {
    location.href = `/api/records/${id}/export?fmt=${fmt}&token=${encodeURIComponent(getToken() || '')}`;
  };

  // 棋谱搜索（按选手名/ID）
  document.getElementById('recordSearch').addEventListener('input', (e) => {
    const q = (e.target.value || '').trim().toLowerCase();
    if (!q) return renderRecords(allRecords);
    renderRecords(allRecords.filter((r) => {
      const names = (r.names || []).join(' ').toLowerCase();
      const ids = [r.playerIds && r.playerIds.b, r.playerIds && r.playerIds.w].filter(Boolean).join(' ').toLowerCase();
      return names.includes(q) || ids.includes(q);
    }));
  });

  // ---- 全部用户 ----
  let allUsers = [];
  async function loadUsers() {
    try {
      const data = await window.ApiUtils.get(`/api/admin/users?token=${encodeURIComponent(getToken())}`);
      allUsers = data.users || [];
      renderUsers(allUsers);
    } catch (e) {
      if (e.message && e.message.includes('403')) setToken(null);
      initUI();
    }
  }

  function renderUsers(users) {
    document.getElementById('userCount').textContent = users.length;
    const el = document.getElementById('adminUserList');
    if (!users.length) {
      el.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">暂无用户</div>';
      return;
    }
    el.innerHTML = users.map((u) => `
      <div class="record-item">
        <div style="font-size:13px;">${esc(u.name)} <span style="color:var(--text-dim);font-size:11px;">(${u.id})</span></div>
        <div class="r-result result-win">ELO ${u.rating}</div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:3px;">${u.games} 局 · 胜 ${u.wins} / 负 ${u.losses} / 平 ${u.draws} · 胜率 ${u.winRate}%</div>
        <div style="display:flex;gap:6px;margin-top:6px;">
          <button class="btn btn-ghost btn-sm" onclick="viewUser('${u.id}')">查看详情</button>
        </div>
      </div>
    `).join('');
  }

  // 用户搜索
  document.getElementById('userSearch').addEventListener('input', (e) => {
    const q = (e.target.value || '').trim().toLowerCase();
    if (!q) return renderUsers(allUsers);
    renderUsers(allUsers.filter((u) =>
      (u.name || '').toLowerCase().includes(q) || (u.id || '').toLowerCase().includes(q)));
  });

  // ---- 用户详情 ----
  window.viewUser = async (id) => {
    try {
      const data = await window.ApiUtils.get(`/api/admin/users/${id}?token=${encodeURIComponent(getToken())}`);
      document.getElementById('detailUserName').textContent = data.name;
      const p = data.profile;
      const recs = data.records || [];
      document.getElementById('detailBody').innerHTML = `
        <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px;">
          <div class="card stat-card"><div class="num">${p.rating}</div><div class="label">ELO</div></div>
          <div class="card stat-card"><div class="num">${p.games}</div><div class="label">对局</div></div>
          <div class="card stat-card"><div class="num">${p.wins}</div><div class="label">胜</div></div>
          <div class="card stat-card"><div class="num">${p.losses}</div><div class="label">负</div></div>
        </div>
        <div style="font-size:14px;font-weight:700;margin:8px 0;">对局记录（${recs.length}）</div>
        ${recs.length ? recs.map((r) => {
          const names = r.names || ['先手', '後手'];
          const res = r.result === 'b' ? `${names[0]}胜` : r.result === 'w' ? `${names[1]}胜` : (r.resultDetail || '和棋');
          return `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid rgba(128,128,128,0.15);">${esc(names[0])} vs ${esc(names[1])} — ${esc(res)}（${(r.moves||[]).length}手）</div>`;
        }).join('') : '<div style="color:var(--text-dim);font-size:12px;">暂无对局</div>'}
      `;
      document.getElementById('userDetailModal').style.display = 'flex';
    } catch (e) {
      toast('加载用户详情失败');
    }
  };

  initUI();
})();
