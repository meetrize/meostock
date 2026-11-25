"""用户 / 会话持久化。"""

from __future__ import annotations

import logging
import os
import secrets
import time
import uuid
from typing import Any

from cache.db import _lock, get_conn, init_db

from auth.passwords import hash_password, verify_password

_log = logging.getLogger("auth.store")

COOKIE_NAME = "meo_session"
SESSION_DAYS = 30
_BOOTSTRAP_KEY = "auth.bootstrap_done"


def _now() -> float:
    return time.time()


def _new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex}"


def open_register_enabled() -> bool:
    return os.environ.get("AUTH_OPEN_REGISTER", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def ensure_bootstrap_admin() -> dict[str, Any] | None:
    """无用户时创建 admin；返回一次性明文密码信息（仅启动日志用）。"""
    init_db()
    conn = get_conn()
    with _lock:
        cur = conn.execute("SELECT COUNT(1) AS c FROM auth_user")
        row = cur.fetchone()
        count = int(row["c"] if row else 0)
        if count > 0:
            return None
        done = conn.execute(
            "SELECT value FROM cache_config WHERE key = ?", (_BOOTSTRAP_KEY,)
        ).fetchone()
        if done:
            return None

        username = (os.environ.get("AUTH_ADMIN_USER") or "admin").strip() or "admin"
        password = (os.environ.get("AUTH_ADMIN_PASSWORD") or "").strip()
        generated = False
        if not password:
            password = secrets.token_urlsafe(10)
            generated = True
        now = _now()
        uid = _new_id("u")
        conn.execute(
            """
            INSERT INTO auth_user(id, username, password_hash, role, oauth_subject, created_at, updated_at)
            VALUES (?, ?, ?, 'admin', NULL, ?, ?)
            """,
            (uid, username, hash_password(password), now, now),
        )
        conn.execute(
            "INSERT OR REPLACE INTO cache_config(key, value, updated_at) VALUES (?, ?, ?)",
            (_BOOTSTRAP_KEY, "1", now),
        )
        conn.commit()
        _log.warning(
            "auth bootstrap: created admin user %r%s",
            username,
            " (password in AUTH_ADMIN_PASSWORD)" if not generated else "",
        )
        return {
            "username": username,
            "password": password if generated else None,
            "generated": generated,
            "user_id": uid,
        }


def get_user_by_id(user_id: str) -> dict[str, Any] | None:
    init_db()
    conn = get_conn()
    with _lock:
        row = conn.execute(
            "SELECT id, username, role, oauth_subject, created_at, updated_at FROM auth_user WHERE id = ?",
            (user_id,),
        ).fetchone()
    return dict(row) if row else None


def get_user_by_username(username: str) -> dict[str, Any] | None:
    init_db()
    uname = str(username or "").strip()
    if not uname:
        return None
    conn = get_conn()
    with _lock:
        row = conn.execute(
            "SELECT id, username, password_hash, role, oauth_subject, created_at, updated_at "
            "FROM auth_user WHERE username = ?",
            (uname,),
        ).fetchone()
    return dict(row) if row else None


def create_user(
    username: str,
    password: str,
    *,
    role: str = "user",
) -> dict[str, Any]:
    init_db()
    uname = str(username or "").strip()
    if len(uname) < 2 or len(uname) > 64:
        raise ValueError("用户名长度须为 2–64")
    if not all(c.isalnum() or c in "._-" for c in uname):
        raise ValueError("用户名仅允许字母数字与 ._-")
    pw = str(password or "")
    if len(pw) < 6:
        raise ValueError("密码至少 6 位")
    role_n = role if role in ("admin", "user") else "user"
    now = _now()
    uid = _new_id("u")
    conn = get_conn()
    with _lock:
        exists = conn.execute(
            "SELECT 1 FROM auth_user WHERE username = ?", (uname,)
        ).fetchone()
        if exists:
            raise ValueError("用户名已存在")
        conn.execute(
            """
            INSERT INTO auth_user(id, username, password_hash, role, oauth_subject, created_at, updated_at)
            VALUES (?, ?, ?, ?, NULL, ?, ?)
            """,
            (uid, uname, hash_password(pw), role_n, now, now),
        )
        conn.commit()
    return {
        "id": uid,
        "username": uname,
        "role": role_n,
        "created_at": now,
        "updated_at": now,
    }


def authenticate(username: str, password: str) -> dict[str, Any] | None:
    user = get_user_by_username(username)
    if not user:
        return None
    if not verify_password(password, str(user.get("password_hash") or "")):
        return None
    return {
        "id": user["id"],
        "username": user["username"],
        "role": user["role"],
        "created_at": user["created_at"],
        "updated_at": user["updated_at"],
    }


def create_session(
    user_id: str,
    *,
    user_agent: str | None = None,
    ip: str | None = None,
    days: int = SESSION_DAYS,
) -> dict[str, Any]:
    init_db()
    sid = secrets.token_urlsafe(32)
    now = _now()
    expires = now + max(1, int(days)) * 86400
    conn = get_conn()
    with _lock:
        conn.execute(
            """
            INSERT INTO auth_session(id, user_id, expires_at, created_at, user_agent, ip)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                sid,
                user_id,
                expires,
                now,
                (user_agent or "")[:240] or None,
                (ip or "")[:64] or None,
            ),
        )
        conn.commit()
    return {"id": sid, "user_id": user_id, "expires_at": expires, "created_at": now}


def delete_session(session_id: str) -> None:
    init_db()
    conn = get_conn()
    with _lock:
        conn.execute("DELETE FROM auth_session WHERE id = ?", (session_id,))
        conn.commit()


def purge_expired_sessions() -> int:
    init_db()
    now = _now()
    conn = get_conn()
    with _lock:
        cur = conn.execute("DELETE FROM auth_session WHERE expires_at < ?", (now,))
        conn.commit()
        return int(cur.rowcount or 0)


def resolve_session(session_id: str) -> dict[str, Any] | None:
    """校验 session，返回 user 字典（无 password_hash）。"""
    sid = str(session_id or "").strip()
    if not sid:
        return None
    init_db()
    now = _now()
    conn = get_conn()
    with _lock:
        row = conn.execute(
            """
            SELECT s.id AS session_id, s.expires_at, u.id, u.username, u.role,
                   u.oauth_subject, u.created_at, u.updated_at
            FROM auth_session s
            JOIN auth_user u ON u.id = s.user_id
            WHERE s.id = ?
            """,
            (sid,),
        ).fetchone()
        if not row:
            return None
        if float(row["expires_at"]) < now:
            conn.execute("DELETE FROM auth_session WHERE id = ?", (sid,))
            conn.commit()
            return None
    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "oauth_subject": row["oauth_subject"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "session_id": row["session_id"],
        "expires_at": row["expires_at"],
    }


def change_password(user_id: str, old_password: str, new_password: str) -> None:
    init_db()
    conn = get_conn()
    with _lock:
        row = conn.execute(
            "SELECT password_hash FROM auth_user WHERE id = ?", (user_id,)
        ).fetchone()
        if not row:
            raise ValueError("用户不存在")
        if not verify_password(old_password, str(row["password_hash"] or "")):
            raise ValueError("原密码不正确")
        pw = str(new_password or "")
        if len(pw) < 6:
            raise ValueError("新密码至少 6 位")
        now = _now()
        conn.execute(
            "UPDATE auth_user SET password_hash = ?, updated_at = ? WHERE id = ?",
            (hash_password(pw), now, user_id),
        )
        # 踢掉其他会话可选：此处仅保留当前逻辑由调用方决定
        conn.commit()


def delete_other_sessions(user_id: str, keep_session_id: str | None = None) -> int:
    init_db()
    conn = get_conn()
    with _lock:
        if keep_session_id:
            cur = conn.execute(
                "DELETE FROM auth_session WHERE user_id = ? AND id != ?",
                (user_id, keep_session_id),
            )
        else:
            cur = conn.execute(
                "DELETE FROM auth_session WHERE user_id = ?", (user_id,)
            )
        conn.commit()
        return int(cur.rowcount or 0)
