/* =============================================
   TradeArchive — Utils v11 (Cloudflare D1 API)
   Genspark Tables API → Cloudflare D1 Worker 전환
   /tables/:table  엔드포인트 (Hono + D1)
   ============================================= */

/* API 베이스: 동일 origin의 /tables/ 경로 사용 */
const DB_BASE = '/tables';

const DB = {

  /* ── 전체 조회 (페이지네이션 자동 합산) ── */
  async getAll(table) {
    try {
      let all = [], page = 1, limit = 500;
      while (true) {
        const res  = await fetch(`${DB_BASE}/${table}?page=${page}&limit=${limit}`);
        if (!res.ok) return all;
        const data = await res.json();
        const rows = data.data || [];
        all = all.concat(rows);
        if (all.length >= data.total || rows.length < limit) break;
        page++;
      }
      return all;
    } catch { return []; }
  },

  /* ── 단건 조회 ── */
  async get(table, id) {
    try {
      const res = await fetch(`${DB_BASE}/${table}/${id}`);
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  },

  /* ── 단건 삽입 ── */
  async insert(table, row) {
    try {
      const res = await fetch(`${DB_BASE}/${table}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(row)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { console.error('DB.insert error', e); return null; }
  },

  /* ── 벌크 삽입 (순차 처리, 진행률 콜백 지원) ── */
  async insertBulk(table, rows, onProgress) {
    const results = [];
    for (let i = 0; i < rows.length; i++) {
      const r = await DB.insert(table, rows[i]);
      if (r) results.push(r);
      if (onProgress) onProgress(i + 1, rows.length);
    }
    return results;
  },

  /* ── 단건 수정 ── */
  async update(table, id, data) {
    try {
      const res = await fetch(`${DB_BASE}/${table}/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data)
      });
      if (!res.ok) throw new Error('update failed');
      return await res.json();
    } catch (e) { console.error('DB.update error', e); return null; }
  },

  /* ── 단건 삭제 ── */
  async delete(table, id) {
    try {
      await fetch(`${DB_BASE}/${table}/${id}`, { method: 'DELETE' });
      return true;
    } catch { return false; }
  },

  /* ── 조건 일괄 삭제 (getAll 후 필터링) ── */
  async deleteWhere(table, predicate) {
    const all = await DB.getAll(table);
    const targets = all.filter(predicate);
    for (const r of targets) {
      await DB.delete(table, r.id);
    }
    return targets.length;
  },

  /* ── 전체 삭제 ── */
  async clear(table) {
    const all = await DB.getAll(table);
    for (const r of all) {
      await DB.delete(table, r.id);
    }
    return all.length;
  }
};

/* ── 중복 티켓 세트 빌드 (admin에서 사용) ── */
async function buildExistingKeySet() {
  const existing = await DB.getAll('trades');
  return new Set(existing.map(t => `${t.ticket}_${t.symbol}_${t.platform}`));
}

window.BUILD_VERSION = '2026-06-01-v11-d1';
console.log('%c334 TRADINGLOG build:', 'color:#f5c400', window.BUILD_VERSION);

// ════════════════════════════════════════════════════════════════
//  서버 KV 스토어 헬퍼 — localStorage 대신 Cloudflare D1 사용
//  모든 영구 데이터는 /api/kv/:key 엔드포인트를 통해 서버에 저장
// ════════════════════════════════════════════════════════════════
const KV = {
  /* 읽기 */
  async get(key) {
    try {
      const res  = await fetch(`/api/kv/${encodeURIComponent(key)}`);
      const json = await res.json();
      return json.ok ? json.value : null;
    } catch { return null; }
  },

  /* 쓰기 (pw_hash: 인증용 해시, 기본 null) */
  async set(key, value, pw_hash = null) {
    try {
      const body = { value: String(value ?? '') };
      if (pw_hash) body.pw_hash = pw_hash;
      const res  = await fetch(`/api/kv/${encodeURIComponent(key)}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body)
      });
      const json = await res.json();
      return json.ok;
    } catch { return false; }
  },
};

// ════════════════════════════════════════════════════════════════
//  SHA-256 해시 유틸
// ════════════════════════════════════════════════════════════════
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ===== 포맷 유틸 =====
const fmt = {
  currency(v) {
    const n = parseFloat(v) || 0;
    const abs = Math.abs(n).toFixed(2);
    return (n < 0 ? '-' : '+') + '$' + parseFloat(abs).toLocaleString('en-US', { minimumFractionDigits: 2 });
  },
  currencyAbs(v) {
    const n = parseFloat(v) || 0;
    return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2 });
  },
  currency1(v) {
    const n = parseFloat(v) || 0;
    const truncated = Math.floor(Math.abs(n) * 10) / 10;
    const abs = truncated.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return (n < 0 ? '-' : '+') + '$' + abs;
  },
  percent(v) { return (parseFloat(v) || 0).toFixed(1) + '%'; },
  number(v, dec = 2) { return (parseFloat(v) || 0).toFixed(dec); },
  lots(v) { return (parseFloat(v) || 0).toFixed(2); },
  pips(v) {
    const n = parseFloat(v);
    if (isNaN(n)) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(1);
  },
  date(v) {
    if (!v) return '—';
    try {
      const d = new Date(v);
      if (isNaN(d)) return String(v).slice(0, 10);
      return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch { return '—'; }
  },
  datetime(v) {
    if (!v) return '—';
    try {
      const d = new Date(typeof v === 'number' ? v : v);
      if (isNaN(d)) return String(v).slice(0, 16);
      return d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })
        + ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch { return '—'; }
  },
  duration(ms) {
    if (!ms || ms < 0) return '—';
    const min = Math.floor(ms / 60000);
    if (min < 60) return min + '분';
    const h = Math.floor(min / 60);
    if (h < 24) return h + '시간 ' + (min % 60) + '분';
    return Math.floor(h / 24) + '일 ' + (h % 24) + '시간';
  },
  datetimeTZ(v, tz = 'server') {
    if (!v) return '—';
    const w = parseWallClock(v);
    if (!w) return String(v).slice(0, 16);
    let offset = 0;
    if      (tz === 'kst') offset = 6;
    else if (tz === 'ny')  offset = nyDST(w.y, w.mo, w.d) ? -7 : -8;
    if (offset === 0) return fmtParts(w.mo, w.d, w.h, w.mi);
    const ms = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) + offset * 3600000;
    const d  = new Date(ms);
    return fmtParts(d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
  }
};

function parseWallClock(v) {
  const m = String(v).match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
}

function nyDST(y, mo, d) {
  const dow1 = (month) => new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
  const marDST = 8  + (7 - dow1(3))  % 7;
  const novDST = 1  + (7 - dow1(11)) % 7;
  if (mo < 3 || mo > 11) return false;
  if (mo > 3 && mo < 11) return true;
  if (mo === 3)  return d >= marDST;
  if (mo === 11) return d <  novDST;
  return false;
}

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtParts(mo, d, h, mi) {
  return `${pad2(mo)}.${pad2(d)} ${pad2(h)}:${pad2(mi)}`;
}

function profitClass(v) {
  const n = parseFloat(v) || 0;
  if (n > 0) return 'pos';
  if (n < 0) return 'neg';
  return '';
}

// ===== 통계 계산 =====
function calcStats(trades) {
  if (!trades || trades.length === 0) return null;
  const profits = trades.map(t => parseFloat(t.profit) || 0);
  const total = profits.reduce((a, b) => a + b, 0);
  const wins   = trades.filter(t => (parseFloat(t.profit) || 0) > 0);
  const losses = trades.filter(t => (parseFloat(t.profit) || 0) < 0);
  const winProfit  = wins.reduce((a, t) => a + (parseFloat(t.profit) || 0), 0);
  const lossProfit = Math.abs(losses.reduce((a, t) => a + (parseFloat(t.profit) || 0), 0));
  const profitFactor = lossProfit > 0 ? winProfit / lossProfit : Infinity;
  const winRate = (wins.length / trades.length) * 100;
  const avgWin  = wins.length > 0 ? winProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? -(lossProfit / losses.length) : 0;
  const sorted = [...trades].sort((a, b) => new Date(a.close_time || 0) - new Date(b.close_time || 0));
  let peak = 0, equity = 0, maxDD = 0;
  sorted.forEach(t => {
    equity += parseFloat(t.profit) || 0;
    if (equity > peak) peak = equity;
    if (peak > 0) { const dd = ((peak - equity) / peak) * 100; if (dd > maxDD) maxDD = dd; }
  });
  let maxCW = 0, maxCL = 0, cw = 0, cl = 0;
  sorted.forEach(t => {
    const p = parseFloat(t.profit) || 0;
    if (p > 0) { cw++; cl = 0; maxCW = Math.max(maxCW, cw); }
    else if (p < 0) { cl++; cw = 0; maxCL = Math.max(maxCL, cl); }
    else { cw = 0; cl = 0; }
  });
  const durations = trades.filter(t => t.open_time && t.close_time)
    .map(t => new Date(t.close_time) - new Date(t.open_time)).filter(d => d > 0);
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const daily = groupByDate(trades);
  const dailyVals = Object.values(daily);
  const avgDaily = dailyVals.length > 0 ? dailyVals.reduce((a, b) => a + b, 0) / dailyVals.length : 0;
  const stdDev = dailyVals.length > 1
    ? Math.sqrt(dailyVals.reduce((a, v) => a + Math.pow(v - avgDaily, 2), 0) / dailyVals.length) : 1;
  const sharpe = stdDev > 0 ? (avgDaily / stdDev) * Math.sqrt(252) : 0;
  const totalComm = trades.reduce((a, t) => a + (parseFloat(t.commission) || 0), 0);
  const totalSwap  = trades.reduce((a, t) => a + (parseFloat(t.swap) || 0), 0);
  return {
    total, wins: wins.length, losses: losses.length,
    winRate, profitFactor, avgWin, avgLoss,
    maxWin: Math.max(...profits), maxLoss: Math.min(...profits),
    mdd: maxDD, maxCW, maxCL, avgDuration, sharpe, totalComm, totalSwap
  };
}

function groupByDate(trades) {
  const map = {};
  trades.forEach(t => {
    if (!t.close_time) return;
    const dt = new Date(t.close_time);
    if (isNaN(dt)) return;
    const key = dt.toISOString().slice(0, 10);
    map[key] = (map[key] || 0) + (parseFloat(t.profit) || 0);
  });
  return map;
}

function groupByMonth(trades) {
  const map = {};
  trades.forEach(t => {
    if (!t.close_time) return;
    const dt = new Date(t.close_time);
    if (isNaN(dt)) return;
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    map[key] = (map[key] || 0) + (parseFloat(t.profit) || 0);
  });
  return map;
}

// ===== 토스트 =====
let _toastTimer = null;
function showToast(msg, type = 'info', duration = 3500) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || ''}</span><span>${msg}</span>`;
  toast.style.display = 'flex';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { toast.style.display = 'none'; }, duration);
}

// ===== 네비게이션 =====
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('navToggle');
  const links  = document.querySelector('.nav-links');
  if (toggle && links) toggle.addEventListener('click', () => links.classList.toggle('open'));
});
