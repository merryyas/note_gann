# AUTO LOGIC 3 — EA 작동 메커니즘 명세 (백테스트 검증판)

> 본 문서는 MT4 EA "AUTO LOGIC 3"의 동작을 백테스트 재구현 엔진 기준으로 정리한 것이다.
> Claude(Opus 등) 또는 제3자가 EA 로직을 정확히 이해/재현할 수 있도록 작성되었다.

---

## 0. 개요
- 대상: MT4 EA **"AUTO LOGIC 3"** (magic 234568), 심볼 **XAUUSD**(금/달러)
- 전략: **양방향 헤지 + 마틴게일 그리드** (Bidirectional Hedge + Martingale Grid)
- **통합 손절(SL) 없음.** **통합 익절(TP)**로 바스켓 전체를 한 번에 청산.
- 검증: Dukascopy 1초봉(2026-01-02 ~ 2026-06-17, 약 813만 봉)으로
  자체 재구현 엔진 2종(`engine_fast` 누적합 최적화판 / `engine_verify` 명시적 주문배열판) 교차검증 완료(9케이스 일치).

---

## 1. 상수 / 단위
| 기호 | 값 | 의미 |
|---|---|---|
| POINT | 0.01 | 금 1포인트 = $0.01 가격변동 |
| CSIZE(계약크기) | 100 | 1랏 = 100 oz → 손익 = (가격차) × 100 × 랏 |
| SPREAD | 0.62 | 고정 스프레드($), `ask = bid + spread` |
| seed(시드) | 1000 | 백테스트 기본 시작 잔고($) |
| startLot(시작 랏) | 0.01 | 첫 차수 랏 |

---

## 2. 양방향 동시 진입 (Hedge)
- 매 진입 시점에 **BUY 바스켓**과 **SELL 바스켓**을 **동시에 독립적으로** 운영한다.
- BUY는 `ask` 기준, SELL은 `bid` 기준.
- 각 바스켓은 자기만의 **차수(order count)**, **VWAP(평균단가)**, **총랏**을 가진다.

---

## 3. 마틴게일 그리드 (각 방향 독립)
- n번째 추가 차수의 랏 = `round(startLot × lotMult^n, 2)`, 최소 0.01.
  - 예) startLot=0.01, lotMult=1.3, maxOrders=12
    → `[0.01,0.01,0.02,0.02,0.03,0.04,0.05,0.06,0.08,0.11,0.14,0.18]`
  - 예) lotMult=2.0, maxOrders=8
    → `[0.01,0.02,0.04,0.08,0.16,0.32,0.64,1.28]`
- 추가 진입(물타기) 조건:
  - **BUY**: 현재 `ask ≤ (마지막 BUY 진입가 − interval×POINT)` 이면 한 차수 추가.
  - **SELL**: 현재 `bid ≥ (마지막 SELL 진입가 + interval×POINT)` 이면 한 차수 추가.
  - `interval` = 그리드 간격(포인트). 예: interval=300 → $3.00 마다 한 차수.
- 차수는 `maxOrders`까지만. 도달하면 더 이상 추가 없이 보유.
- 트리거 가격(bTrig/sTrig)은 "현재가" 기준으로 매 진입 후 갱신된다(한 봉당 보통 1차수씩 추가).

---

## 4. 통합 익절 (Integrated TP) — 유일한 정상 청산
- 각 바스켓의 **VWAP(가중평균 진입가)** 기준으로 통합 TP 가격을 계산:
  - **BUY TP가격** = `VWAP_buy + (tpPoints / n) × POINT`  (n = 현재 BUY 차수 수)
  - **SELL TP가격** = `VWAP_sell − (tpPoints / n) × POINT`
  - 핵심: `tpPoints`를 차수 수 `n`으로 나눈다 → 차수가 늘수록 목표가 평균단가에 가까워져 더 빨리 익절.
- 도달 판정:
  - **BUY**: `bid ≥ BUY TP가격` → 바스켓 전체 청산, 손익 = `(TP − VWAP) × CSIZE × 총랏` (항상 +).
  - **SELL**: `ask ≤ SELL TP가격` → 바스켓 전체 청산, 손익 = `(VWAP − TP) × CSIZE × 총랏` (항상 +).
- TP는 BUY/SELL 각각 **독립적으로** 발생. TP된 방향은 차수 0으로 리셋 후 다시 1차수부터 시작.

---

## 5. 손절(SL) — 기본 없음
- 통합 SL(`slUsd`) 옵션은 존재하나 기본 0(미사용).
- 백테스트 결론: **SL을 켜면 회복 전에 잘려 오히려 청산율이 높아짐 → 끄는 것이 정답.**

---

## 6. 청산 = 마진콜 (Liquidation)
- 매 가격점마다 미실현손익(unrealized) 계산:
  - `unr = (bid − VWAP_buy)×CSIZE×총랏_buy + (VWAP_sell − ask)×CSIZE×총랏_sell`
  - `equity = balance + unr`
- **equity ≤ 0 이면 마진콜 = 계좌 사망(잔고 0).** 시뮬 종료.
- ※ "한 바스켓이 손실로 닫히는 것"은 청산이 **아니다**. 청산은 오직 `equity ≤ 0`.

---

## 7. 봉 내부 가격 경로
- 1초봉(또는 어떤 봉이든)의 내부를 **O → L → H → C** 순서로 4개 가격점으로 전개해 처리.
- 각 가격점에서 **(TP판정 → SL판정 → 마진콜판정)** 순으로 검사.
- `ask = 해당 가격점 + SPREAD`, `bid = 해당 가격점`.

---

## 8. 시간대(세션) 운영 — 백테스트로 추가된 핵심 변수
- 특정 시간대(UTC 분 단위)에만 **신규 진입**을 허용한다. (`sessStartMin ~ sessEndMin`, UTC 0~1439분)
  - KST = UTC+9.
    - KST11:30 = UTC02:30 = **150분**, KST13:00 = UTC04:00 = **240분**
    - KST18:30 = UTC09:30 = **570분**, KST19:30 = UTC10:30 = **630분**
- 요일 제외(`skipDow`): 특정 요일엔 거래 안 함. `[1]`=월요일 제외 (0=일~6=토).
  - 월요일은 주말 갭 + 초반 변동성으로 마틴게일에 가장 위험 → **제외 권장**.
- 세션 종료 시 처리(`closeAtSessionEnd`):
  - **true**: 세션이 끝나면 열려있는 모든 바스켓을 현재 시장가로 **강제 청산**(이익/손실 무관).
    → 이 "매일 강제 정리"가 **사실상의 리스크 관리 장치**다. (포지션을 다음 세션으로 끌고 가지 않음)
  - **false(끌고가기)**: 청산 위험 급증 → **사용 금지**.

---

## 9. 파라미터 목록 (엔진 입력 키)
| 키 | 의미 | 예시 |
|---|---|---|
| seed | 시작 잔고($) | 1000 |
| startLot | 시작 랏 | 0.01 |
| lotMult | 마틴게일 배수 | 1.3(안전) ~ 2.0(공격/위험) |
| interval | 그리드 간격(포인트) | 200~500 |
| maxOrders | 최대 차수 | 5~12 |
| tpPoints | 통합 TP 포인트 | 200~500 |
| slUsd | 통합 SL($) | 0(미사용) |
| sessStartMin / sessEndMin | 세션 시작/끝(UTC 분) | 570 / 630 |
| closeAtSessionEnd | 세션종료 강제청산 | true |
| skipDow | 제외 요일 | [1] (월요일) |

---

## 10. 손익 분류 (바스켓이 닫히는 3가지 이유)
1. **TP**: 통합 익절 도달 → 항상 이익.
2. **SESSION_END**: 세션 종료 강제청산 → 소폭 이익 또는 소폭 손실 혼재 (이것이 "패배" 통계의 정체. 마진콜 아님).
3. **MARGINCALL**: equity ≤ 0 → 계좌 사망.
- 승률 92%라 해도, 8%의 "패"는 **대부분 SESSION_END 소폭손실(평균 약 -$87)**이지 마진콜이 아니다.

---

## 11. 백테스트로 검증된 핵심 결론
- **마틴게일 배수(lotMult)가 위험의 핵심.**
  - lotMult=2.0 + maxOrders=8: 막차랏 1.28, 양방향 풀차수 필요증거금 ≈ **$3,366** → $1000 시드론 **구조적 마진콜 위험**.
  - lotMult=1.3 + maxOrders=12: 막차랏 0.18, 총랏 0.75 → **안전**.
- **시장국면 의존성**: 추세장(예: 2026-03, 2026-06)에선 공격형(mult2)이 큰 수익을 내지만,
  횡보장(예: 2026-04~05)이나 다른 달에선 **동일 세팅이 즉시 청산.**
- **강건성(robustness) 기준**: "여러 독립 기간(각 달 $1000 시작)에서 모두 생존"하는 세팅만 실거래 후보.

### 검증 통과 권장 세팅 (1순위)
> **저녁 KST18:30~19:30 / tpPoints500 / lotMult1.3 / interval300 / maxOrders12 / 월요일제외 / 세션종료강제청산**
> → 2026년 1~6월 **6개 달 전부 생존(청산 0)**.

### 과최적화 경고 (실거래 금지)
> 6월(추세장) 단독 고수익 TOP 세팅들(mult2.0 계열)은 1~5월 5개 달 **모두 청산(1/6 생존)**.
> "특정 달에 잘 됐다"는 이유로 공격형(mult2)을 채택하면 안 됨.

---

## 12. 손익 계산 공식 요약
- 바스켓 손익($) = `(청산가 − VWAP) × 100 × 총랏`  (BUY 기준; SELL은 부호 반대)
- VWAP = `Σ(진입가 × 랏) / Σ(랏)`
- 통합 TP가격 = `VWAP ± (tpPoints / 차수수) × 0.01`

---

## 13. 의사코드 (한 가격점 처리)
```
process(t, bid, ask):
    # 1) BUY 통합 TP
    if buy.count > 0:
        avg = vwap(buy)
        tp  = avg + (tpPoints / buy.count) * POINT
        if bid >= tp:
            pnl = (tp - avg) * 100 * buy.totalLot     # 항상 +
            balance += pnl;  close(buy)

    # 2) SELL 통합 TP
    if sell.count > 0:
        avg = vwap(sell)
        tp  = avg - (tpPoints / sell.count) * POINT
        if ask <= tp:
            pnl = (avg - tp) * 100 * sell.totalLot    # 항상 +
            balance += pnl;  close(sell)

    # 3) (옵션) SL — 기본 미사용
    if slUsd > 0: ... (방향별 손실이 -slUsd 이하면 청산)

    # 4) 마진콜
    unr = (bid - vwap(buy)) *100*buy.totalLot
        + (vwap(sell) - ask)*100*sell.totalLot
    if balance + unr <= 0:
        balance = 0;  liquidated = True;  return

# 봉마다: 세션/요일 체크 → 신규/추가 진입 → O,L,H,C 각 점에서 process()
# 세션 종료 & closeAtSessionEnd → 열린 바스켓 시장가 강제청산
```

---

*작성: 백테스트 분석 기준 (2026-06-17 데이터까지 반영). 실제 .mq4 원본과 대조 시 본 명세를 보강 가능.*
