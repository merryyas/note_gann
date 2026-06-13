/* ═══════════════════════════════════════════════════════════════
   TradeArchive — EA Strategy Simulator v2
   실거래 M1 데이터 기반 바스켓 시뮬레이터

   아키텍처:
   - DB에서 실거래 trades 로드 → M1 가격 시계열 재구성
   - 바스켓(Basket) 단위 진입/추가진입/청산 규칙 엔진
   - 파라미터 스윕(그리드 탐색) 지원
   - 에쿼티 커브, 드로다운 차트
   - 청산 바스켓 drill-down 테이블
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ── 계약 상수 (XAUUSD 기준) ──────────────────────────────────
const CONTRACT = {
  pointValue    : 0.01,    // 1 포인트 = $0.01 × lot × 100
  lotMultiplier : 100,     // 1 lot = 100 oz
  priceDigits   : 2,       // 소수점
};
// 1 lot, 1 point(0.01) PnL = 0.01 * 100 = $1.00
function calcPnL(direction, entryPrice, exitPrice, lot) {
  const diff = direction === 'buy' ? exitPrice - entryPrice : entryPrice - exitPrice;
  return diff * CONTRACT.lotMultiplier * lot;
}

// ── 상태 토글 관리 ─────────────────────────────────────────────
const TOGGLES = { buy: true, sell: true, sess1: true, sess2: true };
function toggleParam(key) {
  TOGGLES[key] = !TOGGLES[key];
  const btn = document.getElementById('toggle' + key.charAt(0).toUpperCase() + key.slice(1));
  if (!btn) return;
  const btns = btn.parentElement.querySelectorAll('button');
  btns[0].classList.toggle('on', TOGGLES[key]);
  btns[1].classList.toggle('on', !TOGGLES[key]);
}

// ── 요일 필터 ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.wd-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('on'));
  });
  initDateRange();
});

function getEnabledWeekdays() {
  const days = new Set();
  document.querySelectorAll('.wd-btn.on').forEach(b => days.add(parseInt(b.dataset.day)));
  return days;
}

// ── 날짜 범위 초기화 (DB 데이터 기준) ────────────────────────
async function initDateRange() {
  try {
    const all = await DB.getAll('trades');
    if (!all.length) return;
    const times = all.map(t => t.close_time ? new Date(t.close_time).getTime() : 0).filter(t => t > 0);
    if (!times.length) return;
    const minD = new Date(Math.min(...times));
    const maxD = new Date(Math.max(...times));
    document.getElementById('paramStartDate').value = minD.toISOString().slice(0, 10);
    document.getElementById('paramEndDate').value   = maxD.toISOString().slice(0, 10);
  } catch (e) { console.warn('날짜 초기화 실패:', e); }
}

// ── 탭 전환 ──────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.sim-tab').forEach((t, i) => {
    const panes = ['baskets', 'drill', 'sweep'];
    t.classList.toggle('active', panes[i] === name);
  });
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === 'tab' + name.charAt(0).toUpperCase() + name.slice(1));
  });
}

// ══════════════════════════════════════════════════════════════
//  파라미터 수집
// ══════════════════════════════════════════════════════════════
function getParams() {
  return {
    startDate      : document.getElementById('paramStartDate').value,
    endDate        : document.getElementById('paramEndDate').value,
    allowBuy       : TOGGLES.buy,
    allowSell      : TOGGLES.sell,
    startLot       : parseFloat(document.getElementById('paramStartLot').value)   || 0.01,
    lotMultiplier  : parseFloat(document.getElementById('paramLotMult').value)    || 1.22,
    addInterval    : parseFloat(document.getElementById('paramAddInterval').value) || 600,
    maxPositions   : parseInt(document.getElementById('paramMaxPos').value)        || 5,
    tpPoints       : parseFloat(document.getElementById('paramTpPts').value)       || 220,
    slUsd          : parseFloat(document.getElementById('paramSlUsd').value)       || 130,
    dailyMaxLoss   : parseFloat(document.getElementById('paramDailyLoss').value)   || 150,
    cooldownSec    : parseInt(document.getElementById('paramCooldown').value)      || 600,
    reentrySec     : parseInt(document.getElementById('paramReentry').value)       || 60,
    sess1Enabled   : TOGGLES.sess1,
    sess1Start     : document.getElementById('sess1Start').value || '11:00',
    sess1End       : document.getElementById('sess1End').value   || '15:30',
    sess2Enabled   : TOGGLES.sess2,
    sess2Start     : document.getElementById('sess2Start').value || '18:30',
    sess2End       : document.getElementById('sess2End').value   || '19:30',
    enabledWeekdays: getEnabledWeekdays(),
  };
}

// ══════════════════════════════════════════════════════════════
//  데이터 로더 — 실거래 trades → M1 시계열 재구성
//  MT4/MT5 close_time 기준으로 분 단위 가격 맵 생성
// ══════════════════════════════════════════════════════════════
function buildPriceTimeline(trades, startDate, endDate) {
  // close_time 기준으로 분 단위 Map 생성 { "YYYY-MM-DDTHH:MM": price }
  const map = new Map();
  const sTs = startDate ? new Date(startDate).getTime() : 0;
  const eTs = endDate   ? new Date(endDate + 'T23:59:59').getTime() : Infinity;

  trades.forEach(t => {
    if (!t.close_time || !t.close_price) return;
    const d = new Date(t.close_time);
    if (isNaN(d) || d.getTime() < sTs || d.getTime() > eTs) return;
    const key = d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
    const price = parseFloat(t.close_price);
    if (!isNaN(price) && price > 0) {
      // 같은 분에 여러 체결이면 마지막 값으로
      map.set(key, { time: d, price });
    }
  });

  // open_time + open_price도 추가 (더 많은 캔들 포인트 확보)
  trades.forEach(t => {
    if (!t.open_time || !t.open_price) return;
    const d = new Date(t.open_time);
    if (isNaN(d) || d.getTime() < sTs || d.getTime() > eTs) return;
    const key = d.toISOString().slice(0, 16);
    if (!map.has(key)) {
      const price = parseFloat(t.open_price);
      if (!isNaN(price) && price > 0) map.set(key, { time: d, price });
    }
  });

  // 시간 순 정렬
  return [...map.values()].sort((a, b) => a.time - b.time);
}

// ══════════════════════════════════════════════════════════════
//  세션 필터
// ══════════════════════════════════════════════════════════════
function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function isInSession(date, params) {
  const dow = date.getDay(); // 0=일,1=월...6=토
  if (!params.enabledWeekdays.has(dow)) return false;

  const totalMin = date.getUTCHours() * 60 + date.getUTCMinutes();
  // KST 오프셋 보정 (+6h = MT4 서버 → KST 근사)
  const kstMin = (totalMin + 360) % 1440;

  if (params.sess1Enabled) {
    const s1s = timeToMinutes(params.sess1Start);
    const s1e = timeToMinutes(params.sess1End);
    if (kstMin >= s1s && kstMin < s1e) return true;
  }
  if (params.sess2Enabled) {
    const s2s = timeToMinutes(params.sess2Start);
    const s2e = timeToMinutes(params.sess2End);
    if (kstMin >= s2s && kstMin < s2e) return true;
  }
  return false;
}

// ══════════════════════════════════════════════════════════════
//  바스켓 클래스
// ══════════════════════════════════════════════════════════════
class Position {
  constructor(seqNo, entryTime, entryPrice, lot, direction) {
    this.seqNo      = seqNo;
    this.entryTime  = entryTime;
    this.entryPrice = entryPrice;
    this.lot        = lot;
    this.direction  = direction;
  }
}

class Basket {
  constructor(id, direction, openedAt, firstPrice, firstLot) {
    this.id             = id;
    this.direction      = direction;
    this.isOpen         = true;
    this.openedAt       = openedAt;
    this.lastEntryTime  = openedAt;
    this.lastEntryPrice = firstPrice;
    this.positions      = [new Position(1, openedAt, firstPrice, firstLot, direction)];
    this.totalLot       = firstLot;
    this.avgEntryPrice  = firstPrice;
    this.unrealizedPnl  = 0;
    this.realizedPnl    = 0;
    this.maxAdverse     = 0; // MAE
    this.closedAt       = null;
    this.closePrice     = null;
    this.closeReason    = null;
  }

  // 평균 단가 재계산 (가중평균)
  recalcAvg() {
    const sumLot   = this.positions.reduce((a, p) => a + p.lot, 0);
    const sumValue = this.positions.reduce((a, p) => a + p.entryPrice * p.lot, 0);
    this.totalLot       = sumLot;
    this.avgEntryPrice  = sumLot > 0 ? sumValue / sumLot : 0;
  }

  // 미실현 손익 + MAE 업데이트
  updatePnl(currentPrice) {
    this.unrealizedPnl = calcPnL(this.direction, this.avgEntryPrice, currentPrice, this.totalLot);
    if (this.unrealizedPnl < this.maxAdverse) this.maxAdverse = this.unrealizedPnl;
  }

  // 추가 포지션
  addPosition(time, price, lot) {
    this.positions.push(new Position(this.positions.length + 1, time, price, lot, this.direction));
    this.lastEntryTime  = time;
    this.lastEntryPrice = price;
    this.recalcAvg();
  }

  // 청산
  close(time, price, reason) {
    this.isOpen      = false;
    this.closedAt    = time;
    this.closePrice  = price;
    this.closeReason = reason;
    this.realizedPnl = calcPnL(this.direction, this.avgEntryPrice, price, this.totalLot);
    this.unrealizedPnl = 0;
  }
}

// ══════════════════════════════════════════════════════════════
//  랏 계산
// ══════════════════════════════════════════════════════════════
function calcLot(startLot, multiplier, addCount) {
  const lot = startLot * Math.pow(multiplier, addCount);
  return Math.round(lot * 100) / 100; // 소수점 2자리 반올림
}

// ══════════════════════════════════════════════════════════════
//  메인 시뮬레이터
// ══════════════════════════════════════════════════════════════
function runEngine(timeline, params) {
  const baskets = [];
  let buyBasket  = null;
  let sellBasket = null;
  let buyCooldownUntil  = 0;
  let sellCooldownUntil = 0;
  let dailyLoss = 0;
  let lastDay   = null;
  let equity    = 0;
  const equityCurve = []; // { time, equity }
  let basketIdSeq = 0;

  for (const bar of timeline) {
    const ts  = bar.time.getTime();
    const price = bar.price;
    const dateStr = bar.time.toISOString().slice(0, 10);

    // 일별 손실 초기화
    if (dateStr !== lastDay) {
      dailyLoss = 0;
      lastDay   = dateStr;
    }

    // ── 세션 체크 ──
    const inSession = isInSession(bar.time, params);

    // ── 열린 바스켓 업데이트 ──
    [buyBasket, sellBasket].forEach(basket => {
      if (!basket || !basket.isOpen) return;
      basket.updatePnl(price);

      // TP 체크 (avg 기준 points)
      const ptDiff = basket.direction === 'buy'
        ? price - basket.avgEntryPrice
        : basket.avgEntryPrice - price;
      const ptVal = ptDiff / CONTRACT.pointValue; // 포인트 단위

      if (ptVal >= params.tpPoints) {
        basket.close(bar.time, price, 'tp');
        equity += basket.realizedPnl;
        dailyLoss += Math.min(0, basket.realizedPnl);
        equityCurve.push({ time: bar.time, equity });
        if (basket.direction === 'buy') buyBasket = null;
        else sellBasket = null;
        // 쿨타임 시작
        if (basket.direction === 'buy') buyCooldownUntil  = ts + params.cooldownSec * 1000;
        else                            sellCooldownUntil = ts + params.cooldownSec * 1000;
        return;
      }

      // SL 체크 (USD 기준)
      if (basket.unrealizedPnl <= -params.slUsd) {
        basket.close(bar.time, price, 'sl');
        equity += basket.realizedPnl;
        dailyLoss += basket.realizedPnl;
        equityCurve.push({ time: bar.time, equity });
        if (basket.direction === 'buy') { buyBasket = null;  buyCooldownUntil  = ts + params.cooldownSec * 1000; }
        else                            { sellBasket = null; sellCooldownUntil = ts + params.cooldownSec * 1000; }
        return;
      }

      // 추가진입 체크
      if (inSession && basket.positions.length < params.maxPositions) {
        const timeSinceLast = (ts - basket.lastEntryTime.getTime()) / 1000;
        if (timeSinceLast >= params.reentrySec) {
          const adversePts = basket.direction === 'buy'
            ? (basket.lastEntryPrice - price) / CONTRACT.pointValue
            : (price - basket.lastEntryPrice) / CONTRACT.pointValue;
          if (adversePts >= params.addInterval) {
            const addLot = calcLot(params.startLot, params.lotMultiplier, basket.positions.length);
            basket.addPosition(bar.time, price, addLot);
          }
        }
      }
    });

    // ── 일일 손실 한도 ──
    if (-dailyLoss >= params.dailyMaxLoss) {
      // 모든 바스켓 강제 청산
      [buyBasket, sellBasket].forEach(basket => {
        if (!basket || !basket.isOpen) return;
        basket.close(bar.time, price, 'ddl');
        equity += basket.realizedPnl;
        equityCurve.push({ time: bar.time, equity });
      });
      buyBasket  = null;
      sellBasket = null;
      continue;
    }

    // ── 신규 진입 (세션 내) ──
    if (!inSession) continue;

    // BUY 신규 진입
    if (params.allowBuy && !buyBasket && ts > buyCooldownUntil) {
      basketIdSeq++;
      buyBasket = new Basket(basketIdSeq, 'buy', bar.time, price, params.startLot);
      baskets.push(buyBasket);
    }

    // SELL 신규 진입
    if (params.allowSell && !sellBasket && ts > sellCooldownUntil) {
      basketIdSeq++;
      sellBasket = new Basket(basketIdSeq, 'sell', bar.time, price, params.startLot);
      baskets.push(sellBasket);
    }
  }

  // 기간 말 열린 바스켓 EOD 청산
  if (timeline.length > 0) {
    const lastBar = timeline[timeline.length - 1];
    [buyBasket, sellBasket].forEach(basket => {
      if (!basket || !basket.isOpen) return;
      basket.close(lastBar.time, lastBar.price, 'eod');
      equity += basket.realizedPnl;
      equityCurve.push({ time: lastBar.time, equity });
    });
  }

  return { baskets, equityCurve };
}

// ══════════════════════════════════════════════════════════════
//  지표 계산
// ══════════════════════════════════════════════════════════════
function calcMetrics(baskets, equityCurve) {
  const closed = baskets.filter(b => !b.isOpen);
  const wins   = closed.filter(b => b.realizedPnl > 0);
  const losses = closed.filter(b => b.realizedPnl <= 0);
  const stopouts = closed.filter(b => b.closeReason === 'sl');
  const totalPnl  = closed.reduce((a, b) => a + b.realizedPnl, 0);
  const winProfit = wins.reduce((a, b) => a + b.realizedPnl, 0);
  const lossAmt   = Math.abs(losses.reduce((a, b) => a + b.realizedPnl, 0));
  const pf        = lossAmt > 0 ? winProfit / lossAmt : Infinity;
  const winRate   = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const avgPnl    = closed.length > 0 ? totalPnl / closed.length : 0;
  const worstBasket = closed.length > 0 ? closed.reduce((a, b) => b.realizedPnl < a.realizedPnl ? b : a) : null;

  // 드로다운 계산
  let peak = 0, maxDD = 0, maxDDPct = 0;
  equityCurve.forEach(pt => {
    if (pt.equity > peak) peak = pt.equity;
    const dd = peak - pt.equity;
    if (dd > maxDD) {
      maxDD = dd;
      maxDDPct = peak > 0 ? (dd / peak) * 100 : 0;
    }
  });

  return { totalPnl, wins: wins.length, losses: losses.length, stopouts: stopouts.length,
           winRate, pf, avgPnl, worstBasket, maxDD, maxDDPct,
           totalBaskets: closed.length };
}

// ══════════════════════════════════════════════════════════════
//  UI 렌더링
// ══════════════════════════════════════════════════════════════
let equityChartInst = null;

function setStatus(type, msg) {
  const el = document.getElementById('simStatus');
  const icons = { idle: 'fa-info-circle', running: 'fa-spinner fa-spin', done: 'fa-check-circle', error: 'fa-exclamation-triangle' };
  el.className = 'sim-status ' + type;
  el.innerHTML = `<i class="fas ${icons[type]}"></i><span>${msg}</span>`;
}

function renderKPIs(metrics, baskets, params) {
  const m = metrics;
  const fmtUsd = v => (v >= 0 ? '+' : '') + '$' + Math.abs(v).toFixed(2);
  const fmtC   = v => v >= 0 ? 'pos' : 'neg';

  const pnlEl = document.getElementById('kpiPnl');
  pnlEl.textContent = fmtUsd(m.totalPnl);
  pnlEl.className   = 'kpi-val-s ' + fmtC(m.totalPnl);
  document.getElementById('kpiPnlSub').textContent = `${m.wins}승 ${m.losses}패`;

  document.getElementById('kpiBaskets').textContent = m.totalBaskets + '개';
  document.getElementById('kpiBaskets').className   = 'kpi-val-s';
  document.getElementById('kpiBasketSub').textContent = `승률 ${m.winRate.toFixed(1)}%`;

  const stopEl = document.getElementById('kpiStopouts');
  stopEl.textContent = m.stopouts + '회';
  stopEl.className   = 'kpi-val-s ' + (m.stopouts > 0 ? 'danger' : 'pos');
  document.getElementById('kpiStopCard').className  = 'kpi-card-sim ' + (m.stopouts > 0 ? 'danger' : 'safe');
  document.getElementById('kpiStopSub').textContent = m.stopouts > 0 ? '⚠ 청산 발생' : '✓ 청산 없음';

  const worstEl = document.getElementById('kpiWorst');
  worstEl.textContent = m.worstBasket ? fmtUsd(m.worstBasket.realizedPnl) : '—';
  worstEl.className   = 'kpi-val-s ' + (m.worstBasket ? fmtC(m.worstBasket.realizedPnl) : '');
  document.getElementById('kpiWorstSub').textContent = m.worstBasket ? m.worstBasket.direction.toUpperCase() + ' · ' + m.worstBasket.positions.length + '회 추가' : '—';

  const pfEl = document.getElementById('kpiPF');
  pfEl.textContent = isFinite(m.pf) ? m.pf.toFixed(2) : '∞';
  pfEl.className   = 'kpi-val-s ' + (m.pf >= 1 ? 'yellow' : 'neg');

  const avgEl = document.getElementById('kpiAvgBasket');
  avgEl.textContent = fmtUsd(m.avgPnl);
  avgEl.className   = 'kpi-val-s ' + fmtC(m.avgPnl);
  document.getElementById('kpiAvgSub').textContent = `바스켓당 평균`;

  const mddEl = document.getElementById('kpiMdd');
  mddEl.textContent = m.maxDDPct.toFixed(1) + '%';
  mddEl.className   = 'kpi-val-s ' + (m.maxDDPct > 20 ? 'neg' : m.maxDDPct > 10 ? 'yellow' : 'pos');
  document.getElementById('kpiMddSub').textContent = '$' + m.maxDD.toFixed(2);

  // 기간
  const bs = baskets.filter(b => b.openedAt);
  if (bs.length > 0) {
    const minT = Math.min(...bs.map(b => b.openedAt.getTime()));
    const maxT = Math.max(...bs.filter(b => b.closedAt).map(b => b.closedAt.getTime()));
    const days = Math.round((maxT - minT) / (1000 * 86400));
    document.getElementById('kpiPeriod').textContent = days + '일';
    document.getElementById('kpiPeriodSub').textContent = new Date(minT).toLocaleDateString('ko-KR') + ' ~';
  }
}

function renderEquityChart(equityCurve) {
  if (equityChartInst) { equityChartInst.destroy(); equityChartInst = null; }
  const ctx = document.getElementById('equityChart');
  if (!ctx || equityCurve.length === 0) return;

  // 드로다운 계산
  let peak = 0;
  const ddData = equityCurve.map(pt => {
    if (pt.equity > peak) peak = pt.equity;
    return peak > 0 ? -((peak - pt.equity) / peak * 100) : 0;
  });

  const labels = equityCurve.map(pt => {
    const d = pt.time;
    return d.toLocaleDateString('ko-KR', { month:'2-digit', day:'2-digit' });
  });

  equityChartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '에쿼티 ($)',
          data: equityCurve.map(pt => pt.equity),
          borderColor: '#f5c400',
          backgroundColor: 'rgba(245,196,0,0.08)',
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          yAxisID: 'y',
          tension: 0.3,
        },
        {
          label: '드로다운 (%)',
          data: ddData,
          borderColor: 'rgba(240,96,96,0.7)',
          backgroundColor: 'rgba(240,96,96,0.07)',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: true,
          yAxisID: 'y2',
          tension: 0.3,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, labels: { color: '#8a9aaa', font: { size: 11 }, boxWidth: 12 } },
        tooltip: {
          backgroundColor: 'rgba(26,35,45,0.95)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#fff',
          bodyColor: '#8a9aaa',
          callbacks: {
            label: ctx => {
              if (ctx.datasetIndex === 0) return ` 에쿼티: $${ctx.raw.toFixed(2)}`;
              return ` 드로다운: ${ctx.raw.toFixed(1)}%`;
            }
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#8a9aaa', font: { size: 10 }, maxTicksLimit: 12 } },
        y:  { position: 'left',  grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#f5c400', font: { size: 10 }, callback: v => '$' + v.toFixed(0) } },
        y2: { position: 'right', grid: { display: false }, ticks: { color: '#f06060', font: { size: 10 }, callback: v => v.toFixed(0) + '%' } },
      }
    }
  });
}

function renderBasketTable(baskets) {
  const tbody = document.getElementById('basketTbody');
  const closed = baskets.filter(b => !b.isOpen).sort((a, b) => a.openedAt - b.openedAt);

  if (closed.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--text-muted);">결과 없음</td></tr>`;
    return;
  }

  const reasonBadge = r => {
    const map = { tp: ['tp','TP'], sl: ['sl','SL 청산'], eod: ['eod','기간종료'], ddl: ['ddl','일손실한도'] };
    const [cls, label] = map[r] || ['eod', r];
    return `<span class="reason-badge ${cls}">${label}</span>`;
  };
  const fmtTime = d => d ? d.toLocaleDateString('ko-KR', { month:'2-digit', day:'2-digit' }) + ' ' + d.toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit', hour12:false }) : '—';
  const fmtUsd  = v => (v >= 0 ? '+' : '') + '$' + Math.abs(v).toFixed(2);

  tbody.innerHTML = closed.map((b, i) => {
    const pnlCls = b.realizedPnl >= 0 ? 'pos' : (b.closeReason === 'sl' ? 'fatal' : 'neg');
    return `<tr>
      <td class="bold">#${i + 1}</td>
      <td><span class="dir-badge ${b.direction}">${b.direction.toUpperCase()}</span></td>
      <td>${fmtTime(b.openedAt)}</td>
      <td>${fmtTime(b.closedAt)}</td>
      <td class="bold">${b.positions.length}회</td>
      <td>${b.totalLot.toFixed(2)}</td>
      <td>${b.avgEntryPrice.toFixed(2)}</td>
      <td>${b.closePrice ? b.closePrice.toFixed(2) : '—'}</td>
      <td class="${pnlCls}">${fmtUsd(b.realizedPnl)}</td>
      <td>${reasonBadge(b.closeReason)}</td>
      <td><button onclick="showDrill(${b.id})" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:5px;color:#8a9aaa;font-size:10px;padding:4px 10px;cursor:pointer;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#8a9aaa'"><i class="fas fa-search"></i> 상세</button></td>
    </tr>`;
  }).join('');
}

// ── 드릴다운 ─────────────────────────────────────────────────
let _allBaskets = [];

function showDrill(basketId) {
  const basket = _allBaskets.find(b => b.id === basketId);
  if (!basket) return;
  switchTab('drill');

  const fmtTime = d => d ? d.toLocaleDateString('ko-KR', { month:'2-digit', day:'2-digit' }) + ' ' + d.toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit', hour12:false }) : '—';
  const fmtUsd  = v => (v >= 0 ? '+' : '') + '$' + Math.abs(v).toFixed(2);
  const isFatal = basket.closeReason === 'sl';
  const colorMain = isFatal ? '#f06060' : '#3dd68c';

  // 각 포지션의 진입 시점 미실현 PnL 계산
  let runningLot = 0, runningValue = 0;
  const rows = basket.positions.map((p, i) => {
    runningLot   += p.lot;
    runningValue += p.entryPrice * p.lot;
    const avgAfter = runningValue / runningLot;
    const urPnl    = calcPnL(p.direction, avgAfter, p.entryPrice, runningLot);
    // 청산가 기준 실현손익 (마지막 포지션만 의미있음)
    const exitPnl = basket.closePrice
      ? calcPnL(p.direction, p.entryPrice, basket.closePrice, p.lot)
      : null;
    return { p, i, avgAfter, urPnl, exitPnl, runningLot: runningLot.toFixed(2) };
  });

  const drillEl = document.getElementById('drillContent');
  drillEl.innerHTML = `
    <div class="drill-header">
      <span class="dir-badge ${basket.direction}">${basket.direction.toUpperCase()}</span>
      <span class="drill-title">바스켓 #${basketId} — ${isFatal ? '⚠ SL 청산 (손실 바스켓)' : '✓ ' + (basket.closeReason === 'tp' ? 'TP 청산' : '기간 종료')}</span>
      <span style="font-size:11px;color:${colorMain};font-weight:700;margin-left:8px;">${fmtUsd(basket.realizedPnl)}</span>
    </div>

    <!-- 요약 -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:16px 20px;border-bottom:1px solid var(--border);">
      <div><div class="kpi-label-s">진입 시각</div><div style="font-size:13px;color:var(--text-primary);">${fmtTime(basket.openedAt)}</div></div>
      <div><div class="kpi-label-s">청산 시각</div><div style="font-size:13px;color:var(--text-primary);">${fmtTime(basket.closedAt)}</div></div>
      <div><div class="kpi-label-s">평균 단가</div><div style="font-size:13px;color:var(--text-primary);">${basket.avgEntryPrice.toFixed(2)}</div></div>
      <div><div class="kpi-label-s">청산가</div><div style="font-size:13px;color:${colorMain};">${basket.closePrice ? basket.closePrice.toFixed(2) : '—'}</div></div>
      <div><div class="kpi-label-s">누적 랏</div><div style="font-size:13px;color:var(--text-primary);">${basket.totalLot.toFixed(2)}</div></div>
      <div><div class="kpi-label-s">포지션 수</div><div style="font-size:13px;color:var(--text-primary);">${basket.positions.length}회</div></div>
      <div><div class="kpi-label-s">최대 역행</div><div style="font-size:13px;color:#f06060;">${fmtUsd(basket.maxAdverse)}</div></div>
      <div><div class="kpi-label-s">최종 손익</div><div style="font-size:13px;font-weight:700;color:${colorMain};">${fmtUsd(basket.realizedPnl)}</div></div>
    </div>

    <!-- 포지션별 테이블 -->
    <div style="padding:16px 20px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:12px;">
        <i class="fas fa-list" style="color:#f5c400;margin-right:6px;"></i>포지션별 상세
      </div>
      <div class="sim-table-wrap">
        <table class="sim-table">
          <thead>
            <tr>
              <th>순번</th>
              <th>진입 시각</th>
              <th>진입가</th>
              <th>랏</th>
              <th>누적 랏</th>
              <th>진입 후 평균단가</th>
              <th>진입 후 미실현 PnL</th>
              <th>청산가</th>
              <th>개별 실현 PnL</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td class="bold">#${r.i + 1}${r.i === 0 ? ' <span style="font-size:9px;color:var(--text-muted);">(최초)</span>' : ' <span style="font-size:9px;color:#f5c400;">+추가</span>'}</td>
              <td>${fmtTime(r.p.entryTime)}</td>
              <td class="bold">${r.p.entryPrice.toFixed(2)}</td>
              <td>${r.p.lot.toFixed(2)}</td>
              <td>${r.runningLot}</td>
              <td>${r.avgAfter.toFixed(2)}</td>
              <td class="${r.urPnl >= 0 ? 'pos' : 'neg'}">${fmtUsd(r.urPnl)}</td>
              <td>${basket.closePrice ? basket.closePrice.toFixed(2) : '—'}</td>
              <td class="${r.exitPnl != null ? (r.exitPnl >= 0 ? 'pos' : 'neg') : ''}">${r.exitPnl != null ? fmtUsd(r.exitPnl) : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${isFatal ? `<div style="margin-top:12px;padding:10px 14px;background:rgba(240,96,96,0.07);border:1px solid rgba(240,96,96,0.2);border-radius:8px;font-size:11px;color:#f06060;line-height:1.6;">
        <i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i>
        <strong>청산 원인 분석:</strong> ${basket.positions.length}번째 추가진입 이후 누적 랏 <strong>${basket.totalLot.toFixed(2)}</strong>,
        평균단가 <strong>${basket.avgEntryPrice.toFixed(2)}</strong> 기준으로 최대 역행 <strong>${fmtUsd(basket.maxAdverse)}</strong> 발생.
        통합 손절 기준 도달로 청산.
      </div>` : ''}
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════
//  파라미터 스윕
// ══════════════════════════════════════════════════════════════
async function runSweep() {
  const btn = document.getElementById('btnSweep');
  btn.disabled = true;
  setStatus('running', '파라미터 스윕 실행 중...');
  document.getElementById('sweepProgressWrap').style.display = 'block';

  const baseParams = getParams();
  const timeline   = await loadTimeline(baseParams);
  if (!timeline || timeline.length === 0) {
    setStatus('error', '실거래 데이터가 없습니다. 관리자 패널에서 데이터를 업로드하세요.');
    btn.disabled = false;
    return;
  }

  // 스윕 배열 파싱
  const parseSweepArr = (id, fallback) => {
    const raw = document.getElementById(id).value.trim();
    if (!raw) return [fallback];
    return raw.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
  };
  const tpArr       = parseSweepArr('sweepTp', baseParams.tpPoints);
  const multArr     = parseSweepArr('sweepMult', baseParams.lotMultiplier);
  const intervalArr = parseSweepArr('sweepInterval', baseParams.addInterval);

  // 조합 생성
  const combos = [];
  for (const tp of tpArr)
    for (const mult of multArr)
      for (const interval of intervalArr)
        combos.push({ tp, mult, interval });

  const results = [];
  for (let i = 0; i < combos.length; i++) {
    const { tp, mult, interval } = combos[i];
    const p = { ...baseParams, tpPoints: tp, lotMultiplier: mult, addInterval: interval };
    const { baskets, equityCurve } = runEngine(timeline, p);
    const m = calcMetrics(baskets, equityCurve);
    // score = totalPnl - 2*maxDD - 50*stopouts
    const score = m.totalPnl - 2 * m.maxDD - 50 * m.stopouts;
    results.push({ tp, mult, interval, ...m, score });

    // 진행률
    const pct = Math.round((i + 1) / combos.length * 100);
    document.getElementById('sweepProgressBar').style.width = pct + '%';
    document.getElementById('simStatusText').textContent = `스윕 진행 중: ${i + 1}/${combos.length} 조합`;
    if (i % 10 === 0) await new Promise(r => setTimeout(r, 0)); // UI 업데이트
  }

  results.sort((a, b) => b.score - a.score);
  renderSweepTable(results);
  switchTab('sweep');
  setStatus('done', `스윕 완료: ${combos.length}개 조합 중 상위 결과 표시. 최고 점수: ${results[0]?.score.toFixed(1) ?? '—'}`);
  document.getElementById('sweepProgressWrap').style.display = 'none';
  btn.disabled = false;
}

function renderSweepTable(results) {
  const el = document.getElementById('sweepContent');
  if (!results.length) {
    el.innerHTML = `<div class="sim-empty"><i class="fas fa-th"></i><p>결과 없음</p></div>`;
    return;
  }
  const top = results.slice(0, 50);
  const fmtUsd = v => (v >= 0 ? '+' : '') + '$' + Math.abs(v).toFixed(2);

  el.innerHTML = `
    <div style="padding:14px 20px;border-bottom:1px solid var(--border);font-size:11px;color:var(--text-muted);">
      <i class="fas fa-trophy" style="color:#f5c400;margin-right:6px;"></i>
      상위 ${top.length}개 조합 (Score = PnL − 2×MDD − 50×청산횟수)
    </div>
    <div class="sim-table-wrap">
      <table class="sim-table">
        <thead>
          <tr>
            <th>순위</th>
            <th>TP (pt)</th>
            <th>랏 배수</th>
            <th>추가 간격</th>
            <th>총 손익</th>
            <th>승률</th>
            <th>PF</th>
            <th>MDD</th>
            <th>청산 횟수</th>
            <th>최악 바스켓</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          ${top.map((r, i) => `<tr ${i === 0 ? 'style="background:rgba(245,196,0,0.04);"' : ''}>
            <td class="bold" style="${i === 0 ? 'color:#f5c400;' : ''}">${i + 1}${i === 0 ? ' 🏆' : ''}</td>
            <td>${r.tp}</td>
            <td>${r.mult.toFixed(2)}</td>
            <td>${r.interval}</td>
            <td class="${r.totalPnl >= 0 ? 'pos' : 'neg'}">${fmtUsd(r.totalPnl)}</td>
            <td>${r.winRate.toFixed(1)}%</td>
            <td class="${r.pf >= 1 ? 'yellow' : 'neg'}">${isFinite(r.pf) ? r.pf.toFixed(2) : '∞'}</td>
            <td class="${r.maxDDPct > 20 ? 'neg' : ''}">${r.maxDDPct.toFixed(1)}%</td>
            <td class="${r.stopouts > 0 ? 'neg' : 'pos'}">${r.stopouts}회</td>
            <td class="neg">${r.worstBasket ? fmtUsd(r.worstBasket.realizedPnl) : '—'}</td>
            <td class="${r.score >= 0 ? 'yellow' : 'neg'}" style="font-weight:700;">${r.score.toFixed(1)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════
//  메인 실행
// ══════════════════════════════════════════════════════════════
async function loadTimeline(params) {
  const all    = await DB.getAll('trades');
  // XAUUSD(골드) 거래만 필터 — 없으면 전체 사용
  const xauFilter = all.filter(t => t.symbol && t.symbol.toUpperCase().includes('XAU'));
  const source  = xauFilter.length > 0 ? xauFilter : all;
  return buildPriceTimeline(source, params.startDate, params.endDate);
}

async function runSimulation() {
  const btn = document.getElementById('btnRun');
  btn.disabled = true;
  setStatus('running', '시뮬레이션 실행 중...');

  try {
    await new Promise(r => setTimeout(r, 30)); // UI 렌더 허용
    const params = getParams();

    const timeline = await loadTimeline(params);
    if (!timeline || timeline.length === 0) {
      setStatus('error', '실거래 데이터가 없습니다. 관리자 패널에서 MT4/MT5 데이터를 업로드하세요.');
      btn.disabled = false;
      return;
    }

    const { baskets, equityCurve } = runEngine(timeline, params);
    const metrics = calcMetrics(baskets, equityCurve);
    _allBaskets = baskets;

    renderKPIs(metrics, baskets, params);
    renderEquityChart(equityCurve);
    renderBasketTable(baskets);

    const stopMsg = metrics.stopouts > 0
      ? ` ⚠ 청산 ${metrics.stopouts}회 발생`
      : ' ✓ 청산 없음';
    setStatus('done', `완료 — ${metrics.totalBaskets}개 바스켓, 손익 ${(metrics.totalPnl >= 0 ? '+' : '')}$${Math.abs(metrics.totalPnl).toFixed(2)}, 승률 ${metrics.winRate.toFixed(1)}%.${stopMsg}`);
  } catch (e) {
    setStatus('error', '오류: ' + e.message);
    console.error(e);
  }
  btn.disabled = false;
}
