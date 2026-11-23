"""rule_engine 单元测试。"""

from __future__ import annotations

from research.rule_engine import (
    eval_breakout_volume,
    eval_ma_bull_stack,
    eval_ma_dual_coil,
    evaluate_rules_on_bars,
)


def _bars_from_closes(closes: list[float], vol: float = 1000.0) -> list[dict]:
    out = []
    for i, c in enumerate(closes):
        out.append(
            {
                "date": f"2024-01-{i+1:02d}",
                "close": c,
                "volume": vol * (1.0 + (0.05 if i == len(closes) - 1 else 0)),
                "open": c,
                "high": c,
                "low": c,
            }
        )
    return out


def test_ma_bull_stack_hit():
    # 构造上升序列，短均线自然高于长均线
    closes = [float(100 + i * 0.5) for i in range(120)]
    ok, why, fac = eval_ma_bull_stack(closes, periods=[5, 10, 20, 60], require_price_above=60)
    assert ok
    assert why
    assert fac.get("ma_stack") is True


def test_ma_dual_coil_near():
    closes = [100.0] * 100
    # 平坦序列：双线粘合且价在线上
    ok, why, _ = eval_ma_dual_coil(closes, slow=60, slower=89, max_gap_pct=3.0)
    assert ok
    assert any("粘合" in w for w in why)


def test_breakout_volume():
    closes = [10.0] * 25 + [12.0]
    volumes = [100.0] * 25 + [300.0]
    ok, why, fac = eval_breakout_volume(closes, volumes, lookback=20, volume_multiple=1.8)
    assert ok
    assert fac.get("breakout") is True


def test_evaluate_rules_and():
    closes = [float(100 + i * 0.4) for i in range(120)]
    bars = _bars_from_closes(closes, vol=2000)
    # 抬高末日量以便若叠加突破也能测；这里只测多头
    rules = {
        "all": [
            {
                "op": "ma.bull_stack",
                "params": {"periods": [5, 10, 20, 60], "require_price_above": 60},
            },
            {"op": "quote.exclude_st", "params": {"enabled": True}},
        ]
    }
    judged = evaluate_rules_on_bars(bars, rules, quote={"name": "测试股份"})
    assert judged["ok"] is True
    assert judged["why_hit"]
