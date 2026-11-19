"""DeepSeek OpenAI 兼容非流式调用（结构化 JSON 等）。"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any

from ai import config as ai_config

_log = logging.getLogger("ai.client")


def _completions_url() -> str:
    base = ai_config.deepseek_base_url().rstrip("/")
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def chat_completion(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.2,
    max_tokens: int | None = None,
    response_json: bool = False,
    timeout: float = 180.0,
) -> dict[str, Any]:
    """同步调用 chat/completions，返回上游 JSON。"""
    if not ai_config.is_configured():
        raise RuntimeError("未配置 DEEPSEEK_API_KEY")

    payload: dict[str, Any] = {
        "model": ai_config.deepseek_model(),
        "messages": messages,
        "stream": False,
        "temperature": temperature,
        "max_tokens": max_tokens or min(ai_config.max_tokens() * 2, 8192),
    }
    if response_json:
        payload["response_format"] = {"type": "json_object"}

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        _completions_url(),
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {ai_config.deepseek_api_key()}",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace") if e.fp else str(e.reason)
        _log.warning("deepseek HTTP %s: %s", e.code, err_body[:500])
        raise RuntimeError(f"DeepSeek HTTP {e.code}: {err_body[:400]}") from e

    try:
        return json.loads(raw) if raw else {}
    except json.JSONDecodeError as e:
        raise RuntimeError(f"DeepSeek 返回非 JSON: {raw[:200]}") from e


def chat_json_content(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.2,
    max_tokens: int | None = None,
    timeout: float = 180.0,
) -> dict[str, Any]:
    """要求模型返回 JSON 对象，并解析 choices[0].message.content。"""
    upstream = chat_completion(
        messages,
        temperature=temperature,
        max_tokens=max_tokens,
        response_json=True,
        timeout=timeout,
    )
    try:
        content = (
            ((upstream.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        ).strip()
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"DeepSeek 响应结构异常: {upstream!r}") from e
    if not content:
        raise RuntimeError("DeepSeek 返回空 content")
    # 容错：偶发包在 ```json 围栏里
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
