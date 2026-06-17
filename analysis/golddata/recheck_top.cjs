// 더블체크: 3~5월 승률92%+ 고수익 TOP 재현 + 사용자 의심(mult2/8차수 → $1000 청산위험) 검증.
//  1) idea2_results.json에서 승률>=92 & 미청산 고수익 TOP 재추출
//  2) 각 TOP을 engine_fast로 "재시뮬"하여 JSON값과 일치하는지 더블체크
//  3) 마틴게일 랏/마진 수학적 분석 (mult/maxOrders별 막차랏, 총랏, 필요증거금)
//  4) minEq(최저 equity)로 "청산 직전까지 갔는지" 확인
//  5) Jan-Feb 아웃샘플 청산 검증
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');
const fs = require('fs');
const SPREAD=0.62, POINT=0.01, CSIZE=100;

const all = JSON.parse(fs.readFileSync('./idea2_results.json','utf8'));

// 세션라벨 → sessMin 매핑
const SESS={
  'KST11:30-13:00':{ss:150,se:240},   // UTC02:30-04:00
  'KST12-13':{ss:180,se:240},         // UTC03-04
  'KST12-14':{ss:180,se:300},         // UTC03-05
  'KST13-14':{ss:240,se:300},         // UTC04-05
  'KST18:30-19:30':{ss:570,se:630},   // UTC09:30-10:30
  'KST18-20':{ss:540,se:660},         // UTC09-11
  'KST19-20':{ss:600,se:660},         // UTC10-11
};

// --- 1) 승률>=92 & 미청산 & 수익>0 TOP10 ---
const top = all.filter(r=>!r.liquidated && r.winRate>=92 && r.pnl>0)
               .sort((a,b)=>b.pnl-a.pnl).slice(0,10);
console.log('=== 3~5월 승률≥92% 미청산 고수익 TOP10 (idea2 JSON 원본) ===');
console.log('순위 손익      승률   DD     N  세팅');
top.forEach((r,i)=>{
  console.log(`${String(i+1).padStart(2)}  +$${String(Math.round(r.pnl)).padStart(5)} ${String(r.winRate).padStart(5)}% $${String(Math.round(r.maxDD)).padStart(4)} ${String(r.maxConcurrent).padStart(2)}  ${r.session} tp${r.tpPoints} mult${r.lotMult} int${r.interval} maxO${r.maxOrders} sl${r.slUsd} ${r.skipMon?'월제외':'전요일'}`);
});

// --- 3) 마틴게일 랏/마진 수학 분석 ---
console.log('\n=== 마틴게일 랏/증거금 수학분석 (시작랏 0.01) ===');
console.log('  XAUUSD 기준가 ~$3300 가정, 1랏=100oz, 레버리지 1:500 → 필요증거금=계약금액/500');
function lotAt(m,k){return Math.round(0.01*Math.pow(m,k)*100)/100;}
function analyze(mult,maxO){
  let tot=0; const lots=[];
  for(let k=0;k<maxO;k++){const lt=lotAt(mult,k);lots.push(lt);tot+=lt;}
  const last=lots[lots.length-1];
  const px=3300;
  // 한방향 풀차수 계약금액 = tot랏 * 100oz * px
  const notional=tot*CSIZE*px;
  const marg500=notional/500;
  // 양방향 동시 풀이면 ×2 (헷지지만 브로커에 따라 양쪽 증거금 잡힐 수 있음)
  return {lots,tot:Math.round(tot*100)/100,last,marg500:Math.round(marg500),margBoth:Math.round(marg500*2)};
}
for(const [mult,maxO] of [[1.3,12],[1.5,8],[1.5,12],[2.0,5],[2.0,8],[2.0,12]]){
  const a=analyze(mult,maxO);
  console.log(`mult${mult} maxO${maxO}: 막차랏 ${a.last} / 총랏 ${a.tot} / 한방향증거금 $${a.marg500} / 양방향 $${a.margBoth}  랏열[${a.lots.join(',')}]`);
}
console.log('  ※ $1000 시드 대비 양방향 증거금이 시드를 초과하면 = 마진콜(청산) 불가피 구간');

// --- 2)+4)+5) TOP을 실제 재시뮬하여 더블체크 + minEq + 아웃샘플 ---
console.log('\n=== 더블체크: TOP 재시뮬 (3~5월 재현 + Jan-Feb 아웃샘플) ===');
const full = loadAllBars(process.argv[2]||'./sec1');
function D(s){return new Date(s+'T00:00:00Z').getTime();}
function slice(b,t0,t1){const{ts}=b;let i0=0,i1=b.n;while(i0<b.n&&ts[i0]<t0)i0++;while(i1>0&&ts[i1-1]>=t1)i1--;return{ts:ts.subarray(i0,i1),o:b.o.subarray(i0,i1),h:b.h.subarray(i0,i1),l:b.l.subarray(i0,i1),c:b.c.subarray(i0,i1),n:i1-i0};}
const marMay = slice(full, D('2026-03-01'), D('2026-06-01'));
const janFeb = slice(full, D('2026-01-01'), D('2026-03-01'));
console.log(`  Mar-May 바 ${marMay.n.toLocaleString()} / Jan-Feb 바 ${janFeb.n.toLocaleString()}`);

console.log('\n순위 [원본JSON]        →[3-5월재시뮬]              [Jan-Feb 아웃샘플]');
top.forEach((r,i)=>{
  const S=SESS[r.session];
  const p={seed:1000,startLot:0.01,tpPoints:r.tpPoints,lotMult:r.lotMult,interval:r.interval,maxOrders:r.maxOrders,slUsd:r.slUsd,sessStartMin:S.ss,sessEndMin:S.se,closeAtSessionEnd:true};
  if(r.skipMon)p.skipDow=[1];
  const re = simulateFast(marMay, p, SPREAD);
  const out = simulateFast(janFeb, p, SPREAD);
  const reEq = re.minEq!=null?re.minEq:'-';
  const match = (Math.abs(re.pnl-r.pnl)<5)?'✓일치':`✗불일치(Δ${Math.round(re.pnl-r.pnl)})`;
  console.log(`${String(i+1).padStart(2)}  원본+$${Math.round(r.pnl)} → 재시뮬 ${re.liquidated?'💀':'+$'+Math.round(re.pnl)} (최저eq$${re.minEq},${match}) | 아웃샘플 ${out.liquidated?'💀청산':'+$'+Math.round(out.pnl)+'(eq$'+out.minEq+')'}`);
});

console.log('\n=== 사용자 의심 직접검증: mult2.0 maxO8 단독 ($1000) ===');
for(const sess of ['KST11:30-13:00','KST18:30-19:30']){
  const S=SESS[sess];
  const p={seed:1000,startLot:0.01,tpPoints:500,lotMult:2.0,interval:200,maxOrders:8,slUsd:0,sessStartMin:S.ss,sessEndMin:S.se,closeAtSessionEnd:true,skipDow:[1]};
  const mm=simulateFast(marMay,p,SPREAD);
  const jf=simulateFast(janFeb,p,SPREAD);
  console.log(`${sess}: 3-5월 ${mm.liquidated?'💀청산':'+$'+Math.round(mm.pnl)+' (최저eq$'+mm.minEq+', DD$'+Math.round(mm.maxDD)+', maxN'+mm.maxConcurrent+')'} | Jan-Feb ${jf.liquidated?'💀청산':'+$'+Math.round(jf.pnl)+' (최저eq$'+jf.minEq+')'}`);
}
