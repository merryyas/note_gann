// ─────────────────────────────────────────────────────────────────────────
//  1차 스크리닝 그리드서치 v2 — 개선된 로더 + 고속엔진
//  목표: 청산 안 당하면서(liquidated=false) 수익 최대인 세팅 + 운영시간대
//  봉을 메모리에 1회 로드 → 1620조합 반복
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');

const SPREAD = 0.62;

const GRID = {
  tpPoints:  [200, 300, 500],
  lotMult:   [1.3, 1.5, 2.0],
  interval:  [200, 300, 500],
  maxOrders: [6, 8, 10, 15],
  slUsd:     [0, 30, 60],
  session:   [null, [2,15], [6,15], [2,10], [12,21]],  // UTC 시간대
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
  let t0 = Date.now();
  const bars = loadAllBars(dir);
  console.error(`봉 ${bars.n.toLocaleString()}개 로드 (${((Date.now()-t0)/1000).toFixed(1)}초)`);
  console.error(`기간: ${new Date(bars.ts[0]).toISOString().slice(0,10)} ~ ${new Date(bars.ts[bars.n-1]).toISOString().slice(0,10)}`);

  const allCombos = [...combos()];
  const total = allCombos.length;
  console.error(`총 조합: ${total}개\n`);

  const results = [];
  t0 = Date.now();
  for (let ci = 0; ci < total; ci++) {
    const cb = allCombos[ci];
    const p = {
      seed: 1000, startLot: 0.01,
      tpPoints: cb.tpPoints, lotMult: cb.lotMult, interval: cb.interval,
      maxOrders: cb.maxOrders, slUsd: cb.slUsd,
      sessStartUTC: cb.session ? cb.session[0] : null,
      sessEndUTC: cb.session ? cb.session[1] : null,
    };
    const r = simulateFast(bars, p, SPREAD);
    results.push({
      tpPoints: cb.tpPoints, lotMult: cb.lotMult, interval: cb.interval,
      maxOrders: cb.maxOrders, slUsd: cb.slUsd,
      session: cb.session ? `${cb.session[0]}-${cb.session[1]}` : '24h',
      pnl: r.pnl, baskets: r.baskets, winRate: r.winRate,
      maxDD: r.maxDD, maxConcurrent: r.maxConcurrent, liquidated: r.liquidated,
    });
    if ((ci+1) % 100 === 0) {
      const el = (Date.now()-t0)/1000;
      const eta = el / (ci+1) * (total-ci-1);
      console.error(`진행 ${ci+1}/${total} (${el.toFixed(0)}초, ETA ${eta.toFixed(0)}초)`);
    }
  }

  const elapsed = ((Date.now()-t0)/1000).toFixed(0);
  const survived = results.filter(r => !r.liquidated).sort((a,b)=>b.pnl-a.pnl);
  const liqCount = results.filter(r => r.liquidated).length;

  console.error(`\n=== 완료 (${elapsed}초) ===`);
  console.error(`생존: ${survived.length}/${total}  |  청산: ${liqCount}`);
  console.error('\n[TOP 25 생존+수익순]');
  console.error('순위  손익      승률   바스켓   DD       동시 손절 세션     TP   배수 간격 주문');
  survived.slice(0,25).forEach((r,i)=>{
    console.error(
      String(i+1).padStart(3)+'  $'+String(r.pnl).padStart(8)+' '+
      String(r.winRate).padStart(5)+'% '+String(r.baskets).padStart(6)+' $'+
      String(r.maxDD).padStart(8)+' '+String(r.maxConcurrent).padStart(3)+' $'+
      String(r.slUsd).padStart(3)+' '+r.session.padStart(6)+' '+
      String(r.tpPoints).padStart(4)+' '+r.lotMult+' '+
      String(r.interval).padStart(4)+' '+r.maxOrders
    );
  });

  fs.writeFileSync('./gridsearch_results.json', JSON.stringify(results));
  console.error('\n전체 결과 → gridsearch_results.json');
}

if (require.main === module) run();
module.exports = { combos, GRID };
