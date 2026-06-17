// ─────────────────────────────────────────────────────────────────────────
//  고속 시뮬 엔진 — 봉 배열(TypedArray)을 직접 인라인 처리 (제너레이터 X)
//  engine.cjs와 동일 로직이나 그리드서치용으로 최적화.
//  봉 내부 경로: O→L→H→C. ask=bid+spread.
// ─────────────────────────────────────────────────────────────────────────
const POINT = 0.01, CSIZE = 100;

function martinLotAt(L0, mult, n) {
  const v = Math.round(L0 * Math.pow(mult, n) * 100) / 100;
  return v < 0.01 ? 0.01 : Math.round(v * 100) / 100;
}

// bars: {ts,o,h,l,c,n} (Float64Array), p: 파라미터, spread: $
function simulateFast(bars, p, spread) {
  const { ts, o, h, l, c, n } = bars;
  const seed = p.seed ?? 1000;
  let balance = seed;
  // 바스켓 상태: 진입가/롯 배열 대신 누적합으로 vwap 계산 (메모리/속도)
  let bN = 0, bSumPL = 0, bLot = 0, bTrig = 0;     // buy: 개수, Σ(entry*lot), Σlot
  let sN = 0, sSumPL = 0, sLot = 0, sTrig = 0;     // sell
  let liquidated = false;
  let nBaskets = 0, nWins = 0, nLosses = 0, nTrades = 0;
  let peak = balance, maxDD = 0, maxConc = 0, minEq = balance;
  let totalPnlPos = 0;

  // 세션: 정수시간(sessStartUTC/sessEndUTC) 또는 분단위(sessStartMin/sessEndMin, UTC 분 0~1439)
  const ss = p.sessStartUTC, se = p.sessEndUTC;
  const ssMin = p.sessStartMin, seMin = p.sessEndMin;
  const hasSessionMin = ssMin != null;
  const hasSession = ss != null;
  const startLot = p.startLot, mult = p.lotMult, tpP = p.tpPoints,
        interval = p.interval, maxOrders = p.maxOrders, slUsd = p.slUsd;
  const closeAtEnd = !!p.closeAtSessionEnd;
  // 날짜 제외 필터: skipDom = 거래 안 할 '일(day of month)' 배열 (예: [1,2,28,29,30,31])
  //               skipDow = 거래 안 할 '요일' 배열 (0=일~6=토)
  const skipDom = p.skipDom || null;
  const skipDow = p.skipDow || null;
  const hasSkip = !!(skipDom || skipDow);

  // 가격점 처리 함수 (인라인)
  function process(t, bid, ask) {
    if (liquidated) return;
    // buy TP
    if (bN > 0) {
      const avg = bSumPL / bLot;
      const tp = avg + (tpP / bN) * POINT;
      if (bid >= tp) {
        let pnl = (tp - avg) * CSIZE * bLot;
        if (pnl < 0 && balance + pnl <= 0) { pnl = -balance; balance = 0; liquidated = true; }
        else balance += pnl;
        nBaskets++; if (pnl > 0) { nWins++; totalPnlPos += pnl; } else if (pnl < 0) nLosses++;
        bN = 0; bSumPL = 0; bLot = 0;
      }
    }
    if (liquidated) return;
    // sell TP
    if (sN > 0) {
      const avg = sSumPL / sLot;
      const tp = avg - (tpP / sN) * POINT;
      if (ask <= tp) {
        let pnl = (avg - tp) * CSIZE * sLot;
        if (pnl < 0 && balance + pnl <= 0) { pnl = -balance; balance = 0; liquidated = true; }
        else balance += pnl;
        nBaskets++; if (pnl > 0) { nWins++; totalPnlPos += pnl; } else if (pnl < 0) nLosses++;
        sN = 0; sSumPL = 0; sLot = 0;
      }
    }
    if (liquidated) return;
    // 옵션 SL
    if (slUsd > 0) {
      if (bN > 0) {
        const avg = bSumPL / bLot;
        const pl = (bid - avg) * CSIZE * bLot;
        if (pl <= -slUsd) {
          let pnl = pl;
          if (pnl < 0 && balance + pnl <= 0) { pnl = -balance; balance = 0; liquidated = true; }
          else balance += pnl;
          nBaskets++; nLosses++; bN = 0; bSumPL = 0; bLot = 0;
        }
      }
      if (!liquidated && sN > 0) {
        const avg = sSumPL / sLot;
        const pl = (avg - ask) * CSIZE * sLot;
        if (pl <= -slUsd) {
          let pnl = pl;
          if (pnl < 0 && balance + pnl <= 0) { pnl = -balance; balance = 0; liquidated = true; }
          else balance += pnl;
          nBaskets++; nLosses++; sN = 0; sSumPL = 0; sLot = 0;
        }
      }
      if (liquidated) return;
    }
    // 마진콜
    let unr = 0;
    if (bN > 0) unr += (bid - bSumPL / bLot) * CSIZE * bLot;
    if (sN > 0) unr += (sSumPL / sLot - ask) * CSIZE * sLot;
    if (balance + unr <= 0) { balance = 0; liquidated = true; minEq = 0; return; }
    const eq = balance + unr;
    if (eq > peak) peak = eq;
    const dd = peak - eq; if (dd > maxDD) maxDD = dd;
    if (eq < minEq) minEq = eq;
  }

  for (let i = 0; i < n && !liquidated; i++) {
    const t = ts[i];
    const bo = o[i], bh = h[i], bl = l[i], bc = c[i];
    // O→L→H→C
    process(t, bo, bo + spread);
    if (liquidated) break;
    process(t, bl, bl + spread);
    if (liquidated) break;
    process(t, bh, bh + spread);
    if (liquidated) break;
    process(t, bc, bc + spread);
    if (liquidated) break;

    // 진입 판단 — 봉 종가(C) 기준 + 세션
    let inSession = true;
    if (hasSessionMin) {
      const minUTC = (Math.floor(t / 60000) % 1440 + 1440) % 1440;
      inSession = seMin > ssMin
        ? (minUTC >= ssMin && minUTC < seMin)
        : (minUTC >= ssMin || minUTC < seMin); // 자정 넘김
    } else if (hasSession) {
      const hUTC = (Math.floor(t / 3600000) % 24 + 24) % 24;
      inSession = hUTC >= ss && hUTC < se;
    }
    // 날짜 제외 필터 (월초/월말/요일 등)
    if (inSession && hasSkip) {
      const d = new Date(t);
      if (skipDom && skipDom.indexOf(d.getUTCDate()) >= 0) inSession = false;
      else if (skipDow && skipDow.indexOf(d.getUTCDay()) >= 0) inSession = false;
    }
    if (!inSession) {
      // 세션종료 시 전량청산 옵션: 열린 바스켓을 현재가(시장가)로 정리
      if (closeAtEnd && (bN > 0 || sN > 0)) {
        const ask0 = bc + spread, bid0 = bc;
        if (bN > 0) {
          const avg = bSumPL / bLot;
          let pnl = (bid0 - avg) * CSIZE * bLot;
          if (pnl < 0 && balance + pnl <= 0) { pnl = -balance; balance = 0; liquidated = true; }
          else balance += pnl;
          nBaskets++; if (pnl > 0) nWins++; else if (pnl < 0) nLosses++;
          bN = 0; bSumPL = 0; bLot = 0;
        }
        if (!liquidated && sN > 0) {
          const avg = sSumPL / sLot;
          let pnl = (avg - ask0) * CSIZE * sLot;
          if (pnl < 0 && balance + pnl <= 0) { pnl = -balance; balance = 0; liquidated = true; }
          else balance += pnl;
          nBaskets++; if (pnl > 0) nWins++; else if (pnl < 0) nLosses++;
          sN = 0; sSumPL = 0; sLot = 0;
        }
      }
      continue;
    }

    const ask = bc + spread, bid = bc;
    // BUY 진입 (ask)
    if (bN === 0) { bSumPL = ask * startLot; bLot = startLot; bN = 1; nTrades++; bTrig = ask - interval * POINT; }
    else { let g = 0; while (ask <= bTrig && bN < maxOrders && g++ < 50) { const lot = martinLotAt(startLot, mult, bN); bSumPL += ask * lot; bLot += lot; bN++; nTrades++; bTrig = ask - interval * POINT; } }
    // SELL 진입 (bid)
    if (sN === 0) { sSumPL = bid * startLot; sLot = startLot; sN = 1; nTrades++; sTrig = bid + interval * POINT; }
    else { let g = 0; while (bid >= sTrig && sN < maxOrders && g++ < 50) { const lot = martinLotAt(startLot, mult, sN); sSumPL += bid * lot; sLot += lot; sN++; nTrades++; sTrig = bid + interval * POINT; } }

    if (bN > maxConc) maxConc = bN;
    if (sN > maxConc) maxConc = sN;
  }

  const winRate = nBaskets ? nWins / nBaskets * 100 : 0;
  return {
    pnl: Math.round((balance - seed) * 100) / 100,
    balance: Math.round(balance * 100) / 100,
    baskets: nBaskets, trades: nTrades, wins: nWins, losses: nLosses,
    winRate: Math.round(winRate * 10) / 10,
    liquidated, maxDD: Math.round(maxDD * 100) / 100, maxConcurrent: maxConc,
    minEq: Math.round(minEq * 100) / 100,
  };
}

module.exports = { simulateFast, martinLotAt };
