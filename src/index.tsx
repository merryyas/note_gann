import { Hono } from 'hono'
import { cors } from 'hono/cors'

// ─── Bindings ────────────────────────────────────────────────
type Bindings = {
  DB: D1Database
  ASSETS: Fetcher
  ADMIN_TOKEN: string   // wrangler pages secret으로 설정
}

const app = new Hono<{ Bindings: Bindings }>()

// ─── CORS ─────────────────────────────────────────────────────
app.use('/api/*', cors())
app.use('/tables/*', cors())

// ─── Helper: generate unique id ────────────────────────────────
function genId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

// ─── Helper: parse pagination ──────────────────────────────────
function parsePaging(url: URL) {
  const page  = Math.max(1, parseInt(url.searchParams.get('page')  || '1'))
  const limit = Math.min(1000, parseInt(url.searchParams.get('limit') || '500'))
  return { page, limit, offset: (page - 1) * limit }
}

// ─── Allowed tables whitelist ──────────────────────────────────
function isAllowedTable(table: string): boolean {
  return ['trades', 'upload_history'].includes(table)
}

// ════════════════════════════════════════════════════════════════
//  TABLES API  — /tables/:table
// ════════════════════════════════════════════════════════════════

// GET /tables/:table
app.get('/tables/:table', async (c) => {
  const table = c.req.param('table')
  if (!isAllowedTable(table)) return c.json({ error: 'Table not found' }, 404)

  const url = new URL(c.req.url)
  const { limit, offset } = parsePaging(url)

  try {
    const [rowsRes, countRes] = await Promise.all([
      c.env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid DESC LIMIT ? OFFSET ?`).bind(limit, offset).all(),
      c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).first<{ cnt: number }>()
    ])
    return c.json({
      data:  rowsRes.results,
      total: countRes?.cnt ?? 0,
      page:  Math.floor(offset / limit) + 1,
      limit
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// GET /tables/:table/:id
app.get('/tables/:table/:id', async (c) => {
  const table = c.req.param('table')
  const id    = c.req.param('id')
  if (!isAllowedTable(table)) return c.json({ error: 'Table not found' }, 404)

  try {
    const row = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json(row)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// POST /tables/:table
app.post('/tables/:table', async (c) => {
  const table = c.req.param('table')
  if (!isAllowedTable(table)) return c.json({ error: 'Table not found' }, 404)

  try {
    const body: Record<string, unknown> = await c.req.json()
    const id         = genId()
    const created_at = Date.now()

    if (table === 'trades') {
      await c.env.DB.prepare(`
        INSERT INTO trades
          (id, ticket, symbol, type, lots, open_price, close_price,
           stop_loss, take_profit, profit, commission, swap, pips,
           open_time, close_time, platform, account_id, upload_batch, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        id,
        String(body.ticket      ?? ''),
        String(body.symbol      ?? ''),
        String(body.type        ?? ''),
        Number(body.lots)        || 0,
        Number(body.open_price)  || 0,
        Number(body.close_price) || 0,
        Number(body.stop_loss)   || 0,
        Number(body.take_profit) || 0,
        Number(body.profit)      || 0,
        Number(body.commission)  || 0,
        Number(body.swap)        || 0,
        Number(body.pips)        || 0,
        body.open_time  ? String(body.open_time)  : null,
        body.close_time ? String(body.close_time) : null,
        String(body.platform     ?? ''),
        String(body.account_id   ?? ''),
        String(body.upload_batch ?? ''),
        created_at
      ).run()
    } else if (table === 'upload_history') {
      await c.env.DB.prepare(`
        INSERT INTO upload_history
          (id, filename, platform, account, period_start, period_end,
           total_trades, total_profit, upload_note, batch_id, initial_balance, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        id,
        String(body.filename        ?? ''),
        String(body.platform        ?? ''),
        String(body.account         ?? ''),
        body.period_start ? String(body.period_start) : null,
        body.period_end   ? String(body.period_end)   : null,
        Number(body.total_trades)   || 0,
        Number(body.total_profit)   || 0,
        body.upload_note ? String(body.upload_note) : null,
        String(body.batch_id        ?? ''),
        body.initial_balance != null ? Number(body.initial_balance) : null,
        created_at
      ).run()
    }

    const inserted = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first()
    return c.json(inserted, 201)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// PATCH /tables/:table/:id
app.patch('/tables/:table/:id', async (c) => {
  const table = c.req.param('table')
  const id    = c.req.param('id')
  if (!isAllowedTable(table)) return c.json({ error: 'Table not found' }, 404)

  try {
    const body: Record<string, unknown> = await c.req.json()
    const keys = Object.keys(body).filter(k => k !== 'id' && k !== 'created_at')
    if (keys.length === 0) return c.json({ error: 'No fields to update' }, 400)

    const sets   = keys.map(k => `${k} = ?`).join(', ')
    const values = keys.map(k => body[k])

    await c.env.DB.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`)
      .bind(...values, id).run()

    const updated = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first()
    return c.json(updated)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// DELETE /tables/:table/:id
app.delete('/tables/:table/:id', async (c) => {
  const table = c.req.param('table')
  const id    = c.req.param('id')
  if (!isAllowedTable(table)) return c.json({ error: 'Table not found' }, 404)

  try {
    await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run()
    return c.json({ success: true, id })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// DELETE /tables/:table?batch_id=xxx  (배치 일괄 삭제)
app.delete('/tables/:table', async (c) => {
  const table = c.req.param('table')
  if (!isAllowedTable(table)) return c.json({ error: 'Table not found' }, 404)

  const url     = new URL(c.req.url)
  const batchId = url.searchParams.get('batch_id')
  if (!batchId) return c.json({ error: 'batch_id required' }, 400)

  try {
    const result = await c.env.DB.prepare(
      `DELETE FROM ${table} WHERE upload_batch = ?`
    ).bind(batchId).run()
    return c.json({ success: true, deleted: result.meta?.changes ?? 0 })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// ─── Health ────────────────────────────────────────────────────
app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }))

// ════════════════════════════════════════════════════════════════
//  BATCH INSERT  — POST /api/trades/batch
//  body: { trades: Trade[], upload_history: UploadHistory }
//  D1 batch() API로 한 번에 최대 100건씩 INSERT → 속도 10~20배 향상
// ════════════════════════════════════════════════════════════════
app.post('/api/trades/batch', async (c) => {
  try {
    const body = await c.req.json() as {
      trades: Record<string, unknown>[]
      upload_history: Record<string, unknown>
    }
    const trades  = body.trades  || []
    const history = body.upload_history

    if (!Array.isArray(trades) || trades.length === 0) {
      return c.json({ error: 'trades array is required' }, 400)
    }

    const created_at = Date.now()
    const CHUNK = 100  // D1 batch() 한 번에 최대 100 statements

    let totalInserted = 0

    // ── trades 청크별 배치 INSERT ──────────────────────────────
    for (let i = 0; i < trades.length; i += CHUNK) {
      const chunk = trades.slice(i, i + CHUNK)
      const stmts = chunk.map(trade => {
        const id = genId()
        return c.env.DB.prepare(`
          INSERT INTO trades
            (id, ticket, symbol, type, lots, open_price, close_price,
             stop_loss, take_profit, profit, commission, swap, pips,
             open_time, close_time, platform, account_id, upload_batch, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).bind(
          id,
          String(trade.ticket      ?? ''),
          String(trade.symbol      ?? ''),
          String(trade.type        ?? ''),
          Number(trade.lots)        || 0,
          Number(trade.open_price)  || 0,
          Number(trade.close_price) || 0,
          Number(trade.stop_loss)   || 0,
          Number(trade.take_profit) || 0,
          Number(trade.profit)      || 0,
          Number(trade.commission)  || 0,
          Number(trade.swap)        || 0,
          Number(trade.pips)        || 0,
          trade.open_time  ? String(trade.open_time)  : null,
          trade.close_time ? String(trade.close_time) : null,
          String(trade.platform     ?? ''),
          String(trade.account_id   ?? ''),
          String(trade.upload_batch ?? ''),
          created_at
        )
      })
      await c.env.DB.batch(stmts)
      totalInserted += chunk.length
    }

    // ── upload_history 1건 INSERT ─────────────────────────────
    if (history) {
      const hid = genId()
      await c.env.DB.prepare(`
        INSERT INTO upload_history
          (id, filename, platform, account, period_start, period_end,
           total_trades, total_profit, upload_note, batch_id, initial_balance, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        hid,
        String(history.filename        ?? ''),
        String(history.platform        ?? ''),
        String(history.account         ?? ''),
        history.period_start ? String(history.period_start) : null,
        history.period_end   ? String(history.period_end)   : null,
        Number(history.total_trades)   || 0,
        Number(history.total_profit)   || 0,
        history.upload_note ? String(history.upload_note) : null,
        String(history.batch_id        ?? ''),
        history.initial_balance != null ? Number(history.initial_balance) : null,
        created_at
      ).run()
    }

    return c.json({ ok: true, inserted: totalInserted }, 201)
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

// ════════════════════════════════════════════════════════════════
//  KV STORE  — GET /api/kv/:key  / PUT /api/kv/:key
//  인증 불필요 키: capital, note:comment:*
//  인증 필요 키:   admin:*, note:comment:* (PUT만)
// ════════════════════════════════════════════════════════════════
// 인증 불필요한 공개 읽기 키 목록
const PUBLIC_READ_KEYS = ['capital']

function kvKeyAllowed(key: string): boolean {
  // 허용 패턴: capital, note:comment:*, admin:pw_hash, admin:secret_hash, admin:secret_q
  return /^(capital|note:comment:[^/]+|admin:(pw_hash|secret_hash|secret_q))$/.test(key)
}

app.get('/api/kv/:key', async (c) => {
  try {
    const key = c.req.param('key')
    if (!kvKeyAllowed(key)) return c.json({ ok: false, error: 'Forbidden key' }, 403)
    const row = await c.env.DB.prepare(
      `SELECT value FROM notes WHERE key = ? LIMIT 1`
    ).bind(key).first<{ value: string }>()
    return c.json({ ok: true, value: row?.value ?? null })
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

// 공개 쓰기 허용 키 (capital, note:comment:*)는 인증 없이 PUT 가능
// admin:* 키는 현재 pw_hash 검증 필요
app.put('/api/kv/:key', async (c) => {
  try {
    const key  = c.req.param('key')
    if (!kvKeyAllowed(key)) return c.json({ ok: false, error: 'Forbidden key' }, 403)

    const body = await c.req.json() as { value: string; pw_hash?: string }

    // admin:* 키 쓰기는 현재 비밀번호 해시 검증 필요
    if (key.startsWith('admin:')) {
      const storedPw = await c.env.DB.prepare(
        `SELECT value FROM notes WHERE key = 'admin:pw_hash' LIMIT 1`
      ).first<{ value: string }>()

      // 최초 설정이면 패스 (pw_hash 없음)
      if (storedPw?.value && body.pw_hash !== storedPw.value) {
        return c.json({ ok: false, error: 'Unauthorized' }, 401)
      }
    }

    await c.env.DB.prepare(`
      INSERT INTO notes (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(key, String(body.value ?? ''), Date.now()).run()

    return c.json({ ok: true })
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

// ════════════════════════════════════════════════════════════════
//  ADMIN AUTH  — POST /api/admin/login
//               POST /api/admin/setup   (최초 설정)
//               POST /api/admin/reset   (비밀 답변으로 재설정)
// ════════════════════════════════════════════════════════════════
app.post('/api/admin/login', async (c) => {
  try {
    const { pw_hash } = await c.req.json() as { pw_hash: string }
    const stored = await c.env.DB.prepare(
      `SELECT value FROM notes WHERE key = 'admin:pw_hash' LIMIT 1`
    ).first<{ value: string }>()

    if (!stored?.value) {
      // 미설정 상태 → 설정 필요
      return c.json({ ok: false, needSetup: true })
    }
    if (pw_hash !== stored.value) {
      return c.json({ ok: false, error: 'Wrong password' }, 401)
    }
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

app.post('/api/admin/setup', async (c) => {
  try {
    const { pw_hash, secret_q, secret_hash } = await c.req.json() as {
      pw_hash: string; secret_q: string; secret_hash: string
    }
    // 이미 설정됐는지 확인
    const existing = await c.env.DB.prepare(
      `SELECT value FROM notes WHERE key = 'admin:pw_hash' LIMIT 1`
    ).first<{ value: string }>()
    if (existing?.value) {
      return c.json({ ok: false, error: 'Already configured. Use /api/admin/reset.' }, 409)
    }
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO notes (key,value,updated_at) VALUES ('admin:pw_hash',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(pw_hash, Date.now()),
      c.env.DB.prepare(`INSERT INTO notes (key,value,updated_at) VALUES ('admin:secret_q',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(secret_q, Date.now()),
      c.env.DB.prepare(`INSERT INTO notes (key,value,updated_at) VALUES ('admin:secret_hash',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(secret_hash, Date.now()),
    ])
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

app.post('/api/admin/reset', async (c) => {
  try {
    const { secret_hash, new_pw_hash } = await c.req.json() as {
      secret_hash: string; new_pw_hash: string
    }
    const stored = await c.env.DB.prepare(
      `SELECT value FROM notes WHERE key = 'admin:secret_hash' LIMIT 1`
    ).first<{ value: string }>()
    if (!stored?.value || secret_hash !== stored.value) {
      return c.json({ ok: false, error: 'Wrong answer' }, 401)
    }
    await c.env.DB.prepare(
      `INSERT INTO notes (key,value,updated_at) VALUES ('admin:pw_hash',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`
    ).bind(new_pw_hash, Date.now()).run()
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

// ─── Ticker Proxy  GET /api/ticker ────────────────────────────
// 전략:
//   1차: Yahoo Finance (안정적, 무료, 키 불필요)
//   2차: open.er-api.com (환율 fallback)
const TICKER_SYMBOLS: { sym: string; label: string; type: 'index'|'commodity'|'fx' }[] = [
  { sym: '^GSPC',  label: 'S&P 500',  type: 'index'     },
  { sym: '^NDX',   label: '나스닥',    type: 'index'     },
  { sym: '^DJI',   label: '다우',      type: 'index'     },
  { sym: 'GC=F',   label: '금',        type: 'commodity' },
  { sym: 'CL=F',   label: 'WTI',       type: 'commodity' },
  { sym: 'KRW=X',  label: '원/달러',   type: 'fx'        },
]

// Yahoo Finance v8 chart API에서 단일 심볼 가져오기
// 반환: { price, prevClose } — 변화율은 전일 종가 기준으로 계산
async function fetchYahoo(sym: string): Promise<{ price: number; prevClose: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2d`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'application/json,text/plain,*/*',
      },
    })
    if (!res.ok) return null
    const json = await res.json() as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number
            chartPreviousClose?: number
            previousClose?: number
          }
        }>
      }
    }
    const meta = json?.chart?.result?.[0]?.meta
    if (!meta) return null
    const price = meta.regularMarketPrice
    const prevClose = meta.chartPreviousClose ?? meta.previousClose
    if (typeof price !== 'number' || typeof prevClose !== 'number') return null
    return { price, prevClose }
  } catch {
    return null
  }
}

app.get('/api/ticker', async (c) => {
  try {
    // 1차: Yahoo Finance 병렬 요청
    const results = await Promise.all(
      TICKER_SYMBOLS.map(async ({ sym, label, type }) => {
        const data = await fetchYahoo(sym)
        if (!data) return null
        const { price, prevClose } = data
        const change    = price - prevClose
        const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0
        return { sym, label, type, price, change, changePct }
      })
    )

    // 2차 fallback: 환율(KRW=X)만 open.er-api.com으로 대체
    const finalResults = await Promise.all(
      results.map(async (item, idx) => {
        if (item !== null) return item
        const { sym, label, type } = TICKER_SYMBOLS[idx]

        if (sym === 'KRW=X') {
          try {
            const res = await fetch('https://open.er-api.com/v6/latest/USD', {
              headers: { 'Accept': 'application/json' }
            })
            const json = await res.json() as { rates?: Record<string, number> }
            const price = json.rates?.['KRW']
            if (price) {
              return { sym, label, type, price, change: 0, changePct: 0 }
            }
          } catch { /* skip */ }
        }
        return null
      })
    )

    const data = finalResults.filter(Boolean)
    return c.json({ ok: true, data, ts: Date.now() }, 200, {
      'Cache-Control': 'public, max-age=60'
    })
  } catch (e) {
    return c.json({ ok: false, error: String(e), data: [] }, 500)
  }
})

// ─── Ticker Debug  GET /api/ticker-debug ──────────────────────
app.get('/api/ticker-debug', async (c) => {
  const results: Record<string, unknown> = {}
  for (const { sym } of TICKER_SYMBOLS) {
    try {
      const data = await fetchYahoo(sym)
      results[sym] = data ? { ok: true, ...data } : { ok: false, error: 'no data' }
    } catch(e) {
      results[sym] = { error: String(e) }
    }
  }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD')
    const json = await res.json() as { rates?: Record<string, number> }
    results['open.er-api/KRW'] = { status: res.status, krw: json.rates?.['KRW'] }
  } catch(e) {
    results['open.er-api/KRW'] = { error: String(e) }
  }
  return c.json(results)
})

// ════════════════════════════════════════════════════════════════
//  CANDLES API  — XAUUSD OHLC 데이터 수집/캐싱
// ════════════════════════════════════════════════════════════════

type Candle = { ts: number; o: number; h: number; l: number; c: number; v?: number }

// ─── Twelve Data 1분봉 fetcher (429 자동 재시도) ──────────────
// XAU/USD 1분봉, 한 번에 5000봉까지 (무료 플랜: 분당 8회, 일일 800회)
async function fetchTwelveData(
  apiKey: string,
  symbol: string,         // 'XAU/USD'
  interval: string,       // '1min','5min','15min','1h','1day'
  startISO: string,       // 'YYYY-MM-DD HH:mm:ss' UTC
  endISO: string,
  outputsize = 5000
): Promise<Candle[]> {
  const url = new URL('https://api.twelvedata.com/time_series')
  url.searchParams.set('symbol', symbol)
  url.searchParams.set('interval', interval)
  url.searchParams.set('start_date', startISO)
  url.searchParams.set('end_date', endISO)
  url.searchParams.set('outputsize', String(outputsize))
  url.searchParams.set('format', 'JSON')
  url.searchParams.set('timezone', 'UTC')
  url.searchParams.set('apikey', apiKey)

  // ⚠️ 서버 안에서 오래 대기하지 않는다 (Cloudflare Workers CPU 제한).
  //    재시도/페이싱은 클라이언트가 전담. 429는 즉시 표면화하여
  //    클라이언트가 backoff 후 같은 청크를 재시도하도록 한다.
  const res = await fetch(url.toString())
  if (res.status === 429) {
    const err = new Error('TwelveData 429 rate limit') as Error & { code?: number }
    err.code = 429
    throw err
  }
  if (!res.ok) throw new Error(`TwelveData HTTP ${res.status}`)
  const json = await res.json() as {
    status?: string; code?: number; message?: string;
    values?: Array<{ datetime: string; open: string; high: string; low: string; close: string; volume?: string }>
  }
  if (json.status === 'error') {
    const err = new Error(`TwelveData: ${json.message || 'unknown error'} (code ${json.code || '?'})`) as Error & { code?: number }
    err.code = json.code
    throw err
  }
  if (!Array.isArray(json.values)) return []
  return json.values.map(v => ({
    // 'YYYY-MM-DD HH:mm:ss' (UTC) → epoch seconds
    ts: Math.floor(Date.parse(v.datetime.replace(' ', 'T') + 'Z') / 1000),
    o: parseFloat(v.open),
    h: parseFloat(v.high),
    l: parseFloat(v.low),
    c: parseFloat(v.close),
    v: v.volume ? parseFloat(v.volume) : 0
  })).filter(c => !isNaN(c.o) && !isNaN(c.c)).sort((a, b) => a.ts - b.ts)
}

// ─── Stooq XAUUSD 시간봉/일봉 (API 키 불필요, 백업용) ─────────
// Stooq는 일봉 위주이지만 hourly도 일부 제공
async function fetchStooqOHLC(
  symbol: string,    // 'xauusd'
  interval: 'd' | 'w' | 'm'   // d=daily,w=weekly,m=monthly
): Promise<Candle[]> {
  const url = `https://stooq.com/q/d/l/?s=${symbol}&i=${interval}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'text/csv,text/plain,*/*',
      'Referer': 'https://stooq.com/'
    }
  })
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`)
  const text = await res.text()
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  // header: Date,Open,High,Low,Close,Volume
  const candles: Candle[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols.length < 5) continue
    const ts = Math.floor(Date.parse(cols[0] + 'T00:00:00Z') / 1000)
    const o = parseFloat(cols[1]), h = parseFloat(cols[2]), l = parseFloat(cols[3]), cP = parseFloat(cols[4])
    if (isNaN(ts) || isNaN(o)) continue
    candles.push({ ts, o, h, l, c: cP, v: cols[5] ? parseFloat(cols[5]) : 0 })
  }
  return candles.sort((a, b) => a.ts - b.ts)
}

// ─── 캐시에서 캔들 조회 ─────────────────────────────────────
// GET /api/candles?symbol=XAUUSD&tf=M1&from=1735689600&to=1748908800
app.get('/api/candles', async (c) => {
  const url = new URL(c.req.url)
  const symbol    = (url.searchParams.get('symbol') || 'XAUUSD').toUpperCase()
  const timeframe = (url.searchParams.get('tf') || 'M1').toUpperCase()
  const from = parseInt(url.searchParams.get('from') || '0')
  const to   = parseInt(url.searchParams.get('to')   || String(Math.floor(Date.now() / 1000)))
  try {
    const rows = await c.env.DB.prepare(`
      SELECT ts_utc as ts, open as o, high as h, low as l, close as c, volume as v
      FROM candles
      WHERE symbol=? AND timeframe=? AND ts_utc>=? AND ts_utc<=?
      ORDER BY ts_utc ASC
      LIMIT 800000
    `).bind(symbol, timeframe, from, to).all<Candle>()

    const meta = await c.env.DB.prepare(`
      SELECT from_ts, to_ts, count, last_fetch, source FROM candle_meta
      WHERE symbol=? AND timeframe=?
    `).bind(symbol, timeframe).first()

    return c.json({ ok: true, data: rows.results || [], meta: meta || null, count: rows.results?.length || 0 })
  } catch (e) {
    return c.json({ ok: false, error: String(e), data: [] }, 500)
  }
})

// ─── DB 저장 헬퍼 ───────────────────────────────
async function saveCandlesToDb(
  db: D1Database, symbol: string, timeframe: string,
  candles: Candle[], source: string
): Promise<number> {
  if (!candles.length) return 0
  // 중복 제거
  const map = new Map<number, Candle>()
  candles.forEach(k => map.set(k.ts, k))
  const unique = Array.from(map.values()).sort((a, b) => a.ts - b.ts)

  let inserted = 0
  // D1 SQL 변수 한도 ≤ 100 → 9컬럼 × 10행 = 90개 (안전)
  const CHUNK = 10
  // batch()로 묶어 일괄 실행 (트랜잭션 비용 절감)
  for (let i = 0; i < unique.length; i += 500) {
    const big = unique.slice(i, i + 500)
    const stmts: D1PreparedStatement[] = []
    for (let j = 0; j < big.length; j += CHUNK) {
      const part = big.slice(j, j + CHUNK)
      const placeholders = part.map(() => '(?,?,?,?,?,?,?,?,?)').join(',')
      const values: (string | number)[] = []
      part.forEach(k => {
        values.push(symbol, timeframe, k.ts, k.o, k.h, k.l, k.c, k.v || 0, source)
      })
      stmts.push(db.prepare(`
        INSERT OR REPLACE INTO candles
          (symbol, timeframe, ts_utc, open, high, low, close, volume, source)
        VALUES ${placeholders}
      `).bind(...values))
    }
    await db.batch(stmts)
    inserted += big.length
  }
  // meta 업데이트
  const first = unique[0].ts, last = unique[unique.length - 1].ts
  await db.prepare(`
    INSERT INTO candle_meta (symbol, timeframe, from_ts, to_ts, count, last_fetch, source)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(symbol, timeframe) DO UPDATE SET
      from_ts    = MIN(from_ts, excluded.from_ts),
      to_ts      = MAX(to_ts,   excluded.to_ts),
      count      = count + excluded.count,
      last_fetch = excluded.last_fetch,
      source     = excluded.source
  `).bind(symbol, timeframe, first, last, inserted, Math.floor(Date.now() / 1000), source).run()
  return inserted
}

// ─── 캔들 데이터 fetch 계획 (청크 분할) ───────────────────────
// POST /api/candles/plan
// body: { timeframe, from, to } → 청크 배열 반환
app.post('/api/candles/plan', async (c) => {
  try {
    const body = await c.req.json() as {
      timeframe?: string; from: number; to: number;
      symbol?: string;
      skipCached?: boolean;
    }
    const timeframe = (body.timeframe || 'M1').toUpperCase()
    const symbol = (body.symbol || 'XAUUSD').toUpperCase()
    const from = body.from, to = body.to
    if (!from || !to || to <= from) return c.json({ ok:false, error:'invalid range' }, 400)

    // 청크 크기 (초 단위) — Twelve Data 5000봉 제한 기준
    const chunkSec: Record<string, number> = {
      M1:  3 * 86400,     // 3일 (≈ 4320봉)
      M5: 14 * 86400,     // 14일
      M15: 40 * 86400,
      H1: 200 * 86400,
      D1: 5000 * 86400
    }
    const step = chunkSec[timeframe] || 3 * 86400

    // 캐시된 구간 확인 (skipCached=true 인 경우)
    let cached: Array<{ from:number; to:number }> = []
    if (body.skipCached) {
      const rows = await c.env.DB.prepare(`
        SELECT MIN(ts_utc) as mn, MAX(ts_utc) as mx FROM candles
        WHERE symbol=? AND timeframe=? AND ts_utc>=? AND ts_utc<=?
      `).bind(symbol, timeframe, from, to).first<{mn:number; mx:number}>()
      if (rows && rows.mn && rows.mx) {
        cached = [{ from: rows.mn, to: rows.mx }]
      }
    }

    const chunks: Array<{ from:number; to:number; startISO:string; endISO:string }> = []
    let cursor = from
    while (cursor < to) {
      const chunkTo = Math.min(cursor + step, to)
      // 캐시된 구간과 완전히 겹치면 skip
      const fullyCovered = cached.some(c => cursor >= c.from && chunkTo <= c.to)
      if (!fullyCovered) {
        chunks.push({
          from: cursor,
          to: chunkTo,
          startISO: new Date(cursor * 1000).toISOString().slice(0, 19).replace('T', ' '),
          endISO:   new Date(chunkTo * 1000).toISOString().slice(0, 19).replace('T', ' ')
        })
      }
      cursor = chunkTo
    }
    return c.json({ ok:true, chunks, total: chunks.length })
  } catch (e) {
    return c.json({ ok:false, error: String(e) }, 500)
  }
})

// ─── 캔들 데이터 fetch (1청크만 처리) ─────────────────────────
// POST /api/candles/fetch
// body: { source, apiKey?, symbol, timeframe, from, to } → 단일 청크 fetch
app.post('/api/candles/fetch', async (c) => {
  try {
    const body = await c.req.json() as {
      source: 'twelvedata' | 'stooq'
      apiKey?: string
      symbol?: string
      timeframe?: string
      from: number
      to: number
    }
    const symbol    = (body.symbol || 'XAUUSD').toUpperCase()
    const timeframe = (body.timeframe || 'M1').toUpperCase()
    const from = body.from, to = body.to
    if (!from || !to || to <= from) {
      return c.json({ ok: false, error: 'invalid from/to' }, 400)
    }

    let candles: Candle[] = []
    const source = body.source

    if (body.source === 'twelvedata') {
      if (!body.apiKey) return c.json({ ok: false, error: 'apiKey required' }, 400)
      const tfMap: Record<string, string> = { M1:'1min', M5:'5min', M15:'15min', H1:'1h', D1:'1day' }
      const interval = tfMap[timeframe] || '1min'
      const startISO = new Date(from * 1000).toISOString().slice(0, 19).replace('T', ' ')
      const endISO   = new Date(to * 1000).toISOString().slice(0, 19).replace('T', ' ')
      // 단일 청크만 — 클라이언트가 반복 호출 + 대기
      candles = await fetchTwelveData(body.apiKey, 'XAU/USD', interval, startISO, endISO, 5000)
    } else if (body.source === 'stooq') {
      const sym = symbol === 'XAUUSD' ? 'xauusd' : symbol.toLowerCase()
      const all = await fetchStooqOHLC(sym, 'd')
      candles = all.filter(k => k.ts >= from && k.ts <= to)
    } else {
      return c.json({ ok: false, error: 'unsupported source' }, 400)
    }

    if (!candles.length) {
      // 빈 청크(주말/장마감) — 클라이언트가 대기 없이 다음으로 넘어가도록 empty 플래그
      return c.json({ ok: true, inserted: 0, empty: true, message: 'no candles returned', source })
    }

    const inserted = await saveCandlesToDb(c.env.DB, symbol, timeframe, candles, source)
    return c.json({
      ok: true,
      inserted,
      empty: false,
      from: candles[0].ts,
      to: candles[candles.length-1].ts,
      source
    })
  } catch (e) {
    const code = (e as { code?: number })?.code
    // 429(rate limit)는 클라이언트가 재시도할 수 있도록 명시적으로 전달
    if (code === 429) {
      return c.json({ ok: false, error: 'rate_limit', code: 429, retryable: true }, 429)
    }
    return c.json({ ok: false, error: String(e), retryable: true }, 500)
  }
})

// ─── 캔들 데이터 업로드 (CSV) ───────────────────────────────
// POST /api/candles/upload  body: { symbol, timeframe, candles: [{ts,o,h,l,c,v}] }
app.post('/api/candles/upload', async (c) => {
  try {
    const body = await c.req.json() as {
      symbol?: string
      timeframe?: string
      candles: Array<{ ts: number; o: number; h: number; l: number; c: number; v?: number }>
    }
    const symbol    = (body.symbol || 'XAUUSD').toUpperCase()
    const timeframe = (body.timeframe || 'M1').toUpperCase()
    const all = (body.candles || []).filter(k => k.ts && !isNaN(k.o)).sort((a, b) => a.ts - b.ts)
    if (!all.length) return c.json({ ok: false, error: 'no candles' }, 400)

    const inserted = await saveCandlesToDb(c.env.DB, symbol, timeframe, all, 'upload')
    const first = all[0].ts, last = all[all.length - 1].ts
    return c.json({ ok: true, inserted, from: first, to: last })
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

// ─── 캔들 데이터 삭제 (관리용) ───────────────────────────────
app.delete('/api/candles', async (c) => {
  const url = new URL(c.req.url)
  const symbol    = (url.searchParams.get('symbol') || 'XAUUSD').toUpperCase()
  const timeframe = url.searchParams.get('tf')?.toUpperCase()
  try {
    if (timeframe) {
      await c.env.DB.prepare(`DELETE FROM candles WHERE symbol=? AND timeframe=?`).bind(symbol, timeframe).run()
      await c.env.DB.prepare(`DELETE FROM candle_meta WHERE symbol=? AND timeframe=?`).bind(symbol, timeframe).run()
    } else {
      await c.env.DB.prepare(`DELETE FROM candles WHERE symbol=?`).bind(symbol).run()
      await c.env.DB.prepare(`DELETE FROM candle_meta WHERE symbol=?`).bind(symbol).run()
    }
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

// ─── Static asset fallback (Cloudflare Pages ASSETS) ──────────
// API 라우트에 매칭되지 않는 모든 요청은 Pages 정적 파일로 전달
app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw)
  }
  return c.text('Not Found', 404)
})

export default app
