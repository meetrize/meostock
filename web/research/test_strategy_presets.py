"""strategy_presets 冒烟测试。"""

from __future__ import annotations

from research.strategy_presets import (
    eod_filters_from_preset,
    get_preset,
    list_presets,
    preset_rules_from_eod_filters,
    resolve_copy,
    rule_block_to_sentence,
    schema_public,
)


def test_list_and_get_official_presets():
    all_rows = list_presets()
    assert len(all_rows) >= 8
    ids = {r["id"] for r in all_rows}
    assert "eod_intraday_strength" in ids
    assert "quality_value" in ids
    short = list_presets(horizon="short")
    assert all(r["horizon"] == "short" for r in short)
    assert get_preset("missing") is None
    eod = get_preset("eod_intraday_strength")
    assert eod and eod["runnable"] is True
    assert eod["run_engine"] == "eod_intraday"


def test_eod_filter_roundtrip():
    preset = get_preset("eod_intraday_strength")
    assert preset
    filters = eod_filters_from_preset(preset)
    assert filters["marketCapMin"] == 50
    assert filters["timelineAboveAvgRatio"] == 80
    rules = preset_rules_from_eod_filters({**filters, "changePercentMax": 6})
    ops = [b["op"] for b in rules["all"]]
    assert "quote.change_percent" in ops
    change = next(b for b in rules["all"] if b["op"] == "quote.change_percent")
    assert change["params"]["max"] == 6


def test_resolve_copy_conditions():
    preset = get_preset("ma_bull_stack")
    assert preset
    copy = resolve_copy(preset)
    assert copy["headline"]
    assert isinstance(copy["conditions"], list)
    assert len(copy["conditions"]) >= 1
    assert "非投资建议" in copy["disclaimer"]
    locked = resolve_copy(
        preset,
        overrides={"headline": "手工标题"},
        locked_fields=["conditions"],
    )
    assert locked["headline"] == "手工标题"
    # locked conditions → 不强制写入派生清单时仍可能没有 conditions 键
    # 这里验证 overrides 生效即可
    sentence = rule_block_to_sentence(preset["rules"]["all"][0])
    assert "均线" in sentence or "MA" in sentence


def test_schema_public():
    sch = schema_public()
    assert sch["version"] == 1
    assert "quote.market_cap" in sch["rule_ops"]
