// 아이디어2: 직전 3개월(3~5월)로 기간 한정 그리드서치.
// 시드 $1000. 잔잔 시간대 × EA 파라미터 × (월요일제외 on/off).
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');
const SPREAD = 0.62;

const FROM = process.argv[3] || '2026-03-01';
const TO   = process.argv[4] || '2026-06-01';
const fromMs = Date.parse(FROM+'T00:00:00Z');
const toMs   = Date.parse(TO+'T00:00:00Z');

const full = loadAllBars(process.argv[2] || './sec1');
let s=0,e=full.n;
while(s<full.n && full.ts[s]<fromMs)s++;
while(e>0 && full.ts[e-1]>=toMs)e--;
const bars = { ts:full.ts.subarray(s,e), o:full.o.subarray(s,e), h:full.h.subarray(s,e), l:full.l.subarray(s,e), c:full.c.subarray(s,e), n:e-s };
console.error(`기간 ${FROM}~${TO}: ${bars.n.toLocaleString()}바`);

const SESSIONS = [
  [150,240,'KST11:30-13:00'], [180,240,'KST12-13'], [180,300,'KST12-14'],
  [570,630,'KST18:30-19:30'], [540,660,'KST18-20'], [600,660,'KST19-20'], [240,300,'KST13-14'],
];
const GRID = {
  tpPoints:[100,200,300,500], lotMult:[1.3,1.5,2.0], interval:[200,300,500],
  maxOrders:[5,8,12], slUsd:[0,30],
};
const results=[];
let cnt=0;
for(const sess of SESSIONS)
for(const tpPoints of GRID.tpPoints)
for(const lotMult of GRID.lotMult)
for(const interval of GRID.interval)
for(const maxOrders of GRID.maxOrders)
for(const slUsd of GRID.slUsd)
for(const skipMon of [false,true]){
  const p={seed:1000,startLot:0.01,tpPoints,lotMult,interval,maxOrders,slUsd,
    sessStartMin:sess[0],sessEndMin:sess[1],closeAtSessionEnd:true,
    skipDow: skipMon?[1]:null};
  const r=simulateFast(bars,p,SPREAD);
  results.push({session:sess[2],tpPoints,lotMult,interval,maxOrders,slUsd,skipMon,
    pnl:r.pnl,baskets:r.baskets,winRate:r.winRate,maxDD:r.maxDD,liquidated:r.liquidated,maxConcurrent:r.maxConcurrent});
  cnt++;
}
console.error(`총 ${cnt}조합`);
const prof = results.filter(r=>!r.liquidated && r.pnl>0).sort((a,b)=>b.pnl-a.pnl);
const safe = results.filter(r=>!r.liquidated && r.pnl>0).sort((a,b)=>a.maxDD-b.maxDD);
console.log(`\n생존+수익 ${prof.length}개`);
console.log('\n=== 수익 TOP 15 ===');
console.log('pnl$ | 거래 | 승률 | DD$ | maxN | tp | mult | int | maxO | sl | 월제외 | 시간대');
for(const r of prof.slice(0,15)) console.log(rowtxt(r));
console.log('\n=== 가장 안전(저DD) TOP 15 ===');
for(const r of safe.slice(0,15)) console.log(rowtxt(r));
function rowtxt(r){return [('+'+r.pnl).padStart(8),String(r.baskets).padStart(4),(r.winRate+'%').padStart(5),
  String(Math.round(r.maxDD)).padStart(5),String(r.maxConcurrent).padStart(4),String(r.tpPoints).padStart(3),
  String(r.lotMult).padStart(3),String(r.interval).padStart(3),String(r.maxOrders).padStart(2),
  String(r.slUsd).padStart(2),(r.skipMon?'Y':'N').padStart(2),r.session].join(' | ');}
require('fs').writeFileSync('./idea2_results.json',JSON.stringify(results));
