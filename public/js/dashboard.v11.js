/* =============================================
   TradeArchive — Dashboard Logic v7 (Tables API)
   ============================================= */

let allTrades = [];
let equityChartInst   = null;
let weeklyChartInst   = null;
let monthlyChartInst  = null;
let symbolChartInst   = null;
let buySellChartInst  = null;
let dailyPnlChartInst = null;
let currentHeatmapYear = new Date().getFullYear();
let currentEquityRange = 'all';

// ===== 메인 초기화 (Tables API 비동기) =====
document.addEventListener('DOMContentLoaded', async () => {
  try {
    allTrades = await DB.getAll('trades');
    if (allTrades.length > 0) {
      await renderDashboard(allTrades);
    } else {
      renderEmptyState();
    }
  } catch (err) {
    console.error('Dashboard load error:', err);
    renderEmptyState();
  }
});

async function renderDashboard(trades) {
  await renderKPIs(trades);
  renderCharts(trades);
  renderRecentTrades(trades);
  setupHeatmapNav(trades);
  setupEquityFilters(trades);
  setupYearSelect(trades);
}

// ===== KPI 카드 =====
async function renderKPIs(trades) {
  if (!trades || !trades.length) { renderEmptyState(); return; }

  const stats = calcStats(trades);

  const heroNum  = document.getElementById('heroNumValue');
  const heroPlus = document.getElementById('heroPlusSign');
  const heroKrw  = document.getElementById('heroKrwValue');

  if (heroNum) {
    const absVal = Math.trunc(Math.abs(stats.total));
    heroNum.textContent = absVal.toLocaleString('en-US', { maximumFractionDigits: 0 }) + '$';
    if (heroPlus) {
      heroPlus.textContent = stats.total >= 0 ? '+' : '−';
      heroPlus.style.color = stats.total >= 0 ? '#ffd740' : '#f06060';
    }
    heroNum.style.color = stats.total >= 0 ? '#ffd740' : '#f06060';

    if (heroKrw) {
      heroKrw.textContent = '(환율 조회 중...)';
      (async () => {
        try {
          const res  = await fetch('https://open.er-api.com/v6/latest/USD');
          const data = await res.json();
          const rate = data.rates && data.rates.KRW;
          if (rate) {
            const krwVal   = stats.total * rate;
            const sign     = krwVal >= 0 ? '+' : '−';
            const formatted = Math.abs(krwVal).toLocaleString('ko-KR', { maximumFractionDigits: 0 });
            heroKrw.textContent = `(${sign} ${formatted}₩)`;
            heroKrw.title = `기준 환율: 1 USD = ₩${rate.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`;
          } else {
            heroKrw.textContent = '₩ 환율 정보 없음';
          }
        } catch {
          heroKrw.textContent = '₩ 환율 로드 실패';
        }
      })();
    }
  }

  const heroWR          = document.getElementById('heroWinRate');
  const heroTotalTrades = document.getElementById('heroTotalTrades');
  const heroReturnRate  = document.getElementById('heroReturnRate');

  // KV 서버에서 자본금 로드 (없으면 upload_history fallback)
  let initialCapital = 0;
  try {
    const kvVal = await KV.get('capital');
    initialCapital = parseFloat(kvVal) || 0;
  } catch {}
  if (!initialCapital) {
    const history = await DB.getAll('upload_history');
    const mt4hist = history
      .filter(h => (h.platform || '').toUpperCase() === 'MT4' && h.initial_balance)
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    if (mt4hist.length > 0) {
      initialCapital = parseFloat(mt4hist[0].initial_balance) || 0;
      if (initialCapital > 0) {
        try { await KV.set('capital', String(initialCapital)); } catch {}
      }
    }
  }
  const returnRate = initialCapital > 0 ? (stats.total / initialCapital) * 100 : 0;

  if (heroReturnRate) {
    heroReturnRate.textContent = initialCapital > 0
      ? (returnRate >= 0 ? '+' : '') + returnRate.toFixed(1) + '%'
      : '—';
  }
  if (heroWR)          heroWR.textContent          = fmt.percent(stats.winRate);
  if (heroTotalTrades) heroTotalTrades.textContent  = trades.length.toLocaleString();

  const now = new Date();
  const thisMonth = trades.filter(t => {
    const dt = t.close_time ? new Date(t.close_time) : null;
    return dt && dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
  });
  const monthlyProfit = thisMonth.reduce((a, t) => a + (parseFloat(t.profit) || 0), 0);

  setKpiValue('kpiTotalProfit',   fmt.currency1(stats.total),   stats.total >= 0 ? 'gain' : 'loss');
  setKpiText ('kpiTotalSub',      '');
  setKpiValue('kpiMonthlyProfit', fmt.currency1(monthlyProfit), monthlyProfit >= 0 ? 'gain' : 'loss');
  setKpiText ('kpiMonthlySub',    '');
  setKpiValue('kpiWinRate',       fmt.percent(stats.winRate));
  setKpiText ('kpiWinSub',        `${stats.wins}승 ${stats.losses}패`);
  setKpiValue('kpiTotalTrades',   trades.length.toLocaleString());
  const platforms = [...new Set(trades.map(t => t.platform).filter(Boolean))];
  setKpiText ('kpiTradesSub',     platforms.join(' · ') || '—');
  setKpiValue('kpiMDD', fmt.percent(stats.mdd), stats.mdd > 20 ? 'loss' : '');
  setKpiValue('kpiRR',  stats.profitFactor === Infinity ? '∞' : fmt.number(stats.profitFactor));
}

function setKpiValue(id, val, cls = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = val;
  el.className = 'kpi-value' + (cls ? ' ' + cls : '');
}
function setKpiText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ===== 차트 렌더링 =====
function renderCharts(trades) {
  [equityChartInst, weeklyChartInst, monthlyChartInst, symbolChartInst, buySellChartInst, dailyPnlChartInst]
    .forEach(c => c && c.destroy());
  const year = new Date().getFullYear();
  equityChartInst   = buildEquityChart('equityChart', trades);
  weeklyChartInst   = buildWeeklyChart('weeklyChart', trades, year);
  monthlyChartInst  = buildMonthlyChart('monthlyChart', trades, year);
  symbolChartInst   = buildSymbolChart('symbolChart', trades);
  buySellChartInst  = buildBuySellChart('buySellChart', trades);
  dailyPnlChartInst = buildDailyPnlChart('dailyPnlChart', trades);
  buildHeatmap('heatmapContainer', trades, currentHeatmapYear);
}

function setupYearSelect(trades) {
  const years = [...new Set(trades.map(t => {
    const dt = t.close_time ? new Date(t.close_time) : null;
    return dt && !isNaN(dt) ? dt.getFullYear() : null;
  }).filter(Boolean))].sort((a, b) => b - a);
  const yearOptions = years.length ? years : [new Date().getFullYear()];
  const optHtml = yearOptions.map(y => `<option value="${y}">${y}년</option>`).join('');
  const sel = document.getElementById('yearSelect');
  if (sel) {
    sel.innerHTML = optHtml; sel.value = yearOptions[0];
    sel.addEventListener('change', () => {
      monthlyChartInst && monthlyChartInst.destroy();
      monthlyChartInst = buildMonthlyChart('monthlyChart', trades, parseInt(sel.value));
    });
  }
  const wsel = document.getElementById('weekYearSelect');
  if (wsel) {
    wsel.innerHTML = optHtml; wsel.value = yearOptions[0];
    wsel.addEventListener('change', () => {
      weeklyChartInst && weeklyChartInst.destroy();
      weeklyChartInst = buildWeeklyChart('weeklyChart', trades, parseInt(wsel.value));
    });
  }
}

function setupEquityFilters(trades) {
  document.querySelectorAll('.filter-btn[data-range]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn[data-range]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentEquityRange = btn.dataset.range;
      const filtered = filterByRange(trades, currentEquityRange);
      equityChartInst && equityChartInst.destroy();
      equityChartInst = buildEquityChart('equityChart', filtered);
    });
  });
}

function filterByRange(trades, range) {
  if (range === 'all') return trades;
  const now = new Date(); const from = new Date(now);
  if      (range === '1m') from.setMonth(from.getMonth() - 1);
  else if (range === '3m') from.setMonth(from.getMonth() - 3);
  else if (range === '6m') from.setMonth(from.getMonth() - 6);
  else if (range === '1y') from.setFullYear(from.getFullYear() - 1);
  return trades.filter(t => t.close_time && new Date(t.close_time) >= from);
}

function setupHeatmapNav(trades) {
  const years = [...new Set(trades.map(t => {
    const dt = t.close_time ? new Date(t.close_time) : null;
    return dt && !isNaN(dt) ? dt.getFullYear() : null;
  }).filter(Boolean))].sort();
  if (years.length > 0) currentHeatmapYear = years[years.length - 1];
  buildHeatmap('heatmapContainer', trades, currentHeatmapYear);
  const prevBtn = document.getElementById('heatmapPrev');
  const nextBtn = document.getElementById('heatmapNext');
  if (prevBtn) prevBtn.addEventListener('click', () => { currentHeatmapYear--; buildHeatmap('heatmapContainer', trades, currentHeatmapYear); });
  if (nextBtn) nextBtn.addEventListener('click', () => { currentHeatmapYear++; buildHeatmap('heatmapContainer', trades, currentHeatmapYear); });
}

function renderRecentTrades(trades) {
  const tbody = document.getElementById('recentTradesTbody');
  if (!tbody) return;
  const sorted = [...trades].sort((a, b) => new Date(b.close_time || 0) - new Date(a.close_time || 0)).slice(0, 10);
  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-msg"><i class="fas fa-database"></i> 거래 데이터가 없습니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = sorted.map(t => {
    const p = parseFloat(t.profit) || 0;
    return `<tr>
      <td style="font-weight:600;color:var(--text-primary);">${t.symbol || '—'}</td>
      <td><span class="type-badge ${t.type}">${(t.type || '').toUpperCase() || '—'}</span></td>
      <td>${fmt.lots(t.lots)}</td>
      <td>${t.open_price  || '—'}</td>
      <td>${t.close_price || '—'}</td>
      <td>${fmt.datetime(t.open_time)}</td>
      <td>${fmt.datetime(t.close_time)}</td>
      <td class="profit-cell ${profitClass(p)}">${fmt.currency(p)}</td>
      <td><span class="platform-badge ${(t.platform || '').toLowerCase()}">${t.platform || '—'}</span></td>
    </tr>`;
  }).join('');
}

function renderEmptyState() {
  const kpis = ['kpiTotalProfit','kpiMonthlyProfit','kpiWinRate','kpiTotalTrades','kpiMDD','kpiRR'];
  const defaults = ['$0.00','$0.00','0%','0','0%','0.00'];
  kpis.forEach((id, i) => { const el = document.getElementById(id); if (el) el.textContent = defaults[i]; });
  const heroNum  = document.getElementById('heroNumValue');
  const heroPlus = document.getElementById('heroPlusSign');
  const heroKrw  = document.getElementById('heroKrwValue');
  const heroWR   = document.getElementById('heroWinRate');
  const heroTT   = document.getElementById('heroTotalTrades');
  const heroRR   = document.getElementById('heroReturnRate');
  if (heroNum)  heroNum.textContent  = '0$';
  if (heroPlus) heroPlus.textContent = '+';
  if (heroKrw)  heroKrw.textContent  = '(+ 0₩)';
  if (heroWR)   heroWR.textContent   = '—';
  if (heroTT)   heroTT.textContent   = '0';
  if (heroRR)   heroRR.textContent   = '—';
  const tbody = document.getElementById('recentTradesTbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="empty-msg"><i class="fas fa-database"></i> 거래 데이터가 없습니다. <a href="admin.html" style="color:var(--green);margin-left:8px;">관리자 페이지에서 업로드하세요 →</a></td></tr>`;
  buildHeatmap('heatmapContainer', [], currentHeatmapYear);
}
