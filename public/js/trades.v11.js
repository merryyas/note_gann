/* TradeArchive — Trades Page v7 (Tables API) */

let allTrades = [], filteredTrades = [], currentPage = 1, pageSize = 20;
let currentTZ = 'server';

document.addEventListener('DOMContentLoaded', async () => {
  allTrades = await DB.getAll('trades');
  populateSymbolFilter();
  applyFilters();
});

function populateSymbolFilter() {
  const symbols = [...new Set(allTrades.map(t => t.symbol).filter(Boolean))].sort();
  const sel = document.getElementById('filterSymbol');
  symbols.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; sel.appendChild(o); });
}

['filterPlatform','filterType','filterSymbol','filterPnl','filterDateFrom','filterDateTo','sortField','sortDir','pageSize']
  .forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('change', () => { currentPage = 1; applyFilters(); }); });

const tzEl = document.getElementById('tzSelect');
if (tzEl) tzEl.addEventListener('change', () => { currentTZ = tzEl.value; renderTable(); renderPagination(); });

document.getElementById('filterReset').addEventListener('click', () => {
  ['filterPlatform','filterType','filterSymbol','filterPnl','filterDateFrom','filterDateTo'].forEach(id => { document.getElementById(id).value = ''; });
  currentPage = 1; applyFilters();
});

function applyFilters() {
  const platform  = document.getElementById('filterPlatform').value;
  const type      = document.getElementById('filterType').value;
  const symbol    = document.getElementById('filterSymbol').value;
  const pnlMode   = document.getElementById('filterPnl').value;
  const dateFrom  = document.getElementById('filterDateFrom').value;
  const dateTo    = document.getElementById('filterDateTo').value;
  const sortField = document.getElementById('sortField').value;
  const sortDir   = document.getElementById('sortDir').value;
  pageSize = parseInt(document.getElementById('pageSize').value) || 20;

  filteredTrades = allTrades.filter(t => {
    if (platform && t.platform !== platform) return false;
    if (type     && t.type     !== type)     return false;
    if (symbol   && t.symbol   !== symbol)   return false;
    if (pnlMode === 'profit' && (parseFloat(t.profit)||0) <= 0) return false;
    if (pnlMode === 'loss'   && (parseFloat(t.profit)||0) >= 0) return false;
    if (dateFrom) { const dt = t.close_time ? new Date(t.close_time) : null; if (!dt || dt < new Date(dateFrom)) return false; }
    if (dateTo)   { const to = new Date(dateTo); to.setHours(23,59,59,999); const dt = t.close_time ? new Date(t.close_time) : null; if (!dt || dt > to) return false; }
    return true;
  });

  filteredTrades.sort((a, b) => {
    let va = a[sortField], vb = b[sortField];
    if (['open_time','close_time'].includes(sortField)) { va = va ? new Date(va).getTime() : 0; vb = vb ? new Date(vb).getTime() : 0; }
    else if (['profit','lots','open_price','close_price','pips'].includes(sortField)) { va = parseFloat(va)||0; vb = parseFloat(vb)||0; }
    else { va = String(va||'').toLowerCase(); vb = String(vb||'').toLowerCase(); }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  renderStats(); renderTable(); renderPagination();
}

function renderStats() {
  const total  = filteredTrades.length;
  const profit = filteredTrades.reduce((a,t) => a + (parseFloat(t.profit)||0), 0);
  const wins   = filteredTrades.filter(t => (parseFloat(t.profit)||0) > 0).length;
  const wr     = total > 0 ? ((wins/total)*100).toFixed(1) : 0;
  document.getElementById('statsFiltered').textContent = `${total.toLocaleString()}건 조회됨`;
  const pe = document.getElementById('statsFilteredProfit');
  pe.textContent = `수익합: ${fmt.currency(profit)}`;
  pe.style.color = profit >= 0 ? 'var(--green)' : 'var(--red)';
  document.getElementById('statsFilteredWin').textContent = `승률: ${wr}%`;
}

function renderTable() {
  const tbody = document.getElementById('allTradesTbody');
  const start = (currentPage - 1) * pageSize;
  const page  = filteredTrades.slice(start, start + pageSize);
  if (page.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty-msg"><i class="fas fa-search"></i> 조건에 맞는 거래가 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = page.map(t => {
    const p    = parseFloat(t.profit) || 0;
    const pips = parseFloat(t.pips);
    return `<tr>
      <td style="color:var(--text-muted);font-size:11px;">${t.ticket||'—'}</td>
      <td style="font-weight:600;color:var(--text-primary);">${t.symbol||'—'}</td>
      <td><span class="type-badge ${t.type}">${(t.type||'').toUpperCase()}</span></td>
      <td>${fmt.lots(t.lots)}</td>
      <td>${t.open_price||'—'}</td>
      <td>${t.close_price||'—'}</td>
      <td class="${!isNaN(pips)?(pips>=0?'profit-cell pos':'profit-cell neg'):''}">${fmt.pips(pips)}</td>
      <td style="font-size:11px;">${fmt.datetimeTZ(t.open_time,  currentTZ)}</td>
      <td style="font-size:11px;">${fmt.datetimeTZ(t.close_time, currentTZ)}</td>
      <td class="profit-cell ${profitClass(p)}">${fmt.currency(p)}</td>
      <td><span class="platform-badge ${(t.platform||'').toLowerCase()}">${t.platform||'—'}</span></td>
    </tr>`;
  }).join('');
}

function renderPagination() {
  const pages = Math.ceil(filteredTrades.length / pageSize);
  const pag   = document.getElementById('pagination');
  if (pages <= 1) { pag.innerHTML = ''; return; }
  let html = `<button class="page-btn" onclick="goPage(${currentPage-1})" ${currentPage===1?'disabled':''}><i class="fas fa-chevron-left"></i></button>`;
  getPageRange(currentPage, pages).forEach(p => {
    html += p === '...'
      ? `<span class="page-btn" style="cursor:default;">…</span>`
      : `<button class="page-btn ${p===currentPage?'active':''}" onclick="goPage(${p})">${p}</button>`;
  });
  html += `<button class="page-btn" onclick="goPage(${currentPage+1})" ${currentPage===pages?'disabled':''}><i class="fas fa-chevron-right"></i></button>`;
  pag.innerHTML = html;
}

function getPageRange(cur, total) {
  if (total <= 7) return Array.from({length:total},(_,i)=>i+1);
  const r = [1];
  if (cur > 3) r.push('...');
  for (let p = Math.max(2,cur-1); p <= Math.min(total-1,cur+1); p++) r.push(p);
  if (cur < total-2) r.push('...');
  r.push(total);
  return r;
}

function goPage(p) {
  const pages = Math.ceil(filteredTrades.length / pageSize);
  if (p < 1 || p > pages) return;
  currentPage = p;
  renderTable(); renderPagination();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
