# Research Workbench — 开发计划

> 权威产品设计：[`炒股战法/研判分析工具设计方案.md`](./炒股战法/研判分析工具设计方案.md)（**单一事实源**）  
> 精简总览：[`炒股战法/研判工具设计-交互总览.md`](./炒股战法/研判工具设计-交互总览.md)  
> 方法论：[`炒股战法/股票投资入门知识体系与研判方法论.md`](./炒股战法/股票投资入门知识体系与研判方法论.md)  
> 已交付功能清单：[`research-workbench-feature-inventory.md`](./research-workbench-feature-inventory.md)（前后端 + 业务数据逻辑）  
> 代码落点：`web/research/`（新建）+ `apps/stock-dashboard`（路由 / 页面 / Portal widgets）+ 复用 `web/agent`、`web/cache`、`web/tsrelay`  
> 构建：`./scripts/build_dashboard.sh` → `web/static/dashboard`  
> 本文**不构成投资建议**。

---

## 1. 拍板

| # | 决策 | 选择 |
|---|------|------|
| 1 | 路由 | `/research/*` 挂在现有 dashboard 路由树（basename `/dashboard`）；不另起站点 |
| 2 | 持仓真相源 | `TradeCard`（`status=open`）+ 手动导入 JSON/CSV |
| 3 | 观察池 | 现有 `/watchlist`；**不参与**集中度 / 暴露计算 |
| 4 | 北向 | 日频净流入禁用；P0 清偿 Portal `stat.northbound`（改口径或下线） |
| 5 | 财务 | P2 前探测 Tushare `g_research`；无权限则 PE/PB + 空态 |
| 6 | 情绪规则分 | 本地 `ts:limit` + 全市场行情宽度；`/fupan` 仅短线桌 iframe 嵌入 |
| 7 | AI | Agent 注入 Scope；输出经证据 / 数值校验层；默认不自动荐股 |
| 8 | 分期优先级 | P1 榨干行情/涨停/两融/资金流/板块；完整回测后置到 P4 |

---

## 2. 现有能力挂载点

| 能力 | 路径 |
|---|---|
| 路由 | [`apps/stock-dashboard/src/router/index.tsx`](../apps/stock-dashboard/src/router/index.tsx) |
| 侧栏 | [`apps/stock-dashboard/src/components/layout/Sidebar.tsx`](../apps/stock-dashboard/src/components/layout/Sidebar.tsx) |
| Portal catalog / 布局 | `apps/stock-dashboard/src/pages/Dashboard/portal/widgetCatalog.ts`、`defaultLayouts.ts`、`widgets/` |
| Workspaces | `apps/stock-dashboard/src/pages/Workspaces/` |
| 技术扫描 / 涨跌停幅度 | [`apps/stock-dashboard/src/services/analysis.ts`](../apps/stock-dashboard/src/services/analysis.ts) |
| Scanner / EOD UI | `pages/Scanner/`、`pages/EndOfDayPicker/` |
| 个股详情 | `pages/StockDetail/StockDetail.tsx` |
| 板块 / 复盘 / 资金 | `pages/Boards/`、`pages/FupanReview/`、`pages/MarketFundFlow/` |
| 宏观利率 | `web/macro/` + `services/macroRates.ts` |
| 新闻 / 日历 | `web/news/`、`web/fe_calendar/` |
| Tushare topics | [`web/tsrelay/catalog.py`](../web/tsrelay/catalog.py)（`limit` / `margin` / `moneyflow` / `top_list` / `hsgt` / 板块；`g_research` 仍为 placeholder） |
| 行情缓存 | `web/cache/` |
| Agent / AI | `web/agent/`、`web/ai/` |
| 北向现网债 | `portal/widgets/StatWidgets.tsx` 中 `StatNorthboundWidget` + `stat.northbound` catalog |

---

## 3. 目标架构（增量）

```text
UI: /research/* + research.* Portal widgets + /s/:code 研判 Tab
        │
        ▼
web/research/          ← 新建 BFF：聚合 cache / tsrelay / macro / news / cards
  api.py               ← /api/research/*
  models.py            ← Scope / Signal / Evidence / TradeCard / Metric*
  signals/             ← 温度分、主题、一致性、风控规则
  ai_validate.py       ← 证据 id + 数值校验
        │
        ▼
Data: quote_cache · ts_* · macro · calendar · news · TradeCard store
```

---

## 4. 任务拆解

### Phase 0 — 骨架、协议与现网债

- [x] 新建 `web/research/`：schema 草案（`Scope` / `MetricDefinition` / `MetricSnapshot` / `Signal` / `Evidence` / `TradeCard` / `StrategyTemplate`）
- [x] FastAPI 挂载 `GET /api/research/health` + `/regime` 占位 + `/risk-rules`
- [x] 前端：侧栏「研判」→ `/research` 空壳总览（跳转大盘/板块/个股/扫描/Agent）
- [x] Agent：chat 请求支持 `scopeType` / `scopeId` / `asOf` / `visibleSignals` / `strategyTemplateId`；强制输出字段见设计方案 §6.3
- [x] AI 输出校验层：`research/ai_validate.py`；无 `evidence_ids` 或数值冲突 → 拦截 / 降级；SSE `research_validation`
- [x] **北向债**：默认布局移除 `stat.northbound`；组件改为「已停更」提示；持久化布局自动剥离
- [x] 文档化最小风控口径：见下文 §8 + `GET /api/research/risk-rules`

**验收**

- [x] 浏览器能打开 `/dashboard/research` 并沿现有页走完路径 A
- [x] Agent 在绑定 Scope 时无证据方向句被拦截（校验层单测 + runtime 挂钩）
- [x] 默认 Portal 布局不再出现误导性北向日频净流入

### Phase 1 — 大盘 + 板块 + 技术 + 最小风控

- [x] `GET /api/research/market-thermometer`：涨跌家数、涨停质量、成交额代理、两融占位；**不含**北向日频净流入
- [x] 情绪阶段状态机：ice/start/main/diverge/ebb（本地宽度 + 涨停结构）
- [x] `GET /api/research/themes/leaders`：行业/概念涨幅主线（资金流聚合标为后续）
- [x] 扩展 Scanner：`assessTradability` 可成交标记（一字/涨跌停/无报价）
- [x] Portal widgets：`research.regime` / `marketThermometer` / `themeLeaders` / `radarWatchlist` / `portfolioRisk`
- [x] 三套 Workspace 预设（长线 / 波段 / 短线）于「自定义版面」一键创建
- [x] TradeCard 最小存储 + 导入 API；**最小风控面板**（总览页 + `/portfolio/risk` + Portal widget）

**验收**

- [x] `/dashboard/research` 可见温度、主线、风控；可跳转大盘/板块/扫描
- [x] open 卡片强制 `stop_rule`；集中度/违规可统计
- [x] 温度分可下钻因子；资金/成交口径有 caveat 标注
- [x] Portal 目录「研判工作台」分组可选；版面页可生成三套研判桌

### Phase 2 — 财务 / 估值 + 扫描器 + 完整风控

- [x] Tushare 财务权限探测：`GET /api/research/fina/probe` + health 内嵌；无 token/权限 → `degraded_pe_pb`
- [x] 有权限：ROE / 毛利 / 现金流 / 负债；无权限：PE/PB **全市场截面分位**（行情）+ 财务维空态（不编造）
- [x] `GET /api/research/stock/{code}/scorecard`（按 long/swing/short 模板过滤六维）
- [x] 商业模式三态（清晰/存疑/未验证）`PUT .../business-mode`；未验证禁止 open 卡片
- [x] 质量+低估值扫描模板（`POST /api/research/scanner/run`）+ 可成交标注
- [x] 组合风控增强：行业暴露、再平衡提示、违规计数（`/portfolio/risk`）
- [x] 一致性检查器：`GET /api/research/stock/{code}/consistency`；个股 Scorecard 展示冲突

**验收**

- [x] 自下而上：个股页 Scorecard；无财务权限时估值降级空态且不编造
- [x] 组合暴露 / 集中度 / 行业顶可见；扫描可跳转个股

### Phase 3 — 事件 + AI 简报 + 复盘

- [x] `GET /api/research/stock/{code}/timeline`：news + calendar + top_list + block_trade（缺源标 gap）
- [x] `POST /api/research/ai/brief`（规则组装 + `ai_validate`；`auto_recommend=false`）
- [x] TradeCard：列表可按 symbol；`POST /cards/{id}/close` 强制归因 + falsify 核对
- [x] 复盘报表：`GET /api/research/review/report`（胜率/盈亏比/回撤/完整率；基准超额缺 K 线则 gap）
- [x] Widget：`research.aiBrief`、`research.eventTimeline`（`portfolioRisk` 已有）

**验收**

- [x] 简报必须带 evidence_ids；校验 blocked 时不伪装硬事实；不自动荐股
- [x] 卡片字段完整率可统计；复盘含基准字段（区间收益待 Phase 4 K 线补齐）

### Phase 4 — 回测与行为

- [x] `POST /api/research/backtest/run`（MA 趋势；disclose_at/涨跌停不可成交/T+1/成本/样本内外/规则版本；幸存者全市场未重建则声明）
- [x] 行为偏差：`GET /api/research/behavior/report`（处置效应 / 追涨 / 频繁 / 亏损加仓）
- [x] 策略说明书：`POST /api/research/strategy/spec`（Markdown/JSON；未样本外 →「实验性」）
- [x] 复盘基准超额：用日 K 区间收益补齐 Phase 3 gap

**验收**

- [x] 样本外统计可跑；说明书可导出；实验性标记可见
- [x] 总览含行为偏差报告（随复盘一并展示）

---

## 5. API 清单（与设计方案 §7.3 对齐）

| API | Phase |
|---|---|
| `GET /api/research/regime` | 0 占位 → 1 实装 |
| `GET /api/research/market-thermometer` | 1 |
| `GET /api/research/themes/leaders` | 1 |
| `GET /api/research/stock/{code}/scorecard` | 2 |
| `GET /api/research/stock/{code}/timeline` | 3 |
| `GET /api/research/stock/{code}/consistency` | 2 |
| `POST /api/research/scanner/run` | 2 |
| `GET /api/research/portfolio/risk` | 1 最小 / 2 完整 |
| `POST /api/research/ai/brief` | 3 |
| `CRUD /api/research/cards` | 1 最小 / 3 完整 |
| `POST /api/research/backtest/run` | 4 |

实现优先**聚合已有 API**；Scorecard 在 BFF 层拼装。

---

## 6. 手工验收路径

```text
http://127.0.0.1:8765/dashboard/research
```

1. Phase 0：打开总览 → 跳转 dapan / boards / s/:code / scanner / agent；确认无误导北向净流入  
2. Phase 1：看温度分与主线 Top → 打开龙头六维技术维 → 建一张带止损的 TradeCard → 看集中度  
3. Phase 2：质量低估值扫描 → 打开 Scorecard → 看一致性冲突 → 组合暴露  
4. Phase 3：事件轴冲击 → Brief（有证据）→ 结案复盘含基准  
5. 前端变更后：`./scripts/build_dashboard.sh`

---

## 7. 非目标（与设计方案 §13 一致）

- 自动下单 / 跟单 / 券商持仓同步  
- 把未样本外验证的曲线当作产品结论  
- 解析 `/fupan` 外链 HTML 充当硬指标  
- 用月频宏观或停更北向日频净流入冒充实时信号  

---

## 8. 最小风控口径（Phase 0 文档 / Phase 1 面板）

权威运行时副本：`GET /api/research/risk-rules`（实现于 `web/research/risk_rules.py`）。

| 规则 ID | 名称 | 默认 | 违规标签 |
|---|---|---|---|
| `stop_line_required` | 单票止损线 | open 卡片必须有 `stop_rule` | `missing_stop` |
| `single_name_cap` | 单票仓位上限 | ≤ **15%** 总资产 | `single_name_overweight` |
| `concentration_cap` | 组合集中度 | 单行业 ≤ **40%**；同时 open ≤ **10** 只 | `concentration_breach` |
| `violation_counter` | 违规计数 | 复盘统计上述违规 → 目标 0 | `discipline_violation` |

持仓真相源：`TradeCard(status=open)` + 手动导入；**watchlist 不参与**集中度计算。

---

## 修订记录

| 日期 | 说明 |
|---|---|
| 2026-11-20 | 初版：对齐设计方案 v2.1 拍板，Phase 0–4 工程拆解与挂载点 |
| 2026-11-20 | Phase 0 落地：research API、研判页、Agent Scope、校验层、北向债、风控口径 §8 |
| 2026-11-20 | Phase 1 落地：温度计、主线 leaders、TradeCard/风控、Scanner 可成交；Portal 预设顺延 P1.1 |
| 2026-11-20 | Phase 1.1：research.* Portal widgets + 长线/波段/短线 Workspace 预设 |
