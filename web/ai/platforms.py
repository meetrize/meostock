"""AI 平台档案：一个平台 = 一套 provider + base_url + api_key，可挂多个模型。

模型（ai_provider_profile）通过 platform_id 归属平台并继承调用参数，
所以同一平台下新增模型只需填模型名，不必重复填 base_url / key。
"""

from __future__ import annotations

import time
import uuid
from typing import Any
from urllib.parse import urlparse

from cache.db import _lock, get_conn, init_db

PROVIDERS = ("deepseek", "openai_compat")
DEFAULT_DEEPSEEK_URL = "https://api.deepseek.com"


def mask_api_key(key: str | None) -> str:
    raw = (key or "").strip()
    if not raw:
        return ""
    if len(raw) <= 4:
        return "****"
    return f"****{raw[-4:]}"


def normalize_provider(raw: str | None) -> str:
    p = (raw or "").strip().lower()
    if p in ("openai", "compat", "openai-compatible", "custom"):
        return "openai_compat"
    return p if p in PROVIDERS else "openai_compat"


def normalize_base_url(url: str | None, provider: str) -> str:
    u = (url or "").strip().rstrip("/")
    if not u and provider == "deepseek":
        return DEFAULT_DEEPSEEK_URL
    return u


def provider_label(provider: str | None) -> str:
    return "DeepSeek" if (provider or "") == "deepseek" else "OpenAI 兼容"


def provider_host(base_url: str) -> str:
    try:
        return (urlparse(base_url if "//" in base_url else f"//{base_url}").netloc or "").strip()
    except ValueError:
        return ""


def default_name(provider: str, base_url: str) -> str:
    if provider == "deepseek":
        return "DeepSeek"
    return provider_host(base_url) or provider_label(provider)


def public_row(row: dict[str, Any], *, models: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    key = str(row.get("api_key") or "")
    out: dict[str, Any] = {
        "id": row["id"],
        "name": row["name"],
        "provider": row["provider"],
        "base_url": row.get("base_url") or "",
        "has_api_key": bool(key.strip()),
        "api_key_masked": mask_api_key(key),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }
    if models is not None:
        out["models"] = models
        out["model_count"] = len(models)
    return out


def _rows(*, include_secret: bool) -> list[dict[str, Any]]:
    init_db()
    conn = get_conn()
    with _lock:
        rows = conn.execute(
            """
            SELECT id, name, provider, base_url, api_key, created_at, updated_at
            FROM ai_platform
            ORDER BY updated_at DESC
            """
        ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        item = dict(r)
        pub = public_row(item)
        if include_secret:
            pub["api_key"] = item.get("api_key") or ""
        out.append(pub)
    return out


def list_platforms(*, include_secret: bool = False) -> list[dict[str, Any]]:
    return _rows(include_secret=include_secret)


def platform_map(*, include_secret: bool = True) -> dict[str, dict[str, Any]]:
    return {str(p["id"]): p for p in _rows(include_secret=include_secret)}


def get_platform(platform_id: str, *, include_secret: bool = False) -> dict[str, Any] | None:
    pid = (platform_id or "").strip()
    if not pid:
        return None
    for p in _rows(include_secret=include_secret):
        if p["id"] == pid:
            return p
    return None


def create_platform(
    *, name: str | None = None, provider: str, base_url: str, api_key: str
) -> dict[str, Any]:
    init_db()
    prov = normalize_provider(provider)
    base = normalize_base_url(base_url, prov)
    key = (api_key or "").strip()
    if not base:
        raise ValueError("缺少 base_url")
    if not key:
        raise ValueError("缺少 api_key")
    name_s = (name or "").strip() or default_name(prov, base)
    pid = uuid.uuid4().hex
    now = time.time()
    conn = get_conn()
    with _lock:
        conn.execute(
            """
            INSERT INTO ai_platform(id, name, provider, base_url, api_key, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (pid, name_s, prov, base, key, now, now),
        )
        conn.commit()
    return get_platform(pid) or {"id": pid, "name": name_s}


def count_platform_models(platform_id: str) -> int:
    init_db()
    conn = get_conn()
    with _lock:
        row = conn.execute(
            "SELECT COUNT(1) AS c FROM ai_provider_profile WHERE platform_id = ?",
            ((platform_id or "").strip(),),
        ).fetchone()
    return int(row["c"] if row is not None else 0)


def update_platform(
    platform_id: str,
    *,
    name: str | None = None,
    provider: str | None = None,
    base_url: str | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    """更新平台；api_key 留空 = 不改。平台下的模型自动继承新端点。"""
    init_db()
    pid = (platform_id or "").strip()
    existing = get_platform(pid, include_secret=True)
    if not existing:
        raise KeyError("平台不存在")
    prov = normalize_provider(provider if provider is not None else existing["provider"])
    base = normalize_base_url(
        base_url if base_url is not None else str(existing.get("base_url") or ""), prov
    )
    key = (api_key or "").strip() or str(existing.get("api_key") or "")
    if not base:
        raise ValueError("缺少 base_url")
    if not key:
        raise ValueError("缺少 api_key")
    name_s = (name if name is not None else str(existing.get("name") or "")).strip() or default_name(
        prov, base
    )
    now = time.time()
    conn = get_conn()
    with _lock:
        conn.execute(
            """
            UPDATE ai_platform
            SET name=?, provider=?, base_url=?, api_key=?, updated_at=?
            WHERE id=?
            """,
            (name_s, prov, base, key, now, pid),
        )
        conn.commit()
    return get_platform(pid) or existing


def delete_platform(platform_id: str) -> None:
    init_db()
    pid = (platform_id or "").strip()
    if not pid:
        raise ValueError("缺少 id")
    n = count_platform_models(pid)
    if n > 0:
        raise ValueError(f"该平台下还有 {n} 个模型，请先删除模型")
    conn = get_conn()
    with _lock:
        cur = conn.execute("DELETE FROM ai_platform WHERE id = ?", (pid,))
        conn.commit()
        if not cur.rowcount:
            raise KeyError("平台不存在")
