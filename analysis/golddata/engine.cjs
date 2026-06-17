// ─────────────────────────────────────────────────────────────────────────
//  AUTO LOGIC 3 EA 시뮬레이션 엔진 (1초봉 / 틱 공용)
//  실제 385거래·213바스켓 검증으로 확립된 규칙:
//   - 양방향 독립 바스켓(buy=ask진입, sell=bid진입), 청산 즉시 재진입(헤지 유지)
//   - 그리드: interval pt마다 마틴게일 추가, lot = round(L0×mult^(n-1),2)
//   - 통합TP: 바스켓 전체가 동일가(vwap ± tpPoints/n pt)에 동시청산 (가격기반)
//   - SL 없음(디폴트). slUsd>0이면 평가손실 기준 손절(옵션)
//   - 세션필터: sessStartUTC <= hourUTC < sessEndUTC 에만 신규/추가 진입
//   - 마진콜: 잔고+평가손익 <= 0 이면 청산
// ─────────────────────────────────────────────────────────────────────────
const CONTRACT = { pointSize: 0.01, contractSize: 100 };

function martinLotAt(L0, mult, n) {
  const v = Math.round(L0 * Math.pow(mult, n) * 100) / 100;
  return +(v < 0.01 ? 0.01 : v).toFixed(2);
}
function vwap(pos) {
  let w = 0, t = 0;
  for (const x of pos) { w += x.entry * x.lot; t += x.lot; }
  return { avg: w / t, totalLot: t };
}
function pnlOf(dir, pos, px) {
  const { avg, totalLot } = vwap(pos);
  const diff = dir === 'buy' ? px - avg : avg - px;
  return diff * CONTRACT.contractSize * totalLot;
}

/**
 * 가격점 시퀀스(틱 또는 1초봉 경로 전개)를 받아 시뮬레이션.
 * priceFeed: 제너레이터/배열, 각 항목 {t, ask, bid}
 *   - 1초봉은 bid OHLC뿐 → ask=bid+spread 로 근사(spread 파라미터)
 *   - 봉은 O→L→H→C 경로로 전개(보수적)
 * p: { seed, startLot, tpPoints, lotMult, interval, maxOrders,
 *      allowBuy, allowSell, slUsd, sessStartUTC, sessEndUTC, sessDays(set or null) }
 */
function simulate(priceFeed, p) {
  const seed = p.seed ?? 1000;
  let balance = seed;
  let buyPos = [], sellPos = [], buyTrig = null, sellTrig = null;
  let liquidated = false;
  const baskets = [];
  let nTrades = 0;
  let peak = balance, maxDD = 0, maxConcurrent = 0;

  const tpPrice = (dir, pos) => {
    const { avg } = vwap(pos);
    const dist = (p.tpPoints / pos.length) * CONTRACT.pointSize;
    return dir === 'buy' ? avg + dist : avg - dist;
  };
  function close(dir, px, t, reason) {
    const pos = dir === 'buy' ? buyPos : sellPos;
    if (!pos.length) return;
    let pnl = pnlOf(dir, pos, px);
    if (pnl < 0 && balance + pnl <= 0) { pnl = -balance; balance = 0; liquidated = true; }
    else balance += pnl;
    const { avg, totalLot } = vwap(pos);
    baskets.push({ dir, n: pos.length, totalLot: +totalLot.toFixed(2),
      avg: +avg.toFixed(2), exit: +px.toFixed(2), pnl: +pnl.toFixed(2),
      bal: +balance.toFixed(2), reason, t });
    if (dir === 'buy') { buyPos = []; buyTrig = null; } else { sellPos = []; sellTrig = null; }
  }

  for (const tk of priceFeed) {
    if (liquidated) break;
    const { t, ask, bid } = tk;
    const hUTC = new Date(t).getUTCHours();
    const dUTC = new Date(t).getUTCDay(); // 0=일~6=토
    let inSession = true;
    if (p.sessStartUTC != null) inSession = hUTC >= p.sessStartUTC && hUTC < p.sessEndUTC;
    if (p.sessDays && !p.sessDays.has(dUTC)) inSession = false;

    // 1) 통합 TP (가격기반)
    if (buyPos.length) { const tp = tpPrice('buy', buyPos); if (bid >= tp) close('buy', tp, t, 'TP'); }
    if (!liquidated && sellPos.length) { const tp = tpPrice('sell', sellPos); if (ask <= tp) close('sell', tp, t, 'TP'); }
    if (liquidated) break;

    // 2) 옵션 SL (평가손실 기준)
    if (p.slUsd > 0) {
      if (buyPos.length && pnlOf('buy', buyPos, bid) <= -p.slUsd) close('buy', bid, t, 'SL');
      if (!liquidated && sellPos.length && pnlOf('sell', sellPos, ask) <= -p.slUsd) close('sell', ask, t, 'SL');
      if (liquidated) break;
    }

    // 마진콜
    const unr = (buyPos.length ? pnlOf('buy', buyPos, bid) : 0) + (sellPos.length ? pnlOf('sell', sellPos, ask) : 0);
    if (balance + unr <= 0) { balance = 0; liquidated = true; break; }
    const eq = Math.max(0, balance + unr);
    if (eq > peak) peak = eq;
    const dd = peak - eq; if (dd > maxDD) maxDD = dd;

    if (!inSession) continue;

    // 3) 진입 (buy=ask, sell=bid)
    if (p.allowBuy !== false) {
      if (buyPos.length === 0) { buyPos.push({ entry: ask, lot: p.startLot, t }); nTrades++; buyTrig = ask - p.interval * CONTRACT.pointSize; }
      else { let g = 0; while (ask <= buyTrig && buyPos.length < p.maxOrders && g++ < 50) { buyPos.push({ entry: ask, lot: martinLotAt(buyPos[0].lot, p.lotMult, buyPos.length), t }); nTrades++; buyTrig = ask - p.interval * CONTRACT.pointSize; } }
    }
    if (p.allowSell !== false) {
      if (sellPos.length === 0) { sellPos.push({ entry: bid, lot: p.startLot, t }); nTrades++; sellTrig = bid + p.interval * CONTRACT.pointSize; }
      else { let g = 0; while (bid >= sellTrig && sellPos.length < p.maxOrders && g++ < 50) { sellPos.push({ entry: bid, lot: martinLotAt(sellPos[0].lot, p.lotMult, sellPos.length), t }); nTrades++; sellTrig = bid + p.interval * CONTRACT.pointSize; } }
    }
    maxConcurrent = Math.max(maxConcurrent, buyPos.length, sellPos.length);
  }

  const wins = baskets.filter(b => b.pnl > 0).length;
  const losses = baskets.filter(b => b.pnl < 0).length;
  const winRate = baskets.length ? wins / baskets.length * 100 : 0;
  return {
    pnl: +(balance - seed).toFixed(2), balance: +balance.toFixed(2),
    baskets: baskets.length, trades: nTrades, wins, losses,
    winRate: +winRate.toFixed(1), liquidated, maxDD: +maxDD.toFixed(2),
    maxConcurrent, basketList: baskets,
  };
}

module.exports = { simulate, martinLotAt, vwap, pnlOf, CONTRACT };
