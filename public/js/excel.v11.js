/* TradeArchive — Excel Export Utility (SheetJS 기반)
   SheetJS CDN: https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js
   사용법: excelExport.trades() / excelExport.analytics() / excelExport.note(rows, weekLabel)
*/

const excelExport = {

  /* ── 공통: 워크북 다운로드 ── */
  _download(wb, filename) {
    XLSX.writeFile(wb, filename);
  },

  /* ── 공통: 버튼 로딩 상태 ── */
  _btnLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      btn.style.opacity = '.6';
      btn._orig = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 생성 중...';
    } else {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.innerHTML = btn._orig || '<i class="fas fa-file-excel"></i> 엑셀 다운로드';
    }
  },

  /* ════════════════════════════════════════
     거래내역 — 현재 필터된 전체 거래 목록
     ════════════════════════════════════════ */
  trades(trades, tz = 'server') {
    const btn = document.getElementById('excelDownloadBtn');
    this._btnLoading(btn, true);

    try {
      const headers = ['티켓', '심볼', '유형', '랏', '진입가', '청산가', '핍',
                       '진입일시', '청산일시', '수익($)', '커미션', '스왑', '플랫폼'];

      const rows = trades.map(t => [
        t.ticket      || '',
        t.symbol      || '',
        (t.type || '').toUpperCase(),
        parseFloat(t.lots)        || 0,
        parseFloat(t.open_price)  || 0,
        parseFloat(t.close_price) || 0,
        parseFloat(t.pips)        || 0,
        fmt.datetimeTZ(t.open_time,  tz),
        fmt.datetimeTZ(t.close_time, tz),
        parseFloat(t.profit)      || 0,
        parseFloat(t.commission)  || 0,
        parseFloat(t.swap)        || 0,
        t.platform    || '',
      ]);

      // 요약 행
      const totalProfit = trades.reduce((a, t) => a + (parseFloat(t.profit) || 0), 0);
      const wins        = trades.filter(t => (parseFloat(t.profit) || 0) > 0).length;
      const winRate     = trades.length > 0 ? (wins / trades.length * 100).toFixed(1) : 0;

      const wb = XLSX.utils.book_new();
      const wsData = [
        headers,
        ...rows,
        [],
        ['※ 요약'],
        ['총 거래수', trades.length + '건'],
        ['총 수익($)', totalProfit.toFixed(2)],
        ['승률', winRate + '%'],
        ['시간대', tz === 'server' ? '서버시각(MT4원본)' : tz === 'kst' ? '서울(KST)' : '뉴욕(ET)'],
      ];

      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // 컬럼 너비
      ws['!cols'] = [
        {wch:12},{wch:10},{wch:6},{wch:7},{wch:10},{wch:10},{wch:7},
        {wch:16},{wch:16},{wch:12},{wch:10},{wch:8},{wch:6}
      ];

      XLSX.utils.book_append_sheet(wb, ws, '거래내역');
      this._download(wb, `거래내역_${this._today()}.xlsx`);
    } catch(e) {
      alert('엑셀 생성 중 오류가 발생했습니다: ' + e.message);
    } finally {
      this._btnLoading(btn, false);
    }
  },

  /* ════════════════════════════════════════
     분석 — 핵심 지표 + 심볼별 성과
     ════════════════════════════════════════ */
  analytics(trades) {
    const btn = document.getElementById('excelDownloadBtn');
    this._btnLoading(btn, true);

    try {
      const wb = XLSX.utils.book_new();
      const s  = calcStats(trades);

      /* 시트1: 핵심 지표 */
      const statsData = [
        ['지표', '값'],
        ['총 거래수',       trades.length + '건'],
        ['누적 수익($)',    s.total.toFixed(2)],
        ['승률',           s.winRate.toFixed(1) + '%'],
        ['손익비(PF)',      isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'],
        ['평균 수익($)',    s.avgWin.toFixed(2)],
        ['평균 손실($)',    s.avgLoss.toFixed(2)],
        ['최대 수익($)',    s.maxWin.toFixed(2)],
        ['최대 손실($)',    s.maxLoss.toFixed(2)],
        ['MDD(%)',         s.mdd.toFixed(1) + '%'],
        ['최대 연속 승',   s.maxCW + '연속'],
        ['최대 연속 패',   s.maxCL + '연속'],
        ['평균 보유시간',  fmt.duration(s.avgDuration)],
        ['Sharpe Ratio',   s.sharpe.toFixed(2)],
        ['총 커미션($)',   s.totalComm.toFixed(2)],
        ['총 스왑($)',     s.totalSwap.toFixed(2)],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(statsData);
      ws1['!cols'] = [{wch:18},{wch:16}];
      XLSX.utils.book_append_sheet(wb, ws1, '핵심지표');

      /* 시트2: 심볼별 성과 */
      const symMap = {};
      trades.forEach(t => {
        if (!t.symbol) return;
        if (!symMap[t.symbol]) symMap[t.symbol] = [];
        symMap[t.symbol].push(t);
      });
      const symRows = Object.entries(symMap).map(([sym, ts]) => {
        const profits = ts.map(t => parseFloat(t.profit) || 0);
        const total   = profits.reduce((a,b) => a+b, 0);
        const wins    = profits.filter(p => p > 0).length;
        return [
          sym,
          ts.length,
          ((wins/ts.length)*100).toFixed(1) + '%',
          total.toFixed(2),
          (total/ts.length).toFixed(2),
          Math.max(...profits).toFixed(2),
          Math.min(...profits).toFixed(2),
        ];
      }).sort((a,b) => parseFloat(b[3]) - parseFloat(a[3]));

      const symHeaders = ['심볼','거래수','승률','총수익($)','평균수익($)','최대익절($)','최대손절($)'];
      const ws2 = XLSX.utils.aoa_to_sheet([symHeaders, ...symRows]);
      ws2['!cols'] = [{wch:12},{wch:8},{wch:8},{wch:12},{wch:12},{wch:12},{wch:12}];
      XLSX.utils.book_append_sheet(wb, ws2, '심볼별성과');

      /* 시트3: 전체 거래 원본 */
      const tradeHeaders = ['티켓','심볼','유형','랏','진입가','청산가','수익($)','커미션','스왑','진입일시','청산일시','플랫폼'];
      const tradeRows = trades.map(t => [
        t.ticket||'', t.symbol||'', (t.type||'').toUpperCase(),
        parseFloat(t.lots)||0, parseFloat(t.open_price)||0, parseFloat(t.close_price)||0,
        parseFloat(t.profit)||0, parseFloat(t.commission)||0, parseFloat(t.swap)||0,
        fmt.datetime(t.open_time), fmt.datetime(t.close_time), t.platform||''
      ]);
      const ws3 = XLSX.utils.aoa_to_sheet([tradeHeaders, ...tradeRows]);
      ws3['!cols'] = [{wch:12},{wch:10},{wch:6},{wch:7},{wch:10},{wch:10},{wch:12},{wch:10},{wch:8},{wch:16},{wch:16},{wch:6}];
      XLSX.utils.book_append_sheet(wb, ws3, '전체거래');

      this._download(wb, `분석_${this._today()}.xlsx`);
    } catch(e) {
      alert('엑셀 생성 중 오류가 발생했습니다: ' + e.message);
    } finally {
      this._btnLoading(btn, false);
    }
  },

  /* ════════════════════════════════════════
     트레이딩 노트 헌정 — 선택 주차 일별 기록
     ════════════════════════════════════════ */
  async note(dayRows, weekLabel, capital, weekKey = '') {
    const btn = document.getElementById('noteExcelBtn');
    this._btnLoading(btn, true);

    try {
      const wb = XLSX.utils.book_new();
      // 코멘트 불러오기 (D1 KV)
      let comment = '';
      if (weekKey) {
        try { comment = (await KV.get(`note:comment:${weekKey}`)) || ''; } catch {}
      }

      /* 시트1: 일별 기록 */
      const headers = [
        '날짜', '요일', '최초진입(KST)', '최종마감(KST)', '순수유지시간',
        '총거래횟수', '승률(%)', '일별손익($)', '최대익절($)', '최대손절($)', '최대진입랏수'
      ];

      const fmtTime = (d) => d
        ? String(d.getUTCHours()).padStart(2,'0') + ':' +
          String(d.getUTCMinutes()).padStart(2,'0') + ':' +
          String(d.getUTCSeconds()).padStart(2,'0')
        : '—';

      const rows = dayRows.map(r => [
        r.dateStr,
        r.dowStr,
        fmtTime(r.firstOpen),
        fmtTime(r.lastClose),
        r.durationStr,
        r.count,
        parseFloat(r.winRate.toFixed(2)),
        parseFloat(r.pnl.toFixed(2)),
        parseFloat(r.maxWin.toFixed(2)),
        parseFloat(Math.abs(r.maxLoss).toFixed(2)),
        parseFloat(r.maxLot.toFixed(2)),
      ]);

      const totalPnl    = dayRows.reduce((a,r) => a + r.pnl, 0);
      const totalTrades = dayRows.reduce((a,r) => a + r.count, 0);
      const weekReturn  = capital > 0 ? (totalPnl / capital * 100) : 0;

      const ws = XLSX.utils.aoa_to_sheet([
        [`334 TRADINGLOG — 트레이딩 노트 헌정 (${weekLabel})`],
        [],
        headers,
        ...rows,
        [],
        ['※ 주간 요약'],
        ['자본금($)',       capital],
        ['주간 수익금($)',  parseFloat(totalPnl.toFixed(2))],
        ['주간 수익률(%)',  parseFloat(weekReturn.toFixed(1))],
        ['총 거래횟수',    totalTrades + '회'],
        [],
        ['※ 매매 복기 코멘트'],
        [comment || '(작성된 코멘트 없음)'],
      ]);

      ws['!cols'] = [
        {wch:8},{wch:8},{wch:14},{wch:14},{wch:12},
        {wch:10},{wch:8},{wch:12},{wch:12},{wch:12},{wch:12}
      ];
      ws['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:10} }]; // 제목 병합

      XLSX.utils.book_append_sheet(wb, ws, weekLabel);
      this._download(wb, `트레이딩노트_${weekLabel}_${this._today()}.xlsx`);
    } catch(e) {
      alert('엑셀 생성 중 오류가 발생했습니다: ' + e.message);
    } finally {
      this._btnLoading(btn, false);
    }
  },

  /* ── 오늘 날짜 YYYYMMDD ── */
  _today() {
    const d = new Date();
    return d.getFullYear() +
      String(d.getMonth()+1).padStart(2,'0') +
      String(d.getDate()).padStart(2,'0');
  }
};
