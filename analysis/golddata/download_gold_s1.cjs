// PC에서 직접 실행하는 XAUUSD 1초봉 다운로더.
// Claude Code 계산 샌드박스에선 datafeed.dukascopy.com이 막혀 실패하므로,
// 반드시 "인터넷이 열린 PC의 터미널"에서 실행할 것.
//
// 사용법:
//   node download_gold_s1.cjs <START_YYYY-MM-DD> <END_YYYY-MM-DD> [outDir]
// 예) 2025년 하반기:
//   node download_gold_s1.cjs 2025-06-17 2026-01-01 ./sec1_2025h2
//
// 결과: outDir/xauusd-s1-bid-YYYY-MM-DD-YYYY-MM-DD.csv.gz  (하루 1파일, gzip)
//   CSV 헤더: timestamp,open,high,low,close  (timestamp=Unix ms UTC, bid 가격)
//   → 기존 2026 sec1 데이터와 동일 포맷. 그대로 병합 가능.
//
// 의존성: dukascopy-node (npx로 자동 설치됨). Node 18+ 필요.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const START = process.argv[2];
const END = process.argv[3];
const OUTDIR = process.argv[4] || './sec1_download';
if (!START || !END) {
  console.error('사용법: node download_gold_s1.cjs <START> <END> [outDir]');
  console.error('예)    node download_gold_s1.cjs 2025-06-17 2026-01-01 ./sec1_2025h2');
  process.exit(1);
}
fs.mkdirSync(OUTDIR, { recursive: true });

function addDay(d) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); }
function dow(d) { return new Date(d + 'T00:00:00Z').getUTCDay(); } // 0=일~6=토

let cur = START, ok = 0, skip = 0, fail = 0;
console.log(`=== XAUUSD 1초봉 다운로드: ${START} ~ ${END} → ${OUTDIR} ===`);

while (new Date(cur + 'T00:00:00Z') < new Date(END + 'T00:00:00Z')) {
  const next = addDay(cur);
  // 토요일 휴장 스킵
  if (dow(cur) === 6) { console.log(`[${cur}] 토요일 스킵`); cur = next; continue; }

  const gzName = path.join(OUTDIR, `xauusd-s1-bid-${cur}-${next}.csv.gz`);
  if (fs.existsSync(gzName)) { console.log(`[${cur}] 이미 있음 스킵`); skip++; cur = next; continue; }

  let done = false;
  for (let attempt = 1; attempt <= 3 && !done; attempt++) {
    try {
      // dukascopy-node로 1초봉(s1) bid CSV 다운로드
      execSync(
        `npx --yes dukascopy-node -i xauusd -from ${cur} -to ${next} -t s1 -p bid -f csv -dir "${OUTDIR}" -r 5 -bp 100`,
        { stdio: 'ignore', timeout: 180000 }
      );
      // dukascopy-node 출력 파일명 추정 → 우리 포맷명으로 정규화 + gzip
      const produced = fs.readdirSync(OUTDIR).find(f => f.includes(cur) && f.endsWith('.csv') && f.includes('xauusd'));
      if (produced) {
        const full = path.join(OUTDIR, produced);
        const rows = fs.readFileSync(full, 'utf8');
        if (rows.split('\n').length > 2) {
          fs.writeFileSync(gzName, zlib.gzipSync(rows));
          fs.unlinkSync(full);
          console.log(`[${cur}] OK (${rows.split('\n').length}행)`);
          ok++; done = true;
        }
      }
    } catch (e) {
      console.log(`[${cur}] 시도 ${attempt} 실패: ${String(e.message).slice(0,60)}`);
    }
  }
  if (!done) { console.log(`[${cur}] ★실패(3회) — 공휴일/빈날일 수 있음`); fail++; }
  cur = next;
}
console.log(`\n=== 완료: 성공 ${ok} · 스킵 ${skip} · 실패 ${fail} ===`);
console.log(`파일 위치: ${path.resolve(OUTDIR)}`);
