# 全局后台同步 UX 方案

> 状态：**待确认后与 Tushare 缓存方案一并实施**  
> 日期：2026-10-28  
> 范围：**所有**同步机制统一体验——东财/新浪本地行情缓存、Tushare 专题缓存、定时任务、手动同步、打开页面触发的自动补数  
> 关联：[`local-quote-cache.md`](./local-quote-cache.md) · [`tushare-local-cache.md`](./tushare-local-cache.md) · [`dev-plan-tushare-local-cache.md`](./dev-plan-tushare-local-cache.md)

---

## 0. 一句话结论

同步一律在 **本机后台 Worker** 执行；前端 **永不蒙层打断**。用户点击同步或系统自动/定时同步时，仅在 **顶栏** 显示同步图标与百分比；完成后对当前可见数据做 **无刷新静默更新**（改 state / 重拉缓存接口，不 `location.reload`、不整页 Loading 盖住表格）。

同时：把 **数据来源 ↔ 市场/节点** 做成可视化指示，并按 **来源轨（lane）** 分开同步、分开展示进度——禁止再出现一个含糊的「同步所有」把东财与 Tushare 混成一团却看不清在刷什么。

---

## 0.1 来源 × 市场对照表（权威映射）

| 来源轨 `sourceLane` | 上游 | 覆盖的行情节点 `market_id` | 读 API | 同步 API |
|---------------------|------|------------------------------|--------|----------|
| `em-sina` | 东财 clist → 新浪回退 | `cn` `hk` `us` | `/api/cache/snapshot` | `/api/cache/sync` · `sync-all?lanes=em-sina` |
| `lazy-catalog` | 静态目录 + sdk/现货补价 | `fund` `index` `futures` | 同上 | `/api/cache/sync` · `sync-all?lanes=lazy-catalog` |
| `yfinance` | Yahoo / 本机 yf 桥 | `yf:METALS` `yf:COMMODITIES` `yf:CURRENCIES` `yf:CRYPTOCURRENCIES` `yf:RATES` `yf:US` `yf:EUROPE` `yf:ASIA` `yf:GB` | 同上 | `/api/cache/sync` · `sync-all?lanes=yfinance` |
| `tushare` | kaixin8 主 / datahubco 备 | 全部非占位 `ts:*`（limit/cb/etf/…） | `/api/tushare/market` | `/api/tushare/sync` · `sync-all` |
| `placeholder` | — | `ts:ph:*` | — | **不同步** |

说明：

- 一期东财 Worker 仍可共用一个线程队列，但 **入队与进度按 lane 过滤/汇总**，UI 上是三条可独立点的轨。  
- Tushare 必须独立 Worker（与现方案一致）。  
- 左侧导航每一项旁显示 **来源色点/徽章**，与上表一一对应。

### 可视化图例（固定色，写入 CSS 变量）

| Lane | 徽章文案 | 建议色意 |
|------|----------|----------|
| `em-sina` | 东财 | 蓝 |
| `lazy-catalog` | 目录 | 青 |
| `yfinance` | Yahoo | 紫 |
| `tushare` | Tushare | 琥珀 |
| `placeholder` | 占位 | 灰虚线 |

---


## 1. 现状问题（要改掉的）

| 现象 | 位置 | 问题 |
|------|------|------|
| `cacheSyncing` 并入 `showOverlay` | `QuotesMarket.tsx` | 同步时整卡蒙层，表格不可点、像卡住 |
| `waitCacheSync` 在页面内死等 | 同上 | 同步逻辑绑死在行情页；切页易丢进度感知 |
| 同步完成后 `loadMarket(..., force)` | 同上 | 易再次进入大 Loading，体感「刷了两次」 |
| 设置页同步 | `Settings.tsx` | 与行情页两套体验 |
| Tushare（规划中） | — | 若沿用蒙层会重复问题 |

**保留**：首次进入某市场、列表尚未就绪时的 **加载 Loading**（这是「读」不是「同步」）。  
**区分**：`loading`（首屏取数）≠ `syncing`（后台刷新）。

---

## 2. 目标体验

1. **不挡操作**：同步中可继续滚动、排序、切市场、切页面、搜索。  
2. **来源可视**：每个市场节点旁有来源徽章；顶栏/面板按轨分开展示，不混称「未知同步」。  
3. **分轨同步**：用户可只同步「东财 A/H/美」「目录类」「Yahoo」「Tushare」中的一轨或当前节点。  
4. **全局可见**：任意路由顶栏都能看到各轨同步状态与百分比。  
5. **可点开详情**：图标展开面板 = **分轨进度列表** + 当前节点 + 成功/失败。  
6. **完成无感刷新**：仅 softReload **属于已完成轨/节点** 的当前页。  
7. **失败可感知**：对应轨徽章变警示色；不弹阻塞对话框。

---

## 3. 交互规格

### 3.1 行情页左侧：来源徽章 + 分轨同步入口

每个导航 leaf：

```
[●东财] 全部A股          （或小色点 + title 悬停全称）
[●Tushare] 涨跌停
```

- 悬停：`数据来源：东财/新浪 · 同步轨 em-sina · 上次同步 HH:mm`  
- 当前选中节点工具栏：「同步本节点」——只入队 **当前 market_id**（走该节点所属轨的 sync API）。  
- 侧栏分组标题右侧可放小按钮「同步本组」：仅同步该 group 下同 lane 的节点（若一组跨 lane，则按子节点拆多次或禁用并提示）。

### 3.2 顶栏：分轨指示器（主视觉）

位置：搜索框右侧。

**空闲**：可显示一排静态小色点（四轨），表示「系统有这些来源」；或收纳为一个 `Database` 图标。  

**有任务时**：

```
[⟳ 东财 67%] [⟳ Yahoo 20%] [⟳ Tushare 45%]
```

- **分轨各自百分比**，不强制合成一个数（避免用户不知道在刷哪）。  
- 若空间紧：主图标上显示「N 轨同步中」，展开面板看分轨。  
- 单轨完成：该轨闪对勾 3s 后恢复静态。  
- 单轨失败：该轨感叹号，其它轨不受影响。

### 3.3 展开面板（Popover）= 来源矩阵 + 进度

结构：

1. **图例**：四色轨名称（与 §0.1 一致）。  
2. **分轨进度条**：每轨一行 `label | ████░░ 67% | 当前: A股 | 3/5`。  
3. **快捷同步**（每行右侧按钮，后台入队）：  
   - 同步东财（cn/hk/us）  
   - 同步目录（fund/index/futures）  
   - 同步 Yahoo（全部 yf:*）  
   - 同步 Tushare（全部 ts:*）  
4. **不提供**「一键混同且无说明的同步所有」作为主按钮；若保留「全部轨」，须文案为「同步全部来源（四轨）」并在面板内仍分轨显示进度。  
5. 不锁屏；一期不做取消。

### 3.4 手动同步按钮（行情页工具栏）

| 按钮 | 行为 |
|------|------|
| 同步本节点 | 仅当前 `market_id` → 对应 lane 的 `POST .../sync` |
| （不再用含糊「同步所有」） | 改为打开顶栏面板，或下拉：「东财 / 目录 / Yahoo / Tushare / 全部来源」 |
| 设置页 | 四轨各自「同步」+ 可选「全部来源」 |

一律 `background:true`，只入队；表格不禁用（同 job 重复点击 → toast「该来源已在同步」）。

### 3.5 自动同步（打开页 / stale）

服务端 `enqueue` 后台刷时：

- 前端轮询发现对应 **lane** active → 顶栏该轨亮起。  
- **禁止** `showOverlay=true`。  
- 当前页 market 属于该批完成集合 → 静默 `softReload`。

### 3.6 定时同步

- 仅触发 **tushare** 轨（或配置所选轨）；顶栏只亮对应轨。  
- Toast：「定时同步完成（Tushare）」——可关。

### 3.7 「刷新」按钮语义

| 源模式 | 刷新 |
|--------|------|
| `local` | 只重读本地 API，顶栏不出现同步（无上游） |
| `auto`/`network` | 可选：轻量重读；若触发 force sync，走后台 + 顶栏，**不用蒙层** |

---

## 4. 前端架构

### 4.1 `SyncStatusProvider`（全局 Context）

路径建议：`apps/stock-dashboard/src/contexts/SyncStatusProvider.tsx`

职责：

1. 轮询（active 时 400–800ms，空闲 3–5s 或停轮询）：  
   - `GET /api/cache/sync/progress`  
   - `GET /api/tushare/sync/progress`（落地后）  
2. 归一为：

```ts
type SourceLane = 'em-sina' | 'lazy-catalog' | 'yfinance' | 'tushare';

type SyncTrack = {
  lane: SourceLane;
  label: string;          // 东财 / 目录 / Yahoo / Tushare
  active: boolean;
  percent: number;        // 该轨 0–100
  message: string;
  marketId?: string;
  marketLabel?: string;
  okCount: number;
  failCount: number;
  errors: Array<{ market: string; error: string }>;
  lastSyncedAt?: number | null;
};

type SyncStatus = {
  tracks: SyncTrack[];    // 固定 4 轨，无任务时 active=false
  anyActive: boolean;
  softVersion: number;    // 任一轮完成 +1
  completedLanes: SourceLane[]; // 本轮刚完成的轨，供 softReload 过滤
};

// 节点 → 轨（与 catalog 同源，前后端各一份或 /api/sync/lanes 下发）
function laneOf(marketId: string): SourceLane | 'placeholder'
```

3. 某轨 active→inactive 时：`softVersion++`，`completedLanes` 含该轨；短 toast 可带轨名。  
4. `requestSync({ lane | marketId })`：只入队对应 API。  
5. 配置表 `SOURCE_LANE_CATALOG` 与左侧徽章、面板图例共用。

### 4.2 Header 订阅

`Header` 读 `useSyncStatus()`，渲染 **分轨** 指示器 + 矩阵 Popover。  
**不**依赖是否在 `/quotes`。

### 4.3 QuotesMarket 改造要点

```diff
- const showOverlay = loading || pageLoading || cacheSyncing;
+ const showOverlay = loading || pageLoading; // 仅首屏/翻页补数
```

- 删除（或降级）页面内 `waitCacheSync` 阻塞式等待；改为 `requestSync` 后立刻结束。  
- `useEffect` 依赖 `softVersion`：若当前 `market` 属于刚完成的 track，则：

```ts
softReload(market) // fetch snapshot/market，setRows，不 setLoading(true)
```

- `pageLoading`（懒市场补当前页报价）可保留薄进度，但建议也改为行内/顶栏次级，**二期**再收；一期至少 **同步类** 不进 overlay。

### 4.4 Settings

「数据来源与同步」矩阵（§6）：每轨独立同步按钮 + 展开市场列表；进度只看顶栏分轨指示。

### 4.5 无刷新更新定义

**做**：

- `setRows(newData)` / 更新 `cacheMeta`  
- 保留 `sortKey`、`page`、`query`、滚动位置（能保则保；表格若虚拟列表再议）  

**不做**：

- `window.location.reload()`  
- 全页 `Loading fullScreen`  
- 重置到默认市场  

若静默拉取请求失败：保留旧 rows，顶栏/toast 提示「已同步但界面更新失败，可手动刷新」。

---

## 5. 后端配合（契约）

1. **所有** sync 默认 `background:true`。  
2. Progress 按 **lane** 可解析：

```json
{
  "ok": true,
  "lanes": {
    "em-sina": { "active": true, "done": 1, "total": 3, "market": "cn", "percent": 33, ... },
    "lazy-catalog": { "active": false, "done": 0, "total": 0, ... },
    "yfinance": { "active": false, ... }
  },
  "active": true,
  "merged_percent": 20
}
```

   兼容旧字段时可继续返回扁平 progress，但 **新前端以 `lanes` 为准**。  
3. `POST /api/cache/sync-all` 增加 `lanes?: string[]`；缺省为全部非 tushare 本地轨。  
4. Tushare `GET /api/tushare/sync/progress` 同构，或并入 `GET /api/sync/overview` 一次返回四轨。  
5. `GET /api/sync/catalog`（建议新增）：返回 §0.1 映射 + 各节点 `last_synced_at`/`row_count`/`source`，供徽章与设置页矩阵。  
6. 写入事务提交后再标记 done。

---

## 6. 设置页：来源矩阵

独立卡片区「数据来源与同步」：

| 来源 | 覆盖市场（可展开） | 上次同步 | 状态 | 操作 |
|------|-------------------|----------|------|------|
| 东财/新浪 | A股/港股/美股 | … | 空闲/同步中 % | 同步本轨 |
| 目录补价 | 基金/指数/期货 | … | … | 同步本轨 |
| Yahoo | 9 个 yf:* | … | … | 同步本轨 |
| Tushare | P0 专题列表 | … | … | 同步本轨 + 定时开关 |

每行市场可点进「只同步这一项」。

---

## 7. 与缓存方案的衔接

| 场景 | Lane | 顶栏 | 完成后 |
|------|------|------|--------|
| 同步当前 A 股 | `em-sina` | 该轨 % | softReload `cn` |
| 同步本轨 Yahoo | `yfinance` | 该轨 % | 若在 yf:* softReload |
| 同步本轨 Tushare | `tushare` | 该轨 % | 若在 ts:* softReload |
| 打开页 auto 补数 | 对应 lane | 该轨可亮 | softReload |
| 定时 Tushare | `tushare` | 该轨 | softReload |
| 「全部轨」高级 | 多轨 | 分轨 + 合并摘要 | 按 softMarkets |

主按钮文案避免「同步所有」；用「同步当前 / 同步本轨（东财）/ 同步本轨（Tushare）」等。

---

## 8. 状态机（每轨独立）

```
LaneIdle
  │ requestSync(lane|market) / 轮询发现该轨 active
  ▼
LaneSyncing（本轨 %；其它轨可同时 Syncing）
  │ lane.active === false
  ├─ fail==0 → LaneOkFlash → Idle；softVersion++；softMarkets=本批
  └─ fail>0  → LaneError；成功子集仍 softReload
```

---

## 9. 非目标

- WebSocket 推送进度（一期 HTTP 轮询）  
- 用户取消进行中的上游请求  
- 多用户强一致  
- 翻页补价 pageLoading 进顶栏（二期）  
- 把 yfinance 与东财在物理进程上强拆成多进程（一期同 Worker + lane 过滤即可）

---

## 10. 验收标准

```text
[ ] 左侧每个市场可见来源徽章（东财/目录/Yahoo/Tushare），与对照表一致
[ ] 顶栏展开可见分轨进度，而非单一模糊条
[ ] 「同步当前」只刷选中节点；「同步本轨」只刷该来源全部节点
[ ] 可同时：东财轨同步中 + Tushare 轨同步中，分轨 % 各自变化
[ ] 同步无页面蒙层；完成后无刷新更新
[ ] 设置页来源矩阵可分轨同步
[ ] local 源刷新不触发上游轨转圈
[ ] 定时 Tushare 只点亮 tushare 轨
```

---

## 11. 实施顺序

1. **来源映射常量** + 左侧徽章 + `GET /api/sync/catalog`（可先静态）  
2. `SyncStatusProvider` 分轨 + Header 分轨 Popover + 去蒙层  
3. cache `sync-all?lanes=` + progress.lanes  
4. Tushare worker 接入第四轨  
5. 设置页来源矩阵 + softReload(`softMarkets`)
