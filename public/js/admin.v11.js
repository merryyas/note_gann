/* =============================================
   TradeArchive — Admin v7 (Tables API 기반)
   ============================================= */

const ADMIN_PW_KEY = 'ta_adminPw';
const SESSION_KEY  = 'ta_adminSession';
const DEFAULT_PW   = 'admin1234';
let adminTZ = 'server';

function getStoredPw() { return localStorage.getItem(ADMIN_PW_KEY) || DEFAULT_PW; }
function isLoggedIn()  { return sessionStorage.getItem(SESSION_KEY) === 'true'; }
function setLoggedIn(v){ v ? sessionStorage.setItem(SESSION_KEY,'true') : sessionStorage.removeItem(SESSION_KEY); }

// ===== 초기화 =====
function initAdmin() {
  const overlay = document.getElementById('loginOverlay');
  const panel   = document.getElementById('adminPanel');
  if (isLoggedIn()) {
    overlay.style.display = 'none';
    panel.style.display   = 'block';
    loadUploadHistory();
  } else {
    overlay.style.display = 'flex';
    panel.style.display   = 'none';
  }
}

// ===== 로그인 =====
document.getElementById('loginBtn').addEventListener('click', tryLogin);
document.getElementById('adminPassword').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });

function tryLogin() {
  const pw  = document.getElementById('adminPassword').value;
  const err = document.getElementById('loginError');
  if (pw === getStoredPw()) {
    setLoggedIn(true);
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('adminPanel').style.display   = 'block';
    loadUploadHistory();
  } else {
    err.textContent = '❌ 비밀번호가 올바르지 않습니다.';
    document.getElementById('adminPassword').value = '';
    setTimeout(() => { err.textContent = ''; }, 3000);
  }
}

// ===== 로그아웃 =====
document.getElementById('logoutBtn').addEventListener('click', () => {
  setLoggedIn(false);
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('adminPanel').style.display   = 'none';
  document.getElementById('adminPassword').value = '';
});

// ===== 파일 업로드 =====
const uploadArea = document.getElementById('uploadArea');
const fileInput  = document.getElementById('fileInput');

uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
uploadArea.addEventListener('drop', e => { e.preventDefault(); uploadArea.classList.remove('drag-over'); handleFiles(e.dataTransfer.files); });
fileInput.addEventListener('change', () => handleFiles(fileInput.files));

let parsedBatches = [];

function handleFiles(files) {
  const arr = Array.from(files).filter(f => f.name.match(/\.(html|htm)$/i));
  if (arr.length === 0) { showToast('HTML 파일만 업로드 가능합니다.', 'error'); return; }
  parsedBatches = [];
  const platformOverride = document.getElementById('platformOverride').value;
  let loaded = 0;
  arr.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const result = parseStatementHTML(e.target.result, platformOverride);
        parsedBatches.push({ filename: file.name, platform: result.platform, result });
      } catch (err) {
        showToast(`파싱 오류: ${file.name}`, 'error');
      }
      loaded++;
      if (loaded === arr.length) showPreview();
    };
    reader.readAsText(file, 'utf-8');
  });
}

// ===== 미리보기 =====
function showPreview() {
  if (parsedBatches.length === 0) { showToast('파싱된 데이터가 없습니다.', 'error'); return; }
  const previewEl = document.getElementById('parsePreview');
  const contentEl = document.getElementById('previewContent');
  previewEl.style.display = 'block';

  let totalTrades = 0, totalProfit = 0, html = '';

  parsedBatches.forEach(batch => {
    const trades = batch.result.trades || [];
    const batchProfit = trades.reduce((a, t) => a + (parseFloat(t.profit) || 0), 0);
    const wins    = trades.filter(t => (parseFloat(t.profit)||0) > 0).length;
    const winRate = trades.length > 0 ? ((wins / trades.length) * 100).toFixed(1) : 0;
    totalTrades += trades.length;
    totalProfit += batchProfit;

    const symbols = {};
    trades.forEach(t => { symbols[t.symbol] = (symbols[t.symbol] || 0) + 1; });
    const topSymbols = Object.entries(symbols).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([s,c])=>`${s}(${c})`).join(', ');

    html += `<div class="preview-summary" style="margin-bottom:12px;">
      <div class="preview-stat"><span class="preview-stat-label">파일명</span><span class="preview-stat-val" style="font-size:13px;">${batch.filename}</span></div>
      <div class="preview-stat"><span class="preview-stat-label">플랫폼</span><span class="preview-stat-val">${batch.result.platform}</span></div>
      <div class="preview-stat"><span class="preview-stat-label">계정</span><span class="preview-stat-val">${batch.result.account || '—'}</span></div>
      <div class="preview-stat"><span class="preview-stat-label">거래 수</span><span class="preview-stat-val">${trades.length}건</span></div>
      <div class="preview-stat"><span class="preview-stat-label">총 수익</span><span class="preview-stat-val" style="color:${batchProfit>=0?'var(--green)':'var(--red)'}">${fmt.currency(batchProfit)}</span></div>
      <div class="preview-stat"><span class="preview-stat-label">승률</span><span class="preview-stat-val">${winRate}%</span></div>
      <div class="preview-stat"><span class="preview-stat-label">주요 심볼</span><span class="preview-stat-val" style="font-size:12px;">${topSymbols||'—'}</span></div>
    </div>`;

    if (trades.length > 0) {
      const samples = trades.slice(-5).reverse();
      html += `<div style="margin-bottom:20px;"><p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">📋 샘플 (최근 ${samples.length}건)</p>
        <div class="table-wrapper"><table class="trades-table"><thead><tr><th>심볼</th><th>유형</th><th>랏</th><th>진입가</th><th>청산가</th><th>진입시각</th><th>청산시각</th><th>수익</th></tr></thead><tbody>`;
      samples.forEach(t => {
        html += `<tr><td>${t.symbol}</td><td><span class="type-badge ${t.type}">${(t.type||'').toUpperCase()}</span></td><td>${fmt.lots(t.lots)}</td><td>${t.open_price}</td><td>${t.close_price}</td><td style="font-size:11px;">${fmt.datetimeTZ(t.open_time, adminTZ)}</td><td style="font-size:11px;">${fmt.datetimeTZ(t.close_time, adminTZ)}</td><td class="profit-cell ${profitClass(t.profit)}">${fmt.currency(t.profit)}</td></tr>`;
      });
      html += `</tbody></table></div></div>`;
    }
  });

  if (parsedBatches.length > 1) {
    html = `<div class="preview-summary" style="margin-bottom:16px;background:rgba(0,212,170,0.05);border-color:rgba(0,212,170,0.3);">
      <div class="preview-stat"><span class="preview-stat-label">파일 수</span><span class="preview-stat-val">${parsedBatches.length}개</span></div>
      <div class="preview-stat"><span class="preview-stat-label">총 거래</span><span class="preview-stat-val">${totalTrades}건</span></div>
      <div class="preview-stat"><span class="preview-stat-label">합산 수익</span><span class="preview-stat-val" style="color:${totalProfit>=0?'var(--green)':'var(--red)'}">${fmt.currency(totalProfit)}</span></div>
    </div>` + html;
  }

  contentEl.innerHTML = html;
  document.getElementById('confirmUpload').disabled = totalTrades === 0;
  if (totalTrades === 0) {
    contentEl.innerHTML += `<p style="color:var(--red);font-size:14px;text-align:center;padding:16px;">⚠️ 파싱된 거래 데이터가 없습니다. 파일 형식을 확인해 주세요.</p>`;
  }
}

// ===== 취소 =====
document.getElementById('cancelUpload').addEventListener('click', () => {
  document.getElementById('parsePreview').style.display = 'none';
  fileInput.value = '';
  parsedBatches = [];
});

// ===== 저장 (Tables API) =====
document.getElementById('confirmUpload').addEventListener('click', async () => {
  if (!parsedBatches.length) return;

  const confirmBtn    = document.getElementById('confirmUpload');
  const progressDiv   = document.getElementById('uploadProgress');
  const progressFill  = document.getElementById('progressFill');
  const progressText  = document.getElementById('progressText');
  const duplicateMode = document.getElementById('duplicateMode').value;
  const note          = document.getElementById('uploadNote').value;

  confirmBtn.disabled = true;
  confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 저장 중...';
  progressDiv.style.display = 'block';
  progressFill.style.width = '0%';
  progressText.textContent = '기존 데이터 확인 중...';

  /* 중복 키 세트 */
  let existingKeys = new Set();
  if (duplicateMode === 'skip') {
    existingKeys = await buildExistingKeySet();
  }

  let totalSaved = 0, totalSkipped = 0;
  const totalCount = parsedBatches.reduce((a, b) => a + b.result.trades.length, 0);

  for (let bi = 0; bi < parsedBatches.length; bi++) {
    const batch       = parsedBatches[bi];
    const allTrades   = batch.result.trades;
    const batchId     = `batch_${Date.now()}_${bi}`;
    const batchProfit = allTrades.reduce((a, t) => a + (parseFloat(t.profit)||0), 0);
    const periodDates = allTrades.map(t => new Date(t.close_time)).filter(d => !isNaN(d));
    const periodStart = periodDates.length ? new Date(Math.min(...periodDates)).toISOString() : null;
    const periodEnd   = periodDates.length ? new Date(Math.max(...periodDates)).toISOString() : null;

    // ── 중복 필터링 ──────────────────────────────────────────────
    const tradesToInsert = [];
    for (const trade of allTrades) {
      const key = `${trade.ticket}_${trade.symbol}_${batch.result.platform}`;
      if (duplicateMode === 'skip' && existingKeys.has(key)) {
        totalSkipped++;
      } else {
        existingKeys.add(key);
        tradesToInsert.push({
          ticket:       String(trade.ticket      || ''),
          symbol:       String(trade.symbol      || ''),
          type:         String(trade.type        || ''),
          lots:         parseFloat(trade.lots)        || 0,
          open_price:   parseFloat(trade.open_price)  || 0,
          close_price:  parseFloat(trade.close_price) || 0,
          stop_loss:    parseFloat(trade.stop_loss)   || 0,
          take_profit:  parseFloat(trade.take_profit) || 0,
          profit:       parseFloat(trade.profit)      || 0,
          commission:   parseFloat(trade.commission)  || 0,
          swap:         parseFloat(trade.swap)        || 0,
          pips:         parseFloat(trade.pips)        || 0,
          open_time:    trade.open_time  || null,
          close_time:   trade.close_time || null,
          platform:     String(batch.result.platform || ''),
          account_id:   String(batch.result.account  || ''),
          upload_batch: batchId
        });
      }
    }

    if (tradesToInsert.length === 0) continue;

    // ── 배치 API 호출 (100건씩 청크 → 한 번의 HTTP로 D1 batch INSERT) ──
    const CHUNK = 100;
    for (let ci = 0; ci < tradesToInsert.length; ci += CHUNK) {
      const chunk = tradesToInsert.slice(ci, ci + CHUNK);
      const isLastChunk = (ci + CHUNK) >= tradesToInsert.length;

      progressText.textContent = `저장 중... ${Math.round(((totalSaved + ci) / totalCount) * 100)}% (${totalSaved + ci}건)`;
      progressFill.style.width = Math.round(((totalSaved + ci) / totalCount) * 100) + '%';

      const payload = {
        trades: chunk,
        // 마지막 청크에만 upload_history 포함
        upload_history: isLastChunk ? {
          filename:        batch.filename,
          platform:        batch.result.platform        || '',
          account:         batch.result.account         || '',
          period_start:    periodStart,
          period_end:      periodEnd,
          total_trades:    tradesToInsert.length,
          total_profit:    batchProfit,
          upload_note:     note,
          batch_id:        batchId,
          initial_balance: batch.result.initialBalance  || null
        } : null
      };

      const res = await fetch('/api/trades/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '배치 저장 실패');
      totalSaved += chunk.length;
    }
  }

  progressFill.style.width = '100%';
  progressText.textContent = `완료! ${totalSaved}건 저장${totalSkipped > 0 ? `, ${totalSkipped}건 스킵` : ''}`;

  if (totalSaved > 0) {
    showToast(`✅ ${totalSaved}건 저장 완료!`, 'success', 5000);
  } else {
    showToast(`⚠️ 저장된 데이터 없음 — 모두 중복이거나 파싱 오류`, 'error', 6000);
  }

  setTimeout(async () => {
    document.getElementById('parsePreview').style.display = 'none';
    progressDiv.style.display = 'none';
    progressFill.style.width = '0%';
    fileInput.value = '';
    parsedBatches = [];
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = '<i class="fas fa-database"></i> 저장하기';
    document.getElementById('uploadNote').value = '';
    await loadUploadHistory();
  }, 1500);
});

// ===== 업로드 이력 =====
async function loadUploadHistory() {
  const tbody = document.getElementById('uploadHistoryTbody');
  tbody.innerHTML = '<tr><td colspan="8" class="empty-msg"><i class="fas fa-spinner fa-spin"></i> 불러오는 중...</td></tr>';

  const records = await DB.getAll('upload_history');
  records.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  if (records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-msg"><i class="fas fa-inbox"></i> 업로드 이력이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = records.map(r => {
    const profit = parseFloat(r.total_profit) || 0;
    const period = (r.period_start ? fmt.datetimeTZ(r.period_start, adminTZ) : '—') + ' ~ ' + (r.period_end ? fmt.datetimeTZ(r.period_end, adminTZ) : '—');
    return `<tr>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;" title="${r.filename||''}">${r.filename||'—'}</td>
      <td><span class="platform-badge ${(r.platform||'').toLowerCase()}">${r.platform||'—'}</span></td>
      <td>${period}</td>
      <td>${r.total_trades||0}건</td>
      <td class="profit-cell ${profitClass(profit)}">${fmt.currency(profit)}</td>
      <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;">${r.upload_note||'—'}</td>
      <td>${fmt.datetime(r.created_at)}</td>
      <td><button class="btn-danger-soft" style="padding:5px 10px;font-size:11px;" onclick="deleteBatch('${r.id}','${r.batch_id||r.id}','${r.filename||''}')"><i class="fas fa-trash-can"></i></button></td>
    </tr>`;
  }).join('');
}

document.getElementById('refreshHistory').addEventListener('click', loadUploadHistory);

/* 시간대 드롭다운 */
const adminTzEl = document.getElementById('adminTzSelect');
if (adminTzEl) adminTzEl.addEventListener('change', () => { adminTZ = adminTzEl.value; loadUploadHistory(); });

// ===== 배치 삭제 =====
async function deleteBatch(historyId, batchId, filename) {
  showConfirmModal('업로드 배치 삭제', `"${filename}" 의 거래 데이터를 모두 삭제합니다.`, async () => {
    /* batch_id가 일치하는 trades 모두 삭제 */
    const deleted = await DB.deleteWhere('trades',
      t => t.upload_batch === batchId || t.upload_batch === historyId
    );
    await DB.delete('upload_history', historyId);
    showToast(`${deleted}건 삭제 완료`, 'success');
    await loadUploadHistory();
  });
}

// ===== 전체 초기화 =====
document.getElementById('clearAllBtn').addEventListener('click', () => {
  showConfirmModal('⚠️ 전체 데이터 초기화', '모든 거래 데이터와 업로드 이력이 영구 삭제됩니다. 정말로 초기화하시겠습니까?', async () => {
    showToast('삭제 중... 잠시 기다려 주세요.', 'info', 10000);
    await DB.clear('trades');
    await DB.clear('upload_history');
    showToast('전체 데이터 초기화 완료', 'success');
    await loadUploadHistory();
  });
});

// ===== 비밀번호 변경 =====
document.getElementById('changePwBtn').addEventListener('click', () => {
  const pw1 = document.getElementById('newPw1').value;
  const pw2 = document.getElementById('newPw2').value;
  const msg = document.getElementById('pwChangeMsg');
  if (!pw1 || pw1.length < 6) { msg.style.color='var(--red)'; msg.textContent='❌ 비밀번호는 6자 이상이어야 합니다.'; return; }
  if (pw1 !== pw2)             { msg.style.color='var(--red)'; msg.textContent='❌ 비밀번호가 일치하지 않습니다.'; return; }
  localStorage.setItem(ADMIN_PW_KEY, pw1);
  msg.style.color = 'var(--green)';
  msg.textContent = '✅ 비밀번호가 변경되었습니다.';
  document.getElementById('newPw1').value = '';
  document.getElementById('newPw2').value = '';
  setTimeout(() => { msg.textContent = ''; }, 5000);
});

// ===== 확인 모달 =====
let _modalCb = null;
function showConfirmModal(title, message, cb) {
  document.getElementById('modalTitle').textContent   = title;
  document.getElementById('modalMessage').textContent = message;
  _modalCb = cb;
  document.getElementById('confirmModal').style.display = 'flex';
}
document.getElementById('modalCancel').addEventListener('click', () => {
  document.getElementById('confirmModal').style.display = 'none';
  _modalCb = null;
});
document.getElementById('modalConfirm').addEventListener('click', () => {
  document.getElementById('confirmModal').style.display = 'none';
  if (_modalCb) _modalCb();
  _modalCb = null;
});

document.addEventListener('DOMContentLoaded', initAdmin);
