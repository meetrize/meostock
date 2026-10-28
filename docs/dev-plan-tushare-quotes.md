# Tushare 行情整合 — 开发计划（一期 P0）

## 拍板（已确认，不可再议除非产品变更）

| # | 决策 | 选择 |
|---|------|------|
| 1 | 主备源 | Primary=`kaixin8`（`https://tl.kaixin8.top/tushare/sdk`）；Secondary=`datahubco` |
| 2 | A/H/美全市场快照 | **继续东财/新浪本地 cache**；Tushare 不替换 |
| 3 | 一期范围 | 方案文档 **P0 = 阶段 A–C**（基建 + 行情壳 + 核心新分类） |
| 4 | 财务/资讯 | 一期仅导航占位，不拉数 |
| 5 | Token | 环境变量；`docs/tushare.txt` 脱敏 |
| 6 | 前端直连上游 | **禁止**；一律本机 `/api/tushare/*` |

权威设计：[`tushare-quotes-integration-plan.md`](./tushare-quotes-integration-plan.md)

---

## 一期目标（可验收）

1. `GET /api/tushare/health` 能报告主备可达性（无 Token 时明确提示）。  
2. `/quotes` 左侧为分类树：保留原 stock-sdk / yfinance 节点，并增加 Tushare P0 节点。  
3. P0 节点在上一交易日有数据或正确空态：可转债、期权、涨跌停、申万、龙虎、大宗、两融、个股资金流、ETF、新股、停复牌。  
4. Token 不进前端包 / git 跟踪明文。

---

## 任务拆解

### A — 基建

- [x] `requirements.txt` 钉 `tushare==1.4.29`、`requests`、`pandas`（网关以 HTTP 为主，SDK 可选）
- [x] `web/tsrelay/client.py`：主备 POST、错误码分流、简单进程内限流（包名避免遮蔽 pip `tushare`）
- [x] `web/tsrelay/catalog.py`：UI 树 + 接口映射 + 列配置
- [x] `web/tsrelay/normalize.py`：单位归一到本应用契约（额万元、市值亿元）
- [x] `web/tsrelay/api.py`：`/health` `/catalog` `/trade-date` `/market`
- [x] `server.py` `include_router`；`run_web.sh` 加载 `.env`
- [x] `.env.example` + `.gitignore` 的 `.env`；`docs/tushare.txt` 脱敏

### B — 行情页壳

- [x] 左侧分类树（分组滚动）
- [x] 交易日选择（默认上一完整交易日，来自 `/trade-date`）
- [x] 原有 `cn/hk/us/.../yf:*` 行为不变
- [x] Tushare 节点走 `/api/tushare/market?id=`
- [x] 专题表列配置（与连续行情列分离）

### C — P0 数据接通

| 节点 id | 上游 | 状态 |
|---------|------|------|
| `ts:cb` | `cb_basic` + `cb_daily` | 已接 |
| `ts:opt` | `opt_basic` | 已接 |
| `ts:limit` | `limit_list_d` | 已接 |
| `ts:stk_limit` | `stk_limit` | 已接 |
| `ts:new_share` | `new_share` | 已接 |
| `ts:suspend` | `suspend_d` | 已接 |
| `ts:sw` | `sw_daily` | 已接 |
| `ts:ths` | `ths_index` | 已接 |
| `ts:dc` | `dc_index` | 已接 |
| `ts:top_list` | `top_list` | 已接 |
| `ts:block_trade` | `block_trade` | 已接 |
| `ts:margin` | `margin` | 已接 |
| `ts:margin_detail` | `margin_detail` | 已接 |
| `ts:moneyflow` | `moneyflow(trade_date=)` | 已接 |
| `ts:hsgt` | `moneyflow_hsgt` | 已接 |
| `ts:etf` | `fund_daily` | 已接 |
| `ts:ph:*` | 财务/资讯/宏观占位 | 已接（Empty） |

### D — 收尾

- [x] `scripts/build_dashboard.sh` 构建
- [x] 本文件勾选与手工验收（API 抽测通过；页面需本机 `./run_web.sh` 目视）

---

## 非目标（一期不做）

- 用 `rt_k` 替换东财全市场  
- P1/P2（盘前、筹码详情、宏观全量、财务 Tab、资讯流）  
- 服务端排序分页 / Redis  
- 组合管理 `p_*` 写入  

---

## 验收清单

```text
[x] 有 Token：health primary/secondary 均 ok（本机实测）
[x] /quotes 左树为分类树（构建产物已更新）
[x] ts:cb / ts:top_list 等有数据；日终类空表时可用日期切换
[x] docs/tushare.txt 无明文 Key；.env 被 gitignore
[ ] 无 Token 友好提示（请本机临时 unset 再验）
[ ] 原 A股/港股/美股/yf 切换与同步缓存（请本机目视）
```

---

## Agent 执行约定

- 改动贴合本计划；不顺手大重构无关页。  
- 单位按接口文档换算后再进前端。  
- `401/403/scope_denied/invalid_params` 不降级重试；忙线可一次切备源。  
- 每完成一块在本文件勾选。
