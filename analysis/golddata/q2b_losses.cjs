// "승률 92%, 패배 8%"의 정체를 정확히 규명.
// 3-5월 고수익A 세팅: tp500 mult2 int200 max8, KST18:30-19:30, 월제외, SL없음.
// 패배 바스켓이 (a)마진콜인지 (b)세션종료 강제청산의 소액손실인지 손익분포로 확인.
const { loadAllBars } = require('./loader.cjs');
const POINT=0.01, CSIZE=100, SPREAD=0.62;
const full = loadAllBars(process.argv[2] || './sec1');
function slice(a,b){let s=0,e=full.n;while(s<full.n&&full.ts[s]<a)s++;while(e>0&&full.ts[e-1]>=b)e--;
  return {ts:full.ts.subarray(s,e),o:full.o.subarray(s,e),h:full.h.subarray(s,e),l:full.l.subarray(s,e),c:full.c.subarray(s,e),n:e-s};}
const D=s=>Date.parse(s+'T00:00:00Z');
const bars = slice(D('2026-03-01'),D('2026-06-01')); // 3-5월

const p = {tpPoints:500,lotMult:2.0,interval:200,maxOrders:8,sessStartMin:570,sessEndMin:630};
const startLot=0.01, skip=[1];

// 모든 바스켓 청산 이벤트를 기록 (사유 + 손익)
function lotAt(L0,m,k){const v=Math.round(L0*Math.pow(m,k)*100)/100;return v<0.01?0.01:v;}
function vw(arr){let s=0,L=0;for(const o of arr){s+=o.px*o.lot;L+=o.lot;}return L?s/L:0;}
function tl(arr){let s=0;for(const o of arr)s+=o.lot;return s;}

const {ts,o,h,l,c,n}=bars;
let balance=1000, buy=[],sell=[], liq=false;
const events=[]; // {reason, pnl, side, nOrders}
function closeBasket(side, pnl, reason, cnt){
  events.push({reason, pnl:Math.round(pnl*100)/100, side, n:cnt});
}
for(let i=0;i<n&&!liq;i++){
  const t=ts[i];const path=[[o[i],o[i]+SPREAD],[l[i],l[i]+SPREAD],[h[i],h[i]+SPREAD],[c[i],c[i]+SPREAD]];
  for(const [bid,ask] of path){
    if(buy.length){const avg=vw(buy);const tp=avg+(p.tpPoints/buy.length)*POINT;if(bid>=tp){const pnl=(tp-avg)*CSIZE*tl(buy);balance+=pnl;closeBasket('buy',pnl,'TP',buy.length);buy=[];}}
    if(sell.length){const avg=vw(sell);const tp=avg-(p.tpPoints/sell.length)*POINT;if(ask<=tp){const pnl=(avg-tp)*CSIZE*tl(sell);balance+=pnl;closeBasket('sell',pnl,'TP',sell.length);sell=[];}}
    // 마진콜
    let unr=0;if(buy.length)unr+=(bid-vw(buy))*CSIZE*tl(buy);if(sell.length)unr+=(vw(sell)-ask)*CSIZE*tl(sell);
    if(balance+unr<=0){
      // 마진콜: 남은 양방향 모두 강제청산(손실확정)
      if(buy.length){const pnl=(bid-vw(buy))*CSIZE*tl(buy);closeBasket('buy',pnl,'MARGINCALL',buy.length);}
      if(sell.length){const pnl=(vw(sell)-ask)*CSIZE*tl(sell);closeBasket('sell',pnl,'MARGINCALL',sell.length);}
      balance=0;liq=true;break;
    }
  }
  if(liq)break;
  const d=new Date(t);
  const m=(Math.floor(t/60000)%1440+1440)%1440;
  const inSess = (m>=p.sessStartMin&&m<p.sessEndMin) && skip.indexOf(d.getUTCDay())<0;
  if(!inSess){
    // 세션종료 강제청산
    if(buy.length||sell.length){const bid=c[i],ask=c[i]+SPREAD;
      if(buy.length){const pnl=(bid-vw(buy))*CSIZE*tl(buy);balance+=pnl;closeBasket('buy',pnl,'SESSION_END',buy.length);buy=[];}
      if(sell.length){const pnl=(vw(sell)-ask)*CSIZE*tl(sell);balance+=pnl;closeBasket('sell',pnl,'SESSION_END',sell.length);sell=[];}
    }
    continue;
  }
  const ask=c[i]+SPREAD,bid=c[i];
  if(buy.length===0)buy.push({px:ask,lot:startLot,trig:ask-p.interval*POINT});
  else{let g=0;while(ask<=buy[buy.length-1].trig&&buy.length<p.maxOrders&&g++<50)buy.push({px:ask,lot:lotAt(startLot,p.lotMult,buy.length),trig:ask-p.interval*POINT});}
  if(sell.length===0)sell.push({px:bid,lot:startLot,trig:bid+p.interval*POINT});
  else{let g=0;while(bid>=sell[sell.length-1].trig&&sell.length<p.maxOrders&&g++<50)sell.push({px:bid,lot:lotAt(startLot,p.lotMult,sell.length),trig:bid+p.interval*POINT});}
}

// 집계
const wins=events.filter(e=>e.pnl>0);
const losses=events.filter(e=>e.pnl<0);
const flat=events.filter(e=>e.pnl===0);
console.log(`=== 3-5월 고수익A (tp500 mult2 int200 max8, KST18:30-19:30, 월제외, SL없음) ===`);
console.log(`최종잔고 $${Math.round(balance)} | 청산여부: ${liq?'💀마진콜':'✅생존'}`);
console.log(`총 바스켓 ${events.length} | 승(이익) ${wins.length} | 패(손실) ${losses.length} | 본전 ${flat.length}`);
console.log(`승률 ${(wins.length/events.length*100).toFixed(1)}%`);

// 사유별 분류
const byReason={};
for(const e of events){byReason[e.reason]=byReason[e.reason]||{cnt:0,sum:0,win:0,loss:0};
  byReason[e.reason].cnt++;byReason[e.reason].sum+=e.pnl;if(e.pnl>0)byReason[e.reason].win++;if(e.pnl<0)byReason[e.reason].loss++;}
console.log('\n=== 청산 사유별 분류 ===');
console.log('사유 | 횟수 | 그중이익 | 그중손실 | 총손익$');
for(const [r,v] of Object.entries(byReason))
  console.log(`${r.padEnd(12)} | ${String(v.cnt).padStart(4)} | ${String(v.win).padStart(6)} | ${String(v.loss).padStart(6)} | ${(v.sum>=0?'+':'')+Math.round(v.sum)}`);

console.log('\n=== "패배(손실)" 바스켓의 정체 ===');
console.log(`패배 ${losses.length}건의 사유 내역:`);
const lossByReason={};
for(const e of losses){lossByReason[e.reason]=(lossByReason[e.reason]||[]);lossByReason[e.reason].push(e.pnl);}
for(const [r,arr] of Object.entries(lossByReason)){
  const avg=arr.reduce((a,b)=>a+b,0)/arr.length;
  console.log(`  ${r}: ${arr.length}건, 평균손실 $${avg.toFixed(2)}, 최대손실 $${Math.min(...arr).toFixed(2)}, 손실범위 [$${Math.min(...arr).toFixed(1)} ~ $${Math.max(...arr).toFixed(1)}]`);
}
