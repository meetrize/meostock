# 多面板 K 线浏览 — 设计方案

> 入口：看板「行情 / 自选」→ 多面板模式；图表引擎对齐 `web/static/index.html` 的 **KLineChart**（非看板个股详情的 ECharts）。  
> 执行计划：[`dev-plan-multi-panel-charts.md`](./dev-plan-multi-panel-charts.md)

---

## 1. 背景与现状

| 现状 | 说明 |
|------|------|
| 单图页 | `/` → `index.html`，一个 `#chart`，顶栏完整工具栏 |
| 看板 | `/dashboard/quotes`、`/dashboard/watchlist` 列表；点行打开 `/?symbol=&period=1d` |
| 个股详情 | `/dashboard/s/:code` 用 **ECharts**，能力与 K 线页不一致 |
| 比较 | 单图上叠加对比线（`OVERLAY_CMP`），**不是**多窗口并列 |

用户要的是：在同一屏用网格并排看多只标的，每格一张独立 K 线/曲线，布局可预设可自定义，并尽量占满像素。

---

## 2. 产品目标

1. **行情页 / 自选页**可进入「多面板浏览」；支持带上当前勾选/当前组内代码。
2. 每格独立：标的、周期、图形类型、指标、坐标轴等（能力对齐 `index.html`）。
3. **整体切换**图形类型（全体面板）+ **单面板**单独切换。
4. **隐藏顶栏**后：名称+代码叠在图上；图上只留一个「设置」按钮；点开弹出菜单，覆盖原工具栏全部能力，并新增：
   - 隐藏最右侧价格轴
   - 切换分时 / 分钟 / 日 / 周等周期
5. **布局预设**（常用网格）+ **自定义**（行×列）；格与格之间仅 **1px 细线**，图完全撑满单元格。

### 非目标（本期不做）

- 用 ECharts 重做多面板（避免双栈）。
- 跨面板拖拽改布局（可二期；一期用预设/行列数即可）。
- 多面板内的「比较叠加线」全能力移植（一期可省略比较，或仅保留「在单面板打开单图页比较」）。
- 服务端持久化布局（一期 `localStorage`）。
- 跨设备同步、实时推送 WebSocket。

---

## 3. 拍板

| # | 决策 | 选择 |
|---|------|------|
| 1 | 图表库 | **KLineChart**（与 `index.html` / `klinecharts.min.js` 一致） |
| 2 | 页面形态 | 新建 **`/multipanel`**（`web/static/multipanel.html`），不把 4k 行单文件再塞一套网格 |
| 3 | 逻辑复用 | 从 `index.html` **抽出**可多实例模块（`ChartPanel`），单图页后续可逐步改用同一模块 |
| 4 | 看板入口 | Quotes / Watchlist 增加「多面板」；`window.open` 或同页跳转 `/multipanel?symbols=…` |
| 5 | 顶栏策略 | 多面板默认 **紧凑模式**（隐藏全局行情顶栏）；每格仅浮层标题 + 设置钮 |
| 6 | 全局 vs 面板 | 顶部保留「布局 / 全体图形 / 全体周期(可选) / 退出」；单面板设置优先于全体，并打「已单独设置」态 |
| 7 | 数据 | 复用 `GET /api/cache/kline` + 现有 `fetchKline` 回退链；多面板并发拉数需 **限流** |
| 8 | 生命周期 | 每格 `init` / `dispose`；布局变更销毁多余实例；`ResizeObserver` 调 `resize()` |

---

## 4. 信息架构

```
┌─ 多面板顶栏（全局，可再隐藏）─────────────────────────────────────┐
│ [布局▾] [全体:蜡烛/面积/…] [全体周期▾] [同步十字线] [添加] [退出]   │
└──────────────────────────────────────────────────────────────────┘
┌──────────┬──────────┬──────────┐
│ 名称 代码 │ 名称 代码 │ 名称 代码 │  ← 浮层（toolbar 隐藏时）
│       ⚙ │       ⚙ │       ⚙ │
│   KLine  │   KLine  │   KLine  │  ← 100% 填格，缝 1px
├──────────┼──────────┼──────────┤
│   …      │   …      │   …      │
└──────────┴──────────┴──────────┘
```

### 4.1 看板入口

| 页 | 行为 |
|----|------|
| 行情 `QuotesMarket` | 工具栏「多面板」：用当前勾选行（无勾选则当前页可见行前 N 只，N=布局格数）打开 |
| 自选 `Watchlist` | 当前分组全部代码（或勾选）打开；超过格数截断并提示「可换更大布局」 |
| 单图页 | 可选：工具栏增加「多面板」把当前标的放进 2×2 第一格 |

URL 约定：

```text
/multipanel?layout=2x2&symbols=600036,000001,sh000001,usAAPL&period=1d&theme=dark
```

- `layout`：预设 id 或 `RxC`（如 `3x2`）
- `symbols`：逗号分隔，顺序填格；不足留空格（点选填入）
- `period`：初始全体周期（面板可覆盖）
- `theme`：可选，与 `kline-theme` 对齐

### 4.2 单面板浮层（紧凑模式）

| 元素 | 位置 | 说明 |
|------|------|------|
| 名称 + 代码 | 左上角半透明 | 如 `招商银行 600036`；涨跌可用次行小字价/幅 |
| 设置 ⚙ | 右上角 | 唯一常驻控件 |
| （可选）焦点框 | 整格边框高亮 | 点击面板设为 active，全局操作落到该格 |

点击 ⚙ → **面板菜单**（popover，固定在按钮旁，不挡主图过多）：

1. **周期**：分时 / 1m / 5m / 15m / 1H / 1D / 1W（同 `PERIOD_MAP`）
2. **图形类型**：蜡烛全实心/空心/涨空心/跌空心 / OHLC / 面积图（同 `#setCandleType`）
3. **指标…** → 打开现有指标弹框逻辑（作用域=当前面板）
4. **图表设置…** → 蜡烛、价标、轴类型、倒置、网格（同 `#settingModal`）
5. **隐藏右侧坐标轴**（开关，新增）
6. **显示完整工具栏**（开关：该格临时展开迷你顶栏，含代码输入）
7. **更换标的** → 输入框 / 搜索
8. **清空本格** / **在单图页打开**（链到 `/?symbol=&period=`）

扩展链接、配色可放在全局顶栏；比较一期可「在单图页打开」代替。

---

## 5. 布局系统

### 5.1 预设

| id | 结构 | 格数 |
|----|------|------|
| `1x1` | 1×1 | 1 |
| `1x2` | 1 行 2 列 | 2 |
| `2x1` | 2 行 1 列 | 2 |
| `2x2` | 2×2 | 4 |
| `2x3` | 2×3 | 6 |
| `3x3` | 3×3 | 9 |
| `1+2` | 左 1 大（占 2 行）+ 右上下 2 小 | 3 |
| `2+1` | 上 2 + 下 1 通栏 | 3 |

一期用 **CSS Grid** 实现；不规则预设用 `grid-template-areas`。

### 5.2 自定义

- UI：行数 1–4、列数 1–4（上限 16，防卡顿）
- 存为用户预设：`{ id, name, rows, cols, areas? }`
- `localStorage` key：`kline-multipanel-layouts`

### 5.3 视觉约束（空间）

```css
.mp-grid {
  display: grid;
  gap: 1px;                 /* 唯一缝隙 */
  background: var(--mp-gutter); /* 缝的颜色即细线 */
  height: 100%;
  width: 100%;
}
.mp-cell {
  min-width: 0;
  min-height: 0;
  position: relative;
  background: var(--bg);
}
.mp-cell .chart-host {
  position: absolute;
  inset: 0;                 /* 图完全撑满 */
}
```

- 不要卡片圆角、不要 padding、不要阴影。
- 副图指标仍在格内由 KLineChart pane 分割；多面板时默认副图宜少（建议默认仅主图 + VOL，或可配置「多面板默认不挂副图」以省高）。

---

## 6. 图表能力映射（对齐 index.html）

| 能力 | 单图页现状 | 多面板 |
|------|------------|--------|
| 蜡烛类型 / 面积 | `#setCandleType`；分时强制 area | 全体 + 单面板；分时仍强制 area |
| 周期 | `#periods` + `PERIOD_MAP` | 菜单 + 可选全体周期 |
| 指标 | `MAIN_INDS` / `SUB_INDS` | 每面板独立列表 |
| MA 参数 | `kline-ma-params` | 可共用全局 MA；面板可覆盖 |
| Y 轴类型/倒置 | `overrideYAxis` | 同左；另增 **show** |
| 隐藏右轴 | 无 | `styles.yAxis.show=false` 或轴宽 0（实现时以库 API 实测为准） |
| 配色 | `html[data-theme]` | 全局一套主题 |
| 比较叠加 | 有 | 一期不做或外链单图 |
| 十字线 tip | `#candleTip` | 每格独立 tip，或仅 active 格显示 |
| 数据 | `/api/cache/kline` 等 | 同；并发池（如同时最多 4 路） |

### 6.1 隐藏右侧坐标系

在 `applyChartSettings` / `applyYAxisOptions` 扩展：

```js
// 示意：以 KLineChart styles 为准，落地前用一格实测
chart.setStyles({
  yAxis: { show: !hideYAxis },
});
// 或
chart.overrideYAxis({ paneId: "candle_pane", show: !hideYAxis });
```

隐藏后主图可多占横向像素；浮层价/幅仍可见。

### 6.2 图形「全体切换」

- 改全局 `chartType` → 遍历未标记 `chartTypeLocked` 的面板 `setCandleType`。
- 已在面板菜单单独选过类型的面板：默认 **不跟随**，菜单里提供「跟随全体」。

全体周期同理（`periodLocked`）。

---

## 7. 模块拆分（实现骨架）

建议静态资源（均无构建步骤，ES module）：

```text
web/static/
  multipanel.html              # 壳 + 布局 UI（P0 已有空壳）
  kline/
    period.mjs                 # PERIOD_MAP / MINUTE_PERIOD / HISTORY_PERIOD  ✅ P0
    data.mjs                   # fetchKline / toBars / quote（从 index 抽出） ✅ P0
    futures-catalog.mjs        # 期货主连目录                               ✅ P0
    styles.mjs                 # chartStyles / theme 色                 ✅ P1
    fs.mjs                     # 分时补齐（多面板用最近一日）           ✅ P1
    pool.mjs                   # 并发拉数限流                           ✅ P1
    chrome.mjs                 # 紧凑浮层 + ⚙ 菜单 + 设置弹层           ✅ P2
    indicators.mjs             # 主/副指标 + MA 弹层                     ✅ P5
    ChartPanel.mjs             # 单实例：init/dispose/load/settings     ✅ P1
    layout.mjs                 # 预设定义、自定义布局 CRUD               ✅ P3
    store.mjs                  # localStorage 会话状态                   ✅ P3
  klinecharts.min.js
  stock-sdk.mjs
```

### 7.1 `ChartPanel` 职责

```text
constructor({ el, onActivate })
setSymbol(symbol)
setPeriod(period)
setCandleType(type)
setSettings(partial)
setHideYAxis(bool)
setChrome({ compact, showToolbar })
load() / reload({ force })
resize()
dispose()
getState() → 可序列化快照
```

内部持有独立：`chart`、`chartSettings`、`currentPeriod`、`symbol`、indicators、dataLoader 绑定。  
**禁止**再使用页面级单一 `let chart`。

### 7.2 与单图页关系

| 阶段 | 策略 |
|------|------|
| 一期 | 只新建 multipanel + 抽 data/period；`index.html` 可暂不重构 |
| 二期 | `index.html` 改为单实例 `ChartPanel`，消除双份逻辑 |

---

## 8. 状态与持久化

`localStorage` key：`kline-multipanel-session`

```json
{
  "layoutId": "2x2",
  "customLayouts": [{ "id": "c1", "name": "我的3×2", "rows": 3, "cols": 2 }],
  "global": {
    "period": "1d",
    "candleType": "candle_solid",
    "syncCrosshair": false,
    "hideGlobalBar": false
  },
  "panels": [
    {
      "id": "p0",
      "symbol": "600036",
      "period": "1d",
      "periodLocked": false,
      "candleType": "candle_solid",
      "chartTypeLocked": false,
      "hideYAxis": false,
      "compact": true,
      "settings": { },
      "indicators": { "main": ["MA"], "sub": ["VOL"] }
    }
  ]
}
```

刷新恢复上次会话；URL `symbols` 优先于 session（进入时覆盖）。

---

## 9. 看板改动点

| 文件 | 改动 |
|------|------|
| `QuotesMarket.tsx` | 「多面板」按钮；收集勾选 `klineSymbol`；`open(/multipanel?…)` |
| `Watchlist.tsx` | 同上，源为当前组 codes |
| `Sidebar` / 文案 | 可选导航项「多面板」 |
| `scripts/build_dashboard.sh` | 改完后重建静态资源 |

符号格式与现 `openKline` 一致（已带市场前缀的 `klineSymbol`）。

---

## 10. 后端

一期 **无需新 API**。注意：

- 多面板同时请求 N 个 `/api/cache/kline`：前端并发限制 + 缓存命中依赖二期 L3。
- 可选后续：`GET /api/cache/kline/batch?symbols=&period=`（非必须）。

---

## 11. 性能与风险

| 风险 | 对策 |
|------|------|
| 9 格同时 init 卡顿 | 布局切换时分帧 `requestAnimationFrame` 创建；上限 3×3 |
| 内存泄漏 | 换布局必须 `dispose`；卸 `ResizeObserver` |
| 分时多日逻辑重 | 多面板分时默认「仅当日」简化版；完整多日拖动留单图页 |
| 双栈维护 | 禁止在 multipanel 引入 ECharts |
| index 与模块漂移 | 抽公共 `data.mjs` 后单测/手工清单对齐字段 |

---

## 12. 验收标准（产品）

1. 自行情勾选 4 只 → 多面板 2×2，四格均出图，格缝仅 1px。  
2. 全体切「面积图」→ 未单独锁定的格全部变为面积；锁定格不变。  
3. 单格隐藏顶栏：仅见名称代码 + ⚙；菜单可切周期、图形、隐藏右轴。  
4. 隐藏右轴后主图变宽，价轴不可见。  
5. 自定义 3×2 布局可保存并再次打开恢复。  
6. 断网 + 曾缓存标的：热路径仍能出日 K（依赖现有 cache）。  
7. 点「在单图页打开」进入现有 `/?symbol=&period=`，行为与今日一致。

---

## 13. 实施分期建议

| 期 | 内容 |
|----|------|
| **M0** | 抽 `period.mjs` + `data.mjs`；`multipanel.html` 固定 2×2 + ChartPanel 最小闭环 |
| **M1** | 紧凑浮层 + 设置菜单（周期/类型/隐藏轴/设置弹框） |
| **M2** | 布局预设 + 自定义行列 + session 持久化 |
| **M3** | 看板行情/自选入口；全体切换；并发限流 ✅ P4 |
| **M4** | 指标/MA 面板化；可选十字线同步；文档与 README 入口 |

权威执行勾选见 [`dev-plan-multi-panel-charts.md`](./dev-plan-multi-panel-charts.md)。
