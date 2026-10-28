# Tushare 专题数据本地缓存与定时同步方案

> 状态：**待确认后实施**  
> 日期：2026-10-28（含后台同步 UX 修订）  
> 前置：[`tushare-quotes-integration-plan.md`](./tushare-quotes-integration-plan.md)（P0 网关已上线）  
> 对齐：[`local-quote-cache.md`](./local-quote-cache.md) · **[`background-sync-ux.md`](./background-sync-ux.md)**（全局后台同步 / 顶栏进度 / 无刷新更新）  
> 开发计划：[`dev-plan-tushare-local-cache.md`](./dev-plan-tushare-local-cache.md)

---

## 0. 一句话结论

把现有 **16 个 Tushare P0 节点**（`ts:*`）从「每次打开直打中继」改为与 A 股行情相同的 **本机 SQLite 先读 + 模式/源切换 + 后台同步**；并增加 **定时全量同步** 与 **手动同步**（单节点 / 全部 Tushare）。  
东财 `cn/hk/us/...` 缓存链路不变；Tushare 共用同一套 `cacheMode` / `quoteSource` 语义，落在同一 `quote_cache.db` 的新表中。

---

## 1. 现状与差距

| 能力 | 东财/本地 cache | Tushare P0（现状） |
|------|-----------------|-------------------|
| 落盘 | `quote_snapshot` + `market_meta` | **无**，`/api/tushare/market` 每次上游 |
| 模式 `speed/balanced/realtime` | TTL + 是否自动刷 | 未接入 |
| 源 `auto/local/network` | 读路径强制本地/联网 | 未接入 |
| 手动同步 | 行情页「同步缓存 / 同步所有」 | 仅「刷新」= 再打上游 |
| 定时全量 | **无**（仅启动 prefetch + 打开时 stale 入队） | 无 |
| 打开体验 | 秒开缓存 | 冷启动等中继（限流 ~0.35s/请求，全树切换易触额度） |

**核心痛点**：专题数据（涨跌停、龙虎、资金流等）多为 **按交易日日终切片**，却按「实时报价」方式反复拉取，浪费额度且慢。

---

## 2. 设计原则

1. **先本地、再联网**：与 `local-quote-cache` 一致；`local` 源断网仍可看上次同步。  
2. **按交易日键缓存**：绝大多数 `ts:*` 以 `trade_date`（YYYYMMDD）为业务代次，不是单纯按「年龄 TTL」。  
3. **异构 payload**：quote 型（转债/申万/ETF）与 topic 型（龙虎/两融…）统一存 JSON 行表，避免硬塞进 `quote_snapshot` 定宽列。  
4. **额度友好**：默认定时在 **A 股收盘后** 跑一轮；盘中打开优先读库，仅 `network`/`realtime`+stale 才打上游。  
5. **不替换东财全市场**：`cn/hk/us` 仍走现有 Sync Worker；Tushare Worker 独立队列，共享限流客户端。  
6. **配置统一**：继续用设置页的「缓存模式 / 行情源」；文案扩展为「含 Tushare 专题」。

---

## 3. 总体架构

```
Browser /quotes（ts:* 节点）
    │  GET /api/tushare/market?id=&trade_date=&force=
    │  POST /api/tushare/sync | sync-all
    │  GET  /api/tushare/sync/progress
    │  GET/POST /api/tushare/schedule
    ▼
FastAPI tsrelay Facade
    ├─ 读：SQLite ts_snapshot 命中 → 立即返回 + stale/as_of
    ├─ 写：TsSyncWorker 入队 → fetch_market → 落库
    ├─ 模式/源：复用 cache_config.mode / quote_source
    └─ 定时：ScheduleLoop（进程内）按 cron 触发 sync-all
            │
            ▼
     data/quote_cache.db（同一文件，新表）
            │
            ▼
     Tushare 主备中继（现有 client.py）
```

东财路径仍走 `/api/cache/*`；前端对 `ts:*` **继续调 `/api/tushare/*`**（Facade 内部接缓存），避免把 topic JSON 硬塞进 snapshot 契约。

---

## 4. 数据模型

仍使用 `QUOTE_CACHE_PATH`（默认 `data/quote_cache.db`），新增表（迁移：`schema.sql` + 启动 `ensure_schema`）。

### 4.1 `ts_snapshot` — 专题/市场切片

| 列 | 类型 | 说明 |
|----|------|------|
| `market_id` | TEXT | 如 `ts:limit`、`ts:cb` |
| `trade_date` | TEXT | `YYYYMMDD`；无日期概念的目录类用 `00000000`（如 `ts:opt`/`ts:ths` 基础表） |
| `table_kind` | TEXT | `quote` \| `topic` |
| `label` | TEXT | 展示名 |
| `columns_json` | TEXT | 列配置 JSON（与 catalog 一致，便于离线） |
| `items_json` | TEXT | 行数组 JSON（已归一字段） |
| `row_count` | INTEGER | |
| `source` | TEXT | `primary` / `secondary` / `local` |
| `as_of` | REAL | 上游业务日语义（可用交易日 15:00 或抓取时刻） |
| `synced_at` | REAL | 本机写入时刻 |
| `etag` | TEXT | 可选：内容哈希，避免无变化重写 |
| PRIMARY KEY | `(market_id, trade_date)` | |

### 4.2 `ts_market_meta` — 同步状态

| 列 | 说明 |
|----|------|
| `market_id` PK | |
| `last_trade_date` | 最近一次成功切片的交易日 |
| `synced_at` / `as_of` | |
| `row_count` | |
| `sync_state` | `idle` \| `running` \| `error` |
| `last_error` | |
| `source` | |

### 4.3 `ts_schedule_config`（或写入 `cache_config`）

建议直接进现有 `cache_config` 键，减少表：

| key | 示例 | 说明 |
|-----|------|------|
| `ts_schedule_enabled` | `1` | 是否启用定时 |
| `ts_schedule_cron` | `30 15 * * 1-5` | 默认工作日 15:30（上海） |
| `ts_schedule_timezone` | `Asia/Shanghai` | |
| `ts_schedule_markets` | JSON 列表或 `*` | 默认同步全部 P0（不含 placeholder） |
| `ts_schedule_last_run` | ISO/epoch | 上次触发 |
| `ts_schedule_last_result` | JSON | ok/fail 摘要 |

### 4.4 哪些 market 用什么 `trade_date` 键

| 类别 | market_id | 键策略 |
|------|-----------|--------|
| 日终事件/行情 | limit, stk_limit, suspend, cb, sw, dc, top_list, block_trade, margin*, moneyflow, hsgt, etf | 业务 `trade_date` |
| 区间列表 | new_share | 用「查询结束日」=`trade_date`；payload 内自带范围 meta |
| 准静态目录 | opt, ths | `trade_date='00000000'`；TTL 按「日」失效（见 §5） |
| 占位 | `ts:ph:*` | **不缓存、不同步** |

---

## 5. 模式 × 源 × 新鲜度（Tushare 专用规则）

复用全局 `mode` / `quote_source`，但 **stale 判定与东财不同**：

### 5.1 新鲜度（日终切片）

对「按日」节点：

1. 解析目标 `trade_date`（默认上一完整交易日，与现网关一致）。  
2. 库中有 `(market_id, trade_date)` 且 `row_count>=0`（允许合法空表）→ **命中**。  
3. **同日切片**：默认视为「当日最终结果」，**不再因年龄 stale**（除非 `force=1` 或源=`network`）。  
4. **请求日 > 库中 last_trade_date**：视为缺失 → 按源决定是否拉网。  
5. **目录类**（`00000000`）：`synced_at` 超过目录 TTL 则 stale。  
   - speed: 7 天 · balanced: 1 天 · realtime: 6 小时  

### 5.2 源行为（与东财对齐）

| `quote_source` | 打开 `ts:*` |
|----------------|-------------|
| **local** | 只读 SQLite；无则空态 + 提示「请同步」；不入队 |
| **auto**（默认） | 有切片立即返回；无切片则入队拉网；同日不重拉 |
| **network** | 有切片也先返回（若有），并 **强制入队** 刷新该日 |

### 5.3 模式行为

| `cacheMode` | 打开时自动入队 | 定时任务 |
|-------------|----------------|----------|
| **speed** | 仅「完全无切片」时入队；有库则不后台刷 | 仍可跑（可配置 `ts_schedule_respect_speed`：默认 **仍跑**，因日终不伤盘中） |
| **balanced** | 无切片 → 入队；同日有库 → 不刷 | 默认启用 |
| **realtime** | 无切片或 `network` → 入队；同日有库默认不狂刷（专题非 tick） | 默认启用 |

> 说明：Tushare 专题 **不做 10s 轮询**。`realtime` 对 Tushare 的含义是「更愿意在缺失/强制时立刻联网」，不是盘口推送。

### 5.4 盘中 vs 盘后

- **盘中**打开昨日切片：直接本地，不浪费额度。  
- **盘后 15:05 后**：定时任务拉取「今日」切片（若日历 `is_open=1`）；失败保留昨片。  
- **未开市日**：定时跳过或只刷目录类。

---

## 6. 同步能力

### 6.1 手动同步（UX 强制后台，见 background-sync-ux）

| 入口 | API | 行为 |
|------|-----|------|
| 行情页「同步缓存」（当前 `ts:*`） | `POST /api/tushare/sync` `{ market_id, trade_date?, force:true, background:true }` | 只入队；**禁止**页面蒙层 |
| 行情页按钮 | 「同步本地行情」/「同步 Tushare」拆分；可选「全部」 | 分别打两 Worker；顶栏合并进度 |
| 设置页 | 「同步全部 Tushare 专题」 | 同 sync-all，进度只在顶栏 |
| 刷新按钮 | 重读或 force 入队 | 不进 overlay；完成靠 softReload |

进度：`GET /api/tushare/sync/progress`（与 cache progress 同构）→ 全局 `SyncStatusProvider` 轮询 → **Header 图标 + %**。  
完成后：若仍停留在对应 `ts:*`，**无刷新** `setRows`；不 `loadMarket` 全屏 Loading。

### 6.2 定时全量同步

**实现建议（一期）**：进程内调度，不引入系统 crontab 依赖。

- 模块：`web/tsrelay/scheduler.py`  
- 实现选项（按序偏好）：  
  1. **轻量**：`threading.Timer` / 每 30s 检查「是否到达 cron 点且今日未跑」——零新依赖；  
  2. 或 `APScheduler` BackgroundScheduler（若接受新依赖）。  
- 默认 cron：`30 15 * * 1-5`（Asia/Shanghai），覆盖 A 股常规收盘后日终发布窗口。  
- 触发：`start_sync_all(force=True)`，市场列表 = catalog 全部非 placeholder。  
- 并发：与现有 Tushare 限流一致（串行或最多 1 路 worker + `MIN_INTERVAL`）。  
- 失败：单市场记 `ts_market_meta.last_error`，不阻断后续；摘要写入 `ts_schedule_last_result`。  
- 服务未常开：定时不跑——文档说明「需 `run_web.sh` 保持运行」；可选二期 launchd。

### 6.3 同步顺序（全量时）

1. `trade_cal` → 确定 `target_trade_date`（今日若已收盘且 is_open，否则上一开市日）  
2. 轻量目录：`ts:ths`、`ts:opt`  
3. 日终宽表（耗额度高靠后）：`limit` → `cb` → `etf` → `sw` → `dc` → `moneyflow` → `margin_detail` → …  
4. 小表：`margin`、`hsgt`、`top_list`、`block_trade`、`suspend`、`stk_limit`、`new_share`

预估：约 16 次上游调用 × ≥0.35s ≈ **≥6s**，加宽表耗时，全量 **1–5 分钟** 量级（视中继）。

### 6.4 Worker 隔离

- 新线程名：`tushare-cache-sync`  
- **不要**塞进东财 `_ALL_SYNC_MARKETS` 同一互斥队列，避免大同步时卡死 A 股刷新。  
- 可共享「全局最多 1 个 Tushare 上游飞行请求」锁（已有 client throttle）。

---

## 7. API 契约变更

| 路由 | 变更 |
|------|------|
| `GET /api/tushare/market` | 增加读缓存逻辑；响应增加 `cached`、`stale`、`synced_at`、`as_of`、`syncing` |
| `POST /api/tushare/sync` | **新增** |
| `POST /api/tushare/sync-all` | **新增** |
| `GET /api/tushare/sync/progress` | **新增** |
| `GET /api/tushare/status` | **新增**：各 market_id meta + schedule 状态 |
| `GET/POST /api/tushare/schedule` | **新增**：读/改定时配置；`POST {enabled, cron}` |
| `POST /api/tushare/cache/clear` | **新增**：清 `ts_snapshot`（可按 market / 日期） |

`force=1` 查询参数：在非 `local` 源下强制入队刷新。

---

## 8. 前端改动要点

### 8.1 QuotesMarket

- `ts:*` 加载：继续 `fetchTushareMarket`，但展示真实 `synced_at` / `cached` / `syncing`。  
- 「同步缓存」：legacy → `/api/cache/sync`；tushare → `/api/tushare/sync`。  
- 「同步所有」：弹出或双按钮——本地行情 / Tushare 专题；或顺序执行并合并进度条。  
- 交易日切换：先读该日缓存；无则按源拉网。  
- `local` 源 + 无缓存：Empty「本地无此日数据，请切换自动/网络或点同步」。

### 8.2 Settings

- 说明文案：模式/源 **同时作用于东财行情与 Tushare 专题**。  
- 新块「Tushare 专题缓存」：  
  - 启用定时同步（开关）  
  - Cron 表达式（预设：收盘后 15:30 / 16:00 / 手动自定义）  
  - 上次运行结果  
  - 按钮：同步全部专题 / 清空专题缓存  

### 8.3 进度 UI

复用现有 overlay + progress；`job` 区分 `cache-all` vs `tushare-all`。

---

## 9. 容量与保留

| 项 | 建议 |
|----|------|
| 每节点保留交易日 | 最近 **60** 个自然日有数据的切片（可配 `ts_retain_days`） |
| 目录类 | 只保留 1 行 `00000000` |
| GC | 同步成功后或定时任务末尾删除过期 `(market_id, trade_date)` |
| 单行大小 | `moneyflow` 等可能数千行 JSON；注意 SQLite 单字段；必要时按 market 分文件二期再议 |
| 预估盘占用 | P0×60 日，量级约数十～百 MB（视资金流宽度） |

---

## 10. 错误与空表

- 上游成功且 0 行（如某日无涨停）：**仍写入**空切片，避免反复打网。  
- 上游失败：不覆盖已有成功切片；`sync_state=error`；读路径返回旧片 + `stale/error` 提示。  
- `api_scope_denied` / `invalid_params`：记错误，**不重试**，定时跳过该接口直至手动。  
- Token 未配置：定时不启动；手动 sync 返回明确错误。

---

## 11. 安全与运维

- Token 仍仅服务端 `.env`。  
- 定时日志：`tushare-gateway` logger，含 request_id。  
- 健康检查：`/api/tushare/health` 增加 `schedule: { enabled, next_run, last_run }`（可选）。

---

## 12. 非目标（本方案一期不做）

- 历史任意日期全量回填（只保证「目标日 + 保留窗口」）  
- 分钟线 / `rt_k` 高频落库  
- 财务/资讯 P2 节点  
- 系统级 launchd/cron 安装器  
- 服务端排序分页  
- 用 Tushare 替换东财 `cn` 快照  

---

## 13. 验收标准（方案级）

1. 断网 + `quoteSource=local`：曾同步过的 `ts:limit`/`ts:cb` 仍可打开对应交易日。  
2. `auto`：二次打开同日节点 **不打上游**（可用日志/计数验证）。  
3. 手动「同步全部 Tushare」：进度条走完，status 中各节点 `synced_at` 更新。  
4. 定时：改 cron 为「1 分钟后」可触发一次；`last_run` 有结果。  
5. 设置切换 `local` 后点刷新：网络请求数为 0。  
6. 东财 A 股同步与 Tushare 全量同步可并行或互不长期阻塞。

---

## 14. UX 锁定（2026-10-28 产品意向）

权威 UX：[`background-sync-ux.md`](./background-sync-ux.md)。实施时必须遵守：

1. 同步一律后台 Worker；**禁止页面蒙层**。  
2. 顶栏 **分轨** 图标/百分比；完成后 **无刷新** 更新。  
3. **来源 × 市场** 可视化徽章（东财 / 目录 / Yahoo / Tushare）。  
4. **按来源轨分开同步**（同步本节点 / 同步本轨）；禁止含糊「同步所有」作主按钮。  
5. 东财、目录、Yahoo、Tushare **全部**纳入同一套机制。

## 15. 拍板记录（2026-10-28 全部按建议确认）

| # | 决策 | 确认 |
|---|------|------|
| 1 | 定时 cron | 默认工作日 **15:30**；**另加 16:00 补跑一档**（同一日终目标日，已成功可跳过） |
| 2 | speed 下定时 | **仍执行** |
| 3 | 调度形态 | 一期 **进程内**（`run_web.sh` 常开）；不做 launchd |
| 4 | 顶栏空闲态 | **收纳为单图标**；展开 Popover 见四轨矩阵与分轨同步 |
| 5 | 同步主按钮 | 本节点 / 本轨；「全部来源」仅高级 |
| 6 | UX | 后台同步、无蒙层、分轨顶栏进度、完成后 softReload |

按 [`dev-plan-tushare-local-cache.md`](./dev-plan-tushare-local-cache.md) 实施。
