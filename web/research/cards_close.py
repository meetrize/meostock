"""交易卡片结案：强制归因 + falsify_conditions 自动核对。"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from research.cards_store import get_card, upsert_card

_SH = ZoneInfo("Asia/Shanghai")
_CLOSE_STATUSES = frozenset({"closed", "stopped", "cancelled"})


def _f(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def evaluate_falsify(
    conditions: list[Any] | None,
    *,
    notes: str = "",
    triggered_ids: list[str] | None = None,
) -> dict[str, Any]:
    """对照开卡 falsify_conditions。

    triggered_ids：用户勾选触发的条件下标或原文；未提供则仅做文本提示，不擅自判定触发。
    """
    conds = [str(c).strip() for c in (conditions or []) if str(c).strip()]
    triggered = set(str(x).strip() for x in (triggered_ids or []) if str(x).strip())
    rows: list[dict[str, Any]] = []
    for i, c in enumerate(conds):
        hit = str(i) in triggered or c in triggered
        # 弱匹配：结案备注提到条件关键词
        if not hit and notes and len(c) >= 4 and c[:4] in notes:
            hit = True
        rows.append({"index": i, "condition": c, "triggered": hit})
    any_hit = any(r["triggered"] for r in rows)
    return {
        "conditions": rows,
        "any_triggered": any_hit,
        "unchecked_count": sum(1 for r in rows if not r["triggered"]),
        "note": "客观触发标记与主观归因分开；未勾选不代表未发生",
    }


def close_card(
    card_id: str,
    *,
    status: str = "closed",
    exit_price: float | None = None,
    exit_date: str | None = None,
    exit_reason: str | None = None,
    attribution_tags: list[str] | None = None,
    attribution_note: str | None = None,
    falsify_triggered: list[str] | None = None,
) -> dict[str, Any]:
    card = get_card(card_id)
    if not card:
        raise ValueError("card not found")
    st = (status or "closed").strip().lower()
    if st not in _CLOSE_STATUSES:
        raise ValueError(f"status must be one of {sorted(_CLOSE_STATUSES)}")

    reason = (exit_reason or "").strip()
    if not reason:
        raise ValueError("结案必须填写 exit_reason（对错归因）")
    tags = [str(t).strip() for t in (attribution_tags or []) if str(t).strip()]
    if not tags and not (attribution_note or "").strip():
        raise ValueError("结案必须填写 attribution_tags 或 attribution_note")

    entry = _f(card.get("entry_price"))
    exit_p = _f(exit_price)
    pnl: float | None = None
    if entry not in (None, 0) and exit_p is not None:
        pnl = round((exit_p - entry) / entry * 100.0, 2)

    holding_days: int | None = None
    entry_date = str(card.get("entry_date") or "").strip()
    xd = (exit_date or datetime.now(_SH).date().isoformat()).strip()
    if entry_date and xd:
        try:
            d0 = datetime.fromisoformat(entry_date[:10])
            d1 = datetime.fromisoformat(xd[:10])
            holding_days = max(0, (d1 - d0).days)
        except ValueError:
            holding_days = None

    falsify = evaluate_falsify(
        card.get("falsify_conditions"),
        notes=f"{reason} {attribution_note or ''}",
        triggered_ids=falsify_triggered,
    )

    body = dict(card)
    body.update(
        {
            "status": st,
            "exit_price": exit_p,
            "exit_date": xd,
            "exit_reason": reason,
            "attribution_tags": tags or body.get("attribution_tags") or [],
            "attribution_note": (attribution_note or "").strip()[:2000],
            "pnl_pct": pnl,
            "holding_period_days": holding_days,
            "falsify_check": falsify,
            "closed_at": datetime.now(_SH).isoformat(timespec="seconds"),
        }
    )
    saved = upsert_card(body)
    return {
        "ok": True,
        "card": saved,
        "falsify_check": falsify,
        "pnl_pct": pnl,
    }
