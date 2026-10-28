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
    import http.client

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": _BROWSER_UA,
            "Referer": "https://quote.eastmoney.com/",
            "Accept": "application/json,text/plain,*/*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Connection": "close",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except http.client.RemoteDisconnected as e:
        raise urllib.error.URLError(str(e)) from e
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("expected object")
    return data


def _cn_to_yahoo(symbol: str) -> str:
    """sz300298 → 300298.SZ；sh600036 → 600036.SS；bj/92xxxx → .BJ（勿把 92 当成沪市 9xx）"""
    s = (symbol or "").lower().strip()
    code = s[2:] if s.startswith(("sh", "sz", "bj")) else s
    code = re.sub(r"\D", "", code) or code
    # 北交所优先：bj 前缀 / 4、8 开头 / 92 开头
    if s.startswith("bj") or code.startswith(("4", "8")) or code.startswith("92"):
        return f"{code}.BJ"
    if s.startswith("sh") or code.startswith(("5", "6", "9")):
        return f"{code}.SS"
    return f"{code}.SZ"


def _cn_sina_symbol(symbol: str) -> str:
    """东财/库内 sh|sz|bj 代码 → 新浪 symbol（bj920839 / sh600036）。"""
    s = (symbol or "").lower().strip()
    if s.startswith(("sh", "sz", "bj")):
        return s
    code = re.sub(r"\D", "", s) or s
    if code.startswith(("4", "8")) or code.startswith("92"):
        return f"bj{code}"
    if code.startswith(("5", "6", "9")):
        return f"sh{code}"
    return f"sz{code}"


def _sina_scale(period: str) -> int:
    # 新浪：5/15/30/60 分钟；240 日；1200 周；7200 月
    m = {
        "fs": 5,
        "1m": 5,
        "5m": 5,
        "15m": 15,
        "1h": 60,
        "1d": 240,
        "1w": 1200,
        "1M": 7200,
    }
    return m.get(period, 240)


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


_EM_KLINE_HOSTS = (
    "push2his.eastmoney.com",
    "82.push2his.eastmoney.com",
    "91.push2his.eastmoney.com",
    "push2delay.eastmoney.com",
)


def fetch_cn_bars_eastmoney(symbol: str, period: str) -> tuple[list[dict[str, Any]], str]:
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
    qs = urllib.parse.urlencode(params)
    last_err: Exception | None = None
    data: dict[str, Any] | None = None
    for host in _EM_KLINE_HOSTS:
        url = f"https://{host}/api/qt/stock/kline/get?{qs}"
        for attempt in range(2):
            try:
                data = _http_json(url, timeout=12.0)
                break
            except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError) as e:
                last_err = e
                time.sleep(0.25 * (attempt + 1))
        if data is not None:
            break
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


def fetch_cn_bars_sina(symbol: str, period: str) -> tuple[list[dict[str, Any]], str]:
    """新浪 CN_MarketData.getKLineData（北交所 bj920839 可用，东财断连时的可靠回退）。"""
    sina_sym = _cn_sina_symbol(symbol)
    scale = _sina_scale(period)
    # 日/周多要一些；分钟适量
    datalen = 500 if scale >= 240 else 320
    url = (
        "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/"
        "CN_MarketData.getKLineData?"
        + urllib.parse.urlencode(
            {
                "symbol": sina_sym,
                "scale": str(scale),
                "ma": "no",
                "datalen": str(datalen),
            }
        )
    )
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": _BROWSER_UA,
            "Referer": "https://finance.sina.com.cn/",
            "Accept": "application/json,*/*",
            "Connection": "close",
        },
        method="GET",
    )
    last_err: Exception | None = None
    raw = ""
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15.0) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            break
        except Exception as e:
            last_err = e
            time.sleep(0.25 * (attempt + 1))
    else:
        raise RuntimeError(f"sina kline failed: {last_err}")

    try:
        rows = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"sina kline bad json: {e}") from e
    if not isinstance(rows, list) or not rows:
        return [], sina_sym

    from datetime import datetime
    from zoneinfo import ZoneInfo

    bars: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        day = str(row.get("day") or "").strip()
        if not day:
            continue
        try:
            if len(day) >= 16:
                dt = datetime.strptime(day[:16], "%Y-%m-%d %H:%M").replace(
                    tzinfo=ZoneInfo("Asia/Shanghai")
                )
            else:
                dt = datetime.strptime(day[:10], "%Y-%m-%d").replace(
                    tzinfo=ZoneInfo("Asia/Shanghai")
                )
            bars.append(
                {
                    "timestamp": int(dt.timestamp() * 1000),
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": float(row.get("volume") or 0),
                }
            )
        except Exception:
            continue
    bars.sort(key=lambda b: b["timestamp"])
    return bars, sina_sym


def fetch_cn_spot(symbol: str) -> dict[str, Any] | None:
    """
    抓取 A 股实时行情，用于把「今日未收盘 K」补进日线。
    返回 {name, open, high, low, close, volume, prev_close, date}（上海日历日）。
    """
    from datetime import date, datetime
    from zoneinfo import ZoneInfo

    sina_sym = _cn_sina_symbol(symbol)
    # 1) 新浪 hq
    try:
        url = f"https://hq.sinajs.cn/list={sina_sym}"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": _BROWSER_UA,
                "Referer": "https://finance.sina.com.cn/",
                "Connection": "close",
            },
        )
        with urllib.request.urlopen(req, timeout=8.0) as resp:
            raw = resp.read().decode("gbk", errors="replace")
        # var hq_str_sz002535="名,今开,昨收,现价,最高,最低,...,成交量,成交额,..."
        m = re.search(r'="([^"]*)"', raw)
        if m and m.group(1):
            parts = m.group(1).split(",")
            if len(parts) >= 9:
                price = float(parts[3])
                if price > 0:
                    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
                    # 字段 30/31 常为日期；缺省用今天
                    qdate = today
                    if len(parts) > 30 and re.match(r"\d{4}-\d{2}-\d{2}", parts[30] or ""):
                        try:
                            qdate = date.fromisoformat(parts[30])
                        except Exception:
                            pass
                    return {
                        "name": parts[0],
                        "open": float(parts[1]) or price,
                        "prev_close": float(parts[2]) or price,
                        "close": price,
                        "high": float(parts[4]) or price,
                        "low": float(parts[5]) or price,
                        "volume": float(parts[8] or 0),
                        "date": qdate,
                    }
    except Exception:
        pass

    # 2) 东财 push2
    try:
        secid = _cn_secid(symbol)
        url = (
            "https://push2.eastmoney.com/api/qt/stock/get?"
            + urllib.parse.urlencode(
                {
                    "secid": secid,
                    "fields": "f43,f44,f45,f46,f47,f48,f57,f58,f60",
                }
            )
        )
        data = _http_json(url, timeout=8.0)
        body = data.get("data") if isinstance(data.get("data"), dict) else None
        if body and body.get("f43") not in (None, "-"):
            # 价格字段多为「元 × 100」整数
            def _p(v: Any) -> float:
                n = float(v)
                return n / 100.0 if abs(n) >= 50 else n

            price = _p(body["f43"])
            if price > 0:
                return {
                    "name": str(body.get("f58") or symbol),
                    "open": _p(body.get("f46") or price),
                    "prev_close": _p(body.get("f60") or price),
                    "close": price,
                    "high": _p(body.get("f44") or price),
                    "low": _p(body.get("f45") or price),
                    "volume": float(body.get("f47") or 0),
                    "date": datetime.now(ZoneInfo("Asia/Shanghai")).date(),
                }
    except Exception:
        pass
    return None


def merge_cn_today_daily_bar(
    bars: list[dict[str, Any]], spot: dict[str, Any] | None
) -> list[dict[str, Any]]:
    """用实时行情补/改今日日 K（新浪历史常缺未收盘当日）。"""
    if not bars or not spot:
        return bars
    from datetime import datetime
    from zoneinfo import ZoneInfo

    qdate = spot.get("date")
    if qdate is None:
        return bars
    ts = int(
        datetime(qdate.year, qdate.month, qdate.day, tzinfo=ZoneInfo("Asia/Shanghai")).timestamp()
        * 1000
    )
    today_bar = {
        "timestamp": ts,
        "open": float(spot["open"]),
        "high": float(spot["high"]),
        "low": float(spot["low"]),
        "close": float(spot["close"]),
        "volume": float(spot.get("volume") or 0),
    }
    last_ts = int(bars[-1]["timestamp"])
    last_day = datetime.fromtimestamp(last_ts / 1000.0, tz=ZoneInfo("Asia/Shanghai")).date()
    if last_day == qdate:
        # 合并高低：防止盘中回写把盘中极值抹掉
        prev = bars[-1]
        bars[-1] = {
            "timestamp": ts,
            "open": float(prev.get("open") or today_bar["open"]),
            "high": max(float(prev.get("high") or 0), today_bar["high"]),
            "low": min(
                float(prev["low"]) if prev.get("low") not in (None, 0) else today_bar["low"],
                today_bar["low"],
            ),
            "close": today_bar["close"],
            "volume": today_bar["volume"] or float(prev.get("volume") or 0),
        }
    elif last_day < qdate:
        bars = list(bars) + [today_bar]
    return bars


def fetch_cn_bars(symbol: str, period: str) -> tuple[list[dict[str, Any]], str, str]:
    """A 股：东财 → 新浪（北交所友好）→ Yahoo；日线再补今日实时 K。返回 (bars, name, source)。"""
    errors: list[str] = []
    bars: list[dict[str, Any]] = []
    name = symbol
    source = "eastmoney"

    try:
        bars, name = fetch_cn_bars_eastmoney(symbol, period)
        if bars:
            source = "eastmoney"
        else:
            errors.append("eastmoney empty")
    except Exception as e:
        errors.append(f"eastmoney: {e}")
        bars = []

    if not bars:
        try:
            bars, name = fetch_cn_bars_sina(symbol, period)
            if bars:
                source = "sina"
            else:
                errors.append("sina empty")
        except Exception as e:
            errors.append(f"sina: {e}")
            bars = []

    if not bars:
        yf_sym = _cn_to_yahoo(symbol)
        try:
            bars, name = fetch_yf_bars(yf_sym, period)
            if bars:
                source = "yahoo"
                name = name or symbol
            else:
                errors.append(f"yahoo({yf_sym}) empty")
        except Exception as e:
            errors.append(f"yahoo({yf_sym}): {e}")
            bars = []

    if not bars:
        raise RuntimeError("A股 K 线不可用：" + "；".join(errors))

    # 日线：用实时行情补今日 K（解决报价 3.03 但日 K 停在昨收）
    if normalize_period(period) == "1d":
        spot = fetch_cn_spot(symbol)
        if spot:
            if spot.get("name"):
                name = spot["name"]
            bars = merge_cn_today_daily_bar(bars, spot)

    return bars, name, source


_EX_TS_SUFFIX = {
    "SHFE": "SHF",
    "DCE": "DCE",
    "CZCE": "ZCE",
    "CFFEX": "CFX",
    "INE": "INE",
    "GFEX": "GFE",
}

# 东财主连码 → 新浪连续（商品 IndexService / 股指 CffexFuturesService）
_CFFEX_PRODUCTS = {"IF", "IC", "IM", "IH", "T", "TF", "TS", "TL"}


def _futures_catalog_row(symbol: str) -> dict[str, str] | None:
    try:
        from cache.providers.lazy_markets import _load_json

        for item in _load_json("futuresCatalog.json"):
            if str(item.get("symbol") or "").upper() == symbol.upper():
                return {
                    "symbol": str(item.get("symbol") or symbol).upper(),
                    "name": str(item.get("name") or symbol),
                    "exchange": str(item.get("exchange") or "SHFE").upper(),
                }
    except Exception:
        pass
    return None


def _futures_exchange(symbol: str) -> str:
    row = _futures_catalog_row(symbol)
    return (row or {}).get("exchange") or "SHFE"


def _futures_product_code(symbol: str) -> str:
    """AUM→AU, MM→M, MAM→MA, IFM→IF。"""
    s = (symbol or "").upper().strip()
    if s.endswith("M") and len(s) >= 2:
        return s[:-1]
    return s


def _futures_ts_code(symbol: str) -> str:
    product = _futures_product_code(symbol)
    ex = _futures_exchange(symbol)
    return f"{product}.{_EX_TS_SUFFIX.get(ex, 'SHF')}"


def _futures_sina_symbol(symbol: str) -> str:
    """东财主连 → 新浪连续码（AU0 / IF0）。"""
    return f"{_futures_product_code(symbol)}0"


def _parse_day_bar(
    day: str,
    open_v: Any,
    high_v: Any,
    low_v: Any,
    close_v: Any,
    vol_v: Any,
    amount_v: Any = None,
) -> dict[str, Any] | None:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    try:
        dt = datetime.strptime(str(day)[:10], "%Y-%m-%d").replace(
            tzinfo=ZoneInfo("Asia/Shanghai")
        )
        return {
            "timestamp": int(dt.timestamp() * 1000),
            "open": float(open_v),
            "high": float(high_v),
            "low": float(low_v),
            "close": float(close_v),
            "volume": float(vol_v) if vol_v is not None else 0.0,
            "amount": float(amount_v)
            if amount_v is not None and amount_v not in ("", "-")
            else None,
        }
    except Exception:
        return None


def _fetch_futures_bars_tushare(symbol: str, period: str) -> tuple[list[dict[str, Any]], str]:
    """Tushare fut_daily 主连（AU.SHF / IF.CFX…），日线为主。"""
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    # 分钟/周先回退日线（总览面积图只要日线）
    _ = period
    ts_code = _futures_ts_code(symbol)
    row = _futures_catalog_row(symbol)
    name = (row or {}).get("name") or symbol

    try:
        from tsrelay.client import get_client
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"tushare client unavailable: {e}") from e

    client = get_client()
    if not client.configured():
        raise RuntimeError("TUSHARE_TOKEN 未配置")

    end = datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y%m%d")
    start = (datetime.now(ZoneInfo("Asia/Shanghai")) - timedelta(days=420)).strftime(
        "%Y%m%d"
    )
    result = client.query(
        "fut_daily",
        params={"ts_code": ts_code, "start_date": start, "end_date": end},
    )
    if not result.ok:
        raise RuntimeError(result.error or result.msg or "fut_daily failed")
    records = result.as_records()
    bars: list[dict[str, Any]] = []
    for rec in records:
        day = str(rec.get("trade_date") or "")
        if len(day) == 8:
            day = f"{day[:4]}-{day[4:6]}-{day[6:8]}"
        bar = _parse_day_bar(
            day,
            rec.get("open"),
            rec.get("high"),
            rec.get("low"),
            rec.get("close"),
            rec.get("vol"),
            rec.get("amount"),
        )
        if bar:
            bars.append(bar)
    bars.sort(key=lambda b: b["timestamp"])
    return bars, name


def _http_text(url: str, *, timeout: float = 20.0, referer: str = "") -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": _BROWSER_UA,
            "Referer": referer or "https://finance.sina.com.cn/",
            "Accept": "*/*",
            "Connection": "close",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _fetch_futures_bars_sina(symbol: str, period: str) -> tuple[list[dict[str, Any]], str]:
    """新浪日线兜底（商品 InnerFutures / 中金所 Cffex）。"""
    _ = period
    product = _futures_product_code(symbol)
    sina_sym = _futures_sina_symbol(symbol)
    row = _futures_catalog_row(symbol)
    name = (row or {}).get("name") or symbol
    if product in _CFFEX_PRODUCTS:
        url = (
            "https://stock.finance.sina.com.cn/futures/api/json.php/"
            f"CffexFuturesService.getCffexFuturesDailyKLine?symbol={urllib.parse.quote(sina_sym)}"
        )
    else:
        url = (
            "https://stock2.finance.sina.com.cn/futures/api/json.php/"
            f"IndexService.getInnerFuturesDailyKLine?symbol={urllib.parse.quote(sina_sym)}"
        )
    raw = _http_text(url, timeout=15.0)
    if not raw or raw.strip() in ("null", "[]"):
        return [], name
    data = json.loads(raw)
    if not isinstance(data, list):
        return [], name
    bars: list[dict[str, Any]] = []
    # 新浪: [date, open, high, low, close, volume]
    for row_v in data:
        if not isinstance(row_v, (list, tuple)) or len(row_v) < 5:
            continue
        day = str(row_v[0] or "")
        if not day.startswith("20"):
            continue
        bar = _parse_day_bar(day, row_v[1], row_v[2], row_v[3], row_v[4], row_v[5] if len(row_v) > 5 else 0)
        if bar:
            bars.append(bar)
    bars.sort(key=lambda b: b["timestamp"])
    return bars[-500:], name


def _fetch_futures_bars_eastmoney(symbol: str, period: str) -> tuple[list[dict[str, Any]], str]:
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
        raise RuntimeError(f"eastmoney futures kline failed: {last_err}")
    body = data.get("data") if isinstance(data.get("data"), dict) else {}
    name = str((body or {}).get("name") or symbol)
    klines = (body or {}).get("klines") if isinstance(body, dict) else None
    if not isinstance(klines, list):
        return [], name
    bars: list[dict[str, Any]] = []
    for line in klines:
        parts = str(line).split(",")
        if len(parts) < 6:
            continue
        bar = _parse_day_bar(
            parts[0],
            parts[1],
            parts[3],
            parts[4],
            parts[2],
            parts[5],
            parts[6] if len(parts) > 6 else None,
        )
        if bar:
            bars.append(bar)
    return bars, name


def fetch_futures_bars(symbol: str, period: str) -> tuple[list[dict[str, Any]], str, str]:
    """期货日线：Tushare 主 → 新浪兜底 → 东财（常被掐）。返回 (bars, name, source)。"""
    errors: list[str] = []
    for label, fn in (
        ("tushare", _fetch_futures_bars_tushare),
        ("sina", _fetch_futures_bars_sina),
        ("eastmoney", _fetch_futures_bars_eastmoney),
    ):
        try:
            bars, name = fn(symbol, period)
            if bars:
                return bars, name, label
            errors.append(f"{label}: empty")
        except Exception as e:  # noqa: BLE001
            errors.append(f"{label}: {e}")
    raise RuntimeError("futures kline failed: " + " | ".join(errors))


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
        bars, name, source = fetch_cn_bars(symbol, period)
        return bars, name, source

    if market == "futures":
        return fetch_futures_bars(symbol, period)

    raise ValueError(f"unsupported market: {market}")
