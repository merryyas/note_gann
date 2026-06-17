// ─────────────────────────────────────────────────────────────────────────
//  1차 스크리닝 그리드서치 (1초봉 기반)
//  목표: 청산 안 당하면서(liquidated=false) 수익 최대인 세팅 + 운영시간대 탐색
//  최적화: 1초봉 피드를 메모리에 1회 로드(Float64Array) → 조합마다 재사용
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const { simulate } = require('./engine.cjs');

const SPREAD = 0.62;

// 1초봉 전체를 메모리에 적재 (압축해제 1회). 봉 단위로 [t,o,h,l,c] 저장.
function loadAllBars(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.csv.gz') && f.includes('-s1-')).sort();
  const ts = [], o = [], h = [], l = [], c = [];
  for (const f of files) {
    const text = zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString('utf8');
    let start = 0, lineNo = 0;
    for (let i = 0; i <= text.length; i++) {
      if (i === text.length || text[i] === '\n') {
        const line = text.slice(start, i); start = i + 1; lineNo++;
        if (lineNo === 1 || !line) continue;
        const p = line.split(',');
        const t = +p[0];
        if (!isFinite(t)) continue;
        ts.push(t); o.push(+p[1]); h.push(+p[2]); l.push(+p[3]); c.push(+p[4]);
      }
    }
  }
  return {
    ts: Float64Array.from(ts), o: Float64Array.from(o),
    h: Float64Array.from(h), l: Float64Array.from(l), c: Float64Array.from(c),
    n: ts.length,
  };
}

// 메모리 봉 → 가격 피드 제너레이터 (O→L→H→C)
function* barFeed(bars, spread = SPREAD) {
  const { ts, o, h, l, c, n } = bars;
  for (let i = 0; i < n; i++) {
    const t = ts[i];
    yield { t: t,       ask: o[i] + spread, bid: o[i] };
    yield { t: t + 250, ask: l[i] + spread, bid: l[i] };
    yield { t: t + 500, ask: h[i] + spread, bid: h[i] };
    yield { t: t + 750, ask: c[i] + spread, bid: c[i] };
  }
}

// ── 탐색 그리드 정의 ──
const GRID = {
  tpPoints:  [200, 300, 500],
  lotMult:   [1.3, 1.5, 2.0],
  interval:  [200, 300, 500],
  maxOrders: [6, 8, 10, 15],
  slUsd:     [0, 30, 60],
  // 운영 시간대 (UTC): null=24시간, [start,end]
  session:   [null, [2,15], [6,15], [2,10], [12,21]],
};

function* combos() {
  for (const tpPoints of GRID.tpPoints)
  for (const lotMult of GRID.lotMult)
  for (const interval of GRID.interval)
  for (const maxOrders of GRID.maxOrders)
  for (const slUsd of GRID.slUsd)
  for (const session of GRID.session)
    yield { tpPoints, lotMult, interval, maxOrders, slUsd, session };
}

function run() {
  const dir = process.argv[2] || './sec1';
  console.error('봉 로딩 중...');
  const t0 = Date.now();
  const bars = loadAllBars(dir);
  console.error(`봉 ${bars.n.toLocaleString()}개 로드 (${((Date.now()-t0)/1000).toFixed(1)}초)`);
  if (bars.n === 0) { console.error('봉 없음'); return; }
  console.error(`기간: ${new Date(bars.ts[0]).toISOString()} ~ ${new Date(bars.ts[bars.n-1]).toISOString()}`);

  const total = [...combos()].length;
  console.error(`총 조합: ${total}개\n`);

  const results = [];
  let done = 0;
  for (const cb of combos()) {
    const p = {
      seed: 1000, startLot: 0.01,
      tpPoints: cb.tpPoints, lotMult: cb.lotMult, interval: cb.interval,
      maxOrders: cb.maxOrders, slUsd: cb.slUsd,
      allowBuy: true, allowSell: true,
      sessStartUTC: cb.session ? cb.session[0] : null,
      sessEndUTC: cb.session ? cb.session[1] : null,
    };
    const r = simulate(barFeed(bars), p);
    results.push({
      ...cb,
      session: cb.session ? `${cb.session[0]}-${cb.session[1]}` : '24h',
      pnl: r.pnl, baskets: r.baskets, winRate: r.winRate,
      maxDD: r.maxDD, maxConcurrent: r.maxConcurrent, liquidated: r.liquidated,
    });
    done++;
    if (done % 50 === 0) console.error(`진행: ${done}/${total} (${((Date.now()-t0)/1000).toFixed(0)}초)`);
  }

  // 청산 안 당한 것 중 수익순 정렬
  const survived = results.filter(r => !r.liquidated).sort((a,b) => b.pnl - a.pnl);
  const liquidatedCount = results.filter(r => r.liquidated).length;

  console.error(`\n=== 결과: 생존 ${survived.length}/${total} (청산 ${liquidatedCount}) ===`);
  console.error('\n[TOP 20 생존+수익]');
  console.error('순위 손익     승률   바스켓 DD      동시 손절 세션      TP   배수  간격 최대주문');
  survived.slice(0, 20).forEach((r, i) => {
    console.error(`${String(i+1).padStart(2)}  $${String(r.pnl).padStart(8)} ${String(r.winRate).padStart(5)}% ${String(r.baskets).padStart(5)} $${String(r.maxDD).padStart(7)} ${String(r.maxConcurrent).padStart(3)}  $${String(r.slUsd).padStart(3)} ${r.session.padStart(6)} ${String(r.tpPoints).padStart(4)} ${r.lotMult} ${String(r.interval).padStart(4)} ${r.maxOrders}`);
  });

  // 전체 결과 저장
  fs.writeFileSync('./gridsearch_results.json', JSON.stringify(results, null, 1));
  console.error('\n전체 결과 → gridsearch_results.json');
}

if (require.main === module) run();
module.exports = { loadAllBars, barFeed, GRID, combos };
