# 财经日历 — 开发计划

> 权威设计：[`finance-calendar.md`](./finance-calendar.md)

---

## 拍板

| # | 决策 | 选择 |
|---|------|------|
| 1 | 抓取方式 | 东财 datacenter JSON，不爬 DOM |
| 2 | 窗口 | today-3 … today+29 |
| 3 | DB | `quote_cache.db` 新表 |
| 4 | 调度 | 现有 scheduler，次日 02:00 |
| 5 | UI | Portal `calendar.events` |

---

## 任务

### P0 文档

- [x] `docs/finance-calendar.md`
- [x] `docs/dev-plan-finance-calendar.md`

### P1 同步与库

- [x] `schema.sql` 表 + 索引
- [x] `web/scheduler/finance_calendar_sync.py` 分页 + upsert
- [x] 注册 `finance_calendar_sync` job，next_run 对齐 02:00

### P2 API

- [x] `web/calendar/` events / facets / sync status
- [x] `server.py` 挂载

### P3 面板

- [x] Catalog + `CalendarEventsWidget`
- [x] 筛选 / 着色 / 展开详情

### P4 验收

- [x] 手动同步 + build_dashboard

---

## 手工验收

```text
POST /api/scheduler/jobs/finance_calendar_sync/run
GET  /api/calendar/events?from=...&to=...
总览 / 自定义版面 → 添加「财经日历」
```
