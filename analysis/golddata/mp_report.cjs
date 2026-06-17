const fs=require('fs');
const R=JSON.parse(fs.readFileSync('./allprofit_results.json','utf8'));
console.log(`총 ${R.length}조합 분석 (월요일제외, 각달 독립 $1000)\n`);
function fmt(r){const months=r.pm.map(p=>p.liq?'💀':((p.pnl>=0?'+':'')+p.pnl)).join('/');return `${r.sname} tp${r.tp}/m${r.m}/int${r.it}/o${r.mo}`.padEnd(32)+` [${months}]`;}

// 1) 5달 전부 흑자 & 청산0
const allPos=R.filter(r=>!r.anyLiq && r.negMonths===0).sort((a,b)=>b.sumPnl-a.sumPnl);
if(allPos.length){
  console.log(`✅✅ 5달 전부 흑자(+) & 청산0 : ${allPos.length}개\n`);
  console.log('순위 누적     최저eq  세팅 / 월별손익(1~5월)');
  allPos.forEach((r,i)=>console.log(`${String(i+1).padStart(2)} +$${String(r.sumPnl).padStart(5)} $${String(r.minEqAll).padStart(4)}  ${fmt(r)}`));
}else{
  console.log('❌ 5달 전부 흑자 조합 없음.\n');
}

// 2) 청산0 + 손실달 ≤1 (거의 매달 흑자)
const near=R.filter(r=>!r.anyLiq && r.negMonths<=1).sort((a,b)=> a.negMonths-b.negMonths || b.sumPnl-a.sumPnl);
console.log(`\n=== 청산0 + 손실달 ≤1달 : ${near.length}개 (TOP15) ===`);
console.log('손실달 누적    최저eq  세팅 / 월별손익');
near.slice(0,15).forEach(r=>console.log(`${r.negMonths}달 +$${String(r.sumPnl).padStart(5)} $${String(r.minEqAll).padStart(4)}  ${fmt(r)}`));

// 3) 청산0 전체 중 누적 TOP (참고)
const safe=R.filter(r=>!r.anyLiq).sort((a,b)=>b.sumPnl-a.sumPnl);
console.log(`\n=== 청산0 전체 ${safe.length}개 중 누적수익 TOP10 (참고) ===`);
console.log('손실달 누적    최저eq  세팅 / 월별손익');
safe.slice(0,10).forEach(r=>console.log(`${r.negMonths}달 +$${String(r.sumPnl).padStart(5)} $${String(r.minEqAll).padStart(4)}  ${fmt(r)}`));

// 통계
const liqCnt=R.filter(r=>r.anyLiq).length;
console.log(`\n[요약] 청산발생 ${liqCnt}/${R.length} · 청산0 ${safe.length} · 5달전부흑자 ${allPos.length} · 손실달≤1 ${near.length}`);
