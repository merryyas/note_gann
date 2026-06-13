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

// ── 데이터 소스 변경 ─────────────────────────────────────
function onSourceChange() {
  const src = document.getElementById('paramSource').value;
  document.getElementById('apiKeyRow').style.display = (src === 'twelvedata') ? '' : 'none';
  document.getElementById('csvUploadRow').style.display = (src === 'upload') ? '' : 'none';
}

// ── 요일 토글 ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.wd-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('on'));
  });
  // 기본: 올해(YTD)
  setDateRange('ytd');
  onSourceChange();

  // 저장된 API 키 로드
  const savedKey = localStorage.getItem('td_api_key');
  if (savedKey) document.getElementById('paramApiKey').value = savedKey;
  document.getElementById('paramApiKey').addEventListener('change', (e) => {
    localStorage.setItem('td_api_key', e.target.value.trim());
  });

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
    apiKey = document.getElementById('paramApiKey').value.trim();
    if (!apiKey) {
      setDataStatus('Twelve Data API 키를 입력하세요 (twelvedata.com 무료)', 'err');
      return;
    }
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

  // ── Twelve Data: 청크 분할 + 클라이언트 페이싱 ───────────────
  btn.disabled = true;
  _fetchAbort = false;
  setDataStatus('<i class="fas fa-spinner fa-spin"></i> 청크 계획 수립 중…', 'warn');

  try {
    // 1) plan 호출
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

    // 2) 예상 시간 안내 (Twelve Data 분당 8회 제한 → 청크 사이 8초 대기)
    const INTERVAL_MS = 8000;            // 청크 간 대기
    const PER_CALL_SEC = 12;             // 호출 자체 + 대기 = 약 12초 예상
    const etaSec = chunks.length * PER_CALL_SEC;

    if (chunks.length > 5) {
      const ok = confirm(
        `⚠️ ${chunks.length}개 청크로 분할 다운로드합니다.\n` +
        `Twelve Data 무료 플랜(분당 8회) 제한으로 청크 사이 8초 대기합니다.\n` +
        `예상 소요 시간: ${fmtETA(etaSec)}\n\n` +
        `진행하시겠습니까?\n(중간에 [중단] 버튼으로 멈춰도 받은 데이터는 보존됩니다)`
      );
      if (!ok) { setDataStatus('취소되었습니다', 'warn'); btn.disabled = false; return; }
    }

    // 3) 청크별 반복 호출
    let totalInserted = 0;
    let failed = 0;
    const startedAt = Date.now();

    for (let i = 0; i < chunks.length; i++) {
      if (_fetchAbort) {
        setDataStatus(`⏸️ 중단됨 · ${i}/${chunks.length}청크 완료 · 누적 ${totalInserted.toLocaleString()}봉`, 'warn');
        break;
      }

      const ck = chunks[i];
      const elapsed = (Date.now() - startedAt) / 1000;
      const remain = Math.max(0, (chunks.length - i) * PER_CALL_SEC - 0);
      const pct = Math.round((i / chunks.length) * 100);
      setDataStatus(
        `<div style="display:flex;flex-direction:column;gap:6px">
          <div><i class="fas fa-spinner fa-spin"></i> ${i+1}/${chunks.length} 청크 다운로드 중 · 남은 시간 ${fmtETA(remain)}</div>
          <div style="background:rgba(255,255,255,0.1);border-radius:4px;height:6px;overflow:hidden">
            <div style="background:linear-gradient(90deg,#fbbf24,#f59e0b);height:100%;width:${pct}%;transition:width .3s"></div>
          </div>
          <div style="font-size:11px;opacity:.7">누적 ${totalInserted.toLocaleString()}봉 · 실패 ${failed} · <button onclick="abortFetch()" style="background:none;border:1px solid rgba(255,255,255,.2);color:#fca5a5;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:11px">중단</button></div>
        </div>`,
        'warn'
      );

      try {
        const res = await fetch('/api/candles/fetch', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            source: 'twelvedata',
            apiKey,
            symbol: 'XAUUSD',
            timeframe: tf,
            from: ck.from,
            to: ck.to
          })
        });
        const json = await res.json();
        if (!json.ok) {
          failed++;
          console.warn(`청크 ${i+1} 실패:`, json.error);
        } else {
          totalInserted += (json.inserted || 0);
        }
      } catch (e) {
        failed++;
        console.warn(`청크 ${i+1} 네트워크 실패:`, e);
      }

      // 마지막 청크가 아니면 대기 (분당 8회 제한)
      if (i < chunks.length - 1 && !_fetchAbort) {
        await new Promise(r => setTimeout(r, INTERVAL_MS));
      }
    }

    // 4) 캐시에서 다시 로드
    await checkExistingData();
    if (!_fetchAbort) {
      const cnt = CANDLES.length.toLocaleString();
      if (failed > 0) {
        setDataStatus(`⚠️ 완료 · ${totalInserted.toLocaleString()}봉 저장 · 실패 ${failed}청크 · 로드 ${cnt}봉`, 'warn');
      } else {
        setDataStatus(`✅ 완료 · ${totalInserted.toLocaleString()}봉 저장 · 로드 ${cnt}봉`, 'ok');
      }
    }
  } catch (e) {
    setDataStatus('❌ ' + (e.message || e), 'err');
  } finally {
    btn.disabled = false;
    _fetchAbort = false;
  }
}

// ── CSV 업로드 처리 ────────────────────────────────────────
async function handleCsvUpload(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  setDataStatus('<i class="fas fa-spinner fa-spin"></i> CSV 파싱 중...', 'warn');
  try {
    const text = await file.text();
    const lines = text.trim().split(/\r?\n/);
    const candles = [];
    let header = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      // 첫 줄이 텍스트 헤더면 건너뜀
      if (i === 0 && /[a-zA-Z]/.test(line.replace(/[,;:\-T\s]/g,''))) {
        header = line.toLowerCase();
        continue;
      }
      // 구분자 자동 감지
      const sep = line.includes('\t') ? '\t' : (line.includes(';') ? ';' : ',');
      const cols = line.split(sep);
      if (cols.length < 5) continue;
      // 시각, O, H, L, C, [V]
      // 시각은 epoch sec 또는 'YYYY-MM-DD HH:mm:ss' 또는 'YYYY.MM.DD HH:mm' 지원
      let ts;
      const rawTs = cols[0].trim().replace(/"/g,'');
      if (/^\d{10,}$/.test(rawTs)) {
        ts = parseInt(rawTs); if (ts > 1e12) ts = Math.floor(ts/1000); // ms→sec
      } else {
        // 'YYYY.MM.DD HH:mm' → 'YYYY-MM-DD HH:mm'
        const norm = rawTs.replace(/\./g,'-').replace(' ','T');
        ts = Math.floor(Date.parse(norm + (norm.includes('T') ? '' : 'T00:00:00') + 'Z') / 1000);
      }
      const o = parseFloat(cols[1]), h = parseFloat(cols[2]), l = parseFloat(cols[3]), c = parseFloat(cols[4]);
      const v = cols[5] ? parseFloat(cols[5]) : 0;
      if (!isNaN(ts) && !isNaN(o)) candles.push({ ts, o, h, l, c, v });
    }
    if (!candles.length) { setDataStatus('❌ CSV 파싱 실패 — 유효한 캔들 없음', 'err'); return; }

    const tf = document.getElementById('paramTimeframe').value;
    const res = await fetch('/api/candles/upload', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ symbol:'XAUUSD', timeframe: tf, candles })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'upload 실패');
    await checkExistingData();
    setDataStatus(`✅ CSV ${json.inserted.toLocaleString()}봉 업로드 완료`, 'ok');
  } catch (e) {
    setDataStatus('❌ ' + (e.message || e), 'err');
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
    brokerTz    : parseInt(document.getElementById('paramBrokerTz').value) || 0,
    // EA 메타
    magic       : parseInt(document.getElementById('paramMagic').value) || 234568,
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

// UTC epoch sec + broker TZ → KST Date 객체
function toKST(utcSec, brokerTz) {
  // 봉 시각이 브로커TZ 기준으로 표현된 UTC라면, KST(UTC+9)로 보려면 +9-brokerTz
  // 우리 봉 ts는 항상 UTC epoch이므로 그냥 +9시간 더하면 KST가 됨
  // brokerTz는 거래내역과의 정합성 위한 보정(시각 라벨링 차원)
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
    const pnl = stats.pnl;
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
    // 가용잔고 = balance + unrealizedPnl
    const equity = balance + unrealizedPnl;
    if (equity <= 0 || equity < startingBalance * 0.05) {
      liquidated = true;
      liquidationInfo = { ts, equity:+equity.toFixed(2), reason: '계좌 청산 (가용잔고 ≤ 5%)' };
      return true;
    }
    return false;
  }

  function dayKey(kst) {
    return kst.toISOString().slice(0,10);
  }

  // 1분봉 순회
  for (let i = 0; i < candles.length; i++) {
    const k = candles[i];
    const ts = k.ts;
    const kst = toKST(ts, p.brokerTz);
    const dKey = dayKey(kst);

    // 일별 리셋
    if (dKey !== currentDay) {
      currentDay = dKey;
      dailyPnl = 0;
      dailyStopped = false;
    }

    // 봉 내부 가격 경로 시뮬레이션
    const pricesInBar = PATH.map(key => k[key]);

    for (let pi = 0; pi < pricesInBar.length; pi++) {
      const price = pricesInBar[pi];
      if (isNaN(price) || price <= 0) continue;

      // 통합 TP/SL 체크 (이미 진입한 바스켓)
      const stB = basketStats(buyPos,  price);
      const stS = basketStats(sellPos, price);
      const tpDollarBuy  = stB.totalLot * p.tpPoints  * CONTRACT.pointSize * CONTRACT.contractSize;
      const tpDollarSell = stS.totalLot * p.tpPoints  * CONTRACT.pointSize * CONTRACT.contractSize;

      // 통합 TP
      if (p.useBasketTp) {
        if (buyPos.length  && stB.pnl >= tpDollarBuy)  closeBasket('buy',  price, ts, 'TP');
        if (sellPos.length && stS.pnl >= tpDollarSell) closeBasket('sell', price, ts, 'TP');
      }
      // 통합 SL
      if (p.slUsd > 0) {
        if (buyPos.length  && stB.pnl <= -p.slUsd) closeBasket('buy',  price, ts, 'SL');
        if (sellPos.length && stS.pnl <= -p.slUsd) closeBasket('sell', price, ts, 'SL');
      }
      // 일일 최대 손실
      if (p.dailyMaxLoss > 0 && !dailyStopped) {
        const stBNow = basketStats(buyPos,  price);
        const stSNow = basketStats(sellPos, price);
        const unrl = stBNow.pnl + stSNow.pnl;
        if (dailyPnl + unrl <= -p.dailyMaxLoss) {
          if (buyPos.length)  closeBasket('buy',  price, ts, 'DDL');
          if (sellPos.length) closeBasket('sell', price, ts, 'DDL');
          dailyStopped = true;
        }
      }

      // 청산 체크
      const unr = basketStats(buyPos, price).pnl + basketStats(sellPos, price).pnl;
      if (checkLiquidation(ts, unr)) break;

      // 추가진입 트리거 체크
      if (buyPos.length && buyTrigger !== null && price <= buyTrigger && buyPos.length < p.maxOrders) {
        const lastPos = buyPos[buyPos.length - 1];
        const newLot  = +(lastPos.lot * p.lotMult).toFixed(2);
        buyPos.push({ entry: price, lot: newLot, ts });
        trades.push({ ts, direction:'buy', price, lot:newLot, type:'add' });
        buyTrigger = price - p.interval * CONTRACT.pointSize;
      }
      if (sellPos.length && sellTrigger !== null && price >= sellTrigger && sellPos.length < p.maxOrders) {
        const lastPos = sellPos[sellPos.length - 1];
        const newLot  = +(lastPos.lot * p.lotMult).toFixed(2);
        sellPos.push({ entry: price, lot: newLot, ts });
        trades.push({ ts, direction:'sell', price, lot:newLot, type:'add' });
        sellTrigger = price + p.interval * CONTRACT.pointSize;
      }
    }

    if (liquidated) break;
    if (dailyStopped) {
      // 잔고 기록만
      equityCurve.push({ ts, balance:+balance.toFixed(2), equity:+balance.toFixed(2) });
      continue;
    }

    // 봉 시가에서 신규 진입 (이미 진입중이면 skip)
    const entryPrice = k.o;
    const canEnter = !dailyStopped
      && ts >= cooldownUntil
      && inSession(kst, p);

    if (canEnter) {
      if (p.allowBuy && buyPos.length === 0) {
        buyPos.push({ entry: entryPrice, lot: curBuyLot, ts });
        trades.push({ ts, direction:'buy', price: entryPrice, lot: curBuyLot, type:'open' });
        buyTrigger = entryPrice - p.interval * CONTRACT.pointSize;
      }
      if (p.allowSell && sellPos.length === 0) {
        sellPos.push({ entry: entryPrice, lot: curSellLot, ts });
        trades.push({ ts, direction:'sell', price: entryPrice, lot: curSellLot, type:'open' });
        sellTrigger = entryPrice + p.interval * CONTRACT.pointSize;
      }
    }

    // 잔고/MDD 기록 (봉 종가 기준)
    const finalPrice = k.c;
    const finalUnrl = basketStats(buyPos, finalPrice).pnl + basketStats(sellPos, finalPrice).pnl;
    const eq = balance + finalUnrl;
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
    if (ddPct > maxDDPct) maxDDPct = ddPct;

    // 잔고 곡선 (1분봉이면 매우 많아짐 → 다운샘플)
    const downsample = candles.length > 5000 ? Math.ceil(candles.length / 3000) : 1;
    if (i % downsample === 0 || i === candles.length - 1) {
      equityCurve.push({ ts, balance: +balance.toFixed(2), equity: +eq.toFixed(2) });
    }
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
    · <b>브로커TZ</b>: UTC${p.brokerTz>=0?'+':''}${p.brokerTz}
    · <b>EA</b>: AUTO LOGIC 3 (매직 ${p.magic})
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

  // 가격 차트 + 마커
  renderPriceChart(CANDLES.filter(k => k.ts >= Math.floor(new Date(p.startDate+'T00:00:00Z').getTime()/1000)
                                  && k.ts <= Math.floor(new Date(p.endDate+'T23:59:59Z').getTime()/1000)),
                   r.trades, r.baskets);

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

  // 가격차트 winner 기준
  if (winnerId) {
    const w = results.find(r => r.id === winnerId);
    renderPriceChart(
      CANDLES.filter(k => k.ts >= Math.floor(new Date(baseParams.startDate+'T00:00:00Z').getTime()/1000)
                       && k.ts <= Math.floor(new Date(baseParams.endDate+'T23:59:59Z').getTime()/1000)),
      w.result.trades, w.result.baskets
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

function renderPriceChart(candles, trades, baskets) {
  document.getElementById('priceChartCard').style.display = 'block';
  const ctx = document.getElementById('priceChart').getContext('2d');
  if (priceChartObj) priceChartObj.destroy();

  // 가격(종가) 라인
  const downsample = candles.length > 3000 ? Math.ceil(candles.length / 2000) : 1;
  const priceData = candles.filter((_, i) => i % downsample === 0).map(k => ({ x: k.ts * 1000, y: k.c }));

  // 진입 마커
  const buyOpens  = trades.filter(t => t.direction === 'buy'  && t.type === 'open').map(t => ({ x: t.ts*1000, y: t.price }));
  const buyAdds   = trades.filter(t => t.direction === 'buy'  && t.type === 'add' ).map(t => ({ x: t.ts*1000, y: t.price }));
  const sellOpens = trades.filter(t => t.direction === 'sell' && t.type === 'open').map(t => ({ x: t.ts*1000, y: t.price }));
  const sellAdds  = trades.filter(t => t.direction === 'sell' && t.type === 'add' ).map(t => ({ x: t.ts*1000, y: t.price }));
  const closes    = baskets.map(b => ({ x: b.exitTs*1000, y: b.exitPrice }));

  priceChartObj = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        { label:'XAUUSD 종가', data: priceData, borderColor:'rgba(245,196,0,0.7)', borderWidth:1, pointRadius:0, tension:0 },
        { label:'매수 진입', type:'scatter', data: buyOpens,  pointRadius:5, pointStyle:'triangle', backgroundColor:'#3dd68c', borderColor:'#3dd68c' },
        { label:'매수 추가', type:'scatter', data: buyAdds,   pointRadius:3, pointStyle:'circle', backgroundColor:'rgba(61,214,140,0.5)', borderColor:'#3dd68c' },
        { label:'매도 진입', type:'scatter', data: sellOpens, pointRadius:5, pointStyle:'triangle', rotation:180, backgroundColor:'#f06060', borderColor:'#f06060' },
        { label:'매도 추가', type:'scatter', data: sellAdds,  pointRadius:3, pointStyle:'circle', backgroundColor:'rgba(240,96,96,0.5)', borderColor:'#f06060' },
        { label:'청산',     type:'scatter', data: closes,    pointRadius:5, pointStyle:'crossRot', borderColor:'#f5c400', backgroundColor:'#f5c400', borderWidth:2 }
      ]
    },
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
            label: (item) => `${item.dataset.label}: ${item.parsed.y.toFixed(2)}`
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
