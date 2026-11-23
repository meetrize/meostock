"""选股 RuleBlock 评估（M2：ma / breakout / quote 子集）。

输入日 K bars（升序）+ 可选行情快照字段，输出是否命中、why_hit、factors。
"""

from __future__ import annotations

from typing import Any


def _f(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def sma_at(closes: list[float], i: int, n: int) -> float | None:
    if n <= 0 or i + 1 < n:
        return None
    window = closes[i + 1 - n : i + 1]
    if len(window) < n:
        return None
    return sum(window) / n


def _closes_volumes(bars: list[dict[str, Any]]) -> tuple[list[float], list[float]]:
    closes: list[float] = []
    volumes: list[float] = []
    for b in bars:
        c = _f(b.get("close"))
        if c is None:
            continue
        closes.append(c)
        volumes.append(_f(b.get("volume")) or 0.0)
    return closes, volumes


def eval_ma_bull_stack(
    closes: list[float],
    *,
    periods: list[int] | None = None,
    require_price_above: int | None = 60,
) -> tuple[bool, list[str], dict[str, Any]]:
    periods = list(periods or [5, 10, 20, 60])
    periods = sorted({int(p) for p in periods if int(p) > 0})
    if not closes or not periods:
        return False, [], {}
    i = len(closes) - 1
    mas: dict[int, float] = {}
    for p in periods:
        v = sma_at(closes, i, p)
        if v is None:
            return False, [], {"insufficient_bars": True, "need": max(periods)}
        mas[p] = v
    # 短 > 长
    ordered = True
    for a, b in zip(periods, periods[1:]):
        if mas[a] <= mas[b]:
            ordered = False
            break
    price = closes[i]
    above_ok = True
    above_period = int(require_price_above) if require_price_above else None
    if above_period:
        ma_ref = mas.get(above_period) or sma_at(closes, i, above_period)
        if ma_ref is None or price < ma_ref:
            above_ok = False
    ok = ordered and above_ok
    why: list[str] = []
    if ordered:
        why.append("均线多头：" + " > ".join(f"MA{p}" for p in periods))
    if above_ok and above_period:
        why.append(f"收盘价站上 MA{above_period}")
    factors = {
        "ma": {f"ma{p}": round(mas[p], 4) for p in periods},
        "close": round(price, 4),
        "ma_stack": ordered,
        "above_ma": above_ok,
        "above_period": above_period,
    }
    return ok, why, factors


def eval_ma_dual_coil(
    closes: list[float],
    *,
    slow: int = 60,
    slower: int = 89,
    max_gap_pct: float = 3.0,
    require_price_above: bool = True,
) -> tuple[bool, list[str], dict[str, Any]]:
    slow, slower = int(slow), int(slower)
    if slow > slower:
        slow, slower = slower, slow
    i = len(closes) - 1
    ma_s = sma_at(closes, i, slow)
    ma_l = sma_at(closes, i, slower)
    if ma_s is None or ma_l is None or ma_l == 0:
        return False, [], {"insufficient_bars": True, "need": slower}
    gap_pct = abs(ma_s - ma_l) / abs(ma_l) * 100.0
    # 粘合：间距小；或向上发散：慢线在上且间距扩大但仍允许 max_gap 内「粘合态」
    # MVP：间距 ≤ max_gap_pct，且 MA_slow >= MA_slower * 0.998（不要求严格死叉下方）
    coiled = gap_pct <= float(max_gap_pct)
    upwardish = ma_s >= ma_l * 0.998
    price = closes[i]
    above = (not require_price_above) or (price >= min(ma_s, ma_l))
    ok = coiled and upwardish and above
    why: list[str] = []
    if coiled and upwardish:
        why.append(f"MA{slow}/MA{slower} 粘合或微发散（间距 {gap_pct:.2f}%）")
    if above and require_price_above:
        why.append("收盘价站上双线")
    factors = {
        f"ma{slow}": round(ma_s, 4),
        f"ma{slower}": round(ma_l, 4),
        "gap_pct": round(gap_pct, 3),
        "close": round(price, 4),
        "above_dual": above,
    }
    return ok, why, factors


def eval_ma_above(
    closes: list[float],
    *,
    period: int = 60,
) -> tuple[bool, list[str], dict[str, Any]]:
    period = int(period)
    i = len(closes) - 1
    ma = sma_at(closes, i, period)
    if ma is None:
        return False, [], {"insufficient_bars": True, "need": period}
    ok = closes[i] >= ma
    why = [f"收盘价站上 MA{period}"] if ok else []
    return ok, why, {"close": round(closes[i], 4), f"ma{period}": round(ma, 4)}


def eval_breakout_volume(
    closes: list[float],
    volumes: list[float],
    *,
    lookback: int = 20,
    volume_multiple: float = 1.8,
) -> tuple[bool, list[str], dict[str, Any]]:
    lookback = int(lookback)
    if len(closes) < lookback + 2:
        return False, [], {"insufficient_bars": True, "need": lookback + 2}
    i = len(closes) - 1
    # 突破：收盘创新高（相对此前 lookback 根，不含当日）
    prior_high = max(closes[i - lookback : i])
    price = closes[i]
    broke = price > prior_high
    # 放量：当日量 ≥ 均量 * multiple（均量用此前 lookback）
    prior_vols = volumes[i - lookback : i]
    avg_vol = sum(prior_vols) / lookback if lookback else 0.0
    vol = volumes[i]
    multiple = (vol / avg_vol) if avg_vol > 0 else 0.0
    vol_ok = avg_vol > 0 and multiple >= float(volume_multiple)
    ok = broke and vol_ok
    why: list[str] = []
    if broke:
        why.append(f"收盘突破近 {lookback} 日高点")
    if vol_ok:
        why.append(f"成交量约 {multiple:.1f}×均量（≥{volume_multiple}）")
    factors = {
        "close": round(price, 4),
        "prior_high": round(prior_high, 4),
        "volume_multiple": round(multiple, 3),
        "breakout": broke,
        "volume_ok": vol_ok,
    }
    return ok, why, factors


def eval_quote_exclude_st(name: str, *, enabled: bool = True) -> tuple[bool, list[str], dict[str, Any]]:
    if not enabled:
        return True, [], {"exclude_st": False}
    n = name or ""
    is_st = "ST" in n.upper() or "退" in n
    ok = not is_st
    return ok, (["非 ST"] if ok else []), {"is_st": is_st}


def evaluate_rules_on_bars(
    bars: list[dict[str, Any]],
    rules: dict[str, Any] | None,
    *,
    quote: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """评估 preset.rules.all（AND）。返回 {ok, why_hit, factors, skipped}。"""
    quote = quote or {}
    blocks = list((rules or {}).get("all") or [])
    closes, volumes = _closes_volumes(bars)
    why_all: list[str] = []
    factors: dict[str, Any] = {}
    if not blocks:
        return {"ok": False, "why_hit": [], "factors": {}, "skipped": "no_rules"}

    for block in blocks:
        if not isinstance(block, dict):
            continue
        op = str(block.get("op") or "")
        p = dict(block.get("params") or {})

        if op == "quote.exclude_st":
            ok, why, fac = eval_quote_exclude_st(
                str(quote.get("name") or ""), enabled=bool(p.get("enabled", True))
            )
        elif op == "ma.bull_stack":
            ok, why, fac = eval_ma_bull_stack(
                closes,
                periods=list(p.get("periods") or [5, 10, 20, 60]),
                require_price_above=p.get("require_price_above", 60),
            )
        elif op == "ma.dual_coil":
            ok, why, fac = eval_ma_dual_coil(
                closes,
                slow=int(p.get("slow") or 60),
                slower=int(p.get("slower") or 89),
                max_gap_pct=float(p.get("max_gap_pct") or 3.0),
                require_price_above=bool(p.get("require_price_above", True)),
            )
        elif op == "ma.above":
            ok, why, fac = eval_ma_above(closes, period=int(p.get("period") or 60))
        elif op == "breakout.volume":
            ok, why, fac = eval_breakout_volume(
                closes,
                volumes,
                lookback=int(p.get("lookback") or 20),
                volume_multiple=float(p.get("volume_multiple") or 1.8),
            )
        elif op == "risk.tradability":
            # 不在此过滤，由外层标记
            ok, why, fac = True, [], {"tradability_flag_required": bool(p.get("require_flag", True))}
        elif op.startswith("quote.") or op.startswith("fina.") or op.startswith("valuation."):
            # M2 技术扫描忽略基本面/日内 quote 区间（由其它引擎处理）
            continue
        elif op.startswith("limit.") or op.startswith("board.") or op.startswith("intraday."):
            continue
        else:
            # 未知 op：跳过不阻断（便于向前兼容）
            continue

        factors[op] = fac
        if fac.get("insufficient_bars"):
            return {
                "ok": False,
                "why_hit": [],
                "factors": factors,
                "skipped": "insufficient_bars",
            }
        if not ok:
            return {"ok": False, "why_hit": [], "factors": factors, "skipped": None}
        why_all.extend(why)

    return {"ok": True, "why_hit": why_all, "factors": factors, "skipped": None}
