"""Scope AI 简报：规则组装 + 可选 LLM，一律经校验层。不自动荐股。"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from research.ai_validate import extract_brief_candidates, validate_brief_payload
from research.consistency import check_consistency
from research.scorecard import build_scorecard
from research.timeline import build_timeline

_log = logging.getLogger("research.ai_brief")
_SH = ZoneInfo("Asia/Shanghai")


def _now_iso() -> str:
    return datetime.now(_SH).isoformat(timespec="seconds")


def _rule_brief(
    *,
    code: str,
    scorecard: dict[str, Any],
    consistency: dict[str, Any],
    timeline: dict[str, Any],
    strategy_template_id: str,
) -> dict[str, Any]:
    """基于 Scorecard / 一致性 / 事件轴组装可校验简报（无 LLM 时的默认路径）。"""
    dims = scorecard.get("dimensions") or {}
    evidence_ids: list[str] = []

    # 证据：估值/财务信号 + 时间轴事件
    for key in ("valuation", "fina", "trend", "volume"):
        d = dims.get(key) or {}
        if d.get("ok") and d.get("score") is not None:
            eid = f"sig_{key}_{code}"
            evidence_ids.append(eid)
    for eid in (timeline.get("evidence_ids") or [])[:6]:
        if eid not in evidence_ids:
            evidence_ids.append(eid)

    gaps = list(scorecard.get("data_gaps") or [])
    gaps.extend(timeline.get("data_gaps") or [])
    gaps = sorted(set(gaps))

    conflicts = consistency.get("conflicts") or []
    directions = consistency.get("directions") or {}

    # 方向：冲突多或证据不足 → insufficient_data / neutral；禁止无证据牛熊
    if not evidence_ids:
        direction = "insufficient_data"
        confidence = "low"
        summary = "可见证据不足，无法给出方向判断。请补充财务权限、事件源或完善商业模式确认。"
    elif len(conflicts) >= 2:
        direction = "neutral"
        confidence = "low"
        summary = (
            f"存在 {len(conflicts)} 项一致性冲突（"
            + "；".join(c.get("message", "")[:40] for c in conflicts[:2])
            + "）。建议下钻证据后再决策，本简报不构成买卖建议。"
        )
    else:
        bull = sum(1 for d in directions.values() if d == "bullish")
        bear = sum(1 for d in directions.values() if d == "bearish")
        if bull > bear + 1:
            direction = "bullish"
        elif bear > bull + 1:
            direction = "bearish"
        else:
            direction = "neutral"
        confidence = "medium" if not gaps else "low"
        val = dims.get("valuation") or {}
        summary = (
            f"模板 {strategy_template_id}：综合分 {scorecard.get('total_score')}；"
            f"估值带 {val.get('band') or '—'}；"
            f"事件 {timeline.get('event_count') or 0} 条。"
            "方向仅反映规则启发式，须对照 evidence_ids 下钻；不构成投资建议。"
        )

    falsify = [
        "商业模式仍为未验证却开仓",
        "估值分位快速恶化且财务红旗出现",
        "所属主线进入退潮且个股放量破位",
    ]
    for c in conflicts[:2]:
        if c.get("message"):
            falsify.append(str(c["message"])[:80])

    return {
        "direction": direction,
        "horizon": {"long": "1y", "swing": "1m", "short": "1w"}.get(
            strategy_template_id, "1m"
        ),
        "as_of": _now_iso(),
        "data_gaps": gaps,
        "summary": summary,
        "evidence_ids": evidence_ids,
        "falsify_if": falsify[:6],
        "confidence": confidence,
        "confidence_basis": "rule_engine_from_scorecard_consistency_timeline",
        "metrics": {
            "total_score": scorecard.get("total_score"),
            "pe_percentile": (dims.get("valuation") or {}).get("pe_percentile"),
            "pb_percentile": (dims.get("valuation") or {}).get("pb_percentile"),
        },
    }


def _try_llm_brief(
    *,
    code: str,
    draft: dict[str, Any],
    scorecard: dict[str, Any],
    timeline: dict[str, Any],
) -> dict[str, Any] | None:
    """若 AI 已配置，请求一次短补全；失败则返回 None。"""
    try:
        from ai import config as ai_config

        if not ai_config.is_configured():
            return None
    except Exception:  # noqa: BLE001
        return None

    # 轻量：不走完整 SSE；复用 completions 若可用则跳过，避免 Phase3 绑死供应商
    # 当前以规则简报为主，LLM 增强留给 Agent chat；此处仅尝试解析若上层传入 raw_text
    return None


def generate_brief(
    code: str,
    *,
    strategy_template_id: str = "long",
    user_question: str | None = None,
    raw_model_text: str | None = None,
) -> dict[str, Any]:
    scorecard = build_scorecard(code, strategy_template_id=strategy_template_id)
    consistency = check_consistency(
        code, strategy_template_id=strategy_template_id, scorecard=scorecard
    )
    timeline = build_timeline(code, name=scorecard.get("name") or "")

    known: set[str] = set()
    for key in ("valuation", "fina", "trend", "volume", "business", "event"):
        known.add(f"sig_{key}_{scorecard.get('symbol') or code}")
    for eid in timeline.get("evidence_ids") or []:
        known.add(str(eid))

    snapshots = {
        "total_score": {"value": scorecard.get("total_score")},
        "pe_percentile": {
            "value": ((scorecard.get("dimensions") or {}).get("valuation") or {}).get(
                "pe_percentile"
            )
        },
        "pb_percentile": {
            "value": ((scorecard.get("dimensions") or {}).get("valuation") or {}).get(
                "pb_percentile"
            )
        },
    }

    candidate: dict[str, Any] | None = None
    origin = "rule"

    if raw_model_text:
        found = extract_brief_candidates(raw_model_text)
        if found:
            candidate = found[0]
            origin = "model_text"

    if candidate is None:
        llm = _try_llm_brief(
            code=code, draft={}, scorecard=scorecard, timeline=timeline
        )
        if llm:
            candidate = llm
            origin = "llm"

    if candidate is None:
        candidate = _rule_brief(
            code=str(scorecard.get("symbol") or code),
            scorecard=scorecard,
            consistency=consistency,
            timeline=timeline,
            strategy_template_id=strategy_template_id,
        )
        origin = "rule"

    if user_question:
        candidate["user_question"] = user_question[:500]

    validation = validate_brief_payload(
        candidate,
        known_evidence_ids=known,
        metric_snapshots=snapshots,
    )

    return {
        "ok": validation.get("status") != "blocked",
        "as_of": _now_iso(),
        "symbol": scorecard.get("symbol") or code,
        "strategy_template_id": strategy_template_id,
        "origin": origin,
        "brief": validation.get("payload") or candidate,
        "validation": {
            "status": validation.get("status"),
            "errors": validation.get("errors") or [],
            "warnings": validation.get("warnings") or [],
            "display": validation.get("display"),
        },
        "context": {
            "total_score": scorecard.get("total_score"),
            "conflict_count": consistency.get("conflict_count"),
            "event_count": timeline.get("event_count"),
            "data_gaps": sorted(
                set(
                    (scorecard.get("data_gaps") or [])
                    + (timeline.get("data_gaps") or [])
                )
            ),
        },
        "auto_recommend": False,
        "disclaimer": "不构成投资建议；禁止将简报当作自动荐股。校验未通过时仅可作 reference_only。",
    }
