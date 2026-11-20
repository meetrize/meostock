"""行为偏差检测（§4.9）：处置效应 / 追涨杀跌 / 频繁交易 / 亏损加仓。"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from research.cards_store import list_cards
from research.kline_series import closes_by_date, interval_return, load_daily_bars

_SH = ZoneInfo("Asia/Shanghai")


def _f(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _days(a: str | None, b: str | None) -> int | None:
    if not a or not b:
        return None
    try:
        d0 = datetime.fromisoformat(a[:10])
        d1 = datetime.fromisoformat(b[:10])
        return max(0, (d1 - d0).days)
    except ValueError:
        return None


def detect_behavior_biases(
    *,
    lookback_cards: int = 200,
) -> dict[str, Any]:
    closed = list_cards(status="closed") + list_cards(status="stopped")
    open_cards = list_cards(status="open")
    closed = closed[:lookback_cards]

    win_holds: list[int] = []
    loss_holds: list[int] = []
    by_symbol: dict[str, list[dict[str, Any]]] = defaultdict(list)
    chase_flags = 0
    chase_checked = 0
    add_loss_flags = 0

    for c in closed:
        pnl = _f(c.get("pnl_pct"))
        hold = c.get("holding_period_days")
        if hold is None:
            hold = _days(c.get("entry_date"), c.get("exit_date"))
        if pnl is not None and hold is not None:
            if pnl >= 0:
                win_holds.append(int(hold))
            else:
                loss_holds.append(int(hold))
        sym = str(c.get("symbol") or "").upper()
        if sym:
            by_symbol[sym].append(c)

        # 追涨：买入日前 5 日涨幅 > 8%
        entry = str(c.get("entry_date") or "")[:10]
        if sym and entry:
            chase_checked += 1
            try:
                bars = load_daily_bars(sym, limit=120, fetch_if_empty=False)
                closes = closes_by_date(bars)
                # 找 entry 前约 5 个交易日
                dates = sorted(d for d in closes if d <= entry)
                if len(dates) >= 6:
                    ret = interval_return(closes, dates[-6], dates[-1])
                    if ret is not None and ret >= 8.0:
                        chase_flags += 1
            except Exception:  # noqa: BLE001
                pass

    # 处置效应：盈利持仓天数 < 亏损持仓天数
    avg_win = round(sum(win_holds) / len(win_holds), 2) if win_holds else None
    avg_loss = round(sum(loss_holds) / len(loss_holds), 2) if loss_holds else None
    disposition = {
        "id": "disposition_effect",
        "name": "处置效应",
        "triggered": bool(
            avg_win is not None and avg_loss is not None and avg_win < avg_loss
        ),
        "avg_win_hold_days": avg_win,
        "avg_loss_hold_days": avg_loss,
        "detail": (
            f"盈利均持 {avg_win} 天 vs 亏损均持 {avg_loss} 天"
            if avg_win is not None and avg_loss is not None
            else "样本不足"
        ),
        "severity": "medium",
    }

    chase_ratio = (
        round(100.0 * chase_flags / chase_checked, 1) if chase_checked else None
    )
    chase = {
        "id": "chase_momentum",
        "name": "追涨杀跌",
        "triggered": bool(chase_ratio is not None and chase_ratio >= 40),
        "chase_entry_pct": chase_ratio,
        "checked": chase_checked,
        "flagged": chase_flags,
        "detail": (
            f"买入前 5 日涨幅≥8% 占比 {chase_ratio}%"
            if chase_ratio is not None
            else "样本不足或无 K 线"
        ),
        "severity": "medium",
    }

    # 频繁交易：同票 ≥3 次进出
    repeat_syms = {s: len(v) for s, v in by_symbol.items() if len(v) >= 3}
    # 年化换手粗估：结案次数 / 跨度年
    dates = []
    for c in closed:
        for k in ("entry_date", "exit_date"):
            d = str(c.get(k) or "")[:10]
            if d:
                dates.append(d)
    span_years = None
    if len(dates) >= 2:
        try:
            d0 = datetime.fromisoformat(min(dates))
            d1 = datetime.fromisoformat(max(dates))
            span_years = max((d1 - d0).days / 365.25, 1 / 12)
        except ValueError:
            span_years = None
    turnover = (
        round(len(closed) / span_years, 2) if span_years and span_years > 0 else None
    )
    frequent = {
        "id": "frequent_trading",
        "name": "频繁交易",
        "triggered": bool(
            (turnover is not None and turnover >= 12)
            or len(repeat_syms) >= 1
        ),
        "annualized_roundtrips": turnover,
        "repeat_symbols": [
            {"symbol": s, "count": n}
            for s, n in sorted(repeat_syms.items(), key=lambda x: -x[1])[:8]
        ],
        "detail": (
            f"年化进出约 {turnover} 次；重复标的 {len(repeat_syms)} 只"
            if turnover is not None
            else f"重复标的 {len(repeat_syms)} 只"
        ),
        "severity": "low" if not repeat_syms else "medium",
    }

    # 亏损加仓：同票后一笔 entry 时前一笔仍亏损（用两笔 entry 价格粗判）或 attribution 标签
    for sym, rows in by_symbol.items():
        rows_sorted = sorted(
            rows, key=lambda x: str(x.get("entry_date") or x.get("created_at") or "")
        )
        for i in range(1, len(rows_sorted)):
            prev = rows_sorted[i - 1]
            cur = rows_sorted[i]
            tags = [str(t).lower() for t in (cur.get("attribution_tags") or [])]
            if any("加仓" in t or "补仓" in t or "averag" in t for t in tags):
                add_loss_flags += 1
                continue
            # 若前一笔最终亏损且后一笔开仓更早于前一笔结案 → 疑似浮亏加仓
            prev_exit = str(prev.get("exit_date") or "")[:10]
            cur_entry = str(cur.get("entry_date") or "")[:10]
            prev_pnl = _f(prev.get("pnl_pct"))
            if (
                prev_exit
                and cur_entry
                and cur_entry <= prev_exit
                and prev_pnl is not None
                and prev_pnl < 0
            ):
                add_loss_flags += 1

    # open 卡片：浮亏≥10% 且 position 声明偏高 —— 提示性
    underwater_open = 0
    for c in open_cards:
        # 无实时 pnl 时跳过；portfolio_risk 另算
        if "亏损加仓" in str(c.get("attribution_note") or ""):
            add_loss_flags += 1
            underwater_open += 1

    add_loss = {
        "id": "add_to_losers",
        "name": "亏损加仓",
        "triggered": add_loss_flags >= 1,
        "count": add_loss_flags,
        "detail": f"疑似亏损加仓 {add_loss_flags} 次（含标签与重叠持仓启发式）",
        "severity": "high" if add_loss_flags >= 2 else "medium",
    }

    biases = [disposition, chase, frequent, add_loss]
    triggered = [b for b in biases if b.get("triggered")]

    # 建议写入 attribution 的标签
    suggested_tags = [b["name"] for b in triggered]

    return {
        "ok": True,
        "as_of": datetime.now(_SH).isoformat(timespec="seconds"),
        "sample": {
            "closed": len(closed),
            "open": len(open_cards),
            "win_hold_n": len(win_holds),
            "loss_hold_n": len(loss_holds),
        },
        "biases": biases,
        "triggered_count": len(triggered),
        "suggested_attribution_tags": suggested_tags,
        "disclaimer": "仅行为提示与纪律统计，不构成投资建议。",
    }
