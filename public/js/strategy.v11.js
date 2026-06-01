/* TradeArchive — Strategy Page v7 (Tables API)
   전략1: EA 매매 → platform === 'MT4'
   전략2: 브레이크아웃 → platform === 'MT5'
*/

document.addEventListener('DOMContentLoaded', async () => {
  const all = await DB.getAll('trades');
  const mt4 = all.filter(t => (t.platform || '').toUpperCase() === 'MT4');
  const mt5 = all.filter(t => (t.platform || '').toUpperCase() === 'MT5');
  renderStrategy('ea', mt4, { color: '#f5c400', colorDim: 'rgba(245,196,0,0.7)',  chartId: 'eaMonthly', symId: 'eaSymbol' });
  renderStrategy('bo', mt5, { color: '#5ba8e0', colorDim: 'rgba(91,168,224,0.7)', chartId: 'boMonthly', symId: 'boSymbol' });
});

function renderStrategy(key, trades, cfg) {
  const el = document.getElementById(key + '-content');
  if (!el) return;
  if (trades.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i><p>아직 업로드된 데이터가 없습니다.<br><a href="admin.html">관리자 패널</a>에서 파일을 업로드하면<br>자동으로 반영됩니다.</p></div>`;
    return;
  }
  const s = calcStats(trades);
  const weeklyAvgTrades = (() => {
    const dated = trades.filter(t => t.close_time);
    if (dated.length === 0) return '—';
    const times = dated.map(t => new Date(t.close_time).getTime()).filter(t => !isNaN(t));
    if (times.length === 0) return '—';
    const minT = Math.min(...times), maxT = Math.max(...times);
    const weeks = Math.max(1, (maxT - minT) / (7 * 24 * 3600 * 1000));
    return (dated.length / weeks).toFixed(1) + '건';
  })();
  const kpis = [
    { label:'누적 수익',      val: fmt.currency(s.total),                                         cls: s.total >= 0 ? 'pos' : 'neg' },
    { label:'승률',           val: s.winRate.toFixed(1) + '%',                                    cls: s.winRate >= 50 ? 'pos' : 'neg' },
    { label:'총 거래수',      val: trades.length + '건',                                          cls: '' },
    { label:'손익비 (PF)',    val: isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞',    cls: s.profitFactor >= 1 ? 'pos' : 'neg' },
    { label:'주당 평균 거래', val: weeklyAvgTrades,                                               cls: '' },
    { label:'평균 수익',      val: fmt.currency((s.total / trades.length)),                       cls: s.total >= 0 ? 'pos' : 'neg' },
  ];
  const kpiHtml = `<div class="kpi-mini-grid">${kpis.map(k=>`<div class="kpi-mini"><div class="kpi-mini-label">${k.label}</div><div class="kpi-mini-val ${k.cls}">${k.val}</div></div>`).join('')}</div>`;
  const monthlyHtml = `<div class="s-chart-wrap"><div class="s-chart-title"><i class="fas fa-chart-bar" style="margin-right:6px;"></i>월별 손익</div><div style="height:180px;"><canvas id="${cfg.chartId}"></canvas></div></div>`;
  const symRows = buildSymbolRows(trades);
  const symHtml = `<div class="s-chart-wrap"><div class="s-chart-title"><i class="fas fa-coins" style="margin-right:6px;"></i>심볼별 성과</div><div class="table-wrapper" style="max-height:220px;overflow-y:auto;"><table class="s-symbol-table"><thead><tr><th>심볼</th><th>거래수</th><th>승률</th><th>총 수익</th><th>평균</th></tr></thead><tbody id="${cfg.symId}">${symRows.map(r=>`<tr><td class="sym-name">${r.sym}</td><td>${r.cnt}건</td><td class="${parseFloat(r.wr)>=50?'pos':'neg'}">${r.wr}%</td><td class="${r.total>=0?'pos':'neg'}">${fmt.currency(r.total)}</td><td class="${r.avg>=0?'pos':'neg'}">${fmt.currency(r.avg)}</td></tr>`).join('')}</tbody></table></div></div>`;
  el.innerHTML = kpiHtml + monthlyHtml + symHtml;
  renderMonthlyChart(cfg.chartId, trades, cfg.color);
}

function renderMonthlyChart(canvasId, trades, accentColor) {
  const year = new Date().getFullYear();
  const map  = {};
  for (let m = 1; m <= 12; m++) map[m] = 0;
  trades.forEach(t => {
    if (!t.close_time) return;
    const d = new Date(t.close_time);
    if (isNaN(d) || d.getFullYear() !== year) return;
    map[d.getMonth() + 1] += parseFloat(t.profit) || 0;
  });
  const labels = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const vals   = Object.values(map);
  const colors = vals.map(v => v >= 0 ? 'rgba(61,214,140,0.75)' : 'rgba(240,96,96,0.75)');
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data: vals.map(v=>Math.abs(v)), realValues: vals, backgroundColor: colors, borderRadius: 4, borderSkipped: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend:{ display:false }, tooltip:{ callbacks:{ label:(ctx)=>{ const real=ctx.dataset.realValues?.[ctx.dataIndex]??ctx.raw; return ' '+(real>=0?'+':'')+' $'+real.toFixed(2); } } } },
      scales: { x:{ grid:{ color:'rgba(255,255,255,0.04)' }, ticks:{ color:'#8a9aaa', font:{ size:10 } } }, y:{ grid:{ color:'rgba(255,255,255,0.04)' }, ticks:{ color:'#8a9aaa', font:{ size:10 } } } }
    }
  });
}

function buildSymbolRows(trades) {
  const map = {};
  trades.forEach(t => { if (!t.symbol) return; if (!map[t.symbol]) map[t.symbol]=[]; map[t.symbol].push(t); });
  return Object.entries(map).map(([sym,ts]) => {
    const profits = ts.map(t=>parseFloat(t.profit)||0);
    const total   = profits.reduce((a,b)=>a+b,0);
    const wins    = profits.filter(p=>p>0).length;
    return { sym, cnt:ts.length, wr:((wins/ts.length)*100).toFixed(1), total, avg:total/ts.length };
  }).sort((a,b)=>b.total-a.total);
}
