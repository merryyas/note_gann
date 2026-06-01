-- 334 TRADINGLOG — Initial Schema
-- Migration: 0001_initial_schema.sql

-- ── trades 테이블 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trades (
  id           TEXT    PRIMARY KEY,
  ticket       TEXT    NOT NULL DEFAULT '',
  symbol       TEXT    NOT NULL DEFAULT '',
  type         TEXT    NOT NULL DEFAULT '',
  lots         REAL    NOT NULL DEFAULT 0,
  open_price   REAL    NOT NULL DEFAULT 0,
  close_price  REAL    NOT NULL DEFAULT 0,
  stop_loss    REAL             DEFAULT 0,
  take_profit  REAL             DEFAULT 0,
  profit       REAL    NOT NULL DEFAULT 0,
  commission   REAL             DEFAULT 0,
  swap         REAL             DEFAULT 0,
  pips         REAL             DEFAULT 0,
  open_time    TEXT,
  close_time   TEXT,
  platform     TEXT             DEFAULT '',
  account_id   TEXT             DEFAULT '',
  upload_batch TEXT             DEFAULT '',
  created_at   INTEGER          DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_trades_symbol       ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_platform     ON trades(platform);
CREATE INDEX IF NOT EXISTS idx_trades_upload_batch ON trades(upload_batch);
CREATE INDEX IF NOT EXISTS idx_trades_close_time   ON trades(close_time);

-- ── upload_history 테이블 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS upload_history (
  id              TEXT    PRIMARY KEY,
  filename        TEXT             DEFAULT '',
  platform        TEXT             DEFAULT '',
  account         TEXT             DEFAULT '',
  period_start    TEXT,
  period_end      TEXT,
  total_trades    INTEGER          DEFAULT 0,
  total_profit    REAL             DEFAULT 0,
  upload_note     TEXT,
  batch_id        TEXT             DEFAULT '',
  initial_balance REAL,
  created_at      INTEGER          DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_upload_history_batch_id ON upload_history(batch_id);
