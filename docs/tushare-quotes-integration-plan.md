# Tushare 双中继接入与行情页整合升级方案

> 状态：**待你确认后实施**（本文仅方案，不含代码改动）  
> 日期：2026-10-27  
> 依据：`docs/tushare.txt`、`docs/promax说明.txt`（kaixin8 / ProMax）、`docs/15000积分.txt`（datahubco）  
> 目标页：现有 `/quotes`（`QuotesMarket`）升级为「多资产 + 专题数据」行情中心  
> 对齐：`docs/local-quote-cache.md` 的本机缓存 / Sync Worker 架构

---

## 0. 一句话结论

**两个中继均可调用，Token 有效；建议以 kaixin8（ProMax）为主数据源、datahubco 为历史/本地快照备份。**  
现有行情页只有「市场列表 + L1 快照表」；Tushare 侧还覆盖可转债、期权、板块指数、涨跌停、资金/两融/龙虎/筹码、宏观利率、财务与股东等大量本应用行情页未展示的数据。  
升级思路是：**把行情页改造成金融软件通行的「左侧分类树 + 右侧列表/专题」**，按分类挂载全部可用接口，而不是把 200+ API 平铺成一排按钮。

---

## 1. 连通性实测（本机已跑通）

环境：项目 `.venv` + `tushare==1.4.29`；Token 来自 `docs/tushare.txt`（实施前须迁出文档，见 §9）。

### 1.1 基础日线 `daily`（000001.SZ）

| 中继 | SDK URL | 结果 | 有效样本日 |
|------|---------|------|------------|
| **kaixin8** | `https://tl.kaixin8.top/tushare/sdk` | 成功；`20261023` 收盘 11.2 | 20261023（20261024 空，休市/未发布） |
| **datahubco** | `https://datahubco.com/api/tushare` | 成功；同源样本 | 同上 |

两侧原始 POST 均为 HTTP 200、业务 `code=0`、1 行。datahubco 响应头可见 `X-Data-Source=sqlite` / `X-Cache=LOCAL`。

### 1.2 抽样扩展接口

| 接口 | kaixin8 | datahubco | 备注 |
|------|---------|-----------|------|
| `stock_basic` | 一次超时 | OK | 代码表宜缓存，勿盘中狂刷 |
| `daily_basic` / `moneyflow` / `limit_list_d` / `top_list` | OK | OK | 专题列表核心 |
| `index_daily` / `sw_daily` / `trade_cal` | OK | OK | |
| `cb_basic` / `opt_basic` / `fut_basic` / `hk_basic` | OK | OK | 新市场目录 |
| `rt_k` | 有时有数/有时空 | **api_scope_denied** | 实时盘口偏 ProMax |
| `stk_mins` | 空表（样例窗） | **api_scope_denied** | 分钟历史偏 ProMax；datahubco 文档标明暂停 |
| `rt_idx_k` / `rt_sw_k` / `ths_index` / `dc_index` | OK | （未作为主测） | 板块/指数实时与目录 |
| `margin` / `block_trade` / `new_share` / `cb_daily` | OK | 目录有 | |
| `etf_basic` / `fund_nav` / `hk_daily` | OK | 部分有 | |
| `cyq_perf` / `stk_premarket` / `fina_indicator` / `top10_holders` | OK | 部分有 | 个股深度 |
| `cn_gdp` / `repo_daily` / `broker_recommend` | OK | 部分宏观在 datahubco | |
| `hsgt_top10` / `hk_quote` / `us_quote` 等 | 偶发 upstream 忙/池耗尽 | — | 需限流、重试、降级 |

**可用性结论**：接入路径成立；实施时必须做 **主备、限流、空表/忙线/拒权三分开处理**，不能把空 DataFrame 当成「无业务」。

---

## 2. 双源定位与路由策略

| 维度 | kaixin8（ProMax） | datahubco（15000 积分档） |
|------|-------------------|---------------------------|
| 文档规模 | 298 登记名；约 **237** 启用且契约明确 | **98** 目录条目；分钟/`pro_bar`/`rt_*` 多不可用 |
| 优势 | 实时类（`rt_*`）、分钟、同花顺/东财板块、ETF 扩展、美股/港股报价入口更全 | 本地 SQLite 分区多、历史日线/基础表稳、延迟可预期 |
| 劣势 | 部分实时/授权接口会池耗尽；个别大表超时 | 不在 15000 范围的 API 直接 `api_scope_denied`，勿重试 |
| **本方案角色** | **主源（Primary）**：行情页分类、实时/专题、缺省读写 | **备源（Secondary）**：主源失败或历史日线/财务类优先命中本地时走备源 |

### 2.1 建议环境变量（勿再把 Token 写进仓库文档）

```bash
export TUSHARE_TOKEN='客户卡号'           # 两端共用同一卡号（当前实测可用）
export TUSHARE_PRIMARY_URL='https://tl.kaixin8.top/tushare/sdk'
export TUSHARE_SECONDARY_URL='https://datahubco.com/api/tushare'
export TUSHARE_TIMEOUT_SEC=30
```

路由伪逻辑：

1. 查「接口能力表」：仅 ProMax 有的 → 只打 Primary；仅 datahubco 稳的 → 可优先 Secondary。  
2. 两侧都有：Primary → 失败码属可降级（502/503/池耗尽/超时）→ Secondary 一次；`401/403/scope_denied/invalid_params` **不降级、不重试**。  
3. 全市场日快照类：优先本地 SQLite（扩展现有 `quote_cache`），上游只做 Sync Worker 拉取。

---

## 3. 现有应用 vs Tushare：差距总览

### 3.1 当前行情页（`/quotes`）已有

左侧市场：`A股 / 港股 / 美股 / 期货 / 基金 / 指数` + yfinance 贵金属/商品/外汇/加密/利率/海外指数。  
右侧列：代码、名称、涨幅、现价、涨跌、量额、换手、PE/PB、市值、OHLC、量比、振幅。  
数据路径：本机 `/api/cache/*`（东财 clist → 新浪回退）+ stock-sdk / yfinance；**运行时未接 Tushare**。

### 3.2 应用其它页已有（非行情页，但是「能力重叠区」）

| 能力 | 现有入口 | 现数据源 |
|------|----------|----------|
| 板块列表/详情/资金流 | `/boards` | 东财（sdk） |
| 涨停池/复盘 | `/fupan`、扫描 | 东财 |
| 榜单/资金流组件 | 总览 Portal、`/rankings` | 东财 |
| 北向、龙虎、大宗、两融账户 | 详情/设置说明/sdk | 东财 |
| K 线/分时 | 首页图表、详情 | sdk / 缓存 |
| 分红 | 个股详情 | sdk |

→ Tushare **不是简单替换东财实时快照**，而是补齐：**可转债/期权/更完整代码表、涨跌停价、筹码、财务股东、宏观利率、同花顺/申万指数行情、新股、回购质押、券商金股等**，并可作为东财不可用时的历史与专题备份。

### 3.3 Tushare 有、行情页（及侧栏）基本没有或很弱的能力

| 类别 | 代表接口（ProMax 为主） | 说明 |
|------|-------------------------|------|
| 可转债全市场 | `cb_basic` `cb_daily` `cb_factor_pro` `cb_issue`… | 行情页无「转债」市场 |
| 期权 | `opt_basic` `opt_daily` `opt_mins` | 无 |
| ETF 专题 | `etf_basic` `etf_index` `fund_daily` `rt_etf_*` | 现「基金」偏公募净值，ETF 场内深度不足 |
| 同花顺/东财/通达信板块指数 | `ths_index` `ths_daily` `dc_index` `tdx_*` `sw_daily` | 板块页有行业/概念列表，缺指数行情与成分权重一体化 |
| 涨跌停与连板 | `limit_list_d` `limit_list_ths` `limit_step` `stk_limit` | 复盘页有涨停池，行情页无独立「涨跌停」市场视图 |
| 盘前/集合竞价 | `stk_premarket` `stk_auction_*` | 无 |
| 筹码 | `cyq_perf` `cyq_chips` | 无 |
| 财务三表与指标 | `income` `balancesheet` `cashflow` `fina_*` | 详情页未系统展示 |
| 股东/增减持/质押/解禁 | `top10_*` `stk_holder*` `pledge_*` `share_float` | 无独立行情专题 |
| 龙虎/大宗/两融明细 | `top_list` `top_inst` `block_trade` `margin_detail` | sdk 有部分，行情未做市场级列表 |
| 新股/回购/停复牌 | `new_share` `repurchase` `suspend_d` | 无 |
| 宏观与利率 | `cn_*` `shibor*` `hibor` `libor` `gz_index`… | yfinance 有利率符号，缺国内宏观序列 |
| 现货/回购 | `sge_*` `repo_daily` | 弱 |
| 美股/港股日线与基础表 | `us_basic` `us_daily` `hk_basic` `hk_daily` | 现靠东财/腾讯实时，缺 Tushare 历史补全 |
| 新闻/公告/研报语料 | `news` `major_news` `anns_d` `report_rc`… | 非行情主路径，可挂「资讯」子区或二期 |
| 量化因子 | `stk_factor_pro` `factor_*` | 偏研究，可挂「因子」高级区 |

---

## 4. 行情页信息架构（对齐金融软件习惯）

参考通达信 / 同花顺 / 东财桌面端习惯：**左侧多级分类，右侧「行情表 or 专题表」**；实时列表与事件/财务专题分开展示列。

### 4.1 建议导航树（挂到 `/quotes` 左侧，替换现扁平 `MARKETS`）

```
行情
├─ 沪深京
│   ├─ 全部A股          ← 现有 cn 快照（东财缓存为主；Tushare daily_basic 增强列可二期）
│   ├─ 主板 / 创业板 / 科创板 / 北交所   ← stock_basic.market 过滤
│   ├─ 涨跌停           ← limit_list_d / limit_list_ths
│   ├─ 涨跌停价         ← stk_limit（日历价）
│   ├─ 停复牌           ← suspend_d
│   ├─ 盘前额           ← stk_premarket
│   └─ 新股             ← new_share
├─ 板块指数
│   ├─ 申万行业         ← sw_daily + index_classify / index_member_all
│   ├─ 同花顺概念/行业  ← ths_index + ths_daily + ths_member
│   ├─ 东财板块指数     ← dc_index / dc_member
│   └─ 中信/其它        ← ci_daily 等（能力表启用才挂）
├─ 指数
│   ├─ 国内指数         ← 现有 index + index_basic/daily；rt_idx_k 增强
│   ├─ 全球指数         ← index_global
│   └─ 大盘每日指标     ← index_dailybasic
├─ 资金与交易异动
│   ├─ 个股资金流       ← moneyflow / moneyflow_dc / moneyflow_ths
│   ├─ 板块资金流       ← moneyflow_ind_* / moneyflow_mkt_dc
│   ├─ 沪深港通         ← moneyflow_hsgt / hsgt_top10 / hk_hold
│   ├─ 龙虎榜           ← top_list / top_inst
│   ├─ 大宗交易         ← block_trade
│   └─ 融资融券         ← margin / margin_detail / margin_secs
├─ 债券与转债
│   ├─ 可转债           ← cb_basic + cb_daily（新市场，列表形态同股票）
│   ├─ 转债因子         ← cb_factor_pro（可选子页）
│   └─ 回购/柜台债      ← repo_daily / bc_* / bond_blk*（启用则挂）
├─ 基金与 ETF
│   ├─ 场内基金/ETF     ← fund_daily / etf_basic / rt_etf_k
│   ├─ 公募净值         ← 现有 fund + fund_nav / fund_basic
│   └─ 基金公司/持仓    ← fund_company / fund_portfolio（详情向）
├─ 期货
│   ├─ 国内期货         ← 现有 futures + fut_basic / fut_daily / rt_fut_min
│   ├─ 持仓排名/仓单    ← fut_holding / fut_wsr / fut_settle
│   └─ 期货指数         ← fut_index_daily
├─ 期权                 ← opt_basic + opt_daily
├─ 港股                 ← 现有 hk + hk_basic / hk_daily（报价优先现源，Tushare 补历史）
├─ 美股                 ← 现有 us + us_basic / us_daily（同上）
├─ 外汇与利率
│   ├─ 外汇             ← 现有 yf 外汇 + fx_obasic / fx_daily
│   ├─ SHIBOR/LPR/HIBOR ← shibor* / hibor / libor
│   └─ 宏观指标         ← cn_gdp / cn_cpi / cn_ppi / cn_pmi / cn_m…
├─ 现货与其它
│   ├─ 上海金交所       ← sge_basic / sge_daily
│   └─ yfinance 扩展    ← 保留现有贵金属/商品/加密等分组
└─ 专题（非连续报价表）
    ├─ 股权质押 / 解禁 / 回购 / 增减持
    ├─ 股东人数 / 十大股东
    ├─ 业绩预告快报 / 财报披露计划
    ├─ 券商金股 / 卖方预测 / 机构调研
    └─ 资讯公告（二期：news / anns_d / research_report）
```

**原则**：

1. **连续报价类**（股票/转债/ETF/期货/期权/指数）：右侧沿用现有可排序分页表，列按资产定制。  
2. **事件/监管类**（龙虎、停牌、解禁）：右侧换专题列（日期、营业部、原因等），不硬套 PE/市值列。  
3. **财务/股东类**：默认「选代码或最近公告日」驱动，避免无选择器全市场扫库。  
4. **停用/待核准/授权接口**（ProMax 文档 39 停用 + 18 待核准）：导航默认隐藏，能力探测通过后再露出。

### 4.2 与现有侧栏其它页面的关系（避免重复造页）

| 数据 | 建议落点 |
|------|----------|
| 行业/概念涨跌列表 | 行情「板块指数」+ 保留 `/boards` 详情钻取 |
| 涨停池玩法复盘 | 保留 `/fupan`；行情「涨跌停」做全市场表，可跳转复盘 |
| 北向/资金流卡片 | 总览 Portal 可继续用东财；行情「资金」用 Tushare 做可排序全表 |
| 个股财务/筹码/股东 | 优先在个股详情加 Tab；行情专题做入口列表 |

本期 **以行情页分类整合为主**；详情页 Tab 可作为同一后端 API 的复用，列入二期以免范围爆炸。

---

## 5. 全量接口归类映射（实施清单）

> 下列按 ProMax 启用接口归类；datahubco 子集在同名接口上可作备源。  
> 「UI」= 行情左树节点；「P0/P1/P2」= 建议实施优先级。

### 5.1 P0 — 行情页可见的新市场与核心专题（先落地可感知）

| UI 节点 | 接口 | 用途 |
|---------|------|------|
| 可转债 | `cb_basic` `cb_daily` | 目录 + 日行情列表 |
| 期权 | `opt_basic` `opt_daily` | 目录 + 日行情 |
| 涨跌停 | `limit_list_d`（辅 `limit_list_ths` `limit_step`） | 涨停/跌停/炸板 |
| 涨跌停价 | `stk_limit` | 价格笼子/限价 |
| 新股 | `new_share` | IPO 日历 |
| 申万行业 | `sw_daily` `index_classify` `index_member_all` | 行业指数行情 |
| 同花顺板块 | `ths_index` `ths_member`（`ths_daily` 有数再亮） | 概念/行业 |
| 东财板块指数 | `dc_index` `dc_member` `dc_daily` | 板块行情 |
| 龙虎榜 | `top_list` `top_inst` | 营业部/机构 |
| 大宗 | `block_trade` | |
| 两融 | `margin` `margin_detail` | |
| 个股资金流 | `moneyflow` | 按日全市场或个股 |
| 沪深港通 | `moneyflow_hsgt` `hsgt_top10` | |
| ETF/场内 | `etf_basic` `fund_daily` | |
| 代码表增强 | `stock_basic` `trade_cal` | L0 日更 |
| 实时增强 | `rt_k` `rt_idx_k` `rt_sw_k`（仅 Primary） | 盘中刷新可选 |

### 5.2 P1 — 深化列表与宏观/港美历史

| UI 节点 | 接口 |
|---------|------|
| 盘前/竞价 | `stk_premarket` `stk_auction_o` `stk_auction_c` `stk_auction` |
| 停复牌 | `suspend_d` |
| 筹码 | `cyq_perf`（列表）`cyq_chips`（详情） |
| 期货扩展 | `fut_basic` `fut_daily` `fut_holding` `fut_wsr` `fut_settle` `fut_mapping` `ft_limit` |
| 港股历史 | `hk_basic` `hk_daily`（`hk_quote` 视额度） |
| 美股历史 | `us_basic` `us_daily` `us_daily_adj` |
| 外汇 | `fx_obasic` `fx_daily` |
| 利率宏观 | `shibor` `shibor_lpr` `shibor_quote` `hibor` `cn_gdp` `cn_cpi` `cn_ppi` `cn_pmi` `cn_m` |
| 金交所 | `sge_basic` `sge_daily` |
| 回购 | `repo_daily` |
| 全球指数 | `index_global` `index_dailybasic` |
| 复权/周月 | `adj_factor` `weekly` `monthly` `pro_bar`（仅 Primary） |

### 5.3 P2 — 专题与研究（行情树「专题」区 + 详情复用）

财务：`income` `balancesheet` `cashflow` `fina_indicator` `fina_audit` `fina_mainbz` `forecast` `express` `disclosure_date` `dividend`  
股东与行为：`top10_holders` `top10_floatholders` `stk_holdernumber` `stk_holdertrade` `pledge_detail` `pledge_stat` `share_float` `repurchase`  
机构：`report_rc` `stk_surv` `stk_rewards` `broker_recommend` `hm_list` `hm_detail`  
因子：`stk_factor` `stk_factor_pro` `stk_nineturn` `factor_list` `factor_value`  
基金深度：`fund_basic` `fund_company` `fund_nav` `fund_div` `fund_portfolio` `fund_manager` `fund_share` `fund_adj` `fund_factor_pro`  
转债深度：`cb_issue` `cb_rate` `cb_rating` `cb_share` `cb_price_chg` `cb_call` `top10_cb_holders` `yc_cb`  
指数权重：`index_basic` `index_weight` `index_weekly` `index_monthly`  
资讯（谨慎额度）：`news` `major_news` `anns_d` `cctv_news` `research_report` `irm_qa_*`  
其它启用项：`bak_*` `namechange` `stock_company` `stk_managers` `stock_st` `st` `slb_*` `stk_ah_comparison` `stk_alert` `stk_high_shock` `stk_shock` `stk_week_month_adj` `daily_info` `sz_daily_info` `mkt_idx_bmk` `monetary_policy` `npr` `eco_cal` `idx_*` `etf_*` 剩余、`ft_mins`/`opt_mins`/`hk_mins`/`us_mins`/`fx_mins`/`a_share_mins`/`stk_mins`（分钟按需）、`get_*` 本地聚合、组合 `p_*`（仅 HTTP，可选自选同步）等。

### 5.4 明确不接入（导航不展示）

- ProMax 文档标注 **当前停用** 的 39 个名称（Level2、部分 metal/news 授权等）。  
- datahubco：**`stk_mins` / `stk_min` / `pro_bar`** 及一切 `api_scope_denied`。  
- 参数契约 **待核准** 的 18 个：默认隐藏，确认后再开。  
- 电影票房/台股电子营收等与 A 股看盘无关条目：可放「其它数据」折叠，默认不进主树（datahubco 目录 67–74）。

---

## 6. 技术架构（落在本仓库习惯上）

```
Browser  /quotes（分类树 + 表）
    │  GET /api/tushare/...  或 扩展 /api/cache/snapshot?market=cb|opt|limit|...
    ▼
FastAPI
    ├─ TushareGateway（web/tushare/ 或 web/cache/providers/tushare_*.py）
    │     ├─ 能力表（api → primary|secondary|both, 选择器规则, 单位）
    │     ├─ 限流（全局 ≤~3–5 req/s 可配；stk_mins 更严）
    │     └─ 错误规范化（code/msg/request_id/retry_after/partial）
    ├─ Sync Worker 扩展：日更 L0 代码表；盘后拉 limit/top/margin 等专题落库
    └─ SQLite
          ├─ 现有 quote_snapshot / symbol
          └─ 新表：tushare_meta / tushare_snapshot(category, trade_date, payload) 等
```

### 6.1 关键设计决策（建议拍板）

| # | 决策 | 建议 |
|---|------|------|
| D1 | 实时 A 股全市场是否改用 `rt_k` 替代东财 clist | **否（一期）**。东财快照已接缓存；Tushare 作增强与专题。`rt_k` 可做「单页/自选」补丁 |
| D2 | 主备源 | Primary=kaixin8，Secondary=datahubco（§2） |
| D3 | 前端是否直连 Tushare | **否**。一律本机 API，Token 不出浏览器 |
| D4 | 单位 | 严格按接口文档：日线 `vol=手` `amount=千元`；资金流多为万元；市值 `daily_basic` 为万元 → 展示层换算到现有「额万元/市值亿元」契约 |
| D5 | 分页 | 上游 limit/offset 不统一；行情表继续 **前端排序分页** 或对本机落库后分页；禁止假装「第一页=全市场」 |
| D6 | 交易日 | 一律先 `trade_cal` 取上一交易日；禁止写死文档示例日 |

### 6.2 后端模块草图

```
web/tushare/
  client.py          # SDK/HTTP 封装、主备切换
  catalog.py         # 从文档固化的 api 状态与 UI 分类映射
  normalize.py       # 字段/单位 → QuoteRow 或 TopicRow
  api.py             # FastAPI 路由
web/cache/providers/
  tushare_snapshot.py  # 可转债/涨跌停等同步任务
```

前端：

```
QuotesMarket
  ├─ CategoryNav（树）
  ├─ QuoteTable（连续行情）
  ├─ TopicTable（事件专题，列配置驱动）
  └─ hooks/useTushareMarket(category, tradeDate)
```

设置页：增加「Tushare 主备状态 / 最近错误 / 是否启用专题同步」。

---

## 7. 分阶段实施计划

### 阶段 A — 基建（约 1 次迭代）

1. Token 迁入环境变量；文档中的明文 Key 删除或改占位符。  
2. `web/tushare/client.py` + 健康检查接口 `GET /api/tushare/health`（各打一次 `trade_cal`）。  
3. 固化 `catalog.py`（P0 接口 + 状态）。  
4. 依赖：`tushare==1.4.29` 写入 `requirements.txt`（若尚未钉版本）。

### 阶段 B — 行情页壳改造

1. 左侧改为 §4.1 分类树；现有 cn/hk/us/futures/fund/index/yf 迁入对应节点（行为不变）。  
2. 右侧支持「行情列配置」与「专题列配置」两套。  
3. 交易日选择器（默认上一交易日）。

### 阶段 C — P0 数据接通

按 §5.1 逐节点：Sync 或按需拉取 → 归一 → 展示。验收：每个节点有非空样例日数据或明确「当日无事件」。

### 阶段 D — P1

盘前、停复牌、筹码列表、期货扩展、宏观利率、港美历史补全。

### 阶段 E — P2

专题区 + 个股详情复用；资讯类单独评估额度。

每阶段结束更新本文「实施进度」小节（实施时再加）。

---

## 8. 验收标准

1. `GET /api/tushare/health`：Primary/Secondary 均 `ok` 或可解释降级。  
2. `/quotes` 左树可见：原有市场 + 至少 **可转债、期权、涨跌停、申万、龙虎、大宗、两融、ETF**。  
3. 任一 P0 节点：选上一交易日，表格有数据或空态文案正确（非报错闪退）。  
4. Token 不出现在前端包、日志明文、git 跟踪文件中。  
5. 限流：连续打开多个节点不触发长时间 429 死循环（有退避与缓存）。  
6. 单位抽检：`daily` 成交额、`daily_basic` 市值与现有 A 股列展示量级一致或可切换显示。

---

## 9. 风险与合规

| 风险 | 应对 |
|------|------|
| Token 已写入 `docs/tushare.txt` | **确认方案后立刻轮换/迁出**；`.gitignore` 本地 env；文档改占位符 |
| 上游池耗尽 / 忙线 | 展示「暂不可用」；遵守 Retry-After；专题日更预拉 |
| SDK 空表吞掉 HTTP 错误 | 网关用原始 HTTP 客户端做审计路径（文档附录客户端思路） |
| 「整合全部源」范围过大 | 用分类树 **全覆盖映射**，启用以 P0→P2 渐进；停用接口永不请求 |
| 与东财数据口径不一致 | 同列悬浮提示数据源；不跨源混算涨跌幅 |
| 分钟线额度窄 | 仅详情按需；不进全市场列表 |

---

## 10. 拍板记录（2026-10-27）

用户确认全部按建议执行。开发计划见 [`dev-plan-tushare-quotes.md`](./dev-plan-tushare-quotes.md)；一期 P0（A–C）已落地：

1. Primary=kaixin8、Secondary=datahubco  
2. A/H/美仍走东财/新浪 cache  
3. 一期交付 P0；P1/P2 后续  
4. 财务/资讯仅占位  
5. Token 迁入 `.env`，`docs/tushare.txt` 已脱敏  

---

## 附录 A — 实测命令备忘（勿提交 Token）

```bash
export TUSHARE_TOKEN='...'
.venv/bin/python - <<'PY'
import os, tushare as ts
pro = ts.pro_api(os.environ['TUSHARE_TOKEN'], timeout=30)
pro._DataApi__http_url = 'https://tl.kaixin8.top/tushare/sdk'
print(pro.daily(ts_code='000001.SZ', trade_date='20261023'))
PY
```

## 附录 B — 文档索引

| 文件 | 内容 |
|------|------|
| `docs/tushare.txt` | 双 URL + Key（待脱敏） |
| `docs/promax说明.txt` | ProMax 298 接口全文 |
| `docs/15000积分.txt` | datahubco 98 接口全文 |
| `docs/local-quote-cache.md` | 现有行情缓存架构 |

---

**下一步**：你确认 §10 后，我再写可执行的开发计划（任务拆解/文件清单/接口契约），并开始实施。
