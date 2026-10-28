# 总览：独立指数/标的面板 + 价格/面积曲线

> 状态：**已拍板并实施**（2026-10-28）  
> 关联：[`dashboard-portal-multi-source.md`](./dashboard-portal-multi-source.md) · 计划 [`dev-plan-dashboard-portal-spark-panels.md`](./dev-plan-dashboard-portal-spark-panels.md)

---

## 1. 目标

1. **全球指数、国内期货等**从「横滑条带」改为与 A 股六指数相同的 **独立小面板**（可拖拽、可删、可进 Catalog）。  
2. **每个面板**：点击价格 ↔ 日线 **面积曲线**（行为对齐现有 `IndexWidget`）。  
3. **曲线取数**服从全局 `quoteSource`：  
   - `auto`：`local_first`（有缓存先出，后台可刷新）  
   - `local`：`cache_only`（只读盘）  
   - `network`：`force=1`（实时拉）  
4. **全局开关**「价格 / 曲线」：设为曲线时，进入总览默认全部指数类面板以面积图展示；仍可单卡点击临时切换。

---

## 2. 产品规则

| 项 | 规则 |
|----|------|
| 默认布局 | 去掉 `strip.globalIndices` / `strip.futures`；改为每人一格 `w=2 h=2` |
| 全球指数默认 | 道指/纳指/标普/VIX/恒生/日经/韩国/DAX/富时/欧股50（10 格，约两行） |
| 期货默认 | 沪金/沪银/沪铜/螺纹/原油/橡胶/豆粕/IF/IC/IM（10 格） |
| 单卡点击 | 价格 → 曲线；再点 → 价格（覆盖本卡，不改全局） |
| 全局切换 | Toolbar「价格｜曲线」；切换后 **所有** spark/index 面板跟随 |
| 条带类型 | Catalog 可保留作紧凑备选，**默认布局不再使用** |

---

## 3. 技术要点

- 注册表 `sparkCatalog.ts`：`type → { market, code, klineSymbol, name, group }`  
- 统一组件 `SparkQuoteWidget`（A 股指数也改走该组件）  
- `PortalPersistedState.indexDisplayMode: 'price' | 'chart'`，存储 key → **v7**  
- K 线：`GET /api/cache/kline?symbol=&period=1d&…`  

---

## 4. 非目标

- 分钟线 / 分时面积图（一期仍日线）  
- 服务端同步「价格/曲线」偏好  
- 把专题 topic 表也改成面积图  
