// 세션 1개만 처리하여 결과를 allprofit_results.json에 append.
// usage: node mp_one.cjs <세션인덱스> [sec1dir]
// 세션 0~5 까지 6번 실행하면 전체 완료. 각 실행은 1세션(24조합×5달)만 → 280초 내 완료.
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');
const fs=require('fs');
const SPREAD=0.62;
const SIDX=parseInt(process.argv[2]);
const DIR=process.argv[3]||'./sec1';
const RESFILE='./allprofit_results.json';

const SESSIONS=[
  ['점심 11:30-13:00',150,240],
  ['오후 13:00-14:30',240,330],
  ['저녁 18:30-19:30',570,630],
  ['저녁 18:00-19:30',540,630],
  ['저녁 19:00-20:00',600,660],
  ['오전 10:00-11:30',60,150],
];
if(SIDX<0||SIDX>=SESSIONS.length){console.error('bad index');process.exit(1);}
const [sname,ss,se]=SESSIONS[SIDX];

const tL=Date.now();
const full=loadAllBars(DIR);
console.error(`[load ${((Date.now()-tL)/1000).toFixed(1)}s] 세션 ${sname}`);
function D(s){return new Date(s+'T00:00:00Z').getTime();}
function slice(b,t0,t1){const{ts}=b;let i0=0,i1=b.n;while(i0<b.n&&ts[i0]<t0)i0++;while(i1>0&&ts[i1-1]>=t1)i1--;return{ts:ts.subarray(i0,i1),o:b.o.subarray(i0,i1),h:b.h.subarray(i0,i1),l:b.l.subarray(i0,i1),c:b.c.subarray(i0,i1),n:i1-i0};}
const MONTHS=[['1월','2026-01-01','2026-02-01'],['2월','2026-02-01','2026-03-01'],['3월','2026-03-01','2026-04-01'],['4월','2026-04-01','2026-05-01'],['5월','2026-05-01','2026-06-01']];
const MB=MONTHS.map(([k,a,b])=>({k,bars:slice(full,D(a),D(b))}));

const TP=[200,300,500], MULT=[1.3,1.5], INT=[300,500], MAXO=[8,12];
const out=[];
const t0=Date.now();
for(const tp of TP) for(const m of MULT) for(const it of INT) for(const mo of MAXO){
  const base={seed:1000,startLot:0.01,tpPoints:tp,lotMult:m,interval:it,maxOrders:mo,slUsd:0,sessStartMin:ss,sessEndMin:se,closeAtSessionEnd:true,skipDow:[1]};
  let anyLiq=false,sumPnl=0,minEqAll=1e9,negMonths=0,pm=[];
  for(const mm of MB){
    const r=simulateFast(mm.bars,base,SPREAD);
    pm.push({k:mm.k,pnl:Math.round(r.pnl),liq:r.liquidated});
    sumPnl+=r.pnl;
    if(r.minEq<minEqAll)minEqAll=r.minEq;
    if(r.liquidated)anyLiq=true; else if(r.pnl<=0)negMonths++;
  }
  out.push({sname,tp,m,it,mo,anyLiq,sumPnl:Math.round(sumPnl),minEqAll:Math.round(minEqAll),negMonths,pm});
}
console.error(`세션 ${sname} 완료 ${((Date.now()-t0)/1000).toFixed(1)}s, ${out.length}조합`);

let prev=[];
if(fs.existsSync(RESFILE)){try{prev=JSON.parse(fs.readFileSync(RESFILE,'utf8'));}catch(e){}}
prev=prev.filter(r=>r.sname!==sname); // 같은 세션 재실행시 갱신
prev.push(...out);
fs.writeFileSync(RESFILE,JSON.stringify(prev));
console.error(`저장: 총 ${prev.length}조합`);
