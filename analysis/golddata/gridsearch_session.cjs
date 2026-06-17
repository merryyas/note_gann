// ─────────────────────────────────────────────────────────────────────────
//  짧은 시간대(1~2h) × EA 파라미터 그리드서치
//  시드 $1000 고정. 잔잔한 시간대만 운용 + 세션종료 시 전량청산 옵션.
//  목표: 6개월 청산 안 당하고 수익 내는 (세팅 + 시간대) 조합 찾기
// ─────────────────────────────────────────────────────────────────────────
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');
const SPREAD = 0.62;
const SEED = 1000;
const dir = process.argv[2] || './sec1';

console.error('로딩...');
let t0 = Date.now();
const bars = loadAllBars(dir);
console.error(`로드 ${bars.n}바 ${((Date.now()-t0)/1000).toFixed(1)}s`);

// 잔잔한 시간대 후보 (UTC 분). [startMin, endMin, 라벨]
//  KST = UTC+9.  KST 11:30 = UTC 02:30 = 150분.  KST 13:00 = UTC 04:00 = 240분.
const SESSIONS = [
  [150, 240, 'KST11:30-13:00 (UTC02:30-04:00)'],   // 사용자 지목 점심 + 최저변동 UTC03-04 포함
  [180, 240, 'KST12:00-13:00 (UTC03:00-04:00)'],   // 최저변동 1시간
  [180, 300, 'KST12:00-14:00 (UTC03:00-05:00)'],   // 점심 2시간
  [570, 630, 'KST18:30-19:30 (UTC09:30-10:30)'],   // 사용자 지목 유로장후
  [540, 660, 'KST18:00-20:00 (UTC09:00-11:00)'],   // 유로장후 2시간
  [600, 660, 'KST19:00-20:00 (UTC10:00-11:00)'],   // 잔잔 UTC10h
  [240, 300, 'KST13:00-14:00 (UTC04:00-05:00)'],   // 최저변동 UTC04h
];

// EA 파라미터 그리드 (생존 지향: 짧은 시간대라 더 공격적 가능 vs 보수적 비교)
const GRID = {
  tpPoints:  [100, 200, 300, 500],
  lotMult:   [1.3, 1.5, 2.0],
  interval:  [200, 300, 500],
  maxOrders: [5, 8, 12, 99],
  slUsd:     [0, 30],
  closeEnd:  [true, false],   // 세션종료 시 전량청산 여부
};

function* combos() {
  for (const tpPoints of GRID.tpPoints)
  for (const lotMult of GRID.lotMult)
  for (const interval of GRID.interval)
  for (const maxOrders of GRID.maxOrders)
  for (const slUsd of GRID.slUsd)
  for (const closeEnd of GRID.closeEnd)
    yield { tpPoints, lotMult, interval, maxOrders, slUsd, closeEnd };
}

const all = [];
for (const s of SESSIONS) for (const c of combos()) all.push({ sess: s, ...c });
console.error(`총 조합: ${all.length}개 (세션 ${SESSIONS.length} × 파라미터 ${all.length/SESSIONS.length})`);

const results = [];
t0 = Date.now();
for (let i = 0; i < all.length; i++) {
  const cb = all[i];
  const p = {
    seed: SEED, startLot: 0.01,
    tpPoints: cb.tpPoints, lotMult: cb.lotMult, interval: cb.interval,
    maxOrders: cb.maxOrders, slUsd: cb.slUsd,
    sessStartMin: cb.sess[0], sessEndMin: cb.sess[1],
    closeAtSessionEnd: cb.closeEnd,
  };
  const r = simulateFast(bars, p, SPREAD);
  results.push({
    session: cb.sess[2],
    tpPoints: cb.tpPoints, lotMult: cb.lotMult, interval: cb.interval,
    maxOrders: cb.maxOrders, slUsd: cb.slUsd, closeEnd: cb.closeEnd,
    pnl: r.pnl, balance: r.balance, baskets: r.baskets, winRate: r.winRate,
    maxDD: r.maxDD, maxConcurrent: r.maxConcurrent, liquidated: r.liquidated,
  });
  if ((i+1) % 500 === 0) console.error(`${i+1}/${all.length} (${((Date.now()-t0)/1000).toFixed(0)}s)`);
}
console.error(`완료 ${((Date.now()-t0)/1000).toFixed(0)}s`);

const survived = results.filter(r => !r.liquidated);
const profitable = survived.filter(r => r.pnl > 0).sort((a,b)=>b.pnl-a.pnl);
console.log(`\n총 ${results.length} | 생존 ${survived.length} | 생존+수익 ${profitable.length}`);

console.log('\n=== 생존+수익 TOP 25 (pnl 순) ===');
console.log('pnl$ | 거래수 | 승률 | DD$ | maxN | tp | mult | int | maxO | sl | 종료청산 | 시간대');
for (const r of profitable.slice(0,25)) {
  console.log([
    ('+'+r.pnl).padStart(8), String(r.baskets).padStart(5),
    (r.winRate+'%').padStart(5), String(Math.round(r.maxDD)).padStart(6),
    String(r.maxConcurrent).padStart(4), String(r.tpPoints).padStart(3),
    String(r.lotMult).padStart(3), String(r.interval).padStart(3),
    String(r.maxOrders).padStart(3), String(r.slUsd).padStart(2),
    (r.closeEnd?'Y':'N').padStart(2), r.session
  ].join(' | '));
}

require('fs').writeFileSync('./gridsearch_session_results.json', JSON.stringify(results));
console.error('\n저장: gridsearch_session_results.json');
