// 1초봉 gz 파일들을 읽어 가격 경로(틱 근사)로 전개하는 로더
//   1초봉은 bid OHLC만 제공 → ask = bid + spread(pt) 로 근사
//   봉 내부 경로: O → L → H → C (보수적; 불리한 가격 먼저 확인)
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const SPREAD_PT = 62;            // 실측 평균 spread (pt)
const SPREAD = SPREAD_PT * 0.01; // = $0.62

// sec1 디렉토리의 모든 gz를 날짜순으로 읽어 {t,ask,bid} 시퀀스 yield
function* loadS1Feed(dir, spread = SPREAD) {
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.csv.gz') && f.includes('-s1-'))
    .sort();  // 파일명에 날짜 포함 → 사전순=시간순
  for (const f of files) {
    const buf = zlib.gunzipSync(fs.readFileSync(path.join(dir, f)));
    const text = buf.toString('utf8');
    let start = 0;
    const len = text.length;
    let lineNo = 0;
    for (let i = 0; i <= len; i++) {
      if (i === len || text[i] === '\n') {
        const line = text.slice(start, i).trim();
        start = i + 1;
        lineNo++;
        if (lineNo === 1 || !line) continue;  // 헤더/빈줄
        const c = line.split(',');
        const t = +c[0], o = +c[1], h = +c[2], l = +c[3], cl = +c[4];
        if (!isFinite(t) || !isFinite(o)) continue;
        // 봉 내부 4점 전개: O, L, H, C (각각 bid 기준)
        // ask = bid + spread
        // SELL은 bid로, BUY는 ask로 평가되므로 둘 다 제공
        yield { t: t,       ask: o + spread, bid: o };
        yield { t: t + 250, ask: l + spread, bid: l };
        yield { t: t + 500, ask: h + spread, bid: h };
        yield { t: t + 750, ask: cl + spread, bid: cl };
      }
    }
  }
}

// 통계: 파일 수, 봉 수, 기간
function s1Stats(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.csv.gz') && f.includes('-s1-')).sort();
  return { files: files.length, first: files[0], last: files[files.length - 1] };
}

module.exports = { loadS1Feed, s1Stats, SPREAD, SPREAD_PT };
