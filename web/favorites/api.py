"""收藏夹 HTTP API。"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from favorites.meta import fetch_site_meta, normalize_url
from favorites.store import (
    create_favorite,
    delete_favorite,
    get_favorite,
    list_favorites,
    reorder_favorites,
    update_favorite,
)

router = APIRouter(prefix="/api/favorites", tags=["favorites"])
_log = logging.getLogger("favorites-api")


class ParseBody(BaseModel):
    url: str = Field(..., min_length=1)


class CreateBody(BaseModel):
    url: str = Field(..., min_length=1)
    title: str | None = None
    favicon_url: str | None = None
    note: str | None = None


class UpdateBody(BaseModel):
    url: str | None = None
    title: str | None = None
    favicon_url: str | None = None
    note: str | None = None


class ReorderBody(BaseModel):
    ids: list[str] = Field(default_factory=list)


@router.get("")
def favorites_list() -> JSONResponse:
    try:
        items = list_favorites()
        return JSONResponse({"ok": True, "items": items, "count": len(items)})
    except Exception as exc:  # noqa: BLE001
        _log.exception("list favorites failed")
        return JSONResponse({"ok": False, "error": str(exc), "items": []}, status_code=502)


@router.post("/parse")
def favorites_parse(body: ParseBody) -> JSONResponse:
    try:
        meta = fetch_site_meta(body.url)
        return JSONResponse({"ok": True, **meta})
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("parse favorite url failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("")
def favorites_create(body: CreateBody) -> JSONResponse:
    try:
        url = normalize_url(body.url)
        title = (body.title or "").strip()
        favicon = (body.favicon_url or "").strip() or None
        # 未手动填标题/图标时自动解析
        if not title or not favicon:
            try:
                meta = fetch_site_meta(url)
                url = meta["url"]
                if not title:
                    title = meta.get("title") or ""
                if not favicon:
                    favicon = meta.get("favicon_url")
            except Exception:  # noqa: BLE001
                if not title:
                    title = url
        item = create_favorite(
            url=url,
            title=title or url,
            favicon_url=favicon,
            note=body.note,
        )
        return JSONResponse({"ok": True, "item": item})
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("create favorite failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.patch("/{item_id}")
def favorites_update(item_id: str, body: UpdateBody) -> JSONResponse:
    try:
        kwargs: dict[str, Any] = {}
        if body.url is not None:
            kwargs["url"] = normalize_url(body.url)
        if body.title is not None:
            kwargs["title"] = body.title
        if "favicon_url" in body.model_fields_set:
            kwargs["favicon_url"] = body.favicon_url
            kwargs["set_favicon"] = True
        if "note" in body.model_fields_set:
            kwargs["note"] = body.note
            kwargs["set_note"] = True
        item = update_favorite(item_id, **kwargs)
        if not item:
            return JSONResponse({"ok": False, "error": "未找到该收藏"}, status_code=404)
        return JSONResponse({"ok": True, "item": item})
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("update favorite failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.delete("/{item_id}")
def favorites_delete(item_id: str) -> JSONResponse:
    try:
        ok = delete_favorite(item_id)
        if not ok:
            return JSONResponse({"ok": False, "error": "未找到该收藏"}, status_code=404)
        return JSONResponse({"ok": True})
    except Exception as exc:  # noqa: BLE001
        _log.exception("delete favorite failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.put("/reorder")
def favorites_reorder(body: ReorderBody) -> JSONResponse:
    try:
        items = reorder_favorites(body.ids)
        return JSONResponse({"ok": True, "items": items, "count": len(items)})
    except Exception as exc:  # noqa: BLE001
        _log.exception("reorder favorites failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/{item_id}")
def favorites_get(item_id: str) -> JSONResponse:
    try:
        item = get_favorite(item_id)
        if not item:
            return JSONResponse({"ok": False, "error": "未找到该收藏"}, status_code=404)
        return JSONResponse({"ok": True, "item": item})
    except Exception as exc:  # noqa: BLE001
        _log.exception("get favorite failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)
