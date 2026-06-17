# Gold EA 백테스트 분석 (AUTO LOGIC 3)

XAUUSD EA "AUTO LOGIC 3"(양방향 헤지+마틴게일 그리드)를 Dukascopy 1초봉
(2026-01-02 ~ 2026-06-17, 약 813만 봉)으로 백테스트/최적화한 분석 스크립트 모음.

> ※ 원본 차트데이터(sec1 1초봉 74MB, ticks 틱 247MB)는 용량 문제로 git 제외.
>   데이터는 `download.sh`로 Dukascopy에서 재다운로드 가능. AI Drive에 백업됨.

## 핵심 엔진
- `engine_fast.cjs` — 고속 시뮬 엔진(누적합 최적화). minute-session, closeAtSessionEnd, skipDom/skipDow 지원. **메인 엔진.**
- `engine_verify.cjs` — 독립 재구현(명시적 주문배열) 교차검증용.
- `engine.cjs` — 초기 제너레이터 버전.
- `loader.cjs` — 1초봉 로더(loadAllBars).
- `crosscheck.cjs` — 두 엔진 9케이스 교차검증(전부 일치).

## 주요 분석
- `monthly_survival.cjs` — 각 달 독립 $1000 시작 → 월말 생존/수익.
- `monthly_allprofit.cjs` / `mp_one.cjs` / `mp_report.cjs` — "5달 전부 흑자" 세팅 전수탐색.
- `june_search.cjs` — 6월 단독 수익 세팅 탐색.
- `june_reverse.cjs` — 6월 상위세팅 1~5월 역검증(과최적화 판별).
- `recheck_top.cjs` — 고수익 TOP 재현+아웃샘플 더블체크+마진 수학분석.
- `robust_grid.cjs` / `robust_check.cjs` — 3기간 강건성 필터.
- `q_dualMarMay.cjs` — 점심+저녁 단일계좌 듀얼세션 월별 추적.
- `q1_monday.cjs` `q2_sl.cjs` `q2b_losses.cjs` `q_hold.cjs` `q3_multi.cjs` — 개별 검증(월요일제외/SL/손익분류/끌고가기/듀얼세션).
- `vol_by_hour.cjs` — 시간대별 변동성.

## 결과 데이터
- `EA_AUTO_LOGIC3_mechanism.md` — **EA 작동 메커니즘 명세(제3자/Opus 전달용)**.
- `robust_results.json` — 3기간 생존 강건세팅 25개.
- `allprofit_results.json` — 월별 흑자 탐색 144조합 결과.
- `idea2_results.json` `gridsearch_session_results.json` `gridsearch_results.json` — 그리드 탐색 결과.

## 검증된 핵심 결론
1. **lotMult가 위험의 핵심.** mult2.0+maxO8은 $1000 시드에 구조적 마진콜 위험(양방향 증거금 ≈$3,366).
2. **월요일 제외(skipDow[1])가 최대 리스크 감소 장치.** 주말갭+초반변동성 회피.
3. **세션종료 강제청산(closeAtSessionEnd=true)이 사실상의 손절.** SL켜기/끌고가기는 청산율 ↑.
4. **시장국면 의존성/과최적화 주의.** 3월·6월(추세장) 고수익 세팅은 다른 달 전부 청산.

### 전 기간(1~6월) 생존 권장 세팅 (1순위)
> 저녁 KST18:30~19:30 / tpPoints500 / lotMult1.3 / interval300 / maxOrders12 / 월요일제외 / 세션종료강제청산
> → 6개 달 전부 생존(청산 0).
