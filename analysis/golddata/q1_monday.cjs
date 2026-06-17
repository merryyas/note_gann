// Q1: 월요일 제외 on/off 비교. 강건세팅 25개 각각에 대해 전기간 결과 대조.
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');
const SPREAD = 0.62;
const full = loadAllBars(process.argv[2] || './sec1');
const robust = require('./robust_results.json');

// 중복 세팅(월제외 빼고 동일) 제거 → 파라미터 키별로 on/off 둘 다 돌려 비교
const seen = new Set();
const uniq = [];
for (const r of robust) {
  const key = `${r.session}|${r.tpPoints}|${r.lotMult}|${r.interval}|${r.maxOrders}`;
  if (seen.has(key)) continue; seen.add(key); uniq.push(r);
}

const SESSMAP = {
  'KST11:30-13:00':[150,240],'KST12-13':[180,240],'KST12-14':[180,300],
  'KST18:30-19:30':[570,630],'KST18-20':[540,660],'KST19-20':[600,660],'KST13-14':[240,300],
};

console.log('=== Q1: 월요일 제외 효과 (전기간, 시드$1000) ===');
console.log('시간대 | tp | mult | int | maxO || 제외X pnl/DD | 제외O pnl/DD | 판정');
let better=0, worse=0, same=0;
for (const r of uniq) {
  const sm = SESSMAP[r.session];
  const base = {seed:1000,startLot:0.01,tpPoints:r.tpPoints,lotMult:r.lotMult,interval:r.interval,
    maxOrders:r.maxOrders,slUsd:0,sessStartMin:sm[0],sessEndMin:sm[1],closeAtSessionEnd:true};
  const off = simulateFast(full, {...base, skipDow:null}, SPREAD);
  const on  = simulateFast(full, {...base, skipDow:[1]}, SPREAD);
  const diff = on.pnl - off.pnl;
  const verd = off.liquidated&&!on.liquidated ? '제외O가 청산막음🛡️'
             : !off.liquidated&&on.liquidated ? '제외O가 청산유발⚠️'
             : diff>20 ? '제외O 수익↑' : diff<-20 ? '제외X 수익↑' : '비슷';
  if(diff>20)better++; else if(diff<-20)worse++; else same++;
  console.log(`${r.session.padEnd(14)} | ${String(r.tpPoints).padStart(3)} | ${String(r.lotMult).padStart(3)} | ${String(r.interval).padStart(3)} | ${String(r.maxOrders).padStart(2)} || ${(off.liquidated?'💀':'$'+Math.round(off.pnl)).padStart(7)}/${String(Math.round(off.maxDD)).padStart(4)} | ${(on.liquidated?'💀':'$'+Math.round(on.pnl)).padStart(7)}/${String(Math.round(on.maxDD)).padStart(4)} | ${verd}`);
}
console.log(`\n요약: 제외O 유리 ${better} | 제외X 유리 ${worse} | 비슷 ${same} (총 ${uniq.length})`);
