"""腾讯财经批量行情兜底（A 股：东财 clist 失败时，按已知代码表补价）。

对齐 a-share-heatmap `qt.gtimg.cn/q=` 解析；单位契约与 sdk / em_snapshot 一致：
- 成交额 amount：万元
- 总/流通市值：亿元
- 成交量 volume：手
"""

from __future__ import annotations

import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable

ProgressCb = Callable[[int, int], None]

TENCENT_QUOTE_URL = "https://qt.gtimg.cn/q="

_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

_QUOTE_RE = re.compile(r'v_((?:sh|sz|bj)\d{6})="([^"]*)";')


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


def _to_tencent_symbol(row: dict[str, Any]) -> str | None:
    """从上一份快照行得到腾讯/新浪风格代码 sh600036。"""
    kline = str(row.get("klineSymbol") or "").strip().lower()
    if re.fullmatch(r"(?:sh|sz|bj)\d{6}", kline):
        return kline
    code = str(row.get("code") or "").strip()
    if not re.fullmatch(r"\d{6}", code):
        return None
    if code.startswith(("8", "4")) or code.startswith("92"):
        return f"bj{code}"
    if code.startswith(("5", "6", "9")):
        return f"sh{code}"
    return f"sz{code}"


def _http_get_gbk(url: str, *, timeout: float = 12.0) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": _BROWSER_UA,
            "Referer": "https://gu.qq.com/",
            "Accept": "*/*",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("gbk", errors="replace")


def _row_from_tencent(
    symbol: str,
    fields: list[str],
    *,
    seed: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    if len(fields) <= 45:
        return None
    price = _num(fields[3])
    if price is None or price <= 0:
        return None

    prev_close = _num(fields[4])
    change_pct = _num(fields[32])
    if change_pct is None and prev_close and prev_close > 0:
        change_pct = (price - prev_close) / prev_close * 100.0
    change = _num(fields[31])
    if change is None and prev_close is not None:
        change = price - prev_close

    # 37 / 57：成交额（万元）；heatmap 用 万×10000→元，这里直接落万元
    amount_wan = _num(fields[57]) if len(fields) > 57 else None
    if amount_wan is None:
        amount_wan = _num(fields[37]) if len(fields) > 37 else None

    volume = _num(fields[36]) if len(fields) > 36 else None
    if volume is None:
        volume = _num(fields[6])

    name = (fields[1] or "").strip() if len(fields) > 1 else ""
    display = symbol[2:]
    seed = seed or {}

    total_mcap = _num(fields[45]) if len(fields) > 45 else None  # 亿
    circ_mcap = _num(fields[44]) if len(fields) > 44 else None

    return {
        "code": display,
        "name": name or str(seed.get("name") or display),
        "klineSymbol": symbol,
        "quoteReady": True,
        "price": price,
        "changePercent": change_pct,
        "change": change,
        "volume": volume,
        "amount": amount_wan,
        "amplitude": _num(fields[43]) if len(fields) > 43 else seed.get("amplitude"),
        "turnoverRate": _num(fields[38]) if len(fields) > 38 else seed.get("turnoverRate"),
        "pe": _num(fields[39]) if len(fields) > 39 else seed.get("pe"),
        "volumeRatio": _num(fields[49]) if len(fields) > 49 else seed.get("volumeRatio"),
        "high": _num(fields[33]) if len(fields) > 33 else seed.get("high"),
        "low": _num(fields[34]) if len(fields) > 34 else seed.get("low"),
        "open": _num(fields[5]) if len(fields) > 5 else seed.get("open"),
        "prevClose": prev_close if prev_close is not None else seed.get("prevClose"),
        "totalMarketCap": total_mcap if total_mcap is not None else seed.get("totalMarketCap"),
        "circulatingMarketCap": circ_mcap
        if circ_mcap is not None
        else seed.get("circulatingMarketCap"),
        "pb": _num(fields[46]) if len(fields) > 46 else seed.get("pb"),
    }


def _fetch_batch(symbols: list[str]) -> dict[str, list[str]]:
    if not symbols:
        return {}
    url = TENCENT_QUOTE_URL + ",".join(symbols)
    raw = _http_get_gbk(url)
    out: dict[str, list[str]] = {}
    for m in _QUOTE_RE.finditer(raw):
        sym = m.group(1)
        fields = m.group(2).split("~")
        out[sym] = fields
    return out


def fetch_tencent_cn_snapshot(
    seed_rows: list[dict[str, Any]],
    *,
    batch_size: int = 300,
    max_workers: int = 4,
    min_coverage: float = 0.9,
    on_progress: ProgressCb | None = None,
    on_batch: Callable[[list[dict[str, Any]]], None] | None = None,
) -> tuple[list[dict[str, Any]], str]:
    """按已知代码表批量拉腾讯行情。返回 (rows, source='tencent')。

    seed_rows 通常来自上一份 SQLite 快照；无代码表时直接失败，交给新浪。
    """
    seed_by_sym: dict[str, dict[str, Any]] = {}
    symbols: list[str] = []
    for row in seed_rows:
        if not isinstance(row, dict):
            continue
        sym = _to_tencent_symbol(row)
        if not sym or sym in seed_by_sym:
            continue
        seed_by_sym[sym] = row
        symbols.append(sym)

    if not symbols:
        raise RuntimeError("tencent snapshot: no seed codes")

    batches = [
        symbols[i : i + batch_size] for i in range(0, len(symbols), batch_size)
    ]
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    total = len(symbols)

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
            on_progress(len(merged), total)

    def _safe(batch: list[str]) -> list[dict[str, Any]]:
        try:
            parsed = _fetch_batch(batch)
        except (
            urllib.error.URLError,
            TimeoutError,
            OSError,
            ValueError,
        ):
            return []
        rows: list[dict[str, Any]] = []
        for sym in batch:
            fields = parsed.get(sym)
            if not fields:
                continue
            item = _row_from_tencent(sym, fields, seed=seed_by_sym.get(sym))
            if item:
                rows.append(item)
        return rows

    if on_progress:
        on_progress(0, total)

    with ThreadPoolExecutor(max_workers=max(1, max_workers)) as pool:
        futs = [pool.submit(_safe, b) for b in batches]
        for fut in as_completed(futs):
            _absorb(fut.result())

    coverage = len(merged) / float(total) if total else 0.0
    if coverage < min_coverage:
        raise RuntimeError(
            f"tencent snapshot incomplete: {len(merged)}/{total} ({coverage:.0%})"
        )
    if on_progress:
        on_progress(len(merged), len(merged))
    # 轻微停顿，避免连续失败重试打爆接口
    time.sleep(0.01)
    return merged, "tencent"
