# 多面板 K 线浏览 — 开发计划

> 权威设计：[`multi-panel-charts.md`](./multi-panel-charts.md)  
> 对齐现有：`web/static/index.html`（KLineChart）+ 看板行情/自选入口。

---

## 1. 拍板（不可再议，除非产品变更）

| # | 决策 | 选择 |
|---|------|------|
| 1 | 图表库 | **KLineChart**（`klinecharts.min.js`），不用 ECharts |
| 2 | 页面 | 新建 **`/multipanel`** → `web/static/multipanel.html` |
| 3 | 复用 | 抽出 `web/static/kline/*.mjs`；一期可不重构整份 `index.html` |
| 4 | 看板入口 | Quotes + Watchlist「多面板」跳转带 `symbols` |
| 5 | 默认 UI | 紧凑：无传统顶栏行情条；格内名称/代码 + 唯一 ⚙ |
| 6 | 布局缝隙 | CSS Grid `gap: 1px`，图 `inset:0` 撑满 |
| 7 | 持久化 | `localStorage`（`kline-multipanel-session` / layouts） |
| 8 | 后端 | 一期不新开 API；复用 `/api/cache/kline` |

---

## 2. 目标与验收

1. `/multipanel?layout=2x2&symbols=600036,000001,sh000001,usAAPL` 四格出图。  
2. 全体图形切换 + 单格覆盖切换均可用。  
3. ⚙ 菜单：周期、图形类型、隐藏右轴、图表设置（对齐单图设置项）。  
4. 预设布局 + 自定义行×列可保存恢复。  
5. 行情/自选可一键带码进入；构建后静态资源更新。

手工验收 URL 示例：

```text
http://127.0.0.1:8765/multipanel?layout=2x2&symbols=600036,000001&period=1d
```

---

## 3. 任务拆解

### P0 — 骨架与数据抽出

- [x] `web/static/kline/period.mjs`：从 `index.html` 抽出 `PERIOD_MAP` / 分钟与日周映射  
- [x] `web/static/kline/data.mjs`：抽出 `fetchKline`（含 cache 优先）/ `toBars` / 必要 quote  
- [x] `web/static/kline/futures-catalog.mjs`：期货主连目录（data 依赖）  
- [x] `web/server.py`：挂载 `GET /multipanel` → `multipanel.html`（与 `/` 同级静态）  
- [x] `multipanel.html` 空壳 + CSS 变量（跟单图主题色）；URL `symbols` 冒烟拉数

### P1 — ChartPanel 单实例

- [x] `ChartPanel.mjs`：`init` / `dispose` / `setSymbol` / `setPeriod` / `load` / `resize`  
- [x] `styles.mjs` / `fs.mjs` / `pool.mjs` 辅助模块  
- [x] DataLoader 绑定不依赖全局 `chart`  
- [x] 固定 2×2 DOM 网格验证四实例共存  
- [x] `ResizeObserver` 每格 `resize()`  
- [x] 并发拉数限流（建议 max 4）

### P2 — 紧凑 Chrome + 设置菜单

- [x] 格内浮层：名称、代码（+ 可选价/幅）  
- [x] 唯一 ⚙ → popover 菜单（`chrome.mjs`，fixed 防裁切）  
- [x] 菜单：周期切换、图形类型、隐藏右侧 Y 轴、打开设置弹层  
- [x] 设置项对齐：`candleType` / 价标 / `axisType` / `axisReverse` / `grid`  
- [x] 分时强制 `area`（与单图一致）  
- [x] 「在单图页打开」链接

### P3 — 布局系统

- [x] 预设：`1x1` `1x2` `2x1` `2x2` `2x3` `3x3` `1+2` `2+1`  
- [x] 自定义 rows×cols（上限 4×4）+ 命名保存  
- [x] 换布局时 dispose 多余面板、补建空格  
- [x] Session 读写 `kline-multipanel-session`（`store.mjs` / `layout.mjs`）

### P4 — 全体控制 + 看板入口

- [x] 全局顶栏：布局、全体图形、全体周期（尊重 lock）、退出  
- [x] `chartTypeLocked` / `periodLocked`（⚙ 菜单可「跟随全体」）  
- [x] `QuotesMarket`「多面板」按钮（当前页标的）  
- [x] `Watchlist`「多面板」按钮（勾选优先，否则当前分组）  
- [x] `scripts/build_dashboard.sh` 更新产物  
- [x] README 增加多面板入口说明

### P5 — 指标与打磨（可并行）

- [x] 面板级指标弹框（主/副，默认 MA+VOL；`indicators.mjs`）  
- [x] MA 参数（共用 `kline-ma-params`）  
- [x] Active 面板高亮；空格点击填入代码  
- [x] 十字线同步（顶栏开关，按 timestamp 对齐）  
- [x] 隐藏全局顶栏开关

---

## 4. 非目标（本期不做）

- ECharts 多面板  
- 服务端保存布局  
- 完整移植「比较商品」叠加条  
- 分时多日拖动历史（多面板分时先当日）  
- 拖拽调整格大小 / 自由拼接  
- `index.html` 全面重构为 ChartPanel（可二期）

---

## 5. Agent 执行约定

- 改动贴合本计划；不顺手大改无关看板页。  
- 多面板 **禁止** 引入第二套图库。  
- 从 `index.html` 抽逻辑时保持 A 股红涨绿跌与 `/api/cache/kline` 优先。  
- 每完成一个 P* 在本文件勾选。  
- 设计细节以 [`multi-panel-charts.md`](./multi-panel-charts.md) 为准。

---

## 6. 关键文件清单（预期）

| 路径 | 动作 |
|------|------|
| `docs/multi-panel-charts.md` | 设计（已有） |
| `docs/dev-plan-multi-panel-charts.md` | 本计划 |
| `web/static/multipanel.html` | 新建 |
| `web/static/kline/*.mjs` | 新建 |
| `web/server.py` | 路由 |
| `vendor/stock-dashboard/src/pages/QuotesMarket/*` | 入口 |
| `vendor/stock-dashboard/src/pages/Watchlist/*` | 入口 |
| `web/static/dashboard/*` | 构建产物 |
| `README.md` | 入口说明 |

---

## 7. 与现有缓存关系

```text
看板列表  ←→  L1 quote_snapshot
单图 / 多面板 K 线  ←→  L3 kline_bar（/api/cache/kline）
多面板只是多个 ChartPanel 并发读同一缓存层
```
