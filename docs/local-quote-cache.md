# 行情本地缓存与同步方案

> 目标页：`http://127.0.0.1:8765/dashboard/quotes`  
> 原则：对齐股票软件通行做法——**先本地秒开，再后台增量同步**；用模式切换在「速度」与「新鲜度」之间取舍。  
> 范围：本机单用户（FastAPI :8765），不引入 Redis/多机集群。

---

## 0. 现状结论（设计前提）

| 维度 | 现状 |
|------|------|
| 行情页 | `QuotesMarket`：选市场 → 拉全表/代码表 → 分页展示，**无自动轮询**，仅手动刷新 |
| A/H/美全市场快照 | 浏览器 **stock-sdk 直连**东财/腾讯等；`batch.cn` 约 500×多批、并发 4；前端 `MemoryCache` TTL **60s** |
| 基金 | `sdk.codes.fund` → 按页补 `quotes.fund`；后台预热限前 200 |
| 指数 / 期货 | 静态 `indexCatalog.json`(39) / `futuresCatalog.json`(63) → 按页补行情 |
| yfinance 扩展市 | 同源 `/api/yf/symbols`、`/api/yf/quotes`；进程内 TTL 列表 600s / K 线 300s |
| 本机服务 | FastAPI 托管 SPA + yf/符号列表代理；**无 SQLite、无 WS、无行情代理缓存** |
| mootdx2 | 仅脚本/日 K 实验，**未接入 Web** |

**性能瓶颈**：打开 A/H/美行情页要打公网全市场批请求（十次量级），首次冷启动慢、且依赖外网；进程重启后 yf 内存缓存清空。

---

## 1. 股票软件通行做法（对齐点）

通达信 / 东方财富 / 同花顺等桌面端共性：

1. **代码表本地库**：股票/基金/合约名称、市场、退市标记——日更或启动增量。  
2. **行情快照分档**：自选/当前页偏实时；全市场列表用短周期快照（几秒～几十秒），不逐票 tick。  
3. **历史 K 线落盘**：日 K 几乎全量本地；分钟线按需 + 当日增量。  
4. **先读盘再联网**：UI 用昨日/上次收盘或上次快照秒开，后台静默更新后刷 UI。  
5. **交易时段策略**：盘中短 TTL 高频同步；盘后几乎只读本地，仅偶发校验。  
6. **用户模式**：极速 / 均衡 / 实时（对应本方案的三档）。

本方案按上述分层落地，不追求券商级推送，保持现有 **HTTP 拉取**模型。

---

## 2. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│  Browser  /dashboard/quotes                                  │
│  QuotesMarket → LocalQuoteClient（同源 API，不再直连全市场）   │
└───────────────────────────┬─────────────────────────────────┘
                            │ GET /api/cache/...
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  FastAPI  Cache Facade                                       │
│  ├─ 读路径：SQLite 命中 → 立即返回 + stale 标记               │
│  ├─ 写路径：Sync Worker（后台）按模式刷新                     │
│  └─ 模式：speed | balanced | realtime（配置表 / 设置页）      │
└───────┬─────────────────────┬─────────────────┬─────────────┘
        │                     │                 │
        ▼                     ▼                 ▼
  stock-sdk 服务端适配    Yahoo/yfinance      mootdx2 日 K
  （东财/腾讯批拉）        （现有 /api/yf）    （可选 A 股历史）
        │                     │                 │
        └──────────┬──────────┴────────┬────────┘
                   ▼                   ▼
            SQLite (WAL)          可选目录：data/tdx/ 日 K 文件
            data/quote_cache.db
```

**关键决策**：把「全市场快照」从浏览器直连改为 **本机 FastAPI 统一拉取并落库**。收益：

- 多标签页 / 多页面共享一份快照，避免重复打公网；  
- 进程外持久化，重启仍可秒开；  
- 便于统一限流、TTL、模式切换与离线。

前端 `MemoryCache` 可保留作 L1（秒级），SQLite 为 L2（分钟～日）。

---

## 3. 数据分级与缓存策略

| 层级 | 数据类型 | 新鲜度要求 | 存储 | 默认同步 |
|------|----------|------------|------|----------|
| L0 元数据 | 代码表、市场目录、指数/期货目录、行业 | 日 | `symbol` / `catalog` | 启动 + 每日 1 次 |
| L1 快照 | 全市场/分页列表行情（Quotes 页主数据） | 盘中 15–60s；盘后可日 | `quote_snapshot` | 按模式 |
| L2 页面块 | 当前页/自选 小批量 quotes | 5–15s | 可只走内存或短 TTL 行 | 按模式 |
| L3 历史 | 日 K / 周月线 | 收盘后固化 | `kline_bar` 或文件 | 增量 append |
| L4 临时 | 分时、异动、涨停池 | 不宜长缓存 | 内存短 TTL 或不落库 | 直拉 |

**Quotes 页优先实现 L0 + L1**（速度提升最大）；K 线页再接 L3。

### 按市场映射（对齐现有接口）

| MarketId | 现数据源 | 落库对象 | 体量粗估 |
|----------|----------|----------|----------|
| `cn` | `sdk.batch.cn` | 全 A 快照行 | ~5000 |
| `hk` | `sdk.batch.hk` | 港股快照 | 千～数千 |
| `us` | `sdk.batch.us` | 美股快照 | 千～数千 |
| `fund` | `codes.fund` + `quotes.fund` | 代码表 + 分页报价 | 数百～数千；报价可懒写 |
| `index` | JSON + `getFullQuotes` | 目录固化 + 39 条快照 | 39 |
| `futures` | JSON + 日 K 末根 | 目录 + 63 条快照 | 63 |
| `yf:*` | `/api/yf/symbols|quotes` | 目录 + ~110 条快照 | ~110 |

---

## 4. 三种运行模式（设置可切换）

落在设置页「数据与缓存」，并写入 `cache_config`（见 §6）。API 查询带 `mode` 或读全局配置。

| 模式 | 用途 | L1 快照 TTL（盘中） | 打开行情页行为 | 后台同步 | 离线 |
|------|------|-------------------|----------------|----------|------|
| **speed（极速）** | 弱网 / 演示 / 复盘浏览 | 120–300s | **只读本地**，后台可选不刷 | 低频或手动 | 完全可用（昨收/上次） |
| **balanced（均衡，默认）** | 日常 | 30–60s | 先本地 → 若 stale 则后台刷新 → 推送更新 | 按市场轮询活跃市场 | stale 超时仍返回本地 |
| **realtime（实时）** | 盯盘 | 5–15s | 本地仅作占位 ≤1 帧，立即强制拉网 | 活跃市场高频；可对当前页加短轮询 | 无网则降级 balanced |

### 时段修正（建议内置交易日历粗规则）

- **A 股盘中**（工作日 9:15–15:05）：按模式 TTL。  
- **A 股盘后 / 周末**：L1 视为「准静态」，TTL 拉到 1–6h，仅手动刷新或每日一次全量。  
- **港/美/商品**：按对应时区会话窗口分别判断（配置表 `session_rule`）。  
- **yf 加密**：可视为 7×24，但仍用短 TTL 即可（Yahoo 本身非 tick）。

### 设置项建议

```text
缓存模式：极速 | 均衡 | 实时
启动时预热：关 | 仅代码表 | 代码表+上一次市场快照 | 全市场（慢）
手动「清空缓存」/「立即同步全部」
单市场「强制刷新」（对齐现有 refresh=1）
磁盘上限警告：如 quote_cache.db > 500MB 提示清理历史 K
```

与现有 `settings.refreshInterval`（自选 15s / 详情 5s / 热力 10s）关系：

- 列表/详情轮询间隔 **继续管 UI 轮询**；  
- **缓存模式管服务端 L1 TTL 与是否允许脏读**。二者独立，避免混为一谈。

---

## 5. 离线机制

### 5.1 定义

- **离线**：公网源不可达，或用户选择 speed 且禁止联网。  
- **半离线**：可读本地快照 + 禁止全市场重拉，仅允许自选小批量尝试。

### 5.2 读路径（统一）

```
request(market, force=false)
  → 读 quote_snapshot WHERE market=?
  → 若有数据：立即 200 { rows, as_of, stale, source: "cache" }
  → 若 force 或 (mode!=speed 且 age>TTL)：enqueue sync(market)
  → 若无数据且可联网：同步阻塞拉取一次（首装冷启动）
  → 若无数据且离线：200 { rows:[], offline:true } 或 503 + 明确错误码
```

前端：`stale=true` 时显示「缓存于 HH:mm，同步中…」，数据到位后用轻量事件或短轮询 `as_of` 刷新。

### 5.3 冷启动 / 首装

1. 打包或首次运行写入最小目录：`index`/`futures`/`yf_catalog`（已有静态资源）。  
2. 后台任务：按优先级同步代码表 `cn → hk → us → fund`。  
3. 用户第一次点开某市场：允许 **阻塞式全量拉一次**（带进度，对齐现有 `onProgress`），写入 SQLite 后再返回。  
4. 可选：提供「导入通达信本地日 K 目录」对接 mootdx2 `DailyDataManager`（二期）。

### 5.4 一致性与脏数据

- 每行带 `as_of`（源时间）与 `synced_at`（写入本地时间）。  
- 退市/更名：代码表同步时 `status=delisted`，快照保留但列表默认过滤。  
- 不保证跨源字段完全一致（东财 vs Yahoo）；`source` 字段标明来源。

---

## 6. 同步机制

### 6.1 Sync Worker（进程内线程即可）

单机足够：`threading` + 队列；后续可换成 APScheduler。

| 任务 | 触发 | 动作 |
|------|------|------|
| `sync_symbols(market)` | 启动、每日、手动 | 拉代码表 → upsert `symbol` |
| `sync_snapshot(market)` | TTL 到期、打开页面、手动 force | 批拉全市场 → 事务替换 `quote_snapshot` |
| `sync_page(market, codes)` | 分页补齐（fund/index/futures/yf） | 批量 quotes → upsert 对应行 |
| `sync_kline(symbol, period)` | 二期 / K 线页 | 增量 append `kline_bar` |
| `gc` | 每日 | 删过期分时缓存、压缩 WAL |

**全量快照写入策略（推荐）**：

- 同一 `market` 使用 `snapshot_version`：先写入 `quote_snapshot_stage`，成功后 `UPDATE meta SET current_version`，读路径只读当前 version；避免半截数据。  
- 或单事务 `DELETE WHERE market=?` + `executemany INSERT`（A 股 5k 行可接受，WAL 下通常 <1s）。

### 6.2 优先级队列

```
P0  当前可见市场 force 刷新
P1  设置里「启动预热」选中的市场
P2  其它已打开过的市场（TTL 到期）
P3  代码表日更、K 线增量
```

并发：全市场批拉 **全局互斥按 market**（同一市场同时只跑一个 sync）；跨市场并发建议 ≤2，避免打爆源站。

### 6.3 增量 vs 全量

| 数据 | 策略 |
|------|------|
| A/H/美快照 | 源站本身是「全表批接口」，**本地也按全量替换**最简单可靠；不做字段级差分 |
| 基金/指数/期货/yf | **懒加载**：先有代码表，报价按页 upsert；后台可预热 Top N |
| 日 K | **按 symbol 增量**：本地 `max(trade_date)` 之后补齐（mootdx2 / sdk） |
| 代码表 | 全量 upsert + `last_seen_at`；N 日未见标 delisted |

### 6.4 与现有 API 的衔接

| 现有 | 改造后 |
|------|--------|
| 前端 `getAllAShareQuotes` 等 | 改为 `GET /api/cache/snapshot?market=cn` |
| `/api/yf/symbols`、`/api/yf/quotes` | 内部改为读/写同一套表；保留 URL 兼容 |
| `/api/symbols` | 可直接读 `symbol` 表 |
| `refresh=1` | 映射为 `force=1` → 跳过 TTL、入队 P0 |
| 前端 MemoryCache 60s | 可缩短为 5–15s 或去掉，避免双缓存打架 |

### 6.5 进度与可观测

- `GET /api/cache/status` → 各市场 `as_of`、`age_sec`、`syncing`、`last_error`、`row_count`、`mode`。  
- 行情页顶栏可显示：`A股 · 缓存 10:32 · 同步中 3/12`（复用现有 progress UI）。

---

## 7. 数据库设计（SQLite）

**路径**：`data/quote_cache.db`（gitignore）  
**PRAGMA**：`journal_mode=WAL`；`synchronous=NORMAL`；`busy_timeout=5000`。

### 7.1 `cache_config`

| 列 | 类型 | 说明 |
|----|------|------|
| key | TEXT PK | 如 `mode` / `prefetch` / `disk_warn_mb` |
| value | TEXT | JSON 或标量字符串 |
| updated_at | REAL | unix |

预置：

- `mode` = `balanced`  
- `prefetch` = `symbols+last_market`  
- `ttl_override` = 可选 JSON，覆盖默认 TTL

### 7.2 `market_meta`

| 列 | 类型 | 说明 |
|----|------|------|
| market | TEXT PK | `cn`/`hk`/`us`/`fund`/`index`/`futures`/`yf:COMMODITIES`… |
| snapshot_as_of | REAL | 快照业务时间 |
| snapshot_synced_at | REAL | 写入时间 |
| symbols_synced_at | REAL | 代码表同步时间 |
| row_count | INTEGER | |
| source | TEXT | `eastmoney` / `tencent` / `yahoo` / `static` / `mootdx` |
| sync_state | TEXT | `idle`/`running`/`error` |
| last_error | TEXT | |
| etag | TEXT | 可选，源校验 |

### 7.3 `symbol`（代码表 L0）

| 列 | 类型 | 说明 |
|----|------|------|
| market | TEXT | |
| code | TEXT | 市场内代码 |
| symbol | TEXT | 统一展示/跳转用（含前缀） |
| name | TEXT | |
| exchange | TEXT | 可选 |
| category | TEXT | 行业/品种分类 |
| status | TEXT | `active`/`delisted` |
| extra_json | TEXT | 扩展 |
| updated_at | REAL | |
| last_seen_at | REAL | |

主键：`(market, code)`；索引：`(market, name)`、`(market, status)`。

### 7.4 `quote_snapshot`（列表行情 L1）

字段对齐现有 `QuoteRow` / FullQuote：

| 列 | 类型 | 说明 |
|----|------|------|
| market | TEXT | |
| code | TEXT | |
| name | TEXT | |
| price | REAL | |
| change_amt | REAL | 涨跌额（避免 SQL 关键字 `change`） |
| change_percent | REAL | |
| open | REAL | |
| prev_close | REAL | |
| high | REAL | |
| low | REAL | |
| volume | REAL | |
| amount | REAL | |
| turnover_rate | REAL | |
| volume_ratio | REAL | |
| amplitude | REAL | |
| pe | REAL | |
| pb | REAL | |
| total_market_cap | REAL | 亿元，与 sdk 约定一致 |
| circulating_market_cap | REAL | |
| kline_symbol | TEXT | 跳转 K 线用 |
| quote_ready | INTEGER | 0/1，基金未补齐时为 0 |
| as_of | REAL | |
| source | TEXT | |
| updated_at | REAL | |

主键：`(market, code)`；索引：`(market, change_percent DESC)`、`(market, total_market_cap DESC)` —— **排序可在服务端完成**，前端可改为请求已排序分页，进一步减负（可选优化）。

### 7.5 `kline_bar`（二期 L3）

| 列 | 类型 |
|----|------|
| market | TEXT |
| symbol | TEXT |
| period | TEXT | `1d`/`1w`/`1m`… |
| ts | INTEGER | bar 时间戳 |
| open/high/low/close/volume | REAL |
| amount | REAL NULL |
| source | TEXT |

主键：`(market, symbol, period, ts)`。

### 7.6 `sync_job`（可选，便于排障）

| 列 | 类型 |
|----|------|
| id | INTEGER PK AUTOINCREMENT |
| job_type | TEXT |
| market | TEXT |
| priority | INTEGER |
| status | TEXT |
| created_at / started_at / finished_at | REAL |
| message | TEXT |

### 7.7 体量估算

| 表 | 粗算 |
|----|------|
| symbol 全市场 | < 5MB |
| quote_snapshot 全市场 | 约 10–30MB |
| 日 K 全 A 数年 | 数百 MB～GB（故二期；可只缓存看过的标的） |

一期只做 symbol + snapshot + config + meta，体积可控。

---

## 8. API 设计（落地接口）

均挂在 FastAPI，前缀 `/api/cache`。

### 8.1 快照（Quotes 页主接口）

```
GET /api/cache/snapshot
  ?market=cn|hk|us|fund|index|futures|yf:COMMODITIES
  &sort=changePercent|totalMarketCap|...
  &order=desc|asc
  &page=1&size=20          # 可选：服务端分页
  &q=关键字                 # 可选过滤
  &force=0|1
  &mode=                   # 可选覆盖全局

响应：
{
  "ok": true,
  "market": "cn",
  "mode": "balanced",
  "as_of": 1730000000.0,
  "synced_at": 1730000010.0,
  "stale": false,
  "offline": false,
  "syncing": false,
  "source": "eastmoney",
  "total": 5120,
  "items": [ { QuoteRow... } ]
}
```

### 8.2 状态 / 控制

```
GET  /api/cache/status
POST /api/cache/sync          { "market": "cn", "force": true }
POST /api/cache/mode          { "mode": "speed|balanced|realtime" }
POST /api/cache/clear         { "market": "cn"|null, "what": "snapshot|all" }
```

### 8.3 兼容层

- `/api/yf/symbols`、`/api/yf/quotes`：内部读缓存表，行为对前端透明。  
- 新增服务端批拉模块：`web/cache/`（sdk 的 Python 侧或 httpx 调东财，与浏览器 sdk 字段对齐）。

> 说明：当前 stock-sdk 主要在浏览器；服务端需 **复刻批拉协议**（httpx + 与 `sdk.batch.cn` 相同字段归一），或短期用 **无头浏览器不可取**。优先用东财 push2 列表接口（与 `/api/symbols` 同源风格）批量拼快照。

---

## 9. 前端改造要点（QuotesMarket）

文件：`apps/stock-dashboard/src/pages/QuotesMarket/QuotesMarket.tsx`

1. `loadMarketRows`：`cn/hk/us/...` 统一走 `fetch('/api/cache/snapshot?market=...')`。  
2. 保留 progress：若 `syncing`，轮询 `/api/cache/status` 或 snapshot 直至 `stale=false`。  
3. 「刷新」按钮 → `force=1`。  
4. Settings：增加缓存模式（写入 `/api/cache/mode` + localStorage 备份）。  
5. UI 微提示：`缓存于 …` / `离线` / `同步中`。

构建：改完后跑 `scripts/build_dashboard.sh`。

---

## 10. 目录与模块落地

```
mootdx/
  data/                          # gitignore
    quote_cache.db
  web/
    cache/
      __init__.py
      db.py                      # 连接、迁移、PRAGMA
      schema.sql                 # 建表
      models.py                  # 读写封装
      ttl.py                     # 模式 × 市场 × 时段 → TTL
      sync_worker.py             # 队列与任务
      providers/
        cn_snapshot.py           # 东财/批拉
        hk_snapshot.py
        us_snapshot.py
        fund.py
        static_catalog.py        # index/futures
        yf_bridge.py             # 复用现有 yf 逻辑
      api.py                     # 路由，include 进 server.py
    server.py                    # include_router
  docs/
    local-quote-cache.md         # 本文
```

环境变量建议：

- `QUOTE_CACHE_PATH` 默认 `data/quote_cache.db`  
- `QUOTE_CACHE_MODE` 默认 `balanced`  
- `QUOTE_CACHE_ENABLED=1`

---

## 11. 实施分期

### 一期（Quotes 页体感提升，建议优先）

1. SQLite schema + WAL  
2. `market_meta` + `quote_snapshot` + `symbol` + `cache_config`  
3. Sync Worker：cn/hk/us 全量快照；fund/index/futures/yf 懒报价  
4. `/api/cache/snapshot|status|mode|sync|clear`  
5. QuotesMarket 改同源；Settings 三模式  
6. 启动预热：代码表 + 上次市场  

**验收**：断网后仍能打开上次浏览过的市场列表；联网 balanced 下二次打开 A 股 < 200ms 出表，后台静默更新。

### 二期

- 服务端分页排序（大数据集）  
- `kline_bar` + mootdx2 日 K 对接 K 线页  
- 交易日历精细化、按市场会话 TTL  
- 磁盘 GC、导入/导出缓存包  

### 三期（可选 → 已开干）

计划：[`dev-plan-local-quote-cache-phase3.md`](./dev-plan-local-quote-cache-phase3.md)

- 自选 / 热力自选 / 总览自选与涨跌统计走同源 `/api/cache/snapshot`（可 `codes=`）  
- 行情源：`auto` / `local` / `network`（`/api/cache/source`）  
- 会话 TTL：周末 + A 股静态节假日粗表  
- K 线磁盘 GC：`POST /api/cache/gc`  
- **不做**：服务端 sort/page、mootdx2 全量灌库、Redis

---

## 12. 风险与对策

| 风险 | 对策 |
|------|------|
| 源站限流 / 封 IP | 全市场互斥、并发上限、失败退避；speed 模式少打网 |
| 服务端批拉字段与浏览器 sdk 不一致 | 单一归一函数 + 契约测试对照一份 FullQuote JSON |
| SQLite 写锁 | WAL + 单 writer 队列；读不阻塞 |
| 双缓存（前端 Memory + SQLite）TTL 冲突 | 前端 L1 ≤ 服务端 TTL，或 force 时清 L1 |
| 美股体量大、首次慢 | 进度条 + 允许先展示部分批次写入的中间态（可选） |
| 法律/源站 ToS | 仅本机个人使用缓存；不做对外再分发服务 |

---

## 13. 推荐默认（开箱）

- 模式：**balanced**  
- A/H/美盘中 TTL：**45s**  
- 盘后 TTL：**3h**  
- 启动预热：`symbols` + 上次选中的市场快照  
- Quotes 页：先出缓存，`stale` 时顶部细条「同步中」  
- 手动刷新：始终 `force` 全量  

该组合对齐「股票软件先出盘再刷新」的习惯，同时保留 realtime / speed 两档极端场景。

---

## 14. 拍板记录（2026-10-23）

| # | 议题 | 决定 |
|---|------|------|
| 1 | 全市场如何进本地库 | **服务端** urllib 调东财 `clist` 分页批拉并落 SQLite（多标签共享；不做前端 POST 回灌） |
| 2 | 一期列表排序分页 | **仍前端全量排序分页**（与现 QuotesMarket 一致）；服务端 sort/page 留二期 |

开发计划与勾选任务见 [`dev-plan-local-quote-cache.md`](./dev-plan-local-quote-cache.md)。

## 15. 二期进度（K 线 L3）

计划：[`dev-plan-local-kline-cache.md`](./dev-plan-local-kline-cache.md)

- `GET /api/cache/kline?symbol=&period=`：读 SQLite → 过期则拉 Yahoo/东财并落盘  
- `index.html` 的 `fetchKline` 优先走该 API（失败回退原 sdk / `/api/yf/kline`）  
- 表：`kline_bar` / `kline_meta`（与一期共用 `data/quote_cache.db`）

## 16. 三期进度（同源复用）

计划：[`dev-plan-local-quote-cache-phase3.md`](./dev-plan-local-quote-cache-phase3.md)

- `codes=` 过滤快照；`quote_source`；`POST /api/cache/gc`  
- 看板 Watchlist / Heatmap(watchlist) / Dashboard 经 `quoteCache.ts` 优先读盘  
- Settings：「行情源」+「清理 K 线」
