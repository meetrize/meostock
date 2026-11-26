"""公告影响力评估任务：标题分流 → 可选 PDF → LLM → Score。"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from cninfo import store as cninfo_store
from cninfo.impact_judge import judge_announcement, title_only_summary
from cninfo.impact_rules import level_label, triage_title
from cninfo.impact_score import compute_score
from cninfo.pdf_extract import cleanup_expired_pdfs, fetch_and_extract

_log = logging.getLogger("cninfo.impact_sync")
_CST = timezone(timedelta(hours=8))

_progress: dict[str, Any] = {
    "active": False,
    "phase": "",
    "done": 0,
    "total": 0,
    "title_only": 0,
    "judged": 0,
    "pdf_ok": 0,
    "pdf_fail": 0,
    "errors": 0,
    "pdf_cache_deleted": 0,
    "current_id": "",
    "current_title": "",
    "message": "",
    "synced_at": None,
    "last_error": None,
}


def get_progress() -> dict[str, Any]:
    return dict(_progress)


def _set_progress(**kwargs: Any) -> None:
    _progress.update(kwargs)


def _day_start_ms(days_back: int = 0) -> int:
    now = datetime.now(_CST)
    d = (now - timedelta(days=max(0, days_back))).date()
    start = datetime(d.year, d.month, d.day, tzinfo=_CST)
    return int(start.timestamp() * 1000)


def _apply_thread_cap(score: float, thread_id: str, announcement_id: str, is_first: bool) -> float:
    if is_first:
        return score
    prev = cninfo_store.thread_max_score(thread_id, exclude_id=announcement_id)
    if prev is None:
        return score
    # 非首次不得高于同线索历史最高分
    return min(score, float(prev) * 0.98)


def process_one(
    ann: dict[str, Any],
    *,
    use_llm: bool = True,
    force_pdf: bool = False,
) -> dict[str, Any]:
    """处理单条公告并落库。"""
    aid = str(ann.get("announcement_id") or "")
    title = str(ann.get("title") or "")
    code = str(ann.get("code") or "")[-6:]
    triage = triage_title(title, code=code)

    pdf_status = "skipped"
    text = ""
    materiality: dict[str, Any] = {}
    err: str | None = None

    need_pdf = force_pdf or not triage.get("skip_pdf")
    if need_pdf and ann.get("pdf_url"):
        extracted = fetch_and_extract(
            announcement_id=aid,
            pdf_url=str(ann.get("pdf_url") or ""),
        )
        if extracted.get("ok"):
            pdf_status = "ok"
            text = str(extracted.get("text") or "")
            materiality = dict(extracted.get("materiality") or {})
        else:
            pdf_status = "error"
            err = str(extracted.get("error") or "pdf_extract_failed")

    judged: dict[str, Any]
    judge_status: str
    if use_llm and (text or triage.get("candidate_level") in ("XL", "L")):
        try:
            judged = judge_announcement(
                title=title,
                text=text,
                triage=triage,
                materiality_hint=materiality or None,
            )
            judge_status = "judged" if text else "judged_title"
        except Exception as e:  # noqa: BLE001
            _log.warning("LLM judge failed id=%s err=%s", aid, e)
            judged = title_only_summary(title, triage)
            judge_status = "title_only"
            err = (err + "; " if err else "") + f"llm: {e}"
    else:
        judged = title_only_summary(title, triage)
        judge_status = "title_only"

    # 合并 materiality
    mat = dict(materiality or {})
    for k, v in (judged.get("materiality") or {}).items():
        if v is not None and mat.get(k) is None:
            mat[k] = v

    quality = dict(judged.get("quality_flags") or {})
    is_first = bool(judged.get("is_first_disclosure", triage.get("is_first_disclosure")))
    stage = str(judged.get("disclosure_stage") or triage.get("disclosure_stage") or "unknown")
    direction = str(judged.get("direction") or triage.get("direction_prior") or "neutral")

    scored = compute_score(
        candidate_level=str(triage.get("candidate_level") or "S"),
        category=str(judged.get("event_type") or triage.get("category") or "other"),
        is_first_disclosure=is_first,
        disclosure_stage=stage,
        pseudo_hits=list(triage.get("pseudo_hits") or []),
        materiality=mat,
        quality_flags=quality,
        llm_base_score=judged.get("base_score"),
        hard_floor=triage.get("hard_floor"),
        direction=direction,
    )
    score = float(scored["score"])
    capped = _apply_thread_cap(score, str(triage.get("thread_id") or ""), aid, is_first)
    final_level = str(scored["final_level"])
    if capped + 1e-9 < score:
        # 同线索压分后，在「分数映射级」与「规则级」之间取较低，但仍尊重硬地板与修订稿托底
        from cninfo.impact_score import level_from_score, max_level, min_level_floor

        mapped = level_from_score(capped)
        # 不得高于原 final_level
        rank = {"S": 0, "M": 1, "L": 2, "XL": 3}
        if rank.get(mapped, 0) < rank.get(final_level, 0):
            final_level = mapped
        if str(triage.get("candidate_level") or "") == "XL" and not is_first:
            final_level = max_level(final_level, "L")
        elif str(triage.get("candidate_level") or "") == "L" and not is_first:
            final_level = max_level(final_level, "M")
        final_level = min_level_floor(final_level, triage.get("hard_floor"))
        score = capped
    else:
        score = capped

    reasons = list(judged.get("reasons") or [])
    if not is_first:
        reasons = list(dict.fromkeys([*reasons, "非首次披露降权"]))

    row = {
        "announcement_id": aid,
        "code": code,
        "title": title,
        "announce_time_ms": int(ann.get("announce_time_ms") or 0),
        "thread_id": triage.get("thread_id"),
        "candidate_level": triage.get("candidate_level"),
        "final_level": final_level,
        "direction": direction,
        "category": judged.get("event_type") or triage.get("category"),
        "disclosure_stage": stage,
        "is_first_disclosure": 1 if is_first else 0,
        "score": round(score, 2),
        "matched_rules": triage.get("matched_rules") or [],
        "reasons": reasons,
        "materiality": mat,
        "quality_flags": quality,
        "core_summary": judged.get("core_summary"),
        "core_quotes": judged.get("core_quotes") or [],
        "risk_flags": judged.get("risk_flags") or [],
        "expected_gap_hint": judged.get("expected_gap_hint"),
        "confidence": judged.get("confidence"),
        "judge_status": judge_status,
        "pdf_extract_status": pdf_status,
        "error": err,
        "judged_at": time.time(),
    }
    cninfo_store.upsert_impact(row)
    return {
        "ok": True,
        "announcement_id": aid,
        "final_level": final_level,
        "final_level_label": level_label(final_level),
        "score": row["score"],
        "judge_status": judge_status,
        "pdf_extract_status": pdf_status,
    }


def run_cninfo_announcement_impact(
    *,
    days: int | None = None,
    limit: int | None = None,
    use_llm: bool | None = None,
    max_pdf: int | None = None,
    max_llm: int | None = None,
) -> dict[str, Any]:
    """
    评估近期新增公告。
    环境变量：
      CNINFO_IMPACT_DAYS（默认 2）
      CNINFO_IMPACT_LIMIT（默认 3000）
      CNINFO_IMPACT_USE_LLM（默认 1）
      CNINFO_IMPACT_MAX_PDF（默认 80）
      CNINFO_IMPACT_MAX_LLM（默认 60）
      CNINFO_PDF_TTL_DAYS（PDF 缓存天数，默认 3）
    """
    days_v = int(days if days is not None else os.environ.get("CNINFO_IMPACT_DAYS", "2"))
    limit_v = int(limit if limit is not None else os.environ.get("CNINFO_IMPACT_LIMIT", "3000"))
    use_llm_v = (
        bool(use_llm)
        if use_llm is not None
        else str(os.environ.get("CNINFO_IMPACT_USE_LLM", "1")).strip() not in ("0", "false", "False")
    )
    max_pdf_v = int(max_pdf if max_pdf is not None else os.environ.get("CNINFO_IMPACT_MAX_PDF", "80"))
    max_llm_v = int(max_llm if max_llm is not None else os.environ.get("CNINFO_IMPACT_MAX_LLM", "60"))

    # 先清过期 PDF：正文已在 impact 表，UI 用在线链接，本地只需短时缓存
    _set_progress(
        active=True,
        phase="cleanup_pdf",
        message="清理过期 PDF 缓存…",
        last_error=None,
        pdf_cache_deleted=0,
    )
    cleanup = cleanup_expired_pdfs()
    deleted_pdfs = int(cleanup.get("deleted") or 0)

    since_ms = _day_start_ms(days_v)
    pending = cninfo_store.list_pending_impact(since_ms=since_ms, limit=limit_v, only_missing=True)

    _set_progress(
        active=True,
        phase="running",
        done=0,
        total=len(pending),
        title_only=0,
        judged=0,
        pdf_ok=0,
        pdf_fail=0,
        errors=0,
        pdf_cache_deleted=deleted_pdfs,
        current_id="",
        current_title="",
        message=f"评估近 {days_v} 日待处理 {len(pending)} 条"
        + (f"；已清 PDF {deleted_pdfs}" if deleted_pdfs else ""),
        last_error=None,
    )

    pdf_used = 0
    llm_used = 0
    try:
        for i, ann in enumerate(pending):
            aid = str(ann.get("announcement_id") or "")
            title = str(ann.get("title") or "")
            _set_progress(
                done=i,
                current_id=aid,
                current_title=title[:80],
                message=f"{i + 1}/{len(pending)} {title[:40]}",
            )
            triage = triage_title(title, code=str(ann.get("code") or ""))
            allow_pdf = (not triage.get("skip_pdf")) and pdf_used < max_pdf_v
            allow_llm = use_llm_v and llm_used < max_llm_v and (
                triage.get("candidate_level") in ("XL", "L") or allow_pdf
            )
            try:
                # 若不允许 PDF，临时清空 url 以免下载
                ann_run = dict(ann)
                if not allow_pdf:
                    ann_run["pdf_url"] = ""
                result = process_one(ann_run, use_llm=allow_llm, force_pdf=False)
                if result.get("pdf_extract_status") == "ok":
                    pdf_used += 1
                    _set_progress(pdf_ok=int(_progress.get("pdf_ok") or 0) + 1)
                elif result.get("pdf_extract_status") == "error":
                    _set_progress(pdf_fail=int(_progress.get("pdf_fail") or 0) + 1)
                if result.get("judge_status") in ("judged", "judged_title"):
                    llm_used += 1
                    _set_progress(judged=int(_progress.get("judged") or 0) + 1)
                else:
                    _set_progress(title_only=int(_progress.get("title_only") or 0) + 1)
            except Exception as e:  # noqa: BLE001
                _log.exception("impact process failed id=%s", aid)
                _set_progress(errors=int(_progress.get("errors") or 0) + 1, last_error=str(e)[:300])
                try:
                    triage = triage_title(title, code=str(ann.get("code") or ""))
                    fallback = title_only_summary(title, triage)
                    scored = compute_score(
                        candidate_level=str(triage.get("candidate_level") or "S"),
                        category=str(triage.get("category") or "other"),
                        is_first_disclosure=bool(triage.get("is_first_disclosure")),
                        disclosure_stage=str(triage.get("disclosure_stage") or "unknown"),
                        pseudo_hits=list(triage.get("pseudo_hits") or []),
                        hard_floor=triage.get("hard_floor"),
                        direction=str(triage.get("direction_prior") or "neutral"),
                    )
                    cninfo_store.upsert_impact(
                        {
                            "announcement_id": aid,
                            "code": str(ann.get("code") or "")[-6:],
                            "title": title,
                            "announce_time_ms": int(ann.get("announce_time_ms") or 0),
                            "thread_id": triage.get("thread_id"),
                            "candidate_level": triage.get("candidate_level"),
                            "final_level": scored["final_level"],
                            "direction": triage.get("direction_prior"),
                            "category": triage.get("category"),
                            "disclosure_stage": triage.get("disclosure_stage"),
                            "is_first_disclosure": triage.get("is_first_disclosure"),
                            "score": scored["score"],
                            "matched_rules": triage.get("matched_rules"),
                            "reasons": fallback.get("reasons"),
                            "materiality": {},
                            "quality_flags": fallback.get("quality_flags"),
                            "core_summary": fallback.get("core_summary"),
                            "core_quotes": [],
                            "risk_flags": [],
                            "expected_gap_hint": "",
                            "confidence": 0.2,
                            "judge_status": "error",
                            "pdf_extract_status": "skipped",
                            "error": str(e)[:500],
                            "judged_at": time.time(),
                        }
                    )
                except Exception:  # noqa: BLE001
                    pass

        _set_progress(
            active=False,
            phase="done",
            done=len(pending),
            message=f"完成 {len(pending)} 条；PDF {pdf_used} LLM {llm_used}",
            synced_at=time.time(),
        )
        return {
            "ok": True,
            "processed": len(pending),
            "pdf_used": pdf_used,
            "llm_used": llm_used,
            "pdf_cache_deleted": deleted_pdfs,
            "pdf_cleanup": cleanup,
            "since_ms": since_ms,
            "stats": cninfo_store.impact_stats(),
        }
    except Exception as e:  # noqa: BLE001
        _set_progress(active=False, phase="error", last_error=str(e)[:400], message="失败")
        return {"ok": False, "error": str(e)}
