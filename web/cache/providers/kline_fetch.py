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


# 主站 push2his 对美股/部分时段常 RemoteDisconnected；优先可用节点
_EM_KLINE_HOSTS = (
    "82.push2his.eastmoney.com",
    "91.push2his.eastmoney.com",
    "push2delay.eastmoney.com",
    "63.push2his.eastmoney.com",
    "push2his.eastmoney.com",
)


def fetch_yf_bars(yf_symbol: str, period: str) -> tuple[list[dict[str, Any]], str]:
    """复用 server 侧 Yahoo 逻辑。"""
    import server as srv
    from cache.kline_time import collapse_day_like_bars

    bars = srv._yf_history_bars(yf_symbol, period=period)
    bars = collapse_day_like_bars("yf", normalize_period(period), bars, symbol=yf_symbol)
    name = ""
    try:
        from yf_catalog import translate_name

        name = translate_name(yf_symbol)
    except Exception:
        name = yf_symbol
    return bars, name


def fetch_yf_bars_before(
    yf_symbol: str,
    period: str,
    before_ts_ms: int,
    *,
    limit: int = 500,
) -> tuple[list[dict[str, Any]], str]:
    """Yahoo 向前分页：拉 before_ts 之前的一页。"""
    import server as srv
    from cache.kline_time import collapse_day_like_bars

    bars = srv._yf_history_bars_before(
        yf_symbol, period=period, before_ts_ms=before_ts_ms, limit=limit
    )
    bars = collapse_day_like_bars("yf", normalize_period(period), bars, symbol=yf_symbol)
    name = ""
    try:
        from yf_catalog import translate_name

        name = translate_name(yf_symbol)
    except Exception:
        name = yf_symbol
    return bars, name


# 美股东财市场号：NASDAQ=105 / NYSE=106 / AMEX=107
_US_SECID_CACHE: dict[str, str] = {}
_US_MKT_TRY = (105, 106, 107)


def _hk_secid(symbol: str) -> str:
    pure = re.sub(r"\D", "", str(symbol or "")) or str(symbol or "")
    # 东财港股多为 5 位：00700
    code = pure.zfill(5) if pure.isdigit() else pure
    return f"116.{code}"


def _resolve_us_secid(ticker: str) -> str:
    """解析美股东财 secid（带进程内缓存）。"""
    t = (ticker or "").upper().strip()
    if not t:
        raise ValueError("empty us ticker")
    hit = _US_SECID_CACHE.get(t)
    if hit:
        return hit
    # 1) 搜索联想（最快拿到准确 MktNum）
    try:
        url = (
            "https://searchapi.eastmoney.com/api/suggest/get?"
            + urllib.parse.urlencode(
                {
                    "input": t,
                    "type": "14",
                    "token": "D43BF722C8E33BDC906FB84D85E326E8",
                    "count": "8",
                }
            )
        )
        data = _http_json(url, timeout=8.0)
        table = data.get("QuotationCodeTable") if isinstance(data, dict) else None
        rows = (table or {}).get("Data") if isinstance(table, dict) else None
        if isinstance(rows, list):
            for row in rows:
                if not isinstance(row, dict):
                    continue
                if str(row.get("Code") or "").upper() != t:
                    continue
                mkt = str(row.get("MktNum") or "").strip()
                qid = str(row.get("QuoteID") or "").strip()
                if qid and "." in qid:
                    _US_SECID_CACHE[t] = qid
                    return qid
                if mkt.isdigit():
                    secid = f"{mkt}.{t}"
                    _US_SECID_CACHE[t] = secid
                    return secid
    except Exception:
        pass
    # 2) 兜底按 105→106→107 探测有行情的市场号
    for mid in _US_MKT_TRY:
        secid = f"{mid}.{t}"
        try:
            url = (
                "https://push2.eastmoney.com/api/qt/stock/get?"
                + urllib.parse.urlencode(
                    {
                        "secid": secid,
                        "fltt": "2",
                        "fields": "f57,f58,f43",
                    }
                )
            )
            data = _http_json(url, timeout=6.0)
            body = data.get("data") if isinstance(data.get("data"), dict) else None
            if body and body.get("f43") not in (None, "-", 0, "0"):
                _US_SECID_CACHE[t] = secid
                return secid
        except Exception:
            continue
    secid = f"105.{t}"
    _US_SECID_CACHE[t] = secid
    return secid


def _parse_em_klines(
    klines: list[Any],
    *,
    day_tz: str,
    minute_tz: str,
    daily_open_hm: tuple[int, int] = (0, 0),
) -> list[dict[str, Any]]:
    """解析东财 klines；日线按交易日开盘时刻，分钟线按 minute_tz 墙钟。"""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    z_day = ZoneInfo(day_tz)
    z_min = ZoneInfo(minute_tz)
    bars: list[dict[str, Any]] = []
    for line in klines:
        parts = str(line).split(",")
        if len(parts) < 6:
            continue
        try:
            day = parts[0]
            if len(day) == 10:  # YYYY-MM-DD
                hh, mm = daily_open_hm
                dt = datetime.strptime(day, "%Y-%m-%d").replace(
                    hour=hh, minute=mm, tzinfo=z_day
                )
            else:
                dt = datetime.strptime(day[:16], "%Y-%m-%d %H:%M").replace(tzinfo=z_min)
            bars.append(
                {
                    "timestamp": int(dt.timestamp() * 1000),
                    "open": float(parts[1]),
                    "close": float(parts[2]),
                    "high": float(parts[3]),
                    "low": float(parts[4]),
                    "volume": float(parts[5]),
                    "amount": float(parts[6])
                    if len(parts) > 6 and parts[6] not in ("", "-")
                    else None,
                }
            )
        except Exception:
            continue
    return bars


def _end_yyyymmdd_before(before_ts_ms: int) -> str:
    """东财 end：取 before_ts 前一自然日 YYYYMMDD。"""
    from datetime import datetime, timedelta, timezone

    ts = max(0, int(before_ts_ms)) / 1000.0
    day = datetime.fromtimestamp(ts, tz=timezone.utc).date() - timedelta(days=1)
    return day.strftime("%Y%m%d")


def _filter_bars_before(
    bars: list[dict[str, Any]], before_ts_ms: int
) -> list[dict[str, Any]]:
    cut = int(before_ts_ms)
    out = [b for b in bars if int(b.get("timestamp") or 0) < cut]
    out.sort(key=lambda b: int(b.get("timestamp") or 0))
    return out


def _fetch_em_bars_by_secid(
    secid: str,
    period: str,
    *,
    day_tz: str,
    minute_tz: str,
    daily_open_hm: tuple[int, int],
    timeout: float = 6.0,
    end: str = "20500101",
    lmt: int = 500,
) -> tuple[list[dict[str, Any]], str]:
    klt = _em_klt(period)
    params = {
        "secid": secid,
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
        "klt": klt,
        "fqt": "1",
        "end": end or "20500101",
        "lmt": str(max(1, min(int(lmt), 1000))),
    }
    qs = urllib.parse.urlencode(params)
    last_err: Exception | None = None
    data: dict[str, Any] | None = None
    # 每主机只试 1 次：断连立刻换节点，避免美股卡在坏主站上重试
    for host in _EM_KLINE_HOSTS:
        url = f"https://{host}/api/qt/stock/kline/get?{qs}"
        try:
            data = _http_json(url, timeout=timeout)
            break
        except (
            urllib.error.URLError,
            TimeoutError,
            OSError,
            json.JSONDecodeError,
            ValueError,
        ) as e:
            last_err = e
            continue
    if data is None:
        raise RuntimeError(f"eastmoney kline failed: {last_err}")

    body = data.get("data") if isinstance(data.get("data"), dict) else {}
    name = str((body or {}).get("name") or secid)
    klines = (body or {}).get("klines") if isinstance(body, dict) else None
    if not isinstance(klines, list) or not klines:
        return [], name
    bars = _parse_em_klines(
        klines,
        day_tz=day_tz,
        minute_tz=minute_tz,
        daily_open_hm=daily_open_hm,
    )
    return bars, name


def fetch_us_spot(ticker: str) -> dict[str, Any] | None:
    """美股东财实时行情，用于补当日日 K。返回 open/high/low/close/volume/date(美东)。"""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    try:
        secid = _resolve_us_secid(ticker)
        url = (
            "https://push2.eastmoney.com/api/qt/stock/get?"
            + urllib.parse.urlencode(
                {
                    "secid": secid,
                    "fltt": "2",
                    "fields": "f43,f44,f45,f46,f47,f57,f58,f60,f86",
                }
            )
        )
        data = _http_json(url, timeout=8.0)
        body = data.get("data") if isinstance(data.get("data"), dict) else None
        if not body or body.get("f43") in (None, "-", 0, "0"):
            return None
        price = float(body["f43"])
        if price <= 0:
            return None
        ny = ZoneInfo("America/New_York")
        qdate = datetime.now(ny).date()
        try:
            ts = int(body.get("f86") or 0)
            if ts > 1_000_000_000:
                qdate = datetime.fromtimestamp(ts, tz=ny).date()
        except Exception:
            pass
        return {
            "name": str(body.get("f58") or ticker),
            "open": float(body.get("f46") or price),
            "prev_close": float(body.get("f60") or price),
            "close": price,
            "high": float(body.get("f44") or price),
            "low": float(body.get("f45") or price),
            "volume": float(body.get("f47") or 0),
            "date": qdate,
            "secid": secid,
        }
    except Exception:
        return None


def fetch_hk_spot(symbol: str) -> dict[str, Any] | None:
    """港股东财实时行情，用于补当日日 K。"""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    try:
        secid = _hk_secid(symbol)
        url = (
            "https://push2.eastmoney.com/api/qt/stock/get?"
            + urllib.parse.urlencode(
                {
                    "secid": secid,
                    "fltt": "2",
                    "fields": "f43,f44,f45,f46,f47,f57,f58,f60,f86",
                }
            )
        )
        data = _http_json(url, timeout=8.0)
        body = data.get("data") if isinstance(data.get("data"), dict) else None
        if not body or body.get("f43") in (None, "-", 0, "0"):
            return None
        price = float(body["f43"])
        if price <= 0:
            return None
        hk = ZoneInfo("Asia/Hong_Kong")
        qdate = datetime.now(hk).date()
        try:
            ts = int(body.get("f86") or 0)
            if ts > 1_000_000_000:
                qdate = datetime.fromtimestamp(ts, tz=hk).date()
        except Exception:
            pass
        return {
            "name": str(body.get("f58") or symbol),
            "open": float(body.get("f46") or price),
            "prev_close": float(body.get("f60") or price),
            "close": price,
            "high": float(body.get("f44") or price),
            "low": float(body.get("f45") or price),
            "volume": float(body.get("f47") or 0),
            "date": qdate,
            "secid": secid,
        }
    except Exception:
        return None


def merge_today_daily_bar(
    bars: list[dict[str, Any]],
    spot: dict[str, Any] | None,
    *,
    tz_name: str,
    open_hm: tuple[int, int] = (9, 30),
) -> list[dict[str, Any]]:
    """用实时行情补/改当日日 K。"""
    if not bars or not spot:
        return bars
    from datetime import datetime
    from zoneinfo import ZoneInfo

    qdate = spot.get("date")
    if qdate is None:
        return bars
    tz = ZoneInfo(tz_name)
    hh, mm = open_hm
    ts = int(
        datetime(qdate.year, qdate.month, qdate.day, hh, mm, tzinfo=tz).timestamp() * 1000
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
    last_day = datetime.fromtimestamp(last_ts / 1000.0, tz=tz).date()
    if last_day == qdate:
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


def fetch_us_bars(ticker: str, period: str) -> tuple[list[dict[str, Any]], str, str]:
    """美股：东财优先（含当日），失败回退 Yahoo；日线再用现价补棒。"""
    errors: list[str] = []
    bars: list[dict[str, Any]] = []
    name = ticker
    source = "eastmoney"
    try:
        secid = _resolve_us_secid(ticker)
        # 东财美股分钟时间戳为北京墙钟；日线日期为美东交易日
        bars, name = _fetch_em_bars_by_secid(
            secid,
            period,
            day_tz="America/New_York",
            minute_tz="Asia/Shanghai",
            daily_open_hm=(9, 30),
        )
        if not bars:
            errors.append("eastmoney empty")
    except Exception as e:
        errors.append(f"eastmoney: {e}")
        bars = []

    if not bars:
        try:
            bars, name = fetch_yf_bars(ticker, period)
            source = "yahoo"
            if not bars:
                errors.append("yahoo empty")
        except Exception as e:
            errors.append(f"yahoo: {e}")
            bars = []

    if not bars:
        raise RuntimeError("美股 K 线不可用：" + "；".join(errors))

    if normalize_period(period) == "1d":
        spot = fetch_us_spot(ticker)
        if spot:
            if spot.get("name"):
                name = str(spot["name"])
            bars = merge_today_daily_bar(
                bars, spot, tz_name="America/New_York", open_hm=(9, 30)
            )

    return bars, name, source


def fetch_hk_bars(symbol: str, period: str) -> tuple[list[dict[str, Any]], str, str]:
    """港股：东财优先，失败回退 Yahoo；日线现价补棒。"""
    errors: list[str] = []
    bars: list[dict[str, Any]] = []
    name = symbol
    source = "eastmoney"
    yf_sym = symbol
    pure = re.sub(r"\D", "", str(symbol or ""))
    if pure.isdigit():
        yf_sym = f"{str(int(pure)).zfill(4)}.HK"
    try:
        bars, name = _fetch_em_bars_by_secid(
            _hk_secid(symbol),
            period,
            day_tz="Asia/Hong_Kong",
            minute_tz="Asia/Hong_Kong",
            daily_open_hm=(9, 30),
        )
        if not bars:
            errors.append("eastmoney empty")
    except Exception as e:
        errors.append(f"eastmoney: {e}")
        bars = []

    if not bars:
        try:
            bars, name = fetch_yf_bars(yf_sym, period)
            source = "yahoo"
            if not bars:
                errors.append("yahoo empty")
        except Exception as e:
            errors.append(f"yahoo: {e}")
            bars = []

    if not bars:
        raise RuntimeError("港股 K 线不可用：" + "；".join(errors))

    if normalize_period(period) == "1d":
        spot = fetch_hk_spot(symbol)
        if spot:
            if spot.get("name"):
                name = str(spot["name"])
            bars = merge_today_daily_bar(
                bars, spot, tz_name="Asia/Hong_Kong", open_hm=(9, 30)
            )

    return bars, name, source


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


def fetch_cn_bars_eastmoney(
    symbol: str,
    period: str,
    *,
    end: str = "20500101",
    lmt: int = 500,
) -> tuple[list[dict[str, Any]], str]:
    return _fetch_em_bars_by_secid(
        _cn_secid(symbol),
        period,
        day_tz="Asia/Shanghai",
        minute_tz="Asia/Shanghai",
        daily_open_hm=(9, 30),
        timeout=12.0,
        end=end,
        lmt=lmt,
    )


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
                # 与东财日 K 对齐：上海日历日 09:30，避免同日 00:00/09:30 双根
                dt = datetime.strptime(day[:10], "%Y-%m-%d").replace(
                    hour=9, minute=30, tzinfo=ZoneInfo("Asia/Shanghai")
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
        datetime(
            qdate.year,
            qdate.month,
            qdate.day,
            9,
            30,
            tzinfo=ZoneInfo("Asia/Shanghai"),
        ).timestamp()
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

    if market == "us":
        return fetch_us_bars(symbol, period)

    if market == "hk":
        return fetch_hk_bars(symbol, period)

    if market == "yf":
        yf_sym = norm.get("yf_symbol") or symbol
        bars, name = fetch_yf_bars(yf_sym, period)
        return bars, name, "yahoo"

    if market == "cn":
        bars, name, source = fetch_cn_bars(symbol, period)
        return bars, name, source

    if market == "futures":
        return fetch_futures_bars(symbol, period)

    raise ValueError(f"unsupported market: {market}")


def _try_em_before(
    *,
    secid: str,
    period: str,
    before_ts_ms: int,
    limit: int,
    day_tz: str,
    minute_tz: str,
    daily_open_hm: tuple[int, int],
    timeout: float = 10.0,
) -> tuple[list[dict[str, Any]], str, bool]:
    """东财向前一页。返回 (older_bars, name, page_full)。"""
    end = _end_yyyymmdd_before(before_ts_ms)
    bars, name = _fetch_em_bars_by_secid(
        secid,
        period,
        day_tz=day_tz,
        minute_tz=minute_tz,
        daily_open_hm=daily_open_hm,
        timeout=timeout,
        end=end,
        lmt=limit,
    )
    older = _filter_bars_before(bars, before_ts_ms)
    return older, name, len(bars) >= max(1, limit)


def fetch_kline_bars_before(
    norm: dict[str, str],
    period: str,
    before_ts_ms: int,
    *,
    limit: int = 500,
) -> tuple[list[dict[str, Any]], str, str, bool]:
    """按市场源优先级探测并拉取 before_ts 之前的一页。

    返回 (older_bars, name, source, exhausted)。
    exhausted=True 表示所有源都无法再提供更早数据。
    """
    period = normalize_period(period)
    market = norm["market"]
    symbol = norm["symbol"]
    limit = max(1, min(int(limit or 500), 1000))
    before_ts_ms = int(before_ts_ms)
    if before_ts_ms <= 0:
        return [], symbol, "", True

    # 分钟线源站窗口短，本期不强制向前翻页
    if period in ("fs", "1m", "5m", "15m", "1h"):
        return [], symbol, "", True

    errors: list[str] = []
    name = symbol

    if market == "cn":
        # 东财 → Yahoo（新浪多为最近 N 根，不支持 end 分页，跳过）
        try:
            older, name, page_full = _try_em_before(
                secid=_cn_secid(symbol),
                period=period,
                before_ts_ms=before_ts_ms,
                limit=limit,
                day_tz="Asia/Shanghai",
                minute_tz="Asia/Shanghai",
                daily_open_hm=(9, 30),
                timeout=12.0,
            )
            if older:
                return older, name, "eastmoney", len(older) < limit
        except Exception as e:
            errors.append(f"eastmoney: {e}")

        yf_sym = _cn_to_yahoo(symbol)
        try:
            bars, name = fetch_yf_bars_before(
                yf_sym, period, before_ts_ms, limit=limit
            )
            older = _filter_bars_before(bars, before_ts_ms)
            if older:
                return older, name or symbol, "yahoo", len(older) < limit
            errors.append("yahoo: no older")
        except Exception as e:
            errors.append(f"yahoo: {e}")
        return [], name, "", True

    if market == "us":
        try:
            secid = _resolve_us_secid(symbol)
            older, name, page_full = _try_em_before(
                secid=secid,
                period=period,
                before_ts_ms=before_ts_ms,
                limit=limit,
                day_tz="America/New_York",
                minute_tz="Asia/Shanghai",
                daily_open_hm=(9, 30),
                timeout=10.0,
            )
            if older:
                return older, name, "eastmoney", len(older) < limit
        except Exception as e:
            errors.append(f"eastmoney: {e}")
        try:
            bars, name = fetch_yf_bars_before(symbol, period, before_ts_ms, limit=limit)
            older = _filter_bars_before(bars, before_ts_ms)
            if older:
                return older, name or symbol, "yahoo", len(older) < limit
            errors.append("yahoo: no older")
        except Exception as e:
            errors.append(f"yahoo: {e}")
        return [], name, "", True

    if market == "hk":
        try:
            older, name, page_full = _try_em_before(
                secid=_hk_secid(symbol),
                period=period,
                before_ts_ms=before_ts_ms,
                limit=limit,
                day_tz="Asia/Hong_Kong",
                minute_tz="Asia/Hong_Kong",
                daily_open_hm=(9, 30),
                timeout=10.0,
            )
            if older:
                return older, name, "eastmoney", len(older) < limit
        except Exception as e:
            errors.append(f"eastmoney: {e}")
        yf_sym = norm.get("yf_symbol") or symbol
        try:
            bars, name = fetch_yf_bars_before(yf_sym, period, before_ts_ms, limit=limit)
            older = _filter_bars_before(bars, before_ts_ms)
            if older:
                return older, name or symbol, "yahoo", len(older) < limit
            errors.append("yahoo: no older")
        except Exception as e:
            errors.append(f"yahoo: {e}")
        return [], name, "", True

    if market == "yf":
        yf_sym = norm.get("yf_symbol") or symbol
        try:
            bars, name = fetch_yf_bars_before(yf_sym, period, before_ts_ms, limit=limit)
            older = _filter_bars_before(bars, before_ts_ms)
            if older:
                return older, name or symbol, "yahoo", len(older) < limit
        except Exception as e:
            errors.append(f"yahoo: {e}")
        return [], name, "", True

    if market == "futures":
        # 期货日线：用东财 end 分页；失败则 exhausted（新浪多为全量截断最近 500）
        try:
            mid = _EXCHANGE_MID.get(_futures_exchange(symbol), 113)
            secid = f"{mid}.{symbol.upper()}"
            older, name, page_full = _try_em_before(
                secid=secid,
                period=period if period in ("1d", "1w", "1M") else "1d",
                before_ts_ms=before_ts_ms,
                limit=limit,
                day_tz="Asia/Shanghai",
                minute_tz="Asia/Shanghai",
                daily_open_hm=(9, 0),
                timeout=12.0,
            )
            if older:
                return older, name, "eastmoney", len(older) < limit
        except Exception as e:
            errors.append(f"eastmoney: {e}")
        return [], name, "", True

    raise ValueError(f"unsupported market: {market}")
