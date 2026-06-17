// 틱 기반 정밀 검증: 실제 ask/bid 틱을 그대로 순회.
// 1초봉(O→L→H→C 4점근사, bid+0.62) 대비 정밀도 비교용.
// 진입 규칙은 동일하되 "틱마다 TP/마진콜 체크 + 세션내 틱마다 진입판단".
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const POINT = 0.01, CSIZE = 100;

function lotAt(L0, mult, n){const v=Math.round(L0*Math.pow(mult,n)*100)/100;return v<0.01?0.01:v;}

// 틱 파일들을 시간순으로 로드 → {ts:Float64Array, ask, bid}
function loadTicks(dir, fromDate, toDate){
  const files = fs.readdirSync(dir).filter(f=>f.endsWith('.gz')).sort();
  // 날짜 필터 (파일명: xauusd-tick-YYYY-MM-DD-YYYY-MM-DD.csv.gz, 시작일 기준)
  const sel = files.filter(f=>{
    const m = f.match(/tick-(\d{4}-\d{2}-\d{2})/);
    if(!m) return false;
    return (!fromDate || m[1]>=fromDate) && (!toDate || m[1]<=toDate);
  });
  // 메모리 효율: 넉넉한 용량 사전할당 후 파일 하나씩 디코드→채우기→해제
  const cap = 35000000; // 일 ~80만 × 최대 약 44일 여유
  const ts=new Float64Array(cap), ask=new Float64Array(cap), bid=new Float64Array(cap);
  let k=0;
  for(const f of sel){
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(dir,f))).toString('utf8');
    let i=0; const L=raw.length;
    if(raw.startsWith('timestamp')){ while(i<L&&raw.charCodeAt(i)!==10)i++; i++; }
    while(i<L){
      let j=i; while(j<L&&raw.charCodeAt(j)!==10)j++;
      if(j>i){
        const line=raw.slice(i,j);
        const c1=line.indexOf(','), c2=line.indexOf(',',c1+1);
        if(c1>0&&c2>c1){ ts[k]=+line.slice(0,c1); ask[k]=+line.slice(c1+1,c2); bid[k]=+line.slice(c2+1); k++; }
      }
      i=j+1;
    }
  }
  return {ts:ts.subarray(0,k),ask:ask.subarray(0,k),bid:bid.subarray(0,k),n:k};
}

function simulateTick(T, p){
  const {ts,ask:A,bid:B,n}=T;
  const seed=1000; let balance=seed;
  let buy=[],sell=[];
  let liq=false,nB=0,nW=0,nL=0,nT=0;
  let minEq=seed,peak=seed,maxDD=0,maxConc=0;
  const startLot=p.startLot,mult=p.lotMult,tpP=p.tpPoints,interval=p.interval,maxOrders=p.maxOrders,slUsd=p.slUsd||0;
  const ssMin=p.sessStartMin,seMin=p.sessEndMin,closeEnd=!!p.closeAtSessionEnd;
  function vw(a){let s=0,L=0;for(const o of a){s+=o.px*o.lot;L+=o.lot;}return L?s/L:0;}
  function tl(a){let s=0;for(const o of a)s+=o.lot;return s;}
  function inSess(t){const m=(Math.floor(t/60000)%1440+1440)%1440;return seMin>ssMin?(m>=ssMin&&m<seMin):(m>=ssMin||m<seMin);}

  let lastEntryTs=-1; // 같은 틱 폭주 방지용 아님 — 틱마다 1회 진입판단
  for(let i=0;i<n&&!liq;i++){
    const t=ts[i],ask=A[i],bid=B[i];
    // TP 체크 (틱마다)
    if(buy.length){const avg=vw(buy);const tp=avg+(tpP/buy.length)*POINT;if(bid>=tp){let pnl=(tp-avg)*CSIZE*tl(buy);if(pnl<0&&balance+pnl<=0){balance=0;liq=true;}else balance+=pnl;nB++;pnl>0?nW++:nL++;buy=[];}}
    if(!liq&&sell.length){const avg=vw(sell);const tp=avg-(tpP/sell.length)*POINT;if(ask<=tp){let pnl=(avg-tp)*CSIZE*tl(sell);if(pnl<0&&balance+pnl<=0){balance=0;liq=true;}else balance+=pnl;nB++;pnl>0?nW++:nL++;sell=[];}}
    if(liq)break;
    // SL
    if(slUsd>0){
      if(buy.length){const pl=(bid-vw(buy))*CSIZE*tl(buy);if(pl<=-slUsd){if(balance+pl<=0){balance=0;liq=true;}else balance+=pl;nB++;nL++;buy=[];}}
      if(!liq&&sell.length){const pl=(vw(sell)-ask)*CSIZE*tl(sell);if(pl<=-slUsd){if(balance+pl<=0){balance=0;liq=true;}else balance+=pl;nB++;nL++;sell=[];}}
      if(liq)break;
    }
    // 마진콜 + equity 추적
    let unr=0;if(buy.length)unr+=(bid-vw(buy))*CSIZE*tl(buy);if(sell.length)unr+=(vw(sell)-ask)*CSIZE*tl(sell);
    const eq=balance+unr;
    if(eq<=0){balance=0;liq=true;break;}
    if(eq>peak)peak=eq; const dd=peak-eq; if(dd>maxDD)maxDD=dd;
    if(eq<minEq)minEq=eq;
    // 세션 체크
    if(!inSess(t)){
      if(closeEnd&&(buy.length||sell.length)){
        if(buy.length){let pnl=(bid-vw(buy))*CSIZE*tl(buy);if(pnl<0&&balance+pnl<=0){balance=0;liq=true;}else balance+=pnl;nB++;pnl>0?nW++:nL++;buy=[];}
        if(!liq&&sell.length){let pnl=(vw(sell)-ask)*CSIZE*tl(sell);if(pnl<0&&balance+pnl<=0){balance=0;liq=true;}else balance+=pnl;nB++;pnl>0?nW++:nL++;sell=[];}
      }
      continue;
    }
    // 진입/추가 (틱마다 판단; 1초봉의 "종가 1회"와 달리 틱마다지만 트리거조건으로 제어)
    if(buy.length===0){buy.push({px:ask,lot:startLot,trig:ask-interval*POINT});nT++;}
    else{let g=0;while(ask<=buy[buy.length-1].trig&&buy.length<maxOrders&&g++<50){buy.push({px:ask,lot:lotAt(startLot,mult,buy.length),trig:ask-interval*POINT});nT++;}}
    if(sell.length===0){sell.push({px:bid,lot:startLot,trig:bid+interval*POINT});nT++;}
    else{let g=0;while(bid>=sell[sell.length-1].trig&&sell.length<maxOrders&&g++<50){sell.push({px:bid,lot:lotAt(startLot,mult,sell.length),trig:bid+interval*POINT});nT++;}}
    if(buy.length>maxConc)maxConc=buy.length;if(sell.length>maxConc)maxConc=sell.length;
  }
  return {pnl:Math.round((balance-seed)*100)/100,balance:Math.round(balance*100)/100,baskets:nB,trades:nT,wins:nW,losses:nL,winRate:nB?Math.round(nW/nB*1000)/10:0,liquidated:liq,maxDD:Math.round(maxDD*100)/100,minEq:Math.round(minEq*100)/100,maxConcurrent:maxConc};
}

module.exports={loadTicks,simulateTick,lotAt};
