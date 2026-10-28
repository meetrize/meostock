"""行情页分类树与 P0 接口映射。"""

from __future__ import annotations

from typing import Any, Literal

Kind = Literal["legacy", "tushare", "placeholder"]
TableKind = Literal["quote", "topic"]

# 列：前端用；quote 表走统一 QuoteRow 字段名；topic 用原始/归一字段
Col = dict[str, Any]


def _col(key: str, label: str, align: str = "right") -> Col:
    return {"key": key, "label": label, "align": align}


QUOTE_COLS: list[Col] = [
    _col("code", "代码", "left"),
    _col("name", "名称", "left"),
    _col("changePercent", "涨幅"),
    _col("price", "现价"),
    _col("change", "涨跌"),
    _col("volume", "成交量"),
    _col("amount", "成交额"),
    _col("turnoverRate", "换手率"),
    _col("open", "今开"),
    _col("prevClose", "昨收"),
    _col("high", "最高"),
    _col("low", "最低"),
]

# ---------- 导航树（前端渲染；legacy 节点 id 与现 QuotesMarket 一致）----------

NAV_TREE: list[dict[str, Any]] = [
    {
        "id": "g_cn",
        "label": "沪深京",
        "children": [
            {"id": "cn", "label": "全部A股", "kind": "legacy", "table": "quote"},
            {"id": "ts:limit", "label": "涨跌停", "kind": "tushare", "table": "topic"},
            {"id": "ts:stk_limit", "label": "涨跌停价", "kind": "tushare", "table": "topic"},
            {"id": "ts:suspend", "label": "停复牌", "kind": "tushare", "table": "topic"},
            {"id": "ts:new_share", "label": "新股", "kind": "tushare", "table": "topic"},
        ],
    },
    {
        "id": "g_board",
        "label": "板块指数",
        "children": [
            {"id": "ts:sw", "label": "申万行业", "kind": "tushare", "table": "quote"},
            {"id": "ts:ths", "label": "同花顺板块", "kind": "tushare", "table": "topic"},
            {"id": "ts:dc", "label": "东财板块", "kind": "tushare", "table": "topic"},
        ],
    },
    {
        "id": "g_index",
        "label": "指数 / 基金 / 衍生品",
        "children": [
            {"id": "index", "label": "国内指数", "kind": "legacy", "table": "quote"},
            {"id": "fund", "label": "公募/场内基金", "kind": "legacy", "table": "quote"},
            {"id": "ts:etf", "label": "ETF日线", "kind": "tushare", "table": "quote"},
            {"id": "futures", "label": "国内期货", "kind": "legacy", "table": "quote"},
            {"id": "ts:cb", "label": "可转债", "kind": "tushare", "table": "quote"},
            {"id": "ts:opt", "label": "期权合约", "kind": "tushare", "table": "topic"},
        ],
    },
    {
        "id": "g_flow",
        "label": "资金与异动",
        "children": [
            {"id": "ts:moneyflow", "label": "个股资金流", "kind": "tushare", "table": "topic"},
            {"id": "ts:hsgt", "label": "沪深港通", "kind": "tushare", "table": "topic"},
            {"id": "ts:top_list", "label": "龙虎榜", "kind": "tushare", "table": "topic"},
            {"id": "ts:block_trade", "label": "大宗交易", "kind": "tushare", "table": "topic"},
            {"id": "ts:margin", "label": "两融汇总", "kind": "tushare", "table": "topic"},
            {"id": "ts:margin_detail", "label": "两融明细", "kind": "tushare", "table": "topic"},
        ],
    },
    {
        "id": "g_hkus",
        "label": "港美与扩展",
        "children": [
            {"id": "hk", "label": "港股", "kind": "legacy", "table": "quote"},
            {"id": "us", "label": "美股", "kind": "legacy", "table": "quote"},
            {"id": "yf:METALS", "label": "贵金属/能源", "kind": "legacy", "table": "quote"},
            {"id": "yf:COMMODITIES", "label": "大宗商品", "kind": "legacy", "table": "quote"},
            {"id": "yf:CURRENCIES", "label": "外汇", "kind": "legacy", "table": "quote"},
            {"id": "yf:CRYPTOCURRENCIES", "label": "加密货币", "kind": "legacy", "table": "quote"},
            {"id": "yf:RATES", "label": "利率", "kind": "legacy", "table": "quote"},
            {"id": "yf:US", "label": "美国", "kind": "legacy", "table": "quote"},
            {"id": "yf:EUROPE", "label": "欧洲", "kind": "legacy", "table": "quote"},
            {"id": "yf:ASIA", "label": "亚洲", "kind": "legacy", "table": "quote"},
            {"id": "yf:GB", "label": "英国", "kind": "legacy", "table": "quote"},
        ],
    },
    {
        "id": "g_research",
        "label": "专题（二期）",
        "children": [
            {
                "id": "ts:ph:fina",
                "label": "财务与股东",
                "kind": "placeholder",
                "table": "topic",
                "hint": "一期占位：利润表/股东等见开发计划 P2",
            },
            {
                "id": "ts:ph:news",
                "label": "资讯公告",
                "kind": "placeholder",
                "table": "topic",
                "hint": "一期占位：新闻/公告额度单独评估",
            },
            {
                "id": "ts:ph:macro",
                "label": "宏观利率",
                "kind": "placeholder",
                "table": "topic",
                "hint": "一期占位：SHIBOR/GDP 等列入 P1",
            },
        ],
    },
]

# market_id -> 拉取描述
MARKET_SPECS: dict[str, dict[str, Any]] = {
    "ts:cb": {
        "label": "可转债",
        "table": "quote",
        "handler": "cb",
        "columns": QUOTE_COLS
        + [_col("bondOverRate", "溢价率"), _col("extra", "转股价值")],
    },
    "ts:opt": {
        "label": "期权合约",
        "table": "topic",
        "handler": "opt",
        "columns": [
            _col("code", "代码", "left"),
            _col("name", "名称", "left"),
            _col("exchange", "交易所", "left"),
            _col("callPut", "认购/沽", "left"),
            _col("exercisePrice", "行权价"),
            _col("listDate", "上市日", "left"),
            _col("delistDate", "到期日", "left"),
        ],
    },
    "ts:limit": {
        "label": "涨跌停",
        "table": "topic",
        "handler": "limit",
        "columns": [
            _col("code", "代码", "left"),
            _col("name", "名称", "left"),
            _col("close", "收盘"),
            _col("pctChg", "涨跌幅"),
            _col("limit", "类型", "left"),
            _col("fdAmount", "封单额"),
            _col("firstTime", "首次封板", "left"),
            _col("lastTime", "最后封板", "left"),
            _col("openTimes", "打开次数"),
            _col("limitTimes", "连板数"),
        ],
    },
    "ts:stk_limit": {
        "label": "涨跌停价",
        "table": "topic",
        "handler": "stk_limit",
        "columns": [
            _col("code", "代码", "left"),
            _col("upLimit", "涨停价"),
            _col("downLimit", "跌停价"),
            _col("tradeDate", "日期", "left"),
        ],
    },
    "ts:new_share": {
        "label": "新股",
        "table": "topic",
        "handler": "new_share",
        "columns": [
            _col("code", "代码", "left"),
            _col("name", "名称", "left"),
            _col("ipoDate", "发行日", "left"),
            _col("issueDate", "上市日", "left"),
            _col("price", "发行价"),
            _col("amount", "发行量(万)"),
            _col("marketAmount", "上网发行(万)"),
        ],
    },
    "ts:suspend": {
        "label": "停复牌",
        "table": "topic",
        "handler": "suspend",
        "columns": [
            _col("code", "代码", "left"),
            _col("name", "名称", "left"),
            _col("suspendType", "类型", "left"),
            _col("suspendTiming", "时段", "left"),
            _col("tradeDate", "日期", "left"),
        ],
    },
    "ts:sw": {
        "label": "申万行业",
        "table": "quote",
        "handler": "sw",
        "columns": QUOTE_COLS,
    },
    "ts:ths": {
        "label": "同花顺板块",
        "table": "topic",
        "handler": "ths",
        "columns": [
            _col("code", "代码", "left"),
            _col("name", "名称", "left"),
            _col("type", "类型", "left"),
            _col("count", "成分数"),
            _col("exchange", "市场", "left"),
        ],
    },
    "ts:dc": {
        "label": "东财板块",
        "table": "topic",
        "handler": "dc",
        "columns": [
            _col("code", "代码", "left"),
            _col("name", "名称", "left"),
            _col("pctChange", "涨跌幅"),
            _col("close", "收盘"),
            _col("leading", "领涨股", "left"),
            _col("amount", "成交额"),
        ],
    },
    "ts:top_list": {
        "label": "龙虎榜",
        "table": "topic",
        "handler": "top_list",
        "columns": [
            _col("code", "代码", "left"),
            _col("name", "名称", "left"),
            _col("close", "收盘"),
            _col("pctChange", "涨跌幅"),
            _col("turnoverRate", "换手"),
            _col("amount", "成交额"),
            _col("lBuy", "买入额"),
            _col("lSell", "卖出额"),
            _col("netAmount", "净买额"),
            _col("reason", "原因", "left"),
        ],
    },
    "ts:block_trade": {
        "label": "大宗交易",
        "table": "topic",
        "handler": "block_trade",
        "columns": [
            _col("code", "代码", "left"),
            _col("price", "成交价"),
            _col("vol", "成交量(万股)"),
            _col("amount", "成交额(万)"),
            _col("buyer", "买方", "left"),
            _col("seller", "卖方", "left"),
            _col("tradeDate", "日期", "left"),
        ],
    },
    "ts:margin": {
        "label": "两融汇总",
        "table": "topic",
        "handler": "margin",
        "columns": [
            _col("exchange", "交易所", "left"),
            _col("rzye", "融资余额"),
            _col("rzmre", "融资买入"),
            _col("rzche", "融资偿还"),
            _col("rqye", "融券余额"),
            _col("rqmcl", "融券卖出量"),
            _col("rzrqye", "两融余额"),
            _col("tradeDate", "日期", "left"),
        ],
    },
    "ts:margin_detail": {
        "label": "两融明细",
        "table": "topic",
        "handler": "margin_detail",
        "columns": [
            _col("code", "代码", "left"),
            _col("name", "名称", "left"),
            _col("rzye", "融资余额"),
            _col("rzmre", "融资买入"),
            _col("rzche", "融资偿还"),
            _col("rqye", "融券余额"),
            _col("rqmcl", "融券卖出"),
            _col("rzrqye", "两融余额"),
        ],
    },
    "ts:moneyflow": {
        "label": "个股资金流",
        "table": "topic",
        "handler": "moneyflow",
        "columns": [
            _col("code", "代码", "left"),
            _col("buySmAmount", "小单买"),
            _col("sellSmAmount", "小单卖"),
            _col("buyMdAmount", "中单买"),
            _col("sellMdAmount", "中单卖"),
            _col("buyLgAmount", "大单买"),
            _col("sellLgAmount", "大单卖"),
            _col("buyElgAmount", "特大买"),
            _col("sellElgAmount", "特大卖"),
            _col("netMfAmount", "净流入"),
        ],
    },
    "ts:hsgt": {
        "label": "沪深港通",
        "table": "topic",
        "handler": "hsgt",
        "columns": [
            _col("tradeDate", "日期", "left"),
            _col("ggtSs", "港股通(沪)"),
            _col("ggtSz", "港股通(深)"),
            _col("hgt", "沪股通"),
            _col("sgt", "深股通"),
            _col("northMoney", "北向合计"),
            _col("southMoney", "南向合计"),
        ],
    },
    "ts:etf": {
        "label": "ETF日线",
        "table": "quote",
        "handler": "etf",
        "columns": QUOTE_COLS,
    },
}


def find_nav_leaf(market_id: str) -> dict[str, Any] | None:
    for g in NAV_TREE:
        for c in g.get("children") or []:
            if c.get("id") == market_id:
                return c
    return None


def catalog_payload() -> dict[str, Any]:
    return {
        "tree": NAV_TREE,
        "markets": {
            mid: {
                "id": mid,
                "label": spec["label"],
                "table": spec["table"],
                "columns": spec["columns"],
            }
            for mid, spec in MARKET_SPECS.items()
        },
        "quoteColumns": QUOTE_COLS,
    }
