# 行情本地缓存 — 三期 Cursor 开发计划

> 对齐：[`local-quote-cache.md`](./local-quote-cache.md) §11 二期遗留 + 三期可选项  
> 一期：列表 L1 · 二期：K 线 L3 · **三期：同源复用 + 源切换 + 会话/GC 打磨**

---

## 1. 拍板

| # | 决策 | 选择 |
|---|------|------|
| 1 | 自选 / 热力自选 / 总览自选条 | **优先读** `/api/cache/snapshot`（可带 `codes=`），失败再按源策略回退 sdk |
| 2 | 行情源开关 | `auto`（默认）/ `local`（只读盘）/ `network`（前端直连 sdk，不依赖缓存） |
| 3 | 服务端 sort/page | **不做**（QuotesMarket 已前端分页；索引保留给以后） |
| 4 | mootdx2 全日日 K 灌库 / 缓存包导入导出 | **不做**（按需 K 线已够用） |
| 5 | Redis / 多用户 | **不做** |

---

## 2. 目标与验收

1. 自选页在 `cn` 已有快照时：**不断网也能出表**；`auto` 下二次打开明显快于纯 sdk。  
2. 设置可切「仅本地 / 自动 / 仅联网」；仅本地时服务端 snapshot **不入队同步**。  
3. 非交易日（周末 + 内置 A 股节假日粗表）TTL 按盘后拉长。  
4. `POST /api/cache/gc` 可清理久未访问的 K 线，避免库膨胀。

---

## 3. 任务拆解

### P0 — API

- [x] `GET /api/cache/snapshot` 支持 `codes=`（逗号分隔；匹配 `code` / `kline_symbol`）  
- [x] `cache_config.quote_source` + `GET/POST /api/cache/source`（`auto|local|network`）  
- [x] `local`：snapshot 不 enqueue；`network`：前端走 sdk（服务端仍可 force 同步）  
- [x] `POST /api/cache/gc`：按 `last_access_at` / 上限清理 `kline_bar`+`kline_meta`

### P1 — TTL

- [x] `ttl.is_session_open`：接入静态 A 股节假日集合（fail-open）；周末已有  

### P2 — 前端

- [x] `services/quoteCache.ts`：`getQuotesByCodesPreferCache` / `getAllASharePreferCache`  
- [x] Watchlist / Heatmap(watchlist) / Dashboard 自选条与涨跌统计改走上述封装  
- [x] Settings：行情源 +「清理 K 线缓存」；`quoteSource` 写入 AppSettings 并同步服务端  

### P3 — 收尾

- [x] README / `local-quote-cache.md` 标注三期范围  
- [x] `scripts/build_dashboard.sh`  
- [x] 手工：`codes=` 过滤；`local` 不 syncing；`gc` 返回 remaining；节假日 TTL  

---

## 4. 非目标

- 板块/概念热力改走缓存（仍用 boards API）  
- Scanner / StockDetail 全量改缓存（可后续复用同一封装）  
- 服务端分页排序、通达信目录导入、WebSocket  

---

## 5. 与一/二期关系

```
一期 L1 snapshot  ← QuotesMarket
二期 L3 kline     ← index.html
三期              ← Watchlist / Heatmap自选 / Dashboard自选 + source + GC + 节假日 TTL
共用 data/quote_cache.db、mode、同一 snapshot 表
```
