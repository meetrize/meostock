"""公告标题分流：四级候选 + 伪信号降权 + 线索键。"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

_TAXONOMY_PATH = Path(__file__).resolve().parent / "impact_taxonomy.json"

_LEVEL_RANK = {"S": 0, "M": 1, "L": 2, "XL": 3}


@lru_cache(maxsize=1)
def load_taxonomy() -> dict[str, Any]:
    return json.loads(_TAXONOMY_PATH.read_text(encoding="utf-8"))


def level_label(level: str) -> str:
    tax = load_taxonomy()
    return str((tax.get("level_labels") or {}).get(level) or level)


def _compile_list(patterns: list[str]) -> list[re.Pattern[str]]:
    out: list[re.Pattern[str]] = []
    for p in patterns:
        p = str(p or "").strip()
        if not p:
            continue
        try:
            out.append(re.compile(p))
        except re.error:
            out.append(re.compile(re.escape(p)))
    return out


@lru_cache(maxsize=1)
def _compiled() -> dict[str, list[re.Pattern[str]]]:
    tax = load_taxonomy()
    return {
        "hard_bearish_xl": _compile_list(list(tax.get("hard_bearish_xl") or [])),
        "positive_xl": _compile_list(list(tax.get("positive_xl") or [])),
        "positive_l": _compile_list(list(tax.get("positive_l") or [])),
        "negative_xl": _compile_list(list(tax.get("negative_xl") or [])),
        "negative_l": _compile_list(list(tax.get("negative_l") or [])),
        "medium": _compile_list(list(tax.get("medium") or [])),
        "pseudo": _compile_list(list(tax.get("pseudo_signals") or [])),
        "blacklist": _compile_list(list(tax.get("blacklist_patterns") or [])),
    }


def _match_any(title: str, patterns: list[re.Pattern[str]]) -> list[str]:
    hits: list[str] = []
    for p in patterns:
        if p.search(title):
            hits.append(p.pattern)
    return hits


def infer_category(title: str) -> str:
    tax = load_taxonomy()
    cmap = tax.get("category_map") or {}
    for cat, keys in cmap.items():
        for k in keys:
            try:
                if re.search(str(k), title):
                    return str(cat)
            except re.error:
                if str(k) in title:
                    return str(cat)
    return "other"


def infer_stage(title: str, *, pseudo_hits: list[str]) -> str:
    if any("修订" in h or "修订稿" in title for h in pseudo_hits) or "修订稿" in title:
        return "draft_revision"
    if "问询" in title or "反馈" in title:
        return "inquiry"
    if "进展" in title:
        return "progress"
    if "澄清" in title:
        return "clarification"
    if "异动" in title:
        return "abnormal_move"
    if "草案" in title or "预案" in title:
        return "draft"
    if "报告书" in title and "购买资产" in title:
        return "draft"
    return "unknown"


def thread_key(code: str, title: str, category: str) -> str:
    """同一事项启发式线索：代码 + 类别 + 归一化关键词。"""
    code6 = str(code or "").strip()[-6:]
    t = re.sub(r"\s+", "", title or "")
    t = re.sub(
        r"(修订稿|补充公告|进展公告|问询函回复|问询回复|反馈意见|（草案）|\(草案\)|草案|预案)",
        "",
        t,
    )
    t = re.sub(r"[《》\"'（）()【】\[\]、，,.。:：]", "", t)
    t = t[:48]
    return f"{code6}:{category}:{t}"


def triage_title(title: str, *, code: str = "") -> dict[str, Any]:
    """对单条标题做分流，不访问网络。"""
    title = str(title or "").strip()
    compiled = _compiled()
    matched: list[str] = []

    # 黑名单：流程件
    bl = _match_any(title, compiled["blacklist"])
    if bl and not (
        _match_any(title, compiled["positive_xl"])
        or _match_any(title, compiled["hard_bearish_xl"])
        or _match_any(title, compiled["negative_xl"])
        or _match_any(title, compiled["positive_l"])
    ):
        return {
            "candidate_level": "S",
            "direction_prior": "neutral",
            "category": "routine",
            "matched_rules": [f"blacklist:{x}" for x in bl],
            "pseudo_hits": [],
            "is_first_disclosure": 1,
            "disclosure_stage": "routine",
            "thread_id": thread_key(code, title, "routine"),
            "skip_pdf": True,
            "hard_floor": None,
        }

    hard = _match_any(title, compiled["hard_bearish_xl"])
    pos_xl = _match_any(title, compiled["positive_xl"])
    neg_xl = _match_any(title, compiled["negative_xl"])
    pos_l = _match_any(title, compiled["positive_l"])
    neg_l = _match_any(title, compiled["negative_l"])
    med = _match_any(title, compiled["medium"])
    pseudo = _match_any(title, compiled["pseudo"])

    level = "S"
    direction = "neutral"
    hard_floor: str | None = None

    if hard:
        level = "XL"
        direction = "bearish"
        hard_floor = "XL"
        matched.extend(f"hard_bearish:{x}" for x in hard)
    elif pos_xl:
        level = "XL"
        direction = "bullish"
        matched.extend(f"positive_xl:{x}" for x in pos_xl)
    elif neg_xl:
        level = "XL"
        direction = "bearish"
        matched.extend(f"negative_xl:{x}" for x in neg_xl)
    elif pos_l:
        level = "L"
        direction = "bullish"
        matched.extend(f"positive_l:{x}" for x in pos_l)
    elif neg_l:
        level = "L"
        direction = "bearish"
        matched.extend(f"negative_l:{x}" for x in neg_l)
    elif med:
        level = "M"
        direction = "neutral"
        matched.extend(f"medium:{x}" for x in med)
        if "减持" in title:
            direction = "bearish"
        if "增持" in title or "涨价" in title or "提价" in title:
            direction = "bullish"
        if "澄清" in title or "异动" in title:
            direction = "mixed"

    # 终止/失败 + 重组/定增 → 偏空抬级
    if re.search(r"终止|失败|撤回|不予核准", title) and re.search(
        r"重组|收购|发行|定增|非公开发行|向特定对象", title
    ):
        direction = "bearish"
        if _LEVEL_RANK[level] < _LEVEL_RANK["L"]:
            level = "L"
        matched.append("direction:terminated_deal")

    if "回购注销" in title or ("回购" in title and "注销" in title):
        direction = "bullish"
        if _LEVEL_RANK[level] < _LEVEL_RANK["L"]:
            level = "L"
        matched.append("回购注销")

    if pseudo:
        matched.extend(f"pseudo:{x}" for x in pseudo)

    category = infer_category(title)
    stage = infer_stage(title, pseudo_hits=pseudo)
    is_first = 0 if pseudo or stage in ("draft_revision", "progress", "inquiry", "abnormal_move") else 1

    # 仅伪信号、无实质事件
    if level == "S" and pseudo and not (pos_xl or pos_l or neg_xl or neg_l or hard or med):
        level = "S"
        category = "pseudo_only"

    skip_pdf = level == "S" or (level == "M" and not pseudo and not re.search(r"亿元|占.*营收|占.*净资产", title))

    # 中等但含强力度词仍抽 PDF
    if level == "M" and re.search(r"亿元|百分之|%\s*以上|占.*营收|占.*净资产", title):
        skip_pdf = False

    if level in ("XL", "L"):
        skip_pdf = False

    return {
        "candidate_level": level,
        "direction_prior": direction,
        "category": category,
        "matched_rules": matched,
        "pseudo_hits": pseudo,
        "is_first_disclosure": is_first,
        "disclosure_stage": stage,
        "thread_id": thread_key(code, title, category),
        "skip_pdf": skip_pdf,
        "hard_floor": hard_floor,
    }
