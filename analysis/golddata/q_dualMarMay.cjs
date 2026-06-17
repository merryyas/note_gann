// 3~5월 단일계좌 $1000, 점심(세팅1)+저녁(세팅2) 통합운영. 월별 잔고 추적.
//  세팅1 점심  : tp500 mult1.5 int200 maxO12, KST11:30-13:00 (UTC sessMin 150-240)
//  세팅2 저녁  : tp500 mult2.0 int200 maxO8 , KST18:30-19:30 (UTC sessMin 570-630)
//  공통: 월요일 제외(skipDow[1]), 세션종료시 강제청산(closeAtSessionEnd), 시드 $1000 공유.
const { loadAllBars } = require('./loader.cjs');
const SPREAD = 0.62, POINT = 0.01, CSIZE = 100;

const full = loadAllBars(process.argv[2] || './sec1');

// --- Mar-May 슬라이스 ---
function D(s){return new Date(s+'T00:00:00Z').getTime();}
const T0 = D('2026-03-01'), T1 = D('2026-06-01');
function sliceBars(b, t0, t1){
  const {ts}=b; let i0=0,i1=b.n;
  while(i0<b.n && ts[i0]<t0) i0++;
  while(i1>0 && ts[i1-1]>=t1) i1--;
  return {
    ts: ts.subarray(i0,i1), o: b.o.subarray(i0,i1), h: b.h.subarray(i0,i1),
    l: b.l.subarray(i0,i1), c: b.c.subarray(i0,i1), n: i1-i0
  };
}
const bars = sliceBars(full, T0, T1);
console.log(`Mar-May 바: ${bars.n.toLocaleString()}개 (${new Date(bars.ts[0]).toISOString().slice(0,10)} ~ ${new Date(bars.ts[bars.n-1]).toISOString().slice(0,10)})`);

const S1 = {tpPoints:500, lotMult:1.5, interval:200, maxOrders:12, sessStartMin:150, sessEndMin:240}; // 점심 KST11:30-13:00
const S2 = {tpPoints:500, lotMult:2.0, interval:200, maxOrders:8,  sessStartMin:570, sessEndMin:630}; // 저녁 KST18:30-19:30
const COMMON = {startLot:0.01, slUsd:0, closeAtSessionEnd:true, skipDow:[1]};

// 월별 잔고 추적 추가한 통합 시뮬
function simulateDualMonthly(b, p1, p2, common, seed){
  const {ts,o,h,l,c,n}=b;
  let balance=seed;
  let buy=[],sell=[];
  let liq=false,nB=0,nW=0,nL=0;
  let peak=seed,maxDD=0,minEq=seed,maxConc=0;
  let liqTime=null;
  const monthly={};               // 각 달 마지막으로 본 잔고
  function lotAt(L0,m,k){const v=Math.round(L0*Math.pow(m,k)*100)/100;return v<0.01?0.01:v;}
  function vw(a){let s=0,L=0;for(const x of a){s+=x.px*x.lot;L+=x.lot;}return L?s/L:0;}
  function tl(a){let s=0;for(const x of a)s+=x.lot;return s;}
  const startLot=common.startLot, skip=common.skipDow;
  function activeSession(t){
    const m=(Math.floor(t/60000)%1440+1440)%1440;
    if(m>=p1.sessStartMin&&m<p1.sessEndMin)return p1;
    if(m>=p2.sessStartMin&&m<p2.sessEndMin)return p2;
    return null;
  }
  for(let i=0;i<n&&!liq;i++){
    const t=ts[i];
    const path=[[o[i],o[i]+SPREAD],[l[i],l[i]+SPREAD],[h[i],h[i]+SPREAD],[c[i],c[i]+SPREAD]];
    for(const [bid,ask] of path){
      if(buy.length){const avg=vw(buy);const tp=avg+(buy[0].tpP/buy.length)*POINT;if(bid>=tp){let pnl=(tp-avg)*CSIZE*tl(buy);if(pnl<0&&balance+pnl<=0){balance=0;liq=true;}else balance+=pnl;nB++;pnl>0?nW++:nL++;buy=[];}}
      if(liq)break;
      if(sell.length){const avg=vw(sell);const tp=avg-(sell[0].tpP/sell.length)*POINT;if(ask<=tp){let pnl=(avg-tp)*CSIZE*tl(sell);if(pnl<0&&balance+pnl<=0){balance=0;liq=true;}else balance+=pnl;nB++;pnl>0?nW++:nL++;sell=[];}}
      if(liq)break;
      let unr=0;if(buy.length)unr+=(bid-vw(buy))*CSIZE*tl(buy);if(sell.length)unr+=(vw(sell)-ask)*CSIZE*tl(sell);
      const eq=balance+unr;if(eq<=0){balance=0;liq=true;break;}
      if(eq>peak)peak=eq;const dd=peak-eq;if(dd>maxDD)maxDD=dd;if(eq<minEq)minEq=eq;
    }
    // 월별 잔고 갱신 (확정잔고 기준)
    const mk=new Date(t).toISOString().slice(0,7); // YYYY-MM
    monthly[mk]=Math.round(balance*100)/100;
    if(liq){liqTime=t;break;}
    const d=new Date(t);
    const inSkip = skip&&skip.indexOf(d.getUTCDay())>=0;
    const sess = inSkip?null:activeSession(t);
    if(!sess){
      if(common.closeAtSessionEnd&&(buy.length||sell.length)){
        const bid=c[i],ask=c[i]+SPREAD;
        if(buy.length){let pnl=(bid-vw(buy))*CSIZE*tl(buy);if(pnl<0&&balance+pnl<=0){balance=0;liq=true;}else balance+=pnl;nB++;pnl>0?nW++:nL++;buy=[];}
        if(!liq&&sell.length){let pnl=(vw(sell)-ask)*CSIZE*tl(sell);if(pnl<0&&balance+pnl<=0){balance=0;liq=true;}else balance+=pnl;nB++;pnl>0?nW++:nL++;sell=[];}
        monthly[mk]=Math.round(balance*100)/100;
      }
      continue;
    }
    const ask=c[i]+SPREAD,bid=c[i];
    const {lotMult:mult,interval,maxOrders,tpPoints:tpP}=sess;
    if(buy.length===0){buy.push({px:ask,lot:startLot,trig:ask-interval*POINT,tpP});}
    else{let g=0;while(ask<=buy[buy.length-1].trig&&buy.length<maxOrders&&g++<50)buy.push({px:ask,lot:lotAt(startLot,mult,buy.length),trig:ask-interval*POINT,tpP});}
    if(sell.length===0){sell.push({px:bid,lot:startLot,trig:bid+interval*POINT,tpP});}
    else{let g=0;while(bid>=sell[sell.length-1].trig&&sell.length<maxOrders&&g++<50)sell.push({px:bid,lot:lotAt(startLot,mult,sell.length),trig:bid+interval*POINT,tpP});}
    if(buy.length>maxConc)maxConc=buy.length;if(sell.length>maxConc)maxConc=sell.length;
  }
  return {finalBalance:Math.round(balance*100)/100,pnl:Math.round((balance-seed)*100)/100,liquidated:liq,liqTime,baskets:nB,wins:nW,losses:nL,winRate:nB?Math.round(nW/nB*1000)/10:0,maxDD:Math.round(maxDD),minEq:Math.round(minEq),maxConcurrent:maxConc,monthly};
}

console.log('\n========================================');
console.log(' 단일계좌 $1000 — 점심(세팅1)+저녁(세팅2) 통합운영');
console.log('========================================');
console.log(' 세팅1 점심 KST11:30-13:00 : tp500 mult1.5 int200 maxO12');
console.log(' 세팅2 저녁 KST18:30-19:30 : tp500 mult2.0 int200 maxO8');
console.log(' 공통: 월요일 제외, 세션종료 강제청산\n');

const r = simulateDualMonthly(bars, S1, S2, COMMON, 1000);

console.log('--- 월별 시드(확정잔고) 변화 ---');
const months=['2026-03','2026-04','2026-05'];
const labels={'2026-03':'3월','2026-04':'4월','2026-05':'5월'};
let prev=1000;
console.log(`시작           : $1000`);
for(const mk of months){
  if(r.monthly[mk]!=null){
    const bal=r.monthly[mk];
    const chg=bal-prev;
    console.log(`${labels[mk]} 말        : $${bal.toFixed(2)}  (당월 ${chg>=0?'+':''}$${chg.toFixed(2)})`);
    prev=bal;
  }
}

console.log('\n--- 최종 결과 ---');
console.log(`최종잔고  : $${r.finalBalance.toFixed(2)}`);
console.log(`총손익    : ${r.pnl>=0?'+':''}$${r.pnl.toFixed(2)}  (ROI ${Math.round(r.pnl/1000*100)}%)`);
console.log(`청산여부  : ${r.liquidated?'💀 청산됨 ('+new Date(r.liqTime).toISOString()+')':'✅ 생존'}`);
console.log(`최대낙폭  : $${r.maxDD}`);
console.log(`최저equity: $${r.minEq}`);
console.log(`총바스켓  : ${r.baskets} (승 ${r.wins} / 패 ${r.losses}, 승률 ${r.winRate}%)`);
console.log(`최대동시  : ${r.maxConcurrent}차수`);
