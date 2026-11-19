"""粘贴文本 → AI 抽取未来财经日历事件。"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from ai import config as ai_config
from ai.client import chat_json_content

MAX_TEXT_CHARS = 20000

_TZ = ZoneInfo("Asia/Shanghai")

_SYSTEM = """你是财经日历抽取助手。从用户粘贴的新闻稿/预告文本中抽出「未来将发生」的日程事件。

规则：
1. 相对时间（下周、下个月、几天后、本周五、next Wednesday、next month 等）必须相对「今天」解析为绝对 ISO8601（带 +08:00）。
2. 日期不明确或无法落到具体日的不要输出。
3. 只保留未来（今天 00:00 及之后）的事件；已发生的不要。
4. std_type_code：1=会议，2=经济数据，3=其他。
5. **无论原文是中文还是英文（或其他语言），输出字段一律使用简体中文**：
   - name：中文事件名（≤80 字），专有名词可保留通行中文译名（如 美联储、欧央行、FOMC 可写「美联储议息会议」）
   - summary：一两句中文摘要
   - sponsor / city / fe_type：尽量中文（如 Federal Reserve→美联储，Washington→华盛顿，United States→美国）；未知可空字符串
6. 一条文本可有多个日程；没有则 events 为空数组。

只输出 JSON，不要 markdown：
{"events":[{"name":"...","start_at":"YYYY-MM-DDTHH:mm:ss+08:00","end_at":null,"std_type_code":"1|2|3","fe_type":"...","sponsor":"","city":"","summary":"..."}]}"""


def _today_label() -> str:
    return datetime.now(_TZ).date().isoformat()


def _today_start_ts() -> float:
    d = datetime.now(_TZ).date()
    return datetime(d.year, d.month, d.day, tzinfo=_TZ).timestamp()


def _parse_start_ts(iso: str) -> float | None:
    raw = (iso or "").strip()
    if not raw:
        return None
    try:
        # support +08:00 and Z
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_TZ)
        return dt.timestamp()
    except ValueError:
        try:
            d = date.fromisoformat(raw[:10])
            return datetime(d.year, d.month, d.day, tzinfo=_TZ).timestamp()
        except ValueError:
            return None


def normalize_extracted(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """过滤非法/过去事件，统一字段。"""
    min_ts = _today_start_ts()
    out: list[dict[str, Any]] = []
    for item in events:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()[:200]
        start_at = str(item.get("start_at") or "").strip()
        if not name or not start_at:
            continue
        start_ts = _parse_start_ts(start_at)
        if start_ts is None or start_ts < min_ts:
            continue
        std = str(item.get("std_type_code") or "3").strip()
        if std not in ("1", "2", "3"):
            std = "3"
        end_raw = item.get("end_at")
        end_at = None
        if end_raw not in (None, ""):
            end_s = str(end_raw).strip()
            if _parse_start_ts(end_s) is not None:
                end_at = end_s
        out.append(
            {
                "name": name,
                "start_at": start_at,
                "end_at": end_at,
                "start_ts": start_ts,
                "std_type_code": std,
                "fe_type": str(item.get("fe_type") or "").strip()[:80],
                "sponsor": str(item.get("sponsor") or "").strip()[:120],
                "city": str(item.get("city") or "").strip()[:80],
                "summary": str(item.get("summary") or "").strip()[:1000],
            }
        )
    return out


def parse_calendar_text(text: str) -> dict[str, Any]:
    """返回 {events, model, provider}；未配置 AI 抛 RuntimeError。"""
    if not ai_config.is_configured():
        raise RuntimeError("未配置 AI 模型（设置 → AI 模型）")
    body = (text or "").strip()
    if not body:
        raise ValueError("文本为空")
    if len(body) > MAX_TEXT_CHARS:
        body = body[:MAX_TEXT_CHARS]

    today = _today_label()
    user = (
        f"今天（Asia/Shanghai）：{today}\n\n"
        f"请从以下文本抽取未来财经日程：\n\n{body}"
    )
    parsed = chat_json_content(
        [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": user},
        ],
        temperature=0.2,
        max_tokens=4096,
        timeout=180.0,
    )
    raw = parsed.get("events")
    events = normalize_extracted(raw if isinstance(raw, list) else [])
    cfg = ai_config.active_config() or {}
    return {
        "events": events,
        "model": cfg.get("model"),
        "provider": cfg.get("provider"),
        "truncated": len(body),
    }
