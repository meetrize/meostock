"""LLM 对公告正文做结构化影响力判定。"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from ai.client import chat_json_content
from ai import config as ai_config

_log = logging.getLogger("cninfo.impact_judge")

_SYSTEM = """你是 A 股公告分析助手。只依据用户给出的标题与正文片段判断对短期股价（1-5 个交易日）的冲击。
禁止编造正文未出现的数字。必须输出 JSON 对象，字段如下：
{
  "event_type": "字符串，如 asset_restructuring/earnings/contract/监管/debt/buyback/other",
  "direction": "bullish|bearish|mixed|neutral",
  "level": "XL|L|M|S",
  "is_first_disclosure": true/false,
  "disclosure_stage": "preview|draft|draft_revision|progress|inquiry|approved|clarification|unknown",
  "materiality": {"deal_value_text": null或字符串, "pct_of_revenue": null或0-1小数, "pct_of_mktcap": null或小数, "pct_of_nav": null或小数},
  "quality_flags": {"target_profitable": null或bool, "has_lockup": null或bool, "related_party": null或bool, "cancel_repurchase": null或bool, "framework_no_amount": null或bool},
  "base_score": 0-100数字,
  "expected_gap_hint": "一句话预期差说明",
  "reasons": ["命中原因1", "原因2"],
  "core_summary": "2-4句中文核心摘要，写清对股价最关键的信息",
  "core_quotes": ["原文短句1", "原文短句2"],
  "risk_flags": ["风险点"],
  "confidence": 0-1
}
级别含义：XL特大(易涨跌停)、L大(约3%-10%)、M中、S小。
修订稿/进展/问询回复通常不是首次披露，is_first_disclosure=false，level 与 base_score 应低于首次预案。
框架协议且无金额：framework_no_amount=true，不得给 XL。
澄清「传闻不属实」通常偏 bearish 或降温。"""


def _strip_code_fence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        lines = s.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        s = "\n".join(lines).strip()
    return s


def _normalize_level(v: Any) -> str | None:
    s = str(v or "").strip().upper()
    mapping = {
        "XL": "XL",
        "特大": "XL",
        "L": "L",
        "大": "L",
        "M": "M",
        "中": "M",
        "S": "S",
        "小": "S",
        "L3": "XL",
        "L2": "L",
        "L1": "S",
    }
    return mapping.get(s)


def _normalize_direction(v: Any) -> str:
    s = str(v or "").strip().lower()
    mapping = {
        "bullish": "bullish",
        "positive": "bullish",
        "利好": "bullish",
        "偏多": "bullish",
        "bearish": "bearish",
        "negative": "bearish",
        "利空": "bearish",
        "偏空": "bearish",
        "mixed": "mixed",
        "中性偏多": "mixed",
        "neutral": "neutral",
        "中性": "neutral",
    }
    return mapping.get(s, "neutral")


def judge_announcement(
    *,
    title: str,
    text: str,
    triage: dict[str, Any],
    materiality_hint: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """调用 LLM；失败抛异常由上层回退 title_only。"""
    if not ai_config.is_configured():
        raise RuntimeError("未配置 AI 模型")

    body = (text or "").strip()
    if len(body) > 16000:
        body = body[:16000]

    user = {
        "title": title,
        "triage_hint": {
            "candidate_level": triage.get("candidate_level"),
            "direction_prior": triage.get("direction_prior"),
            "category": triage.get("category"),
            "disclosure_stage": triage.get("disclosure_stage"),
            "is_first_disclosure": bool(triage.get("is_first_disclosure")),
            "matched_rules": (triage.get("matched_rules") or [])[:12],
            "pseudo_hits": triage.get("pseudo_hits") or [],
        },
        "materiality_hint": materiality_hint or {},
        "body": body or "(无正文，仅根据标题判断)",
    }

    raw = chat_json_content(
        [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
        ],
        temperature=0.1,
        max_tokens=1800,
    )
    if not isinstance(raw, dict):
        raise RuntimeError("LLM 返回非对象")

    level = _normalize_level(raw.get("level")) or str(triage.get("candidate_level") or "M")
    direction = _normalize_direction(raw.get("direction") or triage.get("direction_prior"))

    mat = raw.get("materiality") if isinstance(raw.get("materiality"), dict) else {}
    if materiality_hint:
        for k, v in materiality_hint.items():
            if v is not None and mat.get(k) is None:
                mat[k] = v

    reasons = raw.get("reasons") if isinstance(raw.get("reasons"), list) else []
    quotes = raw.get("core_quotes") if isinstance(raw.get("core_quotes"), list) else []
    risks = raw.get("risk_flags") if isinstance(raw.get("risk_flags"), list) else []

    # 清洗引用：过长截断
    quotes = [str(q).strip()[:180] for q in quotes if str(q).strip()][:3]
    reasons = [str(r).strip()[:80] for r in reasons if str(r).strip()][:8]
    risks = [str(r).strip()[:80] for r in risks if str(r).strip()][:6]

    try:
        base_score = float(raw.get("base_score"))
    except (TypeError, ValueError):
        base_score = None

    try:
        confidence = float(raw.get("confidence"))
    except (TypeError, ValueError):
        confidence = 0.6
    confidence = max(0.0, min(1.0, confidence))

    is_first = raw.get("is_first_disclosure")
    if is_first is None:
        is_first = bool(triage.get("is_first_disclosure"))
    else:
        is_first = bool(is_first)

    stage = str(raw.get("disclosure_stage") or triage.get("disclosure_stage") or "unknown")
    # 标题已标修订稿时强制非首次
    if triage.get("disclosure_stage") == "draft_revision":
        is_first = False
        stage = "draft_revision"

    summary = str(raw.get("core_summary") or "").strip()
    if not summary and quotes:
        summary = "；".join(quotes[:2])

    return {
        "event_type": str(raw.get("event_type") or triage.get("category") or "other"),
        "direction": direction,
        "level": level,
        "is_first_disclosure": 1 if is_first else 0,
        "disclosure_stage": stage,
        "materiality": mat,
        "quality_flags": raw.get("quality_flags") if isinstance(raw.get("quality_flags"), dict) else {},
        "base_score": base_score,
        "expected_gap_hint": str(raw.get("expected_gap_hint") or "").strip()[:200],
        "reasons": reasons,
        "core_summary": summary[:600],
        "core_quotes": quotes,
        "risk_flags": risks,
        "confidence": confidence,
        "raw": raw,
    }


def title_only_summary(title: str, triage: dict[str, Any]) -> dict[str, Any]:
    """无 LLM / 无正文时的降级结果。"""
    reasons = []
    for r in triage.get("matched_rules") or []:
        if isinstance(r, str) and not r.startswith("pseudo:"):
            reasons.append(r.split(":", 1)[-1][:40])
    reasons = reasons[:6] or ["标题规则命中"]
    if triage.get("pseudo_hits"):
        reasons.append("非首次/伪信号降权")
    return {
        "event_type": triage.get("category") or "other",
        "direction": triage.get("direction_prior") or "neutral",
        "level": triage.get("candidate_level") or "S",
        "is_first_disclosure": int(triage.get("is_first_disclosure") or 0),
        "disclosure_stage": triage.get("disclosure_stage") or "unknown",
        "materiality": {},
        "quality_flags": {"framework_no_amount": bool(re.search(r"框架协议|战略合作", title)) and not re.search(r"亿元|万元", title)},
        "base_score": None,
        "expected_gap_hint": "",
        "reasons": reasons,
        "core_summary": f"【标题分流】{title}"[:300],
        "core_quotes": [],
        "risk_flags": [],
        "confidence": 0.35,
        "raw": None,
    }
