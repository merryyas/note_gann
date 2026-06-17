// 아이디어1: 월초/월말/특정요일 제외가 안정성·수익을 높이는가?
// 기준 TOP 후보들 × 다양한 제외패턴. 시드 $1000 고정, 전기간(1~6월).
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');
const SPREAD = 0.62;
const bars = loadAllBars(process.argv[2] || './sec1');

// 기준 세팅들 (gridsearch_session 상위 + 안전형)
const bases = [
  ['TOP1', {startLot:0.01,tpPoints:500,lotMult:1.3,interval:500,maxOrders:8, sessStartMin:570,sessEndMin:630,closeAtSessionEnd:true}],
  ['안전', {startLot:0.01,tpPoints:500,lotMult:1.5,interval:500,maxOrders:5, sessStartMin:600,sessEndMin:660,closeAtSessionEnd:true}],
  ['TOP5', {startLot:0.01,tpPoints:300,lotMult:1.5,interval:300,maxOrders:8, sessStartMin:570,sessEndMin:630,closeAtSessionEnd:true}],
];

// 제외 패턴들
const skips = [
  ['제외없음(기준)', {}],
  ['월초1-2', {skipDom:[1,2]}],
  ['월말29-31', {skipDom:[29,30,31]}],
  ['월말28-31', {skipDom:[28,29,30,31]}],
  ['월초말 1-2,29-31', {skipDom:[1,2,29,30,31]}],
  ['월초말 1-3,28-31', {skipDom:[1,2,3,28,29,30,31]}],
  ['금요일제외', {skipDow:[5]}],
  ['월요일제외', {skipDow:[1]}],
  ['월금제외', {skipDow:[1,5]}],
];

console.log('=== 아이디어1: 특정일 제외 효과 (전기간 1~6월, 시드$1000) ===\n');
for (const [blabel, bp] of bases) {
  console.log(`■ ${blabel} (tp${bp.tpPoints} mult${bp.lotMult} int${bp.interval} max${bp.maxOrders})`);
  console.log('  제외패턴 | pnl$ | 거래 | 승률 | 청산 | maxDD$');
  for (const [slabel, sp] of skips) {
    const r = simulateFast(bars, {seed:1000, ...bp, ...sp}, SPREAD);
    const mark = r.liquidated ? '💀' : (r.pnl>0?'✅':'➖');
    console.log(`  ${slabel.padEnd(16)} | ${String(r.pnl).padStart(8)} | ${String(r.baskets).padStart(4)} | ${(r.winRate+'%').padStart(5)} | ${mark} | ${String(Math.round(r.maxDD)).padStart(6)}`);
  }
  console.log('');
}
