# Research Workbench — 功能清单与业务数据逻辑

> 对应工程计划：[`dev-plan-research-workbench.md`](./dev-plan-research-workbench.md)（Phase 0–4 已交付）  
> 产品设计 SSOT：[`炒股战法/研判分析工具设计方案.md`](./炒股战法/研判分析工具设计方案.md)  
> 代码：`web/research/`（BFF）+ `apps/stock-dashboard`（UI）  
> **不构成投资建议。**

入口：`/dashboard/research`（basename `/dashboard`）  
原则：证据优先、不自动荐股；持仓真相源 = `TradeCard(status=open)`；观察池 `/watchlist` **不计入**集中度/暴露。

---

## 1. 总体架构

```text
前端
  /research 总览
  /s/:code 个股 Scorecard + 事件轴
  Portal research.* widgets
  Workspace 长线 / 波段 / 短线桌
  Agent Scope + 校验 SSE
        │
        ▼
web/research/*  BFF 聚合
        │
        ▼
数据：quote_snapshot · kline_bar · ts_snapshot
     fe_calendar · feedgen news · TradeCard SQLite
     Tushare fina_indicator（可选）
```

构建：`./scripts/build_dashboard.sh` → `web/static/dashboard`

---

## 2. 后端 API 清单

前缀：`/api/research`

| 方法 | 路径 | 阶段 | 说明 |
|---|---|---|---|
| GET | `/health` | 0–4 | 版本、phase、capabilities、fina 探测摘要 |
| GET | `/regime` | 0→1 | 仓位倾向 + 温度摘要（宏观仍有占位） |
| GET | `/risk-rules` | 0 | 风控口径文档化 |
| GET | `/market-thermometer` | 1 | 大盘温度分 + 情绪阶段 + 因子 |
| GET | `/themes/leaders` | 1 | 行业/概念涨幅主线 |
| GET | `/portfolio/risk` | 1→2 | 持仓集中度、行业暴露、违规、再平衡提示 |
| GET | `/cards` | 1 | 列表（`status` / `symbol` 过滤） |
| GET | `/cards/{id}` | 1 | 单卡 |
| POST | `/cards` | 1 | upsert |
| POST | `/cards/import` | 1 | 批量导入 |
| DELETE | `/cards/{id}` | 1 | 删除 |
| POST | `/cards/{id}/close` | 3 | 结案 + falsify 核对 |
| GET | `/fina/probe` | 2 | 财务权限探测 |
| GET | `/strategy-templates` | 2 | 长线/波段/短线六维启用表 |
| GET | `/stock/{code}/scorecard` | 2 | 六维 Scorecard |
| GET | `/stock/{code}/consistency` | 2 | 维度冲突 |
| GET/PUT | `/stock/{code}/business-mode` | 2 | 商业模式三态 |
| GET | `/stock/{code}/timeline` | 3 | 事件轴 |
| GET | `/scanner/templates` | 2 | 扫描模板列表 |
| POST | `/scanner/run` | 2→M3 | 质量+低估值；技术三件套；长线 `dividend_roe` / `growth_trend`（含 why_hit / tradability） |
| GET | `/strategy-presets` | M1 | 官方选股预设（短/波/长） |
| GET | `/strategy-presets/schema` | M1 | RuleBlock / Copy 字段目录 |
| GET | `/strategy-presets/{id}` | M1 | 单预设 + resolved_copy |
| POST | `/strategy-presets/resolve-copy` | M1 | 参数覆盖后重算文案/条件清单 |
| POST | `/ai/brief` | 3 | Scope 简报（经校验层） |
| GET | `/review/report` | 3→4 | 复盘报表（含基准超额） |
| POST | `/backtest/run` | 4 | MA 趋势回测 |
| GET | `/behavior/report` | 4 | 行为偏差 |
| POST | `/strategy/spec` | 4 | 策略说明书（JSON / Markdown） |

Agent 侧（非本前缀）：`POST /api/agent/chat` 注入 `scopeType` / `scopeId` / `asOf` / `visibleSignals` / `strategyTemplateId`；SSE 事件 `research_validation`（`web/research/ai_validate.py`）。

主要实现文件：`web/research/api.py` 及同目录各模块。

---

## 3. 前端功能清单

### 3.1 研判总览 `/research`

路径：`apps/stock-dashboard/src/pages/Research/`

| 区块 | 能力 |
|---|---|
| 大盘温度 | 温度分、阶段、涨跌家数、涨停结构、因子下钻 |
| 主线板块 | Top 行业/概念，跳转板块页 |
| 回测 / 说明书 | 对代码框标的跑 MA 回测 + Markdown 说明书 |
| 行为偏差 | 四类偏差触发状态与建议 `attribution_tags` |
| AI 简报 | 规则简报 + 校验状态（明确非荐股） |
| 复盘报表 | 胜率 / 盈亏比 / 回撤 / 超额 / IR / 完整率；结案入口 |
| 质量+低估值扫描 | 运行扫描 → 跳转个股 |
| 组合风控 | 创建 open 卡片、权重、行业暴露、违规列表 |
| 快捷入口 | 大盘 / 板块 / 复盘 / 扫描 / 观察池 / Agent |

### 3.2 个股页 `/s/:code`

路径：`apps/stock-dashboard/src/pages/StockDetail/`

| 组件 | 能力 |
|---|---|
| `ResearchScorecard.tsx` | 长线/波段/短线模板切换；六维 pill；商业模式三态；冲突列表；估值/财务明细 |
| `ResearchTimeline.tsx` | 资讯 / 日历 / 龙虎榜 / 大宗时间线 |

### 3.3 Portal widgets

目录分组：`research`（研判工作台）  
注册：`portal/types.ts` · `widgetCatalog.ts` · `widgets/index.tsx` · `ResearchWidgets.tsx`

| type | 说明 |
|---|---|
| `research.regime` | 进攻 / 防守倾向 |
| `research.marketThermometer` | 温度计 |
| `research.themeLeaders` | 主线板块 |
| `research.radarWatchlist` | 观察池（非持仓）→ 个股 |
| `research.portfolioRisk` | 持仓风控 |
| `research.aiBrief` | 今日简报 |
| `research.eventTimeline` | 事件轴 |

### 3.4 其它前端改动

- 侧栏「研判」→ `/research`
- Workspace：长线 / 波段 / 短线三套研判桌一键创建（`researchPresets`）
- Scanner：`assessTradability`（一字 / 涨跌停 / 无报价 → 信号成立但不可成交）
- 北向日频净流入：默认布局剥离；组件「已停更」提示

---

## 4. 按阶段：功能说明与业务数据逻辑

### Phase 0 — 骨架 / 协议 / 现网债

| 功能 | 说明 | 数据逻辑 |
|---|---|---|
| Schema | `Scope` / `Signal` / `Evidence` / `TradeCard` / `Metric*` | `models.py` 类型草案 |
| AI 校验 | 无 `evidence_ids`、数值冲突、`data_gaps`+high → blocked / reference_only | `ai_validate.py`；Agent SSE 挂钩 |
| 北向债 | 禁用误导性日频净流入 | 布局剥离 + 停更文案 |
| 风控口径 | 单票上限 15%、行业 40%、open 必填止损 | `risk_rules.py` |

### Phase 1 — 大盘 / 主线 / 最小风控

| 功能 | 说明 | 数据逻辑 |
|---|---|---|
| 温度计 | 0–100 分 + ice/start/main/diverge/ebb | `quote_snapshot(cn)` 涨跌宽度 + 涨停质量；**不含**北向日频；两融可占位 |
| 主线 | 行业/概念涨幅 Top | 东财板块列表（多 host fallback） |
| TradeCard | draft/open/closed/…；open 强制 `stop_rule` + 商业模式非未验证 | SQLite `research_trade_card` |
| 组合风控（最小） | open 权重、缺止损、超单票/超只数 | `position_pct` + 行情现价算浮盈 |

### Phase 2 — 财务估值 / Scorecard / 扫描

| 功能 | 说明 | 数据逻辑 |
|---|---|---|
| fina 探测 | `fina_indicator` 是否可用 | 样本查询；失败 → `degraded_pe_pb`，**不编造财务** |
| 估值 | PE/PB 全市场截面分位（越高越便宜） | 全市场 quote 有效 PE/PB 样本排名 |
| Scorecard 六维 | business / fina / valuation / trend / volume / event；模板 on/weak/off | 商业模式三态**不计数值分**；趋势/量价用涨跌/量比/换手代理；事件在 Phase 3 前为 stub |
| 一致性 | 便宜但趋势弱、质差且贵、未验证等 | 规则启发式冲突 |
| 扫描 | PE/PB 分位过滤 + ST 排除 + 可成交标注 | 同估值逻辑；一字板标不可成交仍返回 |
| 商业模式 | clear / doubt / unverified | 独立表 `research_business_mode`；与卡片取「更确认」 |
| 风控增强 | 行业暴露、再平衡提示 | `stock_board_map` 行业映射 |

### Phase 3 — 事件 / 简报 / 结案复盘

| 功能 | 说明 | 数据逻辑 |
|---|---|---|
| 事件轴 | news + calendar + top_list + block_trade | feedgen by-symbol；日历文本弱匹配；龙虎榜/大宗日快照按代码过滤；缺源 → `data_gaps` |
| AI 简报 | direction / confidence / summary / evidence_ids / falsify_if | 默认规则组装 Scorecard + 冲突 + 事件证据 → `validate_brief_payload`；`auto_recommend=false` |
| 结案 | 强制 `exit_reason` + 归因；核对 falsify | `(exit-entry)/entry`；条件勾选 / 弱匹配触发 |
| 复盘 | 胜率、盈亏比、回撤、完整率、超额、IR | 结案卡片样本；基准日 K 区间收益（Phase 4 接通） |

### Phase 4 — 回测 / 行为 / 说明书

| 功能 | 说明 | 数据逻辑 |
|---|---|---|
| MA 回测 | 价>MA60 且 MA20>MA60 开；反向平 | 日 K；涨停/一字不买、跌停不卖、T+1；佣金+印花税+滑点；前 70% train / 后 30% test；无足够 OOS →「实验性」 |
| 行为偏差 | 处置效应、追涨、频繁、亏损加仓 | 结案持有天数对比；入场前 5 日涨幅；同票进出次数；重叠持仓/标签启发式 |
| 说明书 | Markdown / JSON | 规则版本 + 回测摘要 + 实验性标记；声明幸存者未全市场重建 |

---

## 5. 核心对象与存储

| 对象 | 存储 | 关键字段 / 约束 |
|---|---|---|
| TradeCard | `research_trade_card` | thesis / evidence / stop / falsify；open 禁 unverified；结案必归因 |
| 商业模式 | `research_business_mode` | clear / doubt / unverified |
| 行情 | `quote_snapshot` | 温度、估值分位、扫描、风控现价 |
| 日 K | `kline_bar` period=`1d` | 回测、基准超额、追涨检测 |
| 专题 | `ts_snapshot` | 龙虎榜 / 大宗 |
| 日历 / 资讯 | `fe_calendar` / feedgen | 事件轴 |

### 策略模板六维启用

| 维 | 长线 | 波段 | 短线 |
|---|---|---|---|
| 商业模式 | on | on | off |
| 财务 | on | on | off |
| 估值 | on | weak | off |
| 趋势 | weak | on | on |
| 量价 | weak | on | on |
| 事件 | off | on | on |

- `on`：计入综合分（商业模式除外）
- `weak`：展示、不计入综合分
- `off`：灰显可点开
- 商业模式维度本身产出三态标签，**永不计入数值综合分**

默认风控阈值（可被策略覆盖的口径）：

- 单票 ≤ 15% 总资产
- 单一行业 ≤ 40%
- open 必须有 `stop_rule`
- 同时 open 建议 ≤ 10 只

---

## 6. 端到端业务流

```text
路径 A 自上而下
  温度 / Regime → 主线板块 → 扫描 / 成分 → 个股 Scorecard + 事件轴
  → 简报(校验) → TradeCard(open) → 组合风控

路径 B 自下而上
  搜个股 → Scorecard / 一致性 / 商业模式 → 反查主线 / 温度是否支持

路径 C 扫描
  POST /scanner/run → 可成交过滤展示 → 打开研判页

纪律闭环
  open → 持有监控 → close(falsify) → review + behavior → backtest / 说明书(实验性)
```

---

## 7. 后端模块索引（`web/research/`）

| 模块 | 职责 |
|---|---|
| `api.py` | HTTP 路由 |
| `models.py` | TypedDict schema |
| `ai_validate.py` | AI 输出校验 |
| `thermometer.py` / `limits.py` | 温度计 / 涨跌停与可成交 |
| `themes.py` | 主线板块 |
| `cards_store.py` / `cards_close.py` | 卡片存储 / 结案 |
| `portfolio_risk.py` / `risk_rules.py` | 组合风控 / 口径 |
| `fina_probe.py` / `valuation.py` | 财务探测 / PE·PB 分位 |
| `scorecard.py` / `consistency.py` / `strategy_templates.py` | 六维 / 冲突 / 模板 |
| `business_mode.py` | 商业模式三态 |
| `scanner_run.py` | 扫描器 |
| `timeline.py` / `ai_brief.py` | 事件轴 / 简报 |
| `review.py` | 复盘报表 |
| `kline_series.py` / `backtest.py` | 日 K / 回测 |
| `behavior.py` / `strategy_spec.py` | 行为偏差 / 说明书 |

---

## 8. 已知降级（有意空态）

1. 无 Tushare 财务权限 → 财务维空，估值用 PE/PB 截面分位
2. Scorecard 趋势 / 量价 = 行情代理，非完整波段结构
3. 无 `FEEDGEN_SERVICE_TOKEN` / 无龙虎榜·大宗缓存 → 事件轴 `data_gaps`
4. 简报以规则组装为主，非完整 LLM 叙事
5. 回测 = 单票 MA；全市场幸存者宇宙未重建；walk-forward 为单次时间切割
6. Regime 宏观序列仍有占位

---

## 9. 非目标（与设计方案一致）

- 自动下单 / 跟单 / 券商持仓同步  
- 把外链 `/fupan` HTML 解析为硬证据  
- 北向日频净流入作为温度或风控输入

---

## 10. 手工验收入口

```text
http://127.0.0.1:8765/dashboard/research
http://127.0.0.1:8765/dashboard/s/<code>
```

建议路径：温度与主线 → 扫描 → 个股 Scorecard/事件轴 → 简报 → 建/结案卡片 → 复盘与行为偏差 → MA 回测与说明书（看「实验性」标记）。

---

## 修订记录

| 日期 | 说明 |
|---|---|
| 2026-11-20 | 初版：汇总 Phase 0–4 前后端清单与业务数据逻辑 |
