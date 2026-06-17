// 6월 상위 세팅을 1~5월 각 달 독립 $1000에 역검증 → 6월 과최적화 판별.
// + 6월 자체(최신 6/1~6/17)도 같이 재확인.
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');
const SPREAD=0.62;
const full=loadAllBars(process.argv[2]||'./sec1');
function D(s){return new Date(s+'T00:00:00Z').getTime();}
function slice(b,t0,t1){const{ts}=b;let i0=0,i1=b.n;while(i0<b.n&&ts[i0]<t0)i0++;while(i1>0&&ts[i1-1]>=t1)i1--;return{ts:ts.subarray(i0,i1),o:b.o.subarray(i0,i1),h:b.h.subarray(i0,i1),l:b.l.subarray(i0,i1),c:b.c.subarray(i0,i1),n:i1-i0};}
const PERIODS=[
  ['1월','2026-01-01','2026-02-01'],['2월','2026-02-01','2026-03-01'],
  ['3월','2026-03-01','2026-04-01'],['4월','2026-04-01','2026-05-01'],
  ['5월','2026-05-01','2026-06-01'],['6월','2026-06-01','2026-07-01'],
];
const PB=PERIODS.map(([k,a,b])=>({k,bars:slice(full,D(a),D(b))}));
PB.forEach(p=>console.error(`${p.k}: ${p.bars.n.toLocaleString()}바`));

const SESS={
  '점심 11:30-13:00':[150,240],'오후 13:00-14:30':[240,330],
  '저녁 18:30-19:30':[570,630],'저녁 18:00-19:30':[540,630],
  '저녁 18:30-20:00':[570,690],'저녁 19:00-20:00':[600,660],
  '오전 10:00-11:30':[60,150],
};
// 6월 탐색 상위 세팅들 (월제외 기준 TOP) + 6월 안정형
const CASES=[
  {tag:'6월1위 저녁18:00-19:30 tp500/m2/int200/o8', s:'저녁 18:00-19:30',tp:500,m:2.0,it:200,mo:8},
  {tag:'6월3위 저녁18:30-20:00 tp300/m2/int200/o8', s:'저녁 18:30-20:00',tp:300,m:2.0,it:200,mo:8},
  {tag:'6월6위 오전10:00-11:30 tp300/m1.5/int200/o12',s:'오전 10:00-11:30',tp:300,m:1.5,it:200,mo:12},
  {tag:'6월안전 오전10:00-11:30 tp500/m2/int500/o8',s:'오전 10:00-11:30',tp:500,m:2.0,it:500,mo:8},
  {tag:'6월 저녁18:30-20:00 tp500/m2/int300/o8',  s:'저녁 18:30-20:00',tp:500,m:2.0,it:300,mo:8},
  // 비교: 1~5월 검증 안정형
  {tag:'★안정D 저녁18:30-19:30 tp500/m1.3/int300/o12',s:'저녁 18:30-19:30',tp:500,m:1.3,it:300,mo:12},
];

console.log('\n============================================================');
console.log(' 6월 상위세팅 역검증 (각 달 독립 $1000, 월요일 제외)');
console.log('============================================================');
console.log('세팅                                          1월   2월   3월   4월   5월   6월  | 생존');
for(const cs of CASES){
  const [ss,se]=SESS[cs.s];
  const base={seed:1000,startLot:0.01,tpPoints:cs.tp,lotMult:cs.m,interval:cs.it,maxOrders:cs.mo,slUsd:0,sessStartMin:ss,sessEndMin:se,closeAtSessionEnd:true,skipDow:[1]};
  let row=cs.tag.padEnd(46), surv=0;
  for(const p of PB){
    const r=simulateFast(p.bars,base,SPREAD);
    if(r.liquidated){row+='   💀 ';}
    else{surv++;const v=(r.pnl>=0?'+':'')+Math.round(r.pnl);row+=v.padStart(6);}
  }
  row+=`  | ${surv}/6`;
  console.log(row);
}
console.log('\n💀=청산  숫자=월손익($)  (★=1~5월 검증 통과 안정형)');
