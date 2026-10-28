"""Tushare 双中继网关包名 tsrelay（避免遮蔽 pip 包 tushare）。"""

from __future__ import annotations

__all__ = ["router"]


def __getattr__(name: str):
    if name == "router":
        from tsrelay.api import router

        return router
    raise AttributeError(name)
