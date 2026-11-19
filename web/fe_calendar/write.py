"""手动/粘贴日程写入 + 语义去重。"""

from __future__ import annotations

import hashlib
import json
import re
import time
from typing import Any

from ai import config as ai_config
from ai.client import chat_json_content
from cache.db import _lock, get_conn, init_db
from fe_calendar.parse import _parse_start_ts, _today_label, normalize_extracted

_SHELL = re.compile(
    r"据悉|报道称|消息称|预计|计划于|定于|即将|举行|召开|公布|发布|举行的|将于|关于|的通知|的公告"
)

DEDUPE_DAY_WINDOW = 2
DEDUPE_MAX_CANDIDATES = 12
DEDUPE_MIN_CONFIDENCE = 0.8
DEDUPE_RULE_SIMILARITY = 0.72

_DEDUPE_SYSTEM = """你是财经日历去重助手。判断「新抽取事件」是否与候选列表中某一条为同一场日程（同一会议/同一数据发布/同一政策节点等）。

判同标准：
- 同一主体（机构/会议名/数据名）+ 同一日程日（或明确同一场）→ 同
- 仅主题相近、日期不同，或系列活动的不同场次 → 不同
- 措辞不同但指向同一件事 → 同

只输出 JSON，不要 markdown：
{"same_as_fe_code":"候选中的 fe_code 或 null","confidence":0到1的小数,"reason":"不超过30字"}"""


def content_hash(parts: list[str]) -> str:
    return hashlib.sha1("\n".join(parts).encode("utf-8")).hexdigest()


def build_manual_fe_code(name: str, start_at: str, std_type: str) -> str:
    digest = hashlib.sha1(f"{name}|{start_at}|{std_type}".encode("utf-8")).hexdigest()[:20]
    return f"manual_{digest}"


def normalize_event_name(name: str) -> str:
    s = (name or "").lower()
    s = _SHELL.sub("", s)
    s = re.sub(r"[（(].*?[）)]", "", s)
    s = re.sub(r"[\s\u3000\-—_·,，.。:：;；'\"「」『』《》【】\[\]]+", "", s)
    return s.strip()


def name_similarity(a: str, b: str) -> float:
    na = normalize_event_name(a)
    nb = normalize_event_name(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    if na in nb or nb in na:
        ratio = min(len(na), len(nb)) / max(len(na), len(nb))
        return 0.75 + 0.25 * ratio

    def grams(s: str) -> set[str]:
        if len(s) < 2:
            return {s}
        return {s[i : i + 2] for i in range(len(s) - 1)}

    ga, gb = grams(na), grams(nb)
    inter = len(ga & gb)
    union = len(ga) + len(gb) - inter
    return 0.0 if union <= 0 else inter / union


def _day_key(iso: str) -> str:
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", iso or "")
    return m.group(1) if m else ""


def same_calendar_day(a: str, b: str) -> bool:
    da, db = _day_key(a), _day_key(b)
    return bool(da and db and da == db)


def find_candidates(
    *,
    start_ts: float,
    day_window: int = DEDUPE_DAY_WINDOW,
    max_n: int = DEDUPE_MAX_CANDIDATES,
    std_type_code: str | None = None,
) -> list[dict[str, Any]]:
    init_db()
    pad = max(0, min(7, day_window)) * 86400
    lo = start_ts - pad
    hi = start_ts + pad + 86400
    conn = get_conn()
    std = (std_type_code or "").strip()
    with _lock:
        if std:
            rows = conn.execute(
                """
                SELECT fe_code, start_at, end_at, start_ts, name, sponsor, city,
                       fe_type, std_type_code, source, content
                FROM finance_calendar_event
                WHERE start_ts IS NOT NULL AND start_ts >= ? AND start_ts < ?
                  AND (std_type_code = ? OR std_type_code IS NULL OR std_type_code = '')
                ORDER BY ABS(start_ts - ?) ASC
                LIMIT ?
                """,
                (lo, hi, std, start_ts, max_n),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT fe_code, start_at, end_at, start_ts, name, sponsor, city,
                       fe_type, std_type_code, source, content
                FROM finance_calendar_event
                WHERE start_ts IS NOT NULL AND start_ts >= ? AND start_ts < ?
                ORDER BY ABS(start_ts - ?) ASC
                LIMIT ?
                """,
                (lo, hi, start_ts, max_n),
            ).fetchall()
    return [dict(r) for r in rows]


def merge_into_existing(
    fe_code: str,
    *,
    content_appendix: str,
    name: str | None = None,
    sponsor: str | None = None,
    city: str | None = None,
) -> bool:
    init_db()
    now = time.time()
    conn = get_conn()
    with _lock:
        row = conn.execute(
            """
            SELECT fe_code, name, sponsor, city, content, content_hash, source
            FROM finance_calendar_event WHERE fe_code = ?
            """,
            (fe_code,),
        ).fetchone()
        if row is None:
            return False
        appendix = (content_appendix or "").strip()
        content = str(row["content"] or "")
        if appendix and appendix not in content:
            content = f"{content}\n---\n{appendix}" if content else appendix
        source = str(row["source"] or "")
        new_name = (
            (name or "").strip()[:200]
            if source in ("feedgen", "manual") and (name or "").strip()
            else row["name"]
        )
        new_sponsor = row["sponsor"] or ((sponsor or "").strip()[:120] or None)
        new_city = row["city"] or ((city or "").strip()[:80] or None)
        new_hash = content_hash(
            [
                str(new_name or ""),
                str(row["content_hash"] or ""),
                content,
                str(new_sponsor or ""),
                str(new_city or ""),
            ]
        )
        conn.execute(
            """
            UPDATE finance_calendar_event
            SET name=?, sponsor=?, city=?, content=?, content_hash=?,
                updated_at=?, synced_at=?
            WHERE fe_code=?
            """,
            (new_name, new_sponsor, new_city, content, new_hash, now, now, fe_code),
        )
        conn.commit()
    return True


def _ai_judge_same(
    new_event: dict[str, Any],
    candidates: list[dict[str, Any]],
) -> dict[str, Any]:
    today = _today_label()
    payload_new = {
        "name": new_event.get("name"),
        "start_at": new_event.get("start_at"),
        "end_at": new_event.get("end_at"),
        "std_type_code": new_event.get("std_type_code"),
        "fe_type": new_event.get("fe_type"),
        "sponsor": new_event.get("sponsor"),
        "city": new_event.get("city"),
        "source": new_event.get("source"),
    }
    payload_cands = [
        {
            "fe_code": c.get("fe_code"),
            "name": c.get("name"),
            "start_at": c.get("start_at"),
            "end_at": c.get("end_at"),
            "std_type_code": c.get("std_type_code"),
            "fe_type": c.get("fe_type"),
            "sponsor": c.get("sponsor"),
            "city": c.get("city"),
            "source": c.get("source"),
        }
        for c in candidates
    ]
    user = (
        f"今天（Asia/Shanghai）：{today}\n\n"
        f"新事件：\n{json.dumps(payload_new, ensure_ascii=False)}\n\n"
        f"候选已有事件（JSON 数组）：\n{json.dumps(payload_cands, ensure_ascii=False)}\n\n"
        "若与某一候选为同一事件，返回其 fe_code；否则 same_as_fe_code 为 null。"
    )
    parsed = chat_json_content(
        [
            {"role": "system", "content": _DEDUPE_SYSTEM},
            {"role": "user", "content": user},
        ],
        temperature=0.1,
        max_tokens=384,
        timeout=90.0,
    )
    code_raw = parsed.get("same_as_fe_code")
    code = None if code_raw in (None, "", "null") else str(code_raw).strip()
    try:
        conf = float(parsed.get("confidence"))
    except (TypeError, ValueError):
        conf = 0.0
    conf = max(0.0, min(1.0, conf))
    return {
        "same_as_fe_code": code or None,
        "confidence": conf,
        "reason": str(parsed.get("reason") or "")[:200],
    }


def resolve_dedupe(row: dict[str, Any]) -> dict[str, Any]:
    """返回 {action: insert|merge, merge_fe_code?, via, confidence?, reason?}。"""
    cands = [
        c
        for c in find_candidates(
            start_ts=float(row["start_ts"]),
            std_type_code=str(row.get("std_type_code") or ""),
        )
        if c.get("fe_code") and c.get("fe_code") != row.get("fe_code")
    ]
    if not cands:
        return {"action": "insert", "via": "skip_no_candidates"}

    best: dict[str, Any] | None = None
    best_sim = -1.0
    for c in cands:
        if not same_calendar_day(str(row.get("start_at") or ""), str(c.get("start_at") or "")):
            continue
        sim = name_similarity(str(row.get("name") or ""), str(c.get("name") or ""))
        if sim > best_sim:
            best_sim = sim
            best = c
    if best and best_sim >= DEDUPE_RULE_SIMILARITY:
        return {
            "action": "merge",
            "merge_fe_code": best["fe_code"],
            "via": "rule",
            "confidence": best_sim,
            "reason": f"规则相似 {best_sim:.2f}",
        }

    if not ai_config.is_configured():
        return {"action": "insert", "via": "ai_skip"}

    try:
        judged = _ai_judge_same(row, cands)
        code = judged.get("same_as_fe_code")
        allowed = code and any(c.get("fe_code") == code for c in cands)
        if allowed and float(judged.get("confidence") or 0) >= DEDUPE_MIN_CONFIDENCE:
            return {
                "action": "merge",
                "merge_fe_code": code,
                "via": "ai",
                "confidence": judged.get("confidence"),
                "reason": judged.get("reason"),
            }
        return {
            "action": "insert",
            "via": "ai",
            "confidence": judged.get("confidence"),
            "reason": judged.get("reason") or "AI 判定非同一事件",
        }
    except Exception as exc:  # noqa: BLE001
        return {"action": "insert", "via": "ai_fail", "reason": str(exc)[:200]}


def preview_duplicates(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """为解析结果附加 possible_duplicate / match_fe_code（规则层，不调 AI）。"""
    out: list[dict[str, Any]] = []
    for ev in events:
        item = dict(ev)
        item["possible_duplicate"] = False
        item["match_fe_code"] = None
        item["match_reason"] = None
        start_ts = ev.get("start_ts")
        if start_ts is None:
            start_ts = _parse_start_ts(str(ev.get("start_at") or ""))
        if start_ts is None:
            out.append(item)
            continue
        cands = find_candidates(
            start_ts=float(start_ts),
            std_type_code=str(ev.get("std_type_code") or ""),
        )
        best = None
        best_sim = -1.0
        for c in cands:
            if not same_calendar_day(str(ev.get("start_at") or ""), str(c.get("start_at") or "")):
                continue
            sim = name_similarity(str(ev.get("name") or ""), str(c.get("name") or ""))
            if sim > best_sim:
                best_sim = sim
                best = c
        if best and best_sim >= DEDUPE_RULE_SIMILARITY:
            item["possible_duplicate"] = True
            item["match_fe_code"] = best.get("fe_code")
            item["match_reason"] = f"与「{best.get('name')}」相似 {best_sim:.2f}"
        out.append(item)
    return out


def _row_from_event(ev: dict[str, Any], *, source_excerpt: str) -> dict[str, Any] | None:
    normalized = normalize_extracted([ev])
    if not normalized:
        return None
    e = normalized[0]
    name = e["name"]
    start_at = e["start_at"]
    std = e["std_type_code"]
    end_at = e.get("end_at")
    summary = e.get("summary") or ""
    content_parts = [
        summary,
        "来源：手动粘贴解析",
        (source_excerpt[:500] if source_excerpt else ""),
    ]
    content = "\n".join(p for p in content_parts if p)
    sponsor = e.get("sponsor") or "手动添加"
    fe_type = e.get("fe_type") or "手动日程"
    city = e.get("city") or ""
    fe_code = build_manual_fe_code(name, start_at, std)
    return {
        "fe_code": fe_code,
        "start_at": start_at,
        "end_at": end_at,
        "start_ts": e["start_ts"],
        "name": name,
        "sponsor": sponsor,
        "city": city,
        "fe_type": fe_type,
        "std_type_code": std,
        "content": content,
        "content_hash": content_hash([name, start_at, end_at or "", std, content]),
        "source": "manual",
    }


def insert_event_row(row: dict[str, Any]) -> str:
    """insert or update by fe_code；返回 inserted|updated|unchanged。"""
    init_db()
    now = time.time()
    conn = get_conn()
    with _lock:
        existing = conn.execute(
            "SELECT content_hash FROM finance_calendar_event WHERE fe_code = ?",
            (row["fe_code"],),
        ).fetchone()
        if existing is None:
            conn.execute(
                """
                INSERT INTO finance_calendar_event(
                  fe_code, start_at, end_at, start_ts, name, sponsor, city,
                  fe_type, std_type_code, content, content_hash, source,
                  first_seen_at, updated_at, synced_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    row["fe_code"],
                    row["start_at"],
                    row.get("end_at"),
                    row["start_ts"],
                    row["name"],
                    row.get("sponsor"),
                    row.get("city"),
                    row.get("fe_type"),
                    row.get("std_type_code"),
                    row.get("content"),
                    row["content_hash"],
                    "manual",
                    now,
                    now,
                    now,
                ),
            )
            conn.commit()
            return "inserted"
        if str(existing["content_hash"] or "") != row["content_hash"]:
            conn.execute(
                """
                UPDATE finance_calendar_event
                SET start_at=?, end_at=?, start_ts=?, name=?, sponsor=?, city=?,
                    fe_type=?, std_type_code=?, content=?, content_hash=?,
                    updated_at=?, synced_at=?
                WHERE fe_code=?
                """,
                (
                    row["start_at"],
                    row.get("end_at"),
                    row["start_ts"],
                    row["name"],
                    row.get("sponsor"),
                    row.get("city"),
                    row.get("fe_type"),
                    row.get("std_type_code"),
                    row.get("content"),
                    row["content_hash"],
                    now,
                    now,
                    row["fe_code"],
                ),
            )
            conn.commit()
            return "updated"
        conn.execute(
            "UPDATE finance_calendar_event SET synced_at=? WHERE fe_code=?",
            (now, row["fe_code"]),
        )
        conn.commit()
        return "unchanged"


def create_manual_events(
    events: list[dict[str, Any]],
    *,
    source_excerpt: str = "",
    force: bool = False,
) -> dict[str, Any]:
    """批量创建手动事件；force / 单条 force 跳过语义合并（仍 upsert 同 fe_code）。"""
    inserted = merged = updated = unchanged = skipped = 0
    details: list[dict[str, Any]] = []
    batch_seen: list[dict[str, Any]] = []

    for raw in events:
        row = _row_from_event(raw, source_excerpt=source_excerpt)
        if not row:
            skipped += 1
            details.append({"ok": False, "error": "无效或非未来事件", "name": raw.get("name")})
            continue

        force_one = force or bool(raw.get("force"))

        # 本批规则互并（force 时跳过，允许同批双份）
        if not force_one:
            batch_hit = None
            for prev in batch_seen:
                if same_calendar_day(row["start_at"], prev["start_at"]) and name_similarity(
                    row["name"], prev["name"]
                ) >= DEDUPE_RULE_SIMILARITY:
                    batch_hit = prev
                    break
            if batch_hit:
                merge_into_existing(
                    batch_hit["fe_code"],
                    content_appendix=row["content"],
                    name=row["name"],
                    sponsor=row.get("sponsor"),
                    city=row.get("city"),
                )
                merged += 1
                details.append(
                    {
                        "ok": True,
                        "action": "merge",
                        "fe_code": batch_hit["fe_code"],
                        "via": "batch_rule",
                        "name": row["name"],
                    }
                )
                continue

            resolved = resolve_dedupe(row)
            if resolved.get("action") == "merge" and resolved.get("merge_fe_code"):
                merge_into_existing(
                    str(resolved["merge_fe_code"]),
                    content_appendix=row["content"],
                    name=row["name"],
                    sponsor=row.get("sponsor"),
                    city=row.get("city"),
                )
                merged += 1
                details.append(
                    {
                        "ok": True,
                        "action": "merge",
                        "fe_code": resolved["merge_fe_code"],
                        "via": resolved.get("via"),
                        "name": row["name"],
                        "reason": resolved.get("reason"),
                    }
                )
                continue

        status = insert_event_row(row)
        if status == "inserted":
            inserted += 1
        elif status == "updated":
            updated += 1
        else:
            unchanged += 1
        batch_seen.append(row)
        details.append(
            {
                "ok": True,
                "action": status,
                "fe_code": row["fe_code"],
                "name": row["name"],
            }
        )

    return {
        "inserted": inserted,
        "merged": merged,
        "updated": updated,
        "unchanged": unchanged,
        "skipped": skipped,
        "details": details,
    }
