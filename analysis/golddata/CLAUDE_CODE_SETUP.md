# Claude Code(Opus) — Gold EA 백테스트 환경 셋업 가이드

이 문서는 Claude Code(또는 Opus)가 **자기 로컬 PC에서** XAUUSD EA "AUTO LOGIC 3"
백테스트 분석을 그대로 이어서 할 수 있도록 환경을 구성하는 단계별 지침이다.

> 핵심 사실: Claude Code는 **실행되는 PC의 로컬 파일만** 접근할 수 있다.
> 따라서 (1) 코드는 GitHub에서, (2) 차트데이터는 아래 두 방법 중 하나로 PC에 내려받아야 한다.

---

## 0. 사전 요구사항
- Node.js 18+ (`node -v`, `npx -v`)
- git
- 디스크 여유: 1초봉 5.5개월치 압축 74MB(해제 ~800MB), 1년치면 ~170MB(해제 ~2GB)

---

## 1. 코드(엔진·스크립트·명세) 받기 — GitHub
```bash
git clone https://github.com/merryyas/note_gann.git
cd note_gann/analysis/golddata
ls   # engine_fast.cjs, loader.cjs, EA_AUTO_LOGIC3_mechanism.md, download.sh ...
```
> ⚠️ 이 저장소에는 **차트데이터(sec1/, ticks/)가 포함되어 있지 않다**(용량 때문에 .gitignore 처리됨).
> 데이터는 아래 2번에서 별도로 받는다.

---

## 2. 차트데이터 받기 — 둘 중 하나 선택

### 방법 A) 이미 받아둔 1초봉 묶음 사용 (2026-01-02 ~ 2026-06-17, 가장 빠름)
1. 아래 묶음 파일을 PC로 다운로드:
   - **gold_sec1_2026-06-17.tar** (73MB, 142개 일별 gzip 파일)
   - 다운로드 링크: (채팅에서 제공된 링크 사용)
2. `note_gann/analysis/golddata/` 안에서 압축 해제:
```bash
cd note_gann/analysis/golddata
tar -xf /경로/gold_sec1_2026-06-17.tar     # → sec1/ 폴더 생성
ls sec1 | wc -l                            # 142 확인
```

### 방법 B) Dukascopy에서 직접 다시 받기 (기간 확장/최신화에 유리)
우리가 쓴 것과 동일한 도구(`dukascopy-node`)로 하루씩 자동 다운로드.
```bash
cd note_gann/analysis/golddata
# 사용법: bash download.sh <s1|tick> <START_YYYY-MM-DD> <END_YYYY-MM-DD>
# 예) 1년치 1초봉 (오늘부터 1년 전 ~ 오늘 다음날)
bash download.sh s1 2025-06-17 2026-06-18
```
- 하루 1파일(`sec1/xauusd-s1-bid-YYYY-MM-DD-YYYY-MM-DD.csv.gz`)로 저장, 토요일 자동 스킵, 체크포인트로 재개 가능.
- 1년치 약 130거래일 × ~30초 = 1~1.5시간.
- ※ download.sh 안의 AI Drive 백업(`sudo cp ... /mnt/aidrive/...`) 줄은 로컬 PC엔 해당 경로가 없으므로 무시되거나, 필요시 그 줄을 삭제해도 된다.

---

## 3. 데이터 형식 (엔진이 기대하는 포맷)
```
sec1/   1초봉 OHLC
  파일명: xauusd-s1-bid-YYYY-MM-DD-YYYY-MM-DD.csv.gz  (하루 1파일, gzip)
  CSV 헤더: timestamp,open,high,low,close
    timestamp = Unix 밀리초(UTC)
    예: 1781481600000,4293.835,4294.615,4293.835,4294.415
    bid 기준 가격. ask = bid + 0.62(스프레드)

ticks/  틱 데이터 (선택)
  파일명: xauusd-tick-YYYY-MM-DD-YYYY-MM-DD.csv.gz
  CSV: timestamp(ms),askPrice,bidPrice
```

---

## 4. 동작 확인 — 엔진 실행
```bash
cd note_gann/analysis/golddata

# (1) 데이터 로드 확인
node -e "const {loadAllBars}=require('./loader.cjs'); const b=loadAllBars('./sec1'); console.log('bars',b.n, new Date(b.ts[0]).toISOString(),'~',new Date(b.ts[b.n-1]).toISOString());"

# (2) 검증된 안정형 1회 시뮬 (저녁 KST18:30-19:30, mult1.3, o12)
node -e "
const {loadAllBars}=require('./loader.cjs');
const {simulateFast}=require('./engine_fast.cjs');
const b=loadAllBars('./sec1');
const p={seed:1000,startLot:0.01,tpPoints:500,lotMult:1.3,interval:300,maxOrders:12,slUsd:0,sessStartMin:570,sessEndMin:630,closeAtSessionEnd:true,skipDow:[1]};
const r=simulateFast(b,p,0.62);
console.log(r);
"

# (3) 월별 독립생존 분석
node --max-old-space-size=2048 monthly_survival.cjs ./sec1
```

> 메모리 주의: 1년치 1초봉을 한 번에 올리면 메모리를 많이 쓴다.
> `node --max-old-space-size=2048 ...` 또는 기간 슬라이스(slice 함수, 각 스크립트 내장)로 나눠 처리할 것.

---

## 5. EA 로직 이해
- `EA_AUTO_LOGIC3_mechanism.md` 를 먼저 읽을 것. EA 작동 메커니즘 전체 명세 + 의사코드 포함.
- 엔진 진입점: `engine_fast.cjs` 의 `simulateFast(bars, params, spread)`.
- 교차검증용 독립 재구현: `engine_verify.cjs` 의 `simulateVerify(...)`.

### 엔진 파라미터 키 (engine_fast.cjs 입력)
| 키 | 의미 | 예 |
|---|---|---|
| seed | 시작잔고($) | 1000 |
| startLot | 시작랏 | 0.01 |
| lotMult | 마틴게일 배수 | 1.3 |
| interval | 그리드 간격(포인트) | 300 |
| maxOrders | 최대 차수 | 12 |
| tpPoints | 통합 TP 포인트 | 500 |
| slUsd | 통합 SL($) | 0 |
| sessStartMin/sessEndMin | 세션(UTC 분, KST=UTC+9) | 570/630 |
| closeAtSessionEnd | 세션종료 강제청산 | true |
| skipDow | 제외 요일(0일~6토) | [1] |

---

## 6. 핵심 결론 요약 (분석 방향)
1. **lotMult가 위험의 핵심** — mult2.0+maxO8은 $1000 시드에 구조적 마진콜 위험.
2. **월요일 제외(skipDow[1])** + **세션종료 강제청산(closeAtSessionEnd)** 이 생존의 두 축.
3. **과최적화 주의** — 특정 달(추세장) 고수익 세팅은 다른 달에서 청산. 반드시 여러 독립기간 생존 검증.
4. **전 기간(1~6월) 생존 권장 세팅**: 저녁 KST18:30~19:30 / tp500 / mult1.3 / int300 / maxO12 / 월제외 / 강제청산.

---

## 7. 분석 확장 아이디어 (Opus가 이어서 할 것)
- 검증기간을 1년(2025-06 ~ 2026-06)으로 확장해 강건성 재확인.
- 1분봉 버전 로더를 추가하면 1년치를 메모리 부담 없이 한 번에 처리 가능(청산/생존 판정엔 충분).
- 실제 .mq4 원본과 엔진 로직 1:1 대조(있다면).
