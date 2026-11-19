"""当前生效 AI 配置（档案优先，.env 作种子）。"""

from __future__ import annotations

import os
from typing import Any

from ai import profiles as ai_profiles


def active_config() -> dict[str, Any] | None:
    """返回含明文 api_key 的当前配置；未配置则 None。"""
    try:
        p = ai_profiles.get_active_profile(include_secret=True)
    except Exception:  # noqa: BLE001
        p = None
    if not p:
        return None
    key = (p.get("api_key") or "").strip()
    if not key:
        return None
    return {
        "id": p.get("id"),
        "name": p.get("name"),
        "provider": p.get("provider") or "openai_compat",
        "base_url": (p.get("base_url") or "").rstrip("/"),
        "model": p.get("model") or "",
        "api_key": key,
        "max_tokens": p.get("max_tokens"),
        "timeout_sec": p.get("timeout_sec"),
    }


def is_configured() -> bool:
    cfg = active_config()
    return bool(cfg and cfg.get("api_key") and cfg.get("model") and cfg.get("base_url"))


def active_provider() -> str | None:
    cfg = active_config()
    return str(cfg["provider"]) if cfg else None


def supports_deepseek_tools() -> bool:
    return active_provider() == "deepseek"


def completions_url(base_url: str | None = None) -> str:
    base = (base_url or (active_config() or {}).get("base_url") or "").rstrip("/")
    if not base:
        raise RuntimeError("缺少 base_url")
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def max_history_turns() -> int:
    try:
        return max(2, min(int(os.environ.get("DEEPSEEK_MAX_TURNS") or 20), 40))
    except ValueError:
        return 20


def max_tokens() -> int:
    cfg = active_config()
    if cfg and cfg.get("max_tokens"):
        try:
            return max(256, min(int(cfg["max_tokens"]), 8192))
        except (TypeError, ValueError):
            pass
    try:
        return max(256, min(int(os.environ.get("DEEPSEEK_MAX_TOKENS") or 2048), 8192))
    except ValueError:
        return 2048


def default_timeout() -> float:
    cfg = active_config()
    if cfg and cfg.get("timeout_sec"):
        try:
            return max(5.0, min(float(cfg["timeout_sec"]), 600.0))
        except (TypeError, ValueError):
            pass
    return 180.0


# --- 薄兼容包装（旧调用方） ---


def deepseek_api_key() -> str:
    cfg = active_config()
    return str(cfg["api_key"]) if cfg else ""


def deepseek_base_url() -> str:
    cfg = active_config()
    if cfg:
        return str(cfg["base_url"])
    return (os.environ.get("DEEPSEEK_BASE_URL") or "https://api.deepseek.com").rstrip("/")


def deepseek_model() -> str:
    cfg = active_config()
    if cfg:
        return str(cfg["model"])
    return (os.environ.get("DEEPSEEK_MODEL") or "deepseek-chat").strip() or "deepseek-chat"
