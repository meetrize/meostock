"""本机账号鉴权（cookie session；预留 OAuth subject）。"""

from auth.deps import get_current_user, get_optional_user, require_user
from auth.api import router

__all__ = [
    "router",
    "get_current_user",
    "get_optional_user",
    "require_user",
]
