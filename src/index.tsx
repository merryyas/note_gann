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
//   1차: Stooq CSV (헤더 행 없음 — lines[0]이 데이터)
//   2차: open.er-api.com (환율 fallback)
//   3차: 하드코딩 fallback (전날 종가)
const TICKER_SYMBOLS: { sym: string; label: string; type: 'index'|'commodity'|'fx' }[] = [
  { sym: '^spx',   label: 'S&P 500',  type: 'index'     },
  { sym: '^ndx',   label: '나스닥',    type: 'index'     },
  { sym: '^dji',   label: '다우',      type: 'index'     },
  { sym: 'gc.f',   label: '금',        type: 'commodity' },
  { sym: 'cl.f',   label: 'WTI',       type: 'commodity' },
  { sym: 'usdkrw', label: '원/달러',   type: 'fx'        },
]

// Stooq에서 단일 심볼 가져오기
async function fetchStooq(sym: string): Promise<{ price: number; open: number } | null> {
  try {
    const encoded = encodeURIComponent(sym)
    const url = `https://stooq.com/q/l/?s=${encoded}&f=sd2t2ohlcv&e=csv`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/csv,text/plain,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://stooq.com/',
      },
      // CF Workers에서 자동으로 붙는 CF 헤더 제거 시도
      cf: { cacheEverything: false } as never,
    })
    if (!res.ok) return null
    const text = await res.text()
    // Stooq CSV: 헤더 행 없음. 첫 줄이 바로 데이터
    // 형식: SYMBOL,DATE,TIME,OPEN,HIGH,LOW,CLOSE,VOLUME
    const line = text.trim().split('\n')[0]
    if (!line || line.startsWith('Symbol')) return null  // 혹시 헤더가 있으면 skip
    const cols = line.split(',')
    if (cols.length < 7) return null
    const price = parseFloat(cols[6])
    const open  = parseFloat(cols[3])
    if (isNaN(price) || isNaN(open)) return null
    return { price, open }
  } catch {
    return null
  }
}

app.get('/api/ticker', async (c) => {
  try {
    // 1차: Stooq 병렬 요청
    const results = await Promise.all(
      TICKER_SYMBOLS.map(async ({ sym, label, type }) => {
        const data = await fetchStooq(sym)
        if (!data) return null
        const { price, open } = data
        const change    = price - open
        const changePct = open > 0 ? (change / open) * 100 : 0
        return { sym, label, type, price, change, changePct }
      })
    )

    // 2차 fallback: 환율(usdkrw)만 open.er-api.com으로 대체
    const finalResults = await Promise.all(
      results.map(async (item, idx) => {
        if (item !== null) return item
        const { sym, label, type } = TICKER_SYMBOLS[idx]

        // 환율 fallback
        if (sym === 'usdkrw') {
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
// Worker에서 Stooq가 실제로 무엇을 반환하는지 확인용
app.get('/api/ticker-debug', async (c) => {
  const results: Record<string, unknown> = {}
  for (const { sym } of TICKER_SYMBOLS.slice(0, 2)) {
    try {
      const url = `https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&e=csv`
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/csv,text/plain,*/*',
          'Referer': 'https://stooq.com/',
        }
      })
      const text = await res.text()
      results[sym] = { status: res.status, bodyPreview: text.slice(0, 200), len: text.length }
    } catch(e) {
      results[sym] = { error: String(e) }
    }
  }
  // open.er-api 도 테스트
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD')
    const json = await res.json() as { rates?: Record<string, number> }
    results['open.er-api/KRW'] = { status: res.status, krw: json.rates?.['KRW'] }
  } catch(e) {
    results['open.er-api/KRW'] = { error: String(e) }
  }
  return c.json(results)
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
