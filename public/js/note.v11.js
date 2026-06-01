/* TradeArchive — Trading Note (MT4 전용, 주차별 일별 집계)
   이미지 컬럼 기준:
   요일(날짜) / 최초 진입(KST) / 최종 마감(KST) / 순수 유지시간
   총 거래 횟수 / 승률 / 일별 최종 손익 / 최대 익절(단일) / 최대 손절(단일) / 최대진입 랏수
*/

/* ── 자본금 localStorage 키 ── */
const CAPITAL_KEY = 'ta_note_capital';

/* ── 엑셀 연동용 모듈 스코프 상태 ── */
let _currentRows      = [];
let _currentWeekLabel = '';
let _currentCapital   = 1000;
let _currentWeekKey   = '';

function getCapital() {
  return parseFloat(localStorage.getItem(CAPITAL_KEY)) || 1000;
}
function saveCapital(v) {
  localStorage.setItem(CAPITAL_KEY, v);
}

/* ══════════════════════════════════════════════════════
   관리자 인증 모듈
   - 세션 내 1회 PIN 확인 → sessionStorage에 캐시
   - PIN은 서버(/api/kv/admin_pin_hash)에 bcrypt 없이
     단순 해시로 저장 (클라이언트 SHA-256)
   ══════════════════════════════════════════════════════ */
const ADMIN_SESSION_KEY = 'ta_admin_unlocked';

function isAdminUnlocked() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
}
function setAdminUnlocked() {
  sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
}

/* PIN을 SHA-256으로 해싱 */
async function hashPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

/* 서버에서 저장된 PIN 해시 조회 */
async function getStoredPinHash() {
  try {
    const res = await fetch('/api/kv/admin_pin_hash');
    const json = await res.json();
    return json.value || null;
  } catch { return null; }
}

/* 서버에 PIN 해시 저장 (최초 설정 시) */
async function savePinHash(hash, token) {
  await fetch('/api/kv/admin_pin_hash', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: hash, token })
  });
}

/* 관리자 모달 열기 — resolve(true/false) */
function openAdminModal() {
  return new Promise(resolve => {
    const modal    = document.getElementById('adminModal');
    const input    = document.getElementById('adminPinInput');
    const errEl    = document.getElementById('adminPinError');
    const confirmBtn = document.getElementById('adminPinConfirm');
    const closeBtn = document.getElementById('adminModalClose');

    modal.style.display = 'flex';
    input.value = '';
    errEl.textContent = '';
    setTimeout(() => input.focus(), 100);

    const cleanup = (result) => {
      modal.style.display = 'none';
      confirmBtn.removeEventListener('click', onConfirm);
      closeBtn.removeEventListener('click', onClose);
      input.removeEventListener('keydown', onKey);
      resolve(result);
    };

    const onConfirm = async () => {
      const pin = input.value.trim();
      if (!pin) { errEl.textContent = 'PIN을 입력해주세요.'; return; }

      confirmBtn.disabled = true;
      confirmBtn.textContent = '확인 중...';

      try {
        const storedHash = await getStoredPinHash();
        const enteredHash = await hashPin(pin);

        if (!storedHash) {
          // 최초 설정: 입력한 PIN이 새 PIN이 됨
          await savePinHash(enteredHash, enteredHash); // 자기 자신을 토큰으로 사용
          setAdminUnlocked();
          cleanup(true);
          showToast('✅ 관리자 PIN이 설정되었습니다', 'success', 3000);
        } else if (enteredHash === storedHash) {
          setAdminUnlocked();
          cleanup(true);
        } else {
          errEl.textContent = 'PIN이 올바르지 않습니다.';
          input.value = '';
          input.focus();
        }
      } catch(e) {
        errEl.textContent = '오류가 발생했습니다. 다시 시도해주세요.';
      }
      confirmBtn.disabled = false;
      confirmBtn.textContent = '확인';
    };

    const onClose = () => cleanup(false);
    const onKey   = (e) => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onClose(); };

    confirmBtn.addEventListener('click', onConfirm);
    closeBtn.addEventListener('click', onClose);
    input.addEventListener('keydown', onKey);
  });
}

/* 관리자 권한 요구 — 이미 인증됐으면 바로 통과 */
async function requireAdmin() {
  if (isAdminUnlocked()) return true;
  return await openAdminModal();
}

document.addEventListener('DOMContentLoaded', async () => {
  const all    = await DB.getAll('trades');
  const mt4    = all.filter(t => (t.platform || '').toUpperCase() === 'MT4');
  const select = document.getElementById('weekSelect');
  const badge  = document.getElementById('weekBadge');
  const content= document.getElementById('noteContent');

  /* ── 잠금 아이콘 초기 상태 ── */
  function updateLockIcon() {
    const icon = document.getElementById('capitalLockIcon');
    if (!icon) return;
    if (isAdminUnlocked()) {
      icon.className = 'fas fa-lock-open';
      icon.style.color = '#2e7d32';
    } else {
      icon.className = 'fas fa-lock';
      icon.style.color = '';
    }
  }
  updateLockIcon();

  /* ── 자본금 편집 UI ── */
  const capitalDisplay   = document.getElementById('capitalDisplay');
  const capitalInput     = document.getElementById('capitalInput');
  const capitalEditBtn   = document.getElementById('capitalEditBtn');
  const capitalSaveBtn   = document.getElementById('capitalSaveBtn');
  const capitalCancelBtn = document.getElementById('capitalCancelBtn');

  // 저장된 자본금 불러오기
  // — localStorage에 수동 저장값이 없으면 upload_history의 MT4 initial_balance 사용
  let capital = getCapital();
  if (capital === 1000) { // 기본값 그대로면 history에서 시도
    const history = await DB.getAll('upload_history');
    const mt4History = history.filter(h => (h.platform || '').toUpperCase() === 'MT4' && h.initial_balance);
    if (mt4History.length > 0) {
      // 가장 오래된 MT4 업로드의 initial_balance (초기 자본금)
      mt4History.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
      const detected = parseFloat(mt4History[0].initial_balance);
      if (!isNaN(detected) && detected > 0) {
        capital = detected;
        saveCapital(capital);
      }
    }
  }
  capitalDisplay.textContent = '$' + capital.toLocaleString();
  capitalInput.value = capital;

  // 자본금 수정 버튼 — 관리자 인증 필요
  capitalEditBtn.addEventListener('click', async () => {
    const ok = await requireAdmin();
    if (!ok) return;
    updateLockIcon();
    capitalDisplay.style.display   = 'none';
    capitalInput.style.display     = 'block';
    capitalSaveBtn.style.display   = 'block';
    capitalCancelBtn.style.display = 'block';
    capitalEditBtn.style.display   = 'none';
    capitalInput.focus();
    capitalInput.select();
  });

  const exitEdit = () => {
    capitalDisplay.style.display   = 'block';
    capitalInput.style.display     = 'none';
    capitalSaveBtn.style.display   = 'none';
    capitalCancelBtn.style.display = 'none';
    capitalEditBtn.style.display   = 'block';
  };

  capitalSaveBtn.addEventListener('click', () => {
    const v = parseFloat(capitalInput.value);
    if (!v || v <= 0) { alert('올바른 자본금을 입력해주세요.'); return; }
    capital = v;
    saveCapital(capital);
    capitalDisplay.textContent = '$' + capital.toLocaleString();
    exitEdit();
    // 현재 선택된 주차 재렌더링
    if (select.value) renderWeek(select.value, weekMap, badge, content, capital);
  });
  // 자본금 변경 시 모듈 스코프 capital도 동기화
  // (renderWeek 내부에서 _currentCapital 업데이트되므로 재렌더 후 자동 동기화됨)

  capitalCancelBtn.addEventListener('click', () => {
    capitalInput.value = capital;
    exitEdit();
  });

  capitalInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  capitalSaveBtn.click();
    if (e.key === 'Escape') capitalCancelBtn.click();
  });

  if (mt4.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-book-open"></i>
        <h3>아직 데이터가 없습니다</h3>
        <p>MT4 거래 데이터를 <a href="admin.html">관리자 패널</a>에서 업로드하면<br>주차별 노트가 자동으로 생성됩니다.</p>
      </div>`;
    return;
  }

  /* ── 주차 목록 생성 ── */
  const weekMap = buildWeekMap(mt4);
  const weekKeys = Object.keys(weekMap).sort().reverse(); // 최신 주차 먼저

  if (weekKeys.length === 0) {
    content.innerHTML = `<div class="empty-state"><i class="fas fa-calendar"></i><h3>주차 데이터를 생성할 수 없습니다</h3></div>`;
    return;
  }

  /* 드롭다운 옵션 채우기 */
  weekKeys.forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = weekMap[key].label;
    select.appendChild(opt);
  });

  /* 최신 주차 기본 선택 */
  select.value = weekKeys[0];
  renderWeek(weekKeys[0], weekMap, badge, content, capital);

  select.addEventListener('change', () => {
    if (!select.value) { content.innerHTML = ''; badge.style.display = 'none'; return; }
    renderWeek(select.value, weekMap, badge, content, capital);
  });

  /* ── 엑셀 다운로드 버튼 연동 ── */
  const excelBtn = document.getElementById('noteExcelBtn');
  if (excelBtn) {
    // 주차 선택되면 활성화
    excelBtn.disabled = false;
    excelBtn.style.opacity = '1';
    excelBtn.title = '현재 주차 엑셀 다운로드';
    excelBtn.addEventListener('click', () => {
      if (!_currentRows.length) {
        alert('다운로드할 데이터가 없습니다. 주차를 먼저 선택해주세요.');
        return;
      }
      excelExport.note(_currentRows, _currentWeekLabel, _currentCapital, _currentWeekKey);
    });

    // 주차 변경 시 비활성 처리
    select.addEventListener('change', () => {
      if (!select.value) {
        excelBtn.disabled = true;
        excelBtn.style.opacity = '.45';
        excelBtn.title = '주차를 선택하면 활성화됩니다';
      } else {
        excelBtn.disabled = false;
        excelBtn.style.opacity = '1';
        excelBtn.title = '현재 주차 엑셀 다운로드';
      }
    });
  }
});

/* ── 주차별 Map 생성 ── */
function buildWeekMap(trades) {
  const map = {};

  trades.forEach(t => {
    if (!t.close_time) return;
    const d = parseWallClock(t.close_time);
    if (!d) return;

    // ISO 주차 키 생성 (월요일 기준)
    const date   = new Date(Date.UTC(d.y, d.mo - 1, d.d));
    const monday = getMondayUTC(date);
    const key    = monday.toISOString().slice(0, 10); // "YYYY-MM-DD" (월요일 날짜)

    if (!map[key]) {
      map[key] = {
        label:   makeWeekLabel(monday),
        monday:  monday,
        trades:  []
      };
    }
    map[key].trades.push(t);
  });

  return map;
}

/* ── 월요일 구하기 (UTC) ── */
function getMondayUTC(date) {
  const d   = new Date(date);
  const day = d.getUTCDay(); // 0=일, 1=월
  const diff = (day === 0) ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

/* ── "5월 4주" 형식 라벨 ──
   기준: 그 주의 수요일(월요일+2일)이 속한 달 + 그 달의 몇 번째 수요일
   2026년 예시)
     5/26(화)이 속한 주 → 월요일=5/25, 수요일=5/27
     5월 첫 번째 수요일=5/6, (27-6)/7+1 = 4 → 5월 4주 ✅
     5/5(화)이 속한 주  → 월요일=5/4,  수요일=5/6
     (6-6)/7+1 = 1 → 5월 1주 ✅
   수요일이 달에 포함되어야 그 달 주차로 인정하는 규칙과 일치
*/
function makeWeekLabel(monday) {
  // 그 주의 수요일 (월요일 + 2)
  const wed = new Date(monday);
  wed.setUTCDate(wed.getUTCDate() + 2);

  const year    = wed.getUTCFullYear();
  const month   = wed.getUTCMonth(); // 0-based
  const wedDate = wed.getUTCDate();

  // 해당 달 1일의 요일 (0=일, 3=수)
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  // 그 달의 첫 번째 수요일 날짜
  const firstWed = 1 + ((3 - firstDow + 7) % 7);
  // 주차 = (수요일 날짜 - 첫번째 수요일) / 7 + 1
  const weekNum = Math.floor((wedDate - firstWed) / 7) + 1;

  return `${month + 1}월 ${weekNum}주`;
}

/* ── 주차 렌더링 ── */
async function renderWeek(key, weekMap, badge, content, capital) {
  const entry  = weekMap[key];
  const trades = entry.trades;

  /* 모듈 스코프 상태 업데이트 (엑셀 버튼용) */
  _currentWeekLabel = entry.label;
  _currentCapital   = capital;
  _currentWeekKey   = key;

  badge.textContent = entry.label;
  badge.style.display = 'inline-block';

  /* 날짜별 그룹 */
  const dayMap = {};
  trades.forEach(t => {
    const w = parseWallClock(t.close_time);
    if (!w) return;
    // KST 변환 (+6h)
    const ms  = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) + 6 * 3600000;
    const kst = new Date(ms);
    const dateKey = kst.getUTCFullYear() + '-'
      + String(kst.getUTCMonth() + 1).padStart(2, '0') + '-'
      + String(kst.getUTCDate()).padStart(2, '0');
    if (!dayMap[dateKey]) dayMap[dateKey] = [];
    dayMap[dateKey].push({ ...t, _kstClose: kst });
  });

  /* open_time도 KST로 변환 */
  trades.forEach(t => {
    if (!t.open_time) return;
    const w = parseWallClock(t.open_time);
    if (!w) return;
    const ms  = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) + 6 * 3600000;
    const kst = new Date(ms);
    const dateKey = kst.getUTCFullYear() + '-'
      + String(kst.getUTCMonth() + 1).padStart(2, '0') + '-'
      + String(kst.getUTCDate()).padStart(2, '0');
    // open 날짜 기준으로 _kstOpen 추가
    if (dayMap[dateKey]) {
      dayMap[dateKey].forEach(row => {
        if (row.id === t.id) row._kstOpen = kst;
      });
    }
  });

  const dayKeys = Object.keys(dayMap).sort();

  /* 일별 행 계산 */
  const rows = dayKeys.map(dk => {
    const dayTrades = dayMap[dk];
    return calcDayRow(dk, dayTrades);
  });
  _currentRows = rows; // 리프레시 시 모듈 스코프 동기화

  /* 주간 요약 */
  const totalPnl    = rows.reduce((a, r) => a + r.pnl, 0);
  const totalTrades = rows.reduce((a, r) => a + r.count, 0);
  const totalWins   = rows.reduce((a, r) => a + r.wins, 0);
  const weekWinRate = totalTrades > 0 ? (totalWins / totalTrades * 100) : 0;
  const weekReturn  = (totalPnl / capital * 100);

  /* 누적 수익금: 전체 MT4 거래 합산 */
  const allMt4 = (await DB.getAll('trades')).filter(t => (t.platform || '').toUpperCase() === 'MT4');
  const accumPnl = allMt4.reduce((a, t) => a + (parseFloat(t.profit) || 0), 0);

  /* HTML 조립 */
  content.innerHTML = `
    <!-- 주간 KPI 요약 -->
    <div class="note-card" style="margin-bottom:20px;">
      <div class="note-card-header">
        <i class="fas fa-star note-card-icon"></i>
        <span class="note-card-title">${entry.label} · 주간 요약</span>
      </div>
      <div class="summary-grid">
        <div class="summary-item">
          <div class="summary-label">자본금</div>
          <div class="summary-val">$${capital.toLocaleString()}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">주간 수익금</div>
          <div class="summary-val ${totalPnl >= 0 ? 'pos' : 'neg'}">
            ${totalPnl >= 0 ? '+' : ''}$${Math.abs(totalPnl).toFixed(2)}
          </div>
        </div>
        <div class="summary-item">
          <div class="summary-label">누적 수익금</div>
          <div class="summary-val" style="color:#d96c00 !important;">
            ${accumPnl >= 0 ? '+' : ''}$${Math.abs(accumPnl).toFixed(2)}
          </div>
        </div>
        <div class="summary-item">
          <div class="summary-label">주간 수익률</div>
          <div class="summary-val ${weekReturn >= 0 ? 'yellow' : 'neg'}">
            ${weekReturn >= 0 ? '+' : ''}${weekReturn.toFixed(1)}%
          </div>
        </div>
        <div class="summary-item">
          <div class="summary-label">총 거래 횟수</div>
          <div class="summary-val">${totalTrades}회</div>
        </div>
      </div>
    </div>

    <!-- 일별 상세 테이블 -->
    <div class="note-card">
      <div class="note-card-header">
        <i class="fas fa-table note-card-icon"></i>
        <span class="note-card-title">일별 상세 기록</span>
        <span style="margin-left:auto;font-size:11px;color:var(--text-muted);">시각 KST 기준</span>
      </div>
      <div class="note-table-wrap">
        <table class="note-table">
          <thead>
            <tr>
              <th>요일 (날짜)</th>
              <th>최초 진입 (KST)</th>
              <th>최종 마감 (KST)</th>
              <th>순수 유지시간</th>
              <th>총 거래 횟수</th>
              <th>승률</th>
              <th>일별 최종 손익</th>
              <th>최대 익절(단일)</th>
              <th>최대 손절(단일)</th>
              <th>최대진입 랏수</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => renderDayRow(r)).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- 매매 복기 코멘트 -->
    <div class="comment-card">
      <div class="comment-card-header">
        <i class="fas fa-pen-to-square comment-card-icon"></i>
        <span class="comment-card-title">매매 복기 코멘트</span>
        <span class="comment-card-meta">클릭하여 편집 · 자동 저장</span>
      </div>
      <div class="comment-display empty" id="commentDisplay">클릭하여 이번 주 매매 복기를 작성하세요...</div>
      <textarea class="comment-textarea" id="commentTextarea" placeholder="이번 주 매매를 복기하세요.&#10;&#10;예) 진입 타이밍, 손절/익절 관리, 개선할 점, 다음 주 전략 등"></textarea>
      <div class="comment-actions" id="commentActions">
        <span class="comment-saved-hint" id="commentSavedHint"><i class="fas fa-check"></i> 저장됨</span>
        <button class="comment-btn cancel" id="commentCancelBtn">취소</button>
        <button class="comment-btn save" id="commentSaveBtn"><i class="fas fa-floppy-disk"></i> 저장</button>
      </div>
    </div>
  `;

  /* ── 코멘트 초기화 ── */
  initComment(key);
}

/* ── 코멘트 localStorage 키 ── */
function commentKey(weekKey) {
  return `ta_note_comment_${weekKey}`;
}

/* ── 코멘트 초기화 & 이벤트 바인딩 ── */
function initComment(weekKey) {
  const display   = document.getElementById('commentDisplay');
  const textarea  = document.getElementById('commentTextarea');
  const actions   = document.getElementById('commentActions');
  const saveBtn   = document.getElementById('commentSaveBtn');
  const cancelBtn = document.getElementById('commentCancelBtn');
  const savedHint = document.getElementById('commentSavedHint');
  if (!display || !textarea) return;

  /* 저장된 코멘트 불러오기 */
  const saved = localStorage.getItem(commentKey(weekKey)) || '';
  renderComment(display, saved);

  /* 표시 영역 클릭 → 관리자 인증 후 편집 모드 진입 */
  display.addEventListener('click', async () => {
    const ok = await requireAdmin();
    if (!ok) return;
    // 잠금 아이콘 갱신
    const lockIcon = document.getElementById('capitalLockIcon');
    if (lockIcon && isAdminUnlocked()) { lockIcon.className = 'fas fa-lock-open'; lockIcon.style.color = '#2e7d32'; }
    textarea.value = localStorage.getItem(commentKey(weekKey)) || '';
    display.style.display  = 'none';
    textarea.style.display = 'block';
    actions.style.display  = 'flex';
    savedHint.style.display = 'none';
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  });

  /* 저장 */
  saveBtn.addEventListener('click', () => {
    const val = textarea.value.trim();
    localStorage.setItem(commentKey(weekKey), val);
    renderComment(display, val);
    textarea.style.display = 'none';
    actions.style.display  = 'none';
    display.style.display  = 'block';
    // 저장 힌트 잠깐 표시
    savedHint.style.display = 'inline-flex';
    setTimeout(() => { savedHint.style.display = 'none'; }, 2000);
  });

  /* 취소 */
  cancelBtn.addEventListener('click', () => {
    textarea.style.display = 'none';
    actions.style.display  = 'none';
    display.style.display  = 'block';
  });

  /* Ctrl+Enter / Cmd+Enter 로도 저장 */
  textarea.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      saveBtn.click();
    }
    if (e.key === 'Escape') {
      cancelBtn.click();
    }
  });
}

/* ── 코멘트 표시 렌더 ── */
function renderComment(display, text) {
  if (!text) {
    display.textContent = '클릭하여 이번 주 매매 복기를 작성하세요...';
    display.classList.add('empty');
  } else {
    display.textContent = text;
    display.classList.remove('empty');
  }
}

/* ── 일별 계산 ── */
function calcDayRow(dateKey, trades) {
  const profits = trades.map(t => parseFloat(t.profit) || 0);
  const pnl     = profits.reduce((a, b) => a + b, 0);
  const wins    = profits.filter(p => p > 0).length;
  const winRate = trades.length > 0 ? (wins / trades.length * 100) : 0;
  const maxWin  = profits.length > 0 ? Math.max(...profits) : 0;
  const maxLoss = profits.length > 0 ? Math.min(...profits) : 0;
  const maxLot  = trades.reduce((a, t) => Math.max(a, parseFloat(t.lots) || 0), 0);

  // KST 진입/마감 시각: open_time 최솟값, close_time 최댓값
  const opens = trades
    .filter(t => t.open_time)
    .map(t => {
      const w = parseWallClock(t.open_time);
      if (!w) return null;
      return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) + 6 * 3600000;
    }).filter(Boolean);

  const closes = trades
    .filter(t => t.close_time)
    .map(t => {
      const w = parseWallClock(t.close_time);
      if (!w) return null;
      return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) + 6 * 3600000;
    }).filter(Boolean);

  const firstOpen = opens.length > 0 ? new Date(Math.min(...opens)) : null;
  const lastClose = closes.length > 0 ? new Date(Math.max(...closes)) : null;

  // 순수 유지시간: 각 거래의 open~close 구간을 Union 병합 후 합산
  // (EA 꺼진 동안 포지션 없음 → 구간 합산 = 실제 운영 시간)
  const durationMs = calcUnionDuration(trades);
  const durationStr = formatDuration(durationMs);

  // 날짜 → 요일
  const [y, mo, d] = dateKey.split('-').map(Number);
  const dayNames = ['일','월','화','수','목','금','토'];
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const dowStr = dayNames[dow] + '요일';
  const dateStr = `${mo}.${String(d).padStart(2,'0')}`;

  return {
    dateKey, dowStr, dateStr,
    firstOpen, lastClose, durationStr,
    count: trades.length, wins, winRate,
    pnl, maxWin, maxLoss, maxLot
  };
}

/* ── 일별 행 HTML ── */
function renderDayRow(r) {
  const fmtTime = (d) => {
    if (!d) return '<span class="no-trade-day">—</span>';
    return `<span class="time-cell">${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}:${String(d.getUTCSeconds()).padStart(2,'0')}</span>`;
  };

  const pnlCls  = r.pnl > 0 ? 'pos' : r.pnl < 0 ? 'neg' : 'zero';
  const wrCls   = r.winRate >= 50 ? 'good' : 'bad';

  const fmtPnl = (v) => {
    if (v === 0) return '<span class="profit-chip zero">$0.00</span>';
    const cls = v > 0 ? 'pos' : 'neg';
    const sign = v > 0 ? '+' : '';
    return `<span class="profit-chip ${cls}">${sign}$${Math.abs(v).toFixed(2)}</span>`;
  };

  return `
    <tr>
      <td>
        <div class="day-cell">${r.dateStr}</div>
        <div class="day-date">${r.dowStr}</div>
      </td>
      <td>${fmtTime(r.firstOpen)}</td>
      <td>${fmtTime(r.lastClose)}</td>
      <td class="duration-cell">${r.durationStr}</td>
      <td class="trades-cell">${r.count}회</td>
      <td style="color:var(--text-primary);font-weight:600;">${r.winRate.toFixed(2)}%</td>
      <td>${fmtPnl(r.pnl)}</td>
      <td style="color:var(--text-primary);font-weight:600;">+$${r.maxWin.toFixed(2)}</td>
      <td style="color:var(--text-primary);font-weight:600;">-$${Math.abs(r.maxLoss).toFixed(2)}</td>
      <td style="color:var(--blue);font-weight:600;">${r.maxLot.toFixed(2)}</td>
    </tr>`;
}

/* ── Union 구간 병합 후 합산 ── */
function calcUnionDuration(trades) {
  // 각 거래의 [open, close] 구간 수집 (서버 → KST +6h)
  const intervals = [];
  trades.forEach(t => {
    if (!t.open_time || !t.close_time) return;
    const wo = parseWallClock(t.open_time);
    const wc = parseWallClock(t.close_time);
    if (!wo || !wc) return;
    const openMs  = Date.UTC(wo.y, wo.mo - 1, wo.d, wo.h, wo.mi) + 6 * 3600000;
    const closeMs = Date.UTC(wc.y, wc.mo - 1, wc.d, wc.h, wc.mi) + 6 * 3600000;
    if (closeMs > openMs) intervals.push([openMs, closeMs]);
  });

  if (intervals.length === 0) return 0;

  // 시작 기준 정렬
  intervals.sort((a, b) => a[0] - b[0]);

  // 구간 병합 (overlapping merge)
  const merged = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1];
    if (intervals[i][0] <= last[1]) {
      last[1] = Math.max(last[1], intervals[i][1]); // 겹치면 확장
    } else {
      merged.push(intervals[i]); // 안 겹치면 새 구간 추가
    }
  }

  // 병합된 구간 총합
  return merged.reduce((sum, [s, e]) => sum + (e - s), 0);
}

/* ── 시간 포맷 ── */
function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  const totalMin = Math.floor(ms / 60000);
  const h   = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (h === 0) return `${min}분`;
  return `${h}시간 ${min}분`;
}
