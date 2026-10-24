"""新浪全市场快照兜底（东财 clist 失败时：A 股 / 基金 ETF）。"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable

ProgressCb = Callable[[int, int], None]

SINA_HQ_DATA = (
    "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
    "Market_Center.getHQNodeData"
)
SINA_HQ_COUNT = (
    "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
    "Market_Center.getHQNodeStockCount"
)

# 与 web/server.py 一致
SINA_HQ_NODE = {
    "cn": "hs_a",
    "fund": "etf_hq_fund",
}

_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


def _num(v: Any) -> float | None:
    if v is None or v == "" or v == "-":
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x != x:
        return None
    return x


def _http_get_text(url: str, *, timeout: float = 20.0) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": _BROWSER_UA,
            "Referer": "https://finance.sina.com.cn/",
            "Accept": "application/json,text/plain,*/*",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _guess_kline(code: str, symbol: str) -> tuple[str, str]:
    """返回 (display_code, klineSymbol)。"""
    code = str(code or "").strip()
    sym = str(symbol or "").strip().lower()
    if sym.startswith(("sh", "sz", "bj")):
        display = code or sym[2:]
        return display, sym
    if code.startswith(("6", "5", "9")):
        return code, f"sh{code}"
    if code.startswith(("0", "1", "2", "3")):
        return code, f"sz{code}"
    if code.startswith(("4", "8")) or code.startswith("92"):
        return code, f"bj{code}"
    return code, code


def _row_from_sina(raw: dict[str, Any]) -> dict[str, Any] | None:
    code = str(raw.get("code") or "").strip()
    sym = str(raw.get("symbol") or "").strip()
    if not code and not sym:
        return None
    display, kline = _guess_kline(code, sym)
    name = str(raw.get("name") or "").strip() or display

    # 新浪 amount 多为元；mktcap/nmc 多为万元
    amount_yuan = _num(raw.get("amount"))
    mktcap_wan = _num(raw.get("mktcap"))
    nmc_wan = _num(raw.get("nmc"))

    return {
        "code": display,
        "name": name,
        "klineSymbol": kline,
        "quoteReady": True,
        "price": _num(raw.get("trade")),
        "change": _num(raw.get("pricechange")),
        "changePercent": _num(raw.get("changepercent")),
        "volume": _num(raw.get("volume")),
        "amount": (amount_yuan / 10000.0) if amount_yuan is not None else None,
        "open": _num(raw.get("open")),
        "prevClose": _num(raw.get("settlement")),
        "high": _num(raw.get("high")),
        "low": _num(raw.get("low")),
        "turnoverRate": _num(raw.get("turnoverratio")),
        "pe": _num(raw.get("per")),
        "pb": _num(raw.get("pb")),
        "totalMarketCap": (mktcap_wan / 10000.0) if mktcap_wan is not None else None,
        "circulatingMarketCap": (nmc_wan / 10000.0) if nmc_wan is not None else None,
        "amplitude": None,
        "volumeRatio": None,
    }


def _fetch_page(node: str, page: int, page_size: int) -> list[dict[str, Any]]:
    params = {
        "page": str(page),
        "num": str(page_size),
        "sort": "changepercent",
        "asc": "0",
        "node": node,
        "symbol": "",
        "_s_r_a": "page",
    }
    raw = _http_get_text(f"{SINA_HQ_DATA}?{urllib.parse.urlencode(params)}")
    rows = json.loads(raw) if raw.strip() else []
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    for item in rows:
        if isinstance(item, dict):
            mapped = _row_from_sina(item)
            if mapped:
                out.append(mapped)
    return out


def _node_total(node: str) -> int:
    raw = _http_get_text(
        f"{SINA_HQ_COUNT}?{urllib.parse.urlencode({'node': node})}"
    ).strip().strip('"')
    try:
        return int(raw or 0)
    except ValueError:
        return 0


def fetch_sina_market_snapshot(
    market: str,
    *,
    page_size: int = 80,
    max_workers: int = 2,
    on_progress: ProgressCb | None = None,
    on_batch: Callable[[list[dict[str, Any]]], None] | None = None,
) -> tuple[list[dict[str, Any]], str]:
    """拉取新浪节点全量。返回 (rows, source='sina')。"""
    market = (market or "").lower().strip()
    node = SINA_HQ_NODE.get(market)
    if not node:
        raise ValueError(f"no sina snapshot for market: {market}")

    total = _node_total(node)
    first = _fetch_page(node, 1, page_size)
    if total <= 0:
        total = len(first)
    if not first and total <= 0:
        return [], "sina"

    pages = max(1, (total + page_size - 1) // page_size)
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _absorb(rows: list[dict[str, Any]]) -> None:
        fresh: list[dict[str, Any]] = []
        for row in rows:
            key = str(row["code"])
            if key in seen:
                continue
            seen.add(key)
            merged.append(row)
            fresh.append(row)
        if fresh and on_batch:
            on_batch(fresh)
        if on_progress:
            on_progress(len(merged), max(total, len(merged)))

    _absorb(first)

    failed: list[int] = []

    def _safe(pn: int) -> tuple[int, list[dict[str, Any]] | None]:
        try:
            return pn, _fetch_page(node, pn, page_size)
        except (
            urllib.error.URLError,
            TimeoutError,
            OSError,
            json.JSONDecodeError,
            ValueError,
        ):
            return pn, None

    if pages > 1:
        with ThreadPoolExecutor(max_workers=max(1, max_workers)) as pool:
            futs = [pool.submit(_safe, pn) for pn in range(2, pages + 1)]
            for fut in as_completed(futs):
                pn, rows = fut.result()
                if rows is None:
                    failed.append(pn)
                    continue
                _absorb(rows)

    for pn in failed:
        time.sleep(0.25)
        _pn, rows = _safe(pn)
        if rows is not None:
            _absorb(rows)

    if not merged:
        raise RuntimeError(f"sina snapshot empty for {market}")
    if on_progress:
        on_progress(len(merged), len(merged))
    return merged, "sina"
