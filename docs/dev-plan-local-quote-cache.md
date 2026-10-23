# 行情本地缓存 — Cursor 开发计划（一期）

## 拍板（不可再议，除非产品变更）

| # | 决策 | 选择 |
|---|------|------|
| 1 | 全市场数据如何进库 | **服务端** urllib/httpx 调东财 `push2 .../qt/clist/get` 分页批拉，写入 SQLite |
| 2 | 列表排序分页 | **一期前端全量排序**（QuotesMarket 现逻辑）；二期再考虑服务端 sort/page |

权威设计：[`local-quote-cache.md`](./local-quote-cache.md)

---

## 一期目标（可验收）

1. 断网仍能打开**上次同步过**的市场列表。  
2. 联网、`balanced` 下二次打开 A 股：**先出缓存**（目标 <200ms 出表），后台静默同步。  
3. 设置页可切 `speed` / `balanced` / `realtime`。  
4. 手动刷新 = `force=1` 跳过 TTL。

---

## 任务拆解（按序）

### P0 — 后端骨架

- [x] `web/cache/schema.sql` + `db.py`（WAL、`data/quote_cache.db`）
- [x] `ttl.py`：mode × 盘中/盘后 → TTL
- [x] `models.py`：读写 `cache_config` / `market_meta` / `symbol` / `quote_snapshot`

### P1 — Provider + Sync

- [x] `providers/em_snapshot.py`：clist 全字段分页（cn/hk/us），单位归一（市值亿、成交额万）
- [x] `providers/lazy_markets.py`：fund/index/futures 目录 + 可选页报价；yf 桥接现有逻辑
- [x] `sync_worker.py`：按 market 互斥队列；全量事务替换 snapshot

### P2 — API 挂载

- [x] `api.py`：`GET snapshot|status`，`POST sync|mode|clear`
- [x] `server.py` `include_router`；启动时可选预热 symbols

### P3 — 前端

- [x] `QuotesMarket`：`cn/hk/us/...` → `GET /api/cache/snapshot`；保留前端 sort/page；`stale`/`syncing` UI
- [x] `Settings` + `AppSettings`：`cacheMode`
- [x] `scripts/build_dashboard.sh`

### P4 — 收尾

- [x] `.gitignore` 忽略 `data/*.db`
- [x] README 一小段说明缓存模式
- [x] 手工验收清单（见下）

---

## 非目标（一期不做）

- 服务端排序分页  
- `kline_bar` / mootdx2  
- Redis / WebSocket  
- 自选/热力改走缓存（可后续复用同一 snapshot）

---

## 验收清单

```text
[x] GET /api/cache/status 返回 mode 与各市场 as_of
[x] POST /api/cache/mode {"mode":"speed"} 后 snapshot 不主动打网（除非 force）
[x] 同步 cn 后 data/quote_cache.db 有数千行 quote_snapshot（实测 ~5389）
[x] /dashboard/quotes 选 A 股：有缓存时秒开（API ~60ms）；点刷新会 syncing
[ ] 断网（或 speed）仍能看到上次列表（请本机再验一次）
[x] 构建产物已更新 web/static/dashboard
```

---

## Agent 执行约定

- 改动范围贴合本计划；不顺手大重构 vendor 无关页。  
- 东财字段归一必须与 sdk 契约一致，避免涨幅/市值显示错位。  
- 每完成一个 P* 可在本文件勾选。
