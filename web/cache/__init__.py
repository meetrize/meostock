"""行情本地缓存：SQLite + Sync Worker + FastAPI 路由。"""

from __future__ import annotations

__all__ = ["router", "init_db", "start_worker"]


def __getattr__(name: str):
    if name == "router":
        from cache.api import router

        return router
    if name == "init_db":
        from cache.db import init_db

        return init_db
    if name == "start_worker":
        from cache.sync_worker import start_worker

        return start_worker
    raise AttributeError(name)
