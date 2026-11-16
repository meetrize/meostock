# 宏观利率类标的详解：含义、发布源与准确获取

> 目的：把「美联储政策利率预期、美债 2Y/10Y/30Y、实际利率、美元指数、利差」等宏观枢纽逐项讲清——是什么、谁发布、何时更新、如何准确取数、与本仓库 Yahoo 符号的对应关系。  
> 关联：[`global-macro-watchlist-and-regime.md`](./global-macro-watchlist-and-regime.md)  
> 性质：数据与读盘手册（非交易建议）。  
> 日期：2026-11-16

---

## 0. 先分清三层「利率」

很多人把下面三者混谈，读盘会错位：

| 层级 | 是什么 | 典型来源 | 频率 |
|------|--------|----------|------|
| **A. 政策利率（已发生）** | 美联储设定的联邦基金利率目标区间 | 美联储 FOMC 声明 | 会后立即；通常约每 6 周 |
| **B. 政策利率预期（市场定价）** | 交易员押注「下次会议会落在哪一档」 | CME FedWatch / 联邦基金期货 | 盘中实时 |
| **C. 国债收益率（市场成交）** | 把钱借给美国财政部不同期限的回报率 | 财政部日曲线 / FRED / 盘中报价 | 日终官方 + 盘中实时 |

**读盘顺序建议**：先看 B（预期变了没）→ 再看 C 的短端（2Y 是否跟随）→ 再看长端（10Y/30Y 是否背离）→ 最后看实际利率与美元。

---

## 1. 美联储政策利率（已发生的「官方锚」）

### 1.1 是什么

- 正式名称：**Federal Funds Rate target range**（联邦基金利率目标区间）。
- 例：若目标为 `4.00%–4.25%`，市场常说「政策利率在 4.25%」时，多指**区间上沿**。
- 这是银行间隔夜拆借的**政策目标**，不是国债收益率，也不是你在 Yahoo 上看到的 `^TNX`。

### 1.2 在哪发布（权威源）

| 用途 | 地址 |
|------|------|
| FOMC 声明与投票 | https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm |
| 当前目标利率页 | https://www.federalreserve.gov/monetarypolicy/openmarket.htm |
| 会议纪要（约 3 周后） | 同上日历页的 Minutes |
| 点阵图 SEP（每季） | Summary of Economic Projections |

发布时间：美东通常 **14:00**（夏令时）左右出声明；主席新闻发布会约 **14:30**。

### 1.3 如何准确获取

1. **人工核对**：每次 FOMC 日直接读声明第一段的 target range。  
2. **程序化（推荐 FRED）**：  
   - `DFEDTARU`：目标区间上沿  
   - `DFEDTARL`：目标区间下沿  
   - API：`https://api.stlouisfed.org/fred/series/observations?series_id=DFEDTARU&api_key=YOUR_KEY&file_type=json`  
3. **补充：有效联邦基金利率（EFFR）**  
   - FRED：`EFFR`（纽约联储公布的实际成交有效利率）  
   - 官方：https://www.newyorkfed.org/markets/reference-rates/effr  

> 本仓库 Dashboard **目前没有**单独的「Fed 目标利率」面板；需要时用 FRED 或 FOMC 日历，不要用国债收益率代替。

---

## 2. 美联储政策利率预期（市场在赌什么）

### 2.1 是什么

市场用**30 天联邦基金期货**（CME 代号族：`ZQ` / Fed Funds futures）反推：  
「下一次（或之后几次）FOMC，利率落在某一档的概率是多少」。

这就是常说的 **CME FedWatch**。它回答的是：

- 下次会议：**加息 25bp / 不动 / 降息 25bp** 的概率；  
- 不是「今天官方利率是多少」（那是上一节）。

### 2.2 在哪发布

| 来源 | 地址 | 说明 |
|------|------|------|
| **CME FedWatch（最常用）** | https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool | 官方工具；媒体引用应注明 CME FedWatch |
| CME 联邦基金期货行情 | CME 网站 / 终端 `FF` / `ZQ` | 概率由此期货价格推导 |
| 第三方镜像 | Investing、部分券商 App | 便于看，但权威仍以 CME 为准 |

### 2.3 如何准确读取（避免被忽悠）

1. 打开 FedWatch → 选中**下一场 FOMC 日期**。  
2. 看各利率档位的概率柱状图（例如维持 4.00–4.25 的概率 62%）。  
3. 对比「上周同日」概率：真正有信息量的是**预期漂移**，不是静态数字。  
4. 重要会议前后：声明/点阵图一出，FedWatch 概率会瞬间重定价——这是全球资产的第一冲击波。

### 2.4 与 2 年期美债的关系

- **FedWatch**：对**下几次会议**的离散概率。  
- **2Y 国债收益率**：把未来约两年政策路径 + 风险溢价**平滑**进一个价格。  
- 经验：FedWatch 突然更鹰 → 2Y 先跳 → 再传导到美元与股市估值。

> Dashboard 暂无原生 FedWatch 接入；盘中可浏览器盯 CME，或后续接期货结算价做近似。

---

## 3. 美债收益率曲线：2年 / 10年 / 30年

### 3.1 是什么（名义收益率）

美国财政部发行不同期限国债。市场交易形成**收益率曲线**。实务上最常用：

| 期限 | 市场含义（简化） |
|------|------------------|
| **2年** | 最贴近「未来政策利率路径」；对 NFP/CPI/FOMC 极敏感 |
| **10年** | 增长预期 + 长期通胀预期 + 期限溢价；股债定价核心锚 |
| **30年** | 更重财政、负债供给、超长久期需求；常反映「财政溢价」 |

注意单位：报 **4.86** 表示年化约 **4.86%**（不是价格）。债券价格与收益率**反向**：收益率↑ = 债价↓。

### 3.2 官方日终数据在哪发布（最准确）

每日美东约 **15:30** 前后，财政部根据纽约联储采集的报价编制 **Daily Treasury Par Yield Curve Rates**。

| 用途 | 地址 |
|------|------|
| 利率统计入口 | https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics |
| 日曲线 CSV（可程序化） | `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{YEAR}/all?type=daily_treasury_yield_curve` |
| 方法说明 | Treasury Yield Curve Methodology（同站点） |

CSV 列名直接含：`2 Yr`、`10 Yr`、`30 Yr` 等。这是**复盘与研究的权威日终源**。

示例（数据会每日更新；下表仅说明格式）：

```text
Date,1 Mo,...,2 Yr,...,10 Yr,...,30 Yr
11/13/2026,...,4.88,...,5.15,...,5.47
```

### 3.3 FRED（研究与程序化首选镜像）

圣路易斯联储 FRED 转载美联储 **H.15** 恒定到期收益率（Constant Maturity）：

| 期限 | FRED Series ID | 页面 |
|------|----------------|------|
| 3月 | `DGS3MO` | https://fred.stlouisfed.org/series/DGS3MO |
| **2年** | `DGS2` | https://fred.stlouisfed.org/series/DGS2 |
| 5年 | `DGS5` | https://fred.stlouisfed.org/series/DGS5 |
| **10年** | `DGS10` | https://fred.stlouisfed.org/series/DGS10 |
| **30年** | `DGS30` | https://fred.stlouisfed.org/series/DGS30 |

获取方式：

1. 网页直接看图/下载 CSV。  
2. FRED API（免费申请 key）：  
   `https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=KEY&file_type=json`  
3. 注意：FRED 日频通常有 **1 个交易日滞后**（例如周一下午才更新上周五/本周一，视发布节奏）。

**准确度排序（日终）**：财政部原站 ≈ FRED/H.15 ≫ 财经媒体二次摘录。

### 3.4 盘中实时从哪看

日终官方有延迟；交易时段需要**市场报价**：

| 渠道 | 说明 |
|------|------|
| Bloomberg `USGG2YR` / `USGG10YR` / `USGG30YR` | 机构标准 |
| Reuters / 券商终端 | 同业 |
| Yahoo Finance 指数 | 免费近似，见下一节 |
| CNBC、TradingView「US10Y」等 | 便于盯盘，复盘仍建议对财政部/FRED |

### 3.5 与本仓库 Yahoo 符号的对应（重要纠错）

`web/yf_catalog.py` / `curatedSymbols.ts` 当前利率精选为：

| Yahoo 代码 | 实际含义 | **不是** |
|------------|----------|----------|
| `^IRX` | **13 周（约 3 个月）**国债收益率 | 不是 2 年 |
| `^FVX` | **5 年**国债收益率 | — |
| `^TNX` | **10 年**国债收益率 | — |
| `^TYX` | **30 年**国债收益率 | — |

**关键结论**：

- Yahoo **没有**像 `^TNX` 那样稳定、广泛使用的「2 年收益率」指数代码。  
- 要准确的 **2Y**：请用财政部 CSV 的 `2 Yr` 或 FRED **`DGS2`**。  
- 盯盘若只能用 Yahoo：短端用 `^IRX`（更偏政策附近），中端用 `^FVX`（5Y）过渡，**不要把 `^IRX` 当成 2Y**。  
- `^TNX` / `^TYX` 数值通常已是「百分点」（如 5.15 ≈ 5.15%），但不同终端偶发 ×10 显示，接入时务必做一次人工核对。

### 3.6 利差 10Y−2Y（曲线形态）

- **计算**：`DGS10 − DGS2`（单位：百分点；×100 为 bp）。  
- **倒挂**（10Y < 2Y）：历史上常与衰退交易相关，但领先时长不稳定。  
- **陡峭化**：可能是降息预期、或长端财政溢价上升——需结合 2Y 绝对水平判断。  
- 获取：自己用 FRED 两序列相减；或看 FRED 已有利差序列（如部分 `T10Y2Y`）。

FRED 便捷序列：

| 利差 | Series |
|------|--------|
| 10Y−2Y | `T10Y2Y` |
| 10Y−3M | `T10Y3M` |

---

## 4. 实际利率（TIPS / 通胀指数国债收益率）

### 4.1 是什么

**名义利率 ≈ 实际利率 + 通胀预期（近似）**。

- **名义 10Y**（`DGS10`）：你看到的普通美债收益率。  
- **实际 10Y**（TIPS 收益率）：剔除通胀保护后的真实回报要求。  
- 黄金、成长股估值对**实际利率**往往比对名义利率更敏感。

### 4.2 在哪发布 / 如何获取

| 期限 | FRED ID | 页面 |
|------|---------|------|
| 5年实际 | `DFII5` | https://fred.stlouisfed.org/series/DFII5 |
| **10年实际（最常用）** | `DFII10` | https://fred.stlouisfed.org/series/DFII10 |
| 20年/30年实际 | `DFII20` / `DFII30` | 同站搜索 |

财政部亦有 **Daily Treasury Real Yield Curve Rates**（与名义曲线并列，同 Interest Rate Statistics 入口）。

粗算交叉验证：

```text
隐含通胀预期（简化）≈ DGS10 − DFII10
```

（专业上还有 BEI、曲线与流动性调整，日频读盘用这个近似足够。）

> Dashboard 当前精选未含 TIPS；建议后续加 `DFII10` 或至少在文档 KPI 中引用 FRED。

---

## 5. 美元指数 DXY

### 5.1 是什么

对一篮子主要货币的美元汇率指数（欧元权重最高），衡量美元强弱。  
美元↑ → 新兴市场、金、铜、以美元计价风险资产常承压。

### 5.2 在哪获取

| 类型 | 代码/地址 |
|------|-----------|
| Yahoo（本仓库可接） | `DX-Y.NYB` |
| ICE 期货 | `DX` 美元指数期货 |
| 图表站 | TradingView `DXY` |

权威「单一政府日终序列」不如国债清晰；实务以 ICE/市场报价为准。  
FRED 另有广义美元指数（如 `DTWEXBGS`），与 DXY 相关但**权重不同**，不要混用。

---

## 6. 一张「准确获取」对照表

| 你想要的信息 | 最权威日终 | 盘中实用 | 本仓库现状 |
|--------------|------------|----------|------------|
| Fed **已定**目标利率 | 美联储声明；FRED `DFEDTARU/L` | 新闻稿 | 未接入 |
| Fed **下次会**概率 | CME FedWatch | 同左 | 未接入 |
| 美债 **2Y** | Treasury CSV / FRED `DGS2` | 终端 US2Y | **缺**（勿用 `^IRX` 替代） |
| 美债 **10Y** | Treasury / `DGS10` | Yahoo `^TNX` | 已有 `^TNX` |
| 美债 **30Y** | Treasury / `DGS30` | Yahoo `^TYX` | 已有 `^TYX` |
| 美债 **3M** | Treasury / `DGS3MO` | Yahoo `^IRX` | 已有 `^IRX`（标签是「美债3月」） |
| 美债 **5Y** | Treasury / `DGS5` | Yahoo `^FVX` | 目录有，精选条可补 |
| **10Y−2Y** 利差 | FRED `T10Y2Y` | 自算 | 未做 |
| **实际 10Y** | FRED `DFII10` | 少数终端 | 未接入 |
| **DXY** | ICE / `DX-Y.NYB` | 同左 | 建议补进精选 |

---

## 7. 实务读法：同一天怎么串起来

假设某日非农强劲：

1. **FedWatch**：下次降息概率下降 / 加息概率上升。  
2. **2Y（DGS2）**：上行（政策路径被推高）。  
3. **10Y（DGS10 / ^TNX）**：通常也上，但若长端涨更少 → 曲线更倒挂。  
4. **实际利率（DFII10）**：若上行 → 黄金与高估值成长承压。  
5. **DXY**：往往走强。  
6. 再看股指：短端利率冲击下纳指通常比道指更敏感。

若只有 Yahoo 三件套 `^IRX / ^TNX / ^TYX`：

- 用 `^IRX` 当**超短端/政策邻域**；  
- 用 `^TNX`、`^TYX` 当 10Y/30Y；  
- **2Y 务必另开 FRED `DGS2` 或财政部曲线**，否则「短端政策预期」会看偏。

---

## 8. 推荐的最小监控集（准确优先）

每日复盘最少打开：

1. CME FedWatch（下一场 FOMC）  
2. FRED 拼图或自建：`DGS2`、`DGS10`、`DGS30`、`DFII10`、`T10Y2Y`  
3. `DX-Y.NYB`（或 TradingView DXY）  
4. 对照本仓库：`^TNX`、`^TYX`、`^IRX`（校验盘中方向是否一致）

程序化优先级建议：

1. **FRED API**（利率与利差、实际利率）— 免费、稳定、可引用  
2. **Treasury.gov CSV** — 日终校验  
3. **Yahoo `^TNX/^TYX/^IRX/^FVX`** — Dashboard 盘中条带  
4. **CME FedWatch** — 人工或后续专项爬取/授权 API（注意条款）

---

## 9. Dashboard 接入（已实现）

本仓库已提供：

| 能力 | 入口 |
|------|------|
| 联储目标区间 + EFFR + 美债 2/5/10/30Y + 10Y−2Y + 实际 10Y | 面板 **宏观利率**（`macro.rates`）→ `/api/macro/rates` |
| Yahoo 盘中美债 3M/5Y/10Y/30Y 条带 | 面板 **利率条带**（`strip.rates`） |
| 美元指数 | 外汇条带 / spark `DX-Y.NYB` |
| FedWatch 概率 | 面板内「打开 FedWatch」外链（CME 无稳定免费 API） |

### 你需要做的操作

1. **重启 Web 服务**（加载 `web/macro` 路由）：在项目根执行 `./run_web.sh`，或重启当前 8765 进程。  
2. **刷新浏览器**打开 `/dashboard/`。  
   - 从旧布局升级时会**自动补上**「宏观利率」面板；若未见：顶栏 → 编辑布局 → 添加组件 → **美债/宏观利率 → 宏观利率**。  
   - 或「恢复默认看盘」以加载含宏观利率 + 利率/外汇条带的 v9 默认布局。  
3. **同步 Yahoo 利率/外汇轨**（条带与 spark 用）：顶栏数据同步 → 勾选 **yfinance**（或分别同步 `yf:RATES` / `yf:CURRENCIES`）。  
4. **无需 API Key**：目标利率来自 NY Fed EFFR JSON；国债曲线来自 Treasury.gov CSV。  
5. **看政策预期概率**：点面板「打开 FedWatch」；面板上的「短端相对目标 bp」仅为粗代理，不是 CME 概率。

---

## 10. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-11-16 | 初版：政策利率 / FedWatch / 国债各期限官方源与 Yahoo 符号纠错 |
| 2026-11-16 | 接入 Dashboard：`/api/macro/rates` + `macro.rates` 面板；补充操作说明 |
