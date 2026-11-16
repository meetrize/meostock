"""DeepSeek 聊天代理：SSE 流式。"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any, Iterator

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from ai import config as ai_config
from ai.context import build_context, context_to_prompt_block
from ai.skills import get_skill, list_skills_public

router = APIRouter(prefix="/api/ai", tags=["ai"])
_log = logging.getLogger("ai")

_SYSTEM_BASE = (
    "你是 meostock K 线页的投研助手。用简洁专业的中文回答。"
    "基于用户与系统提供的行情摘要作答；数据不足时明确说明，不要编造成交明细。"
    "不提供具体买卖指令或承诺收益；可给观察框架与风险提示。"
)

_SYSTEM_NEWS = (
    "你是 meostock 消息面助手。用简洁专业的中文回答。"
    "必须联网检索主流财经网站与公告相关报道来归纳涨跌停/异动原因。"
    "禁止用K线形态、影线、量能形态编造原因；搜不到就直说。"
    "回答尽量带来源站点与标题；不提供买卖指令。"
)

_WEB_TOOLS = [
    {"type": "deepseek_web_search"},
    {"type": "deepseek_read_url"},
]


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatBody(BaseModel):
    symbol: str = Field(..., min_length=1)
    messages: list[ChatMessage] = Field(default_factory=list)
    skillId: str | None = None
    period: str = "1d"
    context: dict[str, Any] | None = None


def _normalize_messages(messages: list[ChatMessage], limit: int) -> list[dict[str, str]]:
    cleaned: list[dict[str, str]] = []
    for m in messages:
        role = (m.role or "").strip().lower()
        if role not in ("user", "assistant", "system"):
            continue
        content = (m.content or "").strip()
        if not content:
            continue
        cleaned.append({"role": role, "content": content})
    # 保留最近 limit 条非 system（system 由服务端注入）
    non_system = [m for m in cleaned if m["role"] != "system"]
    return non_system[-limit:]


def _uses_web_search(skill_id: str | None) -> bool:
    return (skill_id or "").strip() in ("limit_reason",)


def _build_upstream_messages(body: ChatBody) -> list[dict[str, str]]:
    skill = get_skill(body.skillId)
    period = body.period or "1d"
    if body.skillId == "limit_reason":
        period = "1d"
    news_mode = _uses_web_search(body.skillId)
    ctx = body.context if isinstance(body.context, dict) and body.context else None
    if not ctx:
        try:
            ctx = build_context(body.symbol, period)
        except Exception as e:  # noqa: BLE001
            ctx = {"symbol": body.symbol, "error": str(e)}

    parts = [_SYSTEM_NEWS if news_mode else _SYSTEM_BASE]
    parts.append(
        "【标的背景 JSON】\n"
        + context_to_prompt_block(ctx, mode="news" if news_mode else "full")
    )
    if skill and skill.get("prompt"):
        parts.append(f"【当前 Skill：{skill.get('title') or skill.get('id')}】\n{skill['prompt']}")
    if news_mode:
        name = ctx.get("name") or ""
        sym = ctx.get("display") or body.symbol
        status = ((ctx.get("day_shape") or {}).get("status") or "")
        tag = "涨停" if "Up" in str(status) else ("跌停" if "Down" in str(status) else "异动")
        parts.append(
            f"【检索提示】请搜索：{name} {sym} {tag} 原因 site:eastmoney.com OR site:10jqka.com.cn "
            f"OR site:sina.com.cn OR site:cls.cn OR site:stcn.com"
        )

    system = "\n\n".join(parts)
    history = _normalize_messages(body.messages, ai_config.max_history_turns())
    return [{"role": "system", "content": system}, *history]


def _iter_deepseek_sse(
    messages: list[dict[str, str]],
    *,
    tools: list[dict[str, Any]] | None = None,
) -> Iterator[bytes]:
    url = f"{ai_config.deepseek_base_url()}/chat/completions"
    # 兼容 base 是否已含 /v1
    if not url.rstrip("/").endswith("completions"):
        base = ai_config.deepseek_base_url().rstrip("/")
        url = f"{base}/chat/completions" if base.endswith("/v1") else f"{base}/v1/chat/completions"
    payload: dict[str, Any] = {
        "model": ai_config.deepseek_model(),
        "messages": messages,
        "stream": True,
        "max_tokens": ai_config.max_tokens(),
        "temperature": 0.3 if tools else 0.4,
    }
    if tools:
        payload["tools"] = tools
        # 联网搜索由服务端执行；关闭 thinking 以走带引用的普通搜索
        payload["thinking"] = {"type": "disabled"}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {ai_config.deepseek_api_key()}",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180.0) as resp:
            while True:
                line = resp.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if not text:
                    continue
                if text.startswith("data:"):
                    raw = text[5:].strip()
                    if raw == "[DONE]":
                        yield b"data: [DONE]\n\n"
                        break
                    try:
                        obj = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    if obj.get("error"):
                        yield f"data: {json.dumps({'error': obj.get('error')}, ensure_ascii=False)}\n\n".encode(
                            "utf-8"
                        )
                        continue
                    delta = ""
                    try:
                        d0 = ((obj.get("choices") or [{}])[0].get("delta") or {})
                        delta = d0.get("content") or ""
                        # 联网过程提示（若上游带 tool 增量）
                        if not delta and d0.get("server_tool_calls"):
                            yield (
                                'data: {"event":"searching","content":"正在联网检索…\\n"}\n\n'
                            ).encode("utf-8")

                    except Exception:  # noqa: BLE001
                        delta = ""
                    if delta:
                        yield f"data: {json.dumps({'content': delta}, ensure_ascii=False)}\n\n".encode(
                            "utf-8"
                        )
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace") if e.fp else str(e.reason)
        _log.warning("deepseek HTTP %s: %s", e.code, err_body[:500])
        yield f"data: {json.dumps({'error': f'DeepSeek HTTP {e.code}', 'detail': err_body[:800]}, ensure_ascii=False)}\n\n".encode(
            "utf-8"
        )
        yield b"data: [DONE]\n\n"
    except Exception as e:  # noqa: BLE001
        _log.warning("deepseek stream failed: %s", e)
        yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n".encode("utf-8")
        yield b"data: [DONE]\n\n"


@router.get("/health")
def ai_health() -> JSONResponse:
    return JSONResponse(
        {
            "ok": True,
            "configured": ai_config.is_configured(),
            "model": ai_config.deepseek_model() if ai_config.is_configured() else None,
            "base_url": ai_config.deepseek_base_url() if ai_config.is_configured() else None,
        }
    )


@router.get("/skills")
def ai_skills() -> JSONResponse:
    return JSONResponse({"ok": True, "skills": list_skills_public()})


@router.post("/chat", response_model=None)
async def ai_chat(body: ChatBody):
    if not ai_config.is_configured():
        return JSONResponse(
            {
                "ok": False,
                "error": "未配置 DEEPSEEK_API_KEY",
                "hint": "在 .env 填写 DEEPSEEK_API_KEY 后重启服务",
            },
            status_code=503,
        )
    if not (body.symbol or "").strip():
        return JSONResponse({"ok": False, "error": "缺少 symbol"}, status_code=400)
    if not body.messages and not body.skillId:
        return JSONResponse({"ok": False, "error": "messages 为空"}, status_code=400)

    # 若仅 skill 无消息，补一条 userHint
    if body.skillId and not any((m.content or "").strip() for m in body.messages):
        skill = get_skill(body.skillId)
        hint = (skill or {}).get("userHint") or (skill or {}).get("title") or "请分析"
        body.messages = [ChatMessage(role="user", content=str(hint))]

    messages = _build_upstream_messages(body)
    tools = _WEB_TOOLS if _uses_web_search(body.skillId) else None

    def gen() -> Iterator[bytes]:
        yield b'data: {"event":"start"}\n\n'
        if tools:
            yield (
                'data: {"event":"searching","content":"正在联网检索主流财经站…\\n"}\n\n'
            ).encode("utf-8")
        for chunk in _iter_deepseek_sse(messages, tools=tools):
            yield chunk

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
