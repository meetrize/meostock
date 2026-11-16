"""DeepSeek / OpenAI 兼容配置（仅服务端）。"""

from __future__ import annotations

import os


def deepseek_api_key() -> str:
    return (os.environ.get("DEEPSEEK_API_KEY") or "").strip()


def deepseek_base_url() -> str:
    return (
        os.environ.get("DEEPSEEK_BASE_URL") or "https://api.deepseek.com"
    ).rstrip("/")


def deepseek_model() -> str:
    return (os.environ.get("DEEPSEEK_MODEL") or "deepseek-chat").strip() or "deepseek-chat"


def is_configured() -> bool:
    return bool(deepseek_api_key())


def max_history_turns() -> int:
    try:
        return max(2, min(int(os.environ.get("DEEPSEEK_MAX_TURNS") or 20), 40))
    except ValueError:
        return 20


def max_tokens() -> int:
    try:
        return max(256, min(int(os.environ.get("DEEPSEEK_MAX_TOKENS") or 2048), 8192))
    except ValueError:
        return 2048
