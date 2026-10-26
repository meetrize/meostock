# 总览 Portal 面板 — 开发计划

> 权威设计：[`dashboard-overview-portal.md`](./dashboard-overview-portal.md)  
> 代码落点：`vendor/stock-dashboard/src/pages/Dashboard`（构建 → `web/static/dashboard`）

---

## 1. 拍板（不可再议，除非产品变更）

| # | 决策 | 选择 |
|---|------|------|
| 1 | 布局引擎 | **`react-grid-layout`** |
| 2 | 列数 / 行高 | **12 列 / `rowHeight=36`** |
| 3 | 默认 gutter | **8px**（tight） |
| 4 | KPI 默认 | **`w=2`，默认 6 个齐排** |
| 5 | 碰撞 | **垂直 compact，禁止重叠** |
| 6 | 持久化（一期） | **`localStorage` only** |
| 7 | 手机 | **只读堆叠，不可编辑布局** |
| 8 | 交付顺序 | **Phase 0 间距快修 → Phase 1 MVP → Phase 2 预设体验** |
| 9 | 后端 | 一期不新开布局 API；数据仍走现有 SDK / quote cache |

---

## 2. 目标与验收

1. 总览面板间距默认 **8px**，明显紧于现状。  
2. 「编辑布局」下可拖拽位移、拖角缩放；浏览态不可误拖。  
3. 可从 Catalog **添加 / 移除**面板；尺寸受 catalog `min/max` 约束。  
4. 刷新后布局从 `localStorage` 恢复；「重置默认」可回到默认看盘布局。  
5. 桌面完整编辑；`<768px` 只读纵向堆叠。  
6. 指数 / 涨跌色 / 跳转 `/s/:code` 等行为与改造前一致。  
7. `./scripts/build_dashboard.sh` 后 `/dashboard/` 可用。

手工验收：

```text
http://127.0.0.1:8765/dashboard/
```

---

## 3. 任务拆解

### P0 — 密度快修（不改结构）

- [x] `Dashboard.module.css`：页面 `gap` 32→**8**；`mainGrid` / 列内 `gap` 24→**8**；`indices` / `statsGrid` 保持或统一 **8**
- [x] 总览相关 Card 内边距略收（或 Dashboard 内覆盖），圆角可维持
- [x] 目测浅色/深色主题缝隙一致；构建产物更新（可选，若仅 CSS 改 vendor 后需 rebuild）

### P1 — 依赖与 Portal 骨架

- [x] `vendor/stock-dashboard`：`pnpm add react-grid-layout`（自带类型；未保留 stub `@types`）
- [x] 引入 RGL CSS；`margin: [8, 8]` 对齐 gutter
- [x] 新建 `pages/Dashboard/portal/`：`PortalCanvas` / `PortalToolbar` / `WidgetChrome`
- [x] `widgetCatalog.ts`：类型、默认/min/max、组件映射
- [x] `defaultLayouts.ts`：默认看盘布局（indices + 6 KPI + 自选/板块/榜单/资金流）
- [x] `usePortalLayout.ts`：load / save（debounce 300ms）/ reset；key `stock-dashboard:overview-portal:v1`

### P2 — Widget 拆分（逻辑上提，UI 入格）

- [x] 数据层集中在 `Dashboard.tsx`，经 `DashboardDataContext` 下发
- [x] 抽出：`IndicesWidget`、6×`Stat*Widget`、`WatchlistWidget`、`MarketRankingWidget`、`FundFlowRankWidget`、`HotBoardsWidget`、`BoardFundFlowWidget`
- [x] 列表面板：可见行数随 `h` 估算裁剪
- [x] KPI / 列表在 `w` 变窄时隐藏次要信息（如行业列）

### P3 — 编辑交互 MVP

- [x] 浏览 / 编辑双模式；顶栏「编辑布局」↔「完成」
- [x] `dragConfig.handle: '.widget-drag-handle'`；浏览态禁用拖/缩
- [x] 编辑态：网格底纹、resize 手柄；`verticalCompactor`；禁止重叠
- [x] 面板菜单：移除；添加面板 Modal（Catalog）
- [x] 「重置默认」写回 `defaultLayouts`
- [x] `<768px`：强制只读堆叠；隐藏编辑入口并提示桌面编辑

### P4 — 构建与打磨

- [x] 编辑态无过重进场动画；把手与点击区分离
- [x] `./scripts/build_dashboard.sh` 产出 `web/static/dashboard`
- [x] README 补一句：总览可自定义布局
- [x] 本计划勾选完成项

### P5 — Phase 2（可另开迭代，本计划可后置）

- [ ] 多套命名预设 +「另存为」
- [ ] 撤销栈（≥20 步）
- [ ] 面板锁定 `static`
- [ ] 密度切换 tight / comfortable
- [ ] `md`（6 列）独立 layout 或自动折半

---

## 4. 非目标（本期不做）

- 服务端 / 跨设备同步布局  
- Portal 嵌套、自由绝对定位（非栅格）  
- 新图表 Widget（迷你分时等）— 归 Phase 3  
- 改 multipanel 的 1px 图墙规则  
- 顺手大改行情/自选/热力等其它页

---

## 5. Agent 执行约定

- 改动贴合本计划与 [`dashboard-overview-portal.md`](./dashboard-overview-portal.md)；不顺手大改无关页。  
- 布局引擎只用 **react-grid-layout**，不自研拖拽。  
- Widget `key` / layout `i` 必须一致。  
- 持久化 debounce，禁止每次 mousemove 写盘。  
- 每完成一个 P* 在本文件勾选。  
- 改 `vendor/stock-dashboard` 后需跑 `./scripts/build_dashboard.sh` 才反映到 `/dashboard/`。

---

## 6. 关键文件清单（预期）

| 路径 | 动作 |
|------|------|
| `docs/dashboard-overview-portal.md` | 设计（已拍板） |
| `docs/dev-plan-dashboard-overview-portal.md` | 本计划 |
| `vendor/stock-dashboard/package.json` | 加 `react-grid-layout` |
| `vendor/stock-dashboard/src/pages/Dashboard/Dashboard.tsx` | 改为 Portal 壳 + 数据上提 |
| `vendor/stock-dashboard/src/pages/Dashboard/Dashboard.module.css` | P0 间距 + Portal 样式 |
| `vendor/stock-dashboard/src/pages/Dashboard/portal/*` | 新建 |
| `web/static/dashboard/*` | 构建产物 |
| `README.md` | 总览布局说明 |

---

## 7. 默认布局速查（实现对照）

```text
y=0   6×独立指数              x=0,2,4,6,8,10  w=2 h=3
y=3   6×KPI (各 type)         x=0,2,4,6,8,10  w=2 h=3
y=6   watchlist               x=0  w=6  h=10
y=6   hotBoards               x=6  w=6  h=10
y=16  marketRanking           x=0  w=6  h=12
y=16  boardFundFlow           x=6  w=6  h=12
y=28  fundFlowRank            x=0  w=6  h=10
```

尺寸硬约束以设计文 §4.3 Catalog 为准。

---

## 8. Cursor Plan 执行顺序（给 Agent）

按序开工，完成一项勾选一项：

1. **P0** 只改 CSS 间距 → 刷新总览确认缝变小  
2. **P1** 装 RGL + 空 Canvas 能渲染默认 layout 占位块  
3. **P2** 逐个挂上真实 Widget（先 indices/KPI，再列表）  
4. **P3** 编辑态、增删、重置、移动端只读  
5. **P4** build + 回归验收 §2  
6. **P5** 另开迭代，勿与 MVP 混在同一 PR 除非明确要求  
