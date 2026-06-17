# Claude Code(Opus)에게 주는 지시 — 1초봉 데이터 확보 방법

## 결론부터
**너(Claude Code)의 계산 샌드박스에서는 dukascopy 데이터를 받을 수 없다.**
`datafeed.dukascopy.com`이 그 샌드박스 네트워크 허용목록에서 차단되어 있고,
`.bi5` 파일은 LZMA 바이너리라 WebFetch로도 못 가져온다. 도메인 허용으로는 해결 안 됨.

→ **데이터 다운로드는 "인터넷이 열린 사용자 PC의 터미널"에서 직접 실행해야 한다.**
   너는 (1) 사용자에게 PC에서 돌릴 명령을 안내하고, (2) 받아온 파일을 너의 작업폴더에서
   병합·결측검증·백테스트하는 역할만 맡아라. 직접 받으려고 재시도하지 마라(계속 fetch failed 난다).

---

## 사용자 PC에서 실행할 절차 (너가 사용자에게 안내할 내용)

### 1. 다운로더 스크립트 준비
저장소에 `analysis/golddata/download_gold_s1.cjs` 가 있다. (없으면 이 문서 하단 부록 참고)

### 2. PC 터미널에서 실행 (인터넷 연결된 일반 PC)
```bash
# Node 18+ 필요. 폴더 이동 후:
cd note_gann/analysis/golddata

# 예) 2025년 하반기(오늘 기준 1년 전 ~ 기존 2026 데이터 시작 직전)
node download_gold_s1.cjs 2025-06-17 2026-01-01 ./sec1_2025h2
```
- 하루씩 자동 다운로드, 토요일 자동 스킵, 이미 받은 날은 스킵(재개 가능).
- 출력: `sec1_2025h2/xauusd-s1-bid-YYYY-MM-DD-YYYY-MM-DD.csv.gz`
- 약 130거래일 × 30~60초 = 1~1.5시간.

### 3. 받은 폴더를 너의 작업폴더로 이동
`sec1_2025h2/` 폴더를 너(Claude Code) 작업 디렉토리에 둔다.

---

## 너(Claude Code)가 받은 뒤 할 일

### A. 기존 2026 데이터와 병합
기존 `sec1/`(2026-01-02~)과 새 `sec1_2025h2/`(2025-06~12)를 합친다:
```bash
mkdir -p sec1_full
cp sec1_2025h2/*.csv.gz sec1_full/
cp sec1/*.csv.gz sec1_full/
ls sec1_full | wc -l
```

### B. 결측/연속성 검증 (날짜 갭 점검)
```bash
node -e "
const fs=require('fs');
const files=fs.readdirSync('./sec1_full').filter(f=>f.endsWith('.gz')).sort();
let prev=null, gaps=0;
for(const f of files){
  const m=f.match(/(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})/);
  if(!m)continue;
  const d=m[1];
  if(prev){
    const exp=new Date(prev+'T00:00:00Z'); 
    let nxt; do{exp.setUTCDate(exp.getUTCDate()+1); nxt=exp.toISOString().slice(0,10);}while(exp.getUTCDay()===6);
    if(nxt!==d){console.log('갭:',prev,'->',d); gaps++;}
  }
  prev=d;
}
console.log('총',files.length,'파일, 갭',gaps,'건');
"
```
(일요일은 데이터가 적거나 없을 수 있음 — 정상. 평일 연속 갭만 주의.)

### C. 로드 & 백테스트
`loader.cjs`의 `loadAllBars('./sec1_full')`로 로드 후 `engine_fast.cjs`의 `simulateFast`로 분석.
1년치 1초봉은 메모리를 많이 쓰므로 `node --max-old-space-size=4096 ...` 또는 기간 슬라이스로 처리.

---

## 데이터 포맷 (검증 기준)
```
파일: xauusd-s1-bid-YYYY-MM-DD-YYYY-MM-DD.csv.gz  (하루 1파일, gzip)
CSV : timestamp,open,high,low,close
      timestamp = Unix 밀리초(UTC), bid 가격, ask=bid+0.62
```

---

## 부록: download_gold_s1.cjs 가 없을 경우
같은 일을 npx 한 줄로도 할 수 있다(하루씩):
```bash
npx --yes dukascopy-node -i xauusd -from 2025-06-17 -to 2025-06-18 -t s1 -p bid -f csv -dir ./sec1_2025h2 -r 5 -bp 100
```
이걸 날짜 루프로 돌리면 된다. (download_gold_s1.cjs가 이 루프 + gzip + 파일명 정규화를 자동화한 것)
