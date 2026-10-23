"""基金 / 指数 / 期货 / yfinance：目录入库，并尽量补齐报价。"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from cache.providers.em_snapshot import (
    EM_CLIST,
    _http_get_json,
    _normalize_diff,
    row_from_em,
)

_DASHBOARD_DATA = (
    Path(__file__).resolve().parents[3]
    / "vendor"
    / "stock-dashboard"
    / "src"
    / "data"
)

# 东财期货市场 id（主连）
_EXCHANGE_MID = {
    "SHFE": 113,
    "DCE": 114,
    "CZCE": 115,
    "CFFEX": 8,
    "INE": 142,
    "GFEX": 225,
}

_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


def _load_json(name: str) -> list[dict[str, Any]]:
    path = _DASHBOARD_DATA / name
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else []


def _empty_row(*, code: str, name: str, kline_symbol: str) -> dict[str, Any]:
    return {
        "code": code,
        "name": name,
        "klineSymbol": kline_symbol,
        "quoteReady": False,
        "price": None,
        "change": None,
        "changePercent": None,
        "volume": None,
        "amount": None,
        "pb": None,
        "pe": None,
        "totalMarketCap": None,
        "circulatingMarketCap": None,
        "open": None,
        "prevClose": None,
        "high": None,
        "low": None,
        "turnoverRate": None,
        "volumeRatio": None,
        "amplitude": None,
    }


def catalog_index() -> list[dict[str, Any]]:
    rows = []
    for item in _load_json("indexCatalog.json"):
        code = str(item.get("code") or "")
        symbol = str(item.get("symbol") or code)
        name = str(item.get("name") or code)
        rows.append(_empty_row(code=code, name=name, kline_symbol=symbol))
    return rows


def catalog_futures() -> list[dict[str, Any]]:
    rows = []
    for item in _load_json("futuresCatalog.json"):
        sym = str(item.get("symbol") or "")
        name = str(item.get("name") or sym)
        row = _empty_row(code=sym, name=name, kline_symbol=f"fut:{sym}")
        row["_exchange"] = str(item.get("exchange") or "SHFE")
        rows.append(row)
    return rows


def _http_json(url: str, *, timeout: float = 12.0) -> dict[str, Any]:
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
        raise ValueError("expected object")
    return data


def _futures_last_bar(symbol: str, exchange: str) -> dict[str, Any] | None:
    """东财日 K 末根 → 列表行情字段。"""
    mid = _EXCHANGE_MID.get((exchange or "SHFE").upper(), 113)
    secid = f"{mid}.{symbol}"
    params = {
        "secid": secid,
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
        "klt": "101",
        "fqt": "1",
        "end": "20500101",
        "lmt": "3",
    }
    url = "https://push2his.eastmoney.com/api/qt/stock/kline/get?" + urllib.parse.urlencode(
        params
    )
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            data = _http_json(url)
            body = data.get("data") if isinstance(data.get("data"), dict) else {}
            klines = body.get("klines") if isinstance(body, dict) else None
            if not isinstance(klines, list) or not klines:
                return None
            # date,open,close,high,low,volume,amount,amplitude,changePercent,change,turnover
            parts = str(klines[-1]).split(",")
            if len(parts) < 10:
                return None
            open_p = float(parts[1])
            close_p = float(parts[2])
            high_p = float(parts[3])
            low_p = float(parts[4])
            volume = float(parts[5])
            amount_yuan = float(parts[6]) if parts[6] not in ("", "-") else None
            amplitude = float(parts[7]) if parts[7] not in ("", "-") else None
            change_pct = float(parts[8]) if parts[8] not in ("", "-") else None
            change_amt = float(parts[9]) if parts[9] not in ("", "-") else None
            name = str(body.get("name") or symbol)
            prev = (
                (close_p - change_amt)
                if change_amt is not None
                else None
            )
            return {
                "name": name,
                "price": close_p,
                "open": open_p,
                "high": high_p,
                "low": low_p,
                "volume": volume,
                "amount": (amount_yuan / 10000.0) if amount_yuan is not None else None,
                "amplitude": amplitude,
                "changePercent": change_pct,
                "change": change_amt,
                "prevClose": prev,
                "quoteReady": True,
            }
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError) as e:
            last_err = e
            time.sleep(0.25 * (attempt + 1))
    if last_err:
        return None
    return None


def enrich_futures_quotes(
    rows: list[dict[str, Any]],
    *,
    max_workers: int = 4,
) -> list[dict[str, Any]]:
    """为期货目录批量补最近日 K 报价。"""
    out = [dict(r) for r in rows]

    def _one(idx: int, row: dict[str, Any]) -> tuple[int, dict[str, Any] | None]:
        sym = str(row.get("code") or "")
        ex = str(row.get("_exchange") or "SHFE")
        patch = _futures_last_bar(sym, ex)
        return idx, patch

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futs = [pool.submit(_one, i, row) for i, row in enumerate(out)]
        for fut in as_completed(futs):
            idx, patch = fut.result()
            if not patch:
                continue
            row = out[idx]
            row.update(patch)
            row.pop("_exchange", None)
            row["quoteReady"] = True
    for row in out:
        row.pop("_exchange", None)
    return out


def merge_keep_quotes(
    fresh: list[dict[str, Any]],
    previous: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """新目录优先；若新行无价则保留旧快照报价，避免 sync 把已填行情冲掉。"""
    prev_by = {str(r.get("code")): r for r in previous}
    merged: list[dict[str, Any]] = []
    for row in fresh:
        code = str(row.get("code") or "")
        old = prev_by.get(code)
        item = dict(row)
        item.pop("_exchange", None)
        if item.get("price") is None and old and old.get("price") is not None:
            for k in (
                "price",
                "change",
                "changePercent",
                "open",
                "prevClose",
                "high",
                "low",
                "volume",
                "amount",
                "amplitude",
                "turnoverRate",
                "volumeRatio",
                "pe",
                "pb",
                "totalMarketCap",
                "circulatingMarketCap",
                "quoteReady",
            ):
                if old.get(k) is not None:
                    item[k] = old.get(k)
            if item.get("quoteReady") is None:
                item["quoteReady"] = True
        merged.append(item)
    return merged


def catalog_yf(market: str) -> list[dict[str, Any]]:
    """优先走现有 yf 列表；失败则静态目录。"""
    m = (market or "").upper().strip()
    if m.startswith("YF:"):
        m = m[3:]

    try:
        import server as srv

        items, _live = srv._yf_items_cached(m, force=False)
    except Exception:
        from yf_catalog import catalog_items

        items = catalog_items(m)

    rows: list[dict[str, Any]] = []
    for it in items:
        code = str(it.get("code") or "").strip()
        if not code:
            sym = str(it.get("symbol") or "").replace("yf:", "").strip()
            code = sym
        if not code:
            continue
        price = it.get("price")
        row = _empty_row(
            code=code,
            name=str(it.get("name") or code),
            kline_symbol=f"yf:{code}",
        )
        if price is not None:
            row["price"] = price
            row["change"] = it.get("change")
            row["changePercent"] = it.get("changePercent")
            row["quoteReady"] = True
        rows.append(row)
    return rows


def enrich_yf_quotes(
    rows: list[dict[str, Any]],
    *,
    force: bool = False,
    max_workers: int = 6,
) -> list[dict[str, Any]]:
    """用现有 yfinance 日 K 推导补齐缺失报价。"""
    try:
        import server as srv
    except Exception:
        return rows

    out = [dict(r) for r in rows]
    need_idx = [
        i
        for i, r in enumerate(out)
        if force or not r.get("quoteReady") or r.get("price") is None
    ]
    if not need_idx:
        return out

    def _one(i: int) -> tuple[int, dict[str, Any] | None]:
        code = str(out[i].get("code") or "")
        try:
            q = srv._yf_quote_from_bars(code, force=force)
        except Exception:
            return i, None
        return i, q

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futs = [pool.submit(_one, i) for i in need_idx]
        for fut in as_completed(futs):
            i, q = fut.result()
            if not q:
                continue
            row = out[i]
            row["name"] = str(q.get("name") or row.get("name") or row.get("code"))
            row["price"] = q.get("price")
            row["change"] = q.get("change")
            row["changePercent"] = q.get("changePercent")
            row["open"] = q.get("open")
            row["prevClose"] = q.get("prevClose")
            row["high"] = q.get("high")
            row["low"] = q.get("low")
            row["volume"] = q.get("volume")
            row["amount"] = q.get("amount")
            row["amplitude"] = q.get("amplitude")
            row["quoteReady"] = row.get("price") is not None
    return out


def fetch_fund_snapshot(*, max_pages: int = 30, page_size: int = 100) -> list[dict[str, Any]]:
    """东财场内基金列表（带部分行情字段）。"""
    fs = "m:0+t:1"
    fields = (
        "f12,f13,f14,f2,f3,f4,f5,f6,f7,f8,f9,f10,"
        "f15,f16,f17,f18,f20,f21,f23"
    )

    def _page(pn: int) -> tuple[list[dict[str, Any]], int]:
        params = {
            "pn": str(pn),
            "pz": str(page_size),
            "po": "1",
            "np": "1",
            "fltt": "2",
            "invt": "2",
            "fid": "f3",
            "fs": fs,
            "fields": fields,
        }
        data = _http_get_json(f"{EM_CLIST}?{urllib.parse.urlencode(params)}")
        body = (data.get("data") or {}) if isinstance(data.get("data"), dict) else {}
        total = int(body.get("total") or 0)
        diff = _normalize_diff(body.get("diff"))
        out: list[dict[str, Any]] = []
        for raw in diff:
            item = row_from_em(raw, "cn")
            if not item:
                continue
            code = str(raw.get("f12") or item["code"])
            item["code"] = code
            item["klineSymbol"] = code
            item["quoteReady"] = item.get("price") is not None
            out.append(item)
        return out, total

    first, total = _page(1)
    pages = max(1, (total + page_size - 1) // page_size) if total else 1
    pages = min(pages, max_pages)
    merged = list(first)
    seen = {r["code"] for r in first}
    for pn in range(2, pages + 1):
        try:
            rows, _ = _page(pn)
        except Exception:
            break
        for r in rows:
            if r["code"] in seen:
                continue
            seen.add(r["code"])
            merged.append(r)
    return merged
