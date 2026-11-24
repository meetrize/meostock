"""静态站点 + 符号列表代理 + yfinance 市场摘要 / K 线。"""

from __future__ import annotations

import http.client
import json
import mimetypes
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Query, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from yf_catalog import (
    YF_MARKETS,
    catalog_items,
    market_label,
    translate_name,
)

STATIC_DIR = Path(__file__).resolve().parent / "static"
# stock-dashboard 构建产物（VITE_BASE_URL=/dashboard/）
DASHBOARD_DIR = STATIC_DIR / "dashboard"
# a-share-heatmap（Next.js）上游，默认由 run_web.sh 在 8766 拉起
DAPAN_UPSTREAM = os.environ.get("DAPAN_UPSTREAM", "http://127.0.0.1:8766").rstrip("/")

app = FastAPI(title="stock-sdk K-Line Demo", version="0.5.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# 行情本地缓存（SQLite + 后台同步）
try:
    from cache.api import router as _cache_router
    from cache.db import init_db as _cache_init_db
    from cache.sync_worker import prefetch_on_startup as _cache_prefetch
    from cache.sync_worker import start_worker as _cache_start_worker

    app.include_router(_cache_router)

    @app.on_event("startup")
    def _quote_cache_startup() -> None:
        if os.environ.get("QUOTE_CACHE_ENABLED", "1").strip() in ("0", "false", "False"):
            return
        _cache_init_db()
        _cache_start_worker()
        _cache_prefetch()

except Exception as _cache_exc:  # noqa: BLE001 — 缓存可选，失败不阻断主站
    import logging

    logging.getLogger("uvicorn.error").warning("quote cache disabled: %s", _cache_exc)

# 通用定时任务（同花顺概念同步等）
try:
    from scheduler.api import router as _scheduler_router
    from scheduler.runner import start_scheduler as _start_job_scheduler

    app.include_router(_scheduler_router)

    @app.on_event("startup")
    def _scheduler_startup() -> None:
        if os.environ.get("JOB_SCHEDULER_ENABLED", "1").strip() in ("0", "false", "False"):
            return
        try:
            from cache.db import init_db as _init_db

            _init_db()
            _start_job_scheduler()
        except Exception as exc:  # noqa: BLE001
            import logging

            logging.getLogger("uvicorn.error").warning("job scheduler disabled: %s", exc)

except Exception as _sched_exc:  # noqa: BLE001
    import logging

    logging.getLogger("uvicorn.error").warning("scheduler module disabled: %s", _sched_exc)

# Tushare 双中继网关（行情页专题 / 新市场 + 本地缓存/定时）
try:
    from tsrelay.api import router as _tushare_router
    from tsrelay.scheduler import start_scheduler as _ts_start_scheduler
    from tsrelay.store import ensure_schema as _ts_ensure_schema
    from tsrelay.sync_worker import start_worker as _ts_start_worker

    app.include_router(_tushare_router)

    @app.on_event("startup")
    def _tushare_startup() -> None:
        if os.environ.get("TUSHARE_ENABLED", "1").strip() in ("0", "false", "False"):
            return
        try:
            _ts_ensure_schema()
            _ts_start_worker()
            _ts_start_scheduler()
        except Exception as exc:  # noqa: BLE001
            import logging

            logging.getLogger("uvicorn.error").warning("tushare startup: %s", exc)

except Exception as _ts_exc:  # noqa: BLE001
    import logging

    logging.getLogger("uvicorn.error").warning("tushare gateway disabled: %s", _ts_exc)

# feedgen 资讯时间线反代（按标的）
try:
    from news.api import router as _news_router

    app.include_router(_news_router)
except Exception as _news_exc:  # noqa: BLE001
    import logging

    logging.getLogger("uvicorn.error").warning("news proxy disabled: %s", _news_exc)

# K 线侧栏 DeepSeek 代理
try:
    from ai.api import router as _ai_router

    app.include_router(_ai_router)
except Exception as _ai_exc:  # noqa: BLE001
    import logging

    logging.getLogger("uvicorn.error").warning("ai proxy disabled: %s", _ai_exc)

# 看板 AI Agent（工具循环 / 只读查库）
try:
    from agent.api import router as _agent_router

    app.include_router(_agent_router)
except Exception as _agent_exc:  # noqa: BLE001
    import logging

    logging.getLogger("uvicorn.error").warning("ai agent disabled: %s", _agent_exc)

# 宏观利率（NY Fed 目标/EFFR + 财政部国债曲线；无需 API Key）
try:
    from macro.api import router as _macro_router

    app.include_router(_macro_router)
except Exception as _macro_exc:  # noqa: BLE001
    import logging

    logging.getLogger("uvicorn.error").warning("macro rates disabled: %s", _macro_exc)

# 东财财经日历（本地库查询 + AI 重要性评级）
try:
    from fe_calendar.api import router as _fe_calendar_router

    app.include_router(_fe_calendar_router)
except Exception as _cal_exc:  # noqa: BLE001
    import logging

    logging.getLogger("uvicorn.error").warning("finance calendar disabled: %s", _cal_exc)

# 网址收藏夹
try:
    from favorites.api import router as _favorites_router

    app.include_router(_favorites_router)
except Exception as _fav_exc:  # noqa: BLE001
    import logging

    logging.getLogger("uvicorn.error").warning("favorites disabled: %s", _fav_exc)

# 研判工作台 Research Workbench（Phase 0 骨架）
try:
    from research.api import router as _research_router

    app.include_router(_research_router)
except Exception as _research_exc:  # noqa: BLE001
    import logging

    logging.getLogger("uvicorn.error").warning(
        "research workbench disabled: %s", _research_exc
    )

# 东方财富行情列表（浏览器直连常遇 CORS，由本机代理）
EM_CLIST = "https://push2.eastmoney.com/api/qt/clist/get"
MARKET_FS = {
    "cn": "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048",  # A股
    "hk": "m:128+t:3,m:128+t:4",  # 港股
    "us": "m:105,m:106,m:107",  # 美股
    "fund": "m:0+t:1",  # 场内基金近似
    "index": "m:1+t:1,m:0+t:5",  # 指数近似
}
MARKET_LABEL = {
    "cn": "A股",
    "hk": "港股",
    "us": "美股",
    "fund": "基金",
    "index": "指数",
}
EXCHANGE_BY_MKT = {
    0: "SZSE",
    1: "SSE",
    105: "NASDAQ",
    106: "NYSE",
    107: "AMEX",
    116: "HKEX",
    128: "HKEX",
}

# yfinance 列表缓存：market -> {ts, items, live}
_YF_LIST_CACHE: dict[str, dict[str, Any]] = {}
_YF_LIST_LOCK = threading.Lock()
_YF_LIST_TTL = 600  # 秒

# yfinance K 线缓存：key=(symbol, period) -> {ts, bars, name}
_YF_KLINE_CACHE: dict[str, dict[str, Any]] = {}
_YF_KLINE_LOCK = threading.Lock()
_YF_KLINE_TTL = 300  # 秒


_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

# 新浪行情节点（东财 push2 不可达时的 A 股/ETF 兜底）
SINA_HQ_NODE = {
    "cn": "hs_a",
    "fund": "etf_hq_fund",
}
SINA_HQ_DATA = (
    "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
    "Market_Center.getHQNodeData"
)
SINA_HQ_COUNT = (
    "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
    "Market_Center.getHQNodeStockCount"
)


def _http_get_text(
    url: str,
    *,
    timeout: float = 15.0,
    referer: str = "https://quote.eastmoney.com/",
    headers: dict[str, str] | None = None,
) -> str:
    """统一 HTTP GET 文本。可传完整 headers，或只用 referer + 默认浏览器 UA。"""
    req_headers = {
        "User-Agent": _BROWSER_UA,
        "Referer": referer,
        "Accept": "application/json,text/plain,*/*",
    }
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, headers=req_headers, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _http_get_json(url: str, timeout: float = 12.0) -> dict[str, Any]:
    raw = _http_get_text(url, timeout=timeout)
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise json.JSONDecodeError("expected object", raw, 0)
    return data


def _http_errors() -> tuple[type[BaseException], ...]:
    return (
        urllib.error.URLError,
        TimeoutError,
        json.JSONDecodeError,
        OSError,
        http.client.HTTPException,
        ValueError,
    )


def _to_symbol(code: str, mkt: int, market: str) -> str:
    code = str(code or "").strip()
    if market == "us":
        return code.upper()
    if market == "hk":
        return code.zfill(5) if code.isdigit() else code
    if code.startswith(("sh", "sz", "bj")):
        return code
    # 北交所常见代码段
    if code.isdigit() and (code.startswith(("8", "4")) or code.startswith("92")):
        return f"bj{code}"
    if mkt == 1:
        return f"sh{code}"
    if mkt == 0:
        return f"sz{code}"
    return code


def _normalize_diff(diff: Any) -> list[dict[str, Any]]:
    """东财 diff 有时是 list，有时是 {\"0\": {...}}。"""
    if isinstance(diff, list):
        return [row for row in diff if isinstance(row, dict)]
    if isinstance(diff, dict):
        rows = list(diff.values())
        return [row for row in rows if isinstance(row, dict)]
    return []


def _sina_symbol_list(
    market: str,
    page: int,
    size: int,
    q: str,
) -> dict[str, Any]:
    """新浪行情列表兜底（主要用于 A 股）。"""
    node = SINA_HQ_NODE.get(market)
    if not node:
        raise ValueError(f"no sina fallback for market: {market}")

    params = {
        "page": str(page),
        "num": str(size),
        "sort": "changepercent",
        "asc": "0",
        "node": node,
        "symbol": "",
        "_s_r_a": "page",
    }
    referer = "https://finance.sina.com.cn/"
    raw = _http_get_text(
        f"{SINA_HQ_DATA}?{urllib.parse.urlencode(params)}",
        referer=referer,
    )
    rows = json.loads(raw) if raw.strip() else []
    if not isinstance(rows, list):
        rows = []

    total = 0
    try:
        count_raw = _http_get_text(
            f"{SINA_HQ_COUNT}?{urllib.parse.urlencode({'node': node})}",
            referer=referer,
        ).strip().strip('"')
        total = int(count_raw or 0)
    except _http_errors():
        total = len(rows)

    qn = q.strip().lower()
    items: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        code = str(row.get("code") or "").strip()
        name = str(row.get("name") or "").strip()
        sym = str(row.get("symbol") or "").strip().lower()
        if qn and qn not in code.lower() and qn not in name.lower() and qn not in sym:
            continue
        if not sym:
            # 无前缀时按代码猜测市场
            if code.startswith(("6", "5", "9")):
                sym = f"sh{code}"
            elif code.startswith(("0", "1", "2", "3")):
                sym = f"sz{code}"
            elif code.startswith(("4", "8", "92")):
                sym = f"bj{code}"
            else:
                sym = code
        exchange = "SSE" if sym.startswith("sh") else "SZSE" if sym.startswith("sz") else "BSE"
        items.append(
            {
                "symbol": sym,
                "code": code or re.sub(r"^(sh|sz|bj)", "", sym),
                "name": name,
                "market": market,
                "marketLabel": MARKET_LABEL.get(market, market.upper()),
                "exchange": exchange,
                "category": "stock" if market == "cn" else market,
            }
        )

    return {
        "ok": True,
        "market": market,
        "page": page,
        "size": size,
        "total": total or len(items),
        "items": items,
        "source": "sina",
    }


def _yf_live_items(market: str) -> list[dict[str, Any]] | None:
    """尝试从 yfinance Market.summary 拉实时列表；失败返回 None。"""
    try:
        import yfinance as yf
    except ImportError:
        return None
    try:
        summary = yf.Market(market).summary
    except Exception:
        return None
    if not isinstance(summary, dict) or not summary:
        return None

    label = market_label(market)
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for _ex, row in summary.items():
        if not isinstance(row, dict):
            continue
        sym = str(row.get("symbol") or "").strip()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        en = str(row.get("shortName") or row.get("longName") or "")
        items.append(
            {
                "symbol": f"yf:{sym}",
                "code": sym,
                "name": translate_name(sym, en),
                "nameEn": en,
                "market": f"yf:{market}",
                "marketLabel": label,
                "exchange": str(row.get("exchange") or _ex or "YF"),
                "category": "yfinance",
                "assetType": "yfinance",
                "source": "yfinance-live",
                "price": row.get("regularMarketPrice"),
                "change": row.get("regularMarketChange"),
                "changePercent": row.get("regularMarketChangePercent"),
            }
        )
    return items or None


def _yf_items_cached(market: str, *, force: bool = False) -> tuple[list[dict[str, Any]], bool]:
    """返回 (items, live)。优先缓存；过期则尝试 live，失败用本地中文目录。"""
    market = (market or "").upper().strip()
    now = time.time()
    with _YF_LIST_LOCK:
        if force:
            _YF_LIST_CACHE.pop(market, None)
        hit = _YF_LIST_CACHE.get(market)
        if hit and now - float(hit.get("ts") or 0) < _YF_LIST_TTL:
            return list(hit["items"]), bool(hit.get("live"))

    live = _yf_live_items(market)
    if live:
        # 合并本地目录里有、实时没有的标的，保证列表完整
        catalog = catalog_items(market)
        have = {x["code"] for x in live}
        for c in catalog:
            if c["code"] not in have:
                live.append(c)
        with _YF_LIST_LOCK:
            _YF_LIST_CACHE[market] = {"ts": now, "items": live, "live": True}
        return live, True

    fallback = catalog_items(market)
    with _YF_LIST_LOCK:
        _YF_LIST_CACHE[market] = {"ts": now, "items": fallback, "live": False}
    return fallback, False


def _yf_period_map(period: str) -> tuple[str, str]:
    """前端 period → (yahoo interval, yahoo range)。"""
    if period in ("1m", "5m", "15m", "1h"):
        interval = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "60m"}[period]
        hist_range = "5d" if period == "1m" else "60d"
    elif period == "1w":
        interval = "1wk"
        hist_range = "5y"
    else:
        interval = "1d"
        hist_range = "2y"
    return interval, hist_range


def _yf_chart_api_bars(symbol: str, period: str = "1d") -> list[dict[str, Any]]:
    """直连 Yahoo chart API（绕过 yfinance 客户端限流）。"""
    interval, hist_range = _yf_period_map(period)
    qs = urllib.parse.urlencode(
        {
            "interval": interval,
            "range": hist_range,
            "includePrePost": "false",
            "events": "div,splits",
        }
    )
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol, safe='')}?{qs}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "application/json",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        payload = json.loads(resp.read().decode("utf-8", errors="replace"))
    result = (((payload or {}).get("chart") or {}).get("result") or [None])[0]
    if not result:
        return []
    ts_list = result.get("timestamp") or []
    quote = (((result.get("indicators") or {}).get("quote") or [None])[0]) or {}
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []
    bars: list[dict[str, Any]] = []
    for i, ts in enumerate(ts_list):
        try:
            c = closes[i]
            if c is None:
                continue
            bars.append(
                {
                    "timestamp": int(ts) * 1000,
                    "open": float(opens[i] if opens[i] is not None else c),
                    "high": float(highs[i] if highs[i] is not None else c),
                    "low": float(lows[i] if lows[i] is not None else c),
                    "close": float(c),
                    "volume": float(volumes[i] or 0) if i < len(volumes) else 0.0,
                }
            )
        except Exception:
            continue
    if len(bars) > 500:
        bars = bars[-500:]
    return bars


def _yf_history_bars(symbol: str, period: str = "1d") -> list[dict[str, Any]]:
    """优先 Yahoo chart API；失败再回退 yfinance。"""
    try:
        bars = _yf_chart_api_bars(symbol, period=period)
        if bars:
            return bars
    except Exception:
        pass

    import yfinance as yf

    interval, hist_range = _yf_period_map(period)
    last_err: Exception | None = None
    df = None
    for attempt in range(3):
        try:
            t = yf.Ticker(symbol)
            df = t.history(period=hist_range, interval=interval, auto_adjust=True)
            last_err = None
            break
        except Exception as e:
            last_err = e
            msg = str(e).lower()
            if "rate" in msg or "too many" in msg or "429" in msg:
                time.sleep(1.2 * (attempt + 1))
                continue
            raise
    if last_err is not None:
        raise last_err
    if df is None or getattr(df, "empty", True):
        return []

    bars: list[dict[str, Any]] = []
    for idx, row in df.iterrows():
        try:
            ts = int(idx.timestamp() * 1000)
        except Exception:
            continue
        try:
            bars.append(
                {
                    "timestamp": ts,
                    "open": float(row["Open"]),
                    "high": float(row["High"]),
                    "low": float(row["Low"]),
                    "close": float(row["Close"]),
                    "volume": float(row.get("Volume") or 0),
                }
            )
        except Exception:
            continue
    if len(bars) > 500:
        bars = bars[-500:]
    return bars


def _yf_chart_api_bars_window(
    symbol: str,
    period: str,
    *,
    period1: int,
    period2: int,
) -> list[dict[str, Any]]:
    """Yahoo chart API 按 Unix 秒时间窗拉取（用于向前续拉）。"""
    interval, _ = _yf_period_map(period)
    p1 = max(0, int(period1))
    p2 = max(p1 + 1, int(period2))
    qs = urllib.parse.urlencode(
        {
            "interval": interval,
            "period1": str(p1),
            "period2": str(p2),
            "includePrePost": "false",
            "events": "div,splits",
        }
    )
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol, safe='')}?{qs}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "application/json",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        payload = json.loads(resp.read().decode("utf-8", errors="replace"))
    result = (((payload or {}).get("chart") or {}).get("result") or [None])[0]
    if not result:
        return []
    ts_list = result.get("timestamp") or []
    quote = (((result.get("indicators") or {}).get("quote") or [None])[0]) or {}
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []
    bars: list[dict[str, Any]] = []
    for i, ts in enumerate(ts_list):
        try:
            c = closes[i]
            if c is None:
                continue
            bars.append(
                {
                    "timestamp": int(ts) * 1000,
                    "open": float(opens[i] if opens[i] is not None else c),
                    "high": float(highs[i] if highs[i] is not None else c),
                    "low": float(lows[i] if lows[i] is not None else c),
                    "close": float(c),
                    "volume": float(volumes[i] or 0) if i < len(volumes) else 0.0,
                }
            )
        except Exception:
            continue
    return bars


def _yf_history_bars_before(
    symbol: str,
    period: str = "1d",
    *,
    before_ts_ms: int,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """拉 before_ts 之前最多 limit 根（不硬截成「最近 500」）。"""
    limit = max(1, min(int(limit or 500), 1000))
    before_sec = max(1, int(before_ts_ms) // 1000)
    # 日/周：约 2 年交易日窗口；分钟：较短
    p = (period or "1d").strip().lower()
    if p in ("1m", "5m", "15m", "1h"):
        span = 60 * 86400
    elif p == "1w":
        span = 5 * 365 * 86400
    else:
        span = 2 * 365 * 86400
    period2 = before_sec - 86400
    period1 = max(0, period2 - span)
    if period2 <= period1:
        return []

    bars: list[dict[str, Any]] = []
    try:
        bars = _yf_chart_api_bars_window(
            symbol, period, period1=period1, period2=period2
        )
    except Exception:
        bars = []

    if not bars:
        try:
            import yfinance as yf
            from datetime import datetime, timezone

            interval, _ = _yf_period_map(period)
            start = datetime.fromtimestamp(period1, tz=timezone.utc)
            end = datetime.fromtimestamp(period2, tz=timezone.utc)
            t = yf.Ticker(symbol)
            df = t.history(start=start, end=end, interval=interval, auto_adjust=True)
            if df is not None and not getattr(df, "empty", True):
                for idx, row in df.iterrows():
                    try:
                        ts = int(idx.timestamp() * 1000)
                        bars.append(
                            {
                                "timestamp": ts,
                                "open": float(row["Open"]),
                                "high": float(row["High"]),
                                "low": float(row["Low"]),
                                "close": float(row["Close"]),
                                "volume": float(row.get("Volume") or 0),
                            }
                        )
                    except Exception:
                        continue
        except Exception:
            bars = []

    bars = [b for b in bars if int(b.get("timestamp") or 0) < int(before_ts_ms)]
    bars.sort(key=lambda b: int(b.get("timestamp") or 0))
    if len(bars) > limit:
        bars = bars[-limit:]
    return bars


def _yf_kline_cached(symbol: str, period: str, *, force: bool = False) -> list[dict[str, Any]]:
    key = f"{symbol}|{period}"
    now = time.time()
    with _YF_KLINE_LOCK:
        if force:
            _YF_KLINE_CACHE.pop(key, None)
        hit = _YF_KLINE_CACHE.get(key)
        if hit and now - float(hit.get("ts") or 0) < _YF_KLINE_TTL:
            return list(hit["bars"])
    bars = _yf_history_bars(symbol, period=period)
    with _YF_KLINE_LOCK:
        _YF_KLINE_CACHE[key] = {"ts": now, "bars": bars}
    return bars


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/multipanel", response_model=None)
@app.get("/multipanel/", response_model=None)
def multipanel() -> FileResponse:
    """多面板 K 线浏览（KLineChart；设计见 docs/multi-panel-charts.md）。"""
    return FileResponse(STATIC_DIR / "multipanel.html")


# 带哈希的静态资源：缺失时绝不能回退成 index.html，否则浏览器会报
# “Importing a module script failed”（把 HTML 当 JS 模块加载）。
_DASHBOARD_ASSET_SUFFIXES = {
    ".js",
    ".css",
    ".map",
    ".json",
    ".svg",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
}


def _dashboard_file(rel: str) -> Path | None:
    """安全解析 dashboard 下的文件路径；不存在则返回 None。"""
    if not DASHBOARD_DIR.is_dir():
        return None
    target = (DASHBOARD_DIR / rel).resolve()
    try:
        target.relative_to(DASHBOARD_DIR.resolve())
    except ValueError:
        return None
    return target if target.is_file() else None


def _dashboard_not_built() -> JSONResponse:
    return JSONResponse(
        {
            "ok": False,
            "error": "stock-dashboard 未构建。请运行: ./scripts/build_dashboard.sh",
        },
        status_code=404,
    )


def _file_response(path: Path, request: Request, *, no_cache: bool = False) -> Response:
    """GET 返回文件；HEAD 只返回头（避免 405 导致 modulepreload 失败）。"""
    media = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    if path.suffix.lower() == ".js":
        media = "text/javascript; charset=utf-8"
    elif path.suffix.lower() == ".css":
        media = "text/css; charset=utf-8"
    headers: dict[str, str] = {}
    if no_cache:
        # SPA 入口禁止缓存，避免重建后仍引用已删除的 chunk（Importing a module script failed）
        headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        headers["Pragma"] = "no-cache"
        headers["Expires"] = "0"
    elif path.suffix.lower() in {".js", ".css"}:
        # 开发期勿用 immutable：重建后旧 hash 404 会被顽固缓存，导致 Importing a module script failed
        headers["Cache-Control"] = "no-cache"
    if request.method == "HEAD":
        headers["content-length"] = str(path.stat().st_size)
        return Response(status_code=200, media_type=media, headers=headers)
    return FileResponse(path, media_type=media, headers=headers or None)


@app.api_route("/dashboard", methods=["GET", "HEAD"], response_model=None)
def dashboard_redirect() -> RedirectResponse:
    return RedirectResponse(url="/dashboard/", status_code=307)


@app.api_route("/dashboard/", methods=["GET", "HEAD"], response_model=None)
def dashboard_index(request: Request) -> Response:
    index_html = DASHBOARD_DIR / "index.html"
    if not index_html.is_file():
        return _dashboard_not_built()
    return _file_response(index_html, request, no_cache=True)


@app.api_route("/dashboard/{full_path:path}", methods=["GET", "HEAD"], response_model=None)
def dashboard_spa(full_path: str, request: Request) -> Response:
    """SPA：优先静态资源，其余回退 index.html（深链 /dashboard/s/600036 等）。"""
    if not DASHBOARD_DIR.is_dir():
        return _dashboard_not_built()
    hit = _dashboard_file(full_path)
    if hit is not None:
        return _file_response(hit, request)
    suffix = Path(full_path).suffix.lower()
    if suffix in _DASHBOARD_ASSET_SUFFIXES:
        return Response(status_code=404, content="Not Found")
    index_html = DASHBOARD_DIR / "index.html"
    if not index_html.is_file():
        return _dashboard_not_built()
    return _file_response(index_html, request, no_cache=True)


# ---------- 大盘云图（wenyuanw/a-share-heatmap，Next.js basePath=/dapan）----------
_HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "content-encoding",
    "content-length",
}


def _dapan_unavailable() -> JSONResponse:
    return JSONResponse(
        {
            "ok": False,
            "error": (
                "大盘云图服务未启动。请先执行 ./scripts/build_dapan.sh，"
                "再用 ./run_web.sh 启动（会自动拉起 Next.js :8766）。"
            ),
        },
        status_code=503,
    )


def _proxy_dapan(path: str, request: Request) -> Response:
    """把 /dapan/* 反代到本地 Next.js（含 API 流式响应）。"""
    rel = path.lstrip("/")
    # Next.js（无 trailingSlash）以 /dapan 为规范路径，/dapan/ 会 308→/dapan；
    # 若本端再把 /dapan 307→/dapan/ 会形成环。索引页直连无尾斜杠。
    upstream_path = f"/dapan/{rel}" if rel else "/dapan"
    qs = request.url.query
    url = f"{DAPAN_UPSTREAM}{upstream_path}"
    if qs:
        url = f"{url}?{qs}"

    headers = {
        "User-Agent": request.headers.get("user-agent") or _BROWSER_UA,
        "Accept": request.headers.get("accept") or "*/*",
    }
    if "range" in request.headers:
        headers["Range"] = request.headers["range"]
    if "accept-language" in request.headers:
        headers["Accept-Language"] = request.headers["accept-language"]

    try:
        req = urllib.request.Request(url, headers=headers, method=request.method)
        upstream = urllib.request.urlopen(req, timeout=120)
    except urllib.error.HTTPError as exc:
        body = exc.read()
        out_headers = {
            k: v
            for k, v in exc.headers.items()
            if k.lower() not in _HOP_BY_HOP
        }
        return Response(content=body, status_code=exc.code, headers=out_headers)
    except (urllib.error.URLError, TimeoutError, OSError):
        return _dapan_unavailable()

    out_headers = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower() not in _HOP_BY_HOP
    }
    media = upstream.headers.get("Content-Type")

    def _iter():
        try:
            while True:
                chunk = upstream.read(65536)
                if not chunk:
                    break
                yield chunk
        finally:
            upstream.close()

    return StreamingResponse(
        _iter(),
        status_code=upstream.status,
        headers=out_headers,
        media_type=media,
    )


@app.api_route("/dapan", methods=["GET", "HEAD"], response_model=None)
def dapan_root(request: Request) -> Response:
    return _proxy_dapan("", request)


@app.api_route("/dapan/", methods=["GET", "HEAD"], response_model=None)
def dapan_index(_request: Request) -> Response:
    # 与上游 Next.js 一致：带尾斜杠时跳到无尾斜杠
    return RedirectResponse(url="/dapan", status_code=307)


@app.api_route("/dapan/{full_path:path}", methods=["GET", "HEAD"], response_model=None)
def dapan_proxy(full_path: str, request: Request) -> Response:
    return _proxy_dapan(full_path, request)


def _to_eastmoney_secid(code: str) -> str | None:
    raw = (code or "").strip().lower()
    if not raw:
        return None
    market = ""
    symbol = raw
    if raw.startswith(("sh", "sz", "bj")):
        market = raw[:2]
        symbol = raw[2:]
    symbol = "".join(ch for ch in symbol if ch.isdigit())
    if not symbol:
        return None
    # 北交所 92/8/4 → 0.xxx；沪市 6/9（含 B 股 900）→ 1.xxx；其余深市 0.xxx
    if market == "bj" or symbol.startswith("92") or symbol.startswith(("8", "4")):
        return f"0.{symbol}"
    if market == "sh" or symbol.startswith(("6", "9")):
        return f"1.{symbol}"
    return f"0.{symbol}"


# 板块列表：东财 clist（行业 t:2 / 概念 t:3）；push2 不通时用新浪 FLJK 兜底
_EM_BOARD_FS = {
    "industry": "m:90+t:2+f:!50",
    "concept": "m:90+t:3+f:!50",
}
_SINA_BOARD_FLJK = "https://money.finance.sina.com.cn/q/view/newFLJK.php"
# industry=证监会行业；class=概念板块（新浪 param 命名）
_SINA_BOARD_PARAM = {
    "industry": "industry",
    "concept": "class",
}
_EM_BOARD_FIELDS = (
    "f12,f14,f2,f3,f4,f8,f20,f104,f105,f128,f136,f140,f141,f207,f208,f209"
)


def _num_or_none(v: Any) -> float | None:
    if v is None or v == "" or v == "-":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _em_board_list(board_type: str) -> list[dict[str, Any]]:
    """东财行业/概念板块全量列表（分页拉齐，不再只取 Top100）。"""
    fs = _EM_BOARD_FS[board_type]
    rows: list[dict[str, Any]] = []
    total_hint = 0
    for pn in range(1, 12):
        params = {
            "pn": str(pn),
            "pz": "100",
            "po": "1",
            "np": "1",
            "ut": "bd1d9ddb04089700cf9c27f6f7426281",
            "fltt": "2",
            "invt": "2",
            "fid": "f3",
            "fs": fs,
            "fields": _EM_BOARD_FIELDS,
        }
        try:
            diff = _em_clist_diff(params)
            # total 需单独请求首包；_em_clist_diff 只回 diff，这里再取一次首包 total
            if pn == 1:
                try:
                    data = _http_get_json(
                        f"{EM_CLIST}?{urllib.parse.urlencode(params)}"
                    )
                    total_hint = int((((data or {}).get("data") or {}).get("total")) or 0)
                except Exception:  # noqa: BLE001
                    total_hint = 0
        except Exception as e:  # noqa: BLE001
            if pn == 1:
                raise
            break
        if not diff:
            break
        for row in diff:
            code = str(row.get("f12") or "").strip()
            name = str(row.get("f14") or "").strip()
            if not code or not name:
                continue
            rows.append(
                {
                    "rank": 0,
                    "code": code,
                    "name": name,
                    "price": _num_or_none(row.get("f2")),
                    "change": _num_or_none(row.get("f4")),
                    "changePercent": _num_or_none(row.get("f3")),
                    "totalMarketCap": _num_or_none(row.get("f20")),
                    "turnoverRate": _num_or_none(row.get("f8")),
                    "riseCount": _num_or_none(row.get("f104")),
                    "fallCount": _num_or_none(row.get("f105")),
                    "leadingStock": (str(row.get("f128") or "").strip() or None),
                    "leadingStockChangePercent": _num_or_none(row.get("f136")),
                    "source": "eastmoney",
                    "sources": ["eastmoney"],
                }
            )
        if len(diff) < 100:
            break
        if total_hint and len(rows) >= total_hint:
            break

    # 去重（分页偶发重复）
    seen: set[str] = set()
    uniq: list[dict[str, Any]] = []
    for row in rows:
        if row["code"] in seen:
            continue
        seen.add(row["code"])
        uniq.append(row)
    rows = uniq

    rows.sort(
        key=lambda x: (
            x["changePercent"] is not None,
            x["changePercent"] if x["changePercent"] is not None else -1e18,
        ),
        reverse=True,
    )
    for i, row in enumerate(rows, start=1):
        row["rank"] = i
    return rows


def _ths_concept_board_list() -> list[dict[str, Any]]:
    """同花顺概念板块目录（抓取 q.10jqka.com.cn/gn/）。"""
    url = "https://q.10jqka.com.cn/gn/"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": _BROWSER_UA,
            "Referer": "https://q.10jqka.com.cn/",
            "Accept": "text/html,*/*",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read()
    # 页面多为 gbk
    text = raw.decode("gbk", errors="replace")
    pairs = re.findall(
        r"/gn/detail/code/(\d+)/[^>\"]*\"[^>]*>([^<]+)<",
        text,
    )
    if not pairs:
        pairs = re.findall(r"/gn/detail/code/(\d+)/[^>]*>([^<]+)<", text)
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for cid, name in pairs:
        cid = str(cid).strip()
        name = str(name).strip()
        if not cid or not name or cid in seen:
            continue
        seen.add(cid)
        rows.append(
            {
                "rank": 0,
                "code": f"ths:{cid}",
                "name": name,
                "price": None,
                "change": None,
                "changePercent": None,
                "totalMarketCap": None,
                "turnoverRate": None,
                "riseCount": None,
                "fallCount": None,
                "leadingStock": None,
                "leadingStockChangePercent": None,
                "source": "ths",
                "sources": ["ths"],
            }
        )
    rows.sort(key=lambda x: x["name"])
    for i, row in enumerate(rows, start=1):
        row["rank"] = i
    return rows


def _concept_name_key(name: str) -> str:
    s = str(name or "").strip()
    for suf in ("概念", "板块"):
        if len(s) > len(suf) and s.endswith(suf):
            s = s[: -len(suf)]
    return s.casefold()


def _merge_board_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """按名称合并多源板块；行情字段优先东财。"""
    buckets: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for row in rows:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        key = _concept_name_key(name)
        src = str(row.get("source") or (row.get("sources") or ["unknown"])[0])
        if key not in buckets:
            item = dict(row)
            item["name"] = name
            item["sources"] = [src]
            item["source"] = src
            buckets[key] = item
            order.append(key)
            continue
        cur = buckets[key]
        sources = list(cur.get("sources") or [])
        if src not in sources:
            sources.append(src)
        cur["sources"] = sources
        # 优先保留东财代码与行情
        if src == "eastmoney" or (
            "eastmoney" in sources and str(cur.get("source")) != "eastmoney"
        ):
            for field in (
                "code",
                "price",
                "change",
                "changePercent",
                "totalMarketCap",
                "turnoverRate",
                "riseCount",
                "fallCount",
                "leadingStock",
                "leadingStockChangePercent",
            ):
                if row.get(field) is not None:
                    cur[field] = row.get(field)
            cur["source"] = "eastmoney" if "eastmoney" in sources else sources[0]
            # 展示名：优先更长（如「储能概念」优于「储能」）
            if len(name) > len(str(cur.get("name") or "")):
                cur["name"] = name
        else:
            if len(name) > len(str(cur.get("name") or "")):
                cur["name"] = name
            cur["source"] = "eastmoney" if "eastmoney" in sources else sources[0]

    merged = [buckets[k] for k in order]
    merged.sort(
        key=lambda x: (
            x.get("changePercent") is not None,
            x.get("changePercent") if x.get("changePercent") is not None else -1e18,
            str(x.get("name") or ""),
        ),
        reverse=True,
    )
    for i, row in enumerate(merged, start=1):
        row["rank"] = i
    return merged


def _sina_board_list(board_type: str) -> list[dict[str, Any]]:
    """新浪板块涨跌榜（东财 push2 不通时的首页兜底）。"""
    param = _SINA_BOARD_PARAM[board_type]
    url = f"{_SINA_BOARD_FLJK}?{urllib.parse.urlencode({'param': param})}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": _BROWSER_UA,
            "Referer": "https://finance.sina.com.cn/",
            "Accept": "*/*",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=15.0) as resp:
        blob = resp.read()
    text = None
    for enc in ("gbk", "utf-8"):
        try:
            text = blob.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        text = blob.decode("utf-8", errors="replace")

    m = re.search(r"=\s*(\{.*\})\s*;?\s*$", text, re.S)
    if not m:
        raise RuntimeError("sina board payload missing")
    data = json.loads(m.group(1))
    rows: list[dict[str, Any]] = []
    for _, v in data.items():
        parts = str(v).split(",")
        if len(parts) < 12:
            continue
        code = parts[0].strip()
        name = parts[1].strip()
        if not code or not name:
            continue
        leading = ",".join(parts[12:]).strip() if len(parts) > 12 else parts[-1].strip()
        rows.append(
            {
                "rank": 0,
                "code": code,
                "name": name,
                "price": _num_or_none(parts[3]),
                "change": _num_or_none(parts[4]),
                "changePercent": _num_or_none(parts[5]),
                "totalMarketCap": None,
                "turnoverRate": None,
                "riseCount": None,
                "fallCount": None,
                "leadingStock": leading or None,
                "leadingStockChangePercent": _num_or_none(parts[9]),
            }
        )
    rows.sort(
        key=lambda x: (
            x["changePercent"] is not None,
            x["changePercent"] if x["changePercent"] is not None else -1e18,
        ),
        reverse=True,
    )
    for i, row in enumerate(rows, start=1):
        row["rank"] = i
    return rows


@app.get("/api/board/list")
def board_list(
    type: str = Query("industry", description="industry|concept"),
    source: str = Query(
        "eastmoney",
        description="eastmoney|ths|all|sina；概念支持 ths/all，行业暂无同花顺目录时回退东财",
    ),
) -> JSONResponse:
    """行业 / 概念板块涨跌榜。支持东财 / 同花顺 / 合并。"""
    board_type = (type or "industry").lower().strip()
    src = (source or "eastmoney").lower().strip()
    if board_type not in _EM_BOARD_FS:
        return JSONResponse(
            {"ok": False, "error": "type must be industry|concept"},
            status_code=400,
        )
    if src not in ("eastmoney", "ths", "all", "sina"):
        return JSONResponse(
            {"ok": False, "error": "source must be eastmoney|ths|all|sina"},
            status_code=400,
        )

    # 优先读库（定时同步）；库空再打实时接口
    db_items: list[dict[str, Any]] = []
    db_em_items: list[dict[str, Any]] = []
    db_ths_items: list[dict[str, Any]] = []
    try:
        from cache import board_concepts as bcm

        db_kind = "industry" if board_type == "industry" else "concept"
        if src in ("eastmoney", "all", "sina"):
            db_em_items = bcm.get_catalog_from_db(kind=db_kind, source="eastmoney") or []
        if src in ("ths", "all") and board_type == "concept":
            db_ths_items = bcm.get_catalog_from_db(kind="concept", source="ths") or []
        if src == "all":
            db_items = bcm.get_catalog_from_db(kind=db_kind, source="all") or []
        elif src == "eastmoney":
            db_items = db_em_items
        elif src == "ths":
            db_items = db_ths_items
    except Exception:  # noqa: BLE001
        pass

    em_error: str | None = None
    ths_error: str | None = None
    em_items: list[dict[str, Any]] = []
    ths_items: list[dict[str, Any]] = []

    # 东财：库有目录则直接返回（可再用本库成份聚合补缺字段）
    if src == "eastmoney" and db_em_items:
        items = list(db_em_items)
        try:
            from cache import board_concepts as bcm

            items = bcm.enrich_board_items_from_db(
                items,
                source="eastmoney",
                kind="industry" if board_type == "industry" else "concept",
                only_missing=True,
            )
        except Exception:  # noqa: BLE001
            pass
        return JSONResponse(
            {
                "ok": True,
                "type": board_type,
                "items": items,
                "source": "db:eastmoney",
                "fromDb": True,
                "statsSource": "db_aggregate",
            }
        )

    if src in ("eastmoney", "all", "sina"):
        try:
            em_items = _em_board_list(board_type)
        except Exception as e:  # noqa: BLE001
            em_error = str(e) or type(e).__name__

    ths_from_db = False
    if src in ("ths", "all") and board_type == "concept":
        if db_ths_items:
            ths_items = db_ths_items
            ths_from_db = True
        else:
            try:
                ths_items = _ths_concept_board_list()
            except Exception as e:  # noqa: BLE001
                ths_error = str(e) or type(e).__name__

    if src == "ths":
        items = ths_items or db_items
        if items and board_type == "concept":
            try:
                from cache import board_concepts as bcm

                items = bcm.enrich_board_items_from_db(
                    items, source="ths", kind="concept", only_missing=True
                )
            except Exception:  # noqa: BLE001
                pass
        if items:
            return JSONResponse(
                {
                    "ok": True,
                    "type": board_type,
                    "items": items,
                    "source": "db:ths" if ths_from_db else "ths+db",
                    "fromDb": bool(ths_from_db),
                    "statsSource": "db_aggregate",
                }
            )
        return JSONResponse(
            {"ok": False, "error": f"ths: {ths_error or 'empty'}"},
            status_code=502,
        )

    if src == "all":
        # 合并优先用库；库缺一侧再补实时
        use_em = db_em_items or em_items
        use_ths = db_ths_items if board_type == "concept" else []
        if board_type == "concept" and not use_ths and ths_items:
            use_ths = ths_items
        if not use_em and em_items:
            use_em = em_items
        merged = _merge_board_rows([*use_em, *use_ths]) if (use_em or use_ths) else []
        if merged:
            return JSONResponse(
                {
                    "ok": True,
                    "type": board_type,
                    "items": merged,
                    "source": "db:all" if (db_em_items or db_ths_items) else "all",
                    "fromDb": bool(db_em_items or db_ths_items),
                    "sources": {
                        "eastmoney": len(use_em),
                        "ths": len(use_ths),
                    },
                    "errors": {
                        k: v
                        for k, v in {
                            "eastmoney": em_error,
                            "ths": ths_error,
                        }.items()
                        if v
                    }
                    or None,
                }
            )
        if db_items:
            return JSONResponse(
                {
                    "ok": True,
                    "type": board_type,
                    "items": db_items,
                    "source": f"db:{src}",
                    "fromDb": True,
                }
            )

    if em_items and src in ("eastmoney", "all", "sina"):
        if src == "eastmoney" or (src == "all" and not ths_items and not db_ths_items):
            return JSONResponse(
                {
                    "ok": True,
                    "type": board_type,
                    "items": em_items,
                    "source": "eastmoney",
                    "fallbackFrom": f"ths: {ths_error}" if ths_error else None,
                }
            )

    if src == "eastmoney" and em_items:
        return JSONResponse(
            {"ok": True, "type": board_type, "items": em_items, "source": "eastmoney"}
        )

    if db_items and src in ("eastmoney", "all"):
        return JSONResponse(
            {
                "ok": True,
                "type": board_type,
                "items": db_items,
                "source": f"db:{src}",
                "fromDb": True,
                "fallbackFrom": f"eastmoney: {em_error}" if em_error else None,
            }
        )

    try:
        items = _sina_board_list(board_type)
        for row in items:
            row["source"] = "sina"
            row["sources"] = ["sina"]
        return JSONResponse(
            {
                "ok": True,
                "type": board_type,
                "items": items,
                "source": "sina",
                "fallbackFrom": f"eastmoney: {em_error}" if em_error else None,
            }
        )
    except Exception as e:  # noqa: BLE001
        if db_items:
            return JSONResponse(
                {
                    "ok": True,
                    "type": board_type,
                    "items": db_items,
                    "source": f"db:{src}",
                    "fromDb": True,
                    "fallbackFrom": f"eastmoney: {em_error}; sina: {e}",
                }
            )
        return JSONResponse(
            {
                "ok": False,
                "error": f"eastmoney: {em_error}; ths: {ths_error}; sina: {e}",
            },
            status_code=502,
        )


@app.get("/api/board/detail")
def board_detail(
    type: str = Query("concept", description="concept|industry"),
    code: str = Query(..., description="如 ths:308582 或 BK1716"),
    source: str = Query("auto", description="auto|ths|eastmoney|all"),
) -> JSONResponse:
    """板块详情：东财/同花顺均走本库成份聚合。"""
    board_type = (type or "concept").lower().strip()
    raw = (code or "").strip()
    src = (source or "auto").lower().strip()
    if board_type not in ("concept", "industry"):
        return JSONResponse(
            {"ok": False, "error": "type must be concept|industry"},
            status_code=400,
        )
    if src == "auto":
        if raw.startswith("ths:"):
            use_src = "ths"
        elif raw.upper().startswith("BK"):
            use_src = "eastmoney"
        else:
            use_src = "eastmoney"
    elif src == "all":
        use_src = "ths" if raw.startswith("ths:") else "eastmoney"
    else:
        use_src = src
    try:
        from cache import board_concepts as bcm

        data = bcm.get_concept_constituents_from_db(
            raw, source=use_src, kind=board_type
        )
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
    if not data.get("board"):
        return JSONResponse({"ok": False, "error": "board not found"}, status_code=404)
    return JSONResponse(
        {
            "ok": True,
            "type": board_type,
            "source": "db_aggregate",
            "board": data["board"],
            "items": data.get("items") or [],
            "count": len(data.get("items") or []),
        }
    )


@app.get("/api/board/constituents")
def board_constituents(
    type: str = Query("concept", description="concept|industry"),
    code: str = Query(..., description="ths:ID / BK代码 / 概念名"),
    source: str = Query("auto", description="auto|ths|eastmoney|all"),
) -> JSONResponse:
    """库内板块成份股（对照本库行情）。"""
    return board_detail(type=type, code=code, source=source)


@app.get("/api/stock-industries")
def stock_industries(
    codes: str = Query(..., description="逗号分隔股票代码，如 300296,600036"),
) -> JSONResponse:
    """批量查询所属行业（东财 f100）。"""
    parts = [p.strip() for p in (codes or "").split(",") if p.strip()]
    secids = []
    seen: set[str] = set()
    for p in parts:
        sid = _to_eastmoney_secid(p)
        if sid and sid not in seen:
            seen.add(sid)
            secids.append(sid)
    if not secids:
        return JSONResponse({"ok": True, "industries": {}})

    params = {
        "fltt": "2",
        "fields": "f12,f100",
        "secids": ",".join(secids),
    }
    url = f"https://push2.eastmoney.com/api/qt/ulist.np/get?{urllib.parse.urlencode(params)}"
    try:
        data = _http_get_json(url)
    except _http_errors() as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=502)

    industries: dict[str, str] = {}
    for row in _normalize_diff((((data or {}).get("data") or {}).get("diff"))):
        code = str(row.get("f12") or "").strip()
        industry = str(row.get("f100") or "").strip()
        if code and industry:
            industries[code] = industry
    return JSONResponse({"ok": True, "industries": industries})


# 个股概念：东财 F10 + 同花顺 concept.php；进程内缓存
_STOCK_CONCEPT_TTL = 60 * 60
_STOCK_CONCEPT_LOCK = threading.Lock()
_STOCK_CONCEPT_CACHE: dict[str, dict[str, Any]] = {}


def _em_clist_diff(params: dict[str, str]) -> list[dict[str, Any]]:
    qs = urllib.parse.urlencode(params)
    mirrors = (
        EM_CLIST,
        "https://79.push2.eastmoney.com/api/qt/clist/get",
        "https://17.push2.eastmoney.com/api/qt/clist/get",
        "https://29.push2.eastmoney.com/api/qt/clist/get",
    )
    last_err: Exception | None = None
    for base in mirrors:
        try:
            data = _http_get_json(f"{base}?{qs}")
            return _normalize_diff((((data or {}).get("data") or {}).get("diff")))
        except _http_errors() as e:
            last_err = e
    raise RuntimeError(str(last_err) if last_err else "eastmoney clist failed")


def _pure_a_share_code(raw: str) -> str:
    s = str(raw or "").strip()
    s = re.sub(r"^(sh|sz|bj)", "", s, flags=re.I)
    s = re.sub(r"\.(SH|SZ|BJ)$", "", s, flags=re.I)
    return "".join(ch for ch in s if ch.isdigit())


def _em_sec_prefix(code: str) -> str:
    """东财 F10 用 SH/SZ/BJ 前缀。北交所 92/8/4 须优先于沪市 9 开头判断。"""
    c = _pure_a_share_code(code)
    if c.startswith("92") or c.startswith(("8", "4")):
        return f"BJ{c}"
    if c.startswith(("6", "9")):
        return f"SH{c}"
    return f"SZ{c}"


def _em_stock_boards(code: str) -> list[dict[str, Any]]:
    """按个股拉东财所属板块（F10 CoreConception）。"""
    pure = _pure_a_share_code(code)
    if not pure:
        return []
    em_code = _em_sec_prefix(pure)
    url = (
        "https://emweb.securities.eastmoney.com/PC_HSF10/CoreConception/PageAjax"
        f"?code={urllib.parse.quote(em_code)}"
    )
    try:
        data = _http_get_json(url, timeout=12.0)
    except _http_errors():
        return []
    out: list[dict[str, Any]] = []
    for row in data.get("ssbk") or []:
        if not isinstance(row, dict):
            continue
        name = str(row.get("BOARD_NAME") or "").strip()
        if not name:
            continue
        out.append(
            {
                "name": name,
                "source": "eastmoney",
                "kind": "concept",
                "boardCode": str(row.get("BOARD_CODE") or "").strip() or None,
            }
        )
    # 用 datacenter 补 BOARD_TYPE（更准）
    try:
        q = urllib.parse.urlencode(
            {
                "reportName": "RPT_F10_CORETHEME_BOARDTYPE",
                "columns": "ALL",
                "filter": f'(SECURITY_CODE="{pure}")',
                "pageNumber": "1",
                "pageSize": "50",
                "sortTypes": "1",
                "sortColumns": "BOARD_RANK",
                "source": "WEB",
                "client": "WEB",
            }
        )
        typed = _http_get_json(
            f"https://datacenter-web.eastmoney.com/api/data/v1/get?{q}",
            timeout=12.0,
        )
        by_name = {
            str(x.get("BOARD_NAME") or "").strip(): x
            for x in ((typed.get("result") or {}).get("data") or [])
            if isinstance(x, dict)
        }
        for item in out:
            meta = by_name.get(item["name"]) or {}
            btype = str(meta.get("BOARD_TYPE") or "").strip()
            if btype == "行业":
                item["kind"] = "industry"
            elif btype == "板块":
                item["kind"] = "region"
            else:
                item["kind"] = "concept"
    except _http_errors():
        pass
    return out


def _ths_stock_concepts(code: str) -> list[dict[str, Any]]:
    """按个股拉同花顺概念题材。"""
    pure = _pure_a_share_code(code)
    if not pure:
        return []
    url = f"https://basic.10jqka.com.cn/api/stockph/concept.php?code={urllib.parse.quote(pure)}"
    try:
        raw = _http_get_text(
            url,
            timeout=12.0,
            referer="https://basic.10jqka.com.cn/",
            headers={"Accept": "application/json,*/*"},
        )
        data = json.loads(raw)
    except Exception:  # noqa: BLE001
        return []
    if not isinstance(data, dict):
        return []
    status = data.get("status_code")
    if status is not None and int(status) != 0:
        return []
    out: list[dict[str, Any]] = []
    for row in data.get("data") or []:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        out.append(
            {
                "name": name,
                "source": "ths",
                "kind": "concept",
                "boardCode": str(row.get("plateid") or row.get("cid") or "").strip()
                or None,
            }
        )
    return out


def _merge_concept_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """名称去重（储能/储能概念 视为同一），合并 sources。"""
    buckets: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for row in items:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        key = _concept_name_key(name)
        src = str(row.get("source") or "unknown")
        kind = str(row.get("kind") or "concept")
        if key not in buckets:
            buckets[key] = {
                "name": name,
                "sources": [src],
                "kinds": [kind],
            }
            order.append(key)
            continue
        cur = buckets[key]
        if src not in cur["sources"]:
            cur["sources"].append(src)
        if kind not in cur["kinds"]:
            cur["kinds"].append(kind)
        if len(name) > len(str(cur.get("name") or "")):
            cur["name"] = name
    return [buckets[k] for k in order]


def _fetch_stock_concepts_merged(code: str, *, force: bool = False) -> list[dict[str, Any]]:
    pure = _pure_a_share_code(code)
    if not pure:
        return []
    now = time.time()
    with _STOCK_CONCEPT_LOCK:
        cached = _STOCK_CONCEPT_CACHE.get(pure)
        if (
            not force
            and cached
            and now - float(cached.get("ts") or 0) < _STOCK_CONCEPT_TTL
        ):
            return list(cached.get("items") or [])

    em_items: list[dict[str, Any]] = []
    ths_items: list[dict[str, Any]] = []
    try:
        em_items = _em_stock_boards(pure)
    except Exception:  # noqa: BLE001
        em_items = []
    try:
        ths_items = _ths_stock_concepts(pure)
    except Exception:  # noqa: BLE001
        ths_items = []
    # 行情概念列：排除纯行业（保留 region/concept/风格）
    filtered = [
        x
        for x in [*em_items, *ths_items]
        if str(x.get("kind") or "concept") != "industry"
    ]
    merged = _merge_concept_items(filtered)
    # 失败/空结果不写长缓存，避免把暂时失败钉死成「无概念」
    if merged:
        with _STOCK_CONCEPT_LOCK:
            _STOCK_CONCEPT_CACHE[pure] = {"ts": now, "items": merged}
    return merged


@app.get("/api/stock-concepts")
def stock_concepts(
    codes: str = Query(
        "",
        description="逗号分隔股票代码；优先读库，缺省再按个股拉取",
    ),
    force: int = Query(0, description="1=忽略库/缓存强制联网拉取"),
    category: str = Query(
        "concept",
        description="concept|board|all；concept=概念，board=行业+地域板块",
    ),
) -> JSONResponse:
    """股票所属概念/板块：优先 SQLite 入库数据，缺失时再拉东财+同花顺。"""
    cat = (category or "concept").lower().strip()
    if cat not in ("concept", "board", "all"):
        return JSONResponse(
            {"ok": False, "error": "category must be concept|board|all"},
            status_code=400,
        )
    parts = [p.strip() for p in (codes or "").split(",") if p.strip()]
    pure_codes: list[str] = []
    seen: set[str] = set()
    for raw in parts:
        pure = _pure_a_share_code(raw)
        if pure and pure not in seen:
            seen.add(pure)
            pure_codes.append(pure)

    if not pure_codes:
        return JSONResponse(
            {
                "ok": True,
                "source": "db",
                "category": cat,
                "total": 0,
                "concepts": {},
                "boards": {},
                "hint": "请传 codes=002535,000001",
            }
        )

    force_flag = bool(force)
    from_db: dict[str, list[dict[str, Any]]] = {}
    if not force_flag:
        try:
            from cache import board_concepts as bcm

            from_db = bcm.get_stock_items_from_db(pure_codes, category="all")
        except Exception:  # noqa: BLE001
            from_db = {}

    missing = [c for c in pure_codes if c not in from_db or not from_db.get(c)]
    live: dict[str, list[dict[str, Any]]] = {}

    def _one(c: str) -> tuple[str, list[dict[str, Any]]]:
        try:
            # 全量项（含 industry/region/concept）
            from cache import board_concepts as bcm

            items = bcm.fetch_stock_items_merged(c)
            if items:
                try:
                    bcm.save_stock_items(c, items)
                except Exception:  # noqa: BLE001
                    pass
            return c, items
        except Exception:  # noqa: BLE001
            # 回退旧路径（仅非行业）
            try:
                return c, _fetch_stock_concepts_merged(c, force=True)
            except Exception:  # noqa: BLE001
                return c, []

    if missing or force_flag:
        todo = pure_codes if force_flag else missing
        workers = min(6, max(2, len(todo)))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futs = [pool.submit(_one, c) for c in todo]
            for fut in as_completed(futs):
                code, items = fut.result()
                if items:
                    live[code] = items

    merged_all: dict[str, list[dict[str, Any]]] = {}
    for c in pure_codes:
        items = live.get(c) or from_db.get(c) or []
        if items:
            merged_all[c] = items

    def _split(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        concepts: list[dict[str, Any]] = []
        boards: list[dict[str, Any]] = []
        for x in items:
            kind = str(x.get("kind") or "")
            kinds = [str(k) for k in (x.get("kinds") or [])]
            if kind in ("industry", "region") or any(
                k in ("industry", "region") for k in kinds
            ):
                boards.append(x)
            else:
                concepts.append(x)
        return concepts, boards

    concepts_out: dict[str, list[dict[str, Any]]] = {}
    boards_out: dict[str, list[dict[str, Any]]] = {}
    for code, items in merged_all.items():
        c_list, b_list = _split(items)
        if c_list:
            concepts_out[code] = c_list
        if b_list:
            boards_out[code] = b_list

    payload: dict[str, Any] = {
        "ok": True,
        "source": "db+live" if live else ("db" if from_db else "live"),
        "category": cat,
        "sources": ["eastmoney", "ths"],
        "requested": len(pure_codes),
        "total": len(merged_all),
        "concepts": concepts_out if cat in ("concept", "all") else {},
        "boards": boards_out if cat in ("board", "all") else {},
    }
    if cat == "concept":
        payload["items"] = concepts_out
    elif cat == "board":
        payload["items"] = boards_out
    else:
        payload["items"] = merged_all
    return JSONResponse(payload)

@app.post("/api/symbols/resolve-batch")
async def symbols_resolve_batch(request: Request) -> JSONResponse:
    """批量解析代码/名称 token → 本库 symbol（模糊匹配）。"""
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    if not isinstance(body, dict):
        body = {}
    tokens = body.get("tokens") or []
    if not isinstance(tokens, list):
        return JSONResponse({"ok": False, "error": "tokens must be a list"}, status_code=400)
    try:
        limit = int(body.get("limit") or 8)
    except (TypeError, ValueError):
        limit = 8
    try:
        from cache.symbol_resolve import resolve_tokens

        items = resolve_tokens([str(t) for t in tokens], limit_per_token=limit)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
    matched = sum(1 for x in items if x.get("best"))
    return JSONResponse(
        {
            "ok": True,
            "count": len(items),
            "matched": matched,
            "items": items,
        }
    )


@app.get("/api/symbols")
def symbol_list(
    market: str = Query("cn", description="cn|hk|us|fund|index"),
    page: int = Query(1, ge=1),
    size: int = Query(60, ge=1, le=100),
    q: str = Query("", description="可选：代码/名称过滤（服务端粗滤）"),
) -> JSONResponse:
    market = (market or "cn").lower().strip()
    fs = MARKET_FS.get(market)
    if not fs:
        return JSONResponse({"ok": False, "error": f"unsupported market: {market}"}, status_code=400)

    params = {
        "pn": str(page),
        "pz": str(size),
        "po": "1",
        "np": "1",
        "fltt": "2",
        "invt": "2",
        "fid": "f6",
        "fs": fs,
        "fields": "f12,f13,f14",
    }
    url = f"{EM_CLIST}?{urllib.parse.urlencode(params)}"
    em_error: str | None = None
    try:
        data = _http_get_json(url)
        diff = _normalize_diff((((data or {}).get("data") or {}).get("diff")))
        total = int((((data or {}).get("data") or {}).get("total")) or 0)
        qn = q.strip().lower()
        items: list[dict[str, Any]] = []
        for row in diff:
            code = str(row.get("f12") or "")
            name = str(row.get("f14") or "")
            try:
                mkt = int(row.get("f13") or 0)
            except (TypeError, ValueError):
                mkt = 0
            if qn and qn not in code.lower() and qn not in name.lower():
                continue
            symbol = _to_symbol(code, mkt, market)
            items.append(
                {
                    "symbol": symbol,
                    "code": code,
                    "name": name,
                    "market": market,
                    "marketLabel": MARKET_LABEL.get(market, market.upper()),
                    "exchange": EXCHANGE_BY_MKT.get(mkt, MARKET_LABEL.get(market, "")),
                    "category": "stock" if market in ("cn", "hk", "us") else market,
                }
            )

        return JSONResponse(
            {
                "ok": True,
                "market": market,
                "page": page,
                "size": size,
                "total": total,
                "items": items,
                "source": "eastmoney",
            }
        )
    except _http_errors() as e:
        em_error = str(e) or type(e).__name__

    # 东财 push2 常被断开：A 股 / ETF 走新浪兜底，避免 500
    if market in SINA_HQ_NODE:
        try:
            payload = _sina_symbol_list(market, page, size, q)
            if em_error:
                payload["fallbackFrom"] = f"eastmoney: {em_error}"
            return JSONResponse(payload)
        except _http_errors() as e:
            return JSONResponse(
                {
                    "ok": False,
                    "error": f"eastmoney: {em_error}; sina: {e}",
                },
                status_code=502,
            )

    return JSONResponse(
        {"ok": False, "error": em_error or "symbol list failed"},
        status_code=502,
    )


@app.get("/api/yf/markets")
def yf_markets() -> JSONResponse:
    return JSONResponse({"ok": True, "markets": YF_MARKETS})


@app.get("/api/yf/symbols")
def yf_symbols(
    market: str = Query(
        "COMMODITIES",
        description="US|GB|ASIA|EUROPE|RATES|COMMODITIES|METALS|CURRENCIES|CRYPTOCURRENCIES",
    ),
    q: str = Query("", description="代码/中英文名过滤"),
    refresh: int = Query(0, description="1=跳过列表缓存"),
) -> JSONResponse:
    market = (market or "COMMODITIES").upper().strip()
    valid = {m["code"] for m in YF_MARKETS}
    if market not in valid:
        return JSONResponse(
            {"ok": False, "error": f"unsupported yf market: {market}", "valid": sorted(valid)},
            status_code=400,
        )
    items, live = _yf_items_cached(market, force=bool(refresh))
    qn = q.strip().lower()
    if qn:
        items = [
            x
            for x in items
            if qn in str(x.get("code", "")).lower()
            or qn in str(x.get("name", "")).lower()
            or qn in str(x.get("nameEn", "")).lower()
        ]
    return JSONResponse(
        {
            "ok": True,
            "market": market,
            "marketLabel": market_label(market),
            "live": live,
            "total": len(items),
            "items": items,
        }
    )


def _yf_quote_from_bars(symbol: str, *, force: bool = False) -> dict[str, Any] | None:
    """用日 K 最近两根推算列表行情字段（现价/涨跌/量/开高低/昨收）。"""
    try:
        bars = _yf_kline_cached(symbol, period="1d", force=force)
    except Exception:
        return None
    if not bars:
        return None
    last = bars[-1]
    prev = bars[-2] if len(bars) > 1 else None
    price = float(last.get("close") or 0)
    prev_close = float(prev["close"]) if prev and prev.get("close") is not None else None
    change = (price - prev_close) if prev_close is not None else None
    change_pct = (change / prev_close * 100.0) if change is not None and prev_close else None
    open_ = last.get("open")
    high = last.get("high")
    low = last.get("low")
    volume = last.get("volume")
    amount = None
    try:
        if volume is not None and price:
            # Yahoo 成交额单位不一，这里用 现价×量 作近似（万为单位不强制）
            amount = float(volume) * float(price) / 10000.0
    except Exception:
        amount = None
    amp = None
    try:
        if prev_close and high is not None and low is not None:
            amp = (float(high) - float(low)) / float(prev_close) * 100.0
    except Exception:
        amp = None
    return {
        "symbol": symbol,
        "code": symbol,
        "name": translate_name(symbol),
        "price": price,
        "change": change,
        "changePercent": change_pct,
        "open": float(open_) if open_ is not None else None,
        "prevClose": prev_close,
        "high": float(high) if high is not None else None,
        "low": float(low) if low is not None else None,
        "volume": float(volume) if volume is not None else None,
        "amount": amount,
        "amplitude": amp,
        # 指数/期货/外汇通常无统一 PE/PB/市值
        "pe": None,
        "pb": None,
        "totalMarketCap": None,
        "circulatingMarketCap": None,
        "turnoverRate": None,
        "volumeRatio": None,
    }


@app.get("/api/yf/quotes")
def yf_quotes(
    symbols: str = Query(..., description="逗号分隔 Yahoo 代码，如 BTC-USD,GC=F,^GSPC"),
    refresh: int = Query(0, description="1=跳过日 K 缓存"),
) -> JSONResponse:
    """批量补齐 yfinance 列表行情（基于日 K，带缓存）。"""
    parts = [p.strip() for p in (symbols or "").split(",") if p.strip()]
    cleaned: list[str] = []
    seen: set[str] = set()
    for p in parts:
        s = p[3:] if p.lower().startswith("yf:") else p
        if s and s not in seen:
            seen.add(s)
            cleaned.append(s)
    if not cleaned:
        return JSONResponse({"ok": True, "quotes": []})
    # 限制单次数量，避免打爆 Yahoo
    cleaned = cleaned[:60]
    force = bool(refresh)

    def _one(sym: str) -> dict[str, Any] | None:
        return _yf_quote_from_bars(sym, force=force)

    quotes: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = {pool.submit(_one, sym): sym for sym in cleaned}
        for fut in as_completed(futs):
            row = fut.result()
            if row:
                quotes.append(row)
    # 保持请求顺序
    by_code = {q["code"]: q for q in quotes}
    ordered = [by_code[c] for c in cleaned if c in by_code]
    return JSONResponse({"ok": True, "quotes": ordered, "total": len(ordered)})


@app.get("/api/yf/kline")
def yf_kline(
    symbol: str = Query(..., description="Yahoo 代码，如 GC=F / BTC-USD / ^GSPC"),
    period: str = Query("1d", description="1m|5m|15m|1h|1d|1w"),
) -> JSONResponse:
    symbol = (symbol or "").strip()
    if symbol.lower().startswith("yf:"):
        symbol = symbol[3:]
    if not symbol:
        return JSONResponse({"ok": False, "error": "empty symbol"}, status_code=400)
    try:
        bars = _yf_kline_cached(symbol, period=period)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=502)
    if not bars:
        return JSONResponse(
            {"ok": False, "error": f"yfinance 无 K 线: {symbol}"},
            status_code=404,
        )
    return JSONResponse(
        {
            "ok": True,
            "symbol": symbol,
            "name": translate_name(symbol),
            "period": period,
            "bars": bars,
            "count": len(bars),
        }
    )


# ---------- 犀利 / xnge 通达信插件中转 ----------
# 原站 t.xnge.cn 校验 UA 含 TdxW；##tdxbkcolor## 为通达信背景色占位符。
TDX_UA = (
    "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36 TdxW"
)
XUANGUBAO_POOL = "https://flash-api.xuangubao.cn/api/pool/detail"
XUANGUBAO_PLATE_DATA = "https://flash-api.xuangubao.cn/api/plate/data"
XUANGUBAO_STOCK_MESSAGES = "https://api.xuangubao.com.cn/api/stocks/messages"
XNGE_ORIGIN = "http://t.xnge.cn"
# 涨停异动页的行业/概念/历史涨停原因来自 ace.xnge.cn/json/{dm,zt}/...
# 该 CDN 仅对 Origin=t.xnge.cn 回 CORS；本站中转后浏览器被拦，需同源反代。
ACE_ORIGIN = "http://ace.xnge.cn"


def _normalize_xnge_bg(raw: str | None) -> str:
    """通达信 ##tdxbkcolor## → 可用的 6 位 hex。"""
    bg = (raw or "000000").strip()
    if not bg or bg.startswith("##") or "tdxbkcolor" in bg.lower():
        return "000000"
    bg = bg.lstrip("#")
    if bg == "000000":
        # 原站脚本对纯黑有特殊处理，改为 000001
        return "000001"
    return bg


def _fetch_xnge_html(upstream: str) -> str:
    """拉取犀利 HTML：优先 urllib + TdxW UA；失败再用 curl_cffi。"""
    headers = {
        "User-Agent": TDX_UA,
        "Accept": "text/html,application/xhtml+xml",
        "Referer": "http://www.tdx.com.cn/",
    }
    try:
        return _http_get_text(upstream, headers=headers)
    except (urllib.error.URLError, TimeoutError, OSError) as first:
        try:
            from curl_cffi import requests as curl_requests

            resp = curl_requests.get(
                upstream,
                headers=headers,
                impersonate="chrome120",
                timeout=15,
            )
            resp.raise_for_status()
            return resp.text
        except Exception as second:  # noqa: BLE001
            raise RuntimeError(f"{first}; fallback: {second}") from second


def _rewrite_ace_asset_urls(html: str, ace_abs: str) -> str:
    """把页面里的 ace.xnge.cn 资源改写为本站 /ace 绝对地址。

    局域网用 192.168.x.x 打开时，浏览器往往直连不到 ace CDN；
    且 <base href=t.xnge.cn> 会把相对 /ace 解析回原站。必须写死当前 Host。
    """
    if not html or not ace_abs:
        return html
    return (
        html.replace("https://ace.xnge.cn", ace_abs)
        .replace("http://ace.xnge.cn", ace_abs)
        .replace("//ace.xnge.cn", ace_abs)
    )


def _proxy_xnge_html(
    path: str,
    query: dict[str, str],
    *,
    request: Request | None = None,
) -> Response:
    """用 TdxW UA 拉取 t.xnge.cn 任意路径 HTML。"""
    path = (path or "").lstrip("/")
    # 目录页补尾斜杠，避免相对资源错位
    if path and not path.endswith("/") and "." not in path.rsplit("/", 1)[-1]:
        path = path + "/"
    params = dict(query)
    params["bg"] = _normalize_xnge_bg(params.get("bg"))
    if "hidenav" not in params:
        params["hidenav"] = "1"
    qs = urllib.parse.urlencode(params, doseq=True)
    upstream = f"{XNGE_ORIGIN}/{path}"
    if qs:
        upstream = f"{upstream}?{qs}"
    try:
        html = _fetch_xnge_html(upstream)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(e), "url": upstream}, status_code=502)

    # 去掉原站「每 N 秒整页 Refresh 跳转」（如 <meta http-equiv="Refresh" content="60; url=/fupan/" />）
    html = re.sub(
        r'<meta\b[^>]*http-equiv\s*=\s*[\'"]?refresh[\'"]?[^>]*>',
        '',
        html,
        flags=re.IGNORECASE,
    )

    # 按访问 Host 生成同源 ace 绝对前缀（局域网 192.168.x.x / 本机 127.0.0.1 都对）
    if request is not None:
        ace_abs = str(request.base_url).rstrip("/") + "/ace"
    else:
        ace_abs = "/ace"

    # 浅色模式下 .fupan-tit .tab 仍用深灰底(#353A40) + --WhiteBlack(#000)，对比度差；强制白字。
    # 宽表支持横向滚动，便于嵌入看板 iframe。
    # 隐藏「使用说明」及以下页脚广告/免责声明
    patch_css = (
        "<style id=\"mootdx-xnge-patch\">"
        ".fupan-tit .tab{color:#fff!important;}"
        "#tags a{color:#fff!important;}"
        "html,body{overflow-x:auto!important;}"
        ".help,footer{display:none!important;}"
        "</style>"
    )
    # 覆盖 tdx.js 的 openCode：代码/名称点击 → 本应用 K 线。
    # 上游多为 600178.SH / 000001.SZ，展示层已去掉市场后缀，需兼容裸 6 位码。
    patch_js = """<script id="mootdx-xnge-kline">
(function () {
  function toKlineSymbol(code) {
    var s = String(code == null ? "" : code).trim();
    if (!s) return "";
    s = s.replace(/\\.(?:SH|SZ|BJ|SS)$/i, "");
    s = s.replace(/^(?:SH|SZ|BJ|SS)/i, "");
    var m = s.match(/(\\d{6})/);
    return m ? m[1] : s;
  }
  function klineOrigin() {
    try {
      if (window.top && window.top.location && window.top.location.origin) {
        return window.top.location.origin;
      }
    } catch (e) {}
    return window.location.origin;
  }
  function openKline(code) {
    var sym = toKlineSymbol(code);
    if (!sym) return;
    var url = klineOrigin() + "/?symbol=" + encodeURIComponent(sym) + "&period=1d";
    try {
      window.top.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }
  function install() {
    window.openCode = function (code) { openKline(code); };
  }
  function killMetaRefresh() {
    try {
      document.querySelectorAll('meta[http-equiv="Refresh"],meta[http-equiv="refresh"]').forEach(function (el) {
        el.parentNode && el.parentNode.removeChild(el);
      });
    } catch (e) {}
  }
  install();
  killMetaRefresh();
  document.addEventListener("DOMContentLoaded", function () {
    install();
    killMetaRefresh();
  });
  window.addEventListener("load", function () {
    install();
    killMetaRefresh();
    setTimeout(install, 0);
    setTimeout(install, 300);
  });
})();
</script>"""
    # 锁定全局 ace → 本站 /ace 反代（必须用 location.origin 绝对地址，
    # 否则会被 <base href="t.xnge.cn"> 解析回原站而再次踩 CORS）。
    ace_lock_js = """<script id="mootdx-ace-cors">
(function () {
  var v = location.origin + "/ace";
  try {
    Object.defineProperty(window, "ace", {
      configurable: true,
      enumerable: true,
      get: function () { return v; },
      set: function () {}
    });
  } catch (e) {
    window.ace = v;
  }
})();
</script>"""
    # base 必须落在本站 /xnge/...，否则绝对路径 /404.html 会跟到 t.xnge.cn
    # （tdx.js 曾对 192.168 强制跳 /404.html）
    if request is not None:
        local_base = str(request.base_url).rstrip("/") + "/xnge/" + path
    else:
        local_base = "/xnge/" + path
    if not local_base.endswith("/"):
        local_base += "/"
    # 去掉上游自带 base，避免再指回 t.xnge.cn
    html = re.sub(r"<base\b[^>]*>", "", html, flags=re.IGNORECASE)

    head_bits: list[str] = [ace_lock_js, f'<base href="{local_base}" />', patch_css]
    injected = "<head>\n" + "\n".join(head_bits)
    # tdx.js 里 var ace='//ace.xnge.cn' 之后再钉一次（defineProperty 失败时兜底）
    # 此时 HTML 里可能已是绝对 /ace 地址，两种都匹配
    html = re.sub(
        r'(<script[^>]+(?:(?:ace\.xnge\.cn|/ace)/js/tdx\.js)[^>]*>\s*</script>)',
        r'\1<script>try{ace=location.origin+"/ace"}catch(e){}</script>',
        html,
        count=1,
        flags=re.IGNORECASE,
    )
    # 保险：页面内若还有内联局域网跳转也干掉
    html = re.sub(
        r"if\s*\(\s*window\.location\.href\.indexOf\(\s*['\"]192\.168['\"]\s*\)\s*>\s*0\s*\)\s*"
        r"window\.location\.href\s*=\s*['\"][^'\"]*404\.html['\"]\s*;?",
        "/* mootdx: skip lan 404 redirect */",
        html,
        flags=re.IGNORECASE,
    )
    if "<head>" in html:
        html = html.replace("<head>", injected, 1)
    elif "<Head>" in html:
        html = html.replace("<Head>", injected, 1)
    else:
        html = injected + "\n" + html
    # 放在 </body> 前，确保覆盖 tdx.js 里的 openCode
    if "</body>" in html:
        html = html.replace("</body>", patch_js + "\n</body>", 1)
    elif "</Body>" in html:
        html = html.replace("</Body>", patch_js + "\n</Body>", 1)
    else:
        html = html + patch_js
    # CSS/JS 等静态资源也走本站反代，避免局域网客户端直连不上 ace CDN
    html = _rewrite_ace_asset_urls(html, ace_abs)
    return Response(
        content=html,
        media_type="text/html; charset=utf-8",
        headers={
            "X-Xnge-Upstream": upstream,
            "X-Ace-Base": ace_abs,
        },
    )


@app.get("/fupan", response_model=None)
def fupan_demo() -> FileResponse:
    """本地涨停复盘 Demo（不依赖通达信内置浏览器）。"""
    return FileResponse(STATIC_DIR / "fupan.html")


_XGB_POOL_PAGE = STATIC_DIR / "xgb-pool.html"
_XGB_POOL_NAMES = frozenset(
    {
        "limit_up",
        "limit_down",
        "yesterday_limit_up",
        "stock_chance",
        "limit_up_broken",
    }
)


@app.get("/limit-up", response_model=None)
@app.get("/limit-up/", response_model=None)
@app.get("/limit-down", response_model=None)
@app.get("/limit-down/", response_model=None)
@app.get("/yesterday-limit-up", response_model=None)
@app.get("/yesterday-limit-up/", response_model=None)
@app.get("/xgb-pool", response_model=None)
@app.get("/xgb-pool/", response_model=None)
def xgb_pool_page() -> FileResponse:
    """选股宝同系列池页（涨停/跌停/昨涨停），按概念分组表格。"""
    # 避免局域网浏览器强缓存旧脚本（缺 nav 翻页）
    return FileResponse(
        _XGB_POOL_PAGE,
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
        },
    )


class KlineNavBody(BaseModel):
    id: str = Field(..., description="navId，与 URL ?nav= 一致")
    symbols: list[str] = Field(default_factory=list)
    i: int = 0
    dates: list[str] | None = None


@app.post("/api/kline-nav")
def kline_nav_put(body: KlineNavBody) -> JSONResponse:
    """写入短时翻页列表（补 iframe/局域网 localStorage 不可用）。"""
    from kline_nav_store import put_nav

    row = put_nav(body.id, body.symbols, body.i, dates=body.dates)
    if not row:
        return JSONResponse({"ok": False, "error": "invalid nav payload"}, status_code=400)
    return JSONResponse({"ok": True, **row})


@app.get("/api/kline-nav/{nav_id}")
def kline_nav_get(nav_id: str) -> JSONResponse:
    from kline_nav_store import get_nav

    row = get_nav(nav_id)
    if not row:
        return JSONResponse({"ok": False, "error": "nav not found"}, status_code=404)
    return JSONResponse({"ok": True, **row})


@app.get("/xnge", response_model=None)
@app.get("/xnge/", response_model=None)
def xnge_hub() -> FileResponse:
    """犀利插件通用中转入口（强势股 / 连板 / 复盘等）。"""
    return FileResponse(STATIC_DIR / "xnge.html")


@app.get("/xnge/{path:path}", response_model=None)
def xnge_proxy(path: str, request: Request) -> Response:
    """
    通用中转：/xnge/qsg/?hidenav=1&bg=000000
    对应原站 http://t.xnge.cn/qsg/?hidenav=1&bg=##tdxbkcolor##
    """
    query = {k: v for k, v in request.query_params.multi_items()}
    return _proxy_xnge_html(path, query, request=request)


def _guess_ace_media_type(path: str, content_type: str | None) -> str:
    """上游偶发把 JSON 标成 application/javascript，按扩展名纠正。"""
    ct = (content_type or "").split(";")[0].strip().lower()
    lower = path.lower()
    if lower.endswith(".js") and ("/json/" in lower or lower.endswith(".json")):
        return "application/json; charset=utf-8"
    if "/json/" in lower and lower.endswith(".js"):
        # ace 的 dm/zt 数据文件：*.js 实为 JSON
        return "application/json; charset=utf-8"
    if ct in ("", "application/octet-stream"):
        guessed, _ = mimetypes.guess_type(path)
        if guessed:
            return guessed
        if lower.endswith(".js"):
            return "application/javascript; charset=utf-8"
        return "application/octet-stream"
    if ct in ("application/javascript", "text/javascript", "application/json") and "charset" not in ct:
        return f"{ct}; charset=utf-8"
    return content_type or "application/octet-stream"


@app.get("/ace/{path:path}", response_model=None)
def ace_cdn_proxy(path: str, request: Request) -> Response:
    """
    同源反代 ace.xnge.cn，供涨停异动页拉取行业/概念/历史涨停 JSON。
    示例：/ace/json/zt/a/187d9a.js ← http://ace.xnge.cn/json/zt/a/187d9a.js
    """
    path = (path or "").lstrip("/")
    if not path or ".." in path.split("/"):
        return JSONResponse({"ok": False, "error": "invalid path"}, status_code=400)
    qs = request.url.query
    upstream = f"{ACE_ORIGIN}/{path}"
    if qs:
        upstream = f"{upstream}?{qs}"
    headers = {
        "User-Agent": TDX_UA,
        "Accept": "*/*",
        "Referer": f"{XNGE_ORIGIN}/",
        "Origin": XNGE_ORIGIN,
    }
    try:
        req = urllib.request.Request(upstream, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read()
            upstream_ct = resp.headers.get("Content-Type")
            status = getattr(resp, "status", 200) or 200
    except Exception as e:  # noqa: BLE001
        return JSONResponse(
            {"ok": False, "error": str(e), "url": upstream},
            status_code=502,
        )
    media = _guess_ace_media_type(path, upstream_ct)
    # JS：改写 ace CDN 地址 + 去掉局域网封禁跳转
    # tdx.js 原有：if (href.indexOf('192.168')>0) location.href='/404.html'
    # 配上 <base href=t.xnge.cn> 会跳到 http://t.xnge.cn/404.html
    if "javascript" in media and body:
        try:
            ace_abs = str(request.base_url).rstrip("/") + "/ace"
            text = body.decode("utf-8", errors="replace")
            if "ace.xnge.cn" in text:
                text = (
                    text.replace("https://ace.xnge.cn", ace_abs)
                    .replace("http://ace.xnge.cn", ace_abs)
                    .replace("//ace.xnge.cn", ace_abs)
                )
            # 中和犀利对 192.168 / 10.x 等内网地址的强制跳转
            text = re.sub(
                r"if\s*\(\s*window\.location\.href\.indexOf\(\s*['\"]192\.168['\"]\s*\)\s*>\s*0\s*\)\s*"
                r"window\.location\.href\s*=\s*['\"][^'\"]*404\.html['\"]\s*;?",
                "/* mootdx: skip lan 404 redirect */",
                text,
                flags=re.IGNORECASE,
            )
            text = re.sub(
                r"if\s*\(\s*window\.location\.href\.indexOf\(\s*['\"]10\.['\"]\s*\)\s*>\s*0\s*\)\s*"
                r"window\.location\.href\s*=\s*['\"][^'\"]*404\.html['\"]\s*;?",
                "/* mootdx: skip lan 404 redirect */",
                text,
                flags=re.IGNORECASE,
            )
            body = text.encode("utf-8")
        except Exception:  # noqa: BLE001
            pass
    # tdx.js 被改写（去局域网 404 跳转），禁止长缓存
    cache_ctrl = "no-cache" if "tdx.js" in path.lower() else "public, max-age=300"
    return Response(
        content=body,
        status_code=int(status),
        media_type=media,
        headers={
            "Cache-Control": cache_ctrl,
            "X-Ace-Upstream": upstream,
        },
    )


def _xuangubao_pool(pool_name: str) -> JSONResponse:
    try:
        items = _xuangubao_pool_items(pool_name)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as e:
        return JSONResponse({"ok": False, "error": str(e), "pool": pool_name}, status_code=502)
    return JSONResponse(
        {
            "ok": True,
            "source": "xuangubao",
            "pool": pool_name,
            "total": len(items),
            "items": items,
        }
    )


@app.get("/api/zt/limit-up")
def zt_limit_up() -> JSONResponse:
    """代理选股宝涨停池（与犀利 fupan.js 同源）。"""
    return _xuangubao_pool("limit_up")


@app.get("/api/zt/pool")
def zt_xuangubao_pool(
    pool: str = Query("limit_up", description="limit_up | limit_down | yesterday_limit_up | stock_chance | limit_up_broken"),
) -> JSONResponse:
    """代理选股宝 flash-api 同系列 pool_name。"""
    key = (pool or "limit_up").strip().lower()
    if key not in _XGB_POOL_NAMES:
        return JSONResponse(
            {
                "ok": False,
                "error": "pool 须为 " + " | ".join(sorted(_XGB_POOL_NAMES)),
                "error_code": "bad_pool",
            },
            status_code=400,
        )
    return _xuangubao_pool(key)


@app.get("/api/zt/plate-data")
def zt_plate_data(
    plates: str = Query(..., description="题材 plate_id，逗号分隔，如 26346142,123"),
    fields: str = Query(
        "core_avg_pcp,plate_name,rise_count,fall_count,stay_count,limit_up_count",
        description="选股宝 plate/data 字段列表",
    ),
) -> JSONResponse:
    """代理选股宝题材概况（涨跌幅/上涨下跌平盘家数），同源 flash-api /api/plate/data。"""
    ids = [p.strip() for p in (plates or "").split(",") if p.strip().isdigit()]
    if not ids:
        return JSONResponse({"ok": False, "error": "plates 须为数字 id"}, status_code=400)
    # 限制批量，避免滥用
    ids = ids[:40]
    field_list = [f.strip() for f in (fields or "").split(",") if f.strip()]
    if not field_list:
        field_list = [
            "core_avg_pcp",
            "plate_name",
            "rise_count",
            "fall_count",
            "stay_count",
            "limit_up_count",
        ]
    url = (
        f"{XUANGUBAO_PLATE_DATA}?"
        + urllib.parse.urlencode(
            {"plates": ",".join(ids), "fields": ",".join(field_list)}
        )
    )
    try:
        raw = _http_get_text(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; mootdx-plate/0.1)",
                "Accept": "application/json",
                "Referer": "https://xuangutong.com.cn/",
            },
        )
        payload = json.loads(raw)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=502)
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return JSONResponse(
            {"ok": False, "error": "unexpected upstream payload", "upstream": payload},
            status_code=502,
        )
    return JSONResponse(
        {
            "ok": True,
            "source": "xuangubao",
            "plates": ids,
            "data": data,
        }
    )


def _xuangubao_pool_items(pool_name: str) -> list[Any]:
    url = f"{XUANGUBAO_POOL}?{urllib.parse.urlencode({'pool_name': pool_name})}"
    raw = _http_get_text(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; mootdx-fupan/0.1)",
            "Accept": "application/json",
            "Referer": "https://xuangubao.cn/",
        },
    )
    payload = json.loads(raw)
    items = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        raise ValueError(f"unexpected upstream payload for {pool_name}")
    return items


def _xgb_yahoo_symbol(symbol: str) -> str | None:
    """页面 symbol → 选股宝 Symbol（300508.SZ / 600000.SS）。无效返回 None。"""
    from cache.providers.kline_fetch import _cn_to_yahoo

    raw = (symbol or "").strip()
    if not raw:
        return None
    # 已是 Yahoo/选股宝形态
    up = raw.upper()
    if re.fullmatch(r"\d{6}\.(SS|SZ|BJ)", up):
        return up
    code = re.sub(r"\D", "", raw.lower()[2:] if raw.lower().startswith(("sh", "sz", "bj")) else raw)
    if len(code) != 6:
        return None
    yf = _cn_to_yahoo(raw)
    if not re.fullmatch(r"\d{6}\.(SS|SZ|BJ)", yf):
        return None
    return yf


def _trim_xgb_stock_message(msg: dict[str, Any], target: str) -> dict[str, Any]:
    """裁剪单条消息，去掉超长关联股与客户端噪音字段。"""
    related = msg.get("RelatedStocks") if isinstance(msg.get("RelatedStocks"), list) else []
    stocks = msg.get("Stocks") if isinstance(msg.get("Stocks"), list) else []
    subj = msg.get("FromSubject") if isinstance(msg.get("FromSubject"), dict) else {}

    def _stock_row(s: Any) -> dict[str, str] | None:
        if not isinstance(s, dict):
            return None
        sym = str(s.get("Symbol") or "").strip()
        name = str(s.get("Name") or "").strip()
        if not sym and not name:
            return None
        return {"Name": name, "Symbol": sym}

    related_rows = [r for r in (_stock_row(s) for s in related) if r]
    stock_rows = [r for r in (_stock_row(s) for s in stocks) if r]
    has_target = any(r.get("Symbol") == target for r in related_rows) or any(
        r.get("Symbol") == target for r in stock_rows
    )

    return {
        "Id": str(msg.get("Id") or ""),
        "Title": str(msg.get("Title") or ""),
        "Summary": str(msg.get("Summary") or ""),
        "Source": str(msg.get("Source") or ""),
        "Style": int(msg.get("Style") or 0),
        "Labels": msg.get("Labels") if isinstance(msg.get("Labels"), list) else None,
        "CreatedAt": int(msg.get("CreatedAt") or 0),
        "UpdatedAt": int(msg.get("UpdatedAt") or 0),
        "Url": str(msg.get("Url") or ""),
        "ShareUrl": str(msg.get("ShareUrl") or ""),
        "ShareUrl2": str(msg.get("ShareUrl2") or ""),
        "OriginalUrl": str(msg.get("OriginalUrl") or ""),
        "IsPremium": bool(msg.get("IsPremium")),
        "LikeCount": int(msg.get("LikeCount") or 0),
        "FromSubject": {
            "Id": str(subj.get("Id") or ""),
            "Title": str(subj.get("Title") or ""),
        },
        "related_count": len(related_rows),
        "RelatedStocks": related_rows[:12],
        "Stocks": stock_rows[:12],
        "has_target": has_target,
    }


@app.get("/api/xgb/stocks/messages")
def xgb_stocks_messages(
    symbol: str = Query(..., description="如 sz300508 / 300508 / 300508.SZ"),
    limit: int = Query(20, ge=1, le=50),
    mark: str | None = Query(None, description="上一页 NextMark，翻页用"),
) -> JSONResponse:
    """代理选股宝个股消息流（资讯/公告/异动）。"""
    yahoo = _xgb_yahoo_symbol(symbol)
    if not yahoo:
        return JSONResponse(
            {
                "ok": False,
                "error": "请提供 A 股六位代码（如 sz300508）",
                "error_code": "bad_symbol",
            },
            status_code=400,
        )
    # 选股宝消息流样本以沪深为主；北交所仍转发，空列表由前端展示
    params: dict[str, str] = {"Symbol": yahoo, "Limit": str(limit)}
    if mark is not None and str(mark).strip() != "":
        params["Mark"] = str(mark).strip()
    url = f"{XUANGUBAO_STOCK_MESSAGES}?{urllib.parse.urlencode(params)}"
    try:
        raw = _http_get_text(
            url,
            timeout=20.0,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; meostock-xgb/0.1)",
                "Accept": "application/json",
                "Referer": "https://xuangubao.cn/",
            },
        )
        payload = json.loads(raw)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as e:
        return JSONResponse(
            {"ok": False, "error": str(e), "symbol": symbol, "yahoo_symbol": yahoo},
            status_code=502,
        )
    if not isinstance(payload, dict):
        return JSONResponse(
            {"ok": False, "error": "unexpected upstream payload", "yahoo_symbol": yahoo},
            status_code=502,
        )
    messages_raw = payload.get("Messages")
    if not isinstance(messages_raw, list):
        messages_raw = []
    messages = [
        _trim_xgb_stock_message(m, yahoo) for m in messages_raw if isinstance(m, dict)
    ]
    next_mark = payload.get("NextMark")
    return JSONResponse(
        {
            "ok": True,
            "source": "xuangubao",
            "symbol": symbol,
            "yahoo_symbol": yahoo,
            "messages": messages,
            "next_mark": "" if next_mark is None else str(next_mark),
            "total": len(messages),
        }
    )


@app.get("/api/zt/history/dates")
def zt_history_dates(
    pool: str | None = Query(None, description="limit_up | limit_down；空=全部"),
    limit: int = Query(120, ge=1, le=500),
) -> JSONResponse:
    """已落库的涨跌停快照交易日列表。"""
    try:
        from zt_history.service import list_dates

        return JSONResponse(list_dates(pool, limit=limit))
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/api/zt/history/day")
def zt_history_day(
    date: str = Query(..., description="YYYYMMDD"),
    pool: str = Query("limit_up", description="limit_up | limit_down"),
) -> JSONResponse:
    """某日涨/跌停完整快照（题材 + 个股），供历史回放。"""
    try:
        from zt_history.service import get_day

        data = get_day(date, pool)
        status = 404 if data.get("error") == "not_found" else (200 if data.get("ok") else 400)
        return JSONResponse(data, status_code=status)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/api/zt/history/stock")
def zt_history_stock(
    code: str = Query(..., description="6 位代码或带后缀 symbol"),
    pool: str | None = Query(None, description="limit_up | limit_down；空=两侧"),
    limit: int = Query(60, ge=1, le=365),
) -> JSONResponse:
    """单票涨跌停历史时间线。"""
    try:
        from zt_history.service import list_stock_history

        data = list_stock_history(code, pool=pool, limit=limit)
        return JSONResponse(data, status_code=200 if data.get("ok") else 400)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/api/zt/history/stock-panel")
def zt_history_stock_panel(
    code: str = Query(..., description="6 位代码或带后缀 symbol"),
    limit: int = Query(90, ge=1, le=365),
    theme_limit: int = Query(8, ge=1, le=20),
) -> JSONResponse:
    """K 线侧栏：涨跌停履历 + 题材详情（成分/原因）。"""
    try:
        from zt_history.service import get_stock_panel

        data = get_stock_panel(code, limit=limit, theme_limit=theme_limit)
        return JSONResponse(data, status_code=200 if data.get("ok") else 400)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.post("/api/zt/history/capture")
def zt_history_capture(
    date: str | None = Query(None, description="YYYYMMDD；默认最近交易日"),
    pool: str | None = Query(None, description="limit_up | limit_down；空=两侧"),
    force: int = Query(1, description="1=非交易日也可强制按当日抓"),
) -> JSONResponse:
    """手动抓取并覆盖写入日终快照（联调/补跑）。"""
    try:
        from zt_history.capture import capture_eod, capture_pool
        from zt_history.xgb_client import POOLS

        do_force = bool(int(force))
        if pool:
            key = pool.strip().lower()
            if key not in POOLS:
                return JSONResponse(
                    {"ok": False, "error": "pool 须为 limit_up | limit_down"},
                    status_code=400,
                )
            data = capture_pool(key, trade_date=date, force=do_force)
        else:
            data = capture_eod(trade_date=date, force=do_force)
        return JSONResponse(data, status_code=200 if data.get("ok") or data.get("skipped") else 502)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/api/zt/limit-pool")
def zt_limit_pool(
    pool: str = Query("both", description="up | down | both | yesterday_limit_up | stock_chance | …"),
) -> JSONResponse:
    """调试用：选股宝涨停/跌停池；也可传具体 pool_name。"""
    key = (pool or "both").strip().lower()
    if key in ("up", "limit_up"):
        return _xuangubao_pool("limit_up")
    if key in ("down", "limit_down", "dt"):
        return _xuangubao_pool("limit_down")
    if key in _XGB_POOL_NAMES:
        return _xuangubao_pool(key)
    if key != "both":
        return JSONResponse(
            {"ok": False, "error": "pool 须为 up | down | both 或具体 pool_name", "error_code": "bad_pool"},
            status_code=400,
        )
    try:
        up_items = _xuangubao_pool_items("limit_up")
        down_items = _xuangubao_pool_items("limit_down")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=502)
    return JSONResponse(
        {
            "ok": True,
            "source": "xuangubao",
            "pool": "both",
            "total": len(up_items) + len(down_items),
            "limit_up": up_items,
            "limit_down": down_items,
        }
    )


@app.get("/api/zt/xnge-proxy", response_model=None)
def zt_xnge_proxy(
    bg: str = Query("000000", description="背景色，对应通达信 ##tdxbkcolor##"),
    hidenav: int = Query(1),
) -> RedirectResponse:
    """兼容旧地址 → 通用中转 /xnge/fupan/。"""
    bg = _normalize_xnge_bg(bg)
    return RedirectResponse(
        url=f"/xnge/fupan/?hidenav={hidenav}&bg={urllib.parse.quote(bg)}",
        status_code=307,
    )


def _normalize_zt_code(raw: str | None) -> str | None:
    """涨停异动 code：优先提取 6 位数字，否则保留安全路径段。"""
    s = (raw or "").strip()
    if not s:
        return None
    m = re.search(r"(\d{6})", s)
    if m:
        return m.group(1)
    # 允许原站其它 slug（字母数字下划线短横）
    slug = re.sub(r"[^A-Za-z0-9_-]+", "", s)
    return slug or None


@app.get("/zt", response_model=None)
def zt_reason_query(
    request: Request,
    code: str | None = Query(None, description="股票代码，对应 t.xnge.cn/zt/{code}/"),
    bg: str = Query("ffffff", description="背景色"),
    hidenav: int = Query(1),
) -> Response:
    """
    查询参数版中转：
    /zt?code=600519&bg=ffffff
    → http://t.xnge.cn/zt/600519/?bg=ffffff
    """
    cid = _normalize_zt_code(code)
    if not cid:
        return JSONResponse(
            {
                "ok": False,
                "error": "缺少 code 参数，示例 /zt?code=600519&bg=ffffff 或 /zt/600519?bg=ffffff",
            },
            status_code=400,
        )
    bg_n = _normalize_xnge_bg(bg)
    return RedirectResponse(
        url=f"/zt/{urllib.parse.quote(cid)}?hidenav={hidenav}&bg={urllib.parse.quote(bg_n)}",
        status_code=307,
    )


@app.get("/zt/{code}", response_model=None)
@app.get("/zt/{code}/", response_model=None)
def zt_reason_proxy(code: str, request: Request) -> Response:
    """
    路径参数版中转（与涨停复盘 /xnge/fupan/ 同机制）：
    /zt/600519?bg=ffffff
    → http://t.xnge.cn/zt/600519/?bg=ffffff
    亦可用通用入口 /xnge/zt/600519/?bg=ffffff
    """
    cid = _normalize_zt_code(code)
    if not cid:
        return JSONResponse({"ok": False, "error": "无效 code"}, status_code=400)
    query = {k: v for k, v in request.query_params.multi_items()}
    if "bg" not in query:
        query["bg"] = "ffffff"
    return _proxy_xnge_html(f"zt/{cid}", query, request=request)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8765, reload=False)
