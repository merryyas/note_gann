// Q2: 손절 구조 분석.
// (1) 청산이 "1번 패배"인지 "누적 평가손실 마진콜"인지 — 패배 바스켓 손익분포 확인
// (2) 통합SL(slUsd)을 넣으면 수익/생존이 어떻게 변하나
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');
const SPREAD = 0.62;
const full = loadAllBars(process.argv[2] || './sec1');

// 대표 강건세팅: 종합최우수
const base = {seed:1000,startLot:0.01,tpPoints:500,lotMult:1.3,interval:300,maxOrders:12,
  sessStartMin:570,sessEndMin:630,closeAtSessionEnd:true,skipDow:[1]};

console.log('=== Q2-(2): 통합SL 효과 (종합최우수 세팅, KST18:30-19:30, 전기간) ===');
console.log('SL설정 | pnl$ | 거래 | 승 | 패 | 승률 | 청산 | maxDD$');
for (const sl of [0, 20, 30, 50, 100, 200]) {
  const r = simulateFast(full, {...base, slUsd:sl}, SPREAD);
  console.log(`SL $${String(sl).padStart(3)} | ${(r.liquidated?'💀':'$'+Math.round(r.pnl)).padStart(7)} | ${String(r.baskets).padStart(4)} | ${String(r.wins).padStart(4)} | ${String(r.losses).padStart(3)} | ${(r.winRate+'%').padStart(5)} | ${r.liquidated?'💀':'✅'} | ${String(Math.round(r.maxDD)).padStart(5)}`);
}

// 안전세팅에도 SL 적용 비교
console.log('\n=== 안전세팅 (tp500 mult1.5 int500 max5, KST19-20)에서 SL 효과 ===');
const safe = {seed:1000,startLot:0.01,tpPoints:500,lotMult:1.5,interval:500,maxOrders:5,
  sessStartMin:600,sessEndMin:660,closeAtSessionEnd:true,skipDow:[1]};
console.log('SL설정 | pnl$ | 거래 | 승 | 패 | 승률 | 청산 | maxDD$');
for (const sl of [0, 20, 30, 50, 100, 200]) {
  const r = simulateFast(full, {...safe, slUsd:sl}, SPREAD);
  console.log(`SL $${String(sl).padStart(3)} | ${(r.liquidated?'💀':'$'+Math.round(r.pnl)).padStart(7)} | ${String(r.baskets).padStart(4)} | ${String(r.wins).padStart(4)} | ${String(r.losses).padStart(3)} | ${(r.winRate+'%').padStart(5)} | ${r.liquidated?'💀':'✅'} | ${String(Math.round(r.maxDD)).padStart(5)}`);
}
