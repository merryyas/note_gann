// ─────────────────────────────────────────────────────────────────────────
//  제3자 독립 검증 엔진 (engine_fast.cjs와 완전히 다른 방식으로 재구현)
//  - 누적합 최적화(X). 실제 주문을 배열에 명시적으로 보관.
//  - 각 주문 {entryPx, lot} 를 그대로 들고, 평균가/손익을 매번 배열로 계산.
//  - 봉 내부 경로 O→L→H→C 동일. ask=bid+spread 동일. 같은 결과가 나와야 정상.
//  목적: 빠른 엔진의 누적합 트릭/인라인 최적화에 숨은 버그가 없는지 교차검증.
// ─────────────────────────────────────────────────────────────────────────
const POINT = 0.01, CSIZE = 100;

function lotAt(L0, mult, n) {
  const v = Math.round(L0 * Math.pow(mult, n) * 100) / 100;
  return v < 0.01 ? 0.01 : Math.round(v * 100) / 100;
}

// 명시적 주문 배열 기반 VWAP
function vwap(orders) {
  let sumPL = 0, sumL = 0;
  for (const o of orders) { sumPL += o.px * o.lot; sumL += o.lot; }
  return sumL > 0 ? sumPL / sumL : 0;
}
function totalLot(orders) { let s = 0; for (const o of orders) s += o.lot; return s; }

function simulateVerify(bars, p, spread) {
  const { ts, o, h, l, c, n } = bars;
  const seed = p.seed ?? 1000;
  let balance = seed;

  let buy = [];   // [{px, lot}]
  let sell = [];
  let liquidated = false;
  let nBaskets = 0, nWins = 0, nLosses = 0, nTrades = 0;
  let peak = balance, maxDD = 0, maxConc = 0;

  const startLot = p.startLot, mult = p.lotMult, tpP = p.tpPoints,
        interval = p.interval, maxOrders = p.maxOrders, slUsd = p.slUsd || 0;
  const ssMin = p.sessStartMin, seMin = p.sessEndMin;
  const hasSessMin = ssMin != null;
  const ss = p.sessStartUTC, se = p.sessEndUTC;
  const hasSess = ss != null;
  const closeAtEnd = !!p.closeAtSessionEnd;

  // 한 가격점 처리 (TP / SL / 마진콜)
  function tick(bid, ask) {
    if (liquidated) return;
    // BUY TP
    if (buy.length) {
      const avg = vwap(buy);
      const tp = avg + (tpP / buy.length) * POINT;
      if (bid >= tp) {
        let pnl = (tp - avg) * CSIZE * totalLot(buy);
        if (pnl < 0 && balance + pnl <= 0) { balance = 0; liquidated = true; }
        else balance += pnl;
        nBaskets++; if (pnl > 0) nWins++; else if (pnl < 0) nLosses++;
        buy = [];
      }
    }
    if (liquidated) return;
    // SELL TP
    if (sell.length) {
      const avg = vwap(sell);
      const tp = avg - (tpP / sell.length) * POINT;
      if (ask <= tp) {
        let pnl = (avg - tp) * CSIZE * totalLot(sell);
        if (pnl < 0 && balance + pnl <= 0) { balance = 0; liquidated = true; }
        else balance += pnl;
        nBaskets++; if (pnl > 0) nWins++; else if (pnl < 0) nLosses++;
        sell = [];
      }
    }
    if (liquidated) return;
    // 옵션 SL (바스켓 평가손실이 -slUsd 이하면 청산)
    if (slUsd > 0) {
      if (buy.length) {
        const pl = (bid - vwap(buy)) * CSIZE * totalLot(buy);
        if (pl <= -slUsd) {
          let pnl = pl;
          if (balance + pnl <= 0) { balance = 0; liquidated = true; }
          else balance += pnl;
          nBaskets++; nLosses++; buy = [];
        }
      }
      if (!liquidated && sell.length) {
        const pl = (vwap(sell) - ask) * CSIZE * totalLot(sell);
        if (pl <= -slUsd) {
          let pnl = pl;
          if (balance + pnl <= 0) { balance = 0; liquidated = true; }
          else balance += pnl;
          nBaskets++; nLosses++; sell = [];
        }
      }
    }
    if (liquidated) return;
    // 마진콜 (잔고+평가손익 <= 0)
    let unr = 0;
    if (buy.length) unr += (bid - vwap(buy)) * CSIZE * totalLot(buy);
    if (sell.length) unr += (vwap(sell) - ask) * CSIZE * totalLot(sell);
    if (balance + unr <= 0) { balance = 0; liquidated = true; return; }
    const eq = balance + unr;
    if (eq > peak) peak = eq;
    const dd = peak - eq; if (dd > maxDD) maxDD = dd;
  }

  function inSessionAt(t) {
    if (hasSessMin) {
      const m = (Math.floor(t / 60000) % 1440 + 1440) % 1440;
      return seMin > ssMin ? (m >= ssMin && m < seMin) : (m >= ssMin || m < seMin);
    }
    if (hasSess) {
      const hr = (Math.floor(t / 3600000) % 24 + 24) % 24;
      return hr >= ss && hr < se;
    }
    return true;
  }

  for (let i = 0; i < n && !liquidated; i++) {
    const t = ts[i];
    const bo = o[i], bh = h[i], bl = l[i], bc = c[i];
    // 봉 내부 경로 O→L→H→C
    tick(bo, bo + spread); if (liquidated) break;
    tick(bl, bl + spread); if (liquidated) break;
    tick(bh, bh + spread); if (liquidated) break;
    tick(bc, bc + spread); if (liquidated) break;

    if (!inSessionAt(t)) {
      if (closeAtEnd && (buy.length || sell.length)) {
        const ask0 = bc + spread, bid0 = bc;
        if (buy.length) {
          let pnl = (bid0 - vwap(buy)) * CSIZE * totalLot(buy);
          if (pnl < 0 && balance + pnl <= 0) { balance = 0; liquidated = true; }
          else balance += pnl;
          nBaskets++; if (pnl > 0) nWins++; else if (pnl < 0) nLosses++;
          buy = [];
        }
        if (!liquidated && sell.length) {
          let pnl = (vwap(sell) - ask0) * CSIZE * totalLot(sell);
          if (pnl < 0 && balance + pnl <= 0) { balance = 0; liquidated = true; }
          else balance += pnl;
          nBaskets++; if (pnl > 0) nWins++; else if (pnl < 0) nLosses++;
          sell = [];
        }
      }
      continue;
    }

    const ask = bc + spread, bid = bc;
    // BUY 진입/추가 — engine_fast와 동일 규칙: 트리거는 "현재 진입가 기준"으로 갱신
    if (buy.length === 0) {
      buy.push({ px: ask, lot: startLot, trig: ask - interval * POINT }); nTrades++;
    } else {
      let g = 0;
      while (ask <= buy[buy.length - 1].trig && buy.length < maxOrders && g++ < 50) {
        buy.push({ px: ask, lot: lotAt(startLot, mult, buy.length), trig: ask - interval * POINT }); nTrades++;
      }
    }
    // SELL 진입/추가
    if (sell.length === 0) {
      sell.push({ px: bid, lot: startLot, trig: bid + interval * POINT }); nTrades++;
    } else {
      let g = 0;
      while (bid >= sell[sell.length - 1].trig && sell.length < maxOrders && g++ < 50) {
        sell.push({ px: bid, lot: lotAt(startLot, mult, sell.length), trig: bid + interval * POINT }); nTrades++;
      }
    }
    if (buy.length > maxConc) maxConc = buy.length;
    if (sell.length > maxConc) maxConc = sell.length;
  }

  const winRate = nBaskets ? nWins / nBaskets * 100 : 0;
  return {
    pnl: Math.round((balance - seed) * 100) / 100,
    balance: Math.round(balance * 100) / 100,
    baskets: nBaskets, trades: nTrades, wins: nWins, losses: nLosses,
    winRate: Math.round(winRate * 10) / 10,
    liquidated, maxDD: Math.round(maxDD * 100) / 100, maxConcurrent: maxConc,
  };
}

module.exports = { simulateVerify, lotAt };
