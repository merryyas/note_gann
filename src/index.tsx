import { Hono } from 'hono'
import { cors } from 'hono/cors'

// ─── Bindings ────────────────────────────────────────────────
type Bindings = {
  DB: D1Database
  ASSETS: Fetcher
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

// ─── Static asset fallback (Cloudflare Pages ASSETS) ──────────
// API 라우트에 매칭되지 않는 모든 요청은 Pages 정적 파일로 전달
app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw)
  }
  return c.text('Not Found', 404)
})

export default app
