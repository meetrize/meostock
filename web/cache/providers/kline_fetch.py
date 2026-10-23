"""K 线拉取：规范化符号 + Yahoo / 东财 / 期货。"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

_EXCHANGE_MID = {
    "SHFE": 113,
    "DCE": 114,
    "CZCE": 115,
    "CFFEX": 8,
    "INE": 142,
    "GFEX": 225,
}

# 与 index.html HISTORY / 分钟约定对齐的 period 归一
_PERIOD_ALIAS = {
    "fs": "1m",
    "daily": "1d",
    "weekly": "1w",
    "monthly": "1M",
}


def normalize_period(period: str) -> str:
    p = (period or "1d").strip().lower()
    return _PERIOD_ALIAS.get(p, p)


def normalize_symbol(raw: str) -> dict[str, str]:
    """
    返回 { market, symbol, display, yf_symbol? }。
    market: cn|hk|us|yf|futures
    symbol: 库内主键（cn 带 sh/sz/bj；us 为 ticker；hk 为 5 位；yf 为 Yahoo 代码；futures 为主连码）
    """
    s = (raw or "").strip()
    if not s:
        raise ValueError("empty symbol")

    if re.match(r"^yf:", s, re.I):
        code = s[3:].strip()
        return {"market": "yf", "symbol": code, "display": f"yf:{code}", "yf_symbol": code}

    if re.match(r"^fut:", s, re.I):
        code = s[4:].strip().upper()
        return {"market": "futures", "symbol": code, "display": f"fut:{code}"}

    low = s.lower()
    if low.startswith("us"):
        ticker = s[2:].upper()
        ticker = re.sub(r"\.(OQ|N|A|O|P|OB|PK|OTC)$", "", ticker, flags=re.I)
        return {"market": "us", "symbol": ticker, "display": f"us{ticker}", "yf_symbol": ticker}

    if low.startswith("hk"):
        pure = re.sub(r"\D", "", s[2:]) or s[2:]
        padded = pure.zfill(5) if pure.isdigit() else pure
        # Yahoo 港股多为 4 位：00700 → 0700.HK
        if padded.isdigit():
            yf = f"{str(int(padded)).zfill(4)}.HK"
        else:
            yf = f"{padded}.HK"
        return {
            "market": "hk",
            "symbol": padded,
            "display": f"hk{padded}",
            "yf_symbol": yf,
        }

    if low.startswith(("sh", "sz", "bj")):
        return {"market": "cn", "symbol": low, "display": low}

    # 裸代码
    if re.fullmatch(r"\d{6}", s):
        if s.startswith(("5", "6", "9")):
            sym = f"sh{s}"
        elif s.startswith(("4", "8")) or s.startswith("92"):
            sym = f"bj{s}"
        else:
            sym = f"sz{s}"
        return {"market": "cn", "symbol": sym, "display": sym}

    # 期货主连常见：字母+M
    if re.fullmatch(r"[A-Za-z]{1,3}M", s):
        code = s.upper()
        return {"market": "futures", "symbol": code, "display": f"fut:{code}"}

    # 默认当美股 ticker
    ticker = re.sub(r"\.(OQ|N|A|O|P|OB|PK|OTC)$", "", s.upper(), flags=re.I)
    return {"market": "us", "symbol": ticker, "display": f"us{ticker}", "yf_symbol": ticker}


def _http_json(url: str, *, timeout: float = 20.0) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": _BROWSER_UA,
            "Referer": "https://quote.eastmoney.com/",
            "Accept": "application/json,*/*",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("expected object")
    return data


def fetch_yf_bars(yf_symbol: str, period: str) -> tuple[list[dict[str, Any]], str]:
    """复用 server 侧 Yahoo 逻辑。"""
    import server as srv

    bars = srv._yf_history_bars(yf_symbol, period=period)
    name = ""
    try:
        from yf_catalog import translate_name

        name = translate_name(yf_symbol)
    except Exception:
        name = yf_symbol
    return bars, name


def _cn_secid(symbol: str) -> str:
    s = symbol.lower()
    code = s[2:] if s.startswith(("sh", "sz", "bj")) else s
    if s.startswith("sh"):
        return f"1.{code}"
    if s.startswith("sz"):
        return f"0.{code}"
    if s.startswith("bj"):
        return f"0.{code}"
    # 兜底
    if code.startswith(("5", "6", "9")):
        return f"1.{code}"
    return f"0.{code}"


def _em_klt(period: str) -> str:
    # 101日 102周 103月；分钟 1/5/15/60
    m = {
        "1d": "101",
        "1w": "102",
        "1M": "103",
        "1m": "1",
        "5m": "5",
        "15m": "15",
        "1h": "60",
    }
    return m.get(period, "101")


def fetch_cn_bars(symbol: str, period: str) -> tuple[list[dict[str, Any]], str]:
    secid = _cn_secid(symbol)
    klt = _em_klt(period)
    params = {
        "secid": secid,
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
        "klt": klt,
        "fqt": "1",
        "end": "20500101",
        "lmt": "500",
    }
    url = "https://push2his.eastmoney.com/api/qt/stock/kline/get?" + urllib.parse.urlencode(
        params
    )
    last_err: Exception | None = None
    data: dict[str, Any] | None = None
    for attempt in range(3):
        try:
            data = _http_json(url)
            break
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError) as e:
            last_err = e
            time.sleep(0.3 * (attempt + 1))
    if data is None:
        raise RuntimeError(f"eastmoney kline failed: {last_err}")

    body = data.get("data") if isinstance(data.get("data"), dict) else {}
    name = str((body or {}).get("name") or symbol)
    klines = (body or {}).get("klines") if isinstance(body, dict) else None
    if not isinstance(klines, list) or not klines:
        return [], name

    bars: list[dict[str, Any]] = []
    for line in klines:
        parts = str(line).split(",")
        if len(parts) < 6:
            continue
        # date, open, close, high, low, volume, amount, ...
        try:
            from datetime import datetime
            from zoneinfo import ZoneInfo

            day = parts[0]
            if len(day) == 10:  # YYYY-MM-DD
                dt = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=ZoneInfo("Asia/Shanghai"))
                ts = int(dt.timestamp() * 1000)
            else:
                # YYYY-MM-DD HH:MM
                dt = datetime.strptime(day[:16], "%Y-%m-%d %H:%M").replace(
                    tzinfo=ZoneInfo("Asia/Shanghai")
                )
                ts = int(dt.timestamp() * 1000)
            bars.append(
                {
                    "timestamp": ts,
                    "open": float(parts[1]),
                    "close": float(parts[2]),
                    "high": float(parts[3]),
                    "low": float(parts[4]),
                    "volume": float(parts[5]),
                    "amount": float(parts[6]) if len(parts) > 6 and parts[6] not in ("", "-") else None,
                }
            )
        except Exception:
            continue
    return bars, name


def _futures_exchange(symbol: str) -> str:
    try:
        from cache.providers.lazy_markets import _load_json

        for item in _load_json("futuresCatalog.json"):
            if str(item.get("symbol") or "").upper() == symbol.upper():
                return str(item.get("exchange") or "SHFE")
    except Exception:
        pass
    return "SHFE"


def fetch_futures_bars(symbol: str, period: str) -> tuple[list[dict[str, Any]], str]:
    # 期货 SDK/东财：日/周；分钟回退日线
    p = period if period in ("1d", "1w", "1M") else "1d"
    mid = _EXCHANGE_MID.get(_futures_exchange(symbol), 113)
    secid = f"{mid}.{symbol.upper()}"
    klt = _em_klt(p)
    params = {
        "secid": secid,
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
        "klt": klt,
        "fqt": "1",
        "end": "20500101",
        "lmt": "500",
    }
    url = "https://push2his.eastmoney.com/api/qt/stock/kline/get?" + urllib.parse.urlencode(
        params
    )
    data = None
    last_err = None
    for attempt in range(3):
        try:
            data = _http_json(url)
            break
        except Exception as e:
            last_err = e
            time.sleep(0.3 * (attempt + 1))
    if data is None:
        raise RuntimeError(f"futures kline failed: {last_err}")
    body = data.get("data") if isinstance(data.get("data"), dict) else {}
    name = str((body or {}).get("name") or symbol)
    klines = (body or {}).get("klines") if isinstance(body, dict) else None
    if not isinstance(klines, list):
        return [], name
    bars: list[dict[str, Any]] = []
    from datetime import datetime
    from zoneinfo import ZoneInfo

    for line in klines:
        parts = str(line).split(",")
        if len(parts) < 6:
            continue
        try:
            day = parts[0]
            dt = datetime.strptime(day[:10], "%Y-%m-%d").replace(tzinfo=ZoneInfo("Asia/Shanghai"))
            bars.append(
                {
                    "timestamp": int(dt.timestamp() * 1000),
                    "open": float(parts[1]),
                    "close": float(parts[2]),
                    "high": float(parts[3]),
                    "low": float(parts[4]),
                    "volume": float(parts[5]),
                    "amount": float(parts[6]) if len(parts) > 6 and parts[6] not in ("", "-") else None,
                }
            )
        except Exception:
            continue
    return bars, name


def fetch_kline_bars(norm: dict[str, str], period: str) -> tuple[list[dict[str, Any]], str, str]:
    """
    返回 (bars, name, source)。
    """
    period = normalize_period(period)
    market = norm["market"]
    symbol = norm["symbol"]

    if market in ("us", "hk", "yf"):
        yf_sym = norm.get("yf_symbol") or symbol
        bars, name = fetch_yf_bars(yf_sym, period)
        return bars, name, "yahoo"

    if market == "cn":
        bars, name = fetch_cn_bars(symbol, period)
        return bars, name, "eastmoney"

    if market == "futures":
        bars, name = fetch_futures_bars(symbol, period)
        return bars, name, "eastmoney"

    raise ValueError(f"unsupported market: {market}")
