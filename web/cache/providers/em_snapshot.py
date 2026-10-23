"""东财 clist 全市场快照（cn / hk / us）。

单位契约（与 stock-sdk 层一致）：
- 成交额 amount：万元
- 总/流通市值：亿元
- 成交量 volume：手（东财 f5）
"""

from __future__ import annotations

import http.client
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable

EM_CLIST = "https://push2.eastmoney.com/api/qt/clist/get"
# 备用节点（与 stock-sdk 类似）
EM_CLIST_MIRRORS = (
    EM_CLIST,
    "https://79.push2.eastmoney.com/api/qt/clist/get",
    "https://17.push2.eastmoney.com/api/qt/clist/get",
)

MARKET_FS = {
    "cn": "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048",
    "hk": "m:128+t:3,m:128+t:4",
    "us": "m:105,m:106,m:107",
}

# 列表行情字段
_FIELDS = (
    "f12,f13,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,"
    "f15,f16,f17,f18,f20,f21,f23"
)

_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

ProgressCb = Callable[[int, int], None]


def _http_get_json(url: str, timeout: float = 20.0) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": _BROWSER_UA,
            "Referer": "https://quote.eastmoney.com/",
            "Accept": "application/json,text/plain,*/*",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("expected json object")
    return data


def _normalize_diff(diff: Any) -> list[dict[str, Any]]:
    if isinstance(diff, list):
        return [row for row in diff if isinstance(row, dict)]
    if isinstance(diff, dict):
        return [row for row in diff.values() if isinstance(row, dict)]
    return []


def _num(v: Any) -> float | None:
    if v is None or v == "" or v == "-":
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x != x:  # NaN
        return None
    return x


def _to_kline_symbol(code: str, mkt: int, market: str) -> tuple[str, str]:
    """返回 (display_code, kline_symbol)。"""
    code = str(code or "").strip()
    if market == "us":
        ticker = code.upper()
        # 去掉交易所后缀风格（若有）
        for suf in (".OQ", ".N", ".A", ".O", ".P", ".OB", ".PK", ".OTC"):
            if ticker.endswith(suf):
                ticker = ticker[: -len(suf)]
                break
        return ticker, f"us{ticker}"
    if market == "hk":
        pure = "".join(ch for ch in code if ch.isdigit()) or code
        padded = pure.zfill(5) if pure.isdigit() else pure
        return padded, f"hk{padded}"
    # cn
    if code.startswith(("sh", "sz", "bj")):
        display = code[2:]
        return display, code
    if code.isdigit() and (code.startswith(("8", "4")) or code.startswith("92")):
        return code, f"bj{code}"
    if mkt == 1:
        return code, f"sh{code}"
    if mkt == 0:
        return code, f"sz{code}"
    return code, code


def row_from_em(row: dict[str, Any], market: str) -> dict[str, Any] | None:
    code_raw = str(row.get("f12") or "").strip()
    if not code_raw:
        return None
    try:
        mkt = int(row.get("f13") or 0)
    except (TypeError, ValueError):
        mkt = 0
    display, kline = _to_kline_symbol(code_raw, mkt, market)
    name = str(row.get("f14") or "").strip() or display

    # f6 成交额：元 → 万；f20/f21 市值：元 → 亿
    amount_yuan = _num(row.get("f6"))
    mcap_yuan = _num(row.get("f20"))
    cmcap_yuan = _num(row.get("f21"))

    return {
        "code": display,
        "name": name,
        "klineSymbol": kline,
        "quoteReady": True,
        "price": _num(row.get("f2")),
        "changePercent": _num(row.get("f3")),
        "change": _num(row.get("f4")),
        "volume": _num(row.get("f5")),
        "amount": (amount_yuan / 10000.0) if amount_yuan is not None else None,
        "amplitude": _num(row.get("f7")),
        "turnoverRate": _num(row.get("f8")),
        "pe": _num(row.get("f9")),
        "volumeRatio": _num(row.get("f10")),
        "high": _num(row.get("f15")),
        "low": _num(row.get("f16")),
        "open": _num(row.get("f17")),
        "prevClose": _num(row.get("f18")),
        "totalMarketCap": (mcap_yuan / 1e8) if mcap_yuan is not None else None,
        "circulatingMarketCap": (cmcap_yuan / 1e8) if cmcap_yuan is not None else None,
        "pb": _num(row.get("f23")),
    }


def _fetch_page(
    market: str,
    page: int,
    page_size: int,
    *,
    base_url: str,
    retries: int = 4,
) -> tuple[list[dict[str, Any]], int]:
    fs = MARKET_FS[market]
    params = {
        "pn": str(page),
        "pz": str(page_size),
        "po": "1",
        "np": "1",
        "fltt": "2",
        "invt": "2",
        "fid": "f3",
        "fs": fs,
        "fields": _FIELDS,
    }
    last_err: Exception | None = None
    data: dict[str, Any] | None = None
    mirrors = tuple(dict.fromkeys((base_url, *EM_CLIST_MIRRORS)))
    for attempt in range(retries):
        for mirror in mirrors:
            url = f"{mirror}?{urllib.parse.urlencode(params)}"
            try:
                data = _http_get_json(url, timeout=25.0)
                last_err = None
                break
            except (
                urllib.error.URLError,
                TimeoutError,
                OSError,
                json.JSONDecodeError,
                ValueError,
                http.client.HTTPException,
            ) as e:
                last_err = e
                continue
        if data is not None:
            break
        time.sleep(0.4 * (attempt + 1))
    if data is None:
        raise RuntimeError(f"clist page {page} failed: {last_err}")

    body = (data.get("data") or {}) if isinstance(data.get("data"), dict) else {}
    total = int(body.get("total") or 0)
    diff = _normalize_diff(body.get("diff"))
    rows: list[dict[str, Any]] = []
    for raw in diff:
        item = row_from_em(raw, market)
        if item:
            rows.append(item)
    return rows, total


def fetch_market_snapshot(
    market: str,
    *,
    page_size: int = 100,
    max_workers: int = 2,
    on_progress: ProgressCb | None = None,
    on_batch: Callable[[list[dict[str, Any]]], None] | None = None,
) -> tuple[list[dict[str, Any]], str]:
    """拉取全市场快照。返回 (rows, source)。

    有限并发 + 失败重试；可通过 on_batch 渐进落库（首屏不必等全量）。
    """
    market = (market or "").lower().strip()
    if market not in MARKET_FS:
        raise ValueError(f"unsupported market for em snapshot: {market}")

    first, total = _fetch_page(market, 1, page_size, base_url=EM_CLIST)
    if total <= 0 and not first:
        return [], "eastmoney"

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
            rows, _ = _fetch_page(market, pn, page_size, base_url=EM_CLIST)
            return pn, rows
        except Exception:
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
        time.sleep(0.3)
        _pn, rows = _safe(pn)
        if rows is not None:
            _absorb(rows)

    if not merged:
        raise RuntimeError(f"clist snapshot empty for {market}")
    if on_progress:
        on_progress(len(merged), len(merged))
    return merged, "eastmoney"
