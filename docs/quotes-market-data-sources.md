# 行情页数据源说明

> 页面：`http://127.0.0.1:8765/dashboard/quotes`  
> 前端：`apps/stock-dashboard` → `QuotesMarket`  
> 后端：FastAPI 本地缓存 `web/cache/*` → SQLite `data/quote_cache.db`

本文描述行情页**各市场如何读、如何同步**，以及 A 股与大盘云图（`/dapan`）数据源的关系。

---

## 1. 总览

| 市场 / 节点 | 读路径（首屏） | 同步写路径（公网源） | 源标记 `source` |
|-------------|----------------|----------------------|-----------------|
| 全部 A 股 `cn` | SQLite `quote_snapshot` | **东财 clist** → **腾讯批量** → **新浪节点** | `eastmoney` / `tencent` / `sina` |
| 港股 `hk` | 同上 | 东财 clist | `eastmoney` |
| 美股 `us` | 同上 | 东财 clist | `eastmoney` |
| 基金 `fund` | 同上 | 东财 → 新浪 ETF 节点 | `eastmoney` / `sina` |
| 指数 `index` | 静态目录 + 缓存补价 | 懒加载 / 东财个股点价 | 视实现 |
| 期货 `futures` | 静态目录 + 缓存 | 懒加载 | 视实现 |
| yfinance 扩展市 | `/api/yf/*` + 缓存 | Yahoo / yfinance | `yfinance` 等 |
| Tushare 专题节点 | `/api/tushare/...` | Tushare 轨（独立表） | `tushare:*` |

前端**不直连**东财/腾讯全市场；A/H/美全表走同源 `/api/cache/snapshot`，由后台 Sync Worker 拉取并落库。

缓存模式（设置页）：`speed` / `balanced` / `realtime`，见 [`local-quote-cache.md`](./local-quote-cache.md)。

---

## 2. 全部 A 股（`cn`）同步链路

与大盘云图 [`market-heatmap.ts`](../apps/a-share-heatmap/src/lib/market-heatmap.ts) **策略对齐**，实现落在 FastAPI 缓存层（**不**经 `/dapan` Next 反代）。

```text
QuotesMarket (cn)
  → GET /api/cache/snapshot?market=cn
  → SQLite quote_snapshot（可 stale + 后台 sync）

Sync Worker (market=cn)
  1) em_snapshot.fetch_market_snapshot
       主机序：push2delay → 82/7/48.push2 → push2
       fs：沪深京 A 股过滤（与 heatmap 一致）
  2) 失败且库内已有代码表 → tencent_snapshot（qt.gtimg.cn 批量）
       覆盖率 < 90% 视为失败
  3) 再失败 → sina_snapshot（Market_Center hs_a）
  → replace_snapshot / upsert，source 写入 meta
```

| 优先级 | 模块 | 远程地址要点 |
|--------|------|----------------|
| 1 | [`web/cache/providers/em_snapshot.py`](../web/cache/providers/em_snapshot.py) | `*/api/qt/clist/get`，优先 `push2delay.eastmoney.com` |
| 2 | [`web/cache/providers/tencent_snapshot.py`](../web/cache/providers/tencent_snapshot.py) | `https://qt.gtimg.cn/q=`，依赖上一份快照代码 |
| 3 | [`web/cache/providers/sina_snapshot.py`](../web/cache/providers/sina_snapshot.py) | 新浪 `Market_Center.getHQNodeData`，`node=hs_a` |

调度入口：[`web/cache/sync_worker.py`](../web/cache/sync_worker.py) 的 `_fetch_full_with_fallback`。

单位契约（与 stock-sdk 一致）：成交额 **万元**，总/流通市值 **亿元**，成交量 **手**。

---

## 3. 与 `/dapan` 大盘云图的关系

| 维度 | 行情页 `/dashboard/quotes` | 大盘云图 `/dapan` |
|------|----------------------------|-------------------|
| 进程 | FastAPI :8765 | Next.js :8766（反代） |
| 存储 | SQLite `quote_cache.db` | 进程内存短缓存；种子 JSON 仅离线刷新 |
| A 股远程策略 | 东财 clist 主机序 + 腾讯 + 新浪 | 同源思路（clist / 腾讯 / 新浪等） |
| 代码 | `web/cache/providers/*` | `apps/a-share-heatmap/src/lib/market-heatmap.ts` |
| 共享库 | **否**，互不读写对方缓存 | **否** |

[`market-constituents.ts`](../apps/a-share-heatmap/src/lib/market-constituents.ts) 仅服务中证 A50 等**成分股**接口，不参与行情页「全部 A 股」全表。

---

## 4. 其它市场（摘要）

- **港/美**：仅东财 clist（`em_snapshot` 的 `hk` / `us` `fs`），无腾讯全表回退。  
- **基金**：东财优先，失败走新浪 `etf_hq_fund`。  
- **Tushare 专题**：独立 lane 与表（`ts_snapshot` 等），见 [`tushare-local-cache.md`](./tushare-local-cache.md)。  
- **指数 / 期货 / yf**：目录 + 懒补价，不经上述 A 股三源链。

---

## 5. 如何确认当前源

1. 行情页顶栏 / 状态行查看 `cacheMeta.source`（如 `eastmoney`）。  
2. 或查库：

```bash
sqlite3 data/quote_cache.db \
  "SELECT market, source, synced_at, sync_state, last_error FROM market_meta WHERE market='cn';"
```

强制同步：页面「同步本轨」（`em-sina` 轨）或相关 `/api/cache/sync*` 接口。

---

## 6. 相关文档

- [`quote-cache-db.md`](./quote-cache-db.md) — SQLite 库表 ERD 与字段说明  
- [`local-quote-cache.md`](./local-quote-cache.md) — 缓存架构与模式  
- [`background-sync-ux.md`](./background-sync-ux.md) — 后台同步 UX  
- [`tushare-local-cache.md`](./tushare-local-cache.md) — Tushare 轨  
