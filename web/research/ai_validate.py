"""AI 研判输出校验层（设计方案 §5.4）。

规则：
1. 方向句必须带非空 evidence_ids，且每个 id 可解析（有 known_evidence 时）
2. 数值须与 MetricSnapshot 一致（提供 snapshots 时）
3. 无法验证时降级为 reference_only，不得伪装成硬事实
4. 存在 data_gaps 时不得给出 high 置信度
"""

from __future__ import annotations

import json
import re
from typing import Any

_ALLOWED_DIRECTIONS = frozenset(
    {"bullish", "neutral", "bearish", "insufficient_data"}
)
_ALLOWED_CONFIDENCE = frozenset({"high", "medium", "low"})
_JSON_FENCE = re.compile(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", re.IGNORECASE)
_BARE_OBJ = re.compile(r"(\{[\s\S]*\})")


def extract_brief_candidates(text: str) -> list[dict[str, Any]]:
    """从模型回复中提取疑似 AiBrief JSON 对象。"""
    if not text or not text.strip():
        return []
    found: list[dict[str, Any]] = []
    for m in _JSON_FENCE.finditer(text):
        obj = _try_parse(m.group(1))
        if obj and _looks_like_brief(obj):
            found.append(obj)
    if not found:
        m = _BARE_OBJ.search(text)
        if m:
            obj = _try_parse(m.group(1))
            if obj and _looks_like_brief(obj):
                found.append(obj)
    return found


def _try_parse(raw: str) -> dict[str, Any] | None:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _looks_like_brief(obj: dict[str, Any]) -> bool:
    keys = set(obj.keys())
    return bool(keys & {"direction", "evidence_ids", "summary", "confidence"})


def validate_brief_payload(
    payload: dict[str, Any],
    *,
    known_evidence_ids: set[str] | None = None,
    metric_snapshots: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """校验单条简报；返回 {ok, status, errors, warnings, payload, display}。

    status: pass | blocked | reference_only
    """
    errors: list[str] = []
    warnings: list[str] = []
    cleaned = dict(payload)

    direction = cleaned.get("direction")
    if direction not in _ALLOWED_DIRECTIONS:
        errors.append("direction 缺失或非法")

    evidence_ids = cleaned.get("evidence_ids")
    if not isinstance(evidence_ids, list) or not evidence_ids:
        errors.append("evidence_ids 为空：禁止无证据方向断言")
        evidence_ids = []
    else:
        evidence_ids = [str(x).strip() for x in evidence_ids if str(x).strip()]
        cleaned["evidence_ids"] = evidence_ids
        if not evidence_ids:
            errors.append("evidence_ids 为空：禁止无证据方向断言")
        elif known_evidence_ids is not None:
            missing = [eid for eid in evidence_ids if eid not in known_evidence_ids]
            if missing:
                errors.append(f"evidence_ids 不可解析: {', '.join(missing[:8])}")

    confidence = cleaned.get("confidence")
    if confidence is not None and confidence not in _ALLOWED_CONFIDENCE:
        errors.append("confidence 非法")
        confidence = None

    gaps = cleaned.get("data_gaps")
    if isinstance(gaps, list) and gaps and confidence == "high":
        errors.append("存在 data_gaps 时不得给出 high 置信度")

    # 数值一致性：payload.metrics[{key: value}] vs snapshots
    metrics = cleaned.get("metrics")
    if isinstance(metrics, dict) and metric_snapshots:
        for key, val in metrics.items():
            snap = metric_snapshots.get(str(key))
            if snap is None:
                warnings.append(f"指标 {key} 无快照可对验")
                continue
            snap_val = snap.get("value") if isinstance(snap, dict) else snap
            if snap_val is None:
                continue
            if not _values_close(val, snap_val):
                errors.append(
                    f"数值与数据源冲突: {key} 模型={val!r} 快照={snap_val!r}"
                )

    has_hard_error = any(
        e.startswith("evidence_ids")
        or e.startswith("数值与数据源冲突")
        or "不得给出 high" in e
        or e.startswith("direction")
        for e in errors
    )
    if errors and (direction in {"bullish", "bearish"} or has_hard_error):
        status = "blocked"
        ok = False
        display = "已拦截：方向结论未通过证据/数值校验"
    elif errors:
        status = "reference_only"
        ok = False
        display = "仅供参考（未校验）"
        warnings.extend(errors)
        errors = []
    else:
        status = "pass"
        ok = True
        display = None

    return {
        "ok": ok,
        "status": status,
        "errors": errors,
        "warnings": warnings,
        "payload": cleaned,
        "display": display,
        "disclaimer": "不构成投资建议；数据可能延迟。",
    }


def validate_text_briefs(
    text: str,
    *,
    known_evidence_ids: set[str] | None = None,
    metric_snapshots: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """校验回复中所有疑似 brief；无 brief 结构则跳过。"""
    candidates = extract_brief_candidates(text)
    if not candidates:
        return {
            "ok": True,
            "status": "skipped",
            "briefs": [],
            "blocked": False,
            "message": None,
        }
    results = [
        validate_brief_payload(
            c,
            known_evidence_ids=known_evidence_ids,
            metric_snapshots=metric_snapshots,
        )
        for c in candidates
    ]
    blocked = any(r["status"] == "blocked" for r in results)
    ref_only = any(r["status"] == "reference_only" for r in results)
    if blocked:
        msg = "研判校验：存在无证据/数值冲突的方向结论，已拦截展示为硬事实。"
    elif ref_only:
        msg = "研判校验：部分结论降级为「仅供参考（未校验）」。"
    else:
        msg = None
    return {
        "ok": not blocked,
        "status": "blocked" if blocked else ("reference_only" if ref_only else "pass"),
        "briefs": results,
        "blocked": blocked,
        "message": msg,
    }


def _values_close(a: Any, b: Any, *, rel: float = 1e-4) -> bool:
    try:
        fa, fb = float(a), float(b)
    except (TypeError, ValueError):
        return str(a).strip() == str(b).strip()
    if fa == fb:
        return True
    denom = max(abs(fa), abs(fb), 1e-12)
    return abs(fa - fb) / denom <= rel
