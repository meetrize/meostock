"""为 AI 拼装轻量行情上下文（摘要，非全量 K 线）。"""

from __future__ import annotations

from typing import Any


def _safe_float(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        x = float(v)
        if x != x:
            return None
        return x
    except (TypeError, ValueError):
        return None


def _bar_line(b: dict[str, Any]) -> str:
    ts = b.get("timestamp")
    o = _safe_float(b.get("open"))
    h = _safe_float(b.get("high"))
    l = _safe_float(b.get("low"))
    c = _safe_float(b.get("close"))
    v = _safe_float(b.get("volume"))
    return f"ts={ts} o={o} h={h} l={l} c={c} vol={v}"


def _extract_cn_code(symbol: str) -> str:
    import re

    s = (symbol or "").strip().lower()
    m = re.search(r"(\d{6})", s)
    return m.group(1) if m else ""


def _cn_limit_rate(symbol: str, name: str | None = None) -> float | None:
    """A 股涨跌幅档位；非个股返回 None。"""
    code = _extract_cn_code(symbol)
    if not code:
        return None
    nm = name or ""
    if "ST" in nm.upper():
        return 0.05
    s = (symbol or "").strip().lower()
    if s.startswith("bj") or code.startswith(("4", "8")):
        return 0.3
    if code.startswith(("688", "689")):
        return 0.2
    if code.startswith(("300", "301")):
        return 0.2
    if code.startswith(("60", "00")) or code.startswith("001") or code.startswith("003"):
        return 0.1
    if code.startswith(("30", "68")):
        return 0.2
    # 兜底：像个股六位码
    if code.startswith(("60", "68", "00", "30", "4", "8")):
        return 0.1 if code.startswith(("60", "00")) else 0.2
    return 0.1


def _round_fen(x: float) -> float:
    return round(x * 100) / 100.0


def _price_eq_fen(a: float | None, b: float | None) -> bool:
    if a is None or b is None:
        return False
    return round(a * 100) == round(b * 100)


def describe_day_shape(
    *,
    symbol: str,
    name: str | None,
    bar: dict[str, Any] | None,
    prev_close: float | None,
    avg_volume: float | None = None,
) -> dict[str, Any] | None:
    """从单日 OHLC + 昨收归纳形态与是否触及涨跌停。"""
    if not bar:
        return None
    o = _safe_float(bar.get("open"))
    h = _safe_float(bar.get("high"))
    l = _safe_float(bar.get("low"))
    c = _safe_float(bar.get("close"))
    v = _safe_float(bar.get("volume"))
    if o is None or h is None or l is None or c is None or c <= 0:
        return None

    prev = prev_close if prev_close and prev_close > 0 else None
    change_pct = round((c / prev - 1.0) * 100, 3) if prev else None
    amplitude_pct = (
        round((h - l) / prev * 100, 3) if prev and prev > 0 else None
    )
    body = abs(c - o)
    rng = max(h - l, 1e-9)
    upper = h - max(o, c)
    lower = min(o, c) - l
    rate = _cn_limit_rate(symbol, name)
    limit_up = _round_fen(prev * (1 + rate)) if prev and rate else None
    limit_down = _round_fen(prev * (1 - rate)) if prev and rate else None

    status = None
    one_word = _price_eq_fen(o, c) and _price_eq_fen(o, h) and _price_eq_fen(o, l)
    if limit_up is not None and c + 1e-8 >= limit_up:
        status = "oneWordUp" if one_word else "limitUp"
    elif limit_down is not None and c - 1e-8 <= limit_down:
        status = "oneWordDown" if one_word else "limitDown"

    near_up = (
        limit_up is not None
        and change_pct is not None
        and rate is not None
        and change_pct >= rate * 100 * 0.85
        and status is None
    )
    near_down = (
        limit_down is not None
        and change_pct is not None
        and rate is not None
        and change_pct <= -rate * 100 * 0.85
        and status is None
    )

    labels: list[str] = []
    if c > o:
        labels.append("阳线")
    elif c < o:
        labels.append("阴线")
    else:
        labels.append("十字星")
    if upper / rng >= 0.4:
        labels.append("长上影")
    if lower / rng >= 0.4:
        labels.append("长下影")
    if body / rng >= 0.7:
        labels.append("光头光脚实体" if upper / rng < 0.05 and lower / rng < 0.05 else "长实体")
    if prev and o > prev * 1.02:
        labels.append("高开")
    elif prev and o < prev * 0.98:
        labels.append("低开")
    if status == "oneWordUp":
        labels.append("一字涨停")
    elif status == "limitUp":
        labels.append("收盘涨停")
    elif status == "oneWordDown":
        labels.append("一字跌停")
    elif status == "limitDown":
        labels.append("收盘跌停")
    elif near_up:
        labels.append("接近涨停")
    elif near_down:
        labels.append("接近跌停")

    vol_vs_avg = None
    if avg_volume and avg_volume > 0 and v is not None:
        vol_vs_avg = round(v / avg_volume, 3)
        if vol_vs_avg >= 1.8:
            labels.append("明显放量")
        elif vol_vs_avg <= 0.6:
            labels.append("缩量")

    return {
        "open": o,
        "high": h,
        "low": l,
        "close": c,
        "volume": v,
        "prev_close": prev,
        "change_pct": change_pct,
        "amplitude_pct": amplitude_pct,
        "limit_rate": rate,
        "limit_up": limit_up,
        "limit_down": limit_down,
        "status": status,
        "near_limit_up": near_up,
        "near_limit_down": near_down,
        "body_ratio": round(body / rng, 3),
        "upper_shadow_ratio": round(upper / rng, 3),
        "lower_shadow_ratio": round(lower / rng, 3),
        "volume_vs_avg": vol_vs_avg,
        "shape_labels": labels,
        "timestamp": bar.get("timestamp"),
    }


def summarize_bars(bars: list[dict[str, Any]], *, tail: int = 40) -> dict[str, Any]:
    rows = [b for b in bars if isinstance(b, dict) and b.get("timestamp") is not None]
    rows.sort(key=lambda b: int(b.get("timestamp") or 0))
    if not rows:
        return {"count": 0, "recent": [], "stats": {}}

    recent = rows[-tail:]
    closes = [_safe_float(b.get("close")) for b in recent]
    closes_f = [c for c in closes if c is not None and c > 0]
    vols = [_safe_float(b.get("volume")) for b in recent]
    vols_f = [v for v in vols if v is not None and v >= 0]
    highs = [_safe_float(b.get("high")) for b in recent]
    lows = [_safe_float(b.get("low")) for b in recent]
    highs_f = [h for h in highs if h is not None]
    lows_f = [lo for lo in lows if lo is not None]

    first = closes_f[0] if closes_f else None
    last = closes_f[-1] if closes_f else None
    change_pct = None
    if first and last and first != 0:
        change_pct = round((last / first - 1.0) * 100, 3)

    avg_vol = round(sum(vols_f) / len(vols_f), 2) if vols_f else None
    last_vol = vols_f[-1] if vols_f else None
    vol_ratio = round(last_vol / avg_vol, 3) if avg_vol and last_vol is not None and avg_vol > 0 else None

    last_bar = recent[-1] if recent else None
    prev_bar = recent[-2] if len(recent) >= 2 else None
    prev_close = _safe_float(prev_bar.get("close")) if prev_bar else None

    return {
        "count": len(rows),
        "recent_count": len(recent),
        "stats": {
            "first_close": first,
            "last_close": last,
            "range_high": max(highs_f) if highs_f else None,
            "range_low": min(lows_f) if lows_f else None,
            "change_pct_window": change_pct,
            "avg_volume": avg_vol,
            "last_volume": last_vol,
            "volume_vs_avg": vol_ratio,
        },
        "last_bar": last_bar,
        "prev_close": prev_close,
        "recent": [_bar_line(b) for b in recent[-30:]],
    }


def build_context(symbol: str, period: str = "1d") -> dict[str, Any]:
    """尽量用本地缓存/现有拉取拼上下文；失败时仍返回 symbol 骨架。"""
    from cache.providers.kline_fetch import (
        fetch_cn_spot,
        fetch_kline_bars,
        normalize_period,
        normalize_symbol,
    )

    out: dict[str, Any] = {
        "symbol": symbol,
        "period": normalize_period(period),
        "market": None,
        "name": None,
        "spot": None,
        "kline": None,
        "day_shape": None,
        "error": None,
    }
    try:
        norm = normalize_symbol(symbol)
    except ValueError as e:
        out["error"] = str(e)
        return out

    out["market"] = norm.get("market")
    out["display"] = norm.get("display") or symbol
    period_n = normalize_period(period)

    # 形态/涨跌停判断优先用日线
    daily_bars: list[dict[str, Any]] = []
    try:
        bars, name, source = fetch_kline_bars(norm, period_n)
        out["name"] = name
        out["kline_source"] = source
        out["kline"] = summarize_bars(bars, tail=60)
        if period_n == "1d":
            daily_bars = bars
    except Exception as e:  # noqa: BLE001
        out["error"] = f"kline: {e}"

    if period_n != "1d":
        try:
            daily_bars, dname, dsrc = fetch_kline_bars(norm, "1d")
            if dname and not out.get("name"):
                out["name"] = dname
            out["daily_source"] = dsrc
        except Exception:  # noqa: BLE001
            daily_bars = []

    if norm.get("market") == "cn":
        try:
            spot = fetch_cn_spot(norm.get("symbol") or symbol)
            if spot:
                out["spot"] = {
                    "name": spot.get("name"),
                    "open": spot.get("open"),
                    "high": spot.get("high"),
                    "low": spot.get("low"),
                    "close": spot.get("close"),
                    "prev_close": spot.get("prev_close"),
                    "volume": spot.get("volume"),
                    "date": str(spot.get("date") or ""),
                }
                if spot.get("name") and not out.get("name"):
                    out["name"] = spot["name"]
        except Exception:  # noqa: BLE001
            pass

    # 当日形态：优先 spot（含昨收），否则日 K 最后一根
    daily_summary = summarize_bars(daily_bars, tail=40) if daily_bars else None
    avg_vol = (daily_summary or {}).get("stats", {}).get("avg_volume")
    shape_bar = None
    prev_close = None
    if out.get("spot") and out["spot"].get("close"):
        shape_bar = {
            "open": out["spot"].get("open"),
            "high": out["spot"].get("high"),
            "low": out["spot"].get("low"),
            "close": out["spot"].get("close"),
            "volume": out["spot"].get("volume"),
            "timestamp": None,
        }
        prev_close = _safe_float(out["spot"].get("prev_close"))
    elif daily_summary and daily_summary.get("last_bar"):
        shape_bar = daily_summary["last_bar"]
        prev_close = daily_summary.get("prev_close")

    out["day_shape"] = describe_day_shape(
        symbol=out.get("display") or symbol,
        name=out.get("name"),
        bar=shape_bar,
        prev_close=prev_close,
        avg_volume=avg_vol,
    )

    return out


def context_to_prompt_block(ctx: dict[str, Any], *, mode: str = "full") -> str:
    import json

    if mode == "news":
        # 消息面 skill：只给识别标的与涨跌幅背景，不塞 K 线形态
        shape = ctx.get("day_shape") or {}
        spot = ctx.get("spot") or {}
        slim = {
            "symbol": ctx.get("display") or ctx.get("symbol"),
            "name": ctx.get("name") or spot.get("name"),
            "market": ctx.get("market"),
            "trade_date": spot.get("date"),
            "last_price": spot.get("close") or shape.get("close"),
            "prev_close": spot.get("prev_close") or shape.get("prev_close"),
            "change_pct": shape.get("change_pct"),
            "limit_status": shape.get("status"),  # limitUp/limitDown/… 仅作是否涨跌停标签
            "note": "请联网检索消息面；禁止用K线形态解释原因。"
            + (f" raw_error={ctx.get('error')}" if ctx.get("error") else ""),
        }
        return json.dumps(slim, ensure_ascii=False, indent=2)

    slim = {
        "symbol": ctx.get("display") or ctx.get("symbol"),
        "name": ctx.get("name"),
        "market": ctx.get("market"),
        "period": ctx.get("period"),
        "spot": ctx.get("spot"),
        "day_shape": ctx.get("day_shape"),
        "kline_stats": (ctx.get("kline") or {}).get("stats"),
        "recent_bars": (ctx.get("kline") or {}).get("recent"),
        "kline_source": ctx.get("kline_source"),
        "note": ctx.get("error"),
    }
    return json.dumps(slim, ensure_ascii=False, indent=2)
