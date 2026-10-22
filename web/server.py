"""静态站点 + 符号列表代理 + yfinance 市场摘要 / K 线。"""

from __future__ import annotations

import json
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
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from yf_catalog import (
    YF_MARKETS,
    catalog_items,
    market_label,
    translate_name,
)

STATIC_DIR = Path(__file__).resolve().parent / "static"
# stock-dashboard 构建产物（VITE_BASE_URL=/dashboard/）
DASHBOARD_DIR = STATIC_DIR / "dashboard"

app = FastAPI(title="stock-sdk K-Line Demo", version="0.5.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

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


def _http_get_json(url: str, timeout: float = 12.0) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; mootdx-kline/0.4)",
            "Referer": "https://quote.eastmoney.com/",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return json.loads(raw)


def _to_symbol(code: str, mkt: int, market: str) -> str:
    code = str(code or "").strip()
    if market == "us":
        return code.upper()
    if market == "hk":
        return code.zfill(5) if code.isdigit() else code
    if mkt == 1:
        return f"sh{code}"
    if mkt == 0:
        return f"sz{code}"
    return code


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


@app.get("/dashboard", response_model=None)
def dashboard_redirect() -> RedirectResponse:
    return RedirectResponse(url="/dashboard/", status_code=307)


@app.get("/dashboard/", response_model=None)
def dashboard_index() -> Response:
    index_html = DASHBOARD_DIR / "index.html"
    if not index_html.is_file():
        return JSONResponse(
            {
                "ok": False,
                "error": "stock-dashboard 未构建。请运行: ./scripts/build_dashboard.sh",
            },
            status_code=404,
        )
    return FileResponse(index_html)


@app.get("/dashboard/{full_path:path}", response_model=None)
def dashboard_spa(full_path: str) -> Response:
    """SPA：优先静态资源，其余回退 index.html（深链 /dashboard/s/600036 等）。"""
    if not DASHBOARD_DIR.is_dir():
        return JSONResponse(
            {
                "ok": False,
                "error": "stock-dashboard 未构建。请运行: ./scripts/build_dashboard.sh",
            },
            status_code=404,
        )
    hit = _dashboard_file(full_path)
    if hit is not None:
        return FileResponse(hit)
    return FileResponse(DASHBOARD_DIR / "index.html")


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
    if market == "sh" or symbol.startswith(("6", "9")):
        return f"1.{symbol}"
    return f"0.{symbol}"


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
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=502)

    industries: dict[str, str] = {}
    for row in (((data or {}).get("data") or {}).get("diff")) or []:
        code = str(row.get("f12") or "").strip()
        industry = str(row.get("f100") or "").strip()
        if code and industry:
            industries[code] = industry
    return JSONResponse({"ok": True, "industries": industries})


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
    try:
        data = _http_get_json(url)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=502)

    diff = (((data or {}).get("data") or {}).get("diff")) or []
    total = int((((data or {}).get("data") or {}).get("total")) or 0)
    qn = q.strip().lower()
    items: list[dict[str, Any]] = []
    for row in diff:
        code = str(row.get("f12") or "")
        name = str(row.get("f14") or "")
        mkt = int(row.get("f13") or 0)
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
        }
    )


@app.get("/api/yf/markets")
def yf_markets() -> JSONResponse:
    return JSONResponse({"ok": True, "markets": YF_MARKETS})


@app.get("/api/yf/symbols")
def yf_symbols(
    market: str = Query("COMMODITIES", description="US|GB|ASIA|EUROPE|RATES|COMMODITIES|CURRENCIES|CRYPTOCURRENCIES"),
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
XNGE_ORIGIN = "http://t.xnge.cn"


def _http_get_text(url: str, *, headers: dict[str, str] | None = None, timeout: float = 15.0) -> str:
    req = urllib.request.Request(url, headers=headers or {}, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


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


def _proxy_xnge_html(path: str, query: dict[str, str]) -> Response:
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
        html = _http_get_text(
            upstream,
            headers={
                "User-Agent": TDX_UA,
                "Accept": "text/html,application/xhtml+xml",
                "Referer": "http://www.tdx.com.cn/",
            },
        )
    except (urllib.error.URLError, TimeoutError) as e:
        return JSONResponse({"ok": False, "error": str(e), "url": upstream}, status_code=502)

    # 去掉原站「每 N 秒整页 Refresh 跳转」（如 <meta http-equiv="Refresh" content="60; url=/fupan/" />）
    html = re.sub(
        r'<meta\b[^>]*http-equiv\s*=\s*[\'"]?refresh[\'"]?[^>]*>',
        '',
        html,
        flags=re.IGNORECASE,
    )

    base = f"{XNGE_ORIGIN}/{path}" if path else f"{XNGE_ORIGIN}/"
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
    head_bits: list[str] = []
    if "<base " not in html.lower():
        # 让 //ace.xnge.cn 与相对路径按原站解析
        head_bits.append(f'<base href="{base}" />')
    head_bits.append(patch_css)
    injected = "<head>\n" + "\n".join(head_bits)
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
    return Response(
        content=html,
        media_type="text/html; charset=utf-8",
        headers={"X-Xnge-Upstream": upstream},
    )


@app.get("/fupan", response_model=None)
def fupan_demo() -> FileResponse:
    """本地涨停复盘 Demo（不依赖通达信内置浏览器）。"""
    return FileResponse(STATIC_DIR / "fupan.html")


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
    return _proxy_xnge_html(path, query)


@app.get("/api/zt/limit-up")
def zt_limit_up() -> JSONResponse:
    """代理选股宝涨停池（与犀利 fupan.js 同源）。"""
    url = f"{XUANGUBAO_POOL}?{urllib.parse.urlencode({'pool_name': 'limit_up'})}"
    try:
        raw = _http_get_text(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; mootdx-fupan/0.1)",
                "Accept": "application/json",
                "Referer": "https://xuangubao.cn/",
            },
        )
        payload = json.loads(raw)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=502)
    items = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        return JSONResponse(
            {"ok": False, "error": "unexpected upstream payload", "upstream": payload},
            status_code=502,
        )
    return JSONResponse(
        {
            "ok": True,
            "source": "xuangubao",
            "total": len(items),
            "items": items,
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8765, reload=False)
