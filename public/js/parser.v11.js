/* =============================================
   TradeArchive — MT4 / MT5 HTML Statement Parser
   ============================================= */

/**
 * MT4/MT5 HTML Statement 파일을 파싱해서 거래 배열로 반환
 * @param {string} html  파일 원문 텍스트
 * @param {string} platformOverride  'auto' | 'MT4' | 'MT5'
 * @returns {{ platform, account, trades[] }}
 */
function parseStatementHTML(html, platformOverride = 'auto') {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // ── 플랫폼 감지 ──────────────────────────────
  let platform = platformOverride !== 'auto' ? platformOverride : detectPlatform(html, doc);

  // ── 계정 정보 ────────────────────────────────
  const account = extractAccount(doc, html);

  // ── 거래 파싱 ────────────────────────────────
  let trades = [];
  if (platform === 'MT5') {
    trades = parseMT5(doc, html);
  } else {
    trades = parseMT4(doc, html);
  }

  // 빈 결과면 반대 방법 시도
  if (trades.length === 0) {
    trades = platform === 'MT5' ? parseMT4(doc, html) : parseMT5(doc, html);
    if (trades.length > 0) {
      platform = platform === 'MT5' ? 'MT4' : 'MT5';
    }
  }

  // ── 초기 Balance 추출 ────────────────────────────
  const initialBalance = extractInitialBalance(doc, html, platform);

  return { platform, account, trades, initialBalance };
}

// ── 플랫폼 감지 ────────────────────────────────
function detectPlatform(html, doc) {
  const text = (doc.body?.innerText || html).toLowerCase();
  const title = (doc.title || '').toLowerCase();

  if (title.includes('mt5') || text.includes('metatrader 5') || text.includes('mt5')) return 'MT5';
  if (title.includes('mt4') || text.includes('metatrader 4') || text.includes('mt4')) return 'MT4';

  // 테이블 헤더로 감지: MT5는 "deal" 컬럼이 있음
  const headers = [...doc.querySelectorAll('th, td')].map(el => el.textContent.trim().toLowerCase());
  if (headers.some(h => h === 'deal' || h === 'entry')) return 'MT5';
  if (headers.some(h => h === 'ticket' || h === '#')) return 'MT4';

  return 'MT4'; // 기본값
}

// ── 계정 정보 추출 ──────────────────────────────
function extractAccount(doc, html) {
  // 일반적인 패턴: "Account: 12345" 또는 "계좌: 12345"
  const bodyText = doc.body?.innerText || '';

  const patterns = [
    /account[:\s#]+(\d+[\w\-]*)/i,
    /계좌[:\s#]+(\d+[\w\-]*)/i,
    /login[:\s]+(\d+)/i,
    /account\s+(\d+)/i,
  ];

  for (const re of patterns) {
    const m = bodyText.match(re) || html.match(re);
    if (m) return m[1].trim();
  }

  // <title> 에서 추출 시도
  const titleMatch = (doc.title || '').match(/\d{4,}/);
  if (titleMatch) return titleMatch[0];

  return '';
}

// ─────────────────────────────────────────────────
//  MT4 파서
// ─────────────────────────────────────────────────
function parseMT4(doc, html) {
  const trades = [];
  const tables = doc.querySelectorAll('table');

  for (const table of tables) {
    const rows = [...table.querySelectorAll('tr')];
    if (rows.length < 2) continue;

    // 헤더 행 찾기
    let headerIdx = -1;
    let headers = [];

    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const cells = [...rows[i].querySelectorAll('th, td')].map(c => c.textContent.trim().toLowerCase());
      if (
        (cells.some(c => c.includes('ticket') || c === '#') ||
         cells.some(c => c.includes('open time') || c.includes('time'))) &&
        cells.some(c => c.includes('profit') || c.includes('type'))
      ) {
        headerIdx = i;
        headers = cells;
        break;
      }
    }

    if (headerIdx === -1) continue;

    // 컬럼 인덱스 매핑
    const col = buildColMap(headers, {
      ticket:      ['ticket', '#', 'order', 'deal'],
      open_time:   ['open time', 'time', 'open'],
      close_time:  ['close time', 'closing time', 'close'],
      type:        ['type', 'direction', 'action'],
      lots:        ['size', 'lots', 'lot', 'volume'],
      symbol:      ['item', 'symbol', 'instrument', 'currency'],
      open_price:  ['open price', 'entry price', 'price'],
      close_price: ['close price', 'exit price', 'closing price'],
      stop_loss:   ['s/l', 'stop loss', 'sl'],
      take_profit: ['t/p', 'take profit', 'tp'],
      commission:  ['commission', 'comm.'],
      swap:        ['swap'],
      profit:      ['profit', 'p&l', 'net profit'],
      pips:        ['pips', 'points'],
    });

    // 데이터 행 파싱
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const cells = [...rows[i].querySelectorAll('td')].map(c => c.textContent.trim());
      if (cells.length < 4) continue;

      const type = cleanType(cells[col.type]);
      if (!isValidTradeType(type)) continue; // buy/sell이 아닌 행 제외

      const symbol = cells[col.symbol] || '';
      if (!symbol || symbol.toLowerCase().includes('deposit') || symbol.toLowerCase().includes('balance')) continue;

      const profit = parseFloat(cleanNumber(cells[col.profit]));
      if (isNaN(profit) && col.profit !== undefined) continue;

      trades.push({
        ticket:      cells[col.ticket]     || generateTicket(),
        open_time:   parseDateTime(cells[col.open_time]),
        close_time:  parseDateTime(cells[col.close_time]),
        symbol:      symbol.toUpperCase().replace(/\s/g, ''),
        type:        type,
        lots:        parseFloat(cleanNumber(cells[col.lots]))        || 0,
        open_price:  parseFloat(cleanNumber(cells[col.open_price]))  || 0,
        close_price: parseFloat(cleanNumber(cells[col.close_price])) || 0,
        stop_loss:   parseFloat(cleanNumber(cells[col.stop_loss]))   || 0,
        take_profit: parseFloat(cleanNumber(cells[col.take_profit])) || 0,
        commission:  parseFloat(cleanNumber(cells[col.commission]))  || 0,
        swap:        parseFloat(cleanNumber(cells[col.swap]))        || 0,
        profit:      isNaN(profit) ? 0 : profit,
        pips:        parseFloat(cleanNumber(cells[col.pips]))        || 0,
      });
    }

    if (trades.length > 0) break; // 첫 번째 유효 테이블만 사용
  }

  return trades;
}

// ─────────────────────────────────────────────────
//  MT5 파서
// ─────────────────────────────────────────────────
function parseMT5(doc, html) {
  const trades = [];
  const tables = doc.querySelectorAll('table');

  for (const table of tables) {
    const rows = [...table.querySelectorAll('tr')];
    if (rows.length < 2) continue;

    let headerIdx = -1;
    let headers = [];

    for (let i = 0; i < Math.min(rows.length, 6); i++) {
      const cells = [...rows[i].querySelectorAll('th, td')].map(c => c.textContent.trim().toLowerCase());
      if (
        cells.some(c => c.includes('deal') || c.includes('order') || c.includes('position')) &&
        cells.some(c => c.includes('profit') || c.includes('type'))
      ) {
        headerIdx = i;
        headers = cells;
        break;
      }
    }

    if (headerIdx === -1) continue;

    const col = buildColMap(headers, {
      ticket:      ['deal', 'order', 'position', 'ticket'],
      open_time:   ['time', 'open time', 'entry time'],
      close_time:  ['time', 'close time', 'exit time'],
      type:        ['type', 'direction', 'action'],
      lots:        ['volume', 'size', 'lots'],
      symbol:      ['symbol', 'instrument', 'item'],
      open_price:  ['price', 'open price', 'entry price'],
      close_price: ['price', 'close price', 'exit price'],
      stop_loss:   ['s/l', 'stop loss'],
      take_profit: ['t/p', 'take profit'],
      commission:  ['commission'],
      swap:        ['swap'],
      profit:      ['profit', 'net profit', 'p/l'],
    });

    const posMap = {}; // ticket → open trade (MT5는 open/close 쌍)

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const cells = [...rows[i].querySelectorAll('td')].map(c => c.textContent.trim());
      if (cells.length < 4) continue;

      const rawType = (cells[col.type] || '').toLowerCase().trim();
      const symbol = (cells[col.symbol] || '').toUpperCase().replace(/\s/g,'');

      if (!symbol || symbol.toLowerCase().includes('balance') || symbol.toLowerCase().includes('deposit')) continue;

      const profit = parseFloat(cleanNumber(cells[col.profit]));
      const entry  = (cells[col.type + '_entry'] || cells[col.type] || '').toLowerCase();

      // MT5 Detailed Report: "in"/"out" 또는 "buy"/"sell" entry
      if (rawType.includes('in') || rawType.includes('buy') || rawType === 'buy') {
        const ticket = cells[col.ticket] || generateTicket();
        posMap[ticket] = {
          ticket,
          open_time:  parseDateTime(cells[col.open_time]),
          symbol,
          type:       rawType.includes('sell') ? 'sell' : 'buy',
          lots:       parseFloat(cleanNumber(cells[col.lots]))       || 0,
          open_price: parseFloat(cleanNumber(cells[col.open_price])) || 0,
          stop_loss:  parseFloat(cleanNumber(cells[col.stop_loss]))  || 0,
          take_profit:parseFloat(cleanNumber(cells[col.take_profit]))|| 0,
          commission: parseFloat(cleanNumber(cells[col.commission])) || 0,
          swap:       0,
        };
      } else if (rawType.includes('out') || rawType.includes('sell') || rawType === 'sell' || !isNaN(profit)) {
        // close leg
        const ticket = cells[col.ticket] || '';
        const open = posMap[ticket] || {};
        trades.push({
          ticket:      open.ticket || ticket || generateTicket(),
          open_time:   open.open_time  || parseDateTime(cells[col.open_time]),
          close_time:  parseDateTime(cells[col.close_time] || cells[col.open_time]),
          symbol:      open.symbol || symbol,
          type:        open.type   || (rawType.includes('sell') ? 'sell' : 'buy'),
          lots:        open.lots   || parseFloat(cleanNumber(cells[col.lots])) || 0,
          open_price:  open.open_price  || 0,
          close_price: parseFloat(cleanNumber(cells[col.close_price] || cells[col.open_price])) || 0,
          stop_loss:   open.stop_loss   || 0,
          take_profit: open.take_profit || 0,
          commission:  (open.commission || 0) + (parseFloat(cleanNumber(cells[col.commission])) || 0),
          swap:        parseFloat(cleanNumber(cells[col.swap])) || 0,
          profit:      isNaN(profit) ? 0 : profit,
          pips:        0,
        });
        delete posMap[ticket];
      }
    }

    if (trades.length > 0) break;
  }

  // MT5 단순 형식 (포지션 기반 단일 행)
  if (trades.length === 0) {
    return parseMT5Simple(doc);
  }

  return trades;
}

// MT5 단순 파서 (포지션별 1행)
function parseMT5Simple(doc) {
  const trades = [];
  const tables = doc.querySelectorAll('table');

  for (const table of tables) {
    const rows = [...table.querySelectorAll('tr')];
    if (rows.length < 2) continue;

    let headerIdx = -1;
    let headers = [];

    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const cells = [...rows[i].querySelectorAll('th, td')].map(c => c.textContent.trim().toLowerCase());
      if (cells.some(c => c.includes('profit')) && cells.some(c => c.includes('volume') || c.includes('lots'))) {
        headerIdx = i;
        headers = cells;
        break;
      }
    }

    if (headerIdx === -1) continue;

    const col = buildColMap(headers, {
      ticket:      ['position', 'deal', 'order', '#'],
      open_time:   ['time', 'open time'],
      close_time:  ['time 1', 'close time', 'close'],
      type:        ['type', 'direction'],
      lots:        ['volume', 'lots', 'size'],
      symbol:      ['symbol', 'instrument'],
      open_price:  ['price', 'open price', 'open'],
      close_price: ['price 1', 'close price', 'close price'],
      profit:      ['profit', 'p/l'],
      commission:  ['commission'],
      swap:        ['swap'],
    });

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const cells = [...rows[i].querySelectorAll('td')].map(c => c.textContent.trim());
      if (cells.length < 4) continue;

      const rawType = cleanType(cells[col.type]);
      if (!isValidTradeType(rawType)) continue;
      const symbol = (cells[col.symbol] || '').toUpperCase().replace(/\s/g,'');
      if (!symbol) continue;

      const profit = parseFloat(cleanNumber(cells[col.profit]));

      trades.push({
        ticket:      cells[col.ticket]     || generateTicket(),
        open_time:   parseDateTime(cells[col.open_time]),
        close_time:  parseDateTime(cells[col.close_time]),
        symbol,
        type:        rawType,
        lots:        parseFloat(cleanNumber(cells[col.lots]))        || 0,
        open_price:  parseFloat(cleanNumber(cells[col.open_price]))  || 0,
        close_price: parseFloat(cleanNumber(cells[col.close_price])) || 0,
        stop_loss:   0,
        take_profit: 0,
        commission:  parseFloat(cleanNumber(cells[col.commission]))  || 0,
        swap:        parseFloat(cleanNumber(cells[col.swap]))        || 0,
        profit:      isNaN(profit) ? 0 : profit,
        pips:        0,
      });
    }

    if (trades.length > 0) break;
  }

  return trades;
}

// ─────────────────────────────────────────────────
//  헬퍼 함수들
// ─────────────────────────────────────────────────

// 컬럼 인덱스 매핑 빌더
function buildColMap(headers, fieldAliases) {
  const map = {};
  for (const [field, aliases] of Object.entries(fieldAliases)) {
    for (const alias of aliases) {
      const idx = headers.findIndex(h => h === alias || h.includes(alias));
      if (idx !== -1) { map[field] = idx; break; }
    }
    if (map[field] === undefined) map[field] = -1;
  }
  // 안전한 접근을 위해 -1이면 빈 문자열 반환
  return new Proxy(map, {
    get(target, key) {
      const idx = target[key];
      return idx !== undefined ? idx : -1;
    }
  });
}

// 숫자 문자열 정리 (공백, 쉼표 제거)
function cleanNumber(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/\s/g, '').replace(/,/g, '').replace(/\u00a0/g, '');
}

// 거래 유형 정규화
function cleanType(raw) {
  if (!raw) return '';
  const s = raw.toLowerCase().trim();
  if (s.includes('buy')) return 'buy';
  if (s.includes('sell')) return 'sell';
  if (s === 'b' || s === '0') return 'buy';
  if (s === 's' || s === '1') return 'sell';
  return s;
}

function isValidTradeType(type) {
  return type === 'buy' || type === 'sell';
}

// 날짜/시간 파싱
function parseDateTime(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s === '—' || s === '-') return null;

  // 이미 ISO 형식
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d) ? null : d.toISOString();
  }

  // MT4 형식: "2024.01.15 10:30" 또는 "2024.01.15 10:30:00"
  const mt4Match = s.match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (mt4Match) {
    const [, y, mo, d, h, mi, sec] = mt4Match;
    const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${sec || '00'}`);
    return isNaN(dt) ? null : dt.toISOString();
  }

  // MT5 형식: "2024-01-15 10:30:00" (이미 처리됨) 또는 "2024.01.15 10:30:00.000"
  const mt5Match = s.match(/(\d{4})[\.\-](\d{2})[\.\-](\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (mt5Match) {
    const [, y, mo, d, h, mi, sec] = mt5Match;
    const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${sec || '00'}`);
    return isNaN(dt) ? null : dt.toISOString();
  }

  // 슬래시 형식: "15/01/2024 10:30"
  const slashMatch = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (slashMatch) {
    const [, d, mo, y, h, mi] = slashMatch;
    const dt = new Date(`${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}T${h}:${mi}:00`);
    return isNaN(dt) ? null : dt.toISOString();
  }

  // fallback: Date.parse 시도
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString();
}

// 임시 티켓 생성
function generateTicket() {
  return 'T' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

// ── Balance(잔고) 추출 ────────────────────────────
// MT4 Statement 하단 Summary에서 Balance를 찾는다.
// Tradeco Ltd. 형식: 하단 테이블에 "Balance:", "Equity:" 등 라벨-값 쌍으로 표시
function extractInitialBalance(doc, html, platform) {

  // ① 모든 td 텍스트를 순회하며 "Balance" 라벨 바로 옆/다음 td에서 값 추출
  const allTds = [...doc.querySelectorAll('td')];
  for (let i = 0; i < allTds.length; i++) {
    const text = allTds[i].textContent.trim();
    // "Balance:" 또는 "Balance" 라벨 셀
    if (/^balance[:\s]*$/i.test(text) || text.toLowerCase() === 'balance:') {
      // 같은 행의 다음 td
      const nextTd = allTds[i + 1];
      if (nextTd) {
        const val = parseFloat(cleanNumber(nextTd.textContent.trim()));
        if (!isNaN(val) && val > 0) return val;
      }
    }
    // "Balance: 1 208.96" 처럼 한 셀에 라벨+값이 같이 있는 경우
    const inlineMatch = text.match(/^balance[:\s]+([\d\s,]+(?:\.\d+)?)$/i);
    if (inlineMatch) {
      const val = parseFloat(inlineMatch[1].replace(/[\s,]/g, ''));
      if (!isNaN(val) && val > 0) return val;
    }
  }

  // ② b 태그 안에 "Balance:" 패턴 (MT4 자주 쓰는 bold 라벨)
  const allBolds = [...doc.querySelectorAll('b, strong')];
  for (const b of allBolds) {
    const text = b.textContent.trim();
    const m = text.match(/balance[:\s]+([\d\s,]+(?:\.\d+)?)/i);
    if (m) {
      const val = parseFloat(m[1].replace(/[\s,]/g, ''));
      if (!isNaN(val) && val > 0) return val;
    }
  }

  // ③ 전체 HTML 원문에서 정규식으로 탐색
  // MT4 Tradeco 형식: "Balance:</td><td ...>1 208.96"
  const htmlPatterns = [
    /balance[^<]*<\/td>\s*<td[^>]*>\s*([\d\s,]+(?:\.\d+)?)/i,
    /balance[:\s]+([\d\s,]+(?:\.\d+)?)/i,
    /입금[:\s]+([\d\s,]+(?:\.\d+)?)/i,
    /deposit[^<]*<\/td>\s*<td[^>]*>\s*([\d\s,]+(?:\.\d+)?)/i,
    /deposit\/withdrawal[^<]*<\/td>\s*<td[^>]*>\s*([\d\s,]+(?:\.\d+)?)/i,
  ];
  for (const re of htmlPatterns) {
    const m = html.match(re);
    if (m) {
      const val = parseFloat(m[1].replace(/[\s,]/g, ''));
      if (!isNaN(val) && val > 0) return val;
    }
  }

  // ④ innerText 전체에서 패턴 탐색
  const bodyText = doc.body?.innerText || '';
  const textPatterns = [
    /balance[:\s]+([\d\s,]+(?:\.\d+)?)/i,
    /initial\s+balance[:\s]+([\d\s,]+(?:\.\d+)?)/i,
  ];
  for (const re of textPatterns) {
    const m = bodyText.match(re);
    if (m) {
      const val = parseFloat(m[1].replace(/[\s,]/g, ''));
      if (!isNaN(val) && val > 0) return val;
    }
  }

  return null;
}
