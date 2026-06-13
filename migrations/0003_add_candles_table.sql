-- XAUUSD 1분봉/시간봉 OHLC 캐시 테이블
-- Dukascopy/Twelve Data에서 fetch한 데이터를 캐싱

CREATE TABLE IF NOT EXISTS candles (
  symbol     TEXT    NOT NULL,            -- 'XAUUSD'
  timeframe  TEXT    NOT NULL,            -- 'M1','M5','H1','D1'
  ts_utc     INTEGER NOT NULL,            -- 봉 시작시각 (Unix epoch seconds, UTC)
  open       REAL    NOT NULL,
  high       REAL    NOT NULL,
  low        REAL    NOT NULL,
  close      REAL    NOT NULL,
  volume     REAL    DEFAULT 0,
  source     TEXT    DEFAULT 'dukascopy', -- 'dukascopy' | 'twelvedata' | 'upload'
  PRIMARY KEY (symbol, timeframe, ts_utc)
);

CREATE INDEX IF NOT EXISTS idx_candles_lookup
  ON candles (symbol, timeframe, ts_utc);

-- 데이터 수집 메타 정보 (어느 구간까지 채워졌나)
CREATE TABLE IF NOT EXISTS candle_meta (
  symbol     TEXT NOT NULL,
  timeframe  TEXT NOT NULL,
  from_ts    INTEGER,    -- 캐싱된 최소 시각
  to_ts      INTEGER,    -- 캐싱된 최대 시각
  count      INTEGER DEFAULT 0,
  last_fetch INTEGER,    -- 마지막 fetch 시각
  source     TEXT,
  PRIMARY KEY (symbol, timeframe)
);
