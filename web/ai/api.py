"""AI 聊天代理 + 模型配置档案 API。"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from typing import Any, Iterator

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from ai import config as ai_config
from ai import platforms as ai_platforms
from ai import profiles as ai_profiles
from ai.client import probe_connectivity
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

_HINT_UNCONFIGURED = "在设置 → AI 模型 中添加配置并设为使用中"


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatBody(BaseModel):
    symbol: str = Field(..., min_length=1)
    messages: list[ChatMessage] = Field(default_factory=list)
    skillId: str | None = None
    period: str = "1d"
    context: dict[str, Any] | None = None


class ProfileCreateBody(BaseModel):
    name: str | None = None
    provider: str = "deepseek"
    base_url: str = ""
    model: str = ""
    api_key: str = ""
    max_tokens: int | None = None
    timeout_sec: float | None = None
    activate: bool = False
    platform_id: str | None = None


class ProfileBatchCreateBody(BaseModel):
    platform_id: str
    models: list[str] = Field(default_factory=list)
    activate_first: bool = False


class ProfilePatchBody(BaseModel):
    name: str | None = None
    provider: str | None = None
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None
    max_tokens: int | None = None
    timeout_sec: float | None = None
    clear_max_tokens: bool = False
    clear_timeout_sec: bool = False
    platform_id: str | None = None
    clear_platform: bool = False


class ProfileAttachBody(BaseModel):
    platform_id: str | None = None


class PlatformCreateBody(BaseModel):
    name: str | None = None
    provider: str = "deepseek"
    base_url: str = ""
    api_key: str = ""
    # 合并配置：同时创建首个模型
    model: str | None = None
    activate: bool = False


class PlatformPatchBody(BaseModel):
    name: str | None = None
    provider: str | None = None
    base_url: str | None = None
    api_key: str | None = None


class TestBody(BaseModel):
    profile_id: str | None = None
    platform_id: str | None = None
    provider: str | None = None
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None
    max_tokens: int | None = None
    timeout_sec: float | None = None


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
    non_system = [m for m in cleaned if m["role"] != "system"]
    return non_system[-limit:]


def _uses_web_search(skill_id: str | None) -> bool:
    return (skill_id or "").strip() in ("limit_reason", "sector_catchup")


def _skill_runtime(skill_id: str | None) -> dict[str, str]:
    sid = (skill_id or "").strip()
    if sid == "limit_reason":
        return {"web": "1", "ctx": "news", "system": "news"}
    if sid == "sector_catchup":
        return {"web": "1", "ctx": "full", "system": "base"}
    return {"web": "0", "ctx": "full", "system": "base"}


def _build_upstream_messages(body: ChatBody) -> list[dict[str, str]]:
    skill = get_skill(body.skillId)
    period = body.period or "1d"
    sid = (body.skillId or "").strip()
    if sid in ("limit_reason", "sector_catchup"):
        period = "1d"
    runtime = _skill_runtime(body.skillId)
    news_mode = runtime["ctx"] == "news"
    use_news_system = runtime["system"] == "news"
    ctx = body.context if isinstance(body.context, dict) and body.context else None
    if not ctx:
        try:
            ctx = build_context(body.symbol, period)
        except Exception as e:  # noqa: BLE001
            ctx = {"symbol": body.symbol, "error": str(e)}

    parts = [_SYSTEM_NEWS if use_news_system else _SYSTEM_BASE]
    if sid == "sector_catchup":
        parts.append(
            "【本 Skill 补充】允许给出条件化观察价位与时机框架，并附失效条件与风险；"
            "禁止承诺收益或「立即买入/必涨停」喊单口吻。"
        )
    parts.append(
        "【标的背景 JSON】\n"
        + context_to_prompt_block(ctx, mode="news" if news_mode else "full")
    )
    if skill and skill.get("prompt"):
        parts.append(f"【当前 Skill：{skill.get('title') or skill.get('id')}】\n{skill['prompt']}")
    if sid == "limit_reason":
        name = ctx.get("name") or ""
        sym = ctx.get("display") or body.symbol
        status = ((ctx.get("day_shape") or {}).get("status") or "")
        tag = "涨停" if "Up" in str(status) else ("跌停" if "Down" in str(status) else "异动")
        parts.append(
            f"【检索提示】请搜索：{name} {sym} {tag} 原因 site:eastmoney.com OR site:10jqka.com.cn "
            f"OR site:sina.com.cn OR site:cls.cn OR site:stcn.com"
        )
    elif sid == "sector_catchup":
        name = ctx.get("name") or ""
        sym = ctx.get("display") or body.symbol
        status = ((ctx.get("day_shape") or {}).get("status") or "")
        tag = "涨停" if "Up" in str(status) else "异动"
        parts.append(
            f"【检索提示】请搜索：{name} {sym} {tag} 板块 同概念 补涨 "
            f"site:eastmoney.com OR site:10jqka.com.cn OR site:sina.com.cn "
            f"OR site:cls.cn OR site:stcn.com；并检索同题材未充分涨停的候选股今日涨跌幅。"
        )

    system = "\n\n".join(parts)
    history = _normalize_messages(body.messages, ai_config.max_history_turns())
    return [{"role": "system", "content": system}, *history]


def _iter_chat_sse(
    messages: list[dict[str, str]],
    *,
    tools: list[dict[str, Any]] | None = None,
) -> Iterator[bytes]:
    cfg = ai_config.active_config()
    if not cfg:
        yield f"data: {json.dumps({'error': '未配置 AI 模型'}, ensure_ascii=False)}\n\n".encode(
            "utf-8"
        )
        yield b"data: [DONE]\n\n"
        return

    url = ai_config.completions_url(str(cfg["base_url"]))
    payload: dict[str, Any] = {
        "model": cfg["model"],
        "messages": messages,
        "stream": True,
        "max_tokens": ai_config.max_tokens(),
        "temperature": 0.3 if tools else 0.4,
    }
    if tools:
        payload["tools"] = tools
        payload["thinking"] = {"type": "disabled"}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cfg['api_key']}",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    timeout = ai_config.default_timeout()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
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
        _log.warning("ai stream HTTP %s: %s", e.code, err_body[:500])
        yield f"data: {json.dumps({'error': f'AI HTTP {e.code}', 'detail': err_body[:800]}, ensure_ascii=False)}\n\n".encode(
            "utf-8"
        )
        yield b"data: [DONE]\n\n"
    except Exception as e:  # noqa: BLE001
        _log.warning("ai stream failed: %s", e)
        yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n".encode("utf-8")
        yield b"data: [DONE]\n\n"


def _config_payload() -> dict[str, Any]:
    ai_profiles.ensure_env_seed()
    active = ai_profiles.get_active_profile(include_secret=False)
    health = ai_profiles.get_last_health()
    profiles = ai_profiles.list_profiles()
    platforms = ai_profiles.list_platforms_with_models()
    standalone = ai_profiles.list_standalone_profiles()
    cfg = ai_config.active_config()
    return {
        "ok": True,
        "configured": ai_config.is_configured(),
        "active": active,
        "provider": (cfg or {}).get("provider") if cfg else None,
        "model": (cfg or {}).get("model") if cfg else None,
        "base_url": (cfg or {}).get("base_url") if cfg else None,
        "supports_deepseek_tools": ai_config.supports_deepseek_tools(),
        "health": health,
        "profiles": profiles,
        "platforms": platforms,
        "standalone": standalone,
        "hint": None if ai_config.is_configured() else _HINT_UNCONFIGURED,
    }


@router.get("/config")
def ai_config_get() -> JSONResponse:
    try:
        return JSONResponse(_config_payload())
    except Exception as exc:  # noqa: BLE001
        _log.exception("ai config failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/profiles")
def ai_profiles_list() -> JSONResponse:
    try:
        ai_profiles.ensure_env_seed()
        return JSONResponse({"ok": True, "profiles": ai_profiles.list_profiles()})
    except Exception as exc:  # noqa: BLE001
        _log.exception("list profiles failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/profiles")
def ai_profiles_create(body: ProfileCreateBody) -> JSONResponse:
    try:
        item = ai_profiles.create_profile(
            name=body.name,
            provider=body.provider,
            base_url=body.base_url,
            model=body.model,
            api_key=body.api_key,
            max_tokens=body.max_tokens,
            timeout_sec=body.timeout_sec,
            activate=body.activate,
            platform_id=body.platform_id,
        )
        return JSONResponse({"ok": True, "profile": item, **_config_payload()})
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("create profile failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/profiles/batch")
def ai_profiles_batch_create(body: ProfileBatchCreateBody) -> JSONResponse:
    try:
        items = ai_profiles.create_profiles_batch(
            platform_id=body.platform_id,
            models=body.models,
            activate_first=body.activate_first,
        )
        return JSONResponse(
            {"ok": True, "created": items, "count": len(items), **_config_payload()}
        )
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("batch create profiles failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.patch("/profiles/{profile_id}")
def ai_profiles_patch(profile_id: str, body: ProfilePatchBody) -> JSONResponse:
    try:
        kwargs: dict[str, Any] = {
            "name": body.name,
            "provider": body.provider,
            "base_url": body.base_url,
            "model": body.model,
            "api_key": body.api_key,
        }
        if body.clear_max_tokens:
            kwargs["max_tokens"] = None
        elif body.max_tokens is not None:
            kwargs["max_tokens"] = body.max_tokens
        else:
            kwargs["max_tokens"] = ...
        if body.clear_timeout_sec:
            kwargs["timeout_sec"] = None
        elif body.timeout_sec is not None:
            kwargs["timeout_sec"] = body.timeout_sec
        else:
            kwargs["timeout_sec"] = ...
        if body.clear_platform:
            kwargs["platform_id"] = None
        elif body.platform_id is not None:
            kwargs["platform_id"] = body.platform_id
        else:
            kwargs["platform_id"] = ...
        item = ai_profiles.update_profile(profile_id, **kwargs)
        return JSONResponse({"ok": True, "profile": item, **_config_payload()})
    except KeyError:
        return JSONResponse({"ok": False, "error": "档案不存在"}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("patch profile failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/profiles/{profile_id}/attach")
def ai_profiles_attach(profile_id: str, body: ProfileAttachBody) -> JSONResponse:
    try:
        item = ai_profiles.attach_profile_to_platform(profile_id, body.platform_id)
        return JSONResponse({"ok": True, "profile": item, **_config_payload()})
    except KeyError:
        return JSONResponse({"ok": False, "error": "档案不存在"}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("attach profile failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.delete("/profiles/{profile_id}")
def ai_profiles_delete(profile_id: str) -> JSONResponse:
    try:
        ai_profiles.delete_profile(profile_id)
        return JSONResponse({"ok": True, **_config_payload()})
    except KeyError:
        return JSONResponse({"ok": False, "error": "档案不存在"}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("delete profile failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/profiles/{profile_id}/activate")
def ai_profiles_activate(profile_id: str) -> JSONResponse:
    try:
        item = ai_profiles.activate_profile(profile_id)
        return JSONResponse({"ok": True, "profile": item, **_config_payload()})
    except KeyError:
        return JSONResponse({"ok": False, "error": "档案不存在"}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("activate profile failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/platforms")
def ai_platforms_list() -> JSONResponse:
    try:
        return JSONResponse(
            {"ok": True, "platforms": ai_profiles.list_platforms_with_models()}
        )
    except Exception as exc:  # noqa: BLE001
        _log.exception("list platforms failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/platforms")
def ai_platforms_create(body: PlatformCreateBody) -> JSONResponse:
    try:
        plat = ai_platforms.create_platform(
            name=body.name,
            provider=body.provider,
            base_url=body.base_url,
            api_key=body.api_key,
        )
        profile = None
        model_s = (body.model or "").strip()
        if model_s:
            profile = ai_profiles.create_profile(
                platform_id=str(plat["id"]),
                model=model_s,
                activate=body.activate,
            )
        return JSONResponse(
            {
                "ok": True,
                "platform": plat,
                "profile": profile,
                **_config_payload(),
            }
        )
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("create platform failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.patch("/platforms/{platform_id}")
def ai_platforms_patch(platform_id: str, body: PlatformPatchBody) -> JSONResponse:
    try:
        plat = ai_platforms.update_platform(
            platform_id,
            name=body.name,
            provider=body.provider,
            base_url=body.base_url,
            api_key=body.api_key,
        )
        return JSONResponse({"ok": True, "platform": plat, **_config_payload()})
    except KeyError:
        return JSONResponse({"ok": False, "error": "平台不存在"}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("patch platform failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.delete("/platforms/{platform_id}")
def ai_platforms_delete(platform_id: str) -> JSONResponse:
    try:
        ai_platforms.delete_platform(platform_id)
        return JSONResponse({"ok": True, **_config_payload()})
    except KeyError:
        return JSONResponse({"ok": False, "error": "平台不存在"}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("delete platform failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/platforms/{platform_id}/balance")
def ai_platforms_balance(platform_id: str) -> JSONResponse:
    try:
        result = ai_platforms.fetch_platform_balance(platform_id)
        status = 200 if result.get("ok") else 502
        return JSONResponse({"ok": bool(result.get("ok")), **result}, status_code=status)
    except KeyError:
        return JSONResponse({"ok": False, "error": "平台不存在"}, status_code=404)
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("platform balance failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/platforms/{platform_id}/models/discover")
def ai_platforms_discover(platform_id: str) -> JSONResponse:
    try:
        result = ai_platforms.discover_platform_models(platform_id)
        # 标注已添加
        existing = {
            str(p.get("model") or "")
            for p in ai_profiles.list_profiles()
            if p.get("platform_id") == platform_id
        }
        models = []
        for m in result.get("models") or []:
            mid = str(m.get("id") or "")
            models.append({**m, "already_added": mid in existing})
        result["models"] = models
        # 即使上游失败，也可能带回 preset；一律 200，用 result.ok / error 表达
        return JSONResponse({"ok": True, **result})
    except KeyError:
        return JSONResponse({"ok": False, "error": "平台不存在"}, status_code=404)
    except Exception as exc:  # noqa: BLE001
        _log.exception("discover models failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/test")
def ai_test(body: TestBody) -> JSONResponse:
    try:
        runtime = ai_profiles.resolve_runtime_config(
            profile_id=body.profile_id,
            platform_id=body.platform_id,
            provider=body.provider,
            base_url=body.base_url,
            model=body.model,
            api_key=body.api_key,
            max_tokens=body.max_tokens,
            timeout_sec=body.timeout_sec,
        )
        if not (runtime.get("api_key") or "").strip():
            return JSONResponse(
                {"ok": False, "error": "缺少 API Key", "hint": _HINT_UNCONFIGURED},
                status_code=400,
            )
        result = probe_connectivity(runtime)
        snap = {
            **result,
            "at": time.time(),
            "profile_id": runtime.get("id"),
            "platform_id": runtime.get("platform_id") or body.platform_id,
        }
        active_id = ai_profiles.get_active_id()
        if not body.profile_id and not body.platform_id and not (
            body.api_key or body.base_url or body.model
        ):
            ai_profiles.set_last_health(snap)
        elif body.profile_id and body.profile_id == active_id:
            ai_profiles.set_last_health(snap)
        elif runtime.get("id") and runtime.get("id") == active_id and not body.api_key:
            ai_profiles.set_last_health(snap)
        return JSONResponse({"ok": True, "result": result, "health": snap})
    except KeyError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=404)
    except Exception as exc:  # noqa: BLE001
        _log.exception("ai test failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/health")
def ai_health() -> JSONResponse:
    try:
        payload = _config_payload()
        return JSONResponse(
            {
                "ok": True,
                "configured": payload["configured"],
                "provider": payload.get("provider"),
                "model": payload.get("model"),
                "base_url": payload.get("base_url"),
                "supports_deepseek_tools": payload.get("supports_deepseek_tools"),
                "health": payload.get("health"),
                "active": payload.get("active"),
                "hint": payload.get("hint"),
            }
        )
    except Exception as exc:  # noqa: BLE001
        _log.exception("ai health failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/skills")
def ai_skills() -> JSONResponse:
    return JSONResponse({"ok": True, "skills": list_skills_public()})


@router.post("/chat", response_model=None)
async def ai_chat(body: ChatBody):
    if not ai_config.is_configured():
        return JSONResponse(
            {
                "ok": False,
                "error": "未配置 AI 模型",
                "hint": _HINT_UNCONFIGURED,
            },
            status_code=503,
        )
    if not (body.symbol or "").strip():
        return JSONResponse({"ok": False, "error": "缺少 symbol"}, status_code=400)
    if not body.messages and not body.skillId:
        return JSONResponse({"ok": False, "error": "messages 为空"}, status_code=400)

    if body.skillId and not any((m.content or "").strip() for m in body.messages):
        skill = get_skill(body.skillId)
        hint = (skill or {}).get("userHint") or (skill or {}).get("title") or "请分析"
        body.messages = [ChatMessage(role="user", content=str(hint))]

    messages = _build_upstream_messages(body)
    use_tools = (
        _uses_web_search(body.skillId) and ai_config.supports_deepseek_tools()
    )
    tools = _WEB_TOOLS if use_tools else None

    def gen() -> Iterator[bytes]:
        yield b'data: {"event":"start"}\n\n'
        if tools:
            yield (
                'data: {"event":"searching","content":"正在联网检索主流财经站…\\n"}\n\n'
            ).encode("utf-8")
        elif _uses_web_search(body.skillId) and not ai_config.supports_deepseek_tools():
            yield (
                'data: {"event":"searching","content":"当前模型不支持 DeepSeek 联网工具，将基于已有上下文作答…\\n"}\n\n'
            ).encode("utf-8")
        for chunk in _iter_chat_sse(messages, tools=tools):
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
