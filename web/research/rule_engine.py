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


def _param_optional_float(
    params: dict[str, Any], key: str, default: float | None
) -> float | None:
    """增强项浮点：未传用 default；显式 null/false/'' 表示关闭。"""
    if key not in params:
        return default
    v = params[key]
    if v is None or v is False or v == "":
        return None
    return _f(v)


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


def eval_volume_price_sync_rise(
    closes: list[float],
    volumes: list[float],
    *,
    lookback: int = 12,
    min_price_rise_pct: float = 8.0,
    min_vol_ratio: float = 1.5,
    min_sync_ratio: float = 0.55,
    max_price_up_vol_down: int = 3,
    near_high_pct: float = 5.0,
    min_price_up_days: int = 4,
    # ---- 可选增强（enhancements=True 时生效；单项可关）----
    enhancements: bool = False,
    require_ma20_up: bool = True,
    max_price_rise_pct: float | None = 25.0,
    min_up_day_vol_share: float | None = 0.55,
    max_day_vol_multiple: float | None = 6.0,
    require_break_hold: bool = True,
    break_lookback: int = 20,
    tag_ma5_pullback: bool = True,
) -> tuple[bool, list[str], dict[str, Any]]:
    """量价齐升：窗口内价量总体抬升，上涨日多数伴随放量，允许少量例外。

    对齐「价格新高/近高 + 成交量同步抬升」观察池（如连续放量上行，中间可有 1～2 日例外）。
    enhancements 打开后叠加：MA20 上行、涨幅上限、阳线量占比、极端放量警戒、突破前高站稳；
    并可标记「回踩 5 日线」更优买点（仅标签，不否决）。
    """
    lookback = int(lookback)
    break_lookback = int(break_lookback)
    need = lookback
    if enhancements:
        if require_ma20_up:
            need = max(need, 22)
        if require_break_hold:
            need = max(need, lookback + break_lookback)
        if tag_ma5_pullback:
            need = max(need, 6)
    if lookback < 5 or len(closes) < need:
        return False, [], {"insufficient_bars": True, "need": max(need, 5)}
    if len(closes) != len(volumes):
        n = min(len(closes), len(volumes))
        closes, volumes = closes[:n], volumes[:n]
        if len(closes) < need:
            return False, [], {"insufficient_bars": True, "need": need}

    c = closes[-lookback:]
    v = volumes[-lookback:]
    if c[0] <= 0:
        return False, [], {"insufficient_bars": True, "need": lookback}

    price_rise_pct = (c[-1] / c[0] - 1.0) * 100.0
    half = max(2, lookback // 2)
    early_avg = sum(v[:half]) / half
    late_avg = sum(v[-half:]) / half
    vol_ratio = (late_avg / early_avg) if early_avg > 0 else 0.0

    price_up = sync_up = vol_down_on_up = 0
    up_vol = 0.0
    total_vol = sum(v) or 0.0
    for i in range(1, lookback):
        pu = c[i] > c[i - 1]
        vu = v[i] > v[i - 1]
        if pu:
            up_vol += v[i]
            price_up += 1
            if vu:
                sync_up += 1
            else:
                vol_down_on_up += 1
    sync_ratio = (sync_up / price_up) if price_up else 0.0
    up_day_vol_share = (up_vol / total_vol) if total_vol > 0 else 0.0
    avg_vol = total_vol / lookback if lookback else 0.0
    max_vol = max(v) if v else 0.0
    day_vol_multiple = (max_vol / avg_vol) if avg_vol > 0 else 0.0

    window_high = max(c)
    near_high = c[-1] >= window_high * (1.0 - float(near_high_pct) / 100.0)

    rise_ok = price_rise_pct >= float(min_price_rise_pct)
    vol_ok = vol_ratio >= float(min_vol_ratio)
    sync_ok = price_up >= int(min_price_up_days) and sync_ratio >= float(min_sync_ratio)
    exc_ok = vol_down_on_up <= int(max_price_up_vol_down)
    ok = rise_ok and vol_ok and sync_ok and exc_ok and near_high

    why: list[str] = []
    if rise_ok:
        why.append(f"近 {lookback} 日收盘涨约 {price_rise_pct:.1f}%")
    if vol_ok:
        why.append(f"后半段均量约 {vol_ratio:.1f}×前半段")
    if sync_ok:
        why.append(
            f"上涨日量价同步 {sync_up}/{price_up}"
            f"（同步率 {sync_ratio * 100:.0f}%）"
        )
    if near_high:
        why.append(f"收盘贴近窗口高点（≤{near_high_pct:g}%）")

    factors: dict[str, Any] = {
        "lookback": lookback,
        "price_rise_pct": round(price_rise_pct, 3),
        "vol_ratio": round(vol_ratio, 3),
        "sync_ratio": round(sync_ratio, 3),
        "price_up_days": price_up,
        "sync_up_days": sync_up,
        "vol_down_on_up": vol_down_on_up,
        "near_high": near_high,
        "close": round(c[-1], 4),
        "window_high": round(window_high, 4),
        "up_day_vol_share": round(up_day_vol_share, 3),
        "day_vol_multiple": round(day_vol_multiple, 3),
        "enhancements": bool(enhancements),
    }

    if not ok:
        return ok, why, factors

    # ---- 可选增强过滤 ----
    if enhancements:
        i_last = len(closes) - 1

        if require_ma20_up:
            ma20 = sma_at(closes, i_last, 20)
            ma20_prev = sma_at(closes, i_last - 1, 20)
            if ma20 is None or ma20_prev is None:
                return False, [], {**factors, "insufficient_bars": True, "need": 22}
            ma20_up = ma20 > ma20_prev * 0.999  # 允许微幅走平
            above_ma20 = closes[i_last] >= ma20
            factors["ma20"] = round(ma20, 4)
            factors["ma20_up"] = ma20_up
            factors["above_ma20"] = above_ma20
            if not (above_ma20 and ma20_up):
                return False, why, factors
            why.append("收盘站上 MA20 且均线上行")

        if max_price_rise_pct is not None and float(max_price_rise_pct) > 0:
            cap = float(max_price_rise_pct)
            factors["max_price_rise_pct"] = cap
            if price_rise_pct > cap:
                return False, why, factors
            why.append(f"窗口涨幅未过热（≤{cap:g}%）")

        if min_up_day_vol_share is not None and float(min_up_day_vol_share) > 0:
            thr = float(min_up_day_vol_share)
            factors["min_up_day_vol_share"] = thr
            if up_day_vol_share < thr:
                return False, why, factors
            why.append(f"上涨日量能占比 {up_day_vol_share * 100:.0f}%")

        if max_day_vol_multiple is not None and float(max_day_vol_multiple) > 0:
            thr = float(max_day_vol_multiple)
            factors["max_day_vol_multiple"] = thr
            # 单日相对窗口均量过高：极端对倒/派发代理（缺换手率时的近似）
            if day_vol_multiple > thr:
                return False, why, factors
            why.append(f"无极端单日堆量（峰值 {day_vol_multiple:.1f}×均量）")

        if require_break_hold:
            prior = closes[-(lookback + break_lookback) : -lookback]
            if len(prior) < break_lookback:
                return False, [], {
                    **factors,
                    "insufficient_bars": True,
                    "need": lookback + break_lookback,
                }
            prior_high = max(prior)
            broke = window_high > prior_high
            held = closes[i_last] >= prior_high
            factors["prior_high"] = round(prior_high, 4)
            factors["break_hold"] = bool(broke and held)
            if not (broke and held):
                return False, why, factors
            why.append(f"突破近 {break_lookback} 日前高并收盘站稳")

        if tag_ma5_pullback:
            ma5 = sma_at(closes, i_last, 5)
            if ma5 is not None and ma5 > 0:
                dist_pct = (closes[i_last] / ma5 - 1.0) * 100.0
                vol_shrink = v[-1] <= late_avg * 0.85 if late_avg > 0 else False
                near_ma5 = -1.5 <= dist_pct <= 3.0
                above_ma5 = closes[i_last] >= ma5 * 0.995
                pullback_ready = bool(near_ma5 and above_ma5 and vol_shrink)
                factors["ma5"] = round(ma5, 4)
                factors["ma5_dist_pct"] = round(dist_pct, 3)
                factors["pullback_ready"] = pullback_ready
                if pullback_ready:
                    why.append("更优买点：缩量贴近 MA5")

    return True, why, factors


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
        elif op == "volume.price_sync_rise":
            ok, why, fac = eval_volume_price_sync_rise(
                closes,
                volumes,
                lookback=int(p.get("lookback") or 12),
                min_price_rise_pct=float(p.get("min_price_rise_pct") or 8.0),
                min_vol_ratio=float(p.get("min_vol_ratio") or 1.5),
                min_sync_ratio=float(p.get("min_sync_ratio") or 0.55),
                max_price_up_vol_down=int(p.get("max_price_up_vol_down") or 3),
                near_high_pct=float(p.get("near_high_pct") or 5.0),
                min_price_up_days=int(p.get("min_price_up_days") or 4),
                enhancements=bool(p.get("enhancements", False)),
                require_ma20_up=bool(p.get("require_ma20_up", True)),
                max_price_rise_pct=_param_optional_float(p, "max_price_rise_pct", 25.0),
                min_up_day_vol_share=_param_optional_float(p, "min_up_day_vol_share", 0.55),
                max_day_vol_multiple=_param_optional_float(p, "max_day_vol_multiple", 6.0),
                require_break_hold=bool(p.get("require_break_hold", True)),
                break_lookback=int(p.get("break_lookback") or 20),
                tag_ma5_pullback=bool(p.get("tag_ma5_pullback", True)),
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
