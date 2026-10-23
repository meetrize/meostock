-- 行情本地缓存 schema（SQLite WAL）

CREATE TABLE IF NOT EXISTS cache_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS market_meta (
  market TEXT PRIMARY KEY,
  snapshot_as_of REAL,
  snapshot_synced_at REAL,
  symbols_synced_at REAL,
  row_count INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  sync_state TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT,
  etag TEXT
);

CREATE TABLE IF NOT EXISTS symbol (
  market TEXT NOT NULL,
  code TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  exchange TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  extra_json TEXT,
  updated_at REAL NOT NULL,
  last_seen_at REAL NOT NULL,
  PRIMARY KEY (market, code)
);

CREATE INDEX IF NOT EXISTS idx_symbol_market_status ON symbol (market, status);
CREATE INDEX IF NOT EXISTS idx_symbol_market_name ON symbol (market, name);

CREATE TABLE IF NOT EXISTS quote_snapshot (
  market TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  price REAL,
  change_amt REAL,
  change_percent REAL,
  open REAL,
  prev_close REAL,
  high REAL,
  low REAL,
  volume REAL,
  amount REAL,
  turnover_rate REAL,
  volume_ratio REAL,
  amplitude REAL,
  pe REAL,
  pb REAL,
  total_market_cap REAL,
  circulating_market_cap REAL,
  kline_symbol TEXT,
  quote_ready INTEGER NOT NULL DEFAULT 1,
  as_of REAL,
  source TEXT,
  updated_at REAL NOT NULL,
  PRIMARY KEY (market, code)
);

CREATE INDEX IF NOT EXISTS idx_quote_market_pct ON quote_snapshot (market, change_percent);
CREATE INDEX IF NOT EXISTS idx_quote_market_cap ON quote_snapshot (market, total_market_cap);

-- 二期：按需缓存的 K 线（只存用户打开过的标的）
CREATE TABLE IF NOT EXISTS kline_bar (
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  period TEXT NOT NULL,
  ts INTEGER NOT NULL,
  open REAL,
  high REAL,
  low REAL,
  close REAL,
  volume REAL,
  amount REAL,
  source TEXT,
  PRIMARY KEY (market, symbol, period, ts)
);

CREATE INDEX IF NOT EXISTS idx_kline_lookup ON kline_bar (market, symbol, period, ts);

CREATE TABLE IF NOT EXISTS kline_meta (
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  period TEXT NOT NULL,
  name TEXT,
  as_of REAL,
  synced_at REAL,
  bar_count INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  sync_state TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT,
  last_access_at REAL,
  PRIMARY KEY (market, symbol, period)
);
