// "1~5월 각 달 독립 $1000 → 5달 전부 흑자(+)" 세팅/시간대 전수탐색.
// 월요일 제외(화~금). 한 번만 시뮬, 결과 캐싱 후 통과/차선 분류.
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');
const SPREAD=0.62;
const _lt=Date.now();
const full = loadAllBars(process.argv[2]||'./sec1');
process.stderr.write(`[load] ${((Date.now()-_lt)/1000).toFixed(1)}s, ${full.n} bars\n`);
function D(s){return new Date(s+'T00:00:00Z').getTime();}
function slice(b,t0,t1){const{ts}=b;let i0=0,i1=b.n;while(i0<b.n&&ts[i0]<t0)i0++;while(i1>0&&ts[i1-1]>=t1)i1--;return{ts:ts.subarray(i0,i1),o:b.o.subarray(i0,i1),h:b.h.subarray(i0,i1),l:b.l.subarray(i0,i1),c:b.c.subarray(i0,i1),n:i1-i0};}
const MONTHS=[
  {k:'1월',t0:D('2026-01-01'),t1:D('2026-02-01')},
  {k:'2월',t0:D('2026-02-01'),t1:D('2026-03-01')},
  {k:'3월',t0:D('2026-03-01'),t1:D('2026-04-01')},
  {k:'4월',t0:D('2026-04-01'),t1:D('2026-05-01')},
  {k:'5월',t0:D('2026-05-01'),t1:D('2026-06-01')},
];
// subarray 뷰 사용 (추가 메모리 0). full을 그대로 유지.
const MB=MONTHS.map(m=>({...m,bars:slice(full,m.t0,m.t1)}));
process.stderr.write(`[sliced] 월별 바 준비완료\n`);

const SESSIONS=[
  ['점심 11:30-13:00',150,240],
  ['오후 13:00-14:30',240,330],
  ['저녁 18:30-19:30',570,630],
  ['저녁 18:00-19:30',540,630],
  ['저녁 19:00-20:00',600,660],
  ['오전 10:00-11:30',60,150],
];
const TP=[200,300,500], MULT=[1.3,1.5], INT=[300,500], MAXO=[8,12];

let tested=0, results=[];
const t0=Date.now();
for(const [sname,ss,se] of SESSIONS){
  const sStart=Date.now();
  process.stderr.write(`[${((Date.now()-t0)/1000).toFixed(0)}s] 세션 ${sname} 시작\n`);
  for(const tp of TP) for(const m of MULT) for(const it of INT) for(const mo of MAXO){
    tested++;
    const base={seed:1000,startLot:0.01,tpPoints:tp,lotMult:m,interval:it,maxOrders:mo,slUsd:0,sessStartMin:ss,sessEndMin:se,closeAtSessionEnd:true,skipDow:[1]};
    let anyLiq=false,sumPnl=0,minEqAll=1e9,negMonths=0,pm=[];
    for(const mm of MB){
      const r=simulateFast(mm.bars,base,SPREAD);
      pm.push({k:mm.k,pnl:Math.round(r.pnl),liq:r.liquidated});
      sumPnl+=r.pnl;
      if(r.minEq<minEqAll)minEqAll=r.minEq;
      if(r.liquidated)anyLiq=true; else if(r.pnl<=0)negMonths++;
    }
    results.push({sname,tp,m,it,mo,anyLiq,sumPnl:Math.round(sumPnl),minEqAll:Math.round(minEqAll),negMonths,pm});
  }
  console.error(`[${tested}조합 누적] ${sname} 완료 (+${((Date.now()-sStart)/1000).toFixed(1)}s)`);
}
console.log(`탐색 ${tested}조합, 소요 ${((Date.now()-t0)/1000).toFixed(1)}s\n`);

const allPos = results.filter(r=>!r.anyLiq && r.negMonths===0);
function fmt(r){const months=r.pm.map(p=>(p.pnl>=0?'+':'')+p.pnl).join('/');return `${r.sname} tp${r.tp}/m${r.m}/int${r.it}/o${r.mo}`.padEnd(34)+` [${months}]`;}

if(allPos.length){
  allPos.sort((a,b)=>b.sumPnl-a.sumPnl);
  console.log(`✅ 5달 전부 흑자(+) & 청산0 조합 ${allPos.length}개 발견!\n`);
  console.log('순위 누적     최저eq  세팅 / 월별(1~5월)');
  allPos.slice(0,25).forEach((r,i)=>{
    console.log(`${String(i+1).padStart(2)} +$${String(r.sumPnl).padStart(5)} $${String(r.minEqAll).padStart(4)}  ${fmt(r)}`);
  });
}else{
  console.log('❌ 5달 전부 흑자(+) 조합 없음 (보수 범위 내).\n');
}

// 항상 차선책도 표시: 청산0 + 손실달 최소 + 누적최대
const safe=results.filter(r=>!r.anyLiq);
safe.sort((a,b)=> a.negMonths-b.negMonths || b.sumPnl-a.sumPnl);
console.log(`\n=== 청산0 세팅 ${safe.length}개 중 [손실달 최소→누적최대] TOP15 ===`);
console.log('손실달 누적     최저eq  세팅 / 월별(1~5월)');
safe.slice(0,15).forEach(r=>{
  console.log(`${r.negMonths}달  +$${String(r.sumPnl).padStart(5)} $${String(r.minEqAll).padStart(4)}  ${fmt(r)}`);
});
