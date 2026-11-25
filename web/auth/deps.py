"""FastAPI 依赖：可选 / 强制登录用户。"""

from __future__ import annotations

from typing import Any

from fastapi import Cookie, HTTPException, Request

from auth.store import COOKIE_NAME, resolve_session


def _session_from_request(
    request: Request,
    meo_session: str | None,
) -> dict[str, Any] | None:
    sid = meo_session or request.cookies.get(COOKIE_NAME)
    if not sid:
        # 也接受 Authorization: Bearer <token>（便于脚本）
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            sid = auth[7:].strip()
    if not sid:
        return None
    return resolve_session(sid)


def get_optional_user(
    request: Request,
    meo_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
) -> dict[str, Any] | None:
    user = _session_from_request(request, meo_session)
    if user:
        request.state.user = user
    return user


def get_current_user(
    request: Request,
    meo_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
) -> dict[str, Any]:
    user = _session_from_request(request, meo_session)
    if not user:
        raise HTTPException(status_code=401, detail="未登录")
    request.state.user = user
    return user


def require_user(
    request: Request,
    meo_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
) -> dict[str, Any]:
    return get_current_user(request, meo_session)


def require_admin(user: dict[str, Any]) -> dict[str, Any]:
    if str(user.get("role") or "") != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user
