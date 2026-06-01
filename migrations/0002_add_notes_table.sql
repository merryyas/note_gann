-- 노트 자본금/코멘트를 서버에 저장하는 key-value 테이블
CREATE TABLE IF NOT EXISTS notes (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);
