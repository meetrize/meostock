"""Agent 工具循环 + SSE 事件生成。"""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.request
from typing import Any, Iterator

from ai import config as ai_config
from ai.client import chat_completion
from agent.intent import resolve_intent
from agent.paths import workspace_dir
from agent.projects import resolve_project
from agent.tools.registry import TOOL_DEFS, execute_tool

_log = logging.getLogger("agent.runtime")

# 0 / 未设置 = 不限制轮次（仅保留极端安全上限，防模型死循环刷 API）
_ABS_CEILING = 500

_SYSTEM_BASE = (
    "你是 meostock 看板里的 AI Agent（本机投研与工程副驾驶）。用简洁专业的中文回答。\n"
    "权限：本机单用户默认 workspace_and_repo 全权限（L2）——"
    "可读可写本仓库与会话工作区、项目内完整 shell（cwd=repo/workspace）、只读查库；"
    "禁止写 .env/*.db/.git；禁止自行 git commit/push/reset（须 UI 验收）；禁止 sudo。\n"
    "需要事实或改文件时必须调用工具，禁止编造，禁止声称「权限不足 / 只有 L0 / 不在 allowlist」。\n"
    "大文件：repo_read/workspace_read 支持 start_line/end_line 或 offset/max_chars；"
    "若 truncated=true，必须继续分段读完全文后再 repo_write（整文件覆盖，切勿在未读全时写入）。"
    "也可用 shell_run：sed/grep/head/wc/rg 等辅助定位。\n"
    "必须严格针对【目标项目】操作：kind=repo 时优先 repo_* / 本仓库构建；"
    "kind=workspace 时优先 workspace_*，不要误改本仓库除非用户明确要求。\n"
    "工具效率：路径已知时直接 repo_read → repo_write；禁止用 shell grep/sed 探索；"
    "自升级禁止 workspace 临时脚本绕路；改完只跑 build 脚本与 smoke，然后 prepare_acceptance。\n"
    "前端重新发布：改 apps/stock-dashboard 后执行 shell_run：./scripts/build_dashboard.sh"
    "（产物落到 web/static/dashboard，刷新即可）。\n"
    "提到股票或商品时尽量带上代码与名称；不提供买卖指令或收益承诺。\n"
    "改仓库后：run_smoke_test → prepare_acceptance；禁止自行 commit/push（须 UI 人工验收）。\n"
    "实施纪律：用户要求改代码/加菜单/自升级时，读够必要文件后必须在同一次会话内调用 "
    "repo_write/workspace_write 真正落盘；禁止以「本轮只读/方案已确定/未写入」收尾；"
    "禁止把「已具备写入条件」当成完成。"
)

# 回传给模型的 tool 结果上限（读文件给更高额度；UI SSE 仍可压缩）
_TOOL_RESULT_CAPS = {
    "repo_read": 100_000,
    "workspace_read": 100_000,
    "shell_run": 48_000,
    "git_diff": 40_000,
    "sql_readonly": 24_000,
}
_TOOL_RESULT_DEFAULT = 24_000

_WRITE_TOOLS = frozenset({"repo_write", "workspace_write"})
_IMPLEMENT_INTENTS = frozenset({"self_upgrade", "coding"})
_IMPLEMENT_SKILLS = frozenset({"self_upgrade", "publish_frontend", "coding_workspace"})
# 写盘后收尾：允许修文件 + 构建/冒烟 + 验收（shell 在执行层限制为 build_only）
_POST_WRITE_TOOLS = frozenset(
    {
        "shell_run",
        "run_smoke_test",
        "prepare_acceptance",
        "repo_write",
    }
)
# 未写盘阶段：只允许写文件，禁止再用 shell/grep 空转
_WRITE_PHASE_TOOLS = frozenset({"repo_write", "workspace_write"})
# 自升级探索阶段也不给 shell（避免一上来就 grep）；只给读+写
_SELF_UPGRADE_EXPLORE_TOOLS = frozenset(
    {
        "repo_list",
        "repo_read",
        "repo_write",
        "run_smoke_test",
        "prepare_acceptance",
        "git_status",
        "git_diff",
    }
)

_FORCE_WRITE_NUDGE = (
    "【系统强制推进·只允许 repo_write】本阶段已禁用 shell_run/repo_read。"
    "你必须立刻用正式 tool_calls 调用 repo_write（可一次并行多个 path），"
    "把完整文件内容写入目标源码（不要写临时 css/md/绕路脚本）。"
    "禁止 grep/sed/方案文字/伪工具 XML。"
)

_FORCE_ACCEPT_NUDGE = (
    "【系统强制收尾】文件已写入。shell 仅允许 ./scripts/build_dashboard.sh 与 smoke；"
    "禁止再 grep/sed/python。立刻："
    "shell_run ./scripts/build_dashboard.sh（若改了前端）→ run_smoke_test → "
    "prepare_acceptance（简体中文 commit message）。不要探索。"
)

_FAKE_TOOL_TEXT = re.compile(
    r"(invoke\s+name\s*=|DSML|tool_call|"
    r"functions\.repo_write|functions\.workspace_write|"
    r"<parameter\s+name=|</?invoke)",
    re.IGNORECASE | re.MULTILINE,
)


def _tool_result_cap(tool_name: str) -> int:
    return int(_TOOL_RESULT_CAPS.get(tool_name, _TOOL_RESULT_DEFAULT))


def _intent_requires_write(intent: dict[str, Any]) -> bool:
    return (
        str(intent.get("intent") or "") in _IMPLEMENT_INTENTS
        or str(intent.get("skillId") or "") in _IMPLEMENT_SKILLS
    )


def _is_self_upgrade(intent: dict[str, Any]) -> bool:
    return (
        str(intent.get("intent") or "") == "self_upgrade"
        or str(intent.get("skillId") or "") == "self_upgrade"
    )


def _has_write_tool(results: list[dict[str, Any]]) -> bool:
    return any(str(b.get("tool") or "") in _WRITE_TOOLS for b in results)


def _has_successful_write(results: list[dict[str, Any]]) -> bool:
    for block in results:
        if str(block.get("tool") or "") not in _WRITE_TOOLS:
            continue
        payload = block.get("result")
        if isinstance(payload, dict) and payload.get("ok"):
            return True
    return False


def _has_successful_acceptance(results: list[dict[str, Any]]) -> bool:
    for block in results:
        if str(block.get("tool") or "") != "prepare_acceptance":
            continue
        payload = block.get("result")
        if isinstance(payload, dict) and (
            payload.get("ok") or isinstance(payload.get("acceptance"), dict)
        ):
            return True
    return False


def _implementation_complete(intent: dict[str, Any], results: list[dict[str, Any]]) -> bool:
    """实施类意图：写盘成功才算可结束；自升级还须 prepare_acceptance。"""
    if not _intent_requires_write(intent):
        return True
    if not _has_successful_write(results):
        return False
    if _is_self_upgrade(intent):
        return _has_successful_acceptance(results)
    return True


def _looks_like_fake_tool_text(text: str) -> bool:
    raw = (text or "").strip()
    if not raw:
        return False
    return bool(_FAKE_TOOL_TEXT.search(raw))


def _has_build_or_smoke(results: list[dict[str, Any]]) -> bool:
    for block in results:
        name = str(block.get("tool") or "")
        payload = block.get("result") if isinstance(block.get("result"), dict) else {}
        if name == "run_smoke_test" and payload.get("ok"):
            return True
        if name == "shell_run" and payload.get("ok"):
            cmd = str(payload.get("command") or "")
            if "build_dashboard" in cmd or "agent_smoke_test" in cmd:
                return True
    return False


def _select_tools_for_phase(
    all_tools: list[dict[str, Any]],
    *,
    intent: dict[str, Any],
    results: list[dict[str, Any]],
    force_phase: bool,
) -> list[dict[str, Any]]:
    """最短路径工具集：自升级默认无 shell；强制写盘只 write；收尾只构建/验收。"""
    if not _intent_requires_write(intent):
        return all_tools

    if not _has_successful_write(results):
        if force_phase:
            allow = _WRITE_PHASE_TOOLS
        elif _is_self_upgrade(intent):
            allow = _SELF_UPGRADE_EXPLORE_TOOLS
        else:
            return all_tools
    elif _is_self_upgrade(intent) and not _has_successful_acceptance(results):
        allow = _POST_WRITE_TOOLS
    elif force_phase and not _implementation_complete(intent, results):
        allow = _POST_WRITE_TOOLS
    else:
        return all_tools
    filtered = [t for t in all_tools if t["function"]["name"] in allow]
    return filtered or all_tools


def _tool_choice_for_phase(
    *,
    intent: dict[str, Any],
    results: list[dict[str, Any]],
    force_phase: bool,
) -> Any:
    """未写盘强制 repo_write；已构建则强制 prepare_acceptance。"""
    if not _intent_requires_write(intent):
        return "auto"
    if not _has_successful_write(results):
        if force_phase:
            return {"type": "function", "function": {"name": "repo_write"}}
        return "auto" if _is_self_upgrade(intent) else "required"
    if _is_self_upgrade(intent) and not _has_successful_acceptance(results):
        if _has_build_or_smoke(results) or force_phase:
            return {"type": "function", "function": {"name": "prepare_acceptance"}}
        return "required"
    return "auto"


def _shell_mode_for_phase(
    *,
    intent: dict[str, Any],
    results: list[dict[str, Any]],
) -> str | None:
    if _is_self_upgrade(intent) and _has_successful_write(results):
        return "build_only"
    return None


def _resolve_max_rounds(intent_rounds: Any) -> int:
    """意图 maxRounds：0/负数/缺省 = 不限制（用环境变量或绝对天花板）。"""
    env_raw = (os.environ.get("AGENT_MAX_TOOL_ROUNDS") or "").strip()
    env_cap: int | None = None
    if env_raw.isdigit():
        env_cap = int(env_raw)

    try:
        requested = int(intent_rounds) if intent_rounds is not None else 0
    except (TypeError, ValueError):
        requested = 0

    if requested > 0:
        cap = env_cap if env_cap and env_cap > 0 else _ABS_CEILING
        return min(requested, cap)
    # 不限制：仅保留环境上限或绝对天花板
    if env_cap and env_cap > 0:
        return env_cap
    return _ABS_CEILING


def _sse(obj: dict[str, Any]) -> bytes:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode("utf-8")


def _normalize_history(messages: list[dict[str, str]], limit: int = 20) -> list[dict[str, str]]:
    cleaned: list[dict[str, str]] = []
    for m in messages:
        role = (m.get("role") or "").strip().lower()
        if role not in ("user", "assistant"):
            continue
        content = (m.get("content") or "").strip()
        if not content:
            continue
        cleaned.append({"role": role, "content": content})
    return cleaned[-limit:]


def _filter_tools(allowed: list[str] | None) -> list[dict[str, Any]]:
    if not allowed:
        return list(TOOL_DEFS)
    allow = set(allowed)
    return [t for t in TOOL_DEFS if t["function"]["name"] in allow]


def _extract_entities_from_tool_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    entities: list[dict[str, Any]] = []
    seen: set[str] = set()
    for block in results:
        payload = block.get("result") if isinstance(block, dict) else None
        if not isinstance(payload, dict):
            continue
        items = payload.get("items")
        if isinstance(items, list):
            for it in items:
                if not isinstance(it, dict):
                    continue
                ks = str(it.get("klineSymbol") or "").strip()
                if not ks or ks in seen:
                    continue
                seen.add(ks)
                entities.append(
                    {
                        "name": str(it.get("name") or ""),
                        "code": str(it.get("code") or ""),
                        "klineSymbol": ks,
                        "klineUrl": str(it.get("klineUrl") or f"/?symbol={ks}"),
                        "market": str(it.get("market") or ""),
                    }
                )
        rows = payload.get("rows")
        cols = payload.get("columns") or []
        if isinstance(rows, list) and rows:
            name_idx = None
            code_idx = None
            kline_idx = None
            for i, c in enumerate(cols):
                cl = str(c).lower()
                if cl in ("name", "名称") and name_idx is None:
                    name_idx = i if not isinstance(rows[0], dict) else c
                if cl in ("code", "代码") and code_idx is None:
                    code_idx = i if not isinstance(rows[0], dict) else c
                if cl in ("kline_symbol", "klinesymbol") and kline_idx is None:
                    kline_idx = i if not isinstance(rows[0], dict) else c
            for row in rows[:40]:
                if isinstance(row, dict):
                    name = str(row.get("name") or row.get("名称") or "")
                    code = str(row.get("code") or row.get("代码") or "")
                    market = str(row.get("market") or "")
                    ks = str(row.get("kline_symbol") or row.get("klineSymbol") or "").strip()
                    if not ks and code:
                        from agent.tools.symbol_search import _kline_symbol

                        ks = _kline_symbol(market, code, None)
                    if ks and ks not in seen:
                        seen.add(ks)
                        entities.append(
                            {
                                "name": name,
                                "code": code,
                                "klineSymbol": ks,
                                "klineUrl": f"/?symbol={ks}",
                                "market": market,
                            }
                        )
    return entities


def _linkify_content(text: str, entities: list[dict[str, Any]]) -> str:
    """把正文中的名称替换为 markdown 链接（长名优先）。"""
    if not text or not entities:
        return text
    out = text
    ordered = sorted(
        entities,
        key=lambda e: len(str(e.get("name") or "")),
        reverse=True,
    )
    for ent in ordered:
        name = str(ent.get("name") or "").strip()
        ks = str(ent.get("klineSymbol") or "").strip()
        if len(name) < 2 or not ks:
            continue
        if f"](kline:{ks})" in out:
            continue
        # 避免重复替换已是链接的文本
        linked = f"[{name}](kline:{ks})"
        if linked in out:
            continue
        out = out.replace(name, linked, 2)
    return out


def _chat_with_tools(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    *,
    cfg: dict[str, Any],
    tool_choice: Any = "auto",
) -> dict[str, Any]:
    """非流式一轮（可能含 tool_calls）。"""
    base = str(cfg.get("base_url") or "").rstrip("/")
    url = ai_config.completions_url(base)
    payload: dict[str, Any] = {
        "model": cfg["model"],
        "messages": messages,
        "stream": False,
        "temperature": 0.3,
        "max_tokens": ai_config.max_tokens(),
        "tools": tools,
        "tool_choice": tool_choice if tool_choice is not None else "auto",
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cfg['api_key']}",
            "Accept": "application/json",
        },
        method="POST",
    )
    timeout = ai_config.default_timeout()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace") if e.fp else str(e.reason)
        raise RuntimeError(f"AI HTTP {e.code}: {err_body[:400]}") from e
    try:
        return json.loads(raw) if raw else {}
    except json.JSONDecodeError as e:
        raise RuntimeError(f"AI 返回非 JSON: {raw[:200]}") from e


def _stream_final(
    messages: list[dict[str, Any]],
    *,
    cfg: dict[str, Any],
) -> Iterator[str]:
    base = str(cfg.get("base_url") or "").rstrip("/")
    url = ai_config.completions_url(base)
    payload: dict[str, Any] = {
        "model": cfg["model"],
        "messages": messages,
        "stream": True,
        "temperature": 0.4,
        "max_tokens": ai_config.max_tokens(),
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cfg['api_key']}",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    timeout = ai_config.default_timeout()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        while True:
            line = resp.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="replace").strip()
            if not text or not text.startswith("data:"):
                continue
            raw = text[5:].strip()
            if raw == "[DONE]":
                break
            try:
                obj = json.loads(raw)
            except json.JSONDecodeError:
                continue
            try:
                delta = ((obj.get("choices") or [{}])[0].get("delta") or {}).get("content") or ""
            except Exception:  # noqa: BLE001
                delta = ""
            if delta:
                yield delta


def _extract_artifacts(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    arts: list[dict[str, Any]] = []
    for block in results:
        payload = block.get("result") if isinstance(block, dict) else None
        if not isinstance(payload, dict):
            continue
        art = payload.get("artifact")
        if isinstance(art, dict):
            arts.append(art)
        acc = payload.get("acceptance")
        if isinstance(acc, dict) and acc.get("id"):
            arts.append({"type": "acceptance", **acc})
    return arts


def run_agent_sse(
    *,
    messages: list[dict[str, str]],
    skill_id: str | None = None,
    session_id: str | None = None,
    project_id: str | None = None,
) -> Iterator[bytes]:
    yield _sse({"event": "start"})
    cfg = ai_config.active_config()
    if not cfg:
        yield _sse({"event": "error", "error": "未配置 AI 模型", "hint": "在设置 → AI 模型 中添加配置并设为使用中"})
        yield _sse({"event": "done"})
        yield b"data: [DONE]\n\n"
        return

    history = _normalize_history(messages)
    if not history:
        yield _sse({"event": "error", "error": "messages 为空"})
        yield _sse({"event": "done"})
        yield b"data: [DONE]\n\n"
        return

    last_user = next((m["content"] for m in reversed(history) if m["role"] == "user"), "")
    intent = resolve_intent(last_user, skill_id=skill_id)
    perm = str(intent.get("permission") or "L2")
    project = resolve_project(project_id)
    # 选中 Agent 工作区项目时，workspace_* 指向该项目目录；否则用会话目录
    tool_workspace_id = (
        str(project["id"])
        if project.get("kind") == "workspace"
        else session_id
    )
    ws = workspace_dir(tool_workspace_id)
    yield _sse(
        {
            "event": "intent",
            "intent": intent["intent"],
            "skillId": intent.get("skillId"),
            "permission": perm,
            "source": intent.get("source"),
            "workspacePath": str(ws),
            "projectId": project.get("id"),
            "projectKind": project.get("kind"),
            "projectName": project.get("name"),
            "projectPath": project.get("path"),
        }
    )

    system_parts = [
        _SYSTEM_BASE,
        f"【本轮权限】{perm}",
        (
            f"【目标项目】id={project.get('id')} · kind={project.get('kind')} · "
            f"name={project.get('name')} · path={project.get('path')}"
        ),
        f"【会话工作区】{ws}",
    ]
    if project.get("kind") == "repo":
        system_parts.append(
            "【操作重点】目标为本仓库 meostock：用 repo_read/repo_write/shell_run(构建脚本)；"
            "工作区仅作临时草稿。"
        )
    else:
        system_parts.append(
            "【操作重点】目标为 Agent 隔离工作区项目：优先 workspace_list/read/write；"
            "除非用户明确要求，不要改动本仓库源码。"
        )
    if intent.get("systemExtra"):
        system_parts.append(str(intent["systemExtra"]))
    system = "\n\n".join(system_parts)

    all_tools = _filter_tools(intent.get("tools"))
    tool_ctx: dict[str, Any] = {
        "session_id": tool_workspace_id,
        "project_id": project.get("id"),
        "project_kind": project.get("kind"),
        "shell_mode": None,
    }
    working: list[dict[str, Any]] = [{"role": "system", "content": system}, *history]
    collected_tool_results: list[dict[str, Any]] = []
    final_text = ""
    max_rounds = _resolve_max_rounds(intent.get("maxRounds"))
    require_write = _intent_requires_write(intent)
    write_nudges = 0
    non_write_streak = 0
    force_phase = False
    yield _sse(
        {
            "event": "meta",
            "maxToolRounds": max_rounds,
            "requireWrite": require_write,
            "completeWhen": (
                "repo_write + prepare_acceptance"
                if _is_self_upgrade(intent)
                else ("repo_write/workspace_write" if require_write else "model_done")
            ),
        }
    )

    try:
        stopped_by_cap = True
        for _round in range(max_rounds):
            done_impl = _implementation_complete(intent, collected_tool_results)
            # 只要出现过「未写盘空转」，或已催促过 → 进入强制写盘阶段
            in_force = bool(
                force_phase
                or write_nudges > 0
                or (require_write and non_write_streak >= 1)
            )
            round_tools = _select_tools_for_phase(
                all_tools,
                intent=intent,
                results=collected_tool_results,
                force_phase=in_force,
            )
            choice: Any = _tool_choice_for_phase(
                intent=intent,
                results=collected_tool_results,
                force_phase=in_force,
            )
            tool_ctx["shell_mode"] = _shell_mode_for_phase(
                intent=intent, results=collected_tool_results
            )
            try:
                upstream = _chat_with_tools(
                    working, round_tools, cfg=cfg, tool_choice=choice
                )
            except Exception as tool_choice_exc:  # noqa: BLE001
                # 部分网关不支持 required / 指定 function，逐步回退
                _log.warning("tool_choice=%s failed: %s", choice, tool_choice_exc)
                fallbacks: list[Any] = []
                if choice != "required":
                    fallbacks.append("required")
                fallbacks.append("auto")
                upstream = None
                last_exc: Exception | None = tool_choice_exc
                for fb in fallbacks:
                    try:
                        upstream = _chat_with_tools(
                            working, round_tools, cfg=cfg, tool_choice=fb
                        )
                        choice = fb
                        break
                    except Exception as e2:  # noqa: BLE001
                        last_exc = e2
                        _log.warning("tool_choice fallback %s failed: %s", fb, e2)
                if upstream is None:
                    raise last_exc if last_exc else tool_choice_exc
            msg = ((upstream.get("choices") or [{}])[0].get("message") or {})
            tool_calls = msg.get("tool_calls") or []
            content = (msg.get("content") or "").strip()

            if tool_calls:
                working.append(
                    {
                        "role": "assistant",
                        "content": msg.get("content") or "",
                        "tool_calls": tool_calls,
                    }
                )
                round_names: list[str] = []
                for tc in tool_calls:
                    fn = (tc.get("function") or {}) if isinstance(tc, dict) else {}
                    name = str(fn.get("name") or "")
                    raw_args = fn.get("arguments") or "{}"
                    tc_id = str(tc.get("id") or name)
                    round_names.append(name)
                    yield _sse({"event": "tool_start", "tool": name, "id": tc_id, "arguments": raw_args})
                    # 硬拦截：强制写盘阶段不允许再执行 shell/read
                    if (
                        in_force
                        and not _has_successful_write(collected_tool_results)
                        and name not in _WRITE_TOOLS
                    ):
                        result = {
                            "ok": False,
                            "error": (
                                f"强制写盘阶段已禁用 {name}，请调用 repo_write 写入完整文件内容"
                            ),
                            "blocked": True,
                        }
                    elif (
                        _is_self_upgrade(intent)
                        and name == "workspace_write"
                        and project.get("kind") == "repo"
                    ):
                        result = {
                            "ok": False,
                            "error": (
                                "改本仓库请用 repo_write，不要 workspace_write 写临时脚本绕路"
                            ),
                            "blocked": True,
                        }
                    else:
                        result = execute_tool(name, raw_args, context=tool_ctx)
                    collected_tool_results.append({"tool": name, "result": result})
                    result_text = json.dumps(result, ensure_ascii=False)
                    cap = _tool_result_cap(name)
                    if len(result_text) > cap:
                        # 读文件被截断时，保留元数据 + 提示继续分段，避免模型误以为「读不到」
                        if (
                            name in ("repo_read", "workspace_read")
                            and isinstance(result, dict)
                            and isinstance(result.get("content"), str)
                        ):
                            meta = {
                                k: result.get(k)
                                for k in (
                                    "ok",
                                    "path",
                                    "bytes",
                                    "totalChars",
                                    "totalLines",
                                    "offset",
                                    "nextOffset",
                                    "startLine",
                                    "endLine",
                                    "nextStartLine",
                                    "truncated",
                                    "hint",
                                )
                                if k in result
                            }
                            keep = max(2000, cap - 800)
                            meta["content"] = result["content"][:keep]
                            meta["truncated"] = True
                            meta["hint"] = (
                                str(result.get("hint") or "")
                                + f" （回传给模型时截断到 {keep} 字符；请用 offset/start_line 继续读）"
                            ).strip()
                            result_text = json.dumps(meta, ensure_ascii=False)
                            if len(result_text) > cap:
                                result_text = result_text[:cap] + "…(truncated)"
                        else:
                            result_text = result_text[:cap] + "…(truncated)"
                    ui_dump = json.dumps(result, ensure_ascii=False)
                    yield _sse(
                        {
                            "event": "tool_result",
                            "tool": name,
                            "id": tc_id,
                            "result": result
                            if len(ui_dump) < 8000
                            else {
                                "ok": result.get("ok") if isinstance(result, dict) else None,
                                "truncated": True,
                                "preview": result_text[:2000],
                            },
                        }
                    )
                    if isinstance(result, dict) and result.get("artifact"):
                        yield _sse({"event": "artifact", "artifact": result["artifact"]})
                    if isinstance(result, dict) and isinstance(result.get("acceptance"), dict):
                        yield _sse({"event": "acceptance", "acceptance": result["acceptance"]})
                    working.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc_id,
                            "content": result_text,
                        }
                    )

                if _has_successful_write(collected_tool_results):
                    non_write_streak = 0
                else:
                    non_write_streak += 1

                # 未完成 → 立刻进入强制写盘（禁止再 shell/grep）；不设催促次数上限
                if require_write and not _implementation_complete(
                    intent, collected_tool_results
                ):
                    write_nudges += 1
                    force_phase = True
                    if not _has_successful_write(collected_tool_results):
                        # 若本轮还在调非 write 工具，明确告知已被禁用
                        bad = [n for n in round_names if n not in _WRITE_TOOLS]
                        extra = (
                            f"本轮无效工具已忽略倾向：{', '.join(bad)}。"
                            if bad
                            else ""
                        )
                        msg_status = (
                            f"强制写盘阶段（第 {write_nudges} 次）：只允许 repo_write…"
                        )
                        nudge = _FORCE_WRITE_NUDGE + extra
                    else:
                        msg_status = f"强制收尾（第 {write_nudges} 次）：prepare_acceptance…"
                        nudge = _FORCE_ACCEPT_NUDGE
                    yield _sse({"event": "status", "message": msg_status})
                    working.append({"role": "user", "content": nudge})
                continue

            # —— 无 tool_calls：可能是正文，也可能是伪工具文本 ——
            if require_write and not _implementation_complete(intent, collected_tool_results):
                write_nudges += 1
                force_phase = True
                if content:
                    # 伪 tool 调用当无效，不展示为最终答案
                    note = (
                        "检测到模型把工具调用写成了纯文本，已忽略；请改用正式 tool_calls。"
                        if _looks_like_fake_tool_text(content)
                        else "拒绝在未完成实施前用文字收尾。"
                    )
                    working.append({"role": "assistant", "content": content[:2000]})
                    yield _sse(
                        {
                            "event": "status",
                            "message": f"{note}（第 {write_nudges} 次催促）",
                        }
                    )
                else:
                    yield _sse(
                        {
                            "event": "status",
                            "message": f"尚未完成实施（第 {write_nudges} 次催促），继续…",
                        }
                    )
                working.append(
                    {
                        "role": "user",
                        "content": (
                            _FORCE_WRITE_NUDGE
                            if not _has_successful_write(collected_tool_results)
                            else _FORCE_ACCEPT_NUDGE
                        ),
                    }
                )
                continue

            if content:
                final_text = content
                yield _sse({"event": "content", "content": content})
                stopped_by_cap = False
                break

            if collected_tool_results:
                wrap_up = (
                    "请基于以上工具结果给出最终中文回答；表格用 markdown；列出已写入的产物路径与验收单。"
                    if _implementation_complete(intent, collected_tool_results)
                    else "实施尚未完成：请继续调用工具，不要只写总结。"
                )
                working.append({"role": "user", "content": wrap_up})
                if require_write and not _implementation_complete(intent, collected_tool_results):
                    force_phase = True
                    continue
                pieces: list[str] = []
                try:
                    for delta in _stream_final(working, cfg=cfg):
                        pieces.append(delta)
                        yield _sse({"event": "content", "content": delta})
                    final_text = "".join(pieces)
                except Exception as stream_exc:  # noqa: BLE001
                    _log.warning("agent final stream failed: %s", stream_exc)
                    try:
                        upstream2 = chat_completion(working, temperature=0.4, cfg=cfg)
                        final_text = (
                            ((upstream2.get("choices") or [{}])[0].get("message") or {}).get(
                                "content"
                            )
                            or ""
                        )
                        if final_text:
                            yield _sse({"event": "content", "content": final_text})
                    except Exception as e2:  # noqa: BLE001
                        raise stream_exc from e2
            stopped_by_cap = False
            break
        else:
            if stopped_by_cap:
                missing = []
                if require_write and not _has_successful_write(collected_tool_results):
                    missing.append("repo_write/workspace_write")
                if _is_self_upgrade(intent) and not _has_successful_acceptance(
                    collected_tool_results
                ):
                    missing.append("prepare_acceptance")
                yield _sse(
                    {
                        "event": "error",
                        "error": (
                            f"已达工具轮次安全上限（{max_rounds}），任务仍未完成"
                            + (f"（缺少：{', '.join(missing)}）" if missing else "")
                            + "。可用 AGENT_MAX_TOOL_ROUNDS 调高后重试。"
                        ),
                    }
                )

        if not final_text.strip():
            if require_write and not _implementation_complete(intent, collected_tool_results):
                bits = []
                if not _has_successful_write(collected_tool_results):
                    bits.append("尚未成功写入任何文件")
                elif _is_self_upgrade(intent):
                    bits.append("已写入但未 prepare_acceptance")
                final_text = (
                    "本轮已结束，但**实施未完成**："
                    + "；".join(bits)
                    + "。请展开工具详情核对，新开会话选 skill「本仓库自升级」继续。"
                )
            elif collected_tool_results:
                tools_used = ", ".join(
                    sorted({str(b.get("tool") or "") for b in collected_tool_results if b.get("tool")})
                )
                final_text = (
                    f"本轮工具已执行（{len(collected_tool_results)} 次：{tools_used}），"
                    "但模型没有给出文字总结。请点击上方各轮工具查看参数与结果详情。"
                )
            else:
                final_text = "本轮没有工具调用，也没有生成回复。请换一种说法重试，或指定 skill。"
            yield _sse({"event": "content", "content": final_text})

        entities = _extract_entities_from_tool_results(collected_tool_results)
        if final_text and entities:
            linked = _linkify_content(final_text, entities)
            if linked != final_text:
                yield _sse({"event": "content_linked", "content": linked})
        if entities:
            yield _sse({"event": "entities", "items": entities})
        arts = _extract_artifacts(collected_tool_results)
        if arts:
            yield _sse({"event": "artifacts", "items": arts})

    except Exception as exc:  # noqa: BLE001
        _log.warning("agent run failed: %s", exc)
        yield _sse({"event": "error", "error": str(exc)[:500]})

    yield _sse(
        {
            "event": "done",
            "permission": perm,
            "defaultGrant": "workspace_and_repo",
            "workspacePath": str(ws),
            "toolCalls": len(collected_tool_results),
            "wroteFiles": _has_write_tool(collected_tool_results),
        }
    )
    yield b"data: [DONE]\n\n"
