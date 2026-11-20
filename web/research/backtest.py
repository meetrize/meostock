"""模板级回测（§9.2 最小可验收实现）。

规则：MA 趋势（价>MA60 且 MA20>MA60 开仓；反向平仓）。
约束：涨跌停/一字不可买、T+1、佣金+印花税+滑点、样本内外分割、规则版本、实验性标记。
"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from research.kline_series import load_daily_bars
from research.limits import get_limit_percent, is_limit_down, is_limit_up

_SH = ZoneInfo("Asia/Shanghai")
RULE_VERSION = "ma_trend.v1.0"
RULE_NAME = "MA 趋势（价>MA60 ∧ MA20>MA60）"


def _f(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _sma(closes: list[float], i: int, n: int) -> float | None:
    if i + 1 < n:
        return None
    window = closes[i + 1 - n : i + 1]
    return sum(window) / n


def _is_one_word(bar: dict[str, Any]) -> bool:
    o, h, low, c = _f(bar.get("open")), _f(bar.get("high")), _f(bar.get("low")), _f(bar.get("close"))
    if None in (o, h, low, c) or min(o, h, low, c) <= 0:  # type: ignore[arg-type]
        return False
    return abs(o - h) < 1e-6 and abs(h - low) < 1e-6 and abs(low - c) < 1e-6  # type: ignore[operator]


def _chg_pct(bar: dict[str, Any], prev_close: float | None) -> float | None:
    c = _f(bar.get("close"))
    if c is None or prev_close in (None, 0):
        return None
    return (c - prev_close) / prev_close * 100.0


def _apply_cost(
    gross_pnl_pct: float,
    *,
    commission_bps: float,
    stamp_tax_bps: float,
    slippage_bps: float,
) -> float:
    # 双边佣金 + 卖出印花税 + 双边滑点（教学向简化）
    cost = (2 * commission_bps + stamp_tax_bps + 2 * slippage_bps) / 100.0
    return round(gross_pnl_pct - cost, 4)


def run_ma_backtest(
    symbol: str,
    *,
    name: str = "",
    train_ratio: float = 0.7,
    commission_bps: float = 3.0,
    stamp_tax_bps: float = 5.0,
    slippage_bps: float = 5.0,
    ma_fast: int = 20,
    ma_slow: int = 60,
    limit: int = 800,
) -> dict[str, Any]:
    bars = load_daily_bars(symbol, limit=limit, fetch_if_empty=True)
    if len(bars) < ma_slow + 5:
        return {
            "ok": False,
            "error": "kline_insufficient",
            "message": f"日 K 不足（需 ≥{ma_slow + 5}，实际 {len(bars)}）",
            "symbol": symbol,
            "rule_version": RULE_VERSION,
            "experimental": True,
        }

    closes = [_f(b.get("close")) or 0.0 for b in bars]
    n = len(bars)
    split = max(ma_slow + 2, int(n * train_ratio))
    split = min(split, n - 5)

    trades_all: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    position: dict[str, Any] | None = None

    for i in range(ma_slow, n):
        bar = bars[i]
        prev = bars[i - 1] if i > 0 else None
        prev_close = _f(prev.get("close")) if prev else None
        chg = _chg_pct(bar, prev_close)
        ma_f = _sma(closes, i, ma_fast)
        ma_s = _sma(closes, i, ma_slow)
        if ma_f is None or ma_s is None:
            continue
        price = closes[i]
        date = bar["date"]
        segment = "train" if i < split else "test"

        # 平仓：跌破慢均或快均下穿
        if position is not None:
            exit_signal = price < ma_s or ma_f < ma_s
            # T+1：至少持有到下一根
            can_exit = date > position["entry_date"]
            if exit_signal and can_exit:
                # 跌停不可卖
                if is_limit_down(symbol, name, chg) or (
                    _is_one_word(bar) and is_limit_down(symbol, name, chg)
                ):
                    skipped.append(
                        {
                            "date": date,
                            "reason": "limit_down_unfillable",
                            "segment": segment,
                        }
                    )
                else:
                    entry_px = float(position["entry_price"])
                    # 滑点：卖出略差
                    exit_px = price * (1.0 - slippage_bps / 10000.0)
                    gross = (exit_px - entry_px) / entry_px * 100.0
                    net = _apply_cost(
                        gross,
                        commission_bps=commission_bps,
                        stamp_tax_bps=stamp_tax_bps,
                        slippage_bps=0,  # 已计入价格
                    )
                    trades_all.append(
                        {
                            **position,
                            "exit_date": date,
                            "exit_price": round(exit_px, 4),
                            "gross_pnl_pct": round(gross, 4),
                            "net_pnl_pct": net,
                            "segment": position["segment"],
                            "holding_bars": i - int(position["entry_idx"]),
                        }
                    )
                    position = None

        # 开仓
        if position is None:
            entry_signal = price > ma_s and ma_f > ma_s
            if not entry_signal:
                continue
            # 涨停/一字不可买
            if is_limit_up(symbol, name, chg) or _is_one_word(bar):
                skipped.append(
                    {
                        "date": date,
                        "reason": "limit_up_or_one_word_unfillable",
                        "segment": segment,
                        "limit_pct": get_limit_percent(symbol, name),
                    }
                )
                continue
            entry_px = price * (1.0 + slippage_bps / 10000.0)
            position = {
                "entry_date": date,
                "entry_price": round(entry_px, 4),
                "entry_idx": i,
                "segment": segment,
                "disclose_at": date,  # 价格信号当日可得，无财报前视
                "adjusted": "qfq_or_raw_cache",
                "restated": False,
            }

    # 强制平未平仓（用最后收盘，标 open_end）
    if position is not None:
        last = bars[-1]
        price = closes[-1]
        entry_px = float(position["entry_price"])
        exit_px = price * (1.0 - slippage_bps / 10000.0)
        gross = (exit_px - entry_px) / entry_px * 100.0
        net = _apply_cost(
            gross,
            commission_bps=commission_bps,
            stamp_tax_bps=stamp_tax_bps,
            slippage_bps=0,
        )
        trades_all.append(
            {
                **position,
                "exit_date": last["date"],
                "exit_price": round(exit_px, 4),
                "gross_pnl_pct": round(gross, 4),
                "net_pnl_pct": net,
                "segment": position["segment"],
                "holding_bars": n - 1 - int(position["entry_idx"]),
                "forced_close": True,
            }
        )

    def _stats(trades: list[dict[str, Any]]) -> dict[str, Any]:
        if not trades:
            return {
                "count": 0,
                "win_rate_pct": None,
                "avg_net_pct": None,
                "total_net_pct": None,
                "max_drawdown_pct": None,
            }
        pnls = [float(t["net_pnl_pct"]) for t in trades]
        wins = [p for p in pnls if p >= 0]
        # 权益曲线回撤
        eq = 1.0
        peak = 1.0
        max_dd = 0.0
        for p in pnls:
            eq *= 1.0 + p / 100.0
            peak = max(peak, eq)
            max_dd = max(max_dd, (peak - eq) / peak if peak else 0.0)
        return {
            "count": len(trades),
            "win_rate_pct": round(100.0 * len(wins) / len(pnls), 2),
            "avg_net_pct": round(sum(pnls) / len(pnls), 3),
            "total_net_pct": round((eq - 1.0) * 100.0, 3),
            "max_drawdown_pct": round(max_dd * 100.0, 2),
        }

    train_trades = [t for t in trades_all if t.get("segment") == "train"]
    test_trades = [t for t in trades_all if t.get("segment") == "test"]
    train_stats = _stats(train_trades)
    test_stats = _stats(test_trades)

    # 样本外：测试集至少 1 笔才算完成验证；否则实验性
    oos_ok = (test_stats.get("count") or 0) >= 1 and len(bars) - split >= 20
    experimental = not oos_ok

    return {
        "ok": True,
        "as_of": datetime.now(_SH).isoformat(timespec="seconds"),
        "symbol": symbol,
        "name": name,
        "rule_id": "ma_trend",
        "rule_name": RULE_NAME,
        "rule_version": RULE_VERSION,
        "params": {
            "ma_fast": ma_fast,
            "ma_slow": ma_slow,
            "train_ratio": train_ratio,
            "commission_bps": commission_bps,
            "stamp_tax_bps": stamp_tax_bps,
            "slippage_bps": slippage_bps,
        },
        "bars": n,
        "date_range": {"start": bars[0]["date"], "end": bars[-1]["date"]},
        "split_index": split,
        "split_date": bars[split]["date"] if split < n else None,
        "train": train_stats,
        "test": test_stats,
        "oos_validated": oos_ok,
        "experimental": experimental,
        "experimental_label": "实验性" if experimental else "已样本外标注",
        "trades": trades_all[-40:],
        "trade_count": len(trades_all),
        "skipped_unfillable": skipped[-20:],
        "skipped_count": len(skipped),
        "assumptions": {
            "disclose_at": "价格信号当日；无财报字段前视",
            "adjusted": "缓存 K 线（东财/新浪等，可能前复权）",
            "survivorship": "单票回测不含退市宇宙重建；全市场扫描级幸存者偏差未消除",
            "fill": "涨停/一字不买入；跌停不卖出；T+1",
            "cost": "佣金双边+印花税卖出+滑点",
            "split": "时间序列前 train_ratio 为样本内，其后为样本外",
        },
        "disclaimer": "不构成投资建议；未满足 §9.2 全部条件的曲线不得作为产品结论。",
    }


def run_backtest(
    *,
    template_id: str = "ma_trend",
    symbol: str,
    name: str = "",
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    p = dict(params or {})
    tid = (template_id or "ma_trend").strip().lower()
    if tid in ("ma_trend", "swing", "trend", "long"):
        return run_ma_backtest(
            symbol,
            name=name,
            train_ratio=float(p.get("train_ratio") or 0.7),
            commission_bps=float(p.get("commission_bps") or 3.0),
            stamp_tax_bps=float(p.get("stamp_tax_bps") or 5.0),
            slippage_bps=float(p.get("slippage_bps") or 5.0),
            ma_fast=int(p.get("ma_fast") or 20),
            ma_slow=int(p.get("ma_slow") or 60),
            limit=int(p.get("limit") or 800),
        )
    return {
        "ok": False,
        "error": "unknown_template",
        "message": f"未知回测模板: {template_id}",
        "experimental": True,
    }
