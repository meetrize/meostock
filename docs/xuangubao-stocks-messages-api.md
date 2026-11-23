# 选股宝个股消息流接口说明

> 上游：`https://api.xuangubao.com.cn/api/stocks/messages?Symbol=603960.SS&Limit=20`  
> 探测日期：2026-11-23  
> 探测标的：克来机电 `603960.SS`  
> 本站代理：无（仓库内尚无引用）  
> 关联文档：[选股宝涨停池接口](./xuangubao-limit-up-pool-api.md)（`flash-api` 行情/涨停池，与本接口域名与定位均不同）

本文记录该接口的定位、请求/分页、响应结构、字段维度、样本内容类型，以及与行情类接口的边界。

---

## 1. 接口是什么

选股宝 / 选股通 **按股票聚合的资讯与公告消息流**。

| 项 | 说明 |
|----|------|
| 方法 | `GET` |
| URL | `https://api.xuangubao.com.cn/api/stocks/messages` |
| 主机 | `api.xuangubao.com.cn`（内容站；涨停池在 `flash-api.xuangubao.cn`） |
| 关键参数 | `Symbol`、`Limit`；翻页用 `Mark` |
| 成功信封 | `{ "Messages": [ ... ], "NextMark": "20" }`（**无** `code`/`message`/`data` 包装） |
| `Messages` | 消息对象数组；`Limit=20` 时返回 20 条 |
| 响应体量 | 探测日约 **140KB**（关联股票列表很长时会膨胀） |

**是**：与该股相关的选股通栏目文章、板块异动快讯、交易所公告提醒、早餐/复盘/早知道等时间线。  
**不是**：行情快照、K 线、财务指标、涨停封单、龙虎榜。字段名里的 `Price` 是**文章解锁价**，不是股价。

建议请求头：`Accept: application/json`，`Referer: https://xuangubao.cn/`。浏览器直连可能遇 CORS。

---

## 2. 请求参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `Symbol` | 是 | 证券代码，格式 **`代码.交易所`**：上交所 `.SS`、深交所 `.SZ`。如 `603960.SS`、`000001.SZ` |
| `Limit` | 建议 | 返回条数；探测用 `20` / `5` 均有效 |
| `Mark` | 翻页 | 上一页响应的 `NextMark`；见 §3 |

**符号格式实测：**

| `Symbol` | 结果 |
|----------|------|
| `603960.SS` / `000001.SZ` / `600000.SS` | 正常返回 |
| `603960` / `SH603960` / `sz000001` | 空列表 `Messages: []` |
| 小写 `symbol` / `limit` | 可用（与驼峰等效） |

---

## 3. 分页

| 项 | 说明 |
|----|------|
| 响应游标 | `NextMark`（字符串，如 `"20"`、`"24"`） |
| 请求参数 | **`Mark`**（大小写 `mark` 均可） |
| 无效参数 | `NextMark`、`cursor`、`Offset` / `offset` 作请求参数时**不翻页**（仍返回首页） |

探测：`Limit=20` → `NextMark="20"`；再请求 `Limit=5&Mark=20` → 得到**无重叠**的后续 4～5 条，新 `NextMark="24"`。

`NextMark` 语义接近「已消费条数/偏移」，不是消息 `Id`。

---

## 4. 顶层结构

```json
{
  "Messages": [ /* Message 对象 */ ],
  "NextMark": "20"
}
```

无错误码信封；空结果时多为 `Messages: []`。

---

## 5. 单条消息字段总览

`Messages[]` 键很多（探测约 **90+**），大量为客户端状态、付费营销、跨站同步占位。按业务维度分组如下；「非空率」基于 `603960.SS` × `Limit=20` 样本。

### 5.1 身份与正文（核心）

| 字段 | 类型 | 非空率 | 含义 |
|------|------|--------|------|
| `Id` | string | 20/20 | 消息 ID，如 `"1307917"`、`"100150103"` |
| `Title` | string | 20/20 | 标题；多数快讯**标题即主信息** |
| `Summary` | string | 7/20 | 摘要；公告/早餐/复盘类较常见，异动快讯常为空 |
| `SubTitle` | string | 0/20 | 副标题（样本空） |
| `Source` | string | 17/20 | 来源文案：`选股通`、`上交所`、`上交所-最新公告`；异动类可为空 |
| `Url` | string | 17/20 | 原文页（选股通 article 或 api web） |
| `ShareUrl` | string | 20/20 | `https://api.xuangubao.com.cn/web/messages/{Id}` |
| `ShareUrl2` | string | 20/20 | 多为 `https://xuangutong.com.cn/article/{Id}` |
| `Route` | string | 20/20 | 带 `fromSubjectId` 的跳转 URL |
| `OriginalUrl` | string | 4/20 | 交易所原文（PDF 等）；**公告类 Style=3 常见** |
| `CreatedAt` | int | 20/20 | 创建时间 Unix 秒 |
| `UpdatedAt` | int | 20/20 | 更新时间 |
| `ManualUpdatedAt` | int | 20/20 | 人工更新时间 |

**列表接口不返回全文 HTML。** `PreviewContent`、`AnalystExtensionContent`、`TitlePath`、`SummaryPath` 在本样本均为空。

### 5.2 形态与标签

| 字段 | 类型 | 非空/有值率 | 含义 |
|------|------|-------------|------|
| `Style` | int | 20/20 | 消息形态（见 §6） |
| `Labels` | int[] | 13/20 | 如 `[1]`、`[3]`；与 Style 大致同向，非官方枚举 |
| `FlashMessageType` | string | 20/20 | 样本均为 `"default"` |
| `ContentType` / `MediaType` / `Type` / `Category` | int | 恒 0 | 样本无区分度 |
| `BkYiDongType` | int | 恒 0 | 板块异动类型占位 |
| `Impact` | int | 恒 0 | 影响面占位 |
| `IsBreakingNews` | bool | 恒 false | 是否突发 |
| `IsFlashComment` | bool | 恒 false | 是否闪电解读 |
| `HasXgbXunPrefix` | bool | 部分 true | 选股通「讯」类前缀标记 |

### 5.3 栏目 / 专栏 `FromSubject`

每条均有嵌套对象 `FromSubject`（约 46～47 键）。业务上常用：

| 字段 | 含义 |
|------|------|
| `Id` / `Title` | 专栏 ID 与名称 |
| `Desc` / `Introduction` / `Specialty` | 专栏简介（部分有） |
| `FollowerCount` | 关注人数 |
| `Image` / `PcImage` | 封面 |
| `ShareUrl` / `ShareUrl2` | 专栏分享链 |
| `Type` | 专栏类型（样本多见 `2`） |
| `IsSubscribable` / `SubscribeType` / `BasePrice` | 是否可订阅、订阅价 |
| `PrivilegeDescs` | 订阅权益说明列表 |
| `BusinessLine` | 业务线标记（如 `firm:other:operation`） |

样本中出现的专栏（`Title`）：

| 专栏 | 条数 | 典型内容 |
|------|------|----------|
| 市场热点观察 | 3 | 题材/热点梳理 |
| A股板块异动播报 | 3 | 盘中概念异动快讯 |
| 重要公告提醒 | 3 | 交易所公告摘要 |
| 早餐&晚报精选 | 2 | 盘前/盘后资讯汇编 |
| 公告精选一天两发 | 2 | 上市公司公告精选 |
| 选股通早知道 | 2 | 付费向短讯 |
| 避雷早知道 | 1 | 付费向风险提示 |
| 大涨解读 | 1 | 板块大涨原因解读 |
| 每日最强复盘 | 1 | 日终主题复盘 |
| 交易剧本。 | 1 | 盘前剧本 |
| 又有哪些公司被大股东减持 | 1 | 减持类公告聚合 |

消息上还有 `FromSubjectId`、`SubscribeSubjectId`（字符串 ID，常为 `"0"` 或与专栏相关）。

### 5.4 关联股票

| 字段 | 非空率 | 含义 |
|------|--------|------|
| `RelatedStocks` | 20/20 | 主关联股列表 |
| `AllRelatedStocks` | 20/20 | 扩展关联列表（可含基金等） |
| `Stocks` | 10/20 | 文中重点股（更短） |
| `AllStocks` | 10/20 | 与 `Stocks` 对应的扩展版 |

单项结构：

```json
{ "Name": "克来机电", "Symbol": "603960.SS", "Market": "" }
```

- `RelatedStocks[].Market` 常为空串。  
- `AllRelatedStocks[].Market` 样本多为 `"mdc"`。  
- `AllRelatedStocks` 有时比 `RelatedStocks` 多出基金代码（如混合型基金），**研判个股时优先用 `RelatedStocks` / `Stocks`**。  
- 热点文可挂 **几十～上百** 只概念股；交易所公告类通常 **仅本股 1 只**。  
- 本样本 20/20 的 `RelatedStocks` 均含 `603960.SS`（接口按「提及该股」聚合，不保证文章以该股为主角）。

`RelatedStockPlates` 样本恒为 `null`（无板块结构化字段）。

### 5.5 配图与媒体

| 字段 | 非空率 | 含义 |
|------|--------|------|
| `PcImage` | 10/20 | PC 配图 URL（`image.xuangubao.com.cn/...`） |
| `Image` / `AppFeedImg` / `MediaUrl` | 0/20 | 样本空 |
| `Watermarks` | 0/20 | 水印 |

### 5.6 互动

| 字段 | 说明 |
|------|------|
| `LikeCount` | 点赞数（14/20 非零） |
| `Liked` | 当前用户是否赞过（未登录恒 false） |
| `CommentCount` | 样本恒 0 |

### 5.7 付费 / 会员

| 字段 | 说明 |
|------|------|
| `IsPremium` | 是否付费文（样本 3/20） |
| `IsPaid` / `IsTrial` | 是否已购 / 试读（未登录恒 false） |
| `Price` | 解锁价格（付费文样本为 `18`）；**非股价** |
| `SalePrice` | 促销价（样本 0） |
| `MessagePremiumPercent` | 正文遮挡比例（约 0.95～0.98） |
| `UnlockCopyWriting` | 如「解锁全文」 |
| `CouponHint` | 如「领新人福利 享免费解锁」 |
| `PaidCount` | 付费相关计数 |
| `AppleProductId` | IAP 商品 ID（样本空） |

付费栏目示例：`选股通早知道`、`避雷早知道`。列表仍返回标题，**无全文、无有效 `PreviewContent`**。

### 5.8 同步与运营噪音（可忽略）

下列在样本中恒空 / 恒 false / 恒 0，集成时可丢弃：

- 作者：`Author`（null）、`DisplayAuthor`（空）、`AuthorId` / `EditorId` / `AuthorArticleId`（有值但偏内部）
- 跨站：`SyncToWscn`、`WscnId`、`SyncToGlobal`、`GlobalId`、`SyncFromWscnMsgId`
- 优惠券：`Coupons`、`CouponEvtIds`
- 解读扩展：`NeedExplained`、`ExplainInfos`、`ExplainedInfos`、`YiDongRelatedMsg`
- 状态：`Status`、`IsWithdrawn`、`IsPromotion`、`IsCommercial`、`NoPush`、`ContentRefused`（偶发 true）
- 其它：`Score`、`CreatedBy`、`UseTempl`、`IntersectMyChosenStock`、`WhetherHideImpactFace`、`AILimitationPeriod` 等

---

## 6. `Style` 与内容类型（样本推断，非官方文档）

| `Style` | 样本条数 | 典型专栏 | 内容形态 | 关联股规模 |
|---------|----------|----------|----------|------------|
| `1` | 3 | A股板块异动播报 | 盘中概念异动快讯；标题含涨停/跟涨个股名 | 约 7～8；`Stocks` 常略少于 Related |
| `2` | 13 | 热点观察、早餐、复盘、早知道、大涨解读等 | 栏目文章；部分有 `Summary`；付费文多为该类 | 5～106 不等 |
| `3` | 4 | 重要公告提醒、大股东减持 | 交易所公告摘要；常有 `OriginalUrl` → 上交所 PDF | **1**（本股） |

`Labels`：`[3]` 多见于 Style 1/3；`[1]` 多见于 Style 2。勿当作稳定 API 契约。

---

## 7. 样本时间线摘要（603960.SS，Limit=20）

时间跨度约 **2024-08-27 → 2026-11-23**（按 `CreatedAt`；列表**非严格按时间倒序**，同屏会混入较早热点文）。

| 类型 | 示例标题（节选） | 对个股的意义 |
|------|------------------|--------------|
| 公司公告 | 控股股东减持计划/进度；拟增资取得子公司股权 | **最高相关**；可跟 `OriginalUrl` 读 PDF |
| 板块异动 | 「克来机电直线涨停」「机器人概念…克来机电等多股涨停」 | 盘中被点名的异动时点 |
| 题材热点 | 机器人概念延续活跃、宇树科创板上市相关 | 作为机器人链关联股被挂入 |
| 市场汇编 | 早餐、晚报、主题复盘、公告精选 | 弱相关；本股在长名单中 |
| 付费短讯 | 早知道 / 避雷早知道 | 标题级信息；正文需解锁 |

---

## 8. 公告类字段示例（Style=3）

```text
Title: 克来机电：控股股东陈久康减持786.58万股，减持计划实施完毕
Summary: …集中竞价减持…大宗交易减持…合计占总股本 2.9999%…
OriginalUrl: http://www.sse.com.cn/.../603960_20260930_....pdf
RelatedStocks: [{ "Name": "克来机电", "Symbol": "603960.SS", "Market": "" }]
Source: 上交所
FromSubject.Title: 重要公告提醒
```

此类最适合做「个股公告时间线」；异动与热点文适合做「近期被市场提及的上下文」。

---

## 9. 推荐消费字段（最小集）

```
Id
Title
Summary
Source
Style
CreatedAt
UpdatedAt
Url | ShareUrl2 | OriginalUrl
FromSubject.Id
FromSubject.Title
RelatedStocks[] | Stocks[]     # Name, Symbol
IsPremium
NextMark                       # 顶层，用于翻页
```

过滤建议：

- 要**公司大事**：`Style == 3` 或 `OriginalUrl` 非空，或 `RelatedStocks.length == 1` 且 Symbol 匹配。  
- 要**盘中异动语境**：`Style == 1` 或专栏名含「异动」。  
- 降噪：丢弃关联股 > N（如 30）且本股非 `Stocks` 内的长名单热点文。

---

## 10. 明确不提供 / 易误解

| 需求 | 本接口 |
|------|--------|
| 最新价、涨跌幅、成交量、换手 | 无 |
| K 线 / 分时 | 无 |
| 财务、估值 | 无 |
| 涨停封单、连板、开板时间 | 无 → 见 [涨停池接口](./xuangubao-limit-up-pool-api.md) |
| 文章全文 | 无（仅标题/摘要/外链） |
| `Price` | **文章价格**，不是股价 |
| 行业/概念结构化标签 | `RelatedStockPlates` 样本为 null；概念仅体现在标题与关联股列表 |

---

## 11. 与本站其它选股宝数据的边界

| 接口 | 主机 | 定位 |
|------|------|------|
| 本接口 ` /api/stocks/messages` | `api.xuangubao.com.cn` | 个股资讯/公告消息流 |
| 涨停池 `/api/pool/detail` | `flash-api.xuangubao.cn` | 盘中涨停/跌停等池快照与涨停原因 |

两者不可互换；做研判工作台时通常：**池/行情一条线 + 消息流一条线**。

---

## 12. 探测备注

- 探测脚本未登录；付费态、`Liked`、`IsSubscribed` 等用户态字段均为默认值。  
- `Style` / `Labels` / `Market=mdc` 为样本推断，非官方枚举文档。  
- 响应无统一 `code` 字段；异常时需以 HTTP 状态与空 `Messages` 自行判断。  
- 单页关联股极多时 JSON 很大，下游宜裁剪 `RelatedStocks` 或只保留本股命中标记。
