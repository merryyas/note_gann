// UTC 시간대별 변동성 측정: 시간당 (고-저) 평균/최대 레인지, 평균 절대 가격변화
const { loadAllBars } = require('./loader.cjs');
const bars = loadAllBars('./sec1');
const { ts, o, h, l, c, n } = bars;

// 시간(UTC 0~23)별로 그 시간 동안의 (max high - min low) 레인지를 일자별로 모음
// 키: hourUTC -> {dayKey -> {hi, lo}}
const hourDay = {}; // hour -> Map(dayKey -> [hi,lo])
for (let i = 0; i < n; i++) {
  const t = ts[i];
  const hUTC = Math.floor(t / 3600000) % 24;
  const dayKey = Math.floor(t / 86400000);
  if (!hourDay[hUTC]) hourDay[hUTC] = new Map();
  const m = hourDay[hUTC];
  let e = m.get(dayKey);
  if (!e) { e = [l[i], h[i]]; m.set(dayKey, e); }
  else { if (h[i] > e[1]) e[1] = h[i]; if (l[i] < e[0]) e[0] = l[i]; }
}

console.log('UTC | KST | 일평균레인지($) | 최대레인지($) | 일수');
const rows = [];
for (let hUTC = 0; hUTC < 24; hUTC++) {
  const m = hourDay[hUTC];
  if (!m) continue;
  const ranges = [...m.values()].map(([lo,hi]) => hi - lo);
  const avg = ranges.reduce((a,b)=>a+b,0)/ranges.length;
  const mx = Math.max(...ranges);
  const kst = (hUTC + 9) % 24;
  rows.push({ hUTC, kst, avg, mx, days: ranges.length });
}
// UTC 순 출력
for (const r of rows.sort((a,b)=>a.hUTC-b.hUTC)) {
  console.log(`${String(r.hUTC).padStart(2)}h | ${String(r.kst).padStart(2)}h | ${r.avg.toFixed(2).padStart(8)} | ${r.mx.toFixed(2).padStart(8)} | ${r.days}`);
}
console.log('\n=== 잔잔한 순(일평균레인지 작은 순) TOP8 ===');
for (const r of [...rows].sort((a,b)=>a.avg-b.avg).slice(0,8)) {
  console.log(`UTC ${String(r.hUTC).padStart(2)}h (KST ${String(r.kst).padStart(2)}h): 평균$${r.avg.toFixed(2)} 최대$${r.mx.toFixed(2)}`);
}
