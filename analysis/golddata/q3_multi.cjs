// Q3: 2개 비겹침 세션 병행. 시드 배분 방식 비교.
// 방식A: 한 계좌 $1000 공유(두 세션 같은 잔고/마진).
// 방식B: 각 세션 독립 $500.
// 방식C: 각 세션 독립 $1000 (자본 $2000).
// 비교군: 단일 세션 각각 $1000.
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');
const SPREAD = 0.62;
const POINT=0.01, CSIZE=100;
const full = loadAllBars(process.argv[2] || './sec1');

// 두 강건세팅 (비겹침 시간대) — 둘 다 단독 생존하는 세팅으로 선정
//  세션1: KST13-14 (UTC240-300) 점심 — 강건 단독생존 (tp500 mult2 int300 max5)
//  세션2: KST18:30-19:30 (UTC570-630) 유로장후 — 종합최우수 (tp500 mult1.3 int300 max12)
const S1 = {tpPoints:500,lotMult:2.0,interval:300,maxOrders:5,sessStartMin:240,sessEndMin:300};
const S2 = {tpPoints:500,lotMult:1.3,interval:300,maxOrders:12,sessStartMin:570,sessEndMin:630};
const COMMON = {startLot:0.01,slUsd:0,closeAtSessionEnd:true,skipDow:[1]};

// 단일 세션 결과 (각 $1000)
const r1 = simulateFast(full, {seed:1000,...COMMON,...S1}, SPREAD);
const r2 = simulateFast(full, {seed:1000,...COMMON,...S2}, SPREAD);
console.log('=== 단일 세션 (각 시드 $1000) ===');
console.log(`세션1 KST12-13      : ${r1.liquidated?'💀':'$'+Math.round(r1.pnl)} (DD$${Math.round(r1.maxDD)}, 거래${r1.baskets})`);
console.log(`세션2 KST18:30-19:30: ${r2.liquidated?'💀':'$'+Math.round(r2.pnl)} (DD$${Math.round(r2.maxDD)}, 거래${r2.baskets})`);

// 방식C: 독립 $1000씩 → 단순 합산
console.log('\n=== 방식C: 독립계좌 $1000+$1000 (자본 $2000) ===');
if(r1.liquidated||r2.liquidated) console.log('  한쪽 청산 → 부분손실');
console.log(`  합산수익: $${Math.round(r1.pnl+r2.pnl)} / 투입 $2000 → ROI ${Math.round((r1.pnl+r2.pnl)/2000*100)}%`);

// 방식B: 독립 $500씩
const b1 = simulateFast(full, {seed:500,...COMMON,...S1}, SPREAD);
const b2 = simulateFast(full, {seed:500,...COMMON,...S2}, SPREAD);
console.log('\n=== 방식B: 독립계좌 $500+$500 (자본 $1000) ===');
console.log(`  세션1: ${b1.liquidated?'💀청산':'$'+Math.round(b1.pnl)} (DD$${Math.round(b1.maxDD)})`);
console.log(`  세션2: ${b2.liquidated?'💀청산':'$'+Math.round(b2.pnl)} (DD$${Math.round(b2.maxDD)})`);
console.log(`  합산: $${Math.round(b1.pnl+b2.pnl)} / 투입 $1000 → ROI ${Math.round((b1.pnl+b2.pnl)/1000*100)}%`);

// 방식A: 한 계좌 $1000 공유 — 두 세션을 한 시뮬에서 동시 운영해야 정확.
// 두 세션 시간이 안 겹치므로, 시간대에 따라 활성 파라미터를 바꾸는 통합 시뮬 작성.
function simulateDualShared(bars, p1, p2, common, seed){
  const {ts,o,h,l,c,n}=bars;
  let balance=seed;
  let buy=[],sell=[]; // 한 계좌, 한 그리드. 단 진입 파라미터는 활성세션에 따라.
  let liq=false,nB=0,nW=0,nL=0;
  let peak=seed,maxDD=0,minEq=seed,maxConc=0;
  function lotAt(L0,m,k){const v=Math.round(L0*Math.pow(m,k)*100)/100;return v<0.01?0.01:v;}
  function vw(a){let s=0,L=0;for(const o of a){s+=o.px*o.lot;L+=o.lot;}return L?s/L:0;}
  function tl(a){let s=0;for(const o of a)s+=o.lot;return s;}
  const startLot=common.startLot, skip=common.skipDow;
  function activeSession(t){
    const m=(Math.floor(t/60000)%1440+1440)%1440;
    if(m>=p1.sessStartMin&&m<p1.sessEndMin)return p1;
    if(m>=p2.sessStartMin&&m<p2.sessEndMin)return p2;
    return null;
  }
  for(let i=0;i<n&&!liq;i++){
    const t=ts[i];const path=[[o[i],o[i]+SPREAD],[l[i],l[i]+SPREAD],[h[i],h[i]+SPREAD],[c[i],c[i]+SPREAD]];
    // 활성세션의 tp로 TP판정 (세션 밖이면 직전 세션 tp? → 단순화: 보유중이면 그때 진입했던 tp를 바스켓에 저장)
    for(const [bid,ask] of path){
      if(buy.length){const avg=vw(buy);const tp=avg+(buy[0].tpP/buy.length)*POINT;if(bid>=tp){let pnl=(tp-avg)*CSIZE*tl(buy);if(pnl<0&&balance+pnl<=0){balance=0;liq=true;}else balance+=pnl;nB++;pnl>0?nW++:nL++;buy=[];}}
      if(liq)break;
      if(sell.length){const avg=vw(sell);const tp=avg-(sell[0].tpP/sell.length)*POINT;if(ask<=tp){let pnl=(avg-tp)*CSIZE*tl(sell);if(pnl<0&&balance+pnl<=0){balance=0;liq=true;}else balance+=pnl;nB++;pnl>0?nW++:nL++;sell=[];}}
      if(liq)break;
      let unr=0;if(buy.length)unr+=(bid-vw(buy))*CSIZE*tl(buy);if(sell.length)unr+=(vw(sell)-ask)*CSIZE*tl(sell);
      const eq=balance+unr;if(eq<=0){balance=0;liq=true;break;}
      if(eq>peak)peak=eq;const dd=peak-eq;if(dd>maxDD)maxDD=dd;if(eq<minEq)minEq=eq;
    }
    if(liq)break;
    const d=new Date(t);
    const inSkip = skip&&skip.indexOf(d.getUTCDay())>=0;
    const sess = inSkip?null:activeSession(t);
    if(!sess){
      // 세션밖/스킵 → 보유청산(closeAtEnd)
      if(common.closeAtSessionEnd&&(buy.length||sell.length)){
        const bid=c[i],ask=c[i]+SPREAD;
        if(buy.length){let pnl=(bid-vw(buy))*CSIZE*tl(buy);if(pnl<0&&balance+pnl<=0){balance=0;liq=true;}else balance+=pnl;nB++;pnl>0?nW++:nL++;buy=[];}
        if(!liq&&sell.length){let pnl=(vw(sell)-ask)*CSIZE*tl(sell);if(pnl<0&&balance+pnl<=0){balance=0;liq=true;}else balance+=pnl;nB++;pnl>0?nW++:nL++;sell=[];}
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
  return {pnl:Math.round((balance-seed)*100)/100,liquidated:liq,baskets:nB,winRate:nB?Math.round(nW/nB*1000)/10:0,maxDD:Math.round(maxDD),minEq:Math.round(minEq),maxConcurrent:maxConc};
}

const dual = simulateDualShared(full, S1, S2, COMMON, 1000);
console.log('\n=== 방식A: 한 계좌 $1000 공유 (두 세션 통합운영) ===');
console.log(`  ${dual.liquidated?'💀청산':'$'+Math.round(dual.pnl)} (DD$${dual.maxDD}, 최저eq$${dual.minEq}, 거래${dual.baskets}, 승률${dual.winRate}%, maxN${dual.maxConcurrent})`);
console.log(`  ROI: ${Math.round(dual.pnl/1000*100)}% / 투입 $1000`);

console.log('\n=== 종합 비교 (투입자본 대비) ===');
console.log(`단일 세션2만 ($1000)        : $${Math.round(r2.pnl)} ROI ${Math.round(r2.pnl/1000*100)}%`);
console.log(`방식A 공유 ($1000)          : ${dual.liquidated?'청산':'$'+Math.round(dual.pnl)+' ROI '+Math.round(dual.pnl/1000*100)+'%'}`);
console.log(`방식B 분리 $500x2 ($1000)   : ${(b1.liquidated||b2.liquidated)?'일부청산 ':''}$${Math.round(b1.pnl+b2.pnl)} ROI ${Math.round((b1.pnl+b2.pnl)/1000*100)}%`);
console.log(`방식C 독립 $1000x2 ($2000)  : $${Math.round(r1.pnl+r2.pnl)} ROI ${Math.round((r1.pnl+r2.pnl)/2000*100)}%`);
