# 日 K 历史向后加载（缩放触底续拉）

## 问题

单图 / 多面板日 K 以往只保留约 **500 根**（东财 `lmt=500`、Yahoo 再截断），缩放到约 **2024-11** 即见底。

## 行为

1. 首屏仍拉「最近一页」秒开。  
2. 用户缩放到可见区左缘时，klinecharts `getBars(type=backward)` 触发向前续拉。  
3. 单图顶栏 **图操作** 区（`tb-actions`，位于周期组与工具组之间）提供「历史」按钮：单击再拉一页更早 K 线（默认 500 根），与左缘自动续拉共用 `fetchKlineBefore` / inflight / `history_exhausted`；加载中或已耗尽时禁用。分时/分钟周期禁用（主要服务日/周 K）。  
4. 请求 `GET /api/cache/kline?symbol=&period=&before_ts=&limit=500`。  
5. 按市场现有源优先级探测：主源支持 `end`/`period1` 分页则用主源，否则备用。  
6. 更早 bars **upsert** 进 SQLite，下次打开可直接读盘。  
7. 无更早数据时 `exhausted=true`，`kline_meta.history_exhausted=1`，不再打空网。  
8. 常规 force/后台刷新改为 **upsert 最近窗**，不删已加载的更早历史。

## API

| 参数 | 说明 |
|------|------|
| `before_ts` | 毫秒；有则走向前续拉 |
| `limit` | 每页根数，默认 500，上限 1000 |

响应额外字段：`direction=backward`、`has_more`、`exhausted`。

## 源优先级（向前）

| 市场 | 顺序 |
|------|------|
| cn | 东财 `end+lmt` → Yahoo 时间窗 |
| us / hk | 东财 → Yahoo |
| yf | Yahoo |
| futures | 东财 end 分页 |

新浪多为「最近 N 根」，不支持可靠向前分页，跳过。

## 相关代码

- [`web/cache/providers/kline_fetch.py`](../web/cache/providers/kline_fetch.py) — `fetch_kline_bars_before`  
- [`web/cache/kline_models.py`](../web/cache/kline_models.py) — `upsert_kline_bars` / `read_kline_bars_before`  
- [`web/cache/api.py`](../web/cache/api.py) — `/api/cache/kline`  
- [`web/static/index.html`](../web/static/index.html) — `tb-actions`「历史」按钮 + `backward` 左缘续拉  
- [`ChartPanel.mjs`](../web/static/kline/ChartPanel.mjs) — 多面板 `backward`  
