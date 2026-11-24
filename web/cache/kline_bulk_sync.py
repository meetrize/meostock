"""日 K 全量/精选入库：A 股按代码表约半年；美股仅精选宇宙（勿全市场 1 万+）。"""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from cache import kline_models, models
from cache.providers.kline_fetch import (
    fetch_kline_bars,
    normalize_period,
    normalize_symbol,
)

_log = logging.getLogger("quote-cache.kline-bulk")

_lock = threading.Lock()
_progress: dict[str, Any] = {
    "active": False,
    "market": "cn",
    "period": "1d",
    "total": 0,
    "done": 0,
    # 注意：勿用键名 ok（会覆盖 HTTP {"ok": true}）
    "ok_count": 0,
    "skip_count": 0,
    "fail_count": 0,
    "current": None,
    "message": "",
    "started_at": 0.0,
    "updated_at": 0.0,
    "min_bars": 120,
    "errors": [],
}
_cancel = threading.Event()
_runner: threading.Thread | None = None

# 美股半年日 K 精选：宽基/行业 ETF + 大盘股 + 热门 ADR（对齐常见看盘软件「核心池」）
_US_CORE_TICKERS: tuple[str, ...] = (
    # 宽基 / 风格
    "SPY",
    "QQQ",
    "IWM",
    "DIA",
    "VOO",
    "VTI",
    "IVV",
    "RSP",
    # 债 / 商品 / 波动代理
    "TLT",
    "IEF",
    "HYG",
    "LQD",
    "GLD",
    "SLV",
    "USO",
    "UNG",
    "VIXY",
    # 行业 ETF
    "XLK",
    "XLF",
    "XLE",
    "XLV",
    "XLI",
    "XLY",
    "XLP",
    "XLB",
    "XLU",
    "XLRE",
    "SMH",
    "SOXX",
    "XBI",
    "ARKK",
    "XOP",
    "KWEB",
    # Mag7 / 超大盘
    "AAPL",
    "MSFT",
    "NVDA",
    "GOOGL",
    "GOOG",
    "AMZN",
    "META",
    "TSLA",
    "AVGO",
    "BRK-B",
    "JPM",
    "V",
    "MA",
    "UNH",
    "XOM",
    "JNJ",
    "WMT",
    "PG",
    "HD",
    "COST",
    "NFLX",
    "AMD",
    "ORCL",
    "CRM",
    "INTC",
    "QCOM",
    "TXN",
    "PEP",
    "KO",
    "MRK",
    "ABBV",
    "LLY",
    "BAC",
    "WFC",
    "DIS",
    "ADBE",
    "CSCO",
    "IBM",
    "GE",
    "CAT",
    "BA",
    # 半导体 / 成长热门
    "TSM",
    "ASML",
    "MU",
    "AMAT",
    "LRCX",
    "KLAC",
    "ARM",
    "PLTR",
    "COIN",
    "MSTR",
    "UBER",
    "SHOP",
    "SNOW",
    "NET",
    "CRWD",
    "PANW",
    # 中概 / ADR
    "BABA",
    "PDD",
    "JD",
    "NIO",
    "LI",
    "XPEV",
    "BIDU",
    "NTES",
    "BILI",
    "TME",
)


def get_bulk_progress() -> dict[str, Any]:
    with _lock:
        return dict(_progress)


def _set(**kwargs: Any) -> None:
    with _lock:
        _progress.update(kwargs)
        _progress["updated_at"] = time.time()


def _append_error(symbol: str, err: str) -> None:
    with _lock:
        errs = list(_progress.get("errors") or [])
        errs.append({"symbol": symbol, "error": err[:240]})
        _progress["errors"] = errs[-30:]
        _progress["updated_at"] = time.time()


def _dedupe_append(out: list[str], seen: set[str], raw: str) -> None:
    sym = str(raw or "").strip()
    if not sym or sym in seen:
        return
    seen.add(sym)
    out.append(sym)


def _target_symbols_cn() -> list[str]:
    """A 股：优先代码表 klineSymbol；否则快照。"""
    seeds = models.read_symbol_seeds("cn") if hasattr(models, "read_symbol_seeds") else []
    out: list[str] = []
    seen: set[str] = set()
    for s in seeds:
        _dedupe_append(out, seen, str(s.get("klineSymbol") or s.get("code") or ""))
    if out:
        return out
    rows = models.read_snapshot("cn")
    for r in rows:
        _dedupe_append(out, seen, str(r.get("klineSymbol") or r.get("code") or ""))
    return out


def _looks_like_us_ticker(ticker: str) -> bool:
    """过滤误入 us 市场的脏代码（板块 BK、带交易所后缀的 A 股等）。"""
    t = (ticker or "").strip().upper()
    if not t or len(t) > 8:
        return False
    if t.startswith("BK") or t.startswith("EM:"):
        return False
    if "." in t:  # 000607.SZ 等
        return False
    # 字母开头，允许数字与连字符（BRK-B）
    if not t[0].isalpha():
        return False
    return all(ch.isalnum() or ch == "-" for ch in t)


def _target_symbols_us(*, recent_limit: int = 80) -> list[str]:
    """美股精选：核心 ETF/大盘 + 近期打开过的标的。绝不扫全市场代码表。"""
    out: list[str] = []
    seen: set[str] = set()
    for t in _US_CORE_TICKERS:
        ticker = str(t).strip().upper()
        if not ticker or not _looks_like_us_ticker(ticker):
            continue
        _dedupe_append(out, seen, f"us{ticker}")
        seen.add(ticker)
    for sym in kline_models.list_recent_kline_symbols(
        "us", period="1d", limit=recent_limit
    ):
        s = str(sym or "").strip()
        if not s:
            continue
        key = s[2:].upper() if s.lower().startswith("us") else s.upper()
        if not _looks_like_us_ticker(key):
            continue
        if key in seen or f"us{key}" in seen:
            continue
        raw = s if s.lower().startswith("us") else f"us{s}"
        _dedupe_append(out, seen, raw)
        seen.add(key)
    return out


def _target_symbols(market: str) -> list[str]:
    market = (market or "cn").lower()
    if market == "us":
        return _target_symbols_us()
    if market == "cn":
        return _target_symbols_cn()
    return []


def _already_enough(market: str, symbol: str, period: str, min_bars: int) -> tuple[bool, int]:
    meta = kline_models.get_kline_meta(market, symbol, period)
    if meta:
        try:
            n = int(meta.get("bar_count") or 0)
        except (TypeError, ValueError):
            n = 0
        if n >= min_bars:
            return True, n
    bars = kline_models.read_kline_bars(market, symbol, period)
    n = len(bars or [])
    return n >= min_bars, n


def _sync_one(
    raw: str,
    *,
    period: str,
    min_bars: int,
    force: bool,
) -> str:
    """返回 ok|skip|fail。"""
    if _cancel.is_set():
        return "fail"
    try:
        norm = normalize_symbol(raw)
    except ValueError as e:
        _append_error(raw, str(e))
        return "fail"
    market = norm["market"]
    sym = norm["symbol"]
    display = norm.get("display") or sym
    _set(current=raw or display)

    if not force:
        enough, n = _already_enough(market, sym, period, min_bars)
        if enough:
            return "skip"

    try:
        fresh, name, source = fetch_kline_bars(norm, period)
        if not fresh:
            _append_error(raw, "empty bars")
            return "fail"
        # 约半年：保留最近 min_bars*1.2（交易日缓冲），多余也可留着，upsert 不删更早
        kline_models.upsert_kline_bars(
            market,
            sym,
            period,
            fresh,
            source=source,
            name=name or display,
            touch_as_of=True,
        )
        return "ok"
    except Exception as e:  # noqa: BLE001
        _append_error(raw, str(e))
        _log.warning("bulk kline fail %s: %s", raw, e)
        return "fail"


def _run_job(
    *,
    market: str,
    period: str,
    min_bars: int,
    force: bool,
    concurrency: int,
    max_symbols: int | None,
) -> None:
    from cache.db import init_db

    init_db()
    period_n = normalize_period(period)
    targets = _target_symbols(market)
    if max_symbols and max_symbols > 0:
        targets = targets[: int(max_symbols)]
    total = len(targets)
    label = "A股全表" if market == "cn" else "美股精选"
    _set(
        active=True,
        market=market,
        period=period_n,
        total=total,
        done=0,
        ok_count=0,
        skip_count=0,
        fail_count=0,
        current=None,
        message=f"开始{label}入库 {market} {period_n}（目标≥{min_bars} 根）…",
        started_at=time.time(),
        min_bars=min_bars,
        errors=[],
    )
    if total <= 0:
        tip = (
            "无代码可同步（请先同步 A 股行情/代码表）"
            if market == "cn"
            else "无美股精选代码（内部清单为空）"
        )
        _set(active=False, message=tip)
        return

    workers = max(1, min(int(concurrency or 3), 6))
    done = ok = skip = fail = 0

    def _handle(raw: str) -> str:
        # 轻微节流，降低东财/Yahoo 限流概率
        time.sleep(0.08 if market == "us" else 0.05)
        return _sync_one(raw, period=period_n, min_bars=min_bars, force=force)

    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futs = {pool.submit(_handle, raw): raw for raw in targets}
            for fut in as_completed(futs):
                if _cancel.is_set():
                    break
                status = "fail"
                try:
                    status = fut.result()
                except Exception as e:  # noqa: BLE001
                    _append_error(futs[fut], str(e))
                    status = "fail"
                done += 1
                if status == "ok":
                    ok += 1
                elif status == "skip":
                    skip += 1
                else:
                    fail += 1
                _set(
                    done=done,
                    ok_count=ok,
                    skip_count=skip,
                    fail_count=fail,
                    message=f"日K入库 {done}/{total} · 成功{ok} 跳过{skip} 失败{fail}",
                )
    finally:
        cancelled = _cancel.is_set()
        _cancel.clear()
        _set(
            active=False,
            current=None,
            message=(
                f"{'已取消 · ' if cancelled else ''}完成：成功{ok} 跳过{skip} 失败{fail} / 共{total}"
            ),
        )


def start_bulk_kline_sync(
    *,
    market: str = "cn",
    period: str = "1d",
    min_bars: int = 120,
    force: bool = False,
    concurrency: int = 3,
    max_symbols: int | None = None,
) -> dict[str, Any]:
    """启动后台日 K 入库。cn=全 A；us=精选宇宙。已在跑则返回 already_running。"""
    global _runner
    with _lock:
        if _progress.get("active") and _runner and _runner.is_alive():
            return {"ok": False, "error": "already_running", "progress": dict(_progress)}

    market = (market or "cn").lower().strip()
    if market not in ("cn", "us"):
        return {
            "ok": False,
            "error": "仅支持 market=cn|us（美股为精选池，非全市场）",
        }

    min_bars = max(60, min(int(min_bars or 120), 500))
    # 美股源更易限流，默认并发略低
    default_conc = 2 if market == "us" else 3
    concurrency = max(1, min(int(concurrency or default_conc), 6))
    _cancel.clear()

    def _boot() -> None:
        try:
            _run_job(
                market=market,
                period=period,
                min_bars=min_bars,
                force=bool(force),
                concurrency=concurrency,
                max_symbols=max_symbols,
            )
        except Exception as e:  # noqa: BLE001
            _log.exception("bulk kline job crashed")
            _set(active=False, message=f"任务异常：{e}")

    th = threading.Thread(target=_boot, name="kline-bulk-sync", daemon=True)
    _runner = th
    th.start()
    msg = (
        "A股日K全量入库已在后台开始（约半年，可在进度接口查看）"
        if market == "cn"
        else "美股精选日K入库已在后台开始（宽基ETF+大盘+近期访问，约半年）"
    )
    return {
        "ok": True,
        "queued": True,
        "market": market,
        "period": normalize_period(period),
        "min_bars": min_bars,
        "concurrency": concurrency,
        "message": msg,
    }


def cancel_bulk_kline_sync() -> dict[str, Any]:
    if not get_bulk_progress().get("active"):
        return {"ok": True, "cancelled": False, "message": "当前无进行中的任务"}
    _cancel.set()
    return {"ok": True, "cancelled": True, "message": "已请求取消，等待当前批次结束"}
