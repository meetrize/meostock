"""用户配置 HTTP API。"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from auth.deps import require_user
from user_prefs.store import import_prefs, list_prefs, upsert_prefs

router = APIRouter(prefix="/api/user", tags=["user-prefs"])


class PrefItemIn(BaseModel):
    key: str = Field(..., min_length=1, max_length=200)
    value: Any = None
    base_rev: int | None = None


class PutPrefsBody(BaseModel):
    namespace: str = Field(default="dashboard", min_length=1, max_length=64)
    items: list[PrefItemIn] = Field(default_factory=list)


class ImportBody(BaseModel):
    namespace: str = Field(default="dashboard", min_length=1, max_length=64)
    items: list[PrefItemIn] = Field(default_factory=list)
    mode: str = Field(default="merge")  # merge | overwrite


@router.get("/prefs")
def get_prefs(
    namespace: str = Query(default="dashboard"),
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    items = list_prefs(user["id"], namespace)
    return {
        "ok": True,
        "namespace": namespace,
        "items": items,
        "server_time": time.time(),
    }


@router.put("/prefs")
def put_prefs(
    body: PutPrefsBody,
    user: dict[str, Any] = Depends(require_user),
) -> Any:
    if not body.items:
        return {"ok": True, "items": [], "server_time": time.time()}
    if len(body.items) > 500:
        return JSONResponse(
            {"ok": False, "error": "单次最多 500 条"}, status_code=400
        )
    results = upsert_prefs(
        user["id"],
        body.namespace,
        [i.model_dump() for i in body.items],
    )
    return {
        "ok": True,
        "namespace": body.namespace,
        "items": results,
        "server_time": time.time(),
    }


@router.post("/prefs/import")
def import_local(
    body: ImportBody,
    user: dict[str, Any] = Depends(require_user),
) -> Any:
    mode = body.mode if body.mode in ("merge", "overwrite") else "merge"
    if len(body.items) > 1000:
        return JSONResponse(
            {"ok": False, "error": "单次最多 1000 条"}, status_code=400
        )
    result = import_prefs(
        user["id"],
        body.namespace,
        [i.model_dump() for i in body.items],
        mode=mode,
    )
    return {
        "ok": True,
        "namespace": body.namespace,
        **result,
        "server_time": time.time(),
    }
