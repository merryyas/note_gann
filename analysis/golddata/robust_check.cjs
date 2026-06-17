// 강건성 검증(out-of-sample): 3~5월 우수세팅을 1~2월/전기간에 역적용.
// "어느 기간에도 청산 안 되고 수익"인 세팅만 진짜 강건.
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');
const SPREAD = 0.62;

const full = loadAllBars(process.argv[2] || './sec1');
function slice(fromMs, toMs){
  let s=0,e=full.n;
  while(s<full.n && full.ts[s]<fromMs)s++;
  while(e>0 && full.ts[e-1]>=toMs)e--;
  return { ts:full.ts.subarray(s,e), o:full.o.subarray(s,e), h:full.h.subarray(s,e), l:full.l.subarray(s,e), c:full.c.subarray(s,e), n:e-s };
}
const D = s=>Date.parse(s+'T00:00:00Z');
const periods = {
  '1-2월(미검증)': slice(D('2026-01-01'), D('2026-03-01')),
  '3-5월(학습)':   slice(D('2026-03-01'), D('2026-06-01')),
  '전기간':        slice(D('2026-01-01'), D('2026-06-16')),
};
for(const [k,b] of Object.entries(periods)) console.error(`${k}: ${b.n.toLocaleString()}바`);

// 검증할 후보: 고수익형 + 안전형 (3~5월 상위에서 선별, 월요일제외 위주)
const cands = [
  ['고수익A', {tpPoints:500,lotMult:2.0,interval:200,maxOrders:8, sessStartMin:570,sessEndMin:630, skipDow:[1]}],   // KST18:30-19:30
  ['고수익B', {tpPoints:300,lotMult:1.5,interval:200,maxOrders:12,sessStartMin:150,sessEndMin:240, skipDow:[1]}],   // KST11:30-13:00
  ['균형C',   {tpPoints:300,lotMult:1.5,interval:300,maxOrders:12,sessStartMin:150,sessEndMin:240, skipDow:[1]}],
  ['안전D',   {tpPoints:500,lotMult:2.0,interval:500,maxOrders:8, sessStartMin:180,sessEndMin:240, skipDow:[1]}],   // KST12-13
  ['안전E',   {tpPoints:300,lotMult:2.0,interval:500,maxOrders:8, sessStartMin:180,sessEndMin:240, skipDow:[1]}],
  ['안전F',   {tpPoints:500,lotMult:1.5,interval:500,maxOrders:8, sessStartMin:180,sessEndMin:240, skipDow:[1]}],
  // 1~6월 전기간 TOP1(월요일제외)도 재확인
  ['전기간TOP1', {tpPoints:500,lotMult:1.3,interval:500,maxOrders:8, sessStartMin:570,sessEndMin:630, skipDow:[1]}],
];

console.log('\n=== 강건성 검증 (시드$1000, 모두 세션종료청산O + 월요일제외) ===');
for(const [label,p] of cands){
  const full = {seed:1000,startLot:0.01,closeAtSessionEnd:true,slUsd:0,...p};
  const parts = [];
  let allSurvive = true;
  for(const [pk,b] of Object.entries(periods)){
    const r = simulateFast(b, full, SPREAD);
    if(r.liquidated) allSurvive=false;
    parts.push(`${pk}: ${r.liquidated?'💀청산':'$'+r.pnl+'(DD$'+Math.round(r.maxDD)+')'}`);
  }
  console.log(`\n${allSurvive?'✅강건':'❌취약'} ${label} [tp${p.tpPoints} mult${p.lotMult} int${p.interval} max${p.maxOrders} ${p.sessStartMin/60|0}:${String(p.sessStartMin%60).padStart(2,'0')}-]`);
  parts.forEach(x=>console.log('   '+x));
}
