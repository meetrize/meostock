"""形态事件扫描：全市场滚动匹配量价齐升，供形态回测页使用。

默认只读本地日 K（不现场拉全市场）；连续命中合并为一段事件，并计算右侧收益。
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from research.kline_series import load_daily_bars
from research.rule_engine import _param_optional_float, eval_volume_price_sync_rise
from research.strategy_presets import apply_param_overrides, get_preset

_log = logging.getLogger("research.pattern_events")
_SH = ZoneInfo("Asia/Shanghai")

_lock = threading.Lock()
_cancel = threading.Event()
_runner: threading.Thread | None = None

_progress: dict[str, Any] = {
    "active": False,
    "run_id": None,
    "total": 0,
    "done": 0,
    "hit_count": 0,
    "skipped_no_kline": 0,
    "skipped_short": 0,
    "error_count": 0,
    "current": None,
    "message": "",
    "started_at": 0.0,
    "updated_at": 0.0,
    "finished_at": None,
    "cancel_requested": False,
}

_results: list[dict[str, Any]] = []
_MAX_RESULTS = 2000


def _now_iso() -> str:
    return datetime.now(_SH).isoformat(timespec="seconds")


def _is_st(name: str | None) -> bool:
    n = name or ""
    return "ST" in n.upper() or "退" in n


def _f(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _sync_kwargs_from_params(p: dict[str, Any]) -> dict[str, Any]:
    """把 RuleBlock params 映射为 eval_volume_price_sync_rise 关键字。"""
    return {
        "lookback": int(p.get("lookback") or 12),
        "min_price_rise_pct": float(p.get("min_price_rise_pct") or 8.0),
        "min_vol_ratio": float(p.get("min_vol_ratio") or 1.5),
        "min_sync_ratio": float(p.get("min_sync_ratio") or 0.55),
        "max_price_up_vol_down": int(p.get("max_price_up_vol_down") or 3),
        "near_high_pct": float(p.get("near_high_pct") or 5.0),
        "min_price_up_days": int(p.get("min_price_up_days") or 4),
        "require_price_rise": bool(p.get("require_price_rise", True)),
        "require_vol_lift": bool(p.get("require_vol_lift", True)),
        "require_sync": bool(p.get("require_sync", True)),
        "require_near_high": bool(p.get("require_near_high", True)),
        "enhancements": bool(p.get("enhancements", False)),
        "require_ma20_up": bool(p.get("require_ma20_up", True)),
        "max_price_rise_pct": _param_optional_float(p, "max_price_rise_pct", 25.0),
        "min_up_day_vol_share": _param_optional_float(p, "min_up_day_vol_share", 0.55),
        "max_day_vol_multiple": _param_optional_float(p, "max_day_vol_multiple", 6.0),
        "require_break_hold": bool(p.get("require_break_hold", True)),
        "break_lookback": int(p.get("break_lookback") or 20),
        "tag_ma5_pullback": bool(p.get("tag_ma5_pullback", True)),
    }


def _fwd_return(closes: list[float], i: int, n: int) -> float | None:
    j = i + n
    if j >= len(closes) or closes[i] <= 0:
        return None
    return round((closes[j] / closes[i] - 1.0) * 100.0, 3)


def scan_symbol_events(
    bars: list[dict[str, Any]],
    *,
    eval_kwargs: dict[str, Any],
    symbol: str,
    name: str = "",
    dedupe: str = "run",
) -> list[dict[str, Any]]:
    """对单票日 K 滚动匹配；返回事件列表（已按连续段去重）。"""
    closes: list[float] = []
    volumes: list[float] = []
    dates: list[str] = []
    for b in bars:
        c = _f(b.get("close"))
        if c is None:
            continue
        closes.append(c)
        volumes.append(_f(b.get("volume")) or 0.0)
        dates.append(str(b.get("date") or "")[:10])

    lookback = int(eval_kwargs.get("lookback") or 12)
    break_lookback = int(eval_kwargs.get("break_lookback") or 20)
    need = lookback
    if eval_kwargs.get("enhancements"):
        if eval_kwargs.get("require_ma20_up", True):
            need = max(need, 22)
        if eval_kwargs.get("require_break_hold", True):
            need = max(need, lookback + break_lookback)

    if len(closes) < need:
        return []

    # 逐日评估：hit_flags[i]=True 表示以 i 为末日命中
    hit_flags = [False] * len(closes)
    why_at: dict[int, list[str]] = {}
    fac_at: dict[int, dict[str, Any]] = {}
    for i in range(need - 1, len(closes)):
        if _cancel.is_set():
            break
        ok, why, fac = eval_volume_price_sync_rise(
            closes[: i + 1],
            volumes[: i + 1],
            **eval_kwargs,
        )
        if fac.get("insufficient_bars"):
            continue
        if ok:
            hit_flags[i] = True
            why_at[i] = why
            fac_at[i] = fac

    events: list[dict[str, Any]] = []
    i = need - 1
    while i < len(closes):
        if not hit_flags[i]:
            i += 1
            continue
        start_i = i
        end_i = i
        if dedupe == "run":
            while end_i + 1 < len(closes) and hit_flags[end_i + 1]:
                end_i += 1
        lookback_n = int(eval_kwargs.get("lookback") or 12)
        window_start_i = max(0, start_i + 1 - lookback_n)
        fac = fac_at.get(start_i) or {}
        events.append(
            {
                "symbol": symbol,
                "name": name,
                "window_start": dates[window_start_i],
                "signal_date": dates[start_i],
                "signal_end": dates[end_i],
                "run_days": end_i - start_i + 1,
                "close": round(closes[start_i], 4),
                "fwd_5": _fwd_return(closes, start_i, 5),
                "fwd_10": _fwd_return(closes, start_i, 10),
                "fwd_20": _fwd_return(closes, start_i, 20),
                "why_hit": why_at.get(start_i) or [],
                "factors": {
                    k: fac.get(k)
                    for k in (
                        "price_rise_pct",
                        "vol_ratio",
                        "sync_ratio",
                        "up_day_vol_share",
                        "day_vol_multiple",
                        "pullback_ready",
                        "break_hold",
                    )
                    if k in fac
                },
            }
        )
        i = end_i + 1

    return events


def get_progress() -> dict[str, Any]:
    with _lock:
        return dict(_progress)


def get_results(
    *,
    offset: int = 0,
    limit: int = 100,
    sort: str = "signal_date_desc",
) -> dict[str, Any]:
    with _lock:
        rows = list(_results)
        run_id = _progress.get("run_id")
        active = bool(_progress.get("active"))
        meta = {
            "hit_count": _progress.get("hit_count"),
            "skipped_no_kline": _progress.get("skipped_no_kline"),
            "skipped_short": _progress.get("skipped_short"),
            "done": _progress.get("done"),
            "total": _progress.get("total"),
            "finished_at": _progress.get("finished_at"),
        }

    reverse = True
    key = "signal_date"
    if sort == "signal_date_asc":
        reverse = False
    elif sort == "fwd_5_desc":
        key = "fwd_5"
    elif sort == "fwd_10_desc":
        key = "fwd_10"
    elif sort == "fwd_20_desc":
        key = "fwd_20"
    elif sort == "symbol_asc":
        key = "symbol"
        reverse = False

    def sort_key(r: dict[str, Any]) -> Any:
        v = r.get(key)
        if v is None and key.startswith("fwd_"):
            return float("-inf") if reverse else float("inf")
        return v if v is not None else ""

    rows.sort(key=sort_key, reverse=reverse)
    off = max(0, int(offset))
    lim = max(1, min(int(limit), 500))
    page = rows[off : off + lim]
    return {
        "ok": True,
        "run_id": run_id,
        "active": active,
        "total_hits": len(rows),
        "offset": off,
        "limit": lim,
        "returned": len(page),
        "results": page,
        "meta": meta,
        "disclaimer": (
            "形态事件扫描仅基于本地已入库日 K；缺 K 标的被跳过（幸存者偏差）。"
            "规则候选池，仅供观察与学习，不构成投资建议。"
        ),
    }


def cancel_scan() -> dict[str, Any]:
    _cancel.set()
    with _lock:
        _progress["cancel_requested"] = True
        _progress["message"] = "正在取消…"
        _progress["updated_at"] = time.time()
    return {"ok": True, "cancel_requested": True}


def _patch_progress(**kwargs: Any) -> None:
    with _lock:
        _progress.update(kwargs)
        _progress["updated_at"] = time.time()


def _append_hits(hits: list[dict[str, Any]]) -> None:
    if not hits:
        return
    with _lock:
        room = _MAX_RESULTS - len(_results)
        if room <= 0:
            return
        _results.extend(hits[:room])
        _progress["hit_count"] = len(_results)


def _run_scan_job(cfg: dict[str, Any]) -> None:
    from cache import models as cache_models

    started = time.time()
    try:
        preset_id = str(cfg.get("preset_id") or "volume_price_rise")
        preset = get_preset(preset_id)
        if not preset:
            _patch_progress(
                active=False,
                message=f"预设不存在: {preset_id}",
                finished_at=_now_iso(),
            )
            return
        overrides = cfg.get("rule_param_overrides")
        if isinstance(overrides, dict) and overrides:
            preset = apply_param_overrides(preset, overrides)

        sync_params: dict[str, Any] = {}
        exclude_st = bool(cfg.get("exclude_st", True))
        for block in (preset.get("rules") or {}).get("all") or []:
            if not isinstance(block, dict):
                continue
            if block.get("op") == "volume.price_sync_rise":
                sync_params = dict(block.get("params") or {})
            elif block.get("op") == "quote.exclude_st":
                exclude_st = bool((block.get("params") or {}).get("enabled", True))

        eval_kwargs = _sync_kwargs_from_params(sync_params)
        max_bars = max(120, min(int(cfg.get("max_bars_per_symbol") or 600), 800))
        min_bars = max(30, int(cfg.get("min_bars") or 80))
        concurrency = max(1, min(int(cfg.get("concurrency") or 6), 12))
        dedupe = str(cfg.get("dedupe") or "run")

        quotes = cache_models.read_snapshot("cn")
        universe: list[dict[str, Any]] = []
        for q in quotes:
            code = str(q.get("code") or "").strip()
            name = str(q.get("name") or "")
            if not code or len(code) < 6:
                continue
            if exclude_st and _is_st(name):
                continue
            universe.append({"code": code, "name": name})

        total = len(universe)
        _patch_progress(
            active=True,
            total=total,
            done=0,
            hit_count=0,
            skipped_no_kline=0,
            skipped_short=0,
            error_count=0,
            message=f"开始扫描 {total} 只…",
            started_at=started,
            finished_at=None,
        )

        def _one(q: dict[str, Any]) -> tuple[str, list[dict[str, Any]], str]:
            """返回 (status, hits, code)。status: ok|no_kline|short|error"""
            code = q["code"]
            name = q.get("name") or ""
            if _cancel.is_set():
                return "cancel", [], code
            try:
                bars = load_daily_bars(code, limit=max_bars, fetch_if_empty=False)
            except Exception as exc:  # noqa: BLE001
                _log.debug("kline %s: %s", code, exc)
                return "error", [], code
            if not bars:
                return "no_kline", [], code
            if len(bars) < min_bars:
                return "short", [], code
            try:
                hits = scan_symbol_events(
                    bars,
                    eval_kwargs=eval_kwargs,
                    symbol=code,
                    name=name,
                    dedupe=dedupe,
                )
                return "ok", hits, code
            except Exception as exc:  # noqa: BLE001
                _log.debug("scan %s failed: %s", code, exc)
                return "error", [], code

        done = skipped_k = skipped_s = errors = hit_segments = 0
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futs = [pool.submit(_one, q) for q in universe]
            for fut in as_completed(futs):
                if _cancel.is_set():
                    break
                try:
                    status, hits, code = fut.result()
                except Exception:  # noqa: BLE001
                    status, hits, code = "error", [], ""
                done += 1
                if status == "no_kline":
                    skipped_k += 1
                elif status == "short":
                    skipped_s += 1
                elif status == "error":
                    errors += 1
                elif hits:
                    before = hit_segments
                    _append_hits(hits)
                    hit_segments = min(_MAX_RESULTS, before + len(hits))
                if done % 20 == 0 or done == total:
                    _patch_progress(
                        done=done,
                        skipped_no_kline=skipped_k,
                        skipped_short=skipped_s,
                        error_count=errors,
                        current=code or None,
                        message=(
                            f"已扫 {done}/{total}，命中段 {hit_segments}，缺K {skipped_k}"
                        ),
                    )

        cancelled = _cancel.is_set()
        with _lock:
            final_hits = len(_results)
        _patch_progress(
            active=False,
            done=done,
            hit_count=final_hits,
            skipped_no_kline=skipped_k,
            skipped_short=skipped_s,
            error_count=errors,
            current=None,
            message=(
                "已取消"
                if cancelled
                else f"完成：命中段 {final_hits}，缺K {skipped_k}，过短 {skipped_s}"
            ),
            finished_at=_now_iso(),
            cancel_requested=cancelled,
        )
    except Exception as exc:  # noqa: BLE001
        _log.exception("pattern scan failed")
        _patch_progress(
            active=False,
            message=f"扫描失败: {exc}",
            finished_at=_now_iso(),
        )
    finally:
        global _runner
        with _lock:
            _runner = None


def start_scan(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    global _runner, _results
    cfg = dict(cfg or {})
    with _lock:
        if _progress.get("active") and _runner and _runner.is_alive():
            return {
                "ok": False,
                "error": "已有扫描在进行",
                "progress": dict(_progress),
            }
        run_id = "pe" + uuid.uuid4().hex[:12]
        _cancel.clear()
        _results = []
        _progress.update(
            {
                "active": True,
                "run_id": run_id,
                "total": 0,
                "done": 0,
                "hit_count": 0,
                "skipped_no_kline": 0,
                "skipped_short": 0,
                "error_count": 0,
                "current": None,
                "message": "排队中…",
                "started_at": time.time(),
                "updated_at": time.time(),
                "finished_at": None,
                "cancel_requested": False,
            }
        )
        t = threading.Thread(
            target=_run_scan_job,
            args=(cfg,),
            name=f"pattern-events-{run_id}",
            daemon=True,
        )
        _runner = t
        t.start()
    return {"ok": True, "run_id": run_id, "progress": get_progress()}

