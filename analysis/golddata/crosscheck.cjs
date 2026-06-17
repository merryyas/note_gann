// 두 독립 엔진(engine_fast vs engine_verify) 결과 교차대조
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');
const { simulateVerify } = require('./engine_verify.cjs');
const SPREAD = 0.62;

console.error('로딩...');
const bars = loadAllBars(process.argv[2] || './sec1');
console.error(`로드 ${bars.n}바`);

// TOP 후보들 (gridsearch_session 결과 상위) + 무작위 조합
const cases = [
  // [라벨, 파라미터]
  ['TOP1 +1280', {tpPoints:500,lotMult:1.3,interval:500,maxOrders:8, sessStartMin:570,sessEndMin:630,closeAtSessionEnd:true}],
  ['TOP2 +892',  {tpPoints:500,lotMult:2.0,interval:500,maxOrders:5, sessStartMin:600,sessEndMin:660,closeAtSessionEnd:true}],
  ['TOP3 +705',  {tpPoints:500,lotMult:2.0,interval:300,maxOrders:5, sessStartMin:240,sessEndMin:300,closeAtSessionEnd:true}],
  ['TOP5 +619',  {tpPoints:300,lotMult:1.5,interval:300,maxOrders:8, sessStartMin:570,sessEndMin:630,closeAtSessionEnd:true}],
  ['안전 +516',  {tpPoints:500,lotMult:1.5,interval:500,maxOrders:5, sessStartMin:600,sessEndMin:660,closeAtSessionEnd:true}],
  ['종료청산X',  {tpPoints:500,lotMult:1.3,interval:500,maxOrders:8, sessStartMin:570,sessEndMin:630,closeAtSessionEnd:false}],
  ['SL30 적용',  {tpPoints:300,lotMult:1.5,interval:300,maxOrders:8, slUsd:30, sessStartMin:570,sessEndMin:630,closeAtSessionEnd:true}],
  ['시간세션',   {tpPoints:200,lotMult:1.5,interval:300,maxOrders:8, sessStartUTC:9,sessEndUTC:11,closeAtSessionEnd:true}],
  ['세션없음',   {tpPoints:200,lotMult:1.5,interval:300,maxOrders:8}],
];

let allMatch = true;
const keys = ['pnl','balance','baskets','trades','wins','losses','liquidated','maxDD','maxConcurrent'];
for (const [label, params] of cases) {
  const p = { seed:1000, startLot:0.01, ...params };
  const a = simulateFast(bars, p, SPREAD);
  const b = simulateVerify(bars, p, SPREAD);
  let match = true;
  const diffs = [];
  for (const k of keys) {
    const va = a[k], vb = b[k];
    const eq = (typeof va === 'number') ? Math.abs(va - vb) < 0.01 : va === vb;
    if (!eq) { match = false; diffs.push(`${k}: fast=${va} verify=${vb}`); }
  }
  if (!match) allMatch = false;
  console.log(`${match?'✅ 일치':'❌ 불일치'} | ${label.padEnd(12)} | fast: pnl=${a.pnl} bask=${a.baskets} liq=${a.liquidated} DD=${a.maxDD}`);
  if (!match) diffs.forEach(d => console.log(`     ⚠ ${d}`));
}
console.log('\n' + (allMatch ? '🎉 모든 케이스 두 엔진 결과 완전 일치 — 시뮬레이션 검증됨' : '🚨 불일치 발견 — 로직 점검 필요'));
