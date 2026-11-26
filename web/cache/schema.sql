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

-- 东财财经日历
CREATE TABLE IF NOT EXISTS finance_calendar_event (
  fe_code TEXT PRIMARY KEY,
  start_at TEXT NOT NULL,
  end_at TEXT,
  start_ts REAL,
  name TEXT NOT NULL DEFAULT '',
  sponsor TEXT,
  city TEXT,
  fe_type TEXT,
  std_type_code TEXT,
  content TEXT,
  content_hash TEXT,
  importance INTEGER,
  importance_reason TEXT,
  importance_rated_at REAL,
  source TEXT NOT NULL DEFAULT 'eastmoney',
  first_seen_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  synced_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cal_event_start ON finance_calendar_event (start_ts);
CREATE INDEX IF NOT EXISTS idx_cal_event_std ON finance_calendar_event (std_type_code);
CREATE INDEX IF NOT EXISTS idx_cal_event_fe_type ON finance_calendar_event (fe_type);
CREATE INDEX IF NOT EXISTS idx_cal_event_city ON finance_calendar_event (city);
-- idx_cal_event_importance 在 init_db 加列后再建（兼容旧库）

-- AI 模型配置档案（设置页；Key 仅本机）
CREATE TABLE IF NOT EXISTS ai_provider_profile (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  max_tokens INTEGER,
  timeout_sec REAL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_profile_provider ON ai_provider_profile (provider);

-- 网址收藏夹
CREATE TABLE IF NOT EXISTS bookmark_favorite (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  favicon_url TEXT,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookmark_sort ON bookmark_favorite (sort_order);

-- AI 平台：一个平台 = 一套 base_url + api_key，可挂多个模型
-- （ai_provider_profile.platform_id 非空时继承平台的 provider/base_url/api_key，
--   旧数据 platform_id 为空时继续使用本行自带的 base_url / api_key）
CREATE TABLE IF NOT EXISTS ai_platform (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_platform_provider ON ai_platform (provider);

-- 选股宝涨跌停盘后日终快照（页面完整态）
CREATE TABLE IF NOT EXISTS zt_day_snap (
  trade_date TEXT NOT NULL,
  pool TEXT NOT NULL,
  captured_at REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  stock_count INTEGER NOT NULL DEFAULT 0,
  theme_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'xuangubao',
  error TEXT,
  PRIMARY KEY (trade_date, pool)
);

CREATE INDEX IF NOT EXISTS idx_zt_day_snap_pool_date
  ON zt_day_snap (pool, trade_date DESC);

CREATE TABLE IF NOT EXISTS zt_day_theme (
  trade_date TEXT NOT NULL,
  pool TEXT NOT NULL,
  plate_id TEXT NOT NULL,
  plate_name TEXT NOT NULL DEFAULT '',
  plate_reason TEXT NOT NULL DEFAULT '',
  core_avg_pcp REAL,
  rise_count INTEGER,
  fall_count INTEGER,
  stay_count INTEGER,
  limit_up_count INTEGER,
  stock_count INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (trade_date, pool, plate_id)
);

CREATE INDEX IF NOT EXISTS idx_zt_day_theme_name
  ON zt_day_theme (trade_date, pool, plate_name);

CREATE TABLE IF NOT EXISTS zt_day_stock (
  trade_date TEXT NOT NULL,
  pool TEXT NOT NULL,
  symbol TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  price REAL,
  change_percent REAL,
  limit_up_days INTEGER,
  limit_down_days INTEGER,
  break_times INTEGER,
  first_limit_ts INTEGER,
  last_limit_ts INTEGER,
  stock_reason TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL,
  PRIMARY KEY (trade_date, pool, symbol)
);

CREATE INDEX IF NOT EXISTS idx_zt_day_stock_code
  ON zt_day_stock (code, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_zt_day_stock_symbol
  ON zt_day_stock (symbol, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_zt_day_stock_pool_date
  ON zt_day_stock (pool, trade_date DESC);

CREATE TABLE IF NOT EXISTS zt_day_stock_theme (
  trade_date TEXT NOT NULL,
  pool TEXT NOT NULL,
  symbol TEXT NOT NULL,
  plate_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (trade_date, pool, symbol, plate_id)
);

CREATE INDEX IF NOT EXISTS idx_zt_day_stock_theme_plate
  ON zt_day_stock_theme (trade_date, pool, plate_id);

-- ========== 用户体系（本机账号 + 配置同步）==========
CREATE TABLE IF NOT EXISTS auth_user (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  oauth_subject TEXT,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_user_username ON auth_user (username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_user_oauth
  ON auth_user (oauth_subject) WHERE oauth_subject IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at REAL NOT NULL,
  created_at REAL NOT NULL,
  user_agent TEXT,
  ip TEXT,
  FOREIGN KEY (user_id) REFERENCES auth_user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_session_user ON auth_session (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_session_expires ON auth_session (expires_at);

CREATE TABLE IF NOT EXISTS user_pref (
  user_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at REAL NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, namespace, key),
  FOREIGN KEY (user_id) REFERENCES auth_user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_pref_ns ON user_pref (user_id, namespace);

-- 巨潮资讯：A 股公告元数据（标题/时间/PDF 链接；PDF 本身不落盘）
CREATE TABLE IF NOT EXISTS cninfo_stock (
  code TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  updated_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cninfo_stock_org ON cninfo_stock (org_id);

CREATE TABLE IF NOT EXISTS cninfo_announcement (
  announcement_id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  org_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  announce_time_ms INTEGER NOT NULL DEFAULT 0,
  adjunct_url TEXT,
  adjunct_type TEXT,
  fetched_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cninfo_ann_code_time
  ON cninfo_announcement (code, announce_time_ms DESC);

CREATE TABLE IF NOT EXISTS cninfo_sync_state (
  code TEXT PRIMARY KEY,
  backfill_done INTEGER NOT NULL DEFAULT 0,
  last_sync_at REAL,
  oldest_ms INTEGER,
  newest_ms INTEGER,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_cninfo_sync_backfill
  ON cninfo_sync_state (backfill_done, last_sync_at);

-- 巨潮公告影响力评估（标题分流 + 可选 PDF/LLM）
CREATE TABLE IF NOT EXISTS cninfo_announcement_impact (
  announcement_id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  announce_time_ms INTEGER NOT NULL DEFAULT 0,
  thread_id TEXT,
  candidate_level TEXT,
  final_level TEXT,
  direction TEXT,
  category TEXT,
  disclosure_stage TEXT,
  is_first_disclosure INTEGER NOT NULL DEFAULT 1,
  score REAL,
  matched_rules_json TEXT,
  reasons_json TEXT,
  materiality_json TEXT,
  quality_flags_json TEXT,
  core_summary TEXT,
  core_quotes_json TEXT,
  risk_flags_json TEXT,
  expected_gap_hint TEXT,
  confidence REAL,
  judge_status TEXT,
  pdf_extract_status TEXT,
  error TEXT,
  judged_at REAL,
  updated_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cninfo_impact_time_level
  ON cninfo_announcement_impact (announce_time_ms DESC, final_level, score DESC);

CREATE INDEX IF NOT EXISTS idx_cninfo_impact_code_time
  ON cninfo_announcement_impact (code, announce_time_ms DESC);

CREATE INDEX IF NOT EXISTS idx_cninfo_impact_thread
  ON cninfo_announcement_impact (thread_id, announce_time_ms);

CREATE INDEX IF NOT EXISTS idx_cninfo_impact_status
  ON cninfo_announcement_impact (judge_status, updated_at);
