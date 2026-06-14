/* ═══════════════════════════════════════════════════════════════
   TradeArchive — EA Strategy Simulator v3
   1분봉 OHLC 차트 데이터 기반 마틴게일 EA 시뮬레이터

   설계:
   - 백엔드에서 XAUUSD 차트 데이터 가져와 D1에 캐싱
   - 1분봉 OHLC를 O→H→L→C (롱 보수) / O→L→H→C (숏 보수) 순회로 tick 시뮬레이션
   - EA 로직 (AUTO LOGIC 3) 그대로 재현:
     · 시작 봉에서 buy/sell 각 1개 진입 (방향 활성화 조건)
     · 가격이 진입 기준에서 +interval pt 만큼 불리하게 가면 추가진입 (마틴게일)
     · 새 진입 시 lot = lastLot × multiplier
     · 통합 TP: 바스켓 전체 PnL이 +tpPts/lot 도달하면 일괄 청산
     · 통합 SL: 바스켓 전체 PnL이 -slUsd 도달하면 일괄 청산
     · 일일 최대 손실 (추가 안전장치): 당일 누적 PnL이 -dailyMaxLoss 도달하면 청산 + 그날 중단
   - KST 변환: 봉 시각(UTC) → 브로커TZ → KST (UTC+9)
   - CASE 비교: 사용자 기본 + CASE 1/2/3 동시 실행, 4개 잔고곡선 한 차트에 표시

   계약 (XAUUSD):
   - 1 lot = 100 oz, 1 point = 0.01 가격
   - 1 lot * 1 point PnL = 0.01 * 100 = $1.00
   - tp/interval 단위는 "포인트" (= 0.01 가격)
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ── 계약 상수 ────────────────────────────────────────────────
const CONTRACT = {
  pointSize     : 0.01,    // 1 포인트 = 0.01 가격 (XAUUSD)
  contractSize  : 100,     // 1 lot = 100 oz
  pointValue    : 1.0,     // 1 lot × 1 point = $1.00
};

// ── 상태 ────────────────────────────────────────────────────
const TOGGLES = {
  buy: true, sell: true,
  tp: true, doubling: false,
  s1: true, s2: false
};
let CANDLES = [];          // [{ts,o,h,l,c,v}] (UTC epoch sec)
let LAST_BACKTEST = null;  // 마지막 단일 백테스트 결과
let LAST_COMPARE = null;   // 마지막 CASE 비교 결과
let equityChartObj = null;
let priceChartObj  = null;

// ── 토글 ────────────────────────────────────────────────────
function ptoggle(key) {
  const map = { buy:'tog Buy', sell:'tog Sell', tp:'tog Tp', doubling:'tog Doubling', s1:'tog S1', s2:'tog S2' };
  TOGGLES[key] = !TOGGLES[key];
  const cap = key.charAt(0).toUpperCase() + key.slice(1);
  const onBtn  = document.getElementById('tog' + cap + 'On');
  const offBtn = document.getElementById('tog' + cap + 'Off');
  if (onBtn)  onBtn.classList.toggle('on', TOGGLES[key]);
  if (offBtn) offBtn.classList.toggle('on', !TOGGLES[key]);
  if (key === 'doubling') {
    document.getElementById('doublingOptions').style.display = TOGGLES.doubling ? 'block' : 'none';
  }
}

// ── 빠른 날짜 범위 ─────────────────────────────────────────
function setDateRange(type) {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now);
  if (type === 'ytd')  start.setMonth(0), start.setDate(1);
  if (type === '3m')   start.setMonth(start.getMonth() - 3);
  if (type === '1y')   start.setFullYear(start.getFullYear() - 1);
  if (type === '2y')   start.setFullYear(start.getFullYear() - 2);
  document.getElementById('paramStartDate').value = start.toISOString().slice(0, 10);
  document.getElementById('paramEndDate').value   = end;
  document.querySelectorAll('.quick-range').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.quick-range[onclick*="${type}"]`);
  if (btn) btn.classList.add('active');
}

// ── Twelve Data 기본 API 키 (사용자 제공, 무료 플랜) ──────────
const TD_DEFAULT_KEY = '4f9145b3de3f49b397800fefe888d676';

// ── 데이터 소스 변경 ─────────────────────────────────────
function onSourceChange() {
  const src = document.getElementById('paramSource').value;
  document.getElementById('csvUploadRow').style.display = (src === 'upload') ? '' : 'none';
  // CSV는 파일 선택 시 자동 처리 → "차트 데이터 받기" 버튼 숨김
  const btn = document.getElementById('btnFetch');
  if (btn) btn.style.display = (src === 'upload') ? 'none' : '';

  // 상태 메시지도 컨텍스트에 맞게
  const st = document.getElementById('dataStatus');
  if (st && !CANDLES.length) {
    if (src === 'upload') st.innerHTML = '데이터 없음 — CSV 파일을 선택하세요';
    else if (src === 'twelvedata') st.innerHTML = '데이터 없음 — [차트 데이터 받기] 클릭';
    else st.innerHTML = '데이터 없음 — [받기] 클릭';
  }
}

// ── 요일 토글 ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.wd-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('on'));
  });
  // 기본: 올해(YTD)
  setDateRange('ytd');
  onSourceChange();

  // CSV 업로드 핸들러
  document.getElementById('candleFileInput')?.addEventListener('change', handleCsvUpload);

  // DB에 캐싱된 데이터 확인
  checkExistingData();
});

function getEnabledWeekdays() {
  const days = new Set();
  document.querySelectorAll('.wd-btn.on').forEach(b => days.add(parseInt(b.dataset.day)));
  return days;
}

// ── 탭 전환 ──────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.bt-tab').forEach((t, i) => {
    const panes = ['baskets', 'drill', 'sweep'];
    t.classList.toggle('active', panes[i] === name);
  });
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === 'tab' + name.charAt(0).toUpperCase() + name.slice(1));
  });
}

// ══════════════════════════════════════════════════════════════
//  데이터 가져오기
// ══════════════════════════════════════════════════════════════
async function checkExistingData() {
  try {
    const tf = document.getElementById('paramTimeframe').value;
    const sd = document.getElementById('paramStartDate').value;
    const ed = document.getElementById('paramEndDate').value;
    if (!sd || !ed) return;
    const from = Math.floor(new Date(sd + 'T00:00:00Z').getTime() / 1000);
    const to   = Math.floor(new Date(ed + 'T23:59:59Z').getTime() / 1000);
    const res = await fetch(`/api/candles?symbol=XAUUSD&tf=${tf}&from=${from}&to=${to}`);
    const json = await res.json();
    if (json.ok && json.data && json.data.length) {
      CANDLES = json.data;
      setDataStatus(`✅ 캐시 ${json.count.toLocaleString()}봉 로드 완료`, 'ok');
    } else {
      setDataStatus('데이터 없음 — [차트 데이터 받기] 클릭', '');
    }
  } catch (e) {
    setDataStatus('서버 연결 실패', 'err');
  }
}

function setDataStatus(msg, cls) {
  const el = document.getElementById('dataStatus');
  if (!el) return;
  el.className = 'data-status ' + (cls || '');
  el.innerHTML = msg;
}

// 중단 컨트롤
let _fetchAbort = false;
function abortFetch() { _fetchAbort = true; }
window.abortFetch = abortFetch;

function fmtETA(sec) {
  if (sec < 60) return `약 ${Math.ceil(sec)}초`;
  const m = Math.floor(sec / 60), s = Math.ceil(sec % 60);
  return s > 0 ? `약 ${m}분 ${s}초` : `약 ${m}분`;
}

// ── Twelve Data 무료 플랜 상수 ───────────────────────────────
//    분당 8 credit, 일일 800 credit. time_series 1회 = 1 credit.
//    안전 간격: 60s / 8 = 7.5s. 약간 여유 둬서 7.6s.
const TD_FREE = {
  RATE_MS: 7600,        // 정상 호출 간 최소 간격
  EMPTY_MS: 1200,       // 빈 청크(주말/장마감) 후 짧은 대기
  MAX_RETRY: 3,         // 청크당 429 즉시 재시도 횟수
  RETRY_BACKOFF_MS: 12000, // 429 재시도 대기
  DAILY_LIMIT: 800
};

// ── 일일 호출 카운터 (localStorage, UTC 기준 자정 리셋) ──────
function _tdUsageKey() {
  return 'td_usage_' + new Date().toISOString().slice(0, 10);
}
function tdGetUsage() {
  try { return parseInt(localStorage.getItem(_tdUsageKey()) || '0', 10) || 0; }
  catch { return 0; }
}
function tdBumpUsage(n) {
  try {
    const v = tdGetUsage() + (n || 1);
    localStorage.setItem(_tdUsageKey(), String(v));
    // 오래된 카운터 정리
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('td_usage_') && k !== _tdUsageKey()) {
        try { localStorage.removeItem(k); i--; } catch {}
      }
    }
    return v;
  } catch { return 0; }
}

// ── API 키 저장/복원 (localStorage, 기본 키 fallback) ────────
function tdSaveApiKey(key) {
  try { if (key) localStorage.setItem('td_api_key', key); } catch {}
}
function tdLoadApiKey() {
  try { return localStorage.getItem('td_api_key') || TD_DEFAULT_KEY; }
  catch { return TD_DEFAULT_KEY; }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchCandles() {
  const btn = document.getElementById('btnFetch');
  const src = document.getElementById('paramSource').value;
  const tf  = document.getElementById('paramTimeframe').value;
  const sd  = document.getElementById('paramStartDate').value;
  const ed  = document.getElementById('paramEndDate').value;

  if (!sd || !ed) { setDataStatus('시작일/종료일을 선택하세요', 'err'); return; }
  const from = Math.floor(new Date(sd + 'T00:00:00Z').getTime() / 1000);
  const to   = Math.floor(new Date(ed + 'T23:59:59Z').getTime() / 1000);
  if (to <= from) { setDataStatus('기간이 잘못되었습니다', 'err'); return; }

  if (src === 'upload') {
    setDataStatus('CSV 업로드 영역에서 파일을 선택하세요', 'warn');
    return;
  }

  let apiKey = '';
  if (src === 'twelvedata') {
    // 사용자 제공 기본 키 자동 사용 (수동 입력 불필요)
    apiKey = tdLoadApiKey();
  }

  // Stooq는 일봉(D1)만 지원 — 단일 호출이면 됨
  if (src === 'stooq') {
    btn.disabled = true;
    _fetchAbort = false;
    setDataStatus('<i class="fas fa-spinner fa-spin"></i> Stooq에서 데이터 받는 중…', 'warn');
    try {
      const res = await fetch('/api/candles/fetch', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ source: 'stooq', symbol: 'XAUUSD', timeframe: tf, from, to })
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'fetch 실패');
      await checkExistingData();
      setDataStatus(`✅ ${(json.inserted||0).toLocaleString()}봉 저장 · 로드 ${CANDLES.length.toLocaleString()}봉`, 'ok');
    } catch (e) {
      setDataStatus('❌ ' + (e.message || e), 'err');
    } finally {
      btn.disabled = false;
    }
    return;
  }

  // ── Twelve Data: 적응형 페이싱 + 빈청크 스킵 + 재시도 큐 ──────
  btn.disabled = true;
  _fetchAbort = false;
  setDataStatus('<i class="fas fa-spinner fa-spin"></i> 청크 계획 수립 중…', 'warn');

  try {
    // 1) plan 호출 (이미 캐시된 구간은 skipCached로 제외 → 재개 자동 지원)
    const planRes = await fetch('/api/candles/plan', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ symbol: 'XAUUSD', timeframe: tf, from, to, skipCached: true })
    });
    const plan = await planRes.json();
    if (!plan.ok) throw new Error(plan.error || 'plan 실패');

    const chunks = plan.chunks || [];
    if (!chunks.length) {
      setDataStatus('✅ 이미 모든 구간이 캐시에 있습니다', 'ok');
      await checkExistingData();
      btn.disabled = false;
      return;
    }

    // 2) 일일 한도 확인 + 예상 시간 안내
    const usedToday = tdGetUsage();
    const remainToday = TD_FREE.DAILY_LIMIT - usedToday;
    // 정상 청크는 7.6s, 빈 청크는 1.2s → 평균적으로 그 사이. 보수적으로 7.6s 가정.
    const etaSec = Math.round((chunks.length - 1) * (TD_FREE.RATE_MS / 1000) + chunks.length * 1.0);

    if (chunks.length > remainToday) {
      const cont = confirm(
        `⚠️ 오늘 남은 호출 한도가 부족할 수 있습니다.\n` +
        `필요 청크: ${chunks.length}개 · 오늘 사용: ${usedToday}/${TD_FREE.DAILY_LIMIT}회 (남음 ${remainToday})\n\n` +
        `받을 수 있는 만큼 받고, 나머지는 내일(UTC 자정 리셋) 같은 기간으로 다시 누르면 이어서 받습니다.\n진행할까요?`
      );
      if (!cont) { setDataStatus('취소되었습니다', 'warn'); btn.disabled = false; return; }
    } else if (chunks.length > 5) {
      const ok = confirm(
        `📥 ${chunks.length}개 청크로 분할 다운로드합니다.\n` +
        `Twelve Data 무료 플랜(분당 8회) 기준 청크 사이 약 7.6초 간격.\n` +
        `예상 소요: ${fmtETA(etaSec)} (빈 구간은 빠르게 건너뜀)\n` +
        `오늘 사용: ${usedToday}/${TD_FREE.DAILY_LIMIT}회\n\n` +
        `진행하시겠습니까?\n(중간 [중단] 가능 · 받은 데이터는 보존되고 다시 누르면 이어받음)`
      );
      if (!ok) { setDataStatus('취소되었습니다', 'warn'); btn.disabled = false; return; }
    }

    // 3) 다운로드 엔진 실행
    const result = await runFetchEngine(chunks, { apiKey, tf });

    // 4) 캐시에서 다시 로드
    await checkExistingData();
    if (!_fetchAbort) {
      const cnt = CANDLES.length.toLocaleString();
      if (result.failed.length > 0) {
        setDataStatus(
          `⚠️ 완료 · ${result.inserted.toLocaleString()}봉 저장 · 실패 ${result.failed.length}청크 ` +
          `(잠시 후 [차트 데이터 받기]를 다시 누르면 실패분만 재시도) · 로드 ${cnt}봉`, 'warn');
      } else {
        setDataStatus(`✅ 완료 · ${result.inserted.toLocaleString()}봉 저장 · 로드 ${cnt}봉`, 'ok');
      }
    }
  } catch (e) {
    setDataStatus('❌ ' + (e.message || e), 'err');
  } finally {
    btn.disabled = false;
    _fetchAbort = false;
  }
}

// ── 다운로드 엔진: 적응형 페이싱 + 빈청크 스킵 + 429 재시도 + 실패 큐 ──
// chunks: [{from,to,...}], opts: { apiKey, tf }
// 반환: { inserted, failed: [chunk...] }
async function runFetchEngine(chunks, opts) {
  const { apiKey, tf } = opts;
  let totalInserted = 0;
  const failedQueue = [];
  const startedAt = Date.now();
  let lastCallAt = 0;        // 마지막 실제 호출 시각 (적응형 페이싱용)
  let done = 0;

  // 단일 청크 호출 (429 즉시 재시도 포함). 반환: {ok, empty, inserted, retryable}
  async function callChunk(ck) {
    for (let retry = 0; retry <= TD_FREE.MAX_RETRY; retry++) {
      if (_fetchAbort) return { ok: false, aborted: true };
      // 적응형 페이싱: 마지막 호출 이후 RATE_MS 만큼 지났는지 확인
      const since = Date.now() - lastCallAt;
      if (lastCallAt && since < TD_FREE.RATE_MS) {
        await sleep(TD_FREE.RATE_MS - since);
      }
      if (_fetchAbort) return { ok: false, aborted: true };

      lastCallAt = Date.now();
      let res, json;
      try {
        res = await fetch('/api/candles/fetch', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ source:'twelvedata', apiKey, symbol:'XAUUSD', timeframe: tf, from: ck.from, to: ck.to })
        });
        json = await res.json();
      } catch (e) {
        // 네트워크 오류 → 짧게 쉬고 재시도
        if (retry < TD_FREE.MAX_RETRY) { await sleep(4000); continue; }
        return { ok: false, retryable: true, error: String(e) };
      }
      tdBumpUsage(1);   // credit 1 소비 (성공/빈청크 모두 카운트)

      if (res.status === 429 || json.code === 429) {
        // rate limit → backoff 후 재시도
        if (retry < TD_FREE.MAX_RETRY) {
          setDataStatus(`<i class="fas fa-hourglass-half"></i> 429 rate limit · ${TD_FREE.RETRY_BACKOFF_MS/1000}초 후 재시도 (${retry+1}/${TD_FREE.MAX_RETRY})`, 'warn');
          await sleep(TD_FREE.RETRY_BACKOFF_MS);
          continue;
        }
        return { ok: false, retryable: true, error: 'rate_limit' };
      }
      if (!json.ok) {
        return { ok: false, retryable: !!json.retryable, error: json.error };
      }
      return { ok: true, empty: !!json.empty, inserted: json.inserted || 0 };
    }
    return { ok: false, retryable: true, error: 'max retry' };
  }

  function renderProgress(phase, idx, total, extra) {
    if (_fetchAbort) return;
    const pct = total ? Math.round((idx / total) * 100) : 0;
    const elapsed = (Date.now() - startedAt) / 1000;
    const rate = idx > 0 ? elapsed / idx : (TD_FREE.RATE_MS/1000);
    const remain = Math.max(0, (total - idx) * rate);
    const used = tdGetUsage();
    setDataStatus(
      `<div style="display:flex;flex-direction:column;gap:6px">
        <div><i class="fas fa-spinner fa-spin"></i> ${phase} ${idx}/${total} · 남은 시간 ${fmtETA(remain)}</div>
        <div style="background:rgba(255,255,255,0.1);border-radius:4px;height:6px;overflow:hidden">
          <div style="background:linear-gradient(90deg,#fbbf24,#f59e0b);height:100%;width:${pct}%;transition:width .3s"></div>
        </div>
        <div style="font-size:11px;opacity:.7">누적 ${totalInserted.toLocaleString()}봉 · 오늘 ${used}/${TD_FREE.DAILY_LIMIT}회${extra||''} · <button onclick="abortFetch()" style="background:none;border:1px solid rgba(255,255,255,.2);color:#fca5a5;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:11px">중단</button></div>
      </div>`, 'warn');
  }

  // 1차 패스
  for (let i = 0; i < chunks.length; i++) {
    if (_fetchAbort) break;
    done++;
    renderProgress('청크', done, chunks.length);
    const r = await callChunk(chunks[i]);
    if (r.aborted) break;
    if (r.ok) {
      totalInserted += r.inserted;
      // 빈 청크면 다음 호출까지 짧게만 쉬도록 lastCallAt 보정
      if (r.empty) lastCallAt = Date.now() - (TD_FREE.RATE_MS - TD_FREE.EMPTY_MS);
    } else if (r.retryable) {
      failedQueue.push(chunks[i]);
    } else {
      // 비재시도 오류(키 오류 등) → 즉시 중단
      throw new Error(r.error || 'fetch 실패');
    }
  }

  // 2차 패스: 실패 큐만 한 번 더 (중단 안 했을 때만)
  const stillFailed = [];
  if (!_fetchAbort && failedQueue.length) {
    for (let i = 0; i < failedQueue.length; i++) {
      if (_fetchAbort) { stillFailed.push(...failedQueue.slice(i)); break; }
      renderProgress('재시도', i + 1, failedQueue.length, ' · 실패분 재시도 중');
      const r = await callChunk(failedQueue[i]);
      if (r.aborted) { stillFailed.push(...failedQueue.slice(i)); break; }
      if (r.ok) { totalInserted += r.inserted; }
      else { stillFailed.push(failedQueue[i]); }
    }
  } else {
    stillFailed.push(...failedQueue);
  }

  if (_fetchAbort) {
    setDataStatus(`⏸️ 중단됨 · ${done}/${chunks.length}청크 처리 · 누적 ${totalInserted.toLocaleString()}봉 (보존됨)`, 'warn');
  }
  return { inserted: totalInserted, failed: stillFailed };
}
window.runFetchEngine = runFetchEngine;

// ── CSV 파싱 유틸 ────────────────────────────────────────────
// 다양한 포맷 자동 감지: Dukascopy/HistData/MT4/Generic
function parseTsFlexible(parts) {
  // parts: 첫 칼럼들 — 1개 또는 2개 (날짜+시간 분리)일 수 있음
  // 반환: { ts, consumed } — consumed는 사용한 칼럼 수 (1 또는 2)
  const p0 = (parts[0] || '').trim().replace(/"/g, '');
  if (!p0) return null;

  // 1) epoch (10자리 sec 또는 13자리 ms)
  if (/^\d{10,13}$/.test(p0)) {
    let ts = parseInt(p0);
    if (ts > 1e12) ts = Math.floor(ts / 1000);
    return { ts, consumed: 1 };
  }

  // 2) MT4 표준: "2024.01.15","09:00"  (날짜와 시간 분리)
  //    또는 HistData: "20240115 090000"
  //    또는 "2024-01-15","09:00:00"
  const p1 = (parts[1] || '').trim().replace(/"/g, '');

  // "20240115 090000" 단일 칼럼 (HistData M1 ASCII)
  const m1 = p0.match(/^(\d{4})(\d{2})(\d{2})[\sT]?(\d{2})(\d{2})(\d{2})?$/);
  if (m1) {
    const iso = `${m1[1]}-${m1[2]}-${m1[3]}T${m1[4]}:${m1[5]}:${m1[6]||'00'}Z`;
    const ts = Math.floor(Date.parse(iso) / 1000);
    if (!isNaN(ts)) return { ts, consumed: 1 };
  }

  // 날짜 + 시간이 분리된 경우
  // p0: 2024.01.15 / 2024-01-15 / 2024/01/15 / 20240115
  // p1: 09:00 / 09:00:00 / 0900 / 090000
  const dateOnly = p0.match(/^(\d{4})[.\-\/]?(\d{2})[.\-\/]?(\d{2})$/);
  if (dateOnly && p1 && /^\d/.test(p1)) {
    const Y = dateOnly[1], M = dateOnly[2], D = dateOnly[3];
    let timePart = p1.replace(/[:.]/g, '');
    if (timePart.length === 4) timePart = timePart + '00';   // 0900 → 090000
    if (timePart.length === 6) {
      const h = timePart.slice(0,2), m = timePart.slice(2,4), s = timePart.slice(4,6);
      const iso = `${Y}-${M}-${D}T${h}:${m}:${s}Z`;
      const ts = Math.floor(Date.parse(iso) / 1000);
      if (!isNaN(ts)) return { ts, consumed: 2 };
    }
  }

  // 3) Dukascopy 유럽식: "15.01.2024 09:00:00.000" (DD.MM.YYYY HH:mm:ss.sss)
  const euDate = p0.match(/^(\d{2})\.(\d{2})\.(\d{4})[\sT](\d{2}):(\d{2}):(\d{2})(\.\d+)?$/);
  if (euDate) {
    const iso = `${euDate[3]}-${euDate[2]}-${euDate[1]}T${euDate[4]}:${euDate[5]}:${euDate[6]}Z`;
    const ts = Math.floor(Date.parse(iso) / 1000);
    if (!isNaN(ts)) return { ts, consumed: 1 };
  }

  // 4) 단일 칼럼 결합형: "2024-01-15 09:00:00" / "2024.01.15 09:00"
  const norm = p0
    .replace(/^(\d{4})[.\/](\d{2})[.\/](\d{2})/, '$1-$2-$3')
    .replace(' ', 'T');
  const isoCandidate = norm + (norm.includes('T') ? (norm.length === 16 ? ':00' : '') : 'T00:00:00');
  const ts = Math.floor(Date.parse(isoCandidate + 'Z') / 1000);
  if (!isNaN(ts) && ts > 0) return { ts, consumed: 1 };

  return null;
}

function parseCsvText(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);  // BOM 제거
  const candles = [];
  const errors = [];
  let formatHint = null;

  // 첫 줄로 구분자 + 헤더 감지
  if (!lines.length) return { candles, errors: ['빈 파일'], formatHint };
  const firstLine = lines[0];
  const sep = firstLine.includes('\t') ? '\t'
             : firstLine.includes(';') ? ';'
             : ',';

  // 헤더 라인 감지 (영문자가 의미있게 들어있으면 헤더로 간주)
  const looksLikeHeader = /[a-zA-Z]/.test(firstLine.replace(/[a-zA-Z]M\b/g, ''))
                         && !/^\d{4}/.test(firstLine.trim());
  const startIdx = looksLikeHeader ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(sep).map(s => s.replace(/^"|"$/g, ''));
    if (cols.length < 5) {
      if (errors.length < 5) errors.push(`라인 ${i+1}: 칼럼 부족 (${cols.length}개)`);
      continue;
    }

    // 시각 파싱 (1 또는 2칼럼 소비)
    const tsResult = parseTsFlexible(cols);
    if (!tsResult) {
      if (errors.length < 5) errors.push(`라인 ${i+1}: 시각 파싱 실패 "${cols[0]}"`);
      continue;
    }
    const off = tsResult.consumed;  // 1 or 2
    const o = parseFloat(cols[off]);
    const h = parseFloat(cols[off + 1]);
    const l = parseFloat(cols[off + 2]);
    const c = parseFloat(cols[off + 3]);
    const v = cols[off + 4] ? parseFloat(cols[off + 4]) : 0;

    if (isNaN(o) || isNaN(h) || isNaN(l) || isNaN(c)) {
      if (errors.length < 5) errors.push(`라인 ${i+1}: OHLC 파싱 실패`);
      continue;
    }
    candles.push({ ts: tsResult.ts, o, h, l, c, v: isNaN(v) ? 0 : v });

    // 첫 성공 라인으로 포맷 힌트
    if (!formatHint) {
      formatHint = off === 2
        ? 'MT4/HistData (날짜+시간 분리)'
        : (cols.length >= 7 ? 'Dukascopy 또는 Generic' : 'Generic OHLCV');
    }
  }
  return { candles, errors, formatHint };
}

// ── CSV 업로드 처리 (대용량 청크 분할 전송) ─────────────────
async function handleCsvUpload(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const fileMB = (file.size / 1024 / 1024).toFixed(1);
  setDataStatus(`<i class="fas fa-spinner fa-spin"></i> CSV 읽는 중… (${fileMB}MB)`, 'warn');

  try {
    const text = await file.text();
    setDataStatus(`<i class="fas fa-spinner fa-spin"></i> CSV 파싱 중… (${(text.length/1024/1024).toFixed(1)}MB)`, 'warn');

    // 마이크로태스크로 양보 (UI freeze 방지)
    await new Promise(r => setTimeout(r, 10));
    const { candles, errors, formatHint } = parseCsvText(text);

    if (!candles.length) {
      // 빈 파일 / 헤더만 / 데이터 0줄 판별
      const totalLines = text.trim().split(/\r?\n/).filter(l => l.trim()).length;
      const fileName = (file.name || '').toLowerCase();
      const isWeekend = /\b(2023-01-01|2024-01-01|2025-01-01|2026-01-01)\b/.test(fileName)
                       || /sun|sat/i.test(fileName);

      let hint = '';
      if (totalLines <= 1) {
        // 헤더만 또는 완전 빈 파일
        hint = `<div style="margin-top:6px;font-size:11px;line-height:1.5;opacity:.85;text-align:left;">
          <strong>📂 파일에 데이터가 0줄입니다</strong> (헤더만 ${totalLines}줄)<br>
          ${isWeekend ? '🗓️ <strong style="color:#fbbf24">파일명에 1월 1일(휴장일)이 포함</strong>되어 있습니다. ' : ''}
          가능한 원인:<br>
          • 단일 날짜만 선택 → 주말/공휴일이면 XAU 휴장으로 0봉<br>
          • Dukascopy 일일 다운로드 한도 초과<br>
          • 다운로드 중 세션 끊김<br><br>
          <strong style="color:#86efac;">해결:</strong><br>
          ① Dukascopy에서 <strong>날짜 범위(From~To)</strong>로 다시 받기<br>
          ② 또는 <a href="https://www.histdata.com/download-free-forex-historical-data/?/ascii/1-minute-bar-quotes/xauusd" target="_blank" style="color:#60a5fa;">HistData에서 받기</a> (회원가입 불필요)
        </div>`;
      } else if (errors.length) {
        hint = `<div style="margin-top:6px;font-size:11px;line-height:1.5;opacity:.75;text-align:left;">
          파싱 실패 라인 예시:<br>${errors.slice(0,3).map(e=>`• ${e}`).join('<br>')}<br>
          <span style="color:#fbbf24;">→ 파일 형식이 지원 목록과 다를 수 있습니다. 사이드바 [무료 CSV 다운로드 사이트] 박스의 지원 포맷을 확인하세요.</span>
        </div>`;
      }
      setDataStatus(`❌ CSV 파싱 실패 — 유효한 캔들 없음${hint}`, 'err');
      return;
    }

    const firstDate = new Date(candles[0].ts * 1000).toISOString().slice(0,10);
    const lastDate  = new Date(candles[candles.length-1].ts * 1000).toISOString().slice(0,10);
    console.log(`[CSV] 포맷: ${formatHint} · ${candles.length}봉 (${firstDate} ~ ${lastDate})`);
    if (errors.length) console.warn(`[CSV] 스킵된 라인 ${errors.length}건`, errors.slice(0,5));

    // ── 청크 분할 업로드 (1만봉씩) ────────────────────────────
    const tf = document.getElementById('paramTimeframe').value;
    const CHUNK = 10000;
    const total = candles.length;
    let uploaded = 0;
    const startedAt = Date.now();

    for (let i = 0; i < total; i += CHUNK) {
      const part = candles.slice(i, i + CHUNK);
      const pct = Math.round(((i + part.length) / total) * 100);
      const elapsed = (Date.now() - startedAt) / 1000;
      const remain = elapsed > 0 ? Math.max(0, elapsed / (i + part.length) * (total - i - part.length)) : 0;

      setDataStatus(
        `<div style="display:flex;flex-direction:column;gap:6px">
          <div><i class="fas fa-spinner fa-spin"></i> 업로드 중 · ${(uploaded+part.length).toLocaleString()}/${total.toLocaleString()}봉 (${pct}%)</div>
          <div style="background:rgba(255,255,255,0.1);border-radius:4px;height:6px;overflow:hidden">
            <div style="background:linear-gradient(90deg,#10b981,#059669);height:100%;width:${pct}%;transition:width .3s"></div>
          </div>
          <div style="font-size:11px;opacity:.7">포맷: ${formatHint} · 남은 시간 ${remain<1?'곧':fmtETA(remain)}</div>
        </div>`,
        'warn'
      );

      const res = await fetch('/api/candles/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: 'XAUUSD', timeframe: tf, candles: part })
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'upload 실패');
      uploaded += (json.inserted || part.length);
    }

    await checkExistingData();
    setDataStatus(
      `✅ CSV 업로드 완료 · ${uploaded.toLocaleString()}봉 (${firstDate} ~ ${lastDate})` +
      (errors.length ? ` · 스킵 ${errors.length}건` : ''),
      'ok'
    );
  } catch (e) {
    setDataStatus('❌ ' + (e.message || e), 'err');
  } finally {
    // input 초기화 (같은 파일 다시 선택 가능하게)
    ev.target.value = '';
  }
}

// ══════════════════════════════════════════════════════════════
//  파라미터 수집
// ══════════════════════════════════════════════════════════════
function getParams() {
  return {
    // 데이터
    timeframe   : document.getElementById('paramTimeframe').value,
    startDate   : document.getElementById('paramStartDate').value,
    endDate     : document.getElementById('paramEndDate').value,
    // EA 메타 (AUTO LOGIC 3 고정)
    magic       : 234568,
    // [1] 방향
    allowBuy    : TOGGLES.buy,
    allowSell   : TOGGLES.sell,
    // [2] 초기설정
    seed        : parseFloat(document.getElementById('paramSeed').value) || 1000,
    startLot    : parseFloat(document.getElementById('paramStartLot').value) || 0.01,
    // [3] 수익
    tpPoints    : parseFloat(document.getElementById('paramTpPts').value) || 300,
    // [4] 마틴게일
    lotMult     : parseFloat(document.getElementById('paramLotMult').value) || 1.5,
    interval    : parseFloat(document.getElementById('paramInterval').value) || 300,
    maxOrders   : parseInt(document.getElementById('paramMaxOrders').value) || 99,
    // [5] 청산
    useBasketTp : TOGGLES.tp,
    cooldownSec : parseInt(document.getElementById('paramCooldown').value) || 0,
    slUsd       : parseFloat(document.getElementById('paramSlUsd').value) || 0,
    // 추가 안전장치
    dailyMaxLoss : parseFloat(document.getElementById('paramDailyLoss').value) || 0,
    doubling     : TOGGLES.doubling,
    doublingMode : document.getElementById('paramDoublingMode').value || 'add',
    doublingAmt  : parseFloat(document.getElementById('paramDoublingAdd').value) || 0.01,
    // 세션
    s1Enabled : TOGGLES.s1,
    s1Start   : document.getElementById('sess1Start').value || '00:00',
    s1End     : document.getElementById('sess1End').value   || '23:59',
    s2Enabled : TOGGLES.s2,
    s2Start   : document.getElementById('sess2Start').value || '22:00',
    s2End     : document.getElementById('sess2End').value   || '02:00',
    weekdays  : getEnabledWeekdays()
  };
}

// ══════════════════════════════════════════════════════════════
//  시뮬레이션 엔진
// ══════════════════════════════════════════════════════════════

// UTC epoch sec → KST Date 객체
//   봉 ts는 항상 UTC epoch(서버가 timezone=UTC로 받아 'Z'로 저장).
//   EA를 KST 기준 특정 시간대에만 운영하므로 세션 판정·표시 모두 KST(UTC+9).
//   반환 Date의 getUTCHours()/getUTCDay()가 곧 'KST 시/요일'이 된다.
function toKST(utcSec) {
  return new Date((utcSec + 9 * 3600) * 1000);
}

// KST 시각이 세션 윈도우 안인지
function inSession(kstDate, p) {
  const hh = kstDate.getUTCHours();
  const mm = kstDate.getUTCMinutes();
  const minutes = hh * 60 + mm;
  const parseT = (s) => { const [h,m] = s.split(':').map(Number); return h*60 + m; };
  const inWindow = (start, end) => {
    if (end >= start) return minutes >= start && minutes <= end;
    // 자정 넘김 (예: 22:00 ~ 02:00)
    return minutes >= start || minutes <= end;
  };
  let ok = false;
  if (p.s1Enabled && inWindow(parseT(p.s1Start), parseT(p.s1End))) ok = true;
  if (p.s2Enabled && inWindow(parseT(p.s2Start), parseT(p.s2End))) ok = true;
  if (!p.s1Enabled && !p.s2Enabled) ok = true; // 둘 다 OFF면 전구간
  // 요일 (KST)
  // JS getUTCDay: 0=일 1=월 ... 6=토
  const dow = kstDate.getUTCDay();
  if (!p.weekdays.has(dow)) ok = false;
  return ok;
}

// 단일 포지션 PnL
function posPnL(direction, entry, current, lot) {
  const diff = direction === 'buy' ? current - entry : entry - current;
  return diff * CONTRACT.contractSize * lot;
}

// 마틴게일 n번째 랏 계산 — 실거래 EA(AUTO LOGIC 3) 8주문 바스켓 검증 완료:
//   lot[n] = round(시작랏 × 배수ⁿ, 0.01단위).  n = 진입 순번(0=초기진입)
//   실제 8주문 진행 0.01→0.02→0.02→0.03→0.05→0.08→0.11→0.17 과 정확히 일치.
//   ※ "직전랏 × 배수"가 아니라 "시작랏 × 배수ⁿ"이 핵심. (반올림 누적 오차 없음)
//   예) 0.01×1.5^2 = 0.0225 → 0.02,  0.01×1.5^7 = 0.1709 → 0.17
function martinLotAt(startLot, mult, n) {
  const v = Math.round(startLot * Math.pow(mult, n) * 100) / 100;
  // MT4 최소 랏 보장
  return +(v < 0.01 ? 0.01 : v).toFixed(2);
}

// 바스켓(같은 방향 누적 포지션) 평균단가, 누적랏, PnL
function basketStats(positions, currentPrice) {
  if (!positions.length) return { avg:0, totalLot:0, pnl:0 };
  let weightedSum = 0, totalLot = 0;
  for (const p of positions) {
    weightedSum += p.entry * p.lot;
    totalLot    += p.lot;
  }
  const avg = weightedSum / totalLot;
  const dir = positions[0].direction;
  const pnl = posPnL(dir, avg, currentPrice, totalLot);
  return { avg, totalLot, pnl };
}

// 시드 배증에 따른 lot 조정
function adjustStartLot(baseLot, currentBalance, initialSeed, p) {
  if (!p.doubling) return baseLot;
  // 시드가 몇 번 배증되었나
  if (currentBalance <= initialSeed) return baseLot;
  const doublings = Math.floor(Math.log2(currentBalance / initialSeed));
  if (doublings <= 0) return baseLot;
  if (p.doublingMode === 'add') {
    return +(baseLot + p.doublingAmt * doublings).toFixed(2);
  } else {
    // mul: 배수
    return +(baseLot * Math.pow(p.doublingAmt > 1 ? p.doublingAmt : 2, doublings)).toFixed(2);
  }
}

// 통합 손절금액(SL) 스케일링 — 진입 랏 배증과 "동일한 배수"로 SL도 키운다.
//   (A 방식) 자본금이 2배가 되어 랏이 2배가 되면 손실 폭도 2배이므로 SL도 2배여야
//   일관성이 맞다. 결과적으로 "자본금 대비 일정 비율(예: 50%)" 손절과 동치.
//   예) 시드 $1000·SL $500 → $2000이면 SL $1000 → $4000이면 SL $2000.
//   ※ doubling(랏 배증)이 꺼져 있으면 SL은 baseSl 고정.
//   ※ 'add' 모드는 랏을 가산하므로 SL은 배수가 아닌 '진입랏 비율'로 맞춘다.
function adjustSlUsd(baseSl, baseLot, currentBalance, initialSeed, p) {
  if (baseSl <= 0) return baseSl;           // SL 미사용
  if (!p.doubling) return baseSl;           // 랏 배증 OFF → SL 고정
  const scaledLot = adjustStartLot(baseLot, currentBalance, initialSeed, p);
  if (scaledLot <= baseLot) return baseSl;  // 아직 배증 전
  // 진입 랏이 커진 비율만큼 SL도 키운다 (랏 2배 → SL 2배).
  return +(baseSl * (scaledLot / baseLot)).toFixed(2);
}

/**
 * 메인 시뮬레이션
 * @param candles [{ts,o,h,l,c}] UTC epoch sec, 오름차순
 * @param p 파라미터
 * @returns {balance,equityCurve,baskets,liquidated,reason,maxDD,...}
 */
function simulate(candles, p) {
  let balance = p.seed;
  const startingBalance = p.seed;
  let peak = balance;
  let maxDD = 0;
  let maxDDPct = 0;
  const equityCurve = [];   // [{ts, balance, equity}]
  const baskets = [];        // 완료된 바스켓 기록
  const trades  = [];        // 모든 진입 (마커용)
  // 진행 중인 바스켓
  let buyPos = [];           // [{entry, lot, ts}]
  let sellPos = [];
  let buyTrigger  = null;    // 다음 추가진입 트리거가격
  let sellTrigger = null;
  let curBuyLot   = p.startLot;
  let curSellLot  = p.startLot;
  let cooldownUntil = 0;
  let dailyPnl = 0;
  let currentDay = '';
  let dailyStopped = false;
  let liquidated = false;
  let liquidationInfo = null;

  // 단순화: 봉 내부는 O→L→H→C (롱 입장 보수) / O→H→L→C (숏 입장 보수)
  // 양방향 바스켓이 동시에 있을 수 있으므로 안전한 표준 경로: O→L→H→C (숏 보수적 = 손실 빠르게)
  // → 실제로는 둘 다 시뮬해야 정확하지만, 단순화를 위해 O,H,L,C 4단계 모두 평가
  const PATH = ['o', 'l', 'h', 'c'];  // L 먼저 (불리한 가격을 먼저 확인 = 보수적)

  function closeBasket(direction, exitPrice, ts, reason) {
    const pos = direction === 'buy' ? buyPos : sellPos;
    if (!pos.length) return 0;
    const stats = basketStats(pos, exitPrice);
    let pnl = stats.pnl;

    // ── 마진콜(완전 청산) 가드 ───────────────────────────────────────────
    //   이 손익을 잔고에 반영했을 때 잔고가 0 이하로 떨어지면(=시드 전액 소진),
    //   추가 자본 유입이 없으므로 손실은 "남은 잔고만큼만" 실제로 확정되고
    //   계좌는 그 즉시 깡통(잔고 $0)이 된다.
    //   예) 시드 $10에서 SL -$500이 걸리면 실제로 빠지는 건 $10뿐 → 잔고 $0, 청산.
    if (pnl < 0 && balance + pnl <= 0) {
      pnl = -balance;                       // 남은 잔고만큼만 실손실 확정
      balance = 0;

      baskets.push({
        idx: baskets.length + 1,
        direction,
        entryTs: pos[0].ts,
        exitTs: ts,
        positions: pos.length,
        totalLot: +stats.totalLot.toFixed(2),
        avgPrice: +stats.avg.toFixed(2),
        exitPrice: +exitPrice.toFixed(2),
        pnl: +pnl.toFixed(2),
        balance: 0,
        reason: reason + ' → 마진콜(자본금 $0 소진)',
        positionsDetail: pos.map((x,i) => ({
          order: i+1, entry: +x.entry.toFixed(2), lot: x.lot, ts: x.ts,
          pnl: +posPnL(direction, x.entry, exitPrice, x.lot).toFixed(2)
        }))
      });

      dailyPnl += pnl;
      buyPos = []; sellPos = [];
      buyTrigger = null; sellTrigger = null;
      liquidated = true;
      liquidationInfo = { ts, equity: 0, reason: '계좌 청산 (자본금 $0 소진 · 마진콜)' };
      return pnl;
    }

    balance += pnl;

    baskets.push({
      idx: baskets.length + 1,
      direction,
      entryTs: pos[0].ts,
      exitTs: ts,
      positions: pos.length,
      totalLot: +stats.totalLot.toFixed(2),
      avgPrice: +stats.avg.toFixed(2),
      exitPrice: +exitPrice.toFixed(2),
      pnl: +pnl.toFixed(2),
      balance: +balance.toFixed(2),
      reason,
      positionsDetail: pos.map((x,i) => ({
        order: i+1, entry: +x.entry.toFixed(2), lot: x.lot, ts: x.ts,
        pnl: +posPnL(direction, x.entry, exitPrice, x.lot).toFixed(2)
      }))
    });

    if (direction === 'buy') buyPos = []; else sellPos = [];
    if (direction === 'buy') buyTrigger = null; else sellTrigger = null;

    dailyPnl += pnl;

    // 청산 후 시작랏 재산정 (시드 배증)
    if (direction === 'buy')   curBuyLot  = adjustStartLot(p.startLot, balance, startingBalance, p);
    else                       curSellLot = adjustStartLot(p.startLot, balance, startingBalance, p);

    if (p.cooldownSec > 0) cooldownUntil = ts + p.cooldownSec;

    return pnl;
  }

  function checkLiquidation(ts, unrealizedPnl) {
    // 가용자본(Equity) = 실현잔고 + 미실현손익.
    //   초기 시드 $1000이 전부 소진(Equity ≤ 0)되면 추가 자본 유입이 없으므로
    //   그 즉시 강제청산(마진콜)되고 이후 매매를 잇지 못한다.
    //   ※ SL(-$500)에 닿기 전이라도 잔고가 미실현손실을 못 버티면 여기서 깡통.
    //     예) 잔고 $300 + 미실현 -$300 → Equity $0 → SL($500) 도달 전 청산.
    const equity = balance + unrealizedPnl;
    if (equity <= 0) {
      // 잔여 자본 전액 손실로 확정 → 잔고 0, 모든 포지션 강제 종료
      balance = 0;
      buyPos = []; sellPos = [];
      buyTrigger = null; sellTrigger = null;
      liquidated = true;
      liquidationInfo = { ts, equity: 0, reason: '계좌 청산 (자본금 $0 소진 · 마진콜)' };
      return true;
    }
    return false;
  }

  function dayKey(kst) {
    return kst.toISOString().slice(0,10);
  }

  // 1분봉 순회
  for (let i = 0; i < candles.length; i++) {
    if (liquidated) break;   // 계좌 청산되면 이후 매매 불가 (추가 자본 유입 없음)
    const k = candles[i];
    const ts = k.ts;
    const kst = toKST(ts);
    const dKey = dayKey(kst);

    // 일별 리셋
    if (dKey !== currentDay) {
      currentDay = dKey;
      dailyPnl = 0;
      dailyStopped = false;
    }

    // 봉 내부 가격 경로 시뮬레이션
    const pricesInBar = PATH.map(key => k[key]);

    // ── 한 가격점에서 청산(TP/SL/DDL) 체크 → 닿으면 즉시 일괄청산 ──
    //   추가진입 직후/봉내부 매 가격점마다 호출. 청산이 일어나면 true 반환.
    function checkExits(price) {
      const stB = basketStats(buyPos,  price);
      const stS = basketStats(sellPos, price);

      // 통합 TP: 평단가가 (tpPoints / 주문수) pt 유리하게 이동하면 일괄청산.
      if (p.useBasketTp) {
        if (buyPos.length) {
          const tgt = (p.tpPoints / buyPos.length) * CONTRACT.pointSize * CONTRACT.contractSize * stB.totalLot;
          if (stB.pnl >= tgt) closeBasket('buy', price, ts, 'TP');
        }
        if (sellPos.length) {
          const tgt = (p.tpPoints / sellPos.length) * CONTRACT.pointSize * CONTRACT.contractSize * stS.totalLot;
          if (stS.pnl >= tgt) closeBasket('sell', price, ts, 'TP');
        }
      }
      if (liquidated) return true;
      // 통합 SL: 바스켓 평가손실이 -slUsd 이하면 즉시 손절.
      //   ※ 진입 랏이 자본금 배증으로 커지면 SL도 같은 배수로 스케일(A 방식).
      //     바스켓의 시작랏(pos[0].lot)이 기본랏(startLot) 대비 몇 배인지로 산정.
      //     예) 랏 2배로 진입한 바스켓 → SL $500×2 = $1000.
      //   closeBasket 내부에서 잔고를 초과하는 손실이면 마진콜(청산) 처리되므로
      //   liquidated 플래그가 서면 즉시 중단한다.
      if (p.slUsd > 0) {
        if (buyPos.length) {
          const slB = p.doubling && p.startLot > 0
            ? +(p.slUsd * (buyPos[0].lot / p.startLot)).toFixed(2) : p.slUsd;
          if (basketStats(buyPos, price).pnl <= -slB) closeBasket('buy', price, ts, 'SL');
        }
        if (liquidated) return true;
        if (sellPos.length) {
          const slS = p.doubling && p.startLot > 0
            ? +(p.slUsd * (sellPos[0].lot / p.startLot)).toFixed(2) : p.slUsd;
          if (basketStats(sellPos, price).pnl <= -slS) closeBasket('sell', price, ts, 'SL');
        }
        if (liquidated) return true;
      }
      // 일일 최대 손실
      if (p.dailyMaxLoss > 0 && !dailyStopped) {
        const unrl = basketStats(buyPos, price).pnl + basketStats(sellPos, price).pnl;
        if (dailyPnl + unrl <= -p.dailyMaxLoss) {
          if (buyPos.length)  closeBasket('buy',  price, ts, 'DDL');
          if (liquidated) return true;
          if (sellPos.length) closeBasket('sell', price, ts, 'DDL');
          if (liquidated) return true;
          dailyStopped = true;
        }
      }
      // 계좌 청산(파산) 체크
      const unr = basketStats(buyPos, price).pnl + basketStats(sellPos, price).pnl;
      return checkLiquidation(ts, unr);
    }

    for (let pi = 0; pi < pricesInBar.length; pi++) {
      const price = pricesInBar[pi];
      if (isNaN(price) || price <= 0) continue;

      // 1) 현재 가격점에서 청산 체크 (추가진입 전에 먼저)
      if (checkExits(price)) break;

      // 2) 추가진입 트리거 — 가격이 그리드를 여러 칸 관통했으면 그만큼 연속 추가.
      //    (기존엔 1점당 1개만 추가 → 급락/급등봉에서 물량이 덜 쌓여 SL을 놓치고
      //     평가손실이 비현실적으로 커지는 버그였음. while 루프로 정정.)
      //    추가진입 1개마다 즉시 SL/TP 재체크해서 손절선 닿으면 바로 청산.
      //    ※ 진입가는 "그리드 레벨가(buyTrigger)"로 잡는다. (해당 가격이 봉 범위를
      //      통과했다는 의미이므로, 그 레벨에서 체결된 것으로 본다.) 그래야 레벨마다
      //      누적 평가손실이 정확히 계산돼 SL이 제때 발동한다.
      let guard = 0;
      while (buyPos.length && buyTrigger !== null && price <= buyTrigger
             && buyPos.length < p.maxOrders && guard++ < 500) {
        const fillPx  = buyTrigger;                    // 그리드 레벨가에서 체결
        const baseLot = buyPos[0].lot;                 // 바스켓 시작랏(조정값 반영)
        const newLot  = martinLotAt(baseLot, p.lotMult, buyPos.length);
        buyPos.push({ entry: fillPx, lot: newLot, ts, direction:'buy' });
        trades.push({ ts, direction:'buy', price: fillPx, lot:newLot, type:'add' });
        buyTrigger = fillPx - p.interval * CONTRACT.pointSize;
        // 레벨가(fillPx)에서 한번, 현재 봉가격(price, fillPx보다 불리)에서 한번 평가.
        //   마틴게일은 레벨당 손실 점프가 커서, 레벨가에선 -SL 미만이어도
        //   같은 봉의 더 낮은 가격에선 -SL을 넘는다. 둘 다 봐야 SL이 제때 발동.
        if (checkExits(fillPx)) break;
        if (price < fillPx && checkExits(price)) break;
      }
      if (liquidated) break;

      guard = 0;
      while (sellPos.length && sellTrigger !== null && price >= sellTrigger
             && sellPos.length < p.maxOrders && guard++ < 500) {
        const fillPx  = sellTrigger;
        const baseLot = sellPos[0].lot;
        const newLot  = martinLotAt(baseLot, p.lotMult, sellPos.length);
        sellPos.push({ entry: fillPx, lot: newLot, ts, direction:'sell' });
        trades.push({ ts, direction:'sell', price: fillPx, lot:newLot, type:'add' });
        sellTrigger = fillPx + p.interval * CONTRACT.pointSize;
        if (checkExits(fillPx)) break;
        if (price > fillPx && checkExits(price)) break;
      }
      if (liquidated) break;
    }

    // ※ 여기서 조기 break 하지 않는다.
    //   청산이 일어난 봉도 아래의 "봉 종가 기록"까지 진행해야 에쿼티 커브가
    //   청산 시점에 $0 점을 남기고 정확히 끝난다. (조기 break하면 직전 봉이
    //   마지막 점으로 남아 그래프가 $0이 아닌 값에서 끊겨 보임 → 사용자 지적 버그)
    if (dailyStopped && !liquidated) {
      // 잔고 기록만
      equityCurve.push({ ts, balance:+balance.toFixed(2), equity:+balance.toFixed(2) });
      continue;
    }

    // 봉 시가에서 신규 진입 (이미 진입중이면 skip)
    //   ※ 청산(liquidated) 후에는 추가 자본 유입이 없으므로 절대 재진입 금지.
    const entryPrice = k.o;
    const canEnter = !liquidated
      && !dailyStopped
      && ts >= cooldownUntil
      && inSession(kst, p);

    if (canEnter) {
      // 신규 진입 직전, 현재 자본금 기준으로 시작랏 재산정 (배증 반영).
      //   → 이 랏 값으로 진입하면 SL도 동일 배수로 스케일된다 (checkExits 참조).
      curBuyLot  = adjustStartLot(p.startLot, balance, startingBalance, p);
      curSellLot = adjustStartLot(p.startLot, balance, startingBalance, p);
      if (p.allowBuy && buyPos.length === 0) {
        buyPos.push({ entry: entryPrice, lot: curBuyLot, ts, direction:'buy' });
        trades.push({ ts, direction:'buy', price: entryPrice, lot: curBuyLot, type:'open' });
        buyTrigger = entryPrice - p.interval * CONTRACT.pointSize;
      }
      if (p.allowSell && sellPos.length === 0) {
        sellPos.push({ entry: entryPrice, lot: curSellLot, ts, direction:'sell' });
        trades.push({ ts, direction:'sell', price: entryPrice, lot: curSellLot, type:'open' });
        sellTrigger = entryPrice + p.interval * CONTRACT.pointSize;
      }
    }

    // 잔고/MDD 기록 (봉 종가 기준)
    //   ※ 청산되면 잔고=0·포지션 전부 정리 상태이므로 eq=0 이 되어야 한다.
    //     혹시 모를 오차를 막기 위해 청산 시엔 명시적으로 0으로 고정한다.
    const finalPrice = k.c;
    const finalUnrl = liquidated ? 0
      : basketStats(buyPos, finalPrice).pnl + basketStats(sellPos, finalPrice).pnl;
    const eq = liquidated ? 0 : balance + finalUnrl;
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
    if (ddPct > maxDDPct) maxDDPct = ddPct;

    // 잔고 곡선 (1분봉이면 매우 많아짐 → 다운샘플)
    //   ※ 청산이 난 봉은 다운샘플과 무관하게 반드시 마지막 점($0)으로 기록.
    //     (그래야 에쿼티 커브가 청산 시점에서 정확히 멈추고 끝까지 늘어지지 않음)
    const downsample = candles.length > 5000 ? Math.ceil(candles.length / 3000) : 1;
    if (i % downsample === 0 || i === candles.length - 1 || liquidated) {
      // 청산 봉은 청산이 실제 발생한 ts(liquidationInfo.ts)로 점을 찍어
      //   에쿼티 커브와 가격 차트의 청산 지점이 정확히 일치하게 한다.
      const recTs = liquidated && liquidationInfo ? liquidationInfo.ts : ts;
      equityCurve.push({ ts: recTs, balance: +balance.toFixed(2), equity: +eq.toFixed(2) });
    }
    if (liquidated) break;   // 청산 봉 기록 후 즉시 종료 (이후 매매 없음)
  }

  // 백테스트 종료: 잔여 포지션 강제 청산 (종가)
  if (!liquidated && candles.length) {
    const lastK = candles[candles.length - 1];
    if (buyPos.length)  closeBasket('buy',  lastK.c, lastK.ts, 'EOT');
    if (sellPos.length) closeBasket('sell', lastK.c, lastK.ts, 'EOT');
  }

  // 통계
  const wins = baskets.filter(b => b.pnl > 0).length;
  const losses = baskets.filter(b => b.pnl < 0).length;
  const totalProfit = baskets.filter(b => b.pnl > 0).reduce((s,b) => s + b.pnl, 0);
  const totalLoss   = Math.abs(baskets.filter(b => b.pnl < 0).reduce((s,b) => s + b.pnl, 0));
  const winRate = baskets.length ? (wins / baskets.length) * 100 : 0;
  const pf = totalLoss > 0 ? totalProfit / totalLoss : (totalProfit > 0 ? 999 : 0);
  const maxConcurrent = Math.max(
    ...baskets.map(b => b.positions),
    0
  );

  return {
    balance: +balance.toFixed(2),
    seed: startingBalance,
    pnl: +(balance - startingBalance).toFixed(2),
    pnlPct: +(((balance - startingBalance) / startingBalance) * 100).toFixed(2),
    peak: +peak.toFixed(2),
    maxDD: +maxDD.toFixed(2),
    maxDDPct: +maxDDPct.toFixed(2),
    baskets,
    trades,
    equityCurve,
    liquidated,
    liquidationInfo,
    wins, losses, winRate: +winRate.toFixed(1),
    profitFactor: +pf.toFixed(2),
    maxConcurrent,
    candleCount: candles.length
  };
}

// ══════════════════════════════════════════════════════════════
//  단일 백테스트 실행
// ══════════════════════════════════════════════════════════════
async function runBacktest() {
  if (!CANDLES.length) {
    setStatus('error', '차트 데이터가 없습니다. [차트 데이터 받기]를 먼저 클릭하세요.');
    return;
  }
  const btn = document.getElementById('btnRun');
  btn.disabled = true;
  setStatus('run', '백테스트 실행 중...');

  try {
    const p = getParams();
    if (!p.allowBuy && !p.allowSell) throw new Error('매수/매도 모두 비활성화됨');

    // 기간 필터링
    const from = Math.floor(new Date(p.startDate + 'T00:00:00Z').getTime() / 1000);
    const to   = Math.floor(new Date(p.endDate   + 'T23:59:59Z').getTime() / 1000);
    const filtered = CANDLES.filter(k => k.ts >= from && k.ts <= to);
    if (!filtered.length) throw new Error('선택 기간에 데이터 없음');

    // 시뮬레이션 (비동기 wrapper)
    await new Promise(r => setTimeout(r, 30));
    const result = simulate(filtered, p);
    LAST_BACKTEST = { result, params: p };

    renderSingleResult(result, p);
    setStatus(result.liquidated ? 'error' : 'done',
      result.liquidated
        ? `❌ 청산 발생 (${formatKstShort(result.liquidationInfo.ts)})`
        : `✅ 완료 — ${result.baskets.length} 바스켓 · PF ${result.profitFactor}`);
  } catch (e) {
    setStatus('error', '오류: ' + e.message);
    console.error(e);
  } finally {
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
//  CASE 비교 실행 (기본 + CASE 1~3)
// ══════════════════════════════════════════════════════════════
async function runCaseCompare() {
  if (!CANDLES.length) {
    setStatus('error', '차트 데이터가 없습니다. [차트 데이터 받기]를 먼저 클릭하세요.');
    return;
  }
  const btn = document.getElementById('btnSweep');
  btn.disabled = true;
  setStatus('run', 'CASE 비교 실행 중...');
  showProgress(0);

  try {
    const base = getParams();
    const from = Math.floor(new Date(base.startDate + 'T00:00:00Z').getTime() / 1000);
    const to   = Math.floor(new Date(base.endDate   + 'T23:59:59Z').getTime() / 1000);
    const filtered = CANDLES.filter(k => k.ts >= from && k.ts <= to);
    if (!filtered.length) throw new Error('선택 기간에 데이터 없음');

    // CASE 정의 (사용자 기본 외 3종)
    const cases = [
      { id:'base', name:'기본 (사용자 설정)', tag:'base', params: { ...base } },
      { id:'cons', name:'CASE 1 - 보수적', tag:'cons',
        params: { ...base, tpPoints:500, lotMult:1.3, interval:500, slUsd:200, dailyMaxLoss:50 } },
      { id:'mid',  name:'CASE 2 - 중도적', tag:'mid',
        params: { ...base, tpPoints:300, lotMult:1.5, interval:300, slUsd:500, dailyMaxLoss:100 } },
      { id:'agg',  name:'CASE 3 - 공격적 (실제 EA)', tag:'agg',
        params: { ...base, tpPoints:300, lotMult:1.5, interval:300, slUsd:0, dailyMaxLoss:0, maxOrders:99 } }
    ];

    const results = [];
    for (let i = 0; i < cases.length; i++) {
      showProgress((i / cases.length) * 100);
      await new Promise(r => setTimeout(r, 30));
      const res = simulate(filtered, cases[i].params);
      results.push({ ...cases[i], result: res });
    }
    showProgress(100);
    LAST_COMPARE = results;

    renderCompareResult(results, base);
    setStatus('done', `✅ CASE 비교 완료 (4종)`);
    // sweep 탭으로 이동
    switchTab('sweep');
  } catch (e) {
    setStatus('error', '오류: ' + e.message);
    console.error(e);
  } finally {
    btn.disabled = false;
    setTimeout(() => showProgress(-1), 1500);
  }
}

function showProgress(pct) {
  const wrap = document.getElementById('progWrap');
  const fill = document.getElementById('progFill');
  if (pct < 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  fill.style.width = pct + '%';
}

// ══════════════════════════════════════════════════════════════
//  렌더링 - 단일 결과
// ══════════════════════════════════════════════════════════════
function setStatus(kind, msg, detail) {
  const el = document.getElementById('btStatus');
  el.className = 'bt-status ' + kind;
  document.getElementById('btStatusText').innerHTML = msg;
  document.getElementById('btStatusDetail').innerHTML = detail || '';
}

function formatKstShort(epoch) {
  if (!epoch) return '—';
  const d = new Date((epoch + 9*3600) * 1000);
  return d.toISOString().slice(2, 16).replace('T',' ');
}

function renderSingleResult(r, p) {
  // 청산 배너
  const liqBan = document.getElementById('liqBanner');
  if (r.liquidated) {
    liqBan.classList.add('show');
    document.getElementById('liqBannerBody').innerHTML = `
      <b>청산 발생 시각</b>: ${formatKstShort(r.liquidationInfo.ts)} (KST)<br>
      <b>가용 잔고</b>: $${r.liquidationInfo.equity} (시드 $${r.seed})<br>
      <b>완료 바스켓</b>: ${r.baskets.length}개 · <b>최대 동시 포지션</b>: ${r.maxConcurrent}개<br>
      <b>사유</b>: ${r.liquidationInfo.reason}
    `;
  } else {
    liqBan.classList.remove('show');
  }

  // CASE 비교 영역 숨김
  document.getElementById('caseCompareResult').style.display = 'none';

  // 데이터 정보 박스
  const di = document.getElementById('dataInfoBox');
  di.style.display = 'block';
  di.innerHTML = `
    <b>차트 데이터</b>: ${r.candleCount.toLocaleString()}봉 (${p.timeframe})
    · <b>기간</b>: ${p.startDate} ~ ${p.endDate}
    · <b>시간대</b>: KST(UTC+9)
    · <b>EA</b>: AUTO LOGIC 3
  `;

  // KPI
  setKpi('kcPnl',  (r.pnl >= 0 ? '+' : '') + '$' + r.pnl.toLocaleString(), r.pnl >= 0 ? 'g' : 'r');
  setKpi('kcPnlSub', `${r.pnlPct>=0?'+':''}${r.pnlPct}%`);
  setKpi('kcBalance', '$' + r.balance.toLocaleString(), r.balance >= r.seed ? 'g' : 'r');
  setKpi('kcBalanceSub', `시드 $${r.seed} · ${r.pnlPct>=0?'+':''}${r.pnlPct}%`);
  setKpi('kcWin', r.baskets.length + ' / ' + r.winRate + '%', r.winRate >= 50 ? 'g' : 'y');
  setKpi('kcWinSub', `승 ${r.wins} · 패 ${r.losses}`);
  setKpi('kcPF', r.profitFactor.toString(), r.profitFactor >= 1.5 ? 'g' : (r.profitFactor >= 1 ? 'y' : 'r'));
  setKpi('kcMDD', '-$' + r.maxDD.toLocaleString(), 'r');
  setKpi('kcMDDSub', '-' + r.maxDDPct + '%');
  setKpi('kcSL', r.baskets.filter(b => b.reason === 'SL' || b.reason === 'DDL').length.toString(), 'r');
  setKpi('kcSLSub', r.liquidated ? '⚠️ 계좌청산' : '정상');
  setKpi('kcMaxPos', r.maxConcurrent.toString(), r.maxConcurrent <= 5 ? 'g' : (r.maxConcurrent <= 15 ? 'y' : 'r'));
  setKpi('kcMaxPosSub', `최대 진입 ${p.maxOrders}`);
  setKpi('kcPeriod', p.startDate.slice(2));
  setKpi('kcPeriodSub', '~ ' + p.endDate.slice(2));

  // 에쿼티 차트
  renderEquityChart([{ name:'잔고', data:r.equityCurve, color:'#f5c400' }]);
  document.getElementById('equityBar').style.display = 'flex';
  document.getElementById('eqPeak').textContent   = '$' + r.peak.toLocaleString();
  document.getElementById('eqTrough').textContent = '$' + (r.peak - r.maxDD).toFixed(2);
  document.getElementById('eqFinal').textContent  = '$' + r.balance.toLocaleString();
  document.getElementById('eqMdd').textContent    = '-$' + r.maxDD.toLocaleString();

  // 가격 차트 + 청산 마커
  //   ※ 청산이 났으면 캔들도 청산 시점까지만 그린다 (그 이후엔 매매가 없으므로).
  const rangeStart = Math.floor(new Date(p.startDate+'T00:00:00Z').getTime()/1000);
  let   rangeEnd   = Math.floor(new Date(p.endDate+'T23:59:59Z').getTime()/1000);
  if (r.liquidated && r.liquidationInfo) {
    rangeEnd = Math.min(rangeEnd, r.liquidationInfo.ts);
  }
  renderPriceChart(
    CANDLES.filter(k => k.ts >= rangeStart && k.ts <= rangeEnd),
    r.liquidationInfo
  );

  // 바스켓 테이블
  renderBasketTable(r.baskets);
}

function setKpi(id, val, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = val;
  el.className = 'kc-val' + (cls ? ' ' + cls : '');
}

// ══════════════════════════════════════════════════════════════
//  렌더링 - CASE 비교
// ══════════════════════════════════════════════════════════════
function renderCompareResult(results, baseParams) {
  document.getElementById('liqBanner').classList.remove('show');
  document.getElementById('caseCompareResult').style.display = 'block';

  // "살아남은 CASE 중 최대 수익"이 우승
  const survivors = results.filter(r => !r.result.liquidated);
  let winnerId = null;
  if (survivors.length) {
    const best = survivors.reduce((b, c) => c.result.pnl > b.result.pnl ? c : b);
    winnerId = best.id;
  }

  // 카드 그리드
  const grid = document.getElementById('caseResultGrid');
  grid.innerHTML = results.map(c => {
    const r = c.result;
    const liq = r.liquidated;
    const isWin = c.id === winnerId;
    return `
      <div class="case-result-card ${c.tag} ${liq?'liquidated':''} ${isWin?'winner':''}">
        <div class="case-result-title">
          ${c.name}
          ${liq ? '<span class="case-liq-tag">청산</span>' : ''}
        </div>
        <div class="case-result-row ${r.pnl>=0?'g':'r'}">
          <span>총손익</span><span>${r.pnl>=0?'+':''}$${r.pnl.toLocaleString()}</span>
        </div>
        <div class="case-result-row ${r.balance>=r.seed?'g':'r'}">
          <span>최종잔고</span><span>$${r.balance.toLocaleString()}</span>
        </div>
        <div class="case-result-row ${r.pnlPct>=0?'g':'r'}">
          <span>수익률</span><span>${r.pnlPct>=0?'+':''}${r.pnlPct}%</span>
        </div>
        <div class="case-result-row">
          <span>바스켓</span><span>${r.baskets.length} (승률 ${r.winRate}%)</span>
        </div>
        <div class="case-result-row y">
          <span>PF</span><span>${r.profitFactor}</span>
        </div>
        <div class="case-result-row r">
          <span>MDD</span><span>-$${r.maxDD.toLocaleString()} (-${r.maxDDPct}%)</span>
        </div>
        <div class="case-result-row">
          <span>최대 동시포지션</span><span>${r.maxConcurrent}</span>
        </div>
        <div class="case-result-row" style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);">
          <span style="font-size:9px;">설정</span>
          <span style="font-size:9.5px;">TP${c.params.tpPoints}·×${c.params.lotMult}·간격${c.params.interval}</span>
        </div>
        ${liq ? `<div style="margin-top:8px;font-size:9px;color:#f06060;line-height:1.5;">
          청산시각: ${formatKstShort(r.liquidationInfo.ts)} (KST)<br>잔여 $${r.liquidationInfo.equity}
        </div>` : ''}
      </div>
    `;
  }).join('');

  // 다중 에쿼티 차트
  const colors = { base:'#f5c400', cons:'#3dd68c', mid:'#5ba8e0', agg:'#f06060' };
  const series = results.map(c => ({
    name: c.name,
    data: c.result.equityCurve,
    color: colors[c.tag] || '#fff'
  }));
  renderEquityChart(series);
  document.getElementById('equityBar').style.display = 'none';

  // KPI 영역에 winner 정보
  if (winnerId) {
    const w = results.find(r => r.id === winnerId);
    setStatus('done',
      `🏆 추천: <b>${w.name}</b> — 수익 $${w.result.pnl.toLocaleString()} · MDD -$${w.result.maxDD.toLocaleString()}`,
      `청산 발생: ${results.filter(r => r.result.liquidated).map(r => r.name).join(', ') || '없음'}`
    );
  } else {
    setStatus('error', '⚠️ 모든 CASE 청산됨 — 더 보수적인 설정 필요');
  }

  // KPI 카드는 winner 기준
  if (winnerId) {
    const w = results.find(r => r.id === winnerId);
    renderSingleResultKpiOnly(w.result, w.params, '🏆 ' + w.name);
  }

  // sweep 탭 컨텐츠
  document.getElementById('sweepContent').innerHTML = renderCompareTable(results);

  // 가격차트 winner 기준 (청산 마커만 · 청산 시점까지만)
  if (winnerId) {
    const w = results.find(r => r.id === winnerId);
    const rs = Math.floor(new Date(baseParams.startDate+'T00:00:00Z').getTime()/1000);
    let   re = Math.floor(new Date(baseParams.endDate+'T23:59:59Z').getTime()/1000);
    if (w.result.liquidated && w.result.liquidationInfo) {
      re = Math.min(re, w.result.liquidationInfo.ts);
    }
    renderPriceChart(
      CANDLES.filter(k => k.ts >= rs && k.ts <= re),
      w.result.liquidationInfo
    );
  }
}

function renderSingleResultKpiOnly(r, p, title) {
  setKpi('kcPnl',  (r.pnl >= 0 ? '+' : '') + '$' + r.pnl.toLocaleString(), r.pnl >= 0 ? 'g' : 'r');
  setKpi('kcPnlSub', title || '');
  setKpi('kcBalance', '$' + r.balance.toLocaleString(), r.balance >= r.seed ? 'g' : 'r');
  setKpi('kcBalanceSub', `시드 $${r.seed} · ${r.pnlPct>=0?'+':''}${r.pnlPct}%`);
  setKpi('kcWin', r.baskets.length + ' / ' + r.winRate + '%', r.winRate >= 50 ? 'g' : 'y');
  setKpi('kcWinSub', `승 ${r.wins} · 패 ${r.losses}`);
  setKpi('kcPF', r.profitFactor.toString(), r.profitFactor >= 1.5 ? 'g' : (r.profitFactor >= 1 ? 'y' : 'r'));
  setKpi('kcMDD', '-$' + r.maxDD.toLocaleString(), 'r');
  setKpi('kcMDDSub', '-' + r.maxDDPct + '%');
  setKpi('kcSL', r.baskets.filter(b => b.reason === 'SL' || b.reason === 'DDL').length.toString(), 'r');
  setKpi('kcSLSub', r.liquidated ? '⚠️ 청산' : '정상');
  setKpi('kcMaxPos', r.maxConcurrent.toString(), 'y');
  setKpi('kcMaxPosSub', `최대 진입 ${p.maxOrders}`);

  // 바스켓 테이블도 winner 기준
  renderBasketTable(r.baskets);
}

function renderCompareTable(results) {
  return `
    <table class="bt-tbl">
      <thead>
        <tr>
          <th>CASE</th><th>설정 (TP/배수/간격)</th><th>안전장치</th>
          <th>총손익</th><th>수익률</th><th>바스켓</th><th>승률</th>
          <th>PF</th><th>MDD</th><th>최대포지션</th><th>결과</th>
        </tr>
      </thead>
      <tbody>
        ${results.map(c => {
          const r = c.result;
          const liq = r.liquidated;
          return `
            <tr>
              <td class="w">${c.name}</td>
              <td>TP${c.params.tpPoints} · ×${c.params.lotMult} · ${c.params.interval}pt</td>
              <td style="font-size:10px;">
                ${c.params.slUsd>0?`SL$${c.params.slUsd} `:''}
                ${c.params.dailyMaxLoss>0?`일일$${c.params.dailyMaxLoss}`:''}
                ${c.params.slUsd===0 && c.params.dailyMaxLoss===0 ? '없음' : ''}
              </td>
              <td class="${r.pnl>=0?'g':'r'}">${r.pnl>=0?'+':''}$${r.pnl.toLocaleString()}</td>
              <td class="${r.pnlPct>=0?'g':'r'}">${r.pnlPct>=0?'+':''}${r.pnlPct}%</td>
              <td>${r.baskets.length}</td>
              <td>${r.winRate}%</td>
              <td class="y">${r.profitFactor}</td>
              <td class="r">-$${r.maxDD.toFixed(0)}</td>
              <td>${r.maxConcurrent}</td>
              <td>${liq?'<span class="badge liq">청산</span>':'<span class="badge tp">정상</span>'}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// ══════════════════════════════════════════════════════════════
//  Chart.js 렌더링
// ══════════════════════════════════════════════════════════════
function renderEquityChart(series) {
  const ctx = document.getElementById('equityChart').getContext('2d');
  if (equityChartObj) equityChartObj.destroy();

  const datasets = series.map(s => ({
    label: s.name,
    data: s.data.map(p => ({ x: p.ts * 1000, y: p.balance })),
    borderColor: s.color,
    backgroundColor: s.color + '20',
    borderWidth: 1.8,
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0.1,
    fill: series.length === 1
  }));

  equityChartObj = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: false, parsing: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: series.length > 1, position:'top', labels:{ color:'#aaa', font:{size:10}, boxWidth:12 } },
        tooltip: {
          backgroundColor:'#1a232d',
          titleColor:'#fff', bodyColor:'#fff',
          callbacks: {
            title: (items) => {
              if (!items.length) return '';
              const d = new Date(items[0].parsed.x + 9*3600*1000);
              return d.toISOString().slice(0,16).replace('T',' ') + ' KST';
            },
            label: (item) => `${item.dataset.label}: $${item.parsed.y.toLocaleString()}`
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit:'day', displayFormats:{ day:'MM-DD' } },
          adapters: { date: {} },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#666', font:{ size:10 } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#666', font:{ size:10 }, callback: v => '$' + v }
        }
      }
    }
  });
}

function renderPriceChart(candles, liquidationInfo) {
  document.getElementById('priceChartCard').style.display = 'block';
  const ctx = document.getElementById('priceChart').getContext('2d');
  if (priceChartObj) priceChartObj.destroy();

  // 가격(종가) 라인
  const downsample = candles.length > 3000 ? Math.ceil(candles.length / 2000) : 1;
  const priceData = candles.filter((_, i) => i % downsample === 0).map(k => ({ x: k.ts * 1000, y: k.c }));

  // 청산 마커만 표시 — 계좌 청산(자본금 $0 소진) 지점 1개를 붉은색으로.
  //   진입/추가/TP·SL 마커는 모두 제외 (사용자 요청).
  let liqPrice = null;
  if (liquidationInfo) {
    // 청산 시점에 가장 가까운 캔들의 종가를 청산 가격으로 사용
    const liqTs = liquidationInfo.ts;
    let nearest = null, best = Infinity;
    for (const k of candles) {
      const d = Math.abs(k.ts - liqTs);
      if (d < best) { best = d; nearest = k; }
    }
    if (nearest) liqPrice = nearest.c;
  }
  const liqMarker = (liquidationInfo && liqPrice !== null)
    ? [{ x: liquidationInfo.ts * 1000, y: liqPrice }]
    : [];

  const datasets = [
    { label:'XAUUSD 종가', data: priceData, borderColor:'rgba(245,196,0,0.55)', borderWidth:1, pointRadius:0, tension:0 }
  ];
  if (liqMarker.length) {
    datasets.push({
      label:'계좌 청산', type:'scatter', data: liqMarker,
      pointRadius:11, pointHoverRadius:14, pointStyle:'crossRot',
      borderColor:'#ff2e2e', backgroundColor:'#ff2e2e', borderWidth:4
    });
  }

  priceChartObj = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode:'nearest', intersect:false },
      plugins: {
        legend: { position:'top', labels:{ color:'#aaa', font:{size:10}, boxWidth:10, padding:8 } },
        tooltip: {
          backgroundColor:'#1a232d',
          callbacks: {
            title: (items) => {
              if (!items.length) return '';
              const d = new Date(items[0].parsed.x + 9*3600*1000);
              return d.toISOString().slice(0,16).replace('T',' ') + ' KST';
            },
            label: (item) => item.dataset.label === '계좌 청산'
              ? `🔴 계좌 청산 (자본금 $0 소진) · ${item.parsed.y.toFixed(2)}`
              : `${item.dataset.label}: ${item.parsed.y.toFixed(2)}`
          }
        }
      },
      scales: {
        x: {
          type:'time', time:{ unit:'day', displayFormats:{ day:'MM-DD' }}, adapters:{ date:{} },
          grid:{ color:'rgba(255,255,255,0.04)' }, ticks:{ color:'#666', font:{size:10} }
        },
        y: {
          grid:{ color:'rgba(255,255,255,0.04)' }, ticks:{ color:'#666', font:{size:10} }
        }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  바스켓 테이블
// ══════════════════════════════════════════════════════════════
function renderBasketTable(baskets) {
  const tb = document.getElementById('basketTbody');
  if (!baskets.length) {
    tb.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:30px;color:var(--text-muted);">완료된 바스켓이 없습니다</td></tr>';
    return;
  }
  // 최근 200개만
  const show = baskets.slice(-200).reverse();
  tb.innerHTML = show.map(b => {
    const reasonBadge = {
      TP: '<span class="badge tp">TP</span>',
      SL: '<span class="badge sl">SL</span>',
      DDL: '<span class="badge ddl">DDL</span>',
      EOT: '<span class="badge eod">EOT</span>'
    }[b.reason] || b.reason;
    const dirBadge = b.direction === 'buy' ? '<span class="badge buy">BUY</span>' : '<span class="badge sell">SELL</span>';
    return `
      <tr>
        <td>${b.idx}</td>
        <td>${dirBadge}</td>
        <td>${formatKstShort(b.entryTs)}</td>
        <td>${formatKstShort(b.exitTs)}</td>
        <td>${b.positions}</td>
        <td>${b.totalLot}</td>
        <td>${b.avgPrice}</td>
        <td>${b.exitPrice}</td>
        <td class="${b.pnl>=0?'g':'r'}">${b.pnl>=0?'+':''}${b.pnl}</td>
        <td class="w">$${b.balance}</td>
        <td>${reasonBadge}</td>
        <td><button class="drill-btn" onclick="showDrill(${b.idx-1})">상세</button></td>
      </tr>
    `;
  }).join('');
}

function showDrill(idx) {
  const r = LAST_BACKTEST?.result || LAST_COMPARE?.find(c => c.id === 'base')?.result;
  if (!r || !r.baskets[idx]) return;
  const b = r.baskets[idx];
  switchTab('drill');
  document.getElementById('drillContent').innerHTML = `
    <h3 style="font-size:13px;margin:0 0 10px;color:#f5c400;">바스켓 #${b.idx} 상세</h3>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:14px;line-height:1.7;">
      <b>방향</b>: ${b.direction.toUpperCase()} ·
      <b>진입</b>: ${formatKstShort(b.entryTs)} ·
      <b>청산</b>: ${formatKstShort(b.exitTs)} ·
      <b>사유</b>: ${b.reason}<br>
      <b>총 포지션</b>: ${b.positions} · <b>누적 랏</b>: ${b.totalLot} ·
      <b>평균단가</b>: ${b.avgPrice} · <b>청산가</b>: ${b.exitPrice}<br>
      <b>손익</b>: ${b.pnl>=0?'+':''}$${b.pnl} → <b>잔고</b>: $${b.balance}
    </div>
    <table class="bt-tbl">
      <thead>
        <tr><th>#</th><th>진입시각(KST)</th><th>진입가</th><th>랏</th><th>개별손익</th></tr>
      </thead>
      <tbody>
        ${b.positionsDetail.map(p => `
          <tr>
            <td>${p.order}</td>
            <td>${formatKstShort(p.ts)}</td>
            <td>${p.entry}</td>
            <td>${p.lot}</td>
            <td class="${p.pnl>=0?'g':'r'}">${p.pnl>=0?'+':''}${p.pnl}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// 글로벌 노출
window.runBacktest = runBacktest;
window.runCaseCompare = runCaseCompare;
window.fetchCandles = fetchCandles;
window.setDateRange = setDateRange;
window.ptoggle = ptoggle;
window.switchTab = switchTab;
window.showDrill = showDrill;
window.onSourceChange = onSourceChange;
