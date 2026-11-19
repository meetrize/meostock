"""AI 模型配置档案：CRUD、active、env 迁移、脱敏。"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

from cache.db import _lock, get_conn, init_db
from cache.models import get_config, set_config

PROVIDERS = ("deepseek", "openai_compat")
ACTIVE_KEY = "ai_active_profile_id"
HEALTH_KEY = "ai_last_health_json"
DEFAULT_DEEPSEEK_URL = "https://api.deepseek.com"


def mask_api_key(key: str | None) -> str:
    raw = (key or "").strip()
    if not raw:
        return ""
    if len(raw) <= 4:
        return "****"
    return f"****{raw[-4:]}"


def _public_row(row: dict[str, Any], *, active_id: str | None) -> dict[str, Any]:
    key = str(row.get("api_key") or "")
    return {
        "id": row["id"],
        "name": row["name"],
        "provider": row["provider"],
        "base_url": row["base_url"],
        "model": row["model"],
        "has_api_key": bool(key.strip()),
        "api_key_masked": mask_api_key(key),
        "max_tokens": row.get("max_tokens"),
        "timeout_sec": row.get("timeout_sec"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "active": bool(active_id and row["id"] == active_id),
    }


def _normalize_provider(raw: str | None) -> str:
    p = (raw or "").strip().lower()
    if p in ("openai", "compat", "openai-compatible", "custom"):
        return "openai_compat"
    return p if p in PROVIDERS else "openai_compat"


def _normalize_base_url(url: str, provider: str) -> str:
    u = (url or "").strip().rstrip("/")
    if not u and provider == "deepseek":
        return DEFAULT_DEEPSEEK_URL
    return u


def _default_name(provider: str, model: str) -> str:
    label = "DeepSeek" if provider == "deepseek" else "OpenAI 兼容"
    m = (model or "").strip()
    return f"{label} · {m}" if m else label


def get_active_id() -> str | None:
    init_db()
    v = get_config(ACTIVE_KEY)
    return (v or "").strip() or None


def set_active_id(profile_id: str | None) -> None:
    init_db()
    set_config(ACTIVE_KEY, (profile_id or "").strip())


def get_last_health() -> dict[str, Any] | None:
    init_db()
    raw = get_config(HEALTH_KEY)
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


def set_last_health(payload: dict[str, Any]) -> None:
    init_db()
    set_config(HEALTH_KEY, json.dumps(payload, ensure_ascii=False))


def list_profiles(*, include_secret: bool = False) -> list[dict[str, Any]]:
    init_db()
    ensure_env_seed()
    active = get_active_id()
    conn = get_conn()
    with _lock:
        rows = conn.execute(
            """
            SELECT id, name, provider, base_url, model, api_key,
                   max_tokens, timeout_sec, created_at, updated_at
            FROM ai_provider_profile
            ORDER BY updated_at DESC
            """
        ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        item = dict(r)
        if include_secret:
            pub = _public_row(item, active_id=active)
            pub["api_key"] = item.get("api_key") or ""
            out.append(pub)
        else:
            out.append(_public_row(item, active_id=active))
    return out


def get_profile(profile_id: str, *, include_secret: bool = False) -> dict[str, Any] | None:
    init_db()
    ensure_env_seed()
    pid = (profile_id or "").strip()
    if not pid:
        return None
    conn = get_conn()
    with _lock:
        row = conn.execute(
            """
            SELECT id, name, provider, base_url, model, api_key,
                   max_tokens, timeout_sec, created_at, updated_at
            FROM ai_provider_profile WHERE id = ?
            """,
            (pid,),
        ).fetchone()
    if row is None:
        return None
    item = dict(row)
    active = get_active_id()
    if include_secret:
        pub = _public_row(item, active_id=active)
        pub["api_key"] = item.get("api_key") or ""
        return pub
    return _public_row(item, active_id=active)


def get_active_profile(*, include_secret: bool = False) -> dict[str, Any] | None:
    init_db()
    ensure_env_seed()
    active = get_active_id()
    if active:
        p = get_profile(active, include_secret=include_secret)
        if p:
            has_key = (
                bool((p.get("api_key") or "").strip())
                if include_secret
                else bool(p.get("has_api_key"))
            )
            if has_key:
                return p
        # active 指向失效档案时回退
    profiles = list_profiles(include_secret=include_secret)
    if not profiles:
        return None
    for p in profiles:
        has_key = (
            bool((p.get("api_key") or "").strip())
            if include_secret
            else bool(p.get("has_api_key"))
        )
        if has_key:
            if not active:
                set_active_id(str(p["id"]))
            return p
    return profiles[0]


def create_profile(
    *,
    name: str | None = None,
    provider: str,
    base_url: str,
    model: str,
    api_key: str,
    max_tokens: int | None = None,
    timeout_sec: float | None = None,
    activate: bool = False,
) -> dict[str, Any]:
    init_db()
    prov = _normalize_provider(provider)
    base = _normalize_base_url(base_url, prov)
    model_s = (model or "").strip()
    key = (api_key or "").strip()
    if not base:
        raise ValueError("缺少 base_url")
    if not model_s:
        raise ValueError("缺少 model")
    if not key:
        raise ValueError("缺少 api_key")
    name_s = (name or "").strip() or _default_name(prov, model_s)
    pid = uuid.uuid4().hex
    now = time.time()
    conn = get_conn()
    with _lock:
        conn.execute(
            """
            INSERT INTO ai_provider_profile(
              id, name, provider, base_url, model, api_key,
              max_tokens, timeout_sec, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                pid,
                name_s,
                prov,
                base,
                model_s,
                key,
                max_tokens,
                timeout_sec,
                now,
                now,
            ),
        )
        conn.commit()
    if activate or not get_active_id():
        set_active_id(pid)
    return get_profile(pid) or {"id": pid}


def update_profile(
    profile_id: str,
    *,
    name: str | None = None,
    provider: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
    max_tokens: int | None | object = ...,
    timeout_sec: float | None | object = ...,
) -> dict[str, Any]:
    init_db()
    existing = get_profile(profile_id, include_secret=True)
    if not existing:
        raise KeyError("档案不存在")

    prov = _normalize_provider(provider if provider is not None else existing["provider"])
    base = _normalize_base_url(
        base_url if base_url is not None else str(existing["base_url"]),
        prov,
    )
    model_s = (model if model is not None else str(existing.get("model") or "")).strip()
    name_s = (
        (name if name is not None else str(existing.get("name") or "")).strip()
        or _default_name(prov, model_s)
    )
    # 空 api_key = 不改
    if api_key is None or not str(api_key).strip():
        key = str(existing.get("api_key") or "")
    else:
        key = str(api_key).strip()
    if not base:
        raise ValueError("缺少 base_url")
    if not model_s:
        raise ValueError("缺少 model")
    if not key:
        raise ValueError("缺少 api_key")

    if max_tokens is ...:
        mt = existing.get("max_tokens")
    else:
        mt = max_tokens
    if timeout_sec is ...:
        ts = existing.get("timeout_sec")
    else:
        ts = timeout_sec

    now = time.time()
    conn = get_conn()
    with _lock:
        conn.execute(
            """
            UPDATE ai_provider_profile
            SET name=?, provider=?, base_url=?, model=?, api_key=?,
                max_tokens=?, timeout_sec=?, updated_at=?
            WHERE id=?
            """,
            (name_s, prov, base, model_s, key, mt, ts, now, profile_id),
        )
        conn.commit()
    return get_profile(profile_id) or {"id": profile_id}


def delete_profile(profile_id: str) -> None:
    init_db()
    pid = (profile_id or "").strip()
    if not pid:
        raise ValueError("缺少 id")
    if get_active_id() == pid:
        raise ValueError("不能删除当前使用中的配置，请先切换到其他档案")
    conn = get_conn()
    with _lock:
        cur = conn.execute("DELETE FROM ai_provider_profile WHERE id = ?", (pid,))
        conn.commit()
        if not cur.rowcount:
            raise KeyError("档案不存在")


def activate_profile(profile_id: str) -> dict[str, Any]:
    p = get_profile(profile_id, include_secret=True)
    if not p:
        raise KeyError("档案不存在")
    if not (p.get("api_key") or "").strip():
        raise ValueError("该档案尚未填写 API Key")
    set_active_id(str(p["id"]))
    return get_profile(str(p["id"])) or p


def ensure_env_seed() -> bool:
    """库中无档案时，用 DEEPSEEK_* 导入一条。返回是否新写入。"""
    import os

    init_db()
    conn = get_conn()
    with _lock:
        n = conn.execute("SELECT COUNT(1) AS c FROM ai_provider_profile").fetchone()
        count = int(n["c"] if n is not None else 0)
    if count > 0:
        return False

    key = (os.environ.get("DEEPSEEK_API_KEY") or "").strip()
    if not key:
        return False
    base = (os.environ.get("DEEPSEEK_BASE_URL") or DEFAULT_DEEPSEEK_URL).strip()
    model = (os.environ.get("DEEPSEEK_MODEL") or "deepseek-chat").strip() or "deepseek-chat"
    create_profile(
        name=_default_name("deepseek", model),
        provider="deepseek",
        base_url=base,
        model=model,
        api_key=key,
        activate=True,
    )
    return True


def resolve_runtime_config(
    *,
    provider: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
    max_tokens: int | None = None,
    timeout_sec: float | None = None,
    profile_id: str | None = None,
) -> dict[str, Any]:
    """合并草稿或档案为可调用配置（含明文 Key）。"""
    if profile_id:
        p = get_profile(profile_id, include_secret=True)
        if not p:
            raise KeyError("档案不存在")
        return {
            "id": p["id"],
            "name": p["name"],
            "provider": p["provider"],
            "base_url": p["base_url"],
            "model": p["model"],
            "api_key": p.get("api_key") or "",
            "max_tokens": p.get("max_tokens"),
            "timeout_sec": p.get("timeout_sec"),
        }

    # 草稿字段：有 key 则用草稿；否则叠加 active
    draft_key = (api_key or "").strip()
    if draft_key or (base_url and model):
        active = get_active_profile(include_secret=True) or {}
        prov = _normalize_provider(provider or active.get("provider") or "deepseek")
        base = _normalize_base_url(
            (base_url if base_url is not None else str(active.get("base_url") or "")),
            prov,
        )
        model_s = (model if model is not None else str(active.get("model") or "")).strip()
        key = draft_key or str(active.get("api_key") or "")
        return {
            "id": active.get("id"),
            "name": active.get("name"),
            "provider": prov,
            "base_url": base,
            "model": model_s,
            "api_key": key,
            "max_tokens": max_tokens if max_tokens is not None else active.get("max_tokens"),
            "timeout_sec": timeout_sec if timeout_sec is not None else active.get("timeout_sec"),
        }

    active = get_active_profile(include_secret=True)
    if not active:
        raise RuntimeError("未配置 AI 模型（设置 → AI 模型）")
    return {
        "id": active["id"],
        "name": active["name"],
        "provider": active["provider"],
        "base_url": active["base_url"],
        "model": active["model"],
        "api_key": active.get("api_key") or "",
        "max_tokens": active.get("max_tokens"),
        "timeout_sec": active.get("timeout_sec"),
    }
