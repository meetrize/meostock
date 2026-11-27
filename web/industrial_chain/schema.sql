-- 产业链绑定报告（HTML/Markdown 全文）
-- 与前端 graph.reportId 对齐；一期可由种子脚本灌入，API 见 docs/global-industrial-chain.md §1.2.2

CREATE TABLE IF NOT EXISTS chain_report (
  report_id     TEXT PRIMARY KEY,
  chain_id      TEXT NOT NULL,
  title         TEXT NOT NULL,
  format        TEXT NOT NULL DEFAULT 'html',
  body          TEXT NOT NULL,
  source_note   TEXT,
  published_at  TEXT NOT NULL,
  content_hash  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chain_report_chain ON chain_report(chain_id);
