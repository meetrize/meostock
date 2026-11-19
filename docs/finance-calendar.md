# 财经日历（东财）

> 范围：东财财经日历同步落库 + Portal 面板 `calendar.events`  
> 数据源：`https://data.eastmoney.com/cjrl/default.html` 同源 JSON  
> 执行计划：[`dev-plan-finance-calendar.md`](./dev-plan-finance-calendar.md)

---

## 1. 目标

- 拉取东财「未来 30 天」财经日历全量（含全部分页），字段：时间、名称、主办单位、地区、类型。
- 存入本机 SQLite（`data/quote_cache.db`），支持变更检测 upsert。
- 夜间定时同步；Portal / 自定义版面可添加可筛选、按类型着色的面板。

---

## 2. 数据源（不用爬 HTML）

页面表格由 JS 调 datacenter 接口：

```
GET https://datacenter-web.eastmoney.com/api/data/v1/get
  reportName=RPT_CPH_FECALENDAR
  columns=START_DATE,END_DATE,FE_CODE,FE_NAME,FE_TYPE,CONTENT,STD_TYPE_CODE,SPONSOR_NAME,CITY
  pageSize=50&pageNumber=N
  filter=(END_DATE>='YYYY-MM-DD')(START_DATE<'YYYY-MM-DD+1')
  sortColumns=START_DATE&sortTypes=1
  source=WEB&client=WEB
```

| STD_TYPE_CODE | 页面标签 |
|---------------|----------|
| 1 | 财经会议 |
| 2 | 经济数据 |
| 3 | 其他类型 |

「周几 / 未来7天 / 未来30天」与类型标签均为同一数据集筛选；同步一次 30 天窗口即可本地过滤。

---

## 3. 存储

表 `finance_calendar_event`：

- PK：`fe_code`（东财 `FE_CODE`）
- `start_at` / `end_at` / `start_ts`
- `name` / `sponsor` / `city` / `fe_type` / `std_type_code` / `content`
- `importance` / `importance_reason` / `importance_rated_at`：DeepSeek 1–5 星（仅未评级时写入）
- `content_hash`：变更检测
- `first_seen_at` / `updated_at` / `synced_at`

窗口：`[today-3, today+29]`（含进行中 overlap）。分页 `pageSize=50` 拉齐。不硬删远端消失项。

---

## 4. 定时任务

| 字段 | 值 |
|------|-----|
| id | `finance_calendar_sync` |
| name | 东财财经日历同步 |
| interval | 1440 分钟 |
| 对齐 | 每次成功后 `next_run_at` → 本地次日 02:00 |
| 默认 | enabled=1 |

手动：`POST /api/scheduler/jobs/finance_calendar_sync/run`

---

## 5. HTTP API

实现包：`web/fe_calendar/`（避开标准库名 `calendar`），路由前缀仍为 `/api/calendar`。

| 路径 | 说明 |
|------|------|
| `GET /api/calendar/events` | `from` `to` `std_type` `fe_type` `city` `q` `importance`(`unrated`\|`1`..`5`≥N) `limit` |
| `GET /api/calendar/facets` | 类型 / 细类 / 地区计数 |
| `GET /api/calendar/sync/status` | 上次同步摘要 |
| `GET /api/calendar/ai-rate/pending` | 未评级条数 |
| `GET /api/calendar/ai-rate/progress` | AI 评级进度 |
| `POST /api/calendar/ai-rate` | 异步批量评级（跳过已有 `importance`；需设置页已配置 AI 模型） |

AI Key / 模型见 [ai-provider-settings.md](./ai-provider-settings.md)。

面板「AI 重要程度评级」按钮会轮询进度并展示五星；展开行可见评级理由。

---

## 6. Portal 面板 `calendar.events`

- 快捷范围：今日 / 7 天 / 30 天
- 筛选：`STD_TYPE` chip、细类、地区、关键词
- 色条：`1` 冷蓝 / `2` 琥珀 / `3` 青灰
- 总览与自定义版面共用 Catalog

---

## 7. 验收

1. 手动跑任务 → DB 有未来约 30 天事件  
2. `/api/calendar/events` 可过滤  
3. 面板着色与筛选可用  
4. 再跑一次：`inserted/updated/unchanged` 合理  
