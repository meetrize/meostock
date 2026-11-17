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
  history_exhausted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (market, symbol, period)
);

-- Tushare 专题切片（按 market_id + trade_date）
CREATE TABLE IF NOT EXISTS ts_snapshot (
  market_id TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  table_kind TEXT NOT NULL DEFAULT 'topic',
  label TEXT NOT NULL DEFAULT '',
  columns_json TEXT NOT NULL DEFAULT '[]',
  items_json TEXT NOT NULL DEFAULT '[]',
  row_count INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  as_of REAL,
  synced_at REAL NOT NULL,
  etag TEXT,
  PRIMARY KEY (market_id, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_ts_snapshot_synced ON ts_snapshot (market_id, synced_at);

CREATE TABLE IF NOT EXISTS ts_market_meta (
  market_id TEXT PRIMARY KEY,
  last_trade_date TEXT,
  as_of REAL,
  synced_at REAL,
  row_count INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  sync_state TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT
);

-- 多源板块/概念目录（eastmoney|ths × concept|industry|region）
CREATE TABLE IF NOT EXISTS board_catalog (
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  extra_json TEXT,
  updated_at REAL NOT NULL,
  PRIMARY KEY (source, kind, code)
);

CREATE INDEX IF NOT EXISTS idx_board_catalog_kind ON board_catalog (kind, source);
CREATE INDEX IF NOT EXISTS idx_board_catalog_name_key ON board_catalog (name_key);

-- 个股所属板块/概念（已去重，sources_json 记录来源）
CREATE TABLE IF NOT EXISTS stock_board_map (
  code TEXT NOT NULL,
  name_key TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  sources_json TEXT NOT NULL DEFAULT '[]',
  updated_at REAL NOT NULL,
  PRIMARY KEY (code, name_key, kind)
);

CREATE INDEX IF NOT EXISTS idx_stock_board_map_code_kind ON stock_board_map (code, kind);
CREATE INDEX IF NOT EXISTS idx_stock_board_map_kind_name ON stock_board_map (kind, name_key);

-- 板块/概念同步进度
CREATE TABLE IF NOT EXISTS board_sync_meta (
  key TEXT PRIMARY KEY,
  synced_at REAL,
  row_count INTEGER NOT NULL DEFAULT 0,
  sync_state TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT,
  progress_done INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  detail_json TEXT
);

-- 通用定时任务
CREATE TABLE IF NOT EXISTS scheduled_job (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  job_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  interval_minutes INTEGER NOT NULL DEFAULT 360,
  last_run_at REAL,
  next_run_at REAL,
  last_status TEXT,
  last_error TEXT,
  last_result_json TEXT,
  updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_job_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  started_at REAL NOT NULL,
  finished_at REAL,
  status TEXT NOT NULL,
  message TEXT,
  detail_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_scheduled_job_run_job ON scheduled_job_run (job_id, started_at DESC);
