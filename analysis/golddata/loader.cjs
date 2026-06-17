// 메모리 효율 봉 로더 — 미리 넉넉히 할당 후 파일을 하나씩 풀어 채우고 즉시 해제
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function listS1(dir) {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.csv.gz') && f.includes('-s1-'))
    .sort();
}

function loadAllBars(dir, capacity = 9000000) {
  const files = listS1(dir);
  const ts = new Float64Array(capacity), o = new Float64Array(capacity),
        h = new Float64Array(capacity), l = new Float64Array(capacity), c = new Float64Array(capacity);
  let idx = 0;
  for (const f of files) {
    let text = zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString('utf8');
    let lineNo = 0, start = 0;
    const len = text.length;
    for (let i = 0; i <= len; i++) {
      if (i === len || text.charCodeAt(i) === 10) {
        if (i > start) {
          lineNo++;
          if (lineNo > 1) {
            const line = text.slice(start, i);
            const ci = line.indexOf(',');
            const t = +line.slice(0, ci);
            if (isFinite(t)) {
              // o,h,l,c 파싱
              let p1 = ci + 1, p2 = line.indexOf(',', p1);
              let p3 = line.indexOf(',', p2 + 1);
              let p4 = line.indexOf(',', p3 + 1);
              ts[idx] = t;
              o[idx] = +line.slice(p1, p2);
              h[idx] = +line.slice(p2 + 1, p3);
              l[idx] = +line.slice(p3 + 1, p4);
              c[idx] = +line.slice(p4 + 1);
              idx++;
            }
          }
        }
        start = i + 1;
      }
    }
    text = null; // 해제 유도
  }
  // 실제 크기로 subarray (뷰, 복사 아님)
  return {
    ts: ts.subarray(0, idx), o: o.subarray(0, idx), h: h.subarray(0, idx),
    l: l.subarray(0, idx), c: c.subarray(0, idx), n: idx,
  };
}

module.exports = { loadAllBars, listS1 };
