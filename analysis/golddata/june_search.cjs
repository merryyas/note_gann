// 6월(6/1~현재) 단일기간 $1000 수익 세팅/시간대 탐색.
// 월요일 제외(화~금) + 비교용으로 월요일 포함도 같이.
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');
const SPREAD=0.62;
const full=loadAllBars(process.argv[2]||'./sec1');
function D(s){return new Date(s+'T00:00:00Z').getTime();}
function slice(b,t0,t1){const{ts}=b;let i0=0,i1=b.n;while(i0<b.n&&ts[i0]<t0)i0++;while(i1>0&&ts[i1-1]>=t1)i1--;return{ts:ts.subarray(i0,i1),o:b.o.subarray(i0,i1),h:b.h.subarray(i0,i1),l:b.l.subarray(i0,i1),c:b.c.subarray(i0,i1),n:i1-i0};}
const june=slice(full,D('2026-06-01'),D('2026-07-01'));
console.error(`6월 바 ${june.n.toLocaleString()} (${new Date(june.ts[0]).toISOString().slice(0,10)}~${new Date(june.ts[june.n-1]).toISOString().slice(0,10)})`);
for(const k of ['ts','o','h','l','c']) full[k]=null;

const SESSIONS=[
  ['점심 11:30-13:00',150,240],
  ['오후 13:00-14:30',240,330],
  ['저녁 18:30-19:30',570,630],
  ['저녁 18:00-19:30',540,630],
  ['저녁 19:00-20:00',600,660],
  ['저녁 18:30-20:00',570,690],
  ['오전 10:00-11:30',60,150],
];
const TP=[200,300,500], MULT=[1.3,1.5,2.0], INT=[200,300,500], MAXO=[5,8,12];

function run(skipMon){
  const res=[];
  for(const [sname,ss,se] of SESSIONS){
    for(const tp of TP) for(const m of MULT) for(const it of INT) for(const mo of MAXO){
      const base={seed:1000,startLot:0.01,tpPoints:tp,lotMult:m,interval:it,maxOrders:mo,slUsd:0,sessStartMin:ss,sessEndMin:se,closeAtSessionEnd:true};
      if(skipMon)base.skipDow=[1];
      const r=simulateFast(june,base,SPREAD);
      res.push({sname,tp,m,it,mo,pnl:Math.round(r.pnl),liq:r.liquidated,minEq:Math.round(r.minEq),dd:Math.round(r.maxDD),wr:r.winRate,maxN:r.maxConcurrent,baskets:r.baskets});
    }
  }
  return res;
}

function report(title,res){
  const profit=res.filter(r=>!r.liq && r.pnl>0).sort((a,b)=>b.pnl-a.pnl);
  const liqCnt=res.filter(r=>r.liq).length;
  console.log(`\n======== ${title} (${res.length}조합) ========`);
  console.log(`청산 ${liqCnt} · 수익(+) ${profit.length} · 손실/0 ${res.length-liqCnt-profit.length}`);
  console.log('순위 손익   최저eq DD    승률  N  세팅');
  profit.slice(0,15).forEach((r,i)=>{
    console.log(`${String(i+1).padStart(2)} +$${String(r.pnl).padStart(4)} $${String(r.minEq).padStart(4)} $${String(r.dd).padStart(4)} ${String(r.wr).padStart(5)}% ${String(r.maxN).padStart(2)}  ${r.sname} tp${r.tp}/m${r.m}/int${r.it}/o${r.mo}`);
  });
  if(profit.length===0)console.log('  (수익 조합 없음)');
}

console.log('=== 6월(6/1~6/15) 단일기간 $1000 운영 탐색 ===');
report('월요일 제외 (화~금)', run(true));
report('전 요일 (월~금)', run(false));
