"""拉取美联储目标利率、有效联邦基金利率、美债名义/实际收益率。

数据源（均无需 API Key）：
- NY Fed EFFR JSON：含 targetRateFrom/To 与 percentRate
- Treasury Daily Par Yield Curve CSV：2Y/10Y/30Y 等
- Treasury Daily Real Yield Curve CSV：实际 10Y 等
"""

from __future__ import annotations

import csv
import io
import logging
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from typing import Any

_log = logging.getLogger("macro-rates")

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_NYFED_EFFR = (
    "https://markets.newyorkfed.org/read"
    "?productCode=50&eventCodes=500&limit=5&startPosition=0"
    "&sort=postDt:-1&format=json"
)

_FEDWATCH_URL = "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html"

# 进程内短缓存，避免面板轮询打爆上游
_CACHE_TTL_SEC = 300.0
_lock = threading.Lock()
_cache: dict[str, Any] = {"ts": 0.0, "payload": None}


def _http_get(url: str, timeout: float = 20.0) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": _UA,
            "Accept": "application/json,text/csv,*/*",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _year_now() -> int:
    return datetime.utcnow().year


def _treasury_csv_url(curve_type: str, year: int | None = None) -> str:
    y = year or _year_now()
    return (
        "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
        f"daily-treasury-rates.csv/{y}/all?type={curve_type}"
    )


def _parse_pct(raw: str | None) -> float | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s in {".", "N/A", "null"}:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_treasury_date(raw: str) -> str | None:
    s = (raw or "").strip()
    if not s:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return s


def _fetch_treasury_latest(curve_type: str) -> dict[str, Any]:
    """返回 {date, values: {col: pct}, source}。优先当年，空则回退上一年。"""
    years = [_year_now(), _year_now() - 1]
    last_err: Exception | None = None
    for y in years:
        url = _treasury_csv_url(curve_type, y)
        try:
            raw = _http_get(url).decode("utf-8", "replace")
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            _log.warning("treasury fetch failed %s: %s", url, exc)
            continue
        reader = csv.DictReader(io.StringIO(raw))
        rows = list(reader)
        if not rows:
            continue
        # CSV 通常最新在前
        row = rows[0]
        date = _parse_treasury_date(row.get("Date") or row.get("date") or "")
        values: dict[str, float] = {}
        for k, v in row.items():
            if not k or k.lower() == "date":
                continue
            pct = _parse_pct(v)
            if pct is not None:
                values[k.strip()] = pct
        return {"date": date, "values": values, "source": url, "year": y}
    raise RuntimeError(f"treasury curve empty: {curve_type}: {last_err}")


def _col(values: dict[str, float], *aliases: str) -> float | None:
    for a in aliases:
        if a in values:
            return values[a]
        # 宽松匹配
        for k, v in values.items():
            if k.replace(" ", "").lower() == a.replace(" ", "").lower():
                return v
    return None


def _fetch_nyfed_effr() -> dict[str, Any]:
    raw = _http_get(_NYFED_EFFR)
    import json

    data = json.loads(raw.decode("utf-8", "replace"))
    refs = data.get("refRates") or []
    if not refs:
        raise RuntimeError("NY Fed EFFR empty")
    row = refs[0]
    return {
        "date": str(row.get("effectiveDate") or "") or None,
        "effr": _parse_pct(row.get("percentRate")),
        "target_from": _parse_pct(row.get("targetRateFrom")),
        "target_to": _parse_pct(row.get("targetRateTo")),
        "volume_billions": _parse_pct(row.get("volumeInBillions")),
        "source": "https://www.newyorkfed.org/markets/reference-rates/effr",
        "raw": row,
    }


def _series(
    *,
    id: str,
    name: str,
    value: float | None,
    unit: str = "%",
    as_of: str | None,
    source: str,
    change: float | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    return {
        "id": id,
        "name": name,
        "value": value,
        "unit": unit,
        "as_of": as_of,
        "source": source,
        "change": change,
        "note": note,
    }


def build_macro_rates(force: bool = False) -> dict[str, Any]:
    """汇总宏观利率面板所需字段。"""
    now = time.time()
    with _lock:
        if (
            not force
            and _cache["payload"] is not None
            and now - float(_cache["ts"]) < _CACHE_TTL_SEC
        ):
            return dict(_cache["payload"])

    errors: list[str] = []
    nyfed: dict[str, Any] | None = None
    nominal: dict[str, Any] | None = None
    real: dict[str, Any] | None = None

    try:
        nyfed = _fetch_nyfed_effr()
    except Exception as exc:  # noqa: BLE001
        errors.append(f"nyfed:{exc}")
        _log.warning("nyfed failed: %s", exc)

    try:
        nominal = _fetch_treasury_latest("daily_treasury_yield_curve")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"treasury_nominal:{exc}")
        _log.warning("treasury nominal failed: %s", exc)

    try:
        real = _fetch_treasury_latest("daily_treasury_real_yield_curve")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"treasury_real:{exc}")
        _log.warning("treasury real failed: %s", exc)

    nvals = (nominal or {}).get("values") or {}
    rvals = (real or {}).get("values") or {}

    y2 = _col(nvals, "2 Yr", "2YR", "2 Year")
    y10 = _col(nvals, "10 Yr", "10YR", "10 Year")
    y30 = _col(nvals, "30 Yr", "30YR", "30 Year")
    y3m = _col(nvals, "3 Mo", "3MO", "3 Month")
    y5 = _col(nvals, "5 Yr", "5YR", "5 Year")
    real10 = _col(rvals, "10 YR", "10 Yr", "10YR")

    spread_10_2 = None
    if y10 is not None and y2 is not None:
        spread_10_2 = round(y10 - y2, 4)

    target_from = (nyfed or {}).get("target_from")
    target_to = (nyfed or {}).get("target_to")
    target_mid = None
    if target_from is not None and target_to is not None:
        target_mid = round((float(target_from) + float(target_to)) / 2.0, 4)

    # 粗代理：短端相对目标上沿的偏离（正=市场利率高于目标上沿）
    short_vs_target = None
    if y3m is not None and target_to is not None:
        short_vs_target = round(float(y3m) - float(target_to), 4)

    series = [
        _series(
            id="fed_target",
            name="联储目标利率",
            value=target_to,
            as_of=(nyfed or {}).get("date"),
            source=(nyfed or {}).get("source") or "",
            note=(
                f"{target_from:.2f}–{target_to:.2f}%"
                if target_from is not None and target_to is not None
                else None
            ),
        ),
        _series(
            id="effr",
            name="有效联邦基金利率",
            value=(nyfed or {}).get("effr"),
            as_of=(nyfed or {}).get("date"),
            source=(nyfed or {}).get("source") or "",
        ),
        _series(
            id="ust_3m",
            name="美债3月",
            value=y3m,
            as_of=(nominal or {}).get("date"),
            source=(nominal or {}).get("source") or "",
        ),
        _series(
            id="ust_2y",
            name="美债2年",
            value=y2,
            as_of=(nominal or {}).get("date"),
            source=(nominal or {}).get("source") or "",
        ),
        _series(
            id="ust_5y",
            name="美债5年",
            value=y5,
            as_of=(nominal or {}).get("date"),
            source=(nominal or {}).get("source") or "",
        ),
        _series(
            id="ust_10y",
            name="美债10年",
            value=y10,
            as_of=(nominal or {}).get("date"),
            source=(nominal or {}).get("source") or "",
        ),
        _series(
            id="ust_30y",
            name="美债30年",
            value=y30,
            as_of=(nominal or {}).get("date"),
            source=(nominal or {}).get("source") or "",
        ),
        _series(
            id="spread_10y2y",
            name="10Y−2Y利差",
            value=spread_10_2,
            as_of=(nominal or {}).get("date"),
            source=(nominal or {}).get("source") or "",
            note="百分点；负值=倒挂",
        ),
        _series(
            id="real_10y",
            name="实际利率10年",
            value=real10,
            as_of=(real or {}).get("date"),
            source=(real or {}).get("source") or "",
            note="TIPS 实际收益率",
        ),
    ]

    payload: dict[str, Any] = {
        "ok": True,
        "as_of": max(
            [
                d
                for d in [
                    (nyfed or {}).get("date"),
                    (nominal or {}).get("date"),
                    (real or {}).get("date"),
                ]
                if d
            ]
            or [None]
        ),
        "fetched_at": int(now),
        "cache_ttl_sec": int(_CACHE_TTL_SEC),
        "fed": {
            "target_from": target_from,
            "target_to": target_to,
            "target_mid": target_mid,
            "effr": (nyfed or {}).get("effr"),
            "date": (nyfed or {}).get("date"),
            "source": (nyfed or {}).get("source"),
        },
        "curve": {
            "ust_3m": y3m,
            "ust_2y": y2,
            "ust_5y": y5,
            "ust_10y": y10,
            "ust_30y": y30,
            "spread_10y2y": spread_10_2,
            "real_10y": real10,
            "date": (nominal or {}).get("date"),
            "real_date": (real or {}).get("date"),
        },
        "policy_expectation": {
            "provider": "CME FedWatch",
            "url": _FEDWATCH_URL,
            "note": "CME 未提供稳定免费 API；请打开官方 FedWatch 查看下次 FOMC 概率。",
            "proxy_short_vs_target_upper_bp": (
                round(short_vs_target * 100, 1) if short_vs_target is not None else None
            ),
            "proxy_note": "粗代理：美债3月 − 目标上沿（bp）。正值偏鹰定价，负值偏鸽。非 FedWatch 概率。",
        },
        "series": series,
        "errors": errors,
        "sources": {
            "nyfed": (nyfed or {}).get("source"),
            "treasury_nominal": (nominal or {}).get("source"),
            "treasury_real": (real or {}).get("source"),
            "fedwatch": _FEDWATCH_URL,
        },
    }

    # 核心字段都失败才算失败
    if nyfed is None and nominal is None:
        payload["ok"] = False

    with _lock:
        _cache["ts"] = now
        _cache["payload"] = payload

    return dict(payload)
