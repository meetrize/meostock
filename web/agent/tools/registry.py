"""工具注册与执行。"""

from __future__ import annotations

import json
from typing import Any, Callable

from agent.tools import db_readonly, fs_ops, git_ops, shell_ops, smoke, symbol_search

TOOL_DEFS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "schema_inspect",
            "description": "查看本地 quote_cache.db 的表列表，或某张表的列定义。",
            "parameters": {
                "type": "object",
                "properties": {
                    "table": {"type": "string", "description": "表名；留空则只返回全部表名"}
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sql_readonly",
            "description": "对本地库执行只读 SQL（仅 SELECT/WITH/EXPLAIN）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {"type": "string"},
                    "limit": {"type": "integer"},
                },
                "required": ["sql"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "symbol_search",
            "description": "按股票/商品名称或代码模糊搜索。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "limit": {"type": "integer"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_list",
            "description": "列出当前会话隔离工作区目录内容（data/agent_workspaces/<session>/）。",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_read",
            "description": (
                "读取工作区内文件。大文件请用 start_line/end_line 或 offset/max_chars 分段读；"
                "若 truncated=true，按 hint/nextOffset/nextStartLine 继续。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "offset": {"type": "integer", "description": "字符偏移（0 起）"},
                    "max_chars": {"type": "integer", "description": "本次最多返回字符数"},
                    "start_line": {"type": "integer", "description": "起始行（1 起，含）"},
                    "end_line": {"type": "integer", "description": "结束行（含）"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_write",
            "description": "写入工作区文件（自动建目录）。用于 coding 交付物。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "repo_list",
            "description": "列出 meostock 仓库目录（只读浏览）。",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "repo_read",
            "description": (
                "读取 meostock 仓库内文件。大文件必须分段："
                "start_line/end_line 或 offset/max_chars；truncated 时继续读完全文再 repo_write。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "offset": {"type": "integer", "description": "字符偏移（0 起）"},
                    "max_chars": {"type": "integer", "description": "本次最多返回字符数，建议 ≤80000"},
                    "start_line": {"type": "integer", "description": "起始行（1 起，含）"},
                    "end_line": {"type": "integer", "description": "结束行（含）"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "repo_write",
            "description": "写入 meostock 仓库文件（禁 .env / *.db / .git / node_modules 等）。用于自升级。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "shell_run",
            "description": (
                "在本仓库或会话工作区执行 shell（已开放：grep/sed/head/wc/npm/python/构建脚本等，支持管道）。"
                "cwd 固定在项目内。禁止 git commit/push/reset（走验收）与 sudo。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string"},
                    "cwd_scope": {
                        "type": "string",
                        "enum": ["repo", "workspace"],
                        "description": "默认 repo",
                    },
                    "timeout_sec": {"type": "number"},
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_smoke_test",
            "description": "运行 scripts/agent_smoke_test.sh：导入检查 + 可选 live health。自升级必跑。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "git_status",
            "description": "查看本仓库 git status。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "git_diff",
            "description": "查看本仓库 git diff（含 --stat）。",
            "parameters": {
                "type": "object",
                "properties": {"staged": {"type": "boolean"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "prepare_acceptance",
            "description": "自升级完成后准备人工验收单（含 diff 摘要与建议 commit message）。不会自动 commit/push。",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string", "description": "改动摘要"},
                    "commit_message": {
                        "type": "string",
                        "description": "简体中文 commit message（标题+可选正文）",
                    },
                },
                "required": ["summary", "commit_message"],
            },
        },
    },
]


def tool_names() -> list[str]:
    return [str(t["function"]["name"]) for t in TOOL_DEFS]


_L0 = ["schema_inspect", "sql_readonly", "symbol_search"]
_L1 = [
    *_L0,
    "workspace_list",
    "workspace_read",
    "workspace_write",
    "shell_run",
]
_L2 = [
    *_L1,
    "repo_list",
    "repo_read",
    "repo_write",
    "run_smoke_test",
    "git_status",
    "git_diff",
    "prepare_acceptance",
]


def tools_for_permission(level: str) -> list[str]:
    lv = (level or "L0").upper()
    if lv in ("L2", "L3"):
        return list(_L2)
    if lv == "L1":
        return list(_L1)
    return list(_L0)


def _ctx_session(args: dict[str, Any], context: dict[str, Any] | None) -> str | None:
    return (context or {}).get("session_id") or args.get("session_id")


def _schema_inspect(args: dict[str, Any], _ctx: dict[str, Any] | None) -> dict[str, Any]:
    table = str(args.get("table") or "").strip()
    if not table:
        tables = db_readonly.list_tables()
        return {"ok": True, "tables": tables, "count": len(tables)}
    cols = db_readonly.table_columns(table)
    return {"ok": True, "table": table, "columns": cols}


def _sql_readonly(args: dict[str, Any], _ctx: dict[str, Any] | None) -> dict[str, Any]:
    return db_readonly.run_select(str(args.get("sql") or ""), limit=int(args.get("limit") or 100))


def _symbol_search(args: dict[str, Any], _ctx: dict[str, Any] | None) -> dict[str, Any]:
    return symbol_search.search_symbols(
        str(args.get("query") or ""),
        limit=int(args.get("limit") or 20),
    )


def _workspace_list(args: dict[str, Any], ctx: dict[str, Any] | None) -> dict[str, Any]:
    return fs_ops.workspace_list(_ctx_session(args, ctx), str(args.get("path") or "."))


def _opt_int(args: dict[str, Any], key: str) -> int | None:
    if key not in args or args.get(key) is None:
        return None
    try:
        return int(args.get(key))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _workspace_read(args: dict[str, Any], ctx: dict[str, Any] | None) -> dict[str, Any]:
    return fs_ops.workspace_read(
        _ctx_session(args, ctx),
        str(args.get("path") or ""),
        offset=_opt_int(args, "offset"),
        max_chars=_opt_int(args, "max_chars"),
        start_line=_opt_int(args, "start_line"),
        end_line=_opt_int(args, "end_line"),
    )


def _workspace_write(args: dict[str, Any], ctx: dict[str, Any] | None) -> dict[str, Any]:
    return fs_ops.workspace_write(
        _ctx_session(args, ctx),
        str(args.get("path") or ""),
        str(args.get("content") or ""),
    )


def _repo_list(args: dict[str, Any], _ctx: dict[str, Any] | None) -> dict[str, Any]:
    return fs_ops.repo_list(str(args.get("path") or "."))


def _repo_read(args: dict[str, Any], _ctx: dict[str, Any] | None) -> dict[str, Any]:
    return fs_ops.repo_read(
        str(args.get("path") or ""),
        offset=_opt_int(args, "offset"),
        max_chars=_opt_int(args, "max_chars"),
        start_line=_opt_int(args, "start_line"),
        end_line=_opt_int(args, "end_line"),
    )


def _repo_write(args: dict[str, Any], _ctx: dict[str, Any] | None) -> dict[str, Any]:
    return fs_ops.repo_write(str(args.get("path") or ""), str(args.get("content") or ""))


def _shell_run(args: dict[str, Any], ctx: dict[str, Any] | None) -> dict[str, Any]:
    mode = str(args.get("mode") or "").strip() or None
    if not mode and isinstance(ctx, dict):
        mode = str(ctx.get("shell_mode") or "").strip() or None
    return shell_ops.run_shell(
        str(args.get("command") or ""),
        cwd_scope=str(args.get("cwd_scope") or "repo"),
        session_id=_ctx_session(args, ctx),
        timeout_sec=float(args.get("timeout_sec") or 120),
        mode=mode,
    )


def _run_smoke(_args: dict[str, Any], _ctx: dict[str, Any] | None) -> dict[str, Any]:
    return smoke.run_smoke_test()


def _git_status(_args: dict[str, Any], _ctx: dict[str, Any] | None) -> dict[str, Any]:
    return git_ops.git_status()


def _git_diff(args: dict[str, Any], _ctx: dict[str, Any] | None) -> dict[str, Any]:
    return git_ops.git_diff(staged=bool(args.get("staged")))


def _prepare_acceptance(args: dict[str, Any], ctx: dict[str, Any] | None) -> dict[str, Any]:
    return git_ops.prepare_acceptance_bundle(
        session_id=_ctx_session(args, ctx),
        summary=str(args.get("summary") or ""),
        commit_message=str(args.get("commit_message") or ""),
    )


_HANDLERS: dict[str, Callable[[dict[str, Any], dict[str, Any] | None], dict[str, Any]]] = {
    "schema_inspect": _schema_inspect,
    "sql_readonly": _sql_readonly,
    "symbol_search": _symbol_search,
    "workspace_list": _workspace_list,
    "workspace_read": _workspace_read,
    "workspace_write": _workspace_write,
    "repo_list": _repo_list,
    "repo_read": _repo_read,
    "repo_write": _repo_write,
    "shell_run": _shell_run,
    "run_smoke_test": _run_smoke,
    "git_status": _git_status,
    "git_diff": _git_diff,
    "prepare_acceptance": _prepare_acceptance,
}


def execute_tool(
    name: str,
    arguments: dict[str, Any] | str | None,
    *,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    handler = _HANDLERS.get(name)
    if not handler:
        return {"ok": False, "error": f"未知工具: {name}"}
    if arguments is None:
        args: dict[str, Any] = {}
    elif isinstance(arguments, str):
        try:
            parsed = json.loads(arguments) if arguments.strip() else {}
        except json.JSONDecodeError:
            return {"ok": False, "error": "工具参数 JSON 无效"}
        args = parsed if isinstance(parsed, dict) else {}
    elif isinstance(arguments, dict):
        args = arguments
    else:
        args = {}
    try:
        return handler(args, context)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)[:500]}
