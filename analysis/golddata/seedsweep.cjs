// 가장 오래 버틴 후보들을 다양한 시드로 재시뮬 → 진짜 필요시드 확인
const { loadAllBars } = require('./loader.cjs');
const { simulateFast } = require('./engine_fast.cjs');
const SPREAD = 0.62;
const dir = process.argv[2] || './sec1';

console.error('로딩...');
const t0 = Date.now();
const bars = loadAllBars(dir);
console.error(`로드 ${bars.n}바 ${((Date.now()-t0)/1000).toFixed(1)}s`);

const base = { startLot:0.01, slUsd:0 };
// 오래 버틴 상위 후보들
const cands = [
  {tpPoints:200,lotMult:1.3,interval:300,maxOrders:15,session:[6,15]},
  {tpPoints:200,lotMult:1.5,interval:300,maxOrders:10,session:[6,15]},
  {tpPoints:200,lotMult:2,interval:500,maxOrders:8,session:[6,15]},
  {tpPoints:200,lotMult:2,interval:500,maxOrders:6,session:[6,15]},
  {tpPoints:300,lotMult:1.3,interval:300,maxOrders:8,session:[6,15]},
];
const seeds = [1000, 5000, 10000, 30000, 100000];

for (const c of cands) {
  const tag = `tp${c.tpPoints} mult${c.lotMult} int${c.interval} max${c.maxOrders} sess${c.session}`;
  const line = [tag.padEnd(48)];
  for (const seed of seeds) {
    const p = { ...base, ...c, seed,
      sessStartUTC: c.session ? c.session[0] : null,
      sessEndUTC: c.session ? c.session[1] : null };
    const r = simulateFast(bars, p, SPREAD);
    if (r.liquidated) line.push(`$${seed}:청산`);
    else line.push(`$${seed}:생존 pnl=$${Math.round(r.pnl)} (DD$${Math.round(r.maxDD)})`);
  }
  console.log(line.join(' | '));
}
