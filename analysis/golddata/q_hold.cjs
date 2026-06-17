// 세션종료 포지션 처리 3모드 비교 (3-5월 고수익 세팅들)
//  모드1 강제청산: closeAtSessionEnd=true
//  모드2 끌고가기: closeAtSessionEnd=false (세션밖 진입X, 보유는 TP까지 유지)
//  모드3 24시간 : 세션필터 제거 (항상 진입)
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');
const SPREAD = 0.62;
const full = loadAllBars(process.argv[2] || './sec1');
function slice(a,b){let s=0,e=full.n;while(s<full.n&&full.ts[s]<a)s++;while(e>0&&full.ts[e-1]>=b)e--;
  return {ts:full.ts.subarray(s,e),o:full.o.subarray(s,e),h:full.h.subarray(s,e),l:full.l.subarray(s,e),c:full.c.subarray(s,e),n:e-s};}
const D=s=>Date.parse(s+'T00:00:00Z');
const P = slice(D('2026-03-01'),D('2026-06-01')); // 3-5월

// 3-5월 고수익 TOP 세팅들
const cands = [
  ['고수익A', {tpPoints:500,lotMult:2.0,interval:200,maxOrders:8, sessStartMin:570,sessEndMin:630, skipDow:[1]}], // KST18:30-19:30
  ['고수익B', {tpPoints:300,lotMult:1.5,interval:200,maxOrders:12,sessStartMin:150,sessEndMin:240, skipDow:[1]}], // KST11:30-13:00
  ['균형C',   {tpPoints:300,lotMult:1.5,interval:300,maxOrders:12,sessStartMin:150,sessEndMin:240, skipDow:[1]}],
  ['안전D',   {tpPoints:500,lotMult:2.0,interval:500,maxOrders:8, sessStartMin:180,sessEndMin:240, skipDow:[1]}], // KST12-13
];

function fmt(r){return r.liquidated?'💀청산'.padStart(8):('$'+Math.round(r.pnl)).padStart(8);}
console.log('=== 3-5월 세션종료 포지션 처리 3모드 비교 (시드$1000) ===\n');
console.log('세팅 | 모드 | pnl$ | 거래 | 승률 | 청산 | maxDD$ | maxN');
for(const [label,p] of cands){
  const base={seed:1000,startLot:0.01,slUsd:0,...p};
  const m1=simulateFast(P,{...base,closeAtSessionEnd:true},SPREAD);
  const m2=simulateFast(P,{...base,closeAtSessionEnd:false},SPREAD);
  // 24시간: 세션 분필터 제거(진입 항상), 월요일제외는 유지
  const {sessStartMin,sessEndMin,...noSess}=base;
  const m3=simulateFast(P,{...noSess,closeAtSessionEnd:false},SPREAD);
  console.log(`${label} | 강제청산 | ${fmt(m1)} | ${String(m1.baskets).padStart(4)} | ${(m1.winRate+'%').padStart(5)} | ${m1.liquidated?'💀':'✅'} | ${String(Math.round(m1.maxDD)).padStart(5)} | ${m1.maxConcurrent}`);
  console.log(`${label} | 끌고가기 | ${fmt(m2)} | ${String(m2.baskets).padStart(4)} | ${(m2.winRate+'%').padStart(5)} | ${m2.liquidated?'💀':'✅'} | ${String(Math.round(m2.maxDD)).padStart(5)} | ${m2.maxConcurrent}`);
  console.log(`${label} | 24시간   | ${fmt(m3)} | ${String(m3.baskets).padStart(4)} | ${(m3.winRate+'%').padStart(5)} | ${m3.liquidated?'💀':'✅'} | ${String(Math.round(m3.maxDD)).padStart(5)} | ${m3.maxConcurrent}`);
  console.log('');
}
