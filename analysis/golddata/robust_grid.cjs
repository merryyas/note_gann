// 강건 그리드서치: 1-2월 / 3-5월 / 전기간 3개 구간 모두에서 생존+수익인 세팅만 통과.
// 시드$1000, 세션종료청산O, 월요일제외 비교.
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');
const SPREAD = 0.62;
const full = loadAllBars(process.argv[2] || './sec1');
function slice(a,b){let s=0,e=full.n;while(s<full.n&&full.ts[s]<a)s++;while(e>0&&full.ts[e-1]>=b)e--;
  return {ts:full.ts.subarray(s,e),o:full.o.subarray(s,e),h:full.h.subarray(s,e),l:full.l.subarray(s,e),c:full.c.subarray(s,e),n:e-s};}
const D=s=>Date.parse(s+'T00:00:00Z');
const P1=slice(D('2026-01-01'),D('2026-03-01')); // 1-2월
const P2=slice(D('2026-03-01'),D('2026-06-01')); // 3-5월
const PA=slice(D('2026-01-01'),D('2026-06-16')); // 전기간
console.error(`1-2월 ${P1.n} | 3-5월 ${P2.n} | 전 ${PA.n}`);

const SESSIONS=[
  [150,240,'KST11:30-13:00'],[180,240,'KST12-13'],[180,300,'KST12-14'],
  [570,630,'KST18:30-19:30'],[540,660,'KST18-20'],[600,660,'KST19-20'],[240,300,'KST13-14'],
];
const GRID={tpPoints:[200,300,500],lotMult:[1.3,1.5,2.0],interval:[300,500],maxOrders:[5,8,12]};
const robust=[];
let cnt=0;
for(const sess of SESSIONS)
for(const tpPoints of GRID.tpPoints)
for(const lotMult of GRID.lotMult)
for(const interval of GRID.interval)
for(const maxOrders of GRID.maxOrders)
for(const skipMon of [true,false]){
  cnt++;
  const p={seed:1000,startLot:0.01,tpPoints,lotMult,interval,maxOrders,slUsd:0,
    sessStartMin:sess[0],sessEndMin:sess[1],closeAtSessionEnd:true,skipDow:skipMon?[1]:null};
  const r1=simulateFast(P1,p,SPREAD); if(r1.liquidated)continue;
  const r2=simulateFast(P2,p,SPREAD); if(r2.liquidated)continue;
  const rA=simulateFast(PA,p,SPREAD); if(rA.liquidated)continue;
  if(r1.pnl<=0||r2.pnl<=0||rA.pnl<=0)continue; // 모든 구간 수익
  robust.push({session:sess[2],tpPoints,lotMult,interval,maxOrders,skipMon,
    p1:r1.pnl,p2:r2.pnl,pa:rA.pnl, dd1:r1.maxDD,dd2:r2.maxDD,ddA:rA.maxDD,
    minPnl:Math.min(r1.pnl,r2.pnl,rA.pnl), maxDDall:Math.max(r1.maxDD,r2.maxDD,rA.maxDD),
    wrA:rA.winRate, concA:rA.maxConcurrent, totA:rA.baskets});
}
console.error(`검사 ${cnt}조합 → 전구간 생존+수익 ${robust.length}개`);

// 최소수익(가장 약한 구간) 큰 순 = 가장 일관된 강건
const byMin=[...robust].sort((a,b)=>b.minPnl-a.minPnl);
console.log(`\n=== 모든 구간 생존+수익한 강건 세팅 ${robust.length}개 ===`);
console.log('\n[A] 가장 일관됨(최약구간 수익 큰 순) TOP 12:');
hdr();byMin.slice(0,12).forEach(row);
const bySafe=[...robust].sort((a,b)=>a.maxDDall-b.maxDDall);
console.log('\n[B] 가장 안전함(전구간 최대DD 작은 순) TOP 12:');
hdr();bySafe.slice(0,12).forEach(row);
function hdr(){console.log('전기간$ | 1-2월$ | 3-5월$ | 최대DD$ | 승률 | maxN | tp | mult | int | maxO | 월제외 | 시간대');}
function row(r){console.log([('+'+Math.round(r.pa)).padStart(7),('+'+Math.round(r.p1)).padStart(6),('+'+Math.round(r.p2)).padStart(6),
  String(Math.round(r.maxDDall)).padStart(6),(r.wrA+'%').padStart(5),String(r.concA).padStart(4),
  String(r.tpPoints).padStart(3),String(r.lotMult).padStart(3),String(r.interval).padStart(3),
  String(r.maxOrders).padStart(2),(r.skipMon?'Y':'N').padStart(2),r.session].join(' | '));}
require('fs').writeFileSync('./robust_results.json',JSON.stringify(robust));
