// 월별 독립생존 분석: 1~5월 각 달을 독립 $1000으로 시작 → 월말 생존/수익.
// 월요일 제외(화~금만). 안정형/고수익 케이스 비교.
// 더블체크: 각 케이스 5개월 전부 돌려 "몇 달 생존했는지" + "최악의 달" 표시.
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');
const SPREAD=0.62, POINT=0.01, CSIZE=100;
const full = loadAllBars(process.argv[2]||'./sec1');

function D(s){return new Date(s+'T00:00:00Z').getTime();}
function slice(b,t0,t1){const{ts}=b;let i0=0,i1=b.n;while(i0<b.n&&ts[i0]<t0)i0++;while(i1>0&&ts[i1-1]>=t1)i1--;return{ts:ts.subarray(i0,i1),o:b.o.subarray(i0,i1),h:b.h.subarray(i0,i1),l:b.l.subarray(i0,i1),c:b.c.subarray(i0,i1),n:i1-i0};}

const MONTHS=[
  {k:'1월',t0:D('2026-01-01'),t1:D('2026-02-01')},
  {k:'2월',t0:D('2026-02-01'),t1:D('2026-03-01')},
  {k:'3월',t0:D('2026-03-01'),t1:D('2026-04-01')},
  {k:'4월',t0:D('2026-04-01'),t1:D('2026-05-01')},
  {k:'5월',t0:D('2026-05-01'),t1:D('2026-06-01')},
];
const MB = MONTHS.map(m=>({...m, bars:slice(full,m.t0,m.t1)}));
MB.forEach(m=>console.log(`${m.k}: ${m.bars.n.toLocaleString()}바`));

const SESS={
  'KST11:30-13:00':{ss:150,se:240},
  'KST12-13':{ss:180,se:240},'KST12-14':{ss:180,se:300},'KST13-14':{ss:240,se:300},
  'KST18:30-19:30':{ss:570,se:630},'KST18-20':{ss:540,se:660},'KST19-20':{ss:600,se:660},
};

// 분석할 케이스 (월요일 제외 고정)
const CASES=[
  // --- 안정형 (robust) ---
  {tag:'안정A 점심 tp500/m1.5/int500/o5',   sess:'KST11:30-13:00',tpPoints:500,lotMult:1.5,interval:500,maxOrders:5},
  {tag:'안정B 저녁 tp300/m1.3/int300/o12',  sess:'KST18:30-19:30',tpPoints:300,lotMult:1.3,interval:300,maxOrders:12},
  {tag:'안정C 저녁 tp200/m1.3/int300/o12',  sess:'KST18:30-19:30',tpPoints:200,lotMult:1.3,interval:300,maxOrders:12},
  {tag:'안정D 저녁 tp500/m1.3/int300/o12',  sess:'KST18:30-19:30',tpPoints:500,lotMult:1.3,interval:300,maxOrders:12},
  // --- 고수익(과최적화 의심) ---
  {tag:'고수익1 점심 tp500/m1.5/int200/o12',sess:'KST11:30-13:00',tpPoints:500,lotMult:1.5,interval:200,maxOrders:12},
  {tag:'고수익2 점심 tp300/m1.5/int200/o12',sess:'KST11:30-13:00',tpPoints:300,lotMult:1.5,interval:200,maxOrders:12},
  {tag:'고수익5 저녁 tp200/m2.0/int200/o8', sess:'KST18:30-19:30',tpPoints:200,lotMult:2.0,interval:200,maxOrders:8},
  // --- 사용자 의심 세팅들 ---
  {tag:'저녁 tp500/m2.0/int200/o8',         sess:'KST18:30-19:30',tpPoints:500,lotMult:2.0,interval:200,maxOrders:8},
];

function runCase(cs){
  const S=SESS[cs.sess];
  const base={seed:1000,startLot:0.01,tpPoints:cs.tpPoints,lotMult:cs.lotMult,interval:cs.interval,maxOrders:cs.maxOrders,slUsd:0,sessStartMin:S.ss,sessEndMin:S.se,closeAtSessionEnd:true,skipDow:[1]};
  return MB.map(m=>{
    const r=simulateFast(m.bars,base,SPREAD);
    return {k:m.k, liq:r.liquidated, bal:r.liquidated?0:Math.round(1000+r.pnl), pnl:Math.round(r.pnl), minEq:r.minEq, dd:Math.round(r.maxDD), maxN:r.maxConcurrent, wr:r.winRate, baskets:r.baskets};
  });
}

console.log('\n========================================================');
console.log(' 월별 독립생존: 각 달 $1000 시작 → 월말 (화~금, 월제외)');
console.log('========================================================\n');

for(const cs of CASES){
  const res=runCase(cs);
  const survived=res.filter(r=>!r.liq).length;
  const worst=res.reduce((a,b)=>(b.minEq<a.minEq?b:a));
  console.log(`■ ${cs.tag}`);
  let line='   ';
  for(const r of res){
    if(r.liq) line+=`${r.k}💀  `;
    else line+=`${r.k}$${r.bal}(eq$${Math.round(r.minEq)})  `;
  }
  console.log(line);
  console.log(`   → 생존 ${survived}/5달, 최악의달 ${worst.k}(최저eq$${Math.round(worst.minEq)}${worst.liq?',청산':''})\n`);
}

// 요약표
console.log('======== 요약: 5달 중 생존 개월수 / 최저eq ========');
console.log('케이스                              1월   2월   3월   4월   5월   생존');
for(const cs of CASES){
  const res=runCase(cs);
  let row=cs.tag.padEnd(34);
  for(const r of res){
    const cell = r.liq?'💀':('+$'+r.pnl);
    row += cell.padStart(6);
  }
  const surv=res.filter(r=>!r.liq).length;
  row += '  '+surv+'/5';
  console.log(row);
}
