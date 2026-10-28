# 独立指数面板 + 全局价格/曲线 — 开发计划

> 状态：**实施中**（2026-10-28）  
> 方案：[`dashboard-portal-spark-panels.md`](./dashboard-portal-spark-panels.md)

## 拍板

| # | 决策 | 选择 |
|---|------|------|
| 1 | 条带 → 独立面板 | **默认布局全部拆开** |
| 2 | 曲线周期 | 日线近 60 根（同现指数） |
| 3 | 全局偏好存放 | Portal `indexDisplayMode`（localStorage v7） |
| 4 | 条带 | 保留 Catalog 可选，默认不用 |

## 任务

- [x] `sparkCatalog` + `PortalWidgetType` 扩展  
- [x] `SparkQuoteWidget` + kline 按 quoteSource  
- [x] A 股 `IndexWidget` 复用 / 委托  
- [x] `indexDisplayMode` + Toolbar 切换  
- [x] 默认布局 v7；`usePortalMarketsData` 支持 spark  
- [x] 构建重启验收  

## 验收

```text
[x] 默认可见独立全球指数 + 期货小面板（非条带）
[x] 单卡点击价格↔面积图
[x] 全局「曲线」后刷新/重进仍默认曲线
[x] 缓存模式 cache_only；实时 force
[x] 构建通过
```
