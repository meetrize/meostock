"""复盘报表：胜率、盈亏比、回撤、基准超额、信息比率（教学向）。"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from research.cards_store import list_cards
from research.kline_series import closes_by_date, interval_return, load_daily_bars

_SH = ZoneInfo("Asia/Shanghai")

# 基准指数代码（展示码；kline_series 映射到 sh000300 等）
_BENCHMARKS = {
    "long": "000300.SH",  # 沪深300
    "swing": "000905.SH",  # 中证500
    "short": "399006.SZ",  # 创业板指
}


def _f(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        x = float(v)
        if not math.isfinite(x):
            return None
        return x
    except (TypeError, ValueError):
        return None


def _field_completeness(card: dict[str, Any]) -> dict[str, Any]:
    required = {
        "thesis": bool(str(card.get("thesis") or "").strip()),
        "evidence": bool(card.get("evidence")),
        "stop_rule": bool(str(card.get("stop_rule") or "").strip()),
        "falsify_conditions": bool(card.get("falsify_conditions")),
        "business_mode_state": str(card.get("business_mode_state") or "")
        not in ("", "unverified"),
    }
    n = sum(1 for v in required.values() if v)
    return {
        "fields": required,
        "score": round(100.0 * n / max(len(required), 1), 1),
        "complete": n == len(required),
    }


_BENCH_CLOSE_CACHE: dict[str, dict[str, float]] = {}


def _index_return_proxy(symbol: str, entry_date: str | None, exit_date: str | None) -> float | None:
    """用基准日 K 计算 [entry, exit] 区间收益 %。"""
    if not entry_date or not exit_date:
        return None
    if symbol not in _BENCH_CLOSE_CACHE:
        bars = load_daily_bars(symbol, limit=1200, fetch_if_empty=True)
        _BENCH_CLOSE_CACHE[symbol] = closes_by_date(bars)
    return interval_return(_BENCH_CLOSE_CACHE[symbol], entry_date[:10], exit_date[:10])


def _max_drawdown(pnls: list[float]) -> float | None:
    if not pnls:
        return None
    # 将每笔 pnl% 视作独立交易收益序列的权益曲线（等权）
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    for p in pnls:
        equity *= 1.0 + p / 100.0
        peak = max(peak, equity)
        dd = (peak - equity) / peak if peak > 0 else 0.0
        max_dd = max(max_dd, dd)
    return round(max_dd * 100.0, 2)


def _info_ratio(excess: list[float]) -> float | None:
    if len(excess) < 2:
        return None
    mean = sum(excess) / len(excess)
    var = sum((x - mean) ** 2 for x in excess) / (len(excess) - 1)
    std = math.sqrt(var) if var > 0 else 0.0
    if std <= 1e-12:
        return None
    return round(mean / std, 3)


def build_review_report(
    *,
    strategy_template_id: str | None = None,
    benchmark: str | None = None,
) -> dict[str, Any]:
    closed = list_cards(status="closed") + list_cards(status="stopped")
    # cancelled 不计入胜率
    if strategy_template_id:
        tid = strategy_template_id.strip().lower()
        closed = [
            c
            for c in closed
            if str(c.get("strategy_template_id") or "long").lower()
            in (tid, {"long_term": "long", "band": "swing"}.get(tid, tid))
        ]

    tmpl = (strategy_template_id or "long").strip().lower()
    bench = benchmark or _BENCHMARKS.get(tmpl, _BENCHMARKS["long"])

    wins: list[float] = []
    losses: list[float] = []
    all_pnls: list[float] = []
    excess_list: list[float] = []
    completeness: list[float] = []
    falsify_checked = 0
    falsify_triggered = 0
    rows: list[dict[str, Any]] = []

    for c in closed:
        pnl = _f(c.get("pnl_pct"))
        comp = _field_completeness(c)
        completeness.append(comp["score"])
        fc = c.get("falsify_check") or {}
        if fc:
            falsify_checked += 1
            if fc.get("any_triggered"):
                falsify_triggered += 1

        bench_ret = _index_return_proxy(
            bench, c.get("entry_date"), c.get("exit_date")
        )
        excess = None
        if pnl is not None and bench_ret is not None:
            excess = round(pnl - bench_ret, 2)
            excess_list.append(excess)

        if pnl is not None:
            all_pnls.append(pnl)
            if pnl >= 0:
                wins.append(pnl)
            else:
                losses.append(pnl)

        rows.append(
            {
                "id": c.get("id"),
                "symbol": c.get("symbol"),
                "status": c.get("status"),
                "pnl_pct": pnl,
                "holding_period_days": c.get("holding_period_days"),
                "exit_reason": c.get("exit_reason"),
                "attribution_tags": c.get("attribution_tags") or [],
                "falsify_any_triggered": bool(fc.get("any_triggered")),
                "completeness": comp["score"],
                "benchmark_return_pct": bench_ret,
                "excess_pct": excess,
            }
        )

    n = len(all_pnls)
    win_rate = round(100.0 * len(wins) / n, 2) if n else None
    avg_win = round(sum(wins) / len(wins), 2) if wins else None
    avg_loss = round(sum(losses) / len(losses), 2) if losses else None
    payoff = None
    if avg_win is not None and avg_loss is not None and abs(avg_loss) > 1e-9:
        payoff = round(avg_win / abs(avg_loss), 3)

    avg_excess = round(sum(excess_list) / len(excess_list), 2) if excess_list else None
    ir = _info_ratio(excess_list)

    open_cards = list_cards(status="open") + list_cards(status="draft")
    all_for_complete = closed + open_cards
    if all_for_complete:
        avg_complete = round(
            sum(_field_completeness(c)["score"] for c in all_for_complete)
            / len(all_for_complete),
            1,
        )
    else:
        avg_complete = None

    data_gaps = []
    if avg_excess is None:
        data_gaps.append("benchmark_interval_return")

    return {
        "ok": True,
        "as_of": datetime.now(_SH).isoformat(timespec="seconds"),
        "strategy_template_id": tmpl,
        "benchmark": bench,
        "closed_count": len(closed),
        "sample_pnl_count": n,
        "win_rate_pct": win_rate,
        "avg_win_pct": avg_win,
        "avg_loss_pct": avg_loss,
        "payoff_ratio": payoff,
        "max_drawdown_pct": _max_drawdown(all_pnls),
        "avg_excess_pct": avg_excess,
        "information_ratio": ir,
        "falsify": {
            "checked_count": falsify_checked,
            "triggered_count": falsify_triggered,
            "coverage_pct": (
                round(100.0 * falsify_checked / max(len(closed), 1), 1)
                if closed
                else None
            ),
        },
        "field_completeness_avg_pct": avg_complete,
        "trades": rows[:100],
        "data_gaps": data_gaps,
        "disclaimer": (
            "不构成投资建议；基准超额需区间指数收益，当前若缺 K 线则标 gap。"
            "信息比率为样本内启发式，非样本外验证。"
        ),
    }
