# 指数面板统一形态 — 开发计划

> 状态：**已实施**（2026-10-28）  
> 方案：[`dashboard-portal-spark-quote-unified.md`](./dashboard-portal-spark-quote-unified.md)

## 拍板

| # | 决策 | 选择 |
|---|------|------|
| 1 | 价格/曲线切换 | **取消**（Toolbar + 单卡 + `indexDisplayMode`） |
| 2 | 布局 | 标题行：点位/涨幅/涨额/[成交额]；正文：常驻面积图 |
| 3 | 曲线上色 | **今日涨跌**红绿（非窗口首尾） |
| 4 | 曲线增值一期 | 昨收线、末点、60D%、高低标、量能底栏、增强 tooltip |
| 5 | 持久化 | localStorage **v8**；迁移时丢弃 `indexDisplayMode` |
| 6 | 默认高度 | index/spark 默认 **`h=3`** |

## 任务

### A. 产品结构

- [x] `WidgetChrome` header slot（portal 注入报价）
- [x] `SparkQuoteWidget` 仅图表 + 叠加层；报价经 slot 进标题
- [x] Catalog 文案；默认 layout `h=3`

### B. 去掉双模式

- [x] 删除 Toolbar「价格｜曲线」与 `indexDisplayMode` / `portalDisplayContext`
- [x] storage key → v8；v7 迁移 + spark `h=2→3`

### C. 曲线增值（P0+P1）

- [x] 今日涨跌定色、昨收虚线、末点、60D%、高低标、量能底栏、tooltip
- [x] symbol 级短缓存 + inflight 去重

### D. 验收

- [x] 构建 `./scripts/build_dashboard.sh` 通过
- [ ] `/dashboard/` 目视确认（硬刷新；旧 v7 布局会自动迁到 v8 并抬高 spark 高度）
