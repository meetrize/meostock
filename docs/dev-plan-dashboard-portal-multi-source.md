# 首页多来源面板 — 开发计划

> 状态：**已拍板并实施中**（2026-10-28）  
> 权威产品方案：[`dashboard-portal-multi-source.md`](./dashboard-portal-multi-source.md)

---

## 拍板（三个开关）

| # | 决策 | 选择 |
|---|------|------|
| 1 | 默认第三块 | **`strip.futures` 国内主力期货** |
| 2 | 涨跌停名单位置 | **新行半宽**，不挤自选/热点板块 |
| 3 | 全球指数条带 | **贴在六 KPI 正下方**（全宽） |

默认增量仅三块：`strip.globalIndices` + `topic.limitList` + `strip.futures`。其余进 Catalog。

---

## 一期交付物

1. Catalog 扩展 + 场景分组「添加面板」抽屉  
2. `PortalMarketBridge`：按布局订阅 market，遵守 `cacheMode`/`quoteSource`，softReload  
3. 默认布局 v6（存储 key 升级）  
4. 新面板：全球指数条带、期货条带、涨跌停名单  
5. 星标 Catalog：外汇、贵金属、龙虎榜、两融 KPI、可转债榜、港股榜  
6. 构建通过

---

## 任务拆解

### D1 — 基础设施

- [x] `PortalWidgetType` 扩展；`PORTAL_STORAGE_KEY` → v6  
- [x] `widgetCatalog` 分组 + 尺寸；`defaultLayouts` 重排  
- [x] `portal/curatedSymbols.ts` 精选代码  
- [x] `services/portalMarkets.ts`：snapshot / tushare market 读封装  
- [x] `usePortalMarkets`：按 widgets 集合拉数 + softVersion

### D2 — 条带面板

- [x] `StripWidget`：横滑卡片（价/%）  
- [x] `strip.globalIndices` / `strip.futures` / `strip.metals` / `strip.fx` / `strip.crypto`  
- [x] CSS + 点击跳转 `/quotes` 对应市场（或标的页）

### D3 — 专题名单

- [x] `TopicListWidget`：`topic.limitList` / `topic.topList`  
- [x] 交易日展示；空态提示同步  
- [x] 来源徽章（Tushare 琥珀）

### D4 — 星标 Catalog

- [x] `rank.hk` / `rank.cb`  
- [x] `stat.margin`  
- [x] Catalog 抽屉分组 UI

### D5 — 收尾

- [x] `scripts/build_dashboard.sh`  
- [x] 文档勾选 + 验收

---

## 默认布局（v6）

```
y=0   六指数 w=2 h=2
y=2   六 KPI w=2 h=2
y=4   strip.globalIndices  w=12 h=3
y=7   watchlist | hotBoards  w=6 h=10
y=17  topic.limitList | strip.futures  w=6 h=10 / w=6 h=3→对齐到同行时 strip 用 h=10 内嵌或 h=3 顶对齐
y=27  marketRanking | boardFundFlow
y=39  fundFlowRank
```

实施时：`limitList` 与 `futures` 同行：`limitList` w=6 h=10，`futures` w=6 h=3（顶部对齐，下方留空由 compact 填洞亦可接受）；或 futures 放在 global 条带右侧改半宽——**按拍板：limit 与 futures 新行，futures 半宽 h=3，limit 半宽 h=10**。

---

## 验收

```text
[x] 新用户/重置默认可见：全球条带 + 涨跌停名单 + 期货条带
[x] 添加面板按场景分组且有来源色点
[x] local 空缓存显示空态不崩
[x] 同步完成后相关面板 soft 更新、无蒙层
[x] 旧布局 localStorage v5 可被 v6 默认替换（重置）或并存迁移
[x] 构建通过
```
