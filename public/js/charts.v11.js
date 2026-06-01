/* =============================================
   TradeArchive — Chart.js Global Config & Builders
   ============================================= */

// ===== CHART.JS 전역 기본값 =====
Chart.defaults.color = '#8a9aaa';
Chart.defaults.borderColor = 'rgba(255,255,255,0.07)';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.plugins.tooltip.backgroundColor = '#1e2d3a';
Chart.defaults.plugins.tooltip.borderColor = 'rgba(255,255,255,0.1)';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.titleColor = '#f0ede8';
Chart.defaults.plugins.tooltip.bodyColor = '#8a9aaa';
Chart.defaults.plugins.legend.labels.color = '#8a9aaa';
Chart.defaults.plugins.legend.labels.padding = 16;
Chart.defaults.plugins.legend.labels.usePointStyle = true;

const COLORS = {
  yellow: '#f5c400',
  green:  '#3dd68c',
  red:    '#f06060',
  blue:   '#5ba8e0',
  purple: '#a78bfa',
  orange: '#f5a623',
  teal:   '#22d3ee',
  yellowAlpha:(a) => `rgba(245,196,0,${a})`,
  greenAlpha: (a) => `rgba(61,214,140,${a})`,
  redAlpha:   (a) => `rgba(240,96,96,${a})`,
  blueAlpha:  (a) => `rgba(91,168,224,${a})`,
};

const MONTHS_KO = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
const WEEKDAYS_KO = ['월','화','수','목','금','토','일'];

// ===== 공통 그리드 옵션 =====
function gridOpts(alpha = 0.3) {
  return {
    color: `rgba(255,255,255,${alpha * 0.08})`,  
    drawBorder: false
  };
}

// ===== 1. EQUITY CURVE CHART =====
function buildEquityChart(canvasId, trades) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  // 날짜순 정렬 → 누적 합계
  const sorted = [...trades].sort((a,b) => new Date(a.close_time) - new Date(b.close_time));
  let cumulative = 0;
  const points = sorted.map(t => {
    cumulative += parseFloat(t.profit) || 0;
    return { x: t.close_time ? new Date(t.close_time).toLocaleDateString('ko-KR') : '', y: cumulative };
  });

  const values = points.map(p => p.y);
  const maxVal = Math.max(...values, 0);
  const minVal = Math.min(...values, 0);
  const lastVal = values.length > 0 ? values[values.length - 1] : 0;
  const isProfit = lastVal >= 0;

  // 그라디언트
  const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 320);
  if (isProfit) {
    gradient.addColorStop(0, 'rgba(245,196,0,0.28)');
    gradient.addColorStop(1, 'rgba(245,196,0,0.0)');
  } else {
    gradient.addColorStop(0, 'rgba(240,96,96,0.28)');
    gradient.addColorStop(1, 'rgba(240,96,96,0.0)');
  }

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: points.map(p => p.x),
      datasets: [{
        label: '누적 수익 ($)',
        data: values,
        borderColor: isProfit ? COLORS.yellow : COLORS.red,
        backgroundColor: gradient,
        borderWidth: 2,
        pointRadius: points.length > 100 ? 0 : 3,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ' 누적: ' + fmt.currency(ctx.parsed.y),
          }
        }
      },
      scales: {
        x: {
          grid: gridOpts(0.2),
          ticks: { maxTicksLimit: 10, maxRotation: 0, font: { size: 11 } }
        },
        y: {
          grid: gridOpts(),
          ticks: {
            callback: v => fmt.currencyAbs(v),
            color: v => v.tick.value >= 0 ? COLORS.green : COLORS.red
          }
        }
      }
    }
  });
}

// ===== 2. MONTHLY BAR CHART =====
function buildMonthlyChart(canvasId, trades, year) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const filtered = year
    ? trades.filter(t => t.close_time && new Date(t.close_time).getFullYear() === parseInt(year))
    : trades;

  const monthly = new Array(12).fill(0);
  filtered.forEach(t => {
    const dt = t.close_time ? new Date(t.close_time) : null;
    if (dt && !isNaN(dt)) monthly[dt.getMonth()] += parseFloat(t.profit) || 0;
  });

  // 실제값(원래 부호)은 색상/툴팁 판단용으로 보관, 막대 높이는 절대값
  const realValues = monthly.slice();

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: MONTHS_KO,
      datasets: [{
        label: '월별 수익 ($)',
        data: realValues.map(v => Math.abs(v)),                 // 세로축 = 절대값
        realValues,                                             // 부호 보관(툴팁용)
        backgroundColor: realValues.map(v => v >= 0 ? COLORS.greenAlpha(0.65) : COLORS.redAlpha(0.65)),
        borderColor: realValues.map(v => v >= 0 ? COLORS.green : COLORS.red),
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            // 툴팁은 실제 부호값 표시 (수익/손실 그대로)
            label: ctx => ' ' + fmt.currency(ctx.dataset.realValues[ctx.dataIndex])
          }
        }
      },
      scales: {
        x: { grid: gridOpts(0.15), ticks: { font: { size: 11 } } },
        y: {
          grid: gridOpts(),
          ticks: { callback: v => fmt.currencyAbs(v) }
        }
      }
    }
  });
}

// ===== 2-1. WEEKLY BAR CHART =====
// 주의 시작(월요일)을 반환
function weekStart(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNum = (d.getDay() + 6) % 7;  // 월=0 ... 일=6
  d.setDate(d.getDate() - dayNum);
  return d;
}
// "5월 4주" 형태 라벨 — 그 주의 수요일이 속한 달 + 그 달의 몇 번째 수요일
// 수요일이 해당 달에 포함되어야 그 달 주차로 인정하는 규칙
function weekLabel(monday) {
  const wed = new Date(monday);
  wed.setDate(wed.getDate() + 2);          // 그 주의 수요일

  const year    = wed.getFullYear();
  const month   = wed.getMonth();          // 0-based
  const wedDate = wed.getDate();

  // 해당 달 1일의 요일 (0=일, 3=수)
  const firstDow = new Date(year, month, 1).getDay();
  // 그 달의 첫 번째 수요일 날짜
  const firstWed = 1 + ((3 - firstDow + 7) % 7);
  // 주차 = (수요일 날짜 - 첫번째 수요일) / 7 + 1
  const weekNum = Math.floor((wedDate - firstWed) / 7) + 1;

  return `${month + 1}월 ${weekNum}주`;
}

function buildWeeklyChart(canvasId, trades, year) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const filtered = year
    ? trades.filter(t => t.close_time && new Date(t.close_time).getFullYear() === parseInt(year))
    : trades;

  // 주 시작일(월요일) 기준 합산
  const weekMap = {};
  filtered.forEach(t => {
    const dt = t.close_time ? new Date(t.close_time) : null;
    if (!dt || isNaN(dt)) return;
    const ms = weekStart(dt).getTime();
    weekMap[ms] = (weekMap[ms] || 0) + (parseFloat(t.profit) || 0);
  });

  const weeks  = Object.keys(weekMap).map(Number).sort((a, b) => a - b);
  const labels = weeks.map(ms => weekLabel(new Date(ms)));
  const data   = weeks.map(ms => weekMap[ms]);

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '주별 수익 ($)',
        data,
        backgroundColor: data.map(v => v >= 0 ? COLORS.greenAlpha(0.65) : COLORS.redAlpha(0.65)),
        borderColor: data.map(v => v >= 0 ? COLORS.green : COLORS.red),
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + fmt.currency(ctx.parsed.y) } }
      },
      scales: {
        x: { grid: gridOpts(0.15), ticks: { maxTicksLimit: 26, font: { size: 10 } } },
        y: { grid: gridOpts(), ticks: { callback: v => fmt.currencyAbs(v) } }
      }
    }
  });
}

// ===== 3. SYMBOL DONUT CHART =====
function buildSymbolChart(canvasId, trades) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const symbolMap = {};
  trades.forEach(t => {
    const s = t.symbol || 'UNKNOWN';
    if (!symbolMap[s]) symbolMap[s] = { profit: 0, count: 0 };
    symbolMap[s].profit += parseFloat(t.profit) || 0;
    symbolMap[s].count++;
  });

  const top = Object.entries(symbolMap)
    .sort((a,b) => Math.abs(b[1].profit) - Math.abs(a[1].profit))
    .slice(0, 8);

  const palette = [COLORS.yellow, COLORS.blue, COLORS.purple, COLORS.orange,
                   COLORS.teal, COLORS.green, '#fb923c', '#f472b6'];

  return new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: top.map(([s]) => s),
      datasets: [{
        data: top.map(([,v]) => Math.abs(v.profit).toFixed(2)),
        backgroundColor: palette.map(c => c + 'cc'),
        borderColor: palette,
        borderWidth: 1.5,
        hoverOffset: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { font: { size: 11 }, padding: 10 } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${fmt.currencyAbs(ctx.parsed)}`
          }
        }
      },
      cutout: '62%',
    }
  });
}

// ===== 4. BUY vs SELL DONUT =====
function buildBuySellChart(canvasId, trades) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const buys  = trades.filter(t => t.type === 'buy').length;
  const sells = trades.filter(t => t.type === 'sell').length;

  return new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Buy (Long)', 'Sell (Short)'],
      datasets: [{
        data: [buys, sells],
        backgroundColor: [COLORS.greenAlpha(0.8), COLORS.redAlpha(0.8)],
        borderColor: [COLORS.green, COLORS.red],
        borderWidth: 1.5,
        hoverOffset: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}건` } }
      },
      cutout: '62%',
    }
  });
}

// ===== 5. DAILY P&L BAR CHART =====
function buildDailyPnlChart(canvasId, trades, limit = 60) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const daily = groupByDate(trades);
  const sorted = Object.entries(daily).sort((a,b) => a[0].localeCompare(b[0])).slice(-limit);

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(([d]) => d.slice(5)), // MM-DD
      datasets: [{
        label: '일별 P&L ($)',
        data: sorted.map(([,v]) => v.toFixed(2)),
        backgroundColor: sorted.map(([,v]) => v >= 0 ? COLORS.greenAlpha(0.7) : COLORS.redAlpha(0.7)),
        borderColor: sorted.map(([,v]) => v >= 0 ? COLORS.green : COLORS.red),
        borderWidth: 1,
        borderRadius: 3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + fmt.currency(ctx.parsed.y) } }
      },
      scales: {
        x: { grid: gridOpts(0.1), ticks: { maxTicksLimit: 15, font: { size: 10 } } },
        y: { grid: gridOpts(), ticks: { callback: v => fmt.currencyAbs(v) } }
      }
    }
  });
}

// ===== 6. WEEKDAY CHART =====
function buildWeekdayChart(canvasId, trades) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const weekData = Array(7).fill(0);
  const weekCount = Array(7).fill(0);
  trades.forEach(t => {
    const dt = t.close_time ? new Date(t.close_time) : null;
    if (!dt || isNaN(dt)) return;
    let dow = dt.getDay(); // 0=Sun
    dow = dow === 0 ? 6 : dow - 1; // 0=Mon
    weekData[dow] += parseFloat(t.profit) || 0;
    weekCount[dow]++;
  });
  const avgWeek = weekData.map((v,i) => weekCount[i] > 0 ? v / weekCount[i] : 0);

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: WEEKDAYS_KO,
      datasets: [{
        label: '평균 수익 ($)',
        data: avgWeek.map(v => v.toFixed(2)),
        backgroundColor: avgWeek.map(v => v >= 0 ? COLORS.greenAlpha(0.7) : COLORS.redAlpha(0.7)),
        borderColor: avgWeek.map(v => v >= 0 ? COLORS.green : COLORS.red),
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmt.currency(ctx.parsed.y) } } },
      scales: {
        x: { grid: gridOpts(0.1) },
        y: { grid: gridOpts(), ticks: { callback: v => fmt.currencyAbs(v) } }
      }
    }
  });
}

// ===== 7. HOURLY CHART =====
function buildHourlyChart(canvasId, trades) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const hourData  = Array(24).fill(0);
  const hourCount = Array(24).fill(0);
  trades.forEach(t => {
    const dt = t.close_time ? new Date(t.close_time) : null;
    if (!dt || isNaN(dt)) return;
    const h = dt.getHours();
    hourData[h]  += parseFloat(t.profit) || 0;
    hourCount[h]++;
  });
  const avgHour = hourData.map((v,i) => hourCount[i] > 0 ? v / hourCount[i] : 0);

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Array.from({length:24}, (_,i) => i + 'h'),
      datasets: [{
        label: '평균 수익 ($)',
        data: avgHour.map(v => v.toFixed(2)),
        backgroundColor: avgHour.map(v => v >= 0 ? COLORS.blueAlpha(0.7) : COLORS.redAlpha(0.5)),
        borderColor: avgHour.map(v => v >= 0 ? COLORS.blue : COLORS.red),
        borderWidth: 1,
        borderRadius: 3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmt.currency(ctx.parsed.y) } } },
      scales: {
        x: { grid: gridOpts(0.1), ticks: { maxTicksLimit: 12, font: { size: 10 } } },
        y: { grid: gridOpts(), ticks: { callback: v => fmt.currencyAbs(v) } }
      }
    }
  });
}

// ===== 8. DURATION HISTOGRAM =====
function buildDurationChart(canvasId, trades) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const buckets = ['<5분','5~30분','30분~2h','2~8h','8~24h','1~3일','3일+'];
  const counts  = new Array(7).fill(0);

  trades.forEach(t => {
    if (!t.open_time || !t.close_time) return;
    const ms = new Date(t.close_time) - new Date(t.open_time);
    const min = ms / 60000;
    if (min < 5) counts[0]++;
    else if (min < 30) counts[1]++;
    else if (min < 120) counts[2]++;
    else if (min < 480) counts[3]++;
    else if (min < 1440) counts[4]++;
    else if (min < 4320) counts[5]++;
    else counts[6]++;
  });

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: buckets,
      datasets: [{
        label: '거래 수',
        data: counts,
        backgroundColor: COLORS.blueAlpha(0.7),
        borderColor: COLORS.blue,
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: gridOpts(0.1) },
        y: { grid: gridOpts(), ticks: { precision: 0 } }
      }
    }
  });
}

// ===== 9. PROFIT DISTRIBUTION HISTOGRAM =====
function buildProfitDistChart(canvasId, trades) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const profits = trades.map(t => parseFloat(t.profit) || 0).filter(p => p !== 0);
  if (profits.length === 0) return null;

  const min = Math.min(...profits);
  const max = Math.max(...profits);
  const binCount = 16;
  const binSize = (max - min) / binCount || 1;

  const bins = Array.from({length: binCount}, (_, i) => ({
    label: `${(min + i * binSize).toFixed(0)}`,
    min: min + i * binSize,
    max: min + (i+1) * binSize,
    count: 0
  }));

  profits.forEach(p => {
    const idx = Math.min(Math.floor((p - min) / binSize), binCount - 1);
    if (idx >= 0) bins[idx].count++;
  });

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: bins.map(b => b.label),
      datasets: [{
        label: '거래 빈도',
        data: bins.map(b => b.count),
        backgroundColor: bins.map(b => b.min >= 0 ? COLORS.greenAlpha(0.7) : COLORS.redAlpha(0.7)),
        borderColor: bins.map(b => b.min >= 0 ? COLORS.green : COLORS.red),
        borderWidth: 1,
        borderRadius: 2,
        barPercentage: 1.0,
        categoryPercentage: 0.95,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 10 } } },
        y: { grid: gridOpts(), ticks: { precision: 0 } }
      }
    }
  });
}

// ===== 10. DRAWDOWN CHART =====
function buildDrawdownChart(canvasId, trades) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const sorted = [...trades].sort((a,b) => new Date(a.close_time) - new Date(b.close_time));
  let peak = 0, equity = 0;
  const ddPoints = [];
  const dateLabels = [];

  sorted.forEach(t => {
    equity += parseFloat(t.profit) || 0;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    ddPoints.push(-dd.toFixed(2));
    dateLabels.push(t.close_time ? new Date(t.close_time).toLocaleDateString('ko-KR') : '');
  });

  const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, 'rgba(255,77,106,0.4)');
  gradient.addColorStop(1, 'rgba(255,77,106,0.0)');

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: dateLabels,
      datasets: [{
        label: '드로우다운 (%)',
        data: ddPoints,
        borderColor: COLORS.red,
        backgroundColor: gradient,
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        tension: 0.2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` DD: ${Math.abs(ctx.parsed.y).toFixed(2)}%` } }
      },
      scales: {
        x: { grid: gridOpts(0.1), ticks: { maxTicksLimit: 10, font: { size: 11 } } },
        y: {
          grid: gridOpts(),
          ticks: { callback: v => Math.abs(v).toFixed(1) + '%' }
        }
      }
    }
  });
}

// ===== HEATMAP BUILDER =====
function buildHeatmap(containerId, trades, year) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const daily = groupByDate(trades.filter(t =>
    t.close_time && new Date(t.close_time).getFullYear() === parseInt(year)
  ));

  const values = Object.values(daily).filter(v => v !== 0);
  const maxAbsVal = values.length > 0 ? Math.max(...values.map(Math.abs)) : 1;

  document.getElementById('heatmapYearLabel').textContent = year + '년';

  const months = [];
  for (let m = 0; m < 12; m++) {
    const daysInMonth = new Date(year, m + 1, 0).getDate();
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const val = daily[key];
      days.push({ key, val: val !== undefined ? val : null });
    }
    months.push({ month: m, days });
  }

  container.innerHTML = months.map(({ month, days }) => {
    const daysHtml = days.map(({ key, val }) => {
      let cls = 'no-data';
      let title = key;
      if (val !== null) {
        const ratio = Math.abs(val) / maxAbsVal;
        const level = ratio < 0.1 ? 'xs' : ratio < 0.3 ? 'sm' : ratio < 0.6 ? 'md' : ratio < 0.85 ? 'lg' : 'xl';
        cls = (val >= 0 ? 'profit' : 'loss') + '-' + level;
        title = `${key}: ${fmt.currency(val)}`;
      }
      return `<div class="heatmap-day ${cls}" title="${title}"></div>`;
    }).join('');

    return `<div class="heatmap-month">
      <div class="heatmap-month-label">${MONTHS_KO[month]}</div>
      ${daysHtml}
    </div>`;
  }).join('');
}
