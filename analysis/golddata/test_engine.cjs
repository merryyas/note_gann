// 엔진 + 1초봉 로더 동작 테스트 (받아둔 01-02 하루치로)
const { simulate } = require('./engine.cjs');
const { loadS1Feed, s1Stats } = require('./load_s1.cjs');

console.log('1초봉 파일 현황:', s1Stats('./sec1'));

// 실제 EA 디폴트 세팅
const p = {
  seed: 1000, startLot: 0.01, tpPoints: 300, lotMult: 1.5,
  interval: 300, maxOrders: 8, allowBuy: true, allowSell: true,
  slUsd: 0, sessStartUTC: null, sessEndUTC: null,
};

console.log('\n=== 01-02 하루치 1초봉 시뮬 (실제 EA 디폴트, 세션필터 없음) ===');
const t0 = Date.now();
const feed = loadS1Feed('./sec1');
const r = simulate(feed, p);
console.log(`소요: ${((Date.now()-t0)/1000).toFixed(1)}초`);
console.log(`바스켓=${r.baskets} 거래=${r.trades} 손익=$${r.pnl} 승률=${r.winRate}%`);
console.log(`최대동시=${r.maxConcurrent} 최대DD=$${r.maxDD} 청산=${r.liquidated} 잔고=$${r.balance}`);
console.log(`승/패=${r.wins}/${r.losses}`);
