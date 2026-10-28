"""数据来源轨 × 市场节点对照（前后端对齐）。"""

from __future__ import annotations

from typing import Any, Literal

SourceLane = Literal["em-sina", "lazy-catalog", "yfinance", "tushare", "placeholder"]

LANE_META: dict[str, dict[str, str]] = {
    "em-sina": {"label": "东财", "title": "东财/新浪", "color": "blue"},
    "lazy-catalog": {"label": "目录", "title": "目录补价", "color": "cyan"},
    "yfinance": {"label": "Yahoo", "title": "Yahoo Finance", "color": "purple"},
    "tushare": {"label": "Tushare", "title": "Tushare 中继", "color": "amber"},
    "placeholder": {"label": "占位", "title": "二期占位", "color": "gray"},
}

EM_SINA_MARKETS = ("cn", "hk", "us")
LAZY_MARKETS = ("fund", "index", "futures")
YF_MARKETS = (
    "yf:METALS",
    "yf:COMMODITIES",
    "yf:CURRENCIES",
    "yf:CRYPTOCURRENCIES",
    "yf:RATES",
    "yf:US",
    "yf:EUROPE",
    "yf:ASIA",
    "yf:GB",
)

# Tushare P0（与 tsrelay.catalog.MARKET_SPECS 对齐；占位不含）
TUSHARE_MARKETS = (
    "ts:limit",
    "ts:stk_limit",
    "ts:suspend",
    "ts:new_share",
    "ts:sw",
    "ts:ths",
    "ts:dc",
    "ts:etf",
    "ts:cb",
    "ts:opt",
    "ts:moneyflow",
    "ts:hsgt",
    "ts:top_list",
    "ts:block_trade",
    "ts:margin",
    "ts:margin_detail",
)

LANE_MARKETS: dict[str, tuple[str, ...]] = {
    "em-sina": EM_SINA_MARKETS,
    "lazy-catalog": LAZY_MARKETS,
    "yfinance": YF_MARKETS,
    "tushare": TUSHARE_MARKETS,
}


def normalize_market_id(market_id: str) -> str:
    m = (market_id or "").strip()
    if m.lower().startswith("yf:"):
        return "yf:" + m[3:].upper()
    if m.startswith("ts:"):
        return m
    return m.lower()


def lane_of(market_id: str) -> SourceLane:
    mid = normalize_market_id(market_id)
    if mid.startswith("ts:ph:") or mid.startswith("ts:placeholder"):
        return "placeholder"
    if mid.startswith("ts:"):
        return "tushare"
    if mid.startswith("yf:"):
        return "yfinance"
    if mid in EM_SINA_MARKETS:
        return "em-sina"
    if mid in LAZY_MARKETS:
        return "lazy-catalog"
    return "placeholder"


def markets_for_lane(lane: str) -> list[str]:
    return list(LANE_MARKETS.get(lane, ()))


def catalog_payload() -> dict[str, Any]:
    lanes = []
    for lane, markets in LANE_MARKETS.items():
        meta = LANE_META[lane]
        lanes.append(
            {
                "lane": lane,
                "label": meta["label"],
                "title": meta["title"],
                "color": meta["color"],
                "markets": [{"id": m, "lane": lane} for m in markets],
            }
        )
    lanes.append(
        {
            "lane": "placeholder",
            "label": LANE_META["placeholder"]["label"],
            "title": LANE_META["placeholder"]["title"],
            "color": LANE_META["placeholder"]["color"],
            "markets": [
                {"id": "ts:ph:fina", "lane": "placeholder"},
                {"id": "ts:ph:news", "lane": "placeholder"},
                {"id": "ts:ph:macro", "lane": "placeholder"},
            ],
        }
    )
    return {"ok": True, "lanes": lanes, "laneMeta": LANE_META}
