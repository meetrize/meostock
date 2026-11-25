"""Auth HTTP API：注册 / 登录 / 登出 / me / 改密。"""

from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from auth.deps import get_current_user, get_optional_user, require_admin
from auth.store import (
    COOKIE_NAME,
    SESSION_DAYS,
    authenticate,
    change_password,
    create_session,
    create_user,
    delete_other_sessions,
    delete_session,
    ensure_bootstrap_admin,
    open_register_enabled,
    purge_expired_sessions,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
_log = logging.getLogger("auth-api")


class RegisterBody(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=6, max_length=128)


class LoginBody(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class ChangePasswordBody(BaseModel):
    old_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=6, max_length=128)


class AdminCreateUserBody(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=6, max_length=128)
    role: str = Field(default="user")


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    if request.client:
        return (request.client.host or "")[:64] or None
    return None


def _set_session_cookie(response: Response, session_id: str, expires_at: float) -> None:
    secure = os.environ.get("AUTH_COOKIE_SECURE", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    max_age = max(60, int(expires_at - __import__("time").time()))
    response.set_cookie(
        key=COOKIE_NAME,
        value=session_id,
        httponly=True,
        samesite="lax",
        secure=secure,
        max_age=max_age,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=COOKIE_NAME, path="/")


def _public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user["id"],
        "username": user["username"],
        "role": user.get("role") or "user",
        "created_at": user.get("created_at"),
        "updated_at": user.get("updated_at"),
    }


@router.get("/config")
def auth_config() -> dict[str, Any]:
    return {
        "open_register": open_register_enabled(),
        "cookie_name": COOKIE_NAME,
        # OAuth 预留：尚未实现第三方登录
        "oauth_providers": [],
    }


@router.post("/register")
def register(body: RegisterBody, request: Request, response: Response) -> Any:
    if not open_register_enabled():
        return JSONResponse(
            {"ok": False, "error": "注册已关闭，请联系管理员"}, status_code=403
        )
    try:
        user = create_user(body.username, body.password, role="user")
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    sess = create_session(
        user["id"],
        user_agent=request.headers.get("user-agent"),
        ip=_client_ip(request),
    )
    _set_session_cookie(response, sess["id"], float(sess["expires_at"]))
    return {"ok": True, "user": _public_user(user)}


@router.post("/users")
def admin_create_user(
    body: AdminCreateUserBody,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    require_admin(user)
    role = body.role if body.role in ("admin", "user") else "user"
    try:
        created = create_user(body.username, body.password, role=role)
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    return {"ok": True, "user": _public_user(created)}


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response) -> Any:
    user = authenticate(body.username, body.password)
    if not user:
        return JSONResponse(
            {"ok": False, "error": "用户名或密码错误"}, status_code=401
        )
    sess = create_session(
        user["id"],
        user_agent=request.headers.get("user-agent"),
        ip=_client_ip(request),
    )
    _set_session_cookie(response, sess["id"], float(sess["expires_at"]))
    return {"ok": True, "user": _public_user(user)}


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    user: dict[str, Any] | None = Depends(get_optional_user),
) -> dict[str, Any]:
    sid = None
    if user:
        sid = user.get("session_id")
    if not sid:
        sid = request.cookies.get(COOKIE_NAME)
    if sid:
        delete_session(str(sid))
    _clear_session_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(user: dict[str, Any] | None = Depends(get_optional_user)) -> dict[str, Any]:
    if not user:
        return {"ok": True, "user": None}
    return {
        "ok": True,
        "user": _public_user(user),
        "expires_at": user.get("expires_at"),
    }


@router.post("/change-password")
def change_pw(
    body: ChangePasswordBody,
    user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    try:
        change_password(user["id"], body.old_password, body.new_password)
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    # 改密后踢掉其他会话
    delete_other_sessions(user["id"], keep_session_id=user.get("session_id"))
    return {"ok": True}


@router.post("/purge-sessions")
def purge_sessions(
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    require_admin(user)
    n = purge_expired_sessions()
    return {"ok": True, "purged": n}


def bootstrap_on_startup() -> None:
    """启动时：建表 + admin bootstrap + 清理过期 session。"""
    try:
        info = ensure_bootstrap_admin()
        if info and info.get("generated") and info.get("password"):
            _log.warning(
                "========== AUTH BOOTSTRAP ==========\n"
                "  已创建管理员账号: %s\n"
                "  初始密码（仅此一次）: %s\n"
                "  请尽快登录后修改密码\n"
                "====================================",
                info["username"],
                info["password"],
            )
        purged = purge_expired_sessions()
        if purged:
            _log.info("purged %s expired auth sessions", purged)
    except Exception as exc:  # noqa: BLE001
        _log.warning("auth bootstrap failed: %s", exc)


# OAuth 预留（未实现第三方）：
# @router.get("/oauth/{provider}/start")
# @router.get("/oauth/{provider}/callback")
