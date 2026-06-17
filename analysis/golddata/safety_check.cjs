// 초기 안전성 검증: TOP 후보들의 월별 잔고/최저equity/최대동시주문 추적.
// 핵심 질문: 수익 쌓이기 전 "초기"에 시드 $1000이 버티는가? 최저 equity는 언제·얼마?
const { loadAllBars } = require('./loader.cjs');
const SPREAD = 0.62;
const POINT = 0.01, CSIZE = 100;

const bars = loadAllBars(process.argv[2] || './sec1');

function lotAt(L0, mult, n) { const v = Math.round(L0*Math.pow(mult,n)*100)/100; return v<0.01?0.01:v; }

// 추적형 시뮬: 월별 잔고, 전체기간 최저 equity(=시드대비 가장 위험했던 순간), 그 시점
function simulateTrace(p) {
  const { ts, o, h, l, c, n } = bars;
  const seed = 1000; let balance = seed;
  let buy = [], sell = [];
  let liq = false, nB=0, nW=0, nL=0;
  let minEq = seed, minEqTime = 0, maxConc = 0;
  const startLot=p.startLot, mult=p.lotMult, tpP=p.tpPoints, interval=p.interval, maxOrders=p.maxOrders, slUsd=p.slUsd||0;
  const ssMin=p.sessStartMin, seMin=p.sessEndMin, closeEnd=!!p.closeAtSessionEnd;
  const monthly = {}; // 'YYYY-MM' -> balance at month end

  function vw(a){let s=0,L=0;for(const o of a){s+=o.px*o.lot;L+=o.lot;}return L?s/L:0;}
  function tl(a){let s=0;for(const o of a)s+=o.lot;return s;}
  function tick(bid,ask,t){
    if(liq)return;
    if(buy.length){const avg=vw(buy);const tp=avg+(tpP/buy.length)*POINT;if(bid>=tp){let pnl=(tp-avg)*CSIZE*tl(buy);if(pnl<0&&balance+pnl<=0){balance=0;liq=true;}else balance+=pnl;nB++;pnl>0?nW++:nL++;buy=[];}}
    if(liq)return;
    if(sell.length){const avg=vw(sell);const tp=avg-(tpP/sell.length)*POINT;if(ask<=tp){let pnl=(avg-tp)*CSIZE*tl(sell);if(pnl<0&&balance+pnl<=0){balance=0;liq=true;}else balance+=pnl;nB++;pnl>0?nW++:nL++;sell=[];}}
    if(liq)return;
    if(slUsd>0){
      if(buy.length){const pl=(bid-vw(buy))*CSIZE*tl(buy);if(pl<=-slUsd){if(balance+pl<=0){balance=0;liq=true;}else balance+=pl;nB++;nL++;buy=[];}}
      if(!liq&&sell.length){const pl=(vw(sell)-ask)*CSIZE*tl(sell);if(pl<=-slUsd){if(balance+pl<=0){balance=0;liq=true;}else balance+=pl;nB++;nL++;sell=[];}}
    }
    if(liq)return;
    let unr=0;if(buy.length)unr+=(bid-vw(buy))*CSIZE*tl(buy);if(sell.length)unr+=(vw(sell)-ask)*CSIZE*tl(sell);
    const eq=balance+unr;
    if(eq<=0){balance=0;liq=true;return;}
    if(eq<minEq){minEq=eq;minEqTime=t;}
  }
  function inSess(t){const m=(Math.floor(t/60000)%1440+1440)%1440;return seMin>ssMin?(m>=ssMin&&m<seMin):(m>=ssMin||m<seMin);}

  for(let i=0;i<n&&!liq;i++){
    const t=ts[i],bo=o[i],bh=h[i],bl=l[i],bc=c[i];
    tick(bo,bo+SPREAD,t);if(liq)break;tick(bl,bl+SPREAD,t);if(liq)break;tick(bh,bh+SPREAD,t);if(liq)break;tick(bc,bc+SPREAD,t);if(liq)break;
    const d=new Date(t);const mk=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;monthly[mk]=Math.round(balance);
    if(!inSess(t)){
      if(closeEnd&&(buy.length||sell.length)){const a0=bc+SPREAD,b0=bc;
        if(buy.length){let pnl=(b0-vw(buy))*CSIZE*tl(buy);if(pnl<0&&balance+pnl<=0){balance=0;liq=true;}else balance+=pnl;nB++;pnl>0?nW++:nL++;buy=[];}
        if(!liq&&sell.length){let pnl=(vw(sell)-a0)*CSIZE*tl(sell);if(pnl<0&&balance+pnl<=0){balance=0;liq=true;}else balance+=pnl;nB++;pnl>0?nW++:nL++;sell=[];}}
      continue;
    }
    const ask=bc+SPREAD,bid=bc;
    if(buy.length===0)buy.push({px:ask,lot:startLot,trig:ask-interval*POINT});
    else{let g=0;while(ask<=buy[buy.length-1].trig&&buy.length<maxOrders&&g++<50)buy.push({px:ask,lot:lotAt(startLot,mult,buy.length),trig:ask-interval*POINT});}
    if(sell.length===0)sell.push({px:bid,lot:startLot,trig:bid+interval*POINT});
    else{let g=0;while(bid>=sell[sell.length-1].trig&&sell.length<maxOrders&&g++<50)sell.push({px:bid,lot:lotAt(startLot,mult,sell.length),trig:bid+interval*POINT});}
    if(buy.length>maxConc)maxConc=buy.length;if(sell.length>maxConc)maxConc=sell.length;
  }
  return {pnl:Math.round(balance-seed),balance:Math.round(balance),liq,nB,winRate:nB?Math.round(nW/nB*1000)/10:0,minEq:Math.round(minEq),minEqTime,maxConc,monthly};
}

const cands = [
  ['TOP1 +1280', {startLot:0.01,tpPoints:500,lotMult:1.3,interval:500,maxOrders:8, sessStartMin:570,sessEndMin:630,closeAtSessionEnd:true}],
  ['TOP2 +892',  {startLot:0.01,tpPoints:500,lotMult:2.0,interval:500,maxOrders:5, sessStartMin:600,sessEndMin:660,closeAtSessionEnd:true}],
  ['안전 +516',  {startLot:0.01,tpPoints:500,lotMult:1.5,interval:500,maxOrders:5, sessStartMin:600,sessEndMin:660,closeAtSessionEnd:true}],
  ['TOP5 +619',  {startLot:0.01,tpPoints:300,lotMult:1.5,interval:300,maxOrders:8, sessStartMin:570,sessEndMin:630,closeAtSessionEnd:true}],
];

for (const [label, p] of cands) {
  const r = simulateTrace(p);
  const mt = new Date(r.minEqTime);
  console.log(`\n■ ${label}  최종잔고 $${r.balance} (수익 ${r.pnl>=0?'+':''}$${r.pnl}) | 거래 ${r.nB} 승률 ${r.winRate}% | 최대동시 ${r.maxConc}`);
  console.log(`   최저 equity: $${r.minEq} (시드 $1000 대비 여유 $${r.minEq-0}) @ ${mt.toISOString().slice(0,16)} UTC ${r.minEq<=0?'💀청산':r.minEq<200?'⚠️위험':'✅안전'}`);
  const ms = Object.entries(r.monthly);
  console.log('   월말잔고: ' + ms.map(([m,b])=>`${m.slice(5)}:$${b}`).join('  '));
}
