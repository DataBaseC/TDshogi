/**
 * history.js — 棋谱页：列表（点击进入复盘器）
 */
(function () {
  const guest = window.NAV.renderNav('history');
  window.API.connect(guest.id);

  let records = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function resultText(r, names) {
    if (r.result === 'b') return { text: `${names[0]} 胜`, cls: 'result-win' };
    if (r.result === 'w') return { text: `${names[1]} 胜`, cls: 'result-win' };
    if (r.result === '-') return { text: r.resultDetail || '和棋', cls: 'result-draw' };
    return { text: '未完成', cls: 'result-draw' };
  }

  async function loadRecords() {
    try {
      const data = await window.ApiUtils.get(`/api/history?player=${encodeURIComponent(guest.id)}`);
      records = data.records || [];
      renderList();
    } catch (e) {
      console.error(e);
    }
  }

  function renderList() {
    const el = document.getElementById('recordList');
    if (!records.length) {
      el.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">暂无对局记录。完成一局后即可在此进入复盘。</div>';
      return;
    }
    el.innerHTML = records.map((r) => {
      const names = r.names || ['先手', '後手'];
      const myResult = resultText(r, names);
      return `
        <div class="record-item" onclick="location.href='review.html?id=${r.id}'">
          <div style="font-size:13px;">${esc(names[0])} vs ${esc(names[1])}</div>
          <div class="r-result ${myResult.cls}">${esc(myResult.text)}</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:3px;">${(r.moves || []).length} 手 · ${new Date(r.createdAt).toLocaleString('zh-CN')} · 进入复盘 →</div>
        </div>
      `;
    }).join('');
  }

  loadRecords();
})();
