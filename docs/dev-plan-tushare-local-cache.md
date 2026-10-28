# Tushare 本地缓存 + 定时/手动同步 — 开发计划

## 拍板（2026-10-28 已全部确认）

| # | 决策 | 选择 |
|---|------|------|
| 1 | 存储 | **同一** `data/quote_cache.db`，新表 `ts_snapshot` / `ts_market_meta` |
| 2 | 读 API | 仍走 `/api/tushare/market`（内部接缓存） |
| 3 | 模式/源 | **复用** 全局 `cacheMode` + `quoteSource` |
| 4 | 同步 UI | 按来源轨分开；左侧徽章；顶栏单图标展开四轨 |
| 5 | 定时 | `30 15 * * 1-5` + **`0 16 * * 1-5` 补跑**；`speed` 仍跑 |
| 6 | 调度 | 进程内 30s tick；无 APScheduler / launchd |
| 7 | 保留 | 每节点最近 **60** 日；目录类单行 |
| 8 | UX | 无蒙层、分轨进度、softReload（见 background-sync-ux） |

权威设计：[`tushare-local-cache.md`](./tushare-local-cache.md)  
全局 UX：[`background-sync-ux.md`](./background-sync-ux.md)（**同步禁止页面蒙层；顶栏 %；完成后 softReload**）

---

## 一期目标（可验收）

1. 全部非占位 P0 `ts:*` 读写走 SQLite；二次打开同日不打上游（`auto`）。  
2. `local` / `auto` / `network` 对 Tushare 行为符合方案 §5。  
3. 手动：单节点同步、全部 Tushare 同步；**进度只在顶栏**。  
4. 定时：可开关、可改 cron、有 last_run；服务常开时到点执行。  
5. 设置页可管理定时与清空专题缓存。  
6. **所有同步**后台化：不挡 UI；顶栏 **分轨** 进度；完成后无刷新更新。  
7. **来源↔市场** 徽章 + 分轨独立同步（见 UX §0.1）。  
8. 东财读缓存语义不被破坏。

---

## 任务拆解（按序）

### P0 — Schema 与模型

- [x] `web/cache/schema.sql` 追加 `ts_snapshot`、`ts_market_meta`  
- [x] `web/cache/db.py` / 迁移：已有库 `CREATE IF NOT EXISTS`  
- [x] `web/tsrelay/store.py`：`get_snapshot` / `replace_snapshot` / `list_meta` / `gc_old` / etag  
- [x] `cache_config` 键：`ts_schedule_*`、`ts_retain_days`

### P0.5 — 来源映射 + 全局后台同步 UX

权威：[`background-sync-ux.md`](./background-sync-ux.md)

- [x] 共享常量/`GET /api/cache/sync/catalog`：`SourceLane` × market_id 对照表  
- [x] 行情页左侧：**来源徽章**（东财/目录/Yahoo/Tushare/占位）+ tooltip  
- [x] `SyncStatusProvider`：**四轨** `SyncTrack`；轮询 cache + tushare progress（`lanes`）  
- [x] `Header`：分轨指示（可多轨同时 %）+ Popover 矩阵（每轨独立「同步本轨」）  
- [x] `QuotesMarket`：去掉同步蒙层；「同步本节点」；去掉含糊「同步所有」主按钮（改下拉/面板）  
- [x] `softReload`：按 `completedLanes` / 当前 market 静默更新  
- [x] `Settings`：**来源矩阵**四卡分轨同步  
- [x] 后端：`POST /api/cache/sync-all` 支持 `lanes[]`；progress 返回按 lane 汇总  
- [x] 验收：徽章正确；只同步 Yahoo 时东财轨不转；可双轨并行显示

### P1 — 读路径接缓存

- [x] `markets.fetch_market` 与 Facade 分离：`pull_live()` vs `read_cached()`  
- [x] `api.market`：按 `quote_source` + `mode` + `trade_date` 决定是否入队  
- [x] 响应字段：`cached` `stale` `synced_at` `as_of` `syncing`  
- [x] 合法空表落库（防穿透）  
- [x] 入队刷新时前端只靠顶栏，不蒙层

### P2 — TsSyncWorker + 手动同步 API

- [x] `web/tsrelay/sync_worker.py`：队列、progress、单市场/全市场  
- [x] `POST /api/tushare/sync`、`sync-all`、`GET sync/progress`、`GET status`（progress **同构**）  
- [x] `POST /api/tushare/cache/clear`  
- [x] 同步顺序按设计 §6.3；占位节点跳过  
- [x] 与东财 worker **分线程**；上游限流复用 `client`  
- [x] Provider 合并双轨百分比

### P3 — 定时调度

- [x] `web/tsrelay/scheduler.py`：启停、cron 解析（可用标准库或极简 5 段 cron）  
- [x] `server.py` startup：Token 存在且 enabled → start schedule loop  
- [x] `GET/POST /api/tushare/schedule`  
- [x] 到点触发 sync-all；写 `ts_schedule_last_run/result`；前端顶栏可感知  
- [x] 未开市日策略：跳过日终类或仅目录类（实现时写清）

### P4 — 前端（Tushare 缓存能力）

- [x] `services/tushare.ts`：sync / progress / schedule / status 封装  
- [x] `QuotesMarket`：Tushare 读缓存 + 徽章；同步本节点走 tushare 轨  
- [x] `Settings`：矩阵中 Tushare 卡含定时开关 + 清空专题缓存  
- [x] 文案：后台分轨同步，见顶栏  
- [x] `scripts/build_dashboard.sh`

### P5 — 收尾

- [x] 交叉链接文档  
- [x] 设置页说明「服务需常开定时才跑」  
- [x] 本文件勾选 + 验收清单（含 UX）

---

## 非目标

- launchd 安装器  
- P1/P2 新接口扩缓存（先覆盖现有 P0 列表）  
- moneyflow 全市场无限翻页（维持现 limit 页，原样落库）  
- APScheduler / Redis  

---

## 验收清单

```text
[x] 左侧市场有来源徽章，与东财/目录/Yahoo/Tushare 对照表一致
[x] 顶栏分轨进度；同步本轨互不影响其它轨指示
[x] 「同步本节点」只刷当前 market；无页面蒙层
[x] 设置页来源矩阵可分轨同步
[x] 完成后静默更新列表（无整页 Loading）
[ ] 同步 ts:cb 后断网+local：仍可打开（接口已接缓存，建议手测）
[ ] auto 同日二次打开无上游 POST（建议手测）
[x] schedule 只点亮 tushare 轨；disabled 不跑
[x] clear 专题后 local 空态
[x] cn snapshot 行为不回归
[x] dashboard 构建通过
```

---

## 建议实施切片（日历）

| 切片 | 内容 | 预估 |
|------|------|------|
| D0 | **P0.5**：lane 映射 + 徽章 + 分轨顶栏 + 去蒙层 + lanes 过滤 + Settings 矩阵骨架 | 0.5–1d |
| D1 | P0 schema + store + 读路径缓存 | 0.5–1d |
| D2 | P2 Tushare worker + 第四轨 progress | 0.5–1d |
| D3 | P3 scheduler + 矩阵定时 + 联调 | 0.5–1d |
| D4 | GC、文档、验收 | 0.5d |

---

## Agent 执行约定

- 改动贴合本计划；不顺手大重构东财 sync。  
- Tushare 空表成功必须落库。  
- `401/scope_denied/invalid_params` 不重试。  
- 每完成一块在本文件勾选。  
- 用户未确认 §拍板前，可先改文档；**确认后立即开工**。
