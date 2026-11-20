"""AI 模型配置档案：CRUD、active、env 迁移、脱敏。

有 platform_id 时继承平台的 provider / base_url / api_key；
platform_id 为空则沿用本行自带字段（旧数据兼容）。
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from typing import Any

from ai import platforms as ai_platforms
from cache.db import _lock, get_conn, init_db
from cache.models import get_config, set_config

PROVIDERS = ("deepseek", "openai_compat")
ACTIVE_KEY = "ai_active_profile_id"
HEALTH_KEY = "ai_last_health_json"
DEFAULT_DEEPSEEK_URL = "https://api.deepseek.com"

_seed_lock = threading.Lock()
_seeding = False


def mask_api_key(key: str | None) -> str:
    return ai_platforms.mask_api_key(key)


def _normalize_provider(raw: str | None) -> str:
    return ai_platforms.normalize_provider(raw)


def _normalize_base_url(url: str, provider: str) -> str:
    return ai_platforms.normalize_base_url(url, provider)


def _default_name(provider: str, model: str) -> str:
    label = "DeepSeek" if provider == "deepseek" else "OpenAI 兼容"
    m = (model or "").strip()
    return f"{label} · {m}" if m else label


def _hydrate(row: dict[str, Any], platforms: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """把平台字段合并进档案行（含明文 api_key）。"""
    item = dict(row)
    pid = (item.get("platform_id") or "").strip() or None
    item["platform_id"] = pid
    if pid and pid in platforms:
        plat = platforms[pid]
        item["provider"] = plat.get("provider") or item.get("provider")
        item["base_url"] = plat.get("base_url") or item.get("base_url") or ""
        item["api_key"] = plat.get("api_key") or ""
        item["platform_name"] = plat.get("name") or ""
    else:
        item["platform_name"] = None
        if not pid:
            item["platform_id"] = None
    return item


def _public_row(row: dict[str, Any], *, active_id: str | None) -> dict[str, Any]:
    key = str(row.get("api_key") or "")
    return {
        "id": row["id"],
        "name": row["name"],
        "provider": row["provider"],
        "base_url": row.get("base_url") or "",
        "model": row["model"],
        "platform_id": row.get("platform_id"),
        "platform_name": row.get("platform_name"),
        "has_api_key": bool(key.strip()),
        "api_key_masked": mask_api_key(key),
        "max_tokens": row.get("max_tokens"),
        "timeout_sec": row.get("timeout_sec"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "active": bool(active_id and row["id"] == active_id),
    }


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


def _fetch_raw_rows() -> list[dict[str, Any]]:
    init_db()
    conn = get_conn()
    with _lock:
        rows = conn.execute(
            """
            SELECT id, name, provider, base_url, model, api_key,
                   max_tokens, timeout_sec, platform_id, created_at, updated_at
            FROM ai_provider_profile
            ORDER BY updated_at DESC
            """
        ).fetchall()
    return [dict(r) for r in rows]


def list_profiles(*, include_secret: bool = False) -> list[dict[str, Any]]:
    init_db()
    ensure_env_seed()
    active = get_active_id()
    platforms = ai_platforms.platform_map(include_secret=True)
    out: list[dict[str, Any]] = []
    for raw in _fetch_raw_rows():
        item = _hydrate(raw, platforms)
        pub = _public_row(item, active_id=active)
        if include_secret:
            pub["api_key"] = item.get("api_key") or ""
        out.append(pub)
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
                   max_tokens, timeout_sec, platform_id, created_at, updated_at
            FROM ai_provider_profile WHERE id = ?
            """,
            (pid,),
        ).fetchone()
    if row is None:
        return None
    platforms = ai_platforms.platform_map(include_secret=True)
    item = _hydrate(dict(row), platforms)
    active = get_active_id()
    pub = _public_row(item, active_id=active)
    if include_secret:
        pub["api_key"] = item.get("api_key") or ""
    return pub


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
    provider: str | None = None,
    base_url: str | None = None,
    model: str,
    api_key: str | None = None,
    max_tokens: int | None = None,
    timeout_sec: float | None = None,
    activate: bool = False,
    platform_id: str | None = None,
) -> dict[str, Any]:
    init_db()
    model_s = (model or "").strip()
    if not model_s:
        raise ValueError("缺少 model")

    plat_id = (platform_id or "").strip() or None
    if plat_id:
        plat = ai_platforms.get_platform(plat_id, include_secret=True)
        if not plat:
            raise ValueError("平台不存在")
        prov = str(plat.get("provider") or "openai_compat")
        base = str(plat.get("base_url") or "")
        key = str(plat.get("api_key") or "")
        # 行内仍存快照，真正调用以平台为准
        if not base or not key:
            raise ValueError("平台缺少 base_url 或 api_key")
        # 同平台同模型去重（直接查库，避免 ensure_env_seed 重入）
        conn = get_conn()
        with _lock:
            dup = conn.execute(
                """
                SELECT id FROM ai_provider_profile
                WHERE platform_id = ? AND model = ?
                LIMIT 1
                """,
                (plat_id, model_s),
            ).fetchone()
        if dup is not None:
            raise ValueError(f"该平台下已有模型 {model_s}")
    else:
        prov = _normalize_provider(provider)
        base = _normalize_base_url(base_url or "", prov)
        key = (api_key or "").strip()
        if not base:
            raise ValueError("缺少 base_url")
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
              max_tokens, timeout_sec, platform_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                pid,
                name_s,
                prov,
                base,
                model_s,
                key if not plat_id else "",
                max_tokens,
                timeout_sec,
                plat_id,
                now,
                now,
            ),
        )
        conn.commit()
    if activate or not get_active_id():
        set_active_id(pid)
    return get_profile(pid) or {"id": pid}


def create_profiles_batch(
    *,
    platform_id: str,
    models: list[str],
    activate_first: bool = False,
) -> list[dict[str, Any]]:
    """批量在平台下创建模型；已存在的跳过。"""
    plat_id = (platform_id or "").strip()
    if not plat_id:
        raise ValueError("缺少 platform_id")
    created: list[dict[str, Any]] = []
    existing = {
        str(p.get("model") or "")
        for p in list_profiles()
        if p.get("platform_id") == plat_id
    }
    first = True
    for raw in models:
        mid = (raw or "").strip()
        if not mid or mid in existing:
            continue
        item = create_profile(
            platform_id=plat_id,
            model=mid,
            activate=activate_first and first and not get_active_id(),
        )
        created.append(item)
        existing.add(mid)
        first = False
    return created


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
    platform_id: str | None | object = ...,
) -> dict[str, Any]:
    init_db()
    existing = get_profile(profile_id, include_secret=True)
    if not existing:
        raise KeyError("档案不存在")

    # 取原始行判断当前 platform_id
    conn = get_conn()
    with _lock:
        raw = conn.execute(
            "SELECT platform_id, api_key, base_url, provider FROM ai_provider_profile WHERE id=?",
            (profile_id,),
        ).fetchone()
    raw_plat = (dict(raw).get("platform_id") if raw else None) or None
    if isinstance(raw_plat, str):
        raw_plat = raw_plat.strip() or None

    if platform_id is ...:
        new_plat = raw_plat
    elif platform_id is None or str(platform_id).strip() == "":
        new_plat = None
    else:
        new_plat = str(platform_id).strip()
        if not ai_platforms.get_platform(new_plat, include_secret=True):
            raise ValueError("平台不存在")

    model_s = (model if model is not None else str(existing.get("model") or "")).strip()
    if not model_s:
        raise ValueError("缺少 model")

    if new_plat:
        plat = ai_platforms.get_platform(new_plat, include_secret=True) or {}
        prov = str(plat.get("provider") or existing["provider"])
        base = str(plat.get("base_url") or "")
        key = ""  # 继承平台，行内不存 key
        if not base:
            raise ValueError("平台缺少 base_url")
    else:
        prov = _normalize_provider(provider if provider is not None else existing["provider"])
        base = _normalize_base_url(
            base_url if base_url is not None else str(existing["base_url"]),
            prov,
        )
        if api_key is None or not str(api_key).strip():
            # 若从平台脱离，尽量保留已解析的 key；否则用行内
            key = str(existing.get("api_key") or "")
            if not key and raw:
                key = str(dict(raw).get("api_key") or "")
        else:
            key = str(api_key).strip()
        if not base:
            raise ValueError("缺少 base_url")
        if not key:
            raise ValueError("缺少 api_key")

    name_s = (
        (name if name is not None else str(existing.get("name") or "")).strip()
        or _default_name(prov, model_s)
    )

    if max_tokens is ...:
        mt = existing.get("max_tokens")
    else:
        mt = max_tokens
    if timeout_sec is ...:
        ts = existing.get("timeout_sec")
    else:
        ts = timeout_sec

    now = time.time()
    with _lock:
        conn.execute(
            """
            UPDATE ai_provider_profile
            SET name=?, provider=?, base_url=?, model=?, api_key=?,
                max_tokens=?, timeout_sec=?, platform_id=?, updated_at=?
            WHERE id=?
            """,
            (name_s, prov, base, model_s, key, mt, ts, new_plat, now, profile_id),
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


def attach_profile_to_platform(profile_id: str, platform_id: str | None = None) -> dict[str, Any]:
    """归入平台：指定 platform_id，或按 provider+base_url 匹配/新建平台。"""
    p = get_profile(profile_id, include_secret=True)
    if not p:
        raise KeyError("档案不存在")
    if p.get("platform_id"):
        return p

    target = (platform_id or "").strip() or None
    if target:
        if not ai_platforms.get_platform(target, include_secret=True):
            raise ValueError("平台不存在")
    else:
        # 匹配已有平台
        for plat in ai_platforms.list_platforms(include_secret=True):
            if (
                plat.get("provider") == p.get("provider")
                and (plat.get("base_url") or "").rstrip("/")
                == (p.get("base_url") or "").rstrip("/")
            ):
                target = str(plat["id"])
                break
        if not target:
            plat = ai_platforms.create_platform(
                name=None,
                provider=str(p.get("provider") or "openai_compat"),
                base_url=str(p.get("base_url") or ""),
                api_key=str(p.get("api_key") or ""),
            )
            target = str(plat["id"])

    return update_profile(profile_id, platform_id=target)


def ensure_env_seed() -> bool:
    """库中无档案时，用 DEEPSEEK_* 建平台 + 默认模型。返回是否新写入。"""
    import os

    global _seeding
    if _seeding:
        return False
    with _seed_lock:
        if _seeding:
            return False
        _seeding = True
        try:
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
            model = (
                (os.environ.get("DEEPSEEK_MODEL") or "deepseek-chat").strip() or "deepseek-chat"
            )

            platforms = ai_platforms.list_platforms(include_secret=True)
            plat = None
            for item in platforms:
                if item.get("provider") == "deepseek":
                    plat = item
                    break
            if not plat:
                plat = ai_platforms.create_platform(
                    name="DeepSeek",
                    provider="deepseek",
                    base_url=base,
                    api_key=key,
                )
            create_profile(
                name=_default_name("deepseek", model),
                platform_id=str(plat["id"]),
                model=model,
                activate=True,
            )
            return True
        finally:
            _seeding = False


def list_platforms_with_models() -> list[dict[str, Any]]:
    """平台列表，每项嵌套归属该平台的模型（脱敏）。"""
    ensure_env_seed()
    profiles = list_profiles()
    by_plat: dict[str, list[dict[str, Any]]] = {}
    for p in profiles:
        pid = p.get("platform_id")
        if not pid:
            continue
        by_plat.setdefault(str(pid), []).append(p)
    out: list[dict[str, Any]] = []
    for plat in ai_platforms.list_platforms(include_secret=False):
        models = by_plat.get(str(plat["id"]), [])
        out.append(ai_platforms.public_row(plat, models=models))
    return out


def list_standalone_profiles() -> list[dict[str, Any]]:
    return [p for p in list_profiles() if not p.get("platform_id")]


def resolve_runtime_config(
    *,
    provider: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
    max_tokens: int | None = None,
    timeout_sec: float | None = None,
    profile_id: str | None = None,
    platform_id: str | None = None,
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
            "platform_id": p.get("platform_id"),
        }

    if platform_id and not (model or "").strip():
        # 仅测平台：用平台 key + 任意已有模型名或占位
        plat = ai_platforms.get_platform(platform_id, include_secret=True)
        if not plat:
            raise KeyError("平台不存在")
        models = [
            p for p in list_profiles(include_secret=True) if p.get("platform_id") == platform_id
        ]
        model_s = (models[0]["model"] if models else "deepseek-chat").strip()
        return {
            "id": None,
            "name": plat.get("name"),
            "provider": plat.get("provider"),
            "base_url": plat.get("base_url") or "",
            "model": model_s,
            "api_key": plat.get("api_key") or "",
            "max_tokens": max_tokens,
            "timeout_sec": timeout_sec,
            "platform_id": platform_id,
        }

    draft_key = (api_key or "").strip()
    if draft_key or (base_url and model) or (platform_id and model):
        active = get_active_profile(include_secret=True) or {}
        if platform_id:
            plat = ai_platforms.get_platform(platform_id, include_secret=True) or {}
            prov = _normalize_provider(provider or plat.get("provider") or "deepseek")
            base = _normalize_base_url(
                base_url if base_url is not None else str(plat.get("base_url") or ""),
                prov,
            )
            key = draft_key or str(plat.get("api_key") or "")
        else:
            prov = _normalize_provider(provider or active.get("provider") or "deepseek")
            base = _normalize_base_url(
                (base_url if base_url is not None else str(active.get("base_url") or "")),
                prov,
            )
            key = draft_key or str(active.get("api_key") or "")
        model_s = (model if model is not None else str(active.get("model") or "")).strip()
        return {
            "id": active.get("id"),
            "name": active.get("name"),
            "provider": prov,
            "base_url": base,
            "model": model_s,
            "api_key": key,
            "max_tokens": max_tokens if max_tokens is not None else active.get("max_tokens"),
            "timeout_sec": timeout_sec if timeout_sec is not None else active.get("timeout_sec"),
            "platform_id": platform_id,
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
        "platform_id": active.get("platform_id"),
    }
