"""AI Agent HTTP API。"""

from __future__ import annotations

import logging
from typing import Any, Iterator

from fastapi import APIRouter, WebSocket
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from ai import config as ai_config
from ai import profiles as ai_profiles
from agent.acceptance import get_acceptance, list_pending, update_acceptance
from agent import ide_fs, ide_git
from agent.projects import list_projects
from agent.prompts import list_curated_prompts
from agent.runtime import run_agent_sse
from agent.skills_meta import list_skills_public
from agent.terminal_ws import handle_terminal_ws
from agent.tools import git_ops
from agent.paths import workspace_dir

router = APIRouter(prefix="/api/agent", tags=["agent"])
_log = logging.getLogger("agent")

_HINT_UNCONFIGURED = "在设置 → AI 模型 中添加配置并设为使用中"
_DEFAULT_GRANT = "workspace_and_repo"


class ChatMessage(BaseModel):
    role: str
    content: str


class AgentChatBody(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list)
    skillId: str | None = None
    sessionId: str | None = None
    projectId: str | None = None


class FinalizeBody(BaseModel):
    push: bool = True
    commitMessage: str | None = None


class GitCommitBody(BaseModel):
    projectId: str | None = None
    message: str = ""
    push: bool = False


class GitSuggestBody(BaseModel):
    projectId: str | None = None


@router.get("/health")
def agent_health() -> JSONResponse:
    try:
        ai_profiles.ensure_env_seed()
        cfg = ai_config.active_config()
        active = ai_profiles.get_active_profile(include_secret=False)
        return JSONResponse(
            {
                "ok": True,
                "configured": ai_config.is_configured(),
                "defaultGrant": _DEFAULT_GRANT,
                "permissionLevel": "L2",
                "defaultPermission": "L2",
                "phase": "3",
                "provider": (cfg or {}).get("provider") if cfg else None,
                "model": (cfg or {}).get("model") if cfg else None,
                "active": active,
                "capabilities": [
                    "db_readonly",
                    "workspace_fs",
                    "repo_write",
                    "project_shell",
                    "frontend_build",
                    "self_upgrade_acceptance",
                ],
                "hint": None if ai_config.is_configured() else _HINT_UNCONFIGURED,
            }
        )
    except Exception as exc:  # noqa: BLE001
        _log.exception("agent health failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/prompts")
def agent_prompts() -> JSONResponse:
    try:
        return JSONResponse({"ok": True, "prompts": list_curated_prompts(refresh=True)})
    except Exception as exc:  # noqa: BLE001
        _log.exception("agent prompts failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/skills")
def agent_skills() -> JSONResponse:
    try:
        return JSONResponse({"ok": True, "skills": list_skills_public()})
    except Exception as exc:  # noqa: BLE001
        _log.exception("agent skills failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/projects")
def agent_projects() -> JSONResponse:
    try:
        return JSONResponse({"ok": True, "projects": list_projects()})
    except Exception as exc:  # noqa: BLE001
        _log.exception("agent projects failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/workspace/{session_id}")
def agent_workspace_info(session_id: str) -> JSONResponse:
    try:
        path = workspace_dir(session_id)
        entries = []
        for i, p in enumerate(sorted(path.iterdir())):
            if i >= 100:
                break
            entries.append(
                {
                    "name": p.name,
                    "type": "dir" if p.is_dir() else "file",
                    "path": p.name,
                }
            )
        return JSONResponse(
            {"ok": True, "sessionId": session_id, "path": str(path), "entries": entries}
        )
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/acceptance")
def agent_acceptance_list(sessionId: str | None = None) -> JSONResponse:
    try:
        return JSONResponse({"ok": True, "items": list_pending(sessionId)})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/acceptance/{acceptance_id}")
def agent_acceptance_get(acceptance_id: str) -> JSONResponse:
    rec = get_acceptance(acceptance_id)
    if not rec:
        return JSONResponse({"ok": False, "error": "不存在"}, status_code=404)
    return JSONResponse({"ok": True, "acceptance": rec})


@router.post("/acceptance/{acceptance_id}/approve")
def agent_acceptance_approve(acceptance_id: str) -> JSONResponse:
    try:
        rec = get_acceptance(acceptance_id)
        if not rec:
            return JSONResponse({"ok": False, "error": "不存在"}, status_code=404)
        if rec.get("status") not in ("pending", "approved"):
            return JSONResponse(
                {"ok": False, "error": f"状态不可批准: {rec.get('status')}"},
                status_code=400,
            )
        rec = update_acceptance(acceptance_id, status="approved")
        return JSONResponse({"ok": True, "acceptance": rec})
    except Exception as exc:  # noqa: BLE001
        _log.exception("approve failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/acceptance/{acceptance_id}/reject")
def agent_acceptance_reject(acceptance_id: str) -> JSONResponse:
    try:
        rec = get_acceptance(acceptance_id)
        if not rec:
            return JSONResponse({"ok": False, "error": "不存在"}, status_code=404)
        rec = update_acceptance(acceptance_id, status="rejected")
        return JSONResponse({"ok": True, "acceptance": rec})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/acceptance/{acceptance_id}/finalize")
def agent_acceptance_finalize(acceptance_id: str, body: FinalizeBody | None = None) -> JSONResponse:
    """人工验收通过后：commit（+可选 push）。"""
    try:
        rec = get_acceptance(acceptance_id)
        if not rec:
            return JSONResponse({"ok": False, "error": "不存在"}, status_code=404)
        msg = (body.commitMessage if body else None) or None
        if msg and str(msg).strip():
            update_acceptance(acceptance_id, commitMessage=str(msg).strip()[:2000])
        if rec.get("status") == "pending":
            update_acceptance(acceptance_id, status="approved")
        do_push = True if body is None else bool(body.push)
        result = git_ops.finalize_acceptance(acceptance_id, do_push=do_push)
        status = 200 if result.get("ok") or result.get("committed") else 502
        return JSONResponse({"ok": bool(result.get("ok")), **result}, status_code=status)
    except Exception as exc:  # noqa: BLE001
        _log.exception("finalize failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/chat", response_model=None)
async def agent_chat(body: AgentChatBody):
    if not ai_config.is_configured():
        return JSONResponse(
            {
                "ok": False,
                "error": "未配置 AI 模型",
                "hint": _HINT_UNCONFIGURED,
            },
            status_code=503,
        )
    if not body.messages:
        return JSONResponse({"ok": False, "error": "messages 为空"}, status_code=400)

    msgs = [{"role": m.role, "content": m.content} for m in body.messages]

    def gen() -> Iterator[bytes]:
        try:
            yield from run_agent_sse(
                messages=msgs,
                skill_id=body.skillId,
                session_id=body.sessionId,
                project_id=body.projectId,
            )
        except Exception as exc:  # noqa: BLE001
            _log.exception("agent chat stream failed")
            payload = json_dumps_event({"event": "error", "error": str(exc)[:500]})
            yield payload
            yield b'data: {"event":"done"}\n\n'
            yield b"data: [DONE]\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def json_dumps_event(obj: dict[str, Any]) -> bytes:
    import json

    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode("utf-8")


@router.get("/fs/tree")
def agent_fs_tree(projectId: str | None = None, path: str = ".") -> JSONResponse:
    try:
        return JSONResponse(ide_fs.list_tree(projectId, path))
    except (FileNotFoundError, NotADirectoryError, ValueError) as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("fs tree failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/fs/file")
def agent_fs_file(
    projectId: str | None = None,
    path: str = "",
    offset: int | None = None,
    max_chars: int | None = None,
) -> JSONResponse:
    try:
        return JSONResponse(
            ide_fs.read_file(projectId, path, offset=offset, max_chars=max_chars)
        )
    except (FileNotFoundError, IsADirectoryError, ValueError) as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("fs file failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/git/summary")
def agent_git_summary(projectId: str | None = None) -> JSONResponse:
    try:
        return JSONResponse(ide_git.git_summary(projectId))
    except Exception as exc:  # noqa: BLE001
        _log.exception("git summary failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/git/diff")
def agent_git_diff(projectId: str | None = None, path: str = "") -> JSONResponse:
    try:
        return JSONResponse(ide_git.git_file_diff(projectId, path))
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("git diff failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/git/suggest-message")
def agent_git_suggest_message(body: GitSuggestBody) -> JSONResponse:
    try:
        result = ide_git.suggest_commit_message(body.projectId)
        status = 200 if result.get("ok") else 400
        return JSONResponse(result, status_code=status)
    except Exception as exc:  # noqa: BLE001
        _log.exception("suggest commit message failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/git/commit")
def agent_git_commit(body: GitCommitBody) -> JSONResponse:
    try:
        result = ide_git.commit_changes(
            body.projectId, message=body.message, do_push=body.push
        )
        status = 200 if result.get("ok") or result.get("committed") else 400
        return JSONResponse(result, status_code=status)
    except Exception as exc:  # noqa: BLE001
        _log.exception("git commit failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.websocket("/terminal")
async def agent_terminal_ws(websocket: WebSocket) -> None:
    await handle_terminal_ws(websocket)
