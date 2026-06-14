// MT4 Statement 정밀 파서 — EA(#234568 AUTO LOGIC 3) 실제 로직 역설계용
const fs = require('fs');
const path = process.argv[2] || '/home/user/uploaded_files/DetailedStatement_최근3개월 (3).htm';
const html = fs.readFileSync(path, 'utf8');

// 거래 행 추출: <tr ...><td title="...">ticket</td><td>opentime</td><td>type</td><td>size</td><td>item</td>
//   <td>openprice</td><td>sl</td><td>tp</td><td>closetime</td><td>closeprice</td><td>comm</td><td>tax</td><td>swap</td><td>profit</td>
const rows = html.split('<tr').slice(1);
const trades = [];
const balances = [];

for (const r of rows) {
  // title 코멘트
  const titleM = r.match(/title="([^"]*)"/);
  const tds = [...r.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(m => m[1].replace(/<[^>]*>/g, '').trim());
  if (tds.length < 4) continue;
  const type = tds[2];
  if (type === 'balance') {
    balances.push({ ticket: tds[0], time: tds[1], amount: parseFloat(tds[tds.length - 1]) });
    continue;
  }
  if (type !== 'buy' && type !== 'sell') continue;
  // MT4 closed trade row
  // tds: [ticket, openTime, type, size, item, openPrice, sl, tp, closeTime, closePrice, comm, tax, swap, profit]
  const t = {
    ticket: tds[0],
    comment: titleM ? titleM[1].replace(/^#\d+\s*/, '') : '',
    openTime: tds[1],
    type,
    size: parseFloat(tds[3]),
    item: tds[4],
    openPrice: parseFloat(tds[5]),
    sl: parseFloat(tds[6]),
    tp: parseFloat(tds[7]),
    closeTime: tds[8],
    closePrice: parseFloat(tds[9]),
    profit: parseFloat(tds[tds.length - 1]),
  };
  if (!isNaN(t.openPrice) && !isNaN(t.closePrice)) trades.push(t);
}

console.log('=== 거래 수:', trades.length, ' / 입출금:', balances.length);
console.log('=== 입출금 내역 ===');
balances.forEach(b => console.log(`  ${b.time}  $${b.amount}`));

// 코멘트 패턴 집계
const byComment = {};
trades.forEach(t => { byComment[t.comment] = (byComment[t.comment] || 0) + 1; });
console.log('\n=== 코멘트별 거래 수 ===');
Object.entries(byComment).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(`  ${k}: ${v}`));

// 랏 사이즈 분포
const bySize = {};
trades.forEach(t => { bySize[t.size] = (bySize[t.size] || 0) + 1; });
console.log('\n=== 랏 사이즈 분포 ===');
Object.entries(bySize).sort((a,b)=>parseFloat(a[0])-parseFloat(b[0])).forEach(([k,v]) => console.log(`  ${k} lot: ${v}건`));

// "바스켓" 식별: 같은 closeTime + 같은 방향 = 동시청산된 그룹
// → 통합TP/SL로 한꺼번에 닫혔는지 확인
const groups = {};
trades.forEach(t => {
  const key = t.closeTime + '|' + t.type;
  (groups[key] = groups[key] || []).push(t);
});
const multiClose = Object.entries(groups).filter(([k,v]) => v.length > 1);
console.log('\n=== 동시청산(같은 closeTime+방향) 그룹 수:', multiClose.length, '/ 전체 그룹:', Object.keys(groups).length);
console.log('=== 동시청산 그룹 크기 분포 ===');
const sizeDist = {};
Object.values(groups).forEach(v => { sizeDist[v.length] = (sizeDist[v.length]||0)+1; });
Object.entries(sizeDist).sort((a,b)=>+a[0]-+b[0]).forEach(([k,v]) => console.log(`  ${k}개 동시청산: ${v}그룹`));

// 첫 20개 거래 시퀀스 상세
console.log('\n=== 첫 25개 거래 시퀀스 ===');
trades.slice(0, 25).forEach((t,i) => {
  console.log(`[${String(i+1).padStart(2)}] ${t.openTime} → ${t.closeTime} | ${t.type.padEnd(4)} ${t.size} @ ${t.openPrice}→${t.closePrice} | ${t.comment.padEnd(16)} | P&L ${t.profit>=0?'+':''}${t.profit}`);
});

// 마틴게일 트리거 간격 분석: Initial→Martin 가격차
console.log('\n=== 마틴게일 진입 간격 분석 (Initial 대비 Martin 진입가 차이, 포인트) ===');
// 같은 방향 연속 진입을 바스켓으로 묶어 분석
const sorted = [...trades].sort((a,b) => a.openTime.localeCompare(b.openTime));
let curBasket = { buy: [], sell: [] };
const intervals = [];
const ratios = [];
for (const t of sorted) {
  const dir = t.type;
  const isInitial = t.comment.startsWith('Initial');
  const isMartin = t.comment.startsWith('Martin');
  if (isInitial) {
    curBasket[dir] = [t];
  } else if (isMartin && curBasket[dir].length) {
    const prev = curBasket[dir][curBasket[dir].length - 1];
    const diffPts = Math.abs(t.openPrice - prev.openPrice) / 0.01;
    intervals.push(diffPts);
    ratios.push(+(t.size / prev.size).toFixed(2));
    curBasket[dir].push(t);
  }
}
if (intervals.length) {
  intervals.sort((a,b)=>a-b);
  const avg = intervals.reduce((s,x)=>s+x,0)/intervals.length;
  console.log(`  진입간격 포인트: min=${intervals[0].toFixed(0)} / 중앙값=${intervals[Math.floor(intervals.length/2)].toFixed(0)} / avg=${avg.toFixed(0)} / max=${intervals[intervals.length-1].toFixed(0)}`);
  console.log(`  샘플 간격(앞 15개):`, intervals.slice(0,15).map(x=>x.toFixed(0)).join(', '));
}
const ratioDist = {};
ratios.forEach(r => { ratioDist[r] = (ratioDist[r]||0)+1; });
console.log('  랏 배수 분포:', JSON.stringify(ratioDist));

// 익절 포인트 분석: 단일 청산된 [tp] 거래의 진입→청산 포인트
console.log('\n=== 익절(TP) 포인트 분석 ===');
const tpPts = [];
trades.filter(t => t.comment.includes('[tp]')).forEach(t => {
  const pts = (t.type === 'buy' ? t.closePrice - t.openPrice : t.openPrice - t.closePrice) / 0.01;
  tpPts.push(pts);
});
if (tpPts.length) {
  const sortedTp = [...tpPts].sort((a,b)=>a-b);
  console.log(`  [tp] 청산 거래 ${tpPts.length}건, 포인트 중앙값=${sortedTp[Math.floor(sortedTp.length/2)].toFixed(0)}, avg=${(tpPts.reduce((s,x)=>s+x,0)/tpPts.length).toFixed(0)}`);
}

// 총 손익
const totalPnl = trades.reduce((s,t)=>s+t.profit, 0);
console.log('\n=== 총 실현손익(거래만):', totalPnl.toFixed(2), 'USD');
console.log('=== 기간:', sorted[0]?.openTime, '~', sorted[sorted.length-1]?.closeTime);
