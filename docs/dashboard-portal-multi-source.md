# 首页驾驶舱：多来源行情面板扩展方案

> 状态：**已拍板并实施中**（2026-10-28）  
> 日期：2026-10-28  
> 范围：`/dashboard/` 总览 Portal（现有可编排面板）  
> 依据：四轨已接入数据（东财/目录/Yahoo/Tushare）+ 现有 `WIDGET_CATALOG` / `cacheMode` / `quoteSource` / 后台分轨同步 UX  
> 关联：[`dashboard-overview-portal.md`](./dashboard-overview-portal.md) · [`background-sync-ux.md`](./background-sync-ux.md) · [`tushare-local-cache.md`](./tushare-local-cache.md) · 开发计划 [`dev-plan-dashboard-portal-multi-source.md`](./dev-plan-dashboard-portal-multi-source.md)

### 拍板摘要

| # | 决策 | 选择 |
|---|------|------|
| 1 | 默认第三块 | **`strip.futures`** |
| 2 | 涨跌停名单 | **新行半宽**，不挤自选 |
| 3 | 全球指数条带 | **KPI 正下方全宽** |

---

## 0. 一句话结论

**首页默认仍是「A 股看盘工作台」**——指数 / 广度 / 自选 / 板块 / 榜单 / 资金流保持核心。  
新接入的港美、期货、商品、外汇、加密、Tushare 专题等，**绝大多数进「添加面板」目录**；只挑 **少量高信噪、与现 KPI 互补、读缓存友好** 的面板进默认布局。  
所有新面板统一走 **全局 `cacheMode` + `quoteSource`**，可见才拉取；同步完成后 **softReload**，禁止蒙层。

不要把行情树里每一个 `market_id` 都做成一块默认瓷砖——那会把驾驶舱变成「行情页缩略图墙」，信息密度假高、决策密度下降。

---

## 1. 现状盘点

### 1.1 已有默认面板（全部偏 A 股 + 东财 SDK）

| 类型 | 面板 | 形态 | 数据 |
|------|------|------|------|
| 指数 KPI×6 | 上证/深证/创业/科创50/沪深300/上证50 | 迷你报价卡 | `getFullQuotesPreferCache` · index |
| 统计 KPI×6 | 涨跌家数 / 涨跌停 / 成交额 / 北向 / 主力 / 最强板块 | 数字卡 | A 股全量缓存 + 资金流 SDK |
| 列表 | 自选股 | 表 | 自选 + PreferCache |
| 列表 | 热点板块 / 板块资金流 | Tab 榜 | BoardData + 板块资金流 |
| 列表 | 市场榜单 / 主力净流入榜 | Tab 榜 | A 股全量 + 个股资金流 |

编排能力已齐：12 列栅格、编辑态、添加抽屉、`localStorage` 预设。缺口是 **Catalog 几乎只有 A 股东财面**，没有挂上四轨新产品。

### 1.2 已接入、但首页尚未消费的数据

| 轨 | 节点 | 数据形 | 首页现状 |
|----|------|--------|----------|
| em-sina | `cn` | 全市场 quote | ✅ 间接使用 |
| em-sina | `hk` `us` | 全市场 quote | ❌ |
| lazy-catalog | `index` | 指数 quote | ✅ 仅 6 只主指数 |
| lazy-catalog | `fund` | 基金 quote | ❌ |
| lazy-catalog | `futures` | 期货 quote | ❌ |
| yfinance | `yf:METALS/COMMODITIES/CURRENCIES/CRYPTO/RATES` | 商品/汇/币/利率 quote | ❌ |
| yfinance | `yf:US/EUROPE/ASIA/GB` | 全球指数/地区 | ❌ |
| tushare | `ts:limit` 等 16 个非占位专题 | 多为 **topic 事件表**；`sw/etf/cb` 为 quote | ❌（KPI「涨跌停」仍是东财计数，非 Tushare 名单） |
| placeholder | `ts:ph:*` | — | 不上首页 |

---

## 2. 设计原则（拍板建议）

1. **默认 = 交易日开盘最先看的 8～12 块信息**；其余进 Catalog，一键可加。  
2. **一种数据一种主形态**：quote → 条带/榜/迷你卡；topic → 短名单表；时间序列充足再上曲线。  
3. **能复用就不新建**：`stat.limit` 与 `ts:limit` 名单互补，不并排两块「涨跌停」默认卡。  
4. **按轨标注来源色点**（与行情页徽章一致），用户知道是东财还是 Tushare/Yahoo。  
5. **数据平面统一**：面板不各自发明缓存策略；遵循设置里的模式/行情源。  
6. **隐藏面板不打重网**：未上屏实例暂停专属轮询；默认区共享 `DashboardDataContext`。  
7. **曲线克制**：一期优先「当日名单 / 截面条带」；需要多日序列的曲线（两融余额趋势、北向分时）二期再做，避免假曲线（只有一行快照却画折线）。

---

## 3. 展示形态库（按金融品种选型）

| 形态 ID | 适用品种 | 视觉 | 典型数据 |
|---------|----------|------|----------|
| **A. 迷你报价卡** | 单一指数/标的 | 价 + 涨跌幅 + 可选 sparkline | 现有 `index.*` |
| **B. 横滑条带 TickerStrip** | 一组相关品种（商品/外汇/全球指数/主力期货） | 横向卡片：名 / 价 / %；可点进行情页 | `yf:*`、`futures` 精选 |
| **C. 截面榜 RankList** | 同市场涨跌/成交排序 | 现有榜单表 | `cn/hk/us`、ETF、可转债 |
| **D. 事件短名单 TopicList** | 涨跌停、龙虎榜、大宗、停复牌、新股 | 紧凑表 + 交易日 | 多数 `ts:*` topic |
| **E. KPI 数字卡** | 单指标摘要 | 大数字 + 副文案 | 现有 stat.*；可扩「两融余额」「北向净买」 |
| **F. 热力/强度 Heat** | 行业/概念/申万 | 色块或现有强度榜 | `hotBoards`、未来 `ts:sw` |
| **G. 双轴/折线 Chart**（二期） | 有日期序列的汇总 | ECharts 迷你图 | `ts:hsgt`、`ts:margin` 多日缓存后 |

**选型口诀**：

- 价格截面、要扫一眼 → **B 条带**  
- 要比谁强谁弱 → **C 榜**  
- 当日「发生了什么」→ **D 名单**  
- 只要一个数 → **E KPI**  
- 板块结构 → **F**  
- 只有多日序列才上 **G**

---

## 4. 全量节点 → 推荐面板映射

### 4.1 东财轨 `em-sina`

| 节点 | 推荐形态 | 默认？ | 说明 |
|------|----------|--------|------|
| `cn` | 已有榜/KPI/自选 | ✅ 已默认 | 核心，不改定位 |
| `hk` | **C** `rank.hk`（涨幅/跌幅 Tab） | Catalog | 港股开盘时段有用；非 A 股用户主战场 |
| `us` | **C** `rank.us` | Catalog | 夜盘；与 Yahoo 美股条带二选一优先本榜（字段更全） |

### 4.2 目录轨 `lazy-catalog`

| 节点 | 推荐形态 | 默认？ | 说明 |
|------|----------|--------|------|
| `index` | 已有 6 卡；可选 **B**「更多国内指数」 | Catalog | 默认已够；扩展指数进 Catalog |
| `fund` | **C** `rank.fund` 或 ETF 涨幅榜 | Catalog | 与 `ts:etf` 分工：目录=实时意，Tushare=日线专题 |
| `futures` | **B** `strip.futures`（主力合约精选 8～12） | **建议默认（半宽）** | 商品情绪雷达；条带比全表更适合首页 |

### 4.3 Yahoo 轨 `yfinance`

| 节点 | 推荐形态 | 默认？ | 说明 |
|------|----------|--------|------|
| `yf:US` + `EUROPE` + `ASIA` + `GB` | **B** `strip.globalIndices`（合并精选：道指/纳指/恒生/日经/德指…） | **建议默认（全宽或 12×3）** | 「外围」一眼；比四个地区分面板更干净 |
| `yf:METALS` | **B** `strip.metals`（金/银/原油） | Catalog ★推荐 | 风险偏好；可与 futures 合并为「商品&贵金属」条带若嫌挤 |
| `yf:COMMODITIES` | **B** 并入 metals 或独立 | Catalog | 铜铝农产等 |
| `yf:CURRENCIES` | **B** `strip.fx`（美元指数/USDCNH/EURUSD…） | Catalog ★推荐 | 宏观敏感用户 |
| `yf:RATES` | **E** 或短 **B**（美债 10Y 等） | Catalog | 条目少，适合 KPI/迷你条 |
| `yf:CRYPTOCURRENCIES` | **B** `strip.crypto` | Catalog | 噪声大，**不进默认** |

### 4.4 Tushare 轨（P0 已接）

| 节点 | 推荐形态 | 默认？ | 说明 |
|------|----------|--------|------|
| `ts:limit` | **D** `topic.limitList`（涨停/跌停名单） | **建议默认** | 与 `stat.limit` 计数互补：一个「多少」，一个「是谁」 |
| `ts:hsgt` | **E** 增强现有北向 KPI，或 **D/G** 明细 | 默认已有 KPI；明细进 Catalog | 避免第三块北向 |
| `ts:moneyflow` | 与 `fundFlowRank` 重叠 | Catalog 可选「Tushare 资金流」 | 默认保留东财主力榜 |
| `ts:top_list` | **D** `topic.topList` 龙虎榜 | Catalog ★推荐 | 尾盘/复盘刚需，非全日默认 |
| `ts:block_trade` | **D** | Catalog | |
| `ts:margin` | **E** `stat.margin`（两融余额/净买入） | Catalog ★推荐 | 单数字适合 KPI；曲线待多日缓存 |
| `ts:margin_detail` | **D** | Catalog | 明细表 |
| `ts:sw` | **F/C** 申万涨跌榜 | Catalog | 与热点板块并存时可作「申万」Tab 源，不必新默认块 |
| `ts:ths` / `ts:dc` | **D/C** | Catalog | 与 BoardData 概念/行业部分重叠，优先增强现有 `hotBoards` 数据源切换，而非新面板 |
| `ts:etf` | **C** | Catalog | |
| `ts:cb` | **C** `rank.cb` 可转债涨幅 | Catalog ★推荐 | A 股衍生人气品种 |
| `ts:opt` | **D** | Catalog | 合约多，只适合筛选后短名单 |
| `ts:stk_limit` | — | 不上 Catalog 或极低优 | 价位表偏工具，不适首页 |
| `ts:suspend` | **D** | Catalog 低优 | |
| `ts:new_share` | **D** | Catalog 低优 | |
| `ts:ph:*` | — | 不上 | |

---

## 5. 默认布局建议（在现有基础上「加 2～3、不拆核心」）

原则：**少加、加在扫视路径上**（指数行之下或榜单行之上），滚动深度增加可控。

### 5.1 建议默认增量

| 顺序 | 新面板 | 建议栅格 | 理由 |
|------|--------|----------|------|
| 1 | `strip.globalIndices` 全球主要指数 | `w=12 h=3`（指数 KPI 行下或页底前） | 补「外围」；Yahoo 一轨的最大价值 |
| 2 | `topic.limitList` 涨跌停名单 | `w=6 h=10` | 与现有涨跌停 **计数 KPI** 形成「数→名单」 |
| 3 | `strip.futures` 国内主力期货 | `w=6 h=3` 或与全球条带同行半宽 | 商品风险偏好；目录轨代表作 |

可选第四块（若你更偏宏观）：用 `strip.fx` 或 `strip.metals` **替换** futures，三选一进默认，其余进 Catalog。

### 5.2 建议默认布局草图（相对现网）

```
y≈0   六指数（不变）
y≈2   六 KPI（不变）
y≈4   【新】全球指数条带  w=12
y≈7   自选 | 热点板块（不变）
y≈17  【新】涨跌停名单 | 【新】期货条带（或金属/外汇）
y≈27  市场榜单 | 板块资金流（不变）
y≈39  主力净流入榜（不变）
```

具体 `y` 以实施时 `createDefaultWatchPreset` 重算为准；**升存储 key**（如 `overview-portal:v6`）并提供「重置默认」迁移。

### 5.3 Catalog 分组（添加面板抽屉）

抽屉按 **场景** 分组，而不是按技术轨（用户不关心 lane，但卡片角标仍显示来源色）：

1. **A 股核心**（现有全部）  
2. **情绪与异动** — 涨跌停名单、龙虎榜、大宗、停复牌、新股  
3. **资金** — 两融 KPI/明细、沪深港通明细、Tushare 资金流  
4. **结构** — 申万、同花顺/东财板块（或「板块数据源」配置项）  
5. **衍生品与场内** — 可转债榜、ETF 榜、期权短名单、公募基金榜  
6. **跨境与资产** — 港股榜、美股榜、全球指数、贵金属、商品、外汇、利率、加密  
7. **商品期货** — 主力期货条带（若未默认）

每张 Catalog 卡：`名称 · 一句话 · 默认尺寸 · 来源徽章 · 「已在布局中」灰态`。

### 5.4 预设布局（可选三套）

| 预设 | 侧重 |
|------|------|
| **默认看盘** | §5.1（A 股 + 全球条 + 涨跌停名单 + 期货） |
| **资金流优先** | 弱化期货/全球；强化两融 KPI、龙虎榜、北向明细 |
| **全球资产** | 全球指数 + 外汇 + 金属 + 加密；压缩 A 股榜高度 |

---

## 6. 实时 / 缓存：与首页统一的数据契约

### 6.1 复用全局设置（不另造面板级「模式」开关）

| `quoteSource` | 面板行为 |
|---------------|----------|
| `auto` | PreferCache / `/api/tushare/market` 缓存优先；stale 时后台补，softReload |
| `local` | 只读本机快照；空则空态 +「去同步」指引（顶栏） |
| `network` | 尽量打网/上游；仍不蒙层 |

| `cacheMode` | 面板行为 |
|-------------|----------|
| `speed` | 拉缓存即展示；轮询间隔拉长；少触发 sync |
| `balanced` | 现逻辑：先缓存后后台 |
| `realtime` | 缩短可见面板轮询；可更积极 `force` 入队（仍后台） |

面板铬条可显示小字：`缓存 · 12:01` / `同步中`，与行情页 `cacheHint` 同语义。

### 6.2 数据平面架构

```
Dashboard.tsx
  └─ DashboardDataContext（现有 A 股共享）
  └─ PortalMarketBridge（新建）
        · 按「当前布局里出现的 widgetType」订阅 market_id 集合
        · em/yf/lazy → /api/cache/snapshot?market=
        · ts:* → /api/tushare/market?id=&trade_date=
        · 监听 SyncStatus.softVersion + completedLanes → 只刷新相关面板
```

规则：

- **同一 `market_id` 多面板实例共享一份订阅**（config 不同只做客户端过滤）。  
- **编辑态添加面板**：立即拉一次；失败保留空态。  
- **Tushare topic**：尊重交易日（可用全局「总览交易日」，默认与 Tushare `trade-date` 一致）。  
- **禁止**每个 Widget 内私自 `setInterval` 打全市场。

### 6.3 与顶栏分轨同步的关系

- 首页不提供第二套「同步所有」。  
- 面板菜单「刷新」= 对该面板 `market_id` 调 `requestSyncMarket`（后台）+ 本地 soft 重读。  
- 定时 Tushare 15:30/16:00 跑完 → `completedLanes` 含 `tushare` → 涨跌停名单等自动 softReload。

---

## 7. Catalog 类型命名建议（实施用）

```text
# 条带
strip.globalIndices
strip.futures
strip.metals
strip.fx
strip.crypto
strip.rates

# 跨境榜
rank.hk
rank.us
rank.fund
rank.etf
rank.cb

# Tushare 专题
topic.limitList
topic.topList
topic.blockTrade
topic.suspend
topic.newShare
topic.hsgtDetail
topic.marginDetail
topic.opt
topic.moneyflowTs

# KPI 扩展
stat.margin

# 结构（可先做数据源切换，后独立 type）
board.sw
```

尺寸建议：

| 类型 | 默认 w×h | min |
|------|----------|-----|
| strip.* | 12×3 或 6×3 | 4×3 |
| topic.* / rank.* | 6×10 | 2×6 |
| stat.margin | 2×2 | 2×2 |

---

## 8. 重要程度总表（决策一览）

### 默认首页（建议）

1. 现有全部默认面板（A 股核心）  
2. **全球主要指数条带**（Yahoo 合并）  
3. **涨跌停名单**（Tushare `ts:limit`）  
4. **国内主力期货条带**（或金属/外汇三选一）

### Catalog · 高优推荐（星标）

- 贵金属/能源条带、外汇条带  
- 龙虎榜、两融 KPI、可转债榜  
- 港股榜、美股榜  

### Catalog · 普通

- ETF/公募榜、大宗、沪深港通明细、申万榜、期权短名单、利率条、商品细分  

### Catalog · 低优 / 默认不上

- 涨跌停价表、停复牌、新股、加密条带、Tushare 与东财重复的资金流第二份、一切 placeholder  

---

## 9. 非目标（一期不做）

- 为每个 `yf:*` / `ts:*` 各做一块默认面板  
- 面板内自建独立 cacheMode（与设置打架）  
- 假历史曲线（无多日序列时不画 Chart）  
- 服务端同步布局  
- 用首页替代 `/quotes` 全表浏览  

---

## 10. 实施切片（建议）

| 切片 | 内容 | 预估 |
|------|------|------|
| D0 | 方案确认：默认三块增量是否采纳；期货 vs 金属/外汇 | — |
| D1 | `PortalMarketBridge` + softReload；Catalog 分组 UI | 0.5–1d |
| D2 | `strip.globalIndices` + `strip.futures` + 默认布局 v6 | 0.5–1d |
| D3 | `topic.limitList` + 交易日；来源徽章 | 0.5d |
| D4 | 星标 Catalog：fx/metals、topList、margin、rank.cb/hk | 1d |
| D5 | 预设「资金流/全球资产」；文档与验收 | 0.5d |

---

## 11. 验收清单

```text
[ ] 默认首页仍以 A 股为核心，新增不超过 3 类面板
[ ] 添加面板抽屉按场景分组，且带来源色标
[ ] strip/topic/rank 在 auto/local/network × speed/balanced/realtime 下行为符合 §6
[ ] 隐藏面板不产生额外高频请求
[ ] Tushare 定时/手动同步后，相关面板 softReload、无蒙层
[ ] 「重置默认」可回到 v6 默认看盘
[ ] 现有指数/自选/板块/榜单无回归
```

---

## 12. 开关结论

1. 默认第三块 → **`strip.futures`**  
2. 涨跌停名单 → **新行半宽**  
3. 全球指数条带 → **KPI 正下方全宽**  

按 [`dev-plan-dashboard-portal-multi-source.md`](./dev-plan-dashboard-portal-multi-source.md) 实施。
