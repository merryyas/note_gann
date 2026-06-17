// 틱만 로드해서 위험구간 정밀 시뮬 (1초봉 로드 제외 → 메모리/속도 절약)
const { loadTicks, simulateTick } = require('./tick_verify.cjs');
const FROM = process.argv[2] || '2026-01-26', TO = process.argv[3] || '2026-02-06';
console.error(`틱 로딩 ${FROM}~${TO}...`);
let t0=Date.now();
const T = loadTicks('./ticks', FROM, TO);
console.error(`틱 ${T.n.toLocaleString()}개 ${((Date.now()-t0)/1000).toFixed(1)}s, 범위 ${new Date(T.ts[0]).toISOString().slice(0,16)}~${new Date(T.ts[T.n-1]).toISOString().slice(0,16)}`);

const cands = [
  ['TOP1', {startLot:0.01,tpPoints:500,lotMult:1.3,interval:500,maxOrders:8, sessStartMin:570,sessEndMin:630,closeAtSessionEnd:true}],
  ['안전', {startLot:0.01,tpPoints:500,lotMult:1.5,interval:500,maxOrders:5, sessStartMin:600,sessEndMin:660,closeAtSessionEnd:true}],
  ['TOP2', {startLot:0.01,tpPoints:500,lotMult:2.0,interval:500,maxOrders:5, sessStartMin:600,sessEndMin:660,closeAtSessionEnd:true}],
  ['TOP5', {startLot:0.01,tpPoints:300,lotMult:1.5,interval:300,maxOrders:8, sessStartMin:570,sessEndMin:630,closeAtSessionEnd:true}],
];
console.log(`\n=== 틱 정밀 시뮬 (${FROM}~${TO}) | 시드$1000 ===`);
console.log('조합 | pnl$ | 거래 | 승률 | 청산 | maxDD$ | 최저eq$ | maxN');
for(const [label,p] of cands){
  const b = simulateTick(T, {seed:1000,...p});
  console.log(`${label} | ${String(b.pnl).padStart(8)} | ${String(b.baskets).padStart(4)} | ${(b.winRate+'%').padStart(5)} | ${b.liquidated?'💀청산':'✅생존'} | ${String(Math.round(b.maxDD)).padStart(5)} | ${String(Math.round(b.minEq)).padStart(5)} | ${b.maxConcurrent}`);
}
