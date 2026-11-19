"""OpenAI 兼容非流式调用（结构化 JSON 等）。"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any

from ai import config as ai_config

_log = logging.getLogger("ai.client")


def chat_completion(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.2,
    max_tokens: int | None = None,
    response_json: bool = False,
    timeout: float | None = None,
    cfg: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """同步调用 chat/completions，返回上游 JSON。"""
    runtime = cfg or ai_config.active_config()
    if not runtime or not (runtime.get("api_key") or "").strip():
        raise RuntimeError("未配置 AI 模型（设置 → AI 模型）")

    base = str(runtime.get("base_url") or "").rstrip("/")
    model = str(runtime.get("model") or "").strip()
    key = str(runtime.get("api_key") or "").strip()
    if not base or not model:
        raise RuntimeError("AI 配置不完整（缺少 base_url 或 model）")

    url = ai_config.completions_url(base)
    to = timeout
    if to is None:
        try:
            to = float(runtime["timeout_sec"]) if runtime.get("timeout_sec") else ai_config.default_timeout()
        except (TypeError, ValueError):
            to = ai_config.default_timeout()

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
        "temperature": temperature,
        "max_tokens": max_tokens
        or min(
            (
                int(runtime["max_tokens"])
                if runtime.get("max_tokens")
                else ai_config.max_tokens()
            )
            * 2,
            8192,
        ),
    }
    if response_json:
        payload["response_format"] = {"type": "json_object"}

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=to) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace") if e.fp else str(e.reason)
        _log.warning("ai HTTP %s: %s", e.code, err_body[:500])
        raise RuntimeError(f"AI HTTP {e.code}: {err_body[:400]}") from e

    try:
        return json.loads(raw) if raw else {}
    except json.JSONDecodeError as e:
        raise RuntimeError(f"AI 返回非 JSON: {raw[:200]}") from e


def chat_json_content(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.2,
    max_tokens: int | None = None,
    timeout: float | None = None,
    cfg: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """要求模型返回 JSON 对象，并解析 choices[0].message.content。"""
    upstream = chat_completion(
        messages,
        temperature=temperature,
        max_tokens=max_tokens,
        response_json=True,
        timeout=timeout,
        cfg=cfg,
    )
    try:
        content = (
            ((upstream.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        ).strip()
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"AI 响应结构异常: {upstream!r}") from e
    if not content:
        raise RuntimeError("AI 返回空 content")
    if content.startswith("```"):
        lines = content.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines).strip()
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"无法解析模型 JSON: {content[:400]}") from e
    if not isinstance(parsed, dict):
        raise RuntimeError("模型 JSON 根节点必须是对象")
    return parsed


def probe_connectivity(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """轻量测连通：发一条极短 chat。"""
    import time

    runtime = cfg or ai_config.active_config()
    if not runtime or not (runtime.get("api_key") or "").strip():
        return {"ok": False, "error": "未配置 API Key"}
    started = time.time()
    try:
        chat_completion(
            [{"role": "user", "content": "ping"}],
            temperature=0,
            max_tokens=8,
            timeout=min(float(runtime.get("timeout_sec") or 30), 45.0),
            cfg=runtime,
        )
        latency_ms = int((time.time() - started) * 1000)
        return {
            "ok": True,
            "latency_ms": latency_ms,
            "provider": runtime.get("provider"),
            "model": runtime.get("model"),
            "base_url": runtime.get("base_url"),
        }
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "error": str(e)[:400],
            "latency_ms": int((time.time() - started) * 1000),
            "provider": runtime.get("provider"),
            "model": runtime.get("model"),
            "base_url": runtime.get("base_url"),
        }
