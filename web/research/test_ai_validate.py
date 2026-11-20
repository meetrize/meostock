"""ai_validate 单测：python -m research.test_ai_validate"""

from __future__ import annotations

from research.ai_validate import validate_brief_payload, validate_text_briefs


def test_blocks_direction_without_evidence() -> None:
    r = validate_brief_payload(
        {
            "direction": "bullish",
            "summary": "会涨",
            "evidence_ids": [],
            "confidence": "high",
        }
    )
    assert r["status"] == "blocked"
    assert r["ok"] is False


def test_pass_with_evidence() -> None:
    r = validate_brief_payload(
        {
            "direction": "neutral",
            "summary": "观望",
            "evidence_ids": ["sig_1"],
            "confidence": "medium",
            "data_gaps": [],
        },
        known_evidence_ids={"sig_1"},
    )
    assert r["status"] == "pass"
    assert r["ok"] is True


def test_high_confidence_with_gaps_blocked_or_error() -> None:
    r = validate_brief_payload(
        {
            "direction": "bullish",
            "summary": "进攻",
            "evidence_ids": ["sig_1"],
            "confidence": "high",
            "data_gaps": ["fina"],
        },
        known_evidence_ids={"sig_1"},
    )
    assert r["status"] == "blocked"


def test_metric_conflict() -> None:
    r = validate_brief_payload(
        {
            "direction": "neutral",
            "summary": "ok",
            "evidence_ids": ["sig_1"],
            "confidence": "low",
            "metrics": {"pe": 30},
        },
        known_evidence_ids={"sig_1"},
        metric_snapshots={"pe": {"value": 10}},
    )
    assert r["status"] == "blocked"


def test_text_extract() -> None:
    text = '说明如下：\n```json\n{"direction":"bearish","evidence_ids":["a"],"confidence":"low","summary":"x"}\n```\n'
    out = validate_text_briefs(text, known_evidence_ids={"a"})
    assert out["status"] == "pass"
    assert len(out["briefs"]) == 1


if __name__ == "__main__":
    test_blocks_direction_without_evidence()
    test_pass_with_evidence()
    test_high_confidence_with_gaps_blocked_or_error()
    test_metric_conflict()
    test_text_extract()
    print("ok")
