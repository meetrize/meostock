"""公告影响力打分：规则基础分 × 规模 × 首次披露 × 质地近似。"""

from __future__ import annotations

from typing import Any

from cninfo.impact_rules import load_taxonomy

_LEVEL_RANK = {"S": 0, "M": 1, "L": 2, "XL": 3}


def level_from_score(score: float) -> str:
    tax = load_taxonomy()
    th = tax.get("score_thresholds") or {}
    if score >= float(th.get("XL", 75)):
        return "XL"
    if score >= float(th.get("L", 55)):
        return "L"
    if score >= float(th.get("M", 35)):
        return "M"
    return "S"


def max_level(a: str, b: str) -> str:
    return a if _LEVEL_RANK.get(a, 0) >= _LEVEL_RANK.get(b, 0) else b


def min_level_floor(level: str, floor: str | None) -> str:
    if not floor:
        return level
    return max_level(level, floor)


def _base_score(category: str, candidate_level: str) -> float:
    tax = load_taxonomy()
    bases = tax.get("base_scores") or {}
    if category in bases:
        return float(bases[category])
    key = f"default_{candidate_level.lower()}"
    if candidate_level == "XL":
        key = "default_xl"
    elif candidate_level == "L":
        key = "default_l"
    elif candidate_level == "M":
        key = "default_m"
    else:
        key = "default_s"
    return float(bases.get(key, 40))


def _scale_factor(materiality: dict[str, Any] | None) -> float:
    if not materiality:
        return 1.0
    factors: list[float] = []
    for key, lo, hi, mult_lo, mult_hi in (
        ("pct_of_revenue", 0.05, 0.30, 0.85, 1.35),
        ("pct_of_mktcap", 0.03, 0.20, 0.85, 1.25),
        ("pct_of_nav", 0.05, 0.20, 0.9, 1.3),
    ):
        v = materiality.get(key)
        if v is None:
            continue
        try:
            x = float(v)
        except (TypeError, ValueError):
            continue
        if x >= hi:
            factors.append(mult_hi)
        elif x >= lo:
            # 线性插值
            t = (x - lo) / max(hi - lo, 1e-9)
            factors.append(mult_lo + t * (mult_hi - mult_lo))
        else:
            factors.append(0.75 + 0.1 * max(0.0, x / max(lo, 1e-9)))
    if not factors:
        return 1.0
    return max(0.3, min(1.5, sum(factors) / len(factors)))


def _first_disclosure_factor(*, is_first: bool, stage: str, pseudo_hits: list[str]) -> float:
    if is_first and stage not in ("draft_revision", "progress", "inquiry", "abnormal_move"):
        return 1.0
    if stage == "draft_revision" or any("修订" in str(x) for x in pseudo_hits):
        return 0.4
    if stage in ("progress", "inquiry"):
        return 0.45
    if stage == "abnormal_move":
        return 0.35
    if stage == "clarification":
        return 0.55
    if pseudo_hits:
        return 0.5
    return 0.85


def _quality_factor(flags: dict[str, Any] | None) -> float:
    if not flags:
        return 1.0
    f = 1.0
    if flags.get("cancel_repurchase"):
        f *= 1.08
    if flags.get("related_party"):
        f *= 0.97
    if flags.get("target_profitable") is False:
        f *= 0.9
    if flags.get("has_lockup"):
        f *= 1.03
    if flags.get("framework_no_amount"):
        f *= 0.55
    return max(0.4, min(1.2, f))


def compute_score(
    *,
    candidate_level: str,
    category: str,
    is_first_disclosure: bool,
    disclosure_stage: str,
    pseudo_hits: list[str] | None = None,
    materiality: dict[str, Any] | None = None,
    quality_flags: dict[str, Any] | None = None,
    llm_base_score: float | None = None,
    hard_floor: str | None = None,
    direction: str = "neutral",
) -> dict[str, Any]:
    base = float(llm_base_score) if llm_base_score is not None else _base_score(category, candidate_level)
    scale = _scale_factor(materiality)
    first = _first_disclosure_factor(
        is_first=bool(is_first_disclosure),
        stage=disclosure_stage or "unknown",
        pseudo_hits=list(pseudo_hits or []),
    )
    quality = _quality_factor(quality_flags)
    # 市值环境一期固定 1.0（二期接行情分档）
    mkt = 1.0
    score = base * scale * first * quality * mkt
    score = max(0.0, min(120.0, score))

    level = level_from_score(score)
    # 候选级与打分级取较高（避免规则 XL 被过度降权到中），但首次降权仍可压低
    if first >= 0.9:
        level = max_level(level, candidate_level)
    else:
        # 非首次：可低于候选；原 XL 修订稿至少保留「大」，原 L 至少「中」
        if candidate_level == "XL":
            level = max_level(level, "L")
        elif candidate_level == "L":
            level = max_level(level, "M")

    # 框架无金额不得特大
    if quality_flags and quality_flags.get("framework_no_amount"):
        if level == "XL":
            level = "M"
        score = min(score, 50.0)

    # 合同占比 ≥30% 可升特大（偏多）
    try:
        rev = float((materiality or {}).get("pct_of_revenue") or 0)
    except (TypeError, ValueError):
        rev = 0.0
    if rev >= 0.30 and direction == "bullish":
        level = max_level(level, "XL")
        score = max(score, 76.0)

    level = min_level_floor(level, hard_floor)

    return {
        "score": round(score, 2),
        "final_level": level,
        "factors": {
            "base": round(base, 2),
            "scale": round(scale, 3),
            "first_disclosure": round(first, 3),
            "quality": round(quality, 3),
            "market": mkt,
        },
    }
