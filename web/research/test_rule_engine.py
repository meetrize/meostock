"""rule_engine 单元测试。"""

from __future__ import annotations

from research.rule_engine import (
    eval_breakout_volume,
    eval_ma_bull_stack,
    eval_ma_dual_coil,
    eval_volume_price_sync_rise,
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


def test_volume_price_sync_rise():
    # 价量总体抬升：多数上涨日放量，夹杂 1～2 日例外
    closes = [20.0, 20.5, 21.0, 20.7, 21.2, 21.8, 22.5, 22.4, 23.0, 23.8, 24.5, 24.2]
    volumes = [
        1000,
        1200,
        1100,  # 价升量缩例外
        900,
        1300,
        1800,
        3500,
        3400,
        4000,
        5200,
        7000,
        6000,
    ]
    ok, why, fac = eval_volume_price_sync_rise(
        closes,
        volumes,
        lookback=12,
        min_price_rise_pct=8.0,
        min_vol_ratio=1.5,
        min_sync_ratio=0.55,
        max_price_up_vol_down=3,
        near_high_pct=5.0,
        min_price_up_days=4,
        enhancements=False,
    )
    assert ok
    assert fac.get("sync_ratio", 0) >= 0.55
    assert any("同步" in w for w in why)

    # 价升但量不抬升 → 不命中
    flat_vol = [1000.0] * 12
    ok2, _, _ = eval_volume_price_sync_rise(closes, flat_vol, lookback=12, enhancements=False)
    assert ok2 is False


def test_volume_price_sync_rise_enhancements():
    # 足够长的上升序列：满足齐升 + MA20 + 突破前高站稳
    closes = [10.0 + i * 0.05 for i in range(70)] + [
        14.0,
        14.3,
        14.6,
        14.4,
        14.9,
        15.3,
        15.8,
        15.7,
        16.2,
        16.7,
        17.2,
        17.0,
    ]
    volumes = [1000.0] * 70 + [
        1200,
        1400,
        1300,
        1100,
        1600,
        2000,
        2800,
        2700,
        3200,
        3800,
        4500,
        4000,
    ]
    ok, why, fac = eval_volume_price_sync_rise(
        closes,
        volumes,
        lookback=12,
        enhancements=True,
        require_ma20_up=True,
        max_price_rise_pct=40.0,
        min_up_day_vol_share=0.5,
        max_day_vol_multiple=8.0,
        require_break_hold=True,
        break_lookback=20,
        tag_ma5_pullback=True,
    )
    assert ok
    assert fac.get("above_ma20") is True
    assert fac.get("break_hold") is True
    assert any("MA20" in w for w in why)

    # 涨幅上限过严 → 不命中
    ok2, _, _ = eval_volume_price_sync_rise(
        closes,
        volumes,
        lookback=12,
        enhancements=True,
        max_price_rise_pct=5.0,
        require_break_hold=False,
    )
    assert ok2 is False


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
