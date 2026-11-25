"""密码哈希：stdlib PBKDF2-SHA256（无额外依赖）。"""

from __future__ import annotations

import hashlib
import hmac
import secrets


_ITERATIONS = 200_000
_PREFIX = "pbkdf2_sha256"


def hash_password(password: str) -> str:
    pw = str(password or "")
    if not pw:
        raise ValueError("password required")
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256", pw.encode("utf-8"), bytes.fromhex(salt), _ITERATIONS
    )
    return f"{_PREFIX}${_ITERATIONS}${salt}${dk.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    raw = str(password_hash or "")
    parts = raw.split("$")
    if len(parts) != 4 or parts[0] != _PREFIX:
        return False
    try:
        iterations = int(parts[1])
        salt = parts[2]
        expected = parts[3]
    except (TypeError, ValueError):
        return False
    if iterations < 10_000 or len(salt) < 16 or len(expected) < 32:
        return False
    try:
        dk = hashlib.pbkdf2_hmac(
            "sha256",
            str(password or "").encode("utf-8"),
            bytes.fromhex(salt),
            iterations,
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(dk.hex(), expected)
