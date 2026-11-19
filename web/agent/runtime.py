"""Agent 工具循环 + SSE 事件生成。"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any, Iterator

from ai import config as ai_config
from ai.client import chat_completion
from agent.intent import resolve_intent
from agent.paths import workspace_dir
from agent.tools.registry import TOOL_DEFS, execute_tool

_log = logging.getLogger("agent.runtime")

_SYSTEM_BASE = (
    "你是 meostock 看板里的 AI Agent（本机投研与工程副驾驶）。用简洁专业的中文回答。\n"
    "权限默认档 workspace_and_repo：按本轮 intent 开放 L0/L1/L2 工具；禁止改数据库与任意 shell。\n"
    "需要事实或改文件时必须调用工具，禁止编造。\n"
    "提到股票或商品时尽量带上代码与名称；不提供买卖指令或收益承诺。\n"
    "自升级时：改完必须 run_smoke_test，再 prepare_acceptance；禁止自行 commit/push。"
)


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
        "tool_choice": "auto",
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
    perm = str(intent.get("permission") or "L0")
    ws = workspace_dir(session_id)
    yield _sse(
        {
            "event": "intent",
            "intent": intent["intent"],
            "skillId": intent.get("skillId"),
            "permission": perm,
            "source": intent.get("source"),
            "workspacePath": str(ws),
        }
    )

    system_parts = [
        _SYSTEM_BASE,
        f"【本轮权限】{perm}",
        f"【会话工作区】{ws}",
    ]
    if intent.get("systemExtra"):
        system_parts.append(str(intent["systemExtra"]))
    system = "\n\n".join(system_parts)

    tools = _filter_tools(intent.get("tools"))
    tool_ctx = {"session_id": session_id}
    working: list[dict[str, Any]] = [{"role": "system", "content": system}, *history]
    collected_tool_results: list[dict[str, Any]] = []
    final_text = ""
    max_rounds = int(intent.get("maxRounds") or 6)

    try:
        for _round in range(max_rounds):
            upstream = _chat_with_tools(working, tools, cfg=cfg)
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
                for tc in tool_calls:
                    fn = (tc.get("function") or {}) if isinstance(tc, dict) else {}
                    name = str(fn.get("name") or "")
                    raw_args = fn.get("arguments") or "{}"
                    tc_id = str(tc.get("id") or name)
                    yield _sse({"event": "tool_start", "tool": name, "id": tc_id, "arguments": raw_args})
                    result = execute_tool(name, raw_args, context=tool_ctx)
                    collected_tool_results.append({"tool": name, "result": result})
                    result_text = json.dumps(result, ensure_ascii=False)
                    if len(result_text) > 12000:
                        result_text = result_text[:12000] + "…(truncated)"
                    yield _sse(
                        {
                            "event": "tool_result",
                            "tool": name,
                            "id": tc_id,
                            "result": result
                            if len(json.dumps(result, ensure_ascii=False)) < 8000
                            else {"ok": result.get("ok"), "truncated": True, "preview": result_text[:2000]},
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
                continue

            if content:
                final_text = content
                yield _sse({"event": "content", "content": content})
                break

            if collected_tool_results:
                working.append(
                    {
                        "role": "user",
                        "content": "请基于以上工具结果给出最终中文回答；表格用 markdown；列出产物路径。",
                    }
                )
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
            break
        else:
            yield _sse({"event": "error", "error": "工具调用轮次过多，已停止"})

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
        }
    )
    yield b"data: [DONE]\n\n"
