/**
 * history.js — 棋谱页：检索 + 列表（点击进入复盘器）
 *
 * 检索条件：关键词（选手名）/ 开局（前 N 手 USI）/ 手数范围 / 结果。
 */
(function () {
  const guest = window.NAV.renderNav('history');
  window.API.connect(guest.id);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function resultText(r, names) {
    if (r.result === 'b') return { text: `${names[0]} 胜`, cls: 'result-win' };
    if (r.result === 'w') return { text: `${names[1]} 胜`, cls: 'result-win' };
    if (r.result === '-') return { text: r.resultDetail || '和棋', cls: 'result-draw' };
    return { text: '未完成', cls: 'result-draw' };
  }

  function buildQuery() {
    const q = { player: guest.id };
    const query = document.getElementById('searchQuery').value.trim();
    const opening = document.getElementById('searchOpening').value.trim();
    const moves = document.getElementById('searchMoves').value.trim();
    const result = document.getElementById('searchResult').value;
    if (query) q.query = query;
    if (opening) q.opening = opening;
    if (moves) {
      const m = moves.match(/^(\d+)\s*[-~]\s*(\d+)$/);
      if (m) { q.movesMin = m[1]; q.movesMax = m[2]; }
    }
    if (result) q.result = result;
    return q;
  }

  async function loadRecords() {
    try {
      const q = buildQuery();
      const qs = Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      const data = await window.ApiUtils.get(`/api/records/search?${qs}`);
      records = data.records || [];
      document.getElementById('recordCount').textContent = records.length ? `${records.length} 局` : '';
      renderList();
    } catch (e) {
      console.error(e);
    }
  }

  function renderList() {
    const el = document.getElementById('recordList');
    if (!records.length) {
      el.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">暂无匹配的对局。完成对局后可在此检索与复盘。</div>';
      return;
    }
    el.innerHTML = records.map((r) => {
      const names = r.names || ['先手', '後手'];
      const myResult = resultText(r, names);
      const opening = r.opening ? `<span style="color:var(--gold-light);font-size:11px;">开局 ${esc(r.opening)}</span>` : '';
      return `
        <div class="record-item" onclick="location.href='review.html?id=${r.id}'">
          <div style="font-size:13px;">${esc(names[0])} vs ${esc(names[1])}</div>
          <div class="r-result ${myResult.cls}">${esc(myResult.text)}</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:3px;">${(r.moves || []).length} 手 · ${new Date(r.createdAt).toLocaleString('zh-CN')} · ${opening} · 进入复盘 →</div>
        </div>
      `;
    }).join('');
  }

  document.getElementById('btnSearch').addEventListener('click', loadRecords);
  document.getElementById('btnResetSearch').addEventListener('click', () => {
    document.getElementById('searchQuery').value = '';
    document.getElementById('searchOpening').value = '';
    document.getElementById('searchMoves').value = '';
    document.getElementById('searchResult').value = '';
    loadRecords();
  });
  // 回车触发检索
  ['searchQuery', 'searchOpening', 'searchMoves'].forEach((id) => {
    document.getElementById(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') loadRecords(); });
  });

  let records = [];
  loadRecords();
})();
