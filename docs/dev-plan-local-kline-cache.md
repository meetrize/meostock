# 行情本地缓存 — 二期开发计划（K 线 L3）

> 对齐：[`local-quote-cache.md`](./local-quote-cache.md) §L3 / §7.5  
> 解决问题：`http://127.0.0.1:8765/?symbol=usNVDA&period=1d`（及 `index.html` 全部 K 线）纳入本机 SQLite 缓存，与一期列表缓存同一套模式（speed/balanced/realtime）。

---

## 1. 拍板

| # | 决策 | 选择 |
|---|------|------|
| 1 | K 线是否走本机缓存 | **是**；与列表共用 `data/quote_cache.db` + 同一 `mode` |
| 2 | 优先范围 | **先落地日/周线（1d/1w）**；分钟/分时短 TTL 可读缓存但默认可更勤刷新 |
| 3 | 数据拉取 | 服务端统一拉源并落库；`index.html` 改调 `/api/cache/kline`（失败再回退旧路径） |
| 4 | 美股/港股源 | 与现页一致：**优先 Yahoo**，失败可再试东财（可选） |
| 5 | 体量 | **只缓存用户打开过的标的**（按需），不做全市场日 K |

---

## 2. 目标与验收

1. 打开 `/?symbol=usNVDA&period=1d`：**二次打开**应明显快于冷启动（本地命中，目标 <100ms 出 bars）。  
2. 断网或 `speed`：仍能画出**上次看过**的日 K。  
3. `force=1` / 手动刷新：跳过 TTL 重拉并更新库。  
4. A 股 / 港股 / 美股 / `yf:*` / `fut:*` 日线均可走缓存 API（分钟线可缓存但 TTL 短）。

---

## 3. 任务拆解

### P0 — Schema / 模型

- [x] `kline_bar` 表（market, symbol, period, ts, OHLCV, amount, source）  
- [x] `kline_meta`（market, symbol, period, as_of, synced_at, bar_count, source, sync_state）  
- [x] `read_kline` / `replace_or_merge_kline` / `kline_max_ts`

### P1 — 拉取与同步

- [x] 符号规范化：`usNVDA`→`(us,NVDA)`；`yf:BTC-USD`→`(yf,BTC-USD)`；`600036`→`(cn,sh600036)` 等  
- [x] Provider：Yahoo（US/HK/YF）、东财日 K（CN）、期货主连日 K（复用 mid 映射）  
- [x] TTL：日/周 按 mode；分钟线短 TTL；与一期 `cache_config.mode` 共用  

### P2 — API

- [x] `GET /api/cache/kline?symbol=&period=&force=`  
- [x] 读路径：命中且未 stale → 立即返回；否则拉网 merge/replace 再返回  
- [x] 响应字段对齐 `index.html`：`{ ok, market, symbol, name, period, bars[{timestamp,open,high,low,close,volume}], source, stale, from_cache }`

### P3 — 前端 `index.html`

- [x] `fetchKline` 优先 `/api/cache/kline`  
- [x] 失败时回退现有 sdk / `/api/yf/kline` 路径（保底）  

### P4 — 收尾

- [x] README / 方案文档标注二期已落地范围  
- [x] 手工验收：`usNVDA` 冷/热（~350ms → ~20ms，`from_cache`）；`sh600036`；`yf:BTC-USD`  
- [ ] `fut:AUM`：东财主连偶发断连时冷启动可能 502；有缓存后应可读脏数据（待网络稳定再验）

---

## 4. 非目标（二期不做或后置）

- 全 A 历史日 K 批量灌库 / mootdx2 目录导入（可三期）  
- 服务端 WebSocket 推送  
- 看板内个股详情页 K 线（可随后复用同一 API）  
- 分时「多日拖动」专用缓存结构（可先复用分钟 bars）

---

## 5. TTL 建议（K 线）

| period | speed | balanced | realtime |
|--------|-------|----------|----------|
| 1d / 1w | 6h | 30min | 5min |
| 1h / 15m / 5m / 1m / fs | 15min | 3min | 60s |

盘后日 K 可视为准静态（balanced ≥ 3h）。

---

## 6. 风险

| 风险 | 对策 |
|------|------|
| Yahoo 限流 | 命中缓存优先；force 节流；进程内短 TTL 与盘共用 |
| 东财断连 | CN 失败返回缓存脏数据 + stale；前端可提示 |
| DB 膨胀 | 仅缓存打开过的标的；可选 GC 删 N 日未访问 |

---

## 7. 与一期关系

```
一期 L1 quote_snapshot  ←→  /dashboard/quotes 列表
二期 L3 kline_bar       ←→  /?symbol=…  K 线页
共用：data/quote_cache.db、mode、Sync 思路（先本地后联网）
```
