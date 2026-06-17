// 동일 기간(틱 받은 범위)에 대해 1초봉 vs 틱 결과 비교
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');
const { loadTicks, simulateTick } = require('./tick_verify.cjs');
const SPREAD = 0.62;

// 위험구간 중심(1월말~2월초)으로 좁혀 정밀 비교 (메모리 절약)
const FROM = '2026-01-26', TO = '2026-02-06';
console.error(`틱 로딩 ${FROM}~${TO}...`);
let t0=Date.now();
const T = loadTicks('./ticks', FROM, TO);
console.error(`틱 ${T.n.toLocaleString()}개 ${((Date.now()-t0)/1000).toFixed(1)}s`);

// 같은 기간 1초봉 로드 후 범위로 자르기
console.error('1초봉 로딩...');
const bars = loadAllBars('./sec1');
// 틱 시간범위로 1초봉 마스킹
const tMin = T.ts[0], tMax = T.ts[T.n-1];
let s=0,e=bars.n;
while(s<bars.n && bars.ts[s]<tMin)s++;
while(e>0 && bars.ts[e-1]>tMax)e--;
const sub = {
  ts: bars.ts.subarray(s,e), o: bars.o.subarray(s,e), h: bars.h.subarray(s,e),
  l: bars.l.subarray(s,e), c: bars.c.subarray(s,e), n: e-s
};
console.error(`1초봉(동기간) ${sub.n.toLocaleString()}바  범위 ${new Date(tMin).toISOString().slice(0,10)}~${new Date(tMax).toISOString().slice(0,10)}`);

const cands = [
  ['TOP1', {startLot:0.01,tpPoints:500,lotMult:1.3,interval:500,maxOrders:8, sessStartMin:570,sessEndMin:630,closeAtSessionEnd:true}],
  ['안전', {startLot:0.01,tpPoints:500,lotMult:1.5,interval:500,maxOrders:5, sessStartMin:600,sessEndMin:660,closeAtSessionEnd:true}],
  ['TOP2', {startLot:0.01,tpPoints:500,lotMult:2.0,interval:500,maxOrders:5, sessStartMin:600,sessEndMin:660,closeAtSessionEnd:true}],
  ['TOP5', {startLot:0.01,tpPoints:300,lotMult:1.5,interval:300,maxOrders:8, sessStartMin:570,sessEndMin:630,closeAtSessionEnd:true}],
];

console.log(`\n=== 1초봉 vs 틱 비교 (${FROM}~${TO}, 약 2개월) ===\n`);
console.log('조합 | 소스 | pnl$ | 거래 | 승률 | 청산 | maxDD$ | 최저eq$ | maxN');
for(const [label,p] of cands){
  const a = simulateFast(sub, {seed:1000,...p}, SPREAD);
  const b = simulateTick(T, {seed:1000,...p});
  console.log(`${label} | 1초봉 | ${String(a.pnl).padStart(8)} | ${String(a.baskets).padStart(4)} | ${(a.winRate+'%').padStart(5)} | ${a.liquidated?'💀':'✅'} | ${String(Math.round(a.maxDD)).padStart(5)} |    -   | ${a.maxConcurrent}`);
  console.log(`${label} | 틱   | ${String(b.pnl).padStart(8)} | ${String(b.baskets).padStart(4)} | ${(b.winRate+'%').padStart(5)} | ${b.liquidated?'💀':'✅'} | ${String(Math.round(b.maxDD)).padStart(5)} | ${String(Math.round(b.minEq)).padStart(5)} | ${b.maxConcurrent}`);
  console.log('');
}
