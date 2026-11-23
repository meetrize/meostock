# 选股宝涨停池接口说明

> 上游：`https://flash-api.xuangubao.cn/api/pool/detail?pool_name=limit_up`  
> 探测日期：2026-11-23  
> 本站代理：`GET /api/zt/pool?pool=…`（兼 `GET /api/zt/limit-up`）  
> 本站页面：[`/xgb-pool.html`](../web/static/xgb-pool.html) — `/limit-up` · `/limit-down` · `/yesterday-limit-up`（看板同路径；`stock_chance` 与涨停高度重合，本站已去掉页面）  
> 使用方：上述池页、犀利涨停复盘 `/fupan`、`/xnge/fupan/`、涨停异动 `/zt/{code}` 当日原因

本文记录该接口的定位、响应结构、字段维度，以及与本站其它涨停数据源的边界。

---

## 1. 接口是什么

选股宝（xuangubao.cn）**盘中涨停池详情**接口。

| 项 | 说明 |
|----|------|
| 方法 | `GET` |
| URL | `https://flash-api.xuangubao.cn/api/pool/detail` |
| 关键参数 | `pool_name=limit_up`（当前仍处涨停的股票） |
| 成功信封 | `{ "code": 20000, "message": "OK", "data": [ ... ] }` |
| `data` | 股票对象数组；探测当日约 **59** 只 |

**是**：今日（盘中）涨停池快照——代码、价格、封单、连板、开板时间线、个股/题材涨停原因。  
**不是**：行业三级分类树、概念词库、多日历史涨停档案（后者在犀利 CDN `ace.xnge.cn/json/{dm,zt}/...`）。

建议请求头：`Accept: application/json`，`Referer: https://xuangubao.cn/`。浏览器直连可能遇 CORS；本站经 `/api/zt/limit-up` 同源代理。

---

## 2. 同系列 `pool_name`

同一 path，换 `pool_name` 即可。2026-11-23 探测样本量：

| `pool_name` | 约样本量 | 用途 |
|-------------|---------|------|
| `limit_up` | 59 | 当前涨停 |
| `limit_down` | 7 | 当前跌停 |
| `yesterday_limit_up` | 30 | 昨日涨停 |
| `limit_up_broken` | 14 | 曾涨停后打开（炸板） |
| `stock_chance` | 与 `limit_up` 同成分 | 机会池；实测与涨停池高度重合，**本站不单独做页**（API 仍可调） |

本站当前明确代理的是 `limit_up`；`/api/zt/limit-pool?pool=up|down|both` 可拉涨停/跌停。

---

## 3. 单条股票字段总览

`data[]` 每项字段齐全（探测日 59/59 均有下列键）。按业务维度分组如下。

### 3.1 身份

| 字段 | 类型 | 含义 |
|------|------|------|
| `symbol` | string | 代码，如 `605018.SS`、`002931.SZ` |
| `stock_chi_name` | string | 中文名 |
| `stock_type` | int | 板块类型（样本推断，见下表） |
| `is_new_stock` | bool | 是否新股 |
| `listed_date` | int | 上市日 Unix 秒 |
| `issue_price` | number | 发行价 |

**`stock_type` 样本推断（非官方文档）：**

| 值 | 推断 | 示例 |
|----|------|------|
| `0` | 主板普通 | 锋龙股份 `002931.SZ` |
| `1` | ST 主板 | `*ST华鹏` |
| `2` | 科创板 | `688xxx` |
| `3` | ST 科创 | `*ST天宜` |
| `4` | 创业板 | `300xxx` / `301xxx` |

### 3.2 行情快照

| 字段 | 类型 | 含义 |
|------|------|------|
| `price` | number | 最新价 |
| `change_percent` | number | 涨跌幅；`0.1` = **+10%**（小数，非整百分数） |
| `turnover_ratio` | number | 换手率（小数） |
| `volume_bias_ratio` | number | 量比类指标 |
| `total_capital` | number | 总市值（元） |
| `non_restricted_capital` | number | 流通市值（元） |
| `buy_lock_volume_ratio` | number | 买封单量 / 流通 比例（封单强度） |
| `sell_lock_volume_ratio` | number | 卖封单侧比例（涨停池多为 0） |
| `mtm` | number | 动量类字段（多数为 0） |

### 3.3 今日涨停过程

时间类字段多为 **Unix 秒**；`0` 表示无事件。

| 字段 | 含义 |
|------|------|
| `first_limit_up` | 今日首次封板时间 |
| `last_limit_up` | 今日最后一次封板时间 |
| `first_break_limit_up` | 今日首次打开涨停 |
| `last_break_limit_up` | 今日最后一次打开涨停 |
| `break_limit_up_times` | 今日开板次数 |
| `limit_timeline` | 封板时间线，见 §3.6 |
| `*_limit_down*` 对称字段 | 跌停侧；涨停池内多为 0 |

例（长华集团 `605018.SS`，2026-11-23）：

- `first_limit_up` → 09:49:23  
- `first_break_limit_up` → 09:49:32  
- `last_limit_up` → 09:57:11  
- `break_limit_up_times` = 2  

与犀利 `/zt/605018` 页展示的「09:49:23 … 09:57:11」一致。

### 3.4 连板与昨日

| 字段 | 含义 |
|------|------|
| `limit_up_days` | 连续涨停天数（含今日） |
| `limit_down_days` | 连续跌停天数 |
| `m_days_n_boards_days` | 「几天几板」中的天数 |
| `m_days_n_boards_boards` | 「几天几板」中的板数 |
| `yesterday_limit_up_days` | 昨日视角的连板天数 |
| `yesterday_first_limit_up` / `yesterday_last_limit_up` | 昨日首/末封时间 |
| `yesterday_break_limit_up_times` | 昨日开板次数 |
| `yesterday_limit_down_days` | 昨日连跌停天数 |

### 3.5 涨停原因（核心文本）— `surge_reason`

```json
{
  "symbol": "605018.SS",
  "stock_reason": "汽车金属零部件供应商；公司拓展人形机器人用行星滚柱丝杠…",
  "related_plates": [
    {
      "plate_id": 26346142,
      "plate_name": "机器人",
      "plate_reason": "马斯克：预计未来12-18个月Optimus机器人能做家务劳动"
    }
  ]
}
```

| 子字段 | 含义 |
|--------|------|
| `stock_reason` | 个股层面原因（业务/公告摘要） |
| `related_plates[].plate_name` | 关联题材名 |
| `related_plates[].plate_reason` | 板块催化（新闻/事件） |
| `related_plates[].plate_id` | 选股宝板块 ID |

犀利 `/zt/{code}` 页的「**当天**涨停原因」来自本结构；**行业三级路径、概念词条、历史多日涨停**不在此接口。

探测日题材出现频次示例：`机器人` 23、`短剧/互动影游` 5、`PCB板` 5 等。

### 3.6 封板时间线 — `limit_timeline`

```json
{
  "items": [
    { "timestamp": 1795398563, "status": 1 },
    { "timestamp": 1795398572, "status": 2 },
    { "timestamp": 1795399031, "status": 1 }
  ]
}
```

| `status` | 推断含义 |
|----------|----------|
| `1` | 封板（涨停） |
| `2` | 打开（炸板） |

探测日全池计数约：`status=1` 138 次，`status=2` 79 次。

### 3.7 新股 / 次新专项

非次新多数为 0；次新复盘时有用。

| 字段 | 含义 |
|------|------|
| `new_stock_limit_up_days` | 新股连板天数 |
| `new_stock_break_limit_up` | 新股破板相关 |
| `new_stock_acc_pcp` | 新股累计涨幅类 |
| `new_stock_limit_up_price_before_broken` | 破板前涨停价 |
| `nearly_new_acc_pcp` / `nearly_new_break_days` | 次新累计涨幅 / 破板日相关 |

---

## 4. 完整样例（节选）

```json
{
  "symbol": "605018.SS",
  "stock_chi_name": "长华集团",
  "stock_type": 0,
  "price": 11.29,
  "change_percent": 0.1003898635,
  "limit_up_days": 2,
  "m_days_n_boards_days": 2,
  "m_days_n_boards_boards": 2,
  "break_limit_up_times": 2,
  "first_limit_up": 1795398563,
  "last_limit_up": 1795399031,
  "buy_lock_volume_ratio": 0.0132278617,
  "turnover_ratio": 0.038511843,
  "surge_reason": {
    "symbol": "605018.SS",
    "stock_reason": "汽车金属零部件供应商；…行星滚柱丝杠…",
    "related_plates": [
      {
        "plate_id": 26346142,
        "plate_name": "机器人",
        "plate_reason": "马斯克：预计未来12-18个月Optimus机器人能做家务劳动"
      }
    ]
  },
  "limit_timeline": {
    "items": [
      { "timestamp": 1795398563, "status": 1 },
      { "timestamp": 1795398572, "status": 2 },
      { "timestamp": 1795399031, "status": 1 }
    ]
  }
}
```

---

## 5. 日终历史快照（盘后落库）

实时池**不写库**；交易日盘后把「当前涨停 / 当前跌停」页面完整态固化到 `data/quote_cache.db`。

### 5.1 存什么

- 题材：`plate_id` / 名称 / 驱动理由（`plate_reason`）
- 题材盘后概况：`core_avg_pcp`、涨/跌/平家数、`limit_up_count`（来自 `plate/data`）
- 个股：选股宝单票**全字段**（`raw_json`）+ 常用查询列（价、涨跌幅、连板、开板次数、首末封、个股原因）
- 股↔题材多对多归属（与页面一股多概念一致）

表：`zt_day_snap` / `zt_day_theme` / `zt_day_stock` / `zt_day_stock_theme`（见 `web/cache/schema.sql`）。

### 5.2 何时落库

| 项 | 说明 |
|----|------|
| 定时任务 | `zt_pool_eod_snapshot`（默认启用） |
| 时刻 | 工作日 **15:30** 主跑 + **16:00** 补跑（Asia/Shanghai） |
| 模块 | `web/zt_history/`（`capture` / `store` / `service`） |
| 幂等 | 同一 `(trade_date, pool)` 覆盖写入，保留最新定稿 |
| 手动 | `POST /api/zt/history/capture?force=1`（盘中联调可强制） |

### 5.3 历史 API / 页面

| 入口 | 作用 |
|------|------|
| `GET /api/zt/history/dates?pool=` | 有快照的交易日 |
| `GET /api/zt/history/day?date=&pool=` | 一日完整回放（themes + items） |
| `GET /api/zt/history/stock?code=&pool=` | 单票涨跌停履历 |
| `POST /api/zt/history/capture` | 手动落库 |
| `/limit-up?date=YYYYMMDD` | 静态页历史模式 |
| `/dashboard/zt-history` | 看板：选日期 + 涨停/跌停历史 |

与犀利 ace「个股多日涨停原因」不同：本快照是**全日池截面**（题材结构 + 当日全市场涨/跌停成分），便于复盘与个股「哪天进过涨停池」查询。

---

## 6. 与本站其它涨停数据源的边界

| 数据 | 来源 | 本站入口 |
|------|------|----------|
| 今日涨停池 + 原因/时间线 | 本接口 `pool_name=limit_up` | `/api/zt/limit-up`、`/fupan` |
| 盘后涨跌停池截面 | 本接口日终固化 | `/api/zt/history/*`、`/dashboard/zt-history` |
| 个股行业 / 概念词条 | `ace.xnge.cn/json/dm/...` | `/zt/{code}` 经 `/ace` 反代 |
| 个股历史涨停原因列表 | `ace.xnge.cn/json/zt/...` | 同上 |
| 犀利原站 HTML（需 TdxW UA） | `t.xnge.cn/zt/{code}/` | `/zt/{code}`、`/xnge/...` |

`/zt/{code}` 页拼装关系：

1. **当天**原因与时间 → 选股宝本接口（浏览器直连 `flash-api`，一般无 CORS 问题）。  
2. **行业 / 概念 / 历史涨停** → `ace` JSON；CDN 仅对 `Origin: http://t.xnge.cn` 放行 CORS，本站用 `/ace/{path}` 同源反代并锁定页面全局变量 `ace`。

---

## 7. 本站代码锚点

| 位置 | 作用 |
|------|------|
| `web/server.py` → `XUANGUBAO_POOL`、`_xuangubao_pool_items` | 上游拉取 |
| `GET /api/zt/limit-up` | 涨停池代理（兼容） |
| `GET /api/zt/pool?pool=` | 同系列池代理 |
| `GET /api/zt/plate-data?plates=&fields=` | 题材概况（`core_avg_pcp` / 涨跌平家数），代理 `flash-api …/api/plate/data` |
| `GET /api/zt/limit-pool` | `up` / `down` / `both` 或具体 pool_name |
| `web/zt_history/` · `GET/POST /api/zt/history/*` | 盘后快照落库与查询 |
| `scheduled_job` → `zt_pool_eod_snapshot` | 15:30 / 16:00 自动落库 |
| `GET /limit-up` 等 · `web/static/xgb-pool.html` | 概念分组表格页（多池共用；`?date=` 历史） |
| `GET /dashboard/limit-up` 等 · `/dashboard/zt-history` | 看板实时池 / 历史回放 |
| `web/static/fupan.html` | 本地复盘 Demo |
| `GET /ace/{path}` | ace CDN 反代（行业/历史） |
| `GET /zt/{code}` | 犀利涨停异动页中转 |

---

## 8. 使用注意

1. **实时性**：盘中列表与封单会变；适合短 TTL 或直拉，不宜长缓存（参见 `docs/local-quote-cache.md` L4）。日终快照才是可复盘的定稿。  
2. **单位**：`change_percent` / 换手 / 封单比为**小数**；市值为**元**。  
3. **`stock_type` / `status`**：上表为样本推断，上游未提供公开枚举文档；接入时做防御性分支。  
4. **合规与依赖**：第三方公开 flash API，无 SLA；生产路径需失败降级（空池、超时、结构变更）。
