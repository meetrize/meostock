"""Agent IDE：按项目根查看 git status / 单文件 diff。"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from agent.ide_fs import project_root
from agent.sandbox import resolve_under

_MAX_DIFF = 200_000


def _run(cwd: Path, argv: list[str], *, timeout: float = 60.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _is_git_repo(root: Path) -> bool:
    return (root / ".git").exists() or _run(root, ["git", "rev-parse", "--is-inside-work-tree"]).returncode == 0


def git_summary(project_id: str | None) -> dict[str, Any]:
    root, proj = project_root(project_id)
    if proj.get("kind") != "repo" and not _is_git_repo(root):
        return {
            "ok": True,
            "isGit": False,
            "projectId": proj.get("id"),
            "branch": None,
            "files": [],
            "message": "当前项目不是 git 仓库",
        }
    if not _is_git_repo(root):
        return {
            "ok": True,
            "isGit": False,
            "projectId": proj.get("id"),
            "branch": None,
            "files": [],
            "message": "未检测到 .git",
        }

    sb = _run(root, ["git", "status", "-sb", "--porcelain"])
    branch = ""
    files: list[dict[str, str]] = []
    for line in (sb.stdout or "").splitlines():
        if line.startswith("##"):
            branch = line[2:].strip()
            continue
        if len(line) < 4:
            continue
        code = line[:2]
        path = line[3:].strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[-1].strip()
        if path:
            files.append({"path": path, "status": code.strip() or "??"})

    return {
        "ok": sb.returncode == 0,
        "isGit": True,
        "projectId": proj.get("id"),
        "branch": branch or None,
        "files": files[:300],
        "stderr": (sb.stderr or "")[:1000] if sb.returncode else "",
    }


def suggest_commit_message(project_id: str | None) -> dict[str, Any]:
    """根据当前 diff 调用 AI 生成简体中文 commit message。"""
    from ai.client import chat_completion

    root, proj = project_root(project_id)
    if not _is_git_repo(root):
        return {"ok": False, "error": "不是 git 仓库"}

    st = _run(root, ["git", "status", "-sb", "--porcelain"])
    diff = _run(root, ["git", "diff", "HEAD"], timeout=90.0)
    # 未跟踪文件列表
    untracked = [
        line[3:].strip()
        for line in (st.stdout or "").splitlines()
        if line.startswith("??")
    ]
    payload = (
        f"branch/status:\n{(st.stdout or '')[:2500]}\n\n"
        f"diff:\n{(diff.stdout or '')[:9000]}\n"
    )
    if untracked:
        payload += "\nuntracked:\n" + "\n".join(untracked[:40])

    messages = [
        {
            "role": "system",
            "content": (
                "你是资深工程师。根据 git 变更写一条简体中文 Conventional Commit 风格的提交说明。"
                "第一行：类型(scope): 摘要（≤50 字）；可选空行后写 1～3 条要点。"
                "只输出 commit message 正文，不要代码块、不要解释。"
            ),
        },
        {"role": "user", "content": payload or "（无 diff，请给一个通用 chore 说明）"},
    ]
    upstream = chat_completion(messages, temperature=0.3, max_tokens=400)
    text = (
        ((upstream.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    ).strip()
    if not text:
        return {"ok": False, "error": "模型未返回内容"}
    # 去掉可能的围栏
    if text.startswith("```"):
        text = text.strip("`").split("\n", 1)[-1].strip()
    return {
        "ok": True,
        "message": text[:2000],
        "projectId": proj.get("id"),
    }


def commit_changes(
    project_id: str | None,
    *,
    message: str,
    do_push: bool = False,
) -> dict[str, Any]:
    """UI 主动提交：add -A → commit → 可选 push。仅 git 仓库。"""
    root, proj = project_root(project_id)
    if not _is_git_repo(root):
        return {"ok": False, "error": "不是 git 仓库"}
    msg = (message or "").strip()
    if not msg:
        return {"ok": False, "error": "缺少 commit message"}

    porcelain = _run(root, ["git", "status", "--porcelain"])
    if not (porcelain.stdout or "").strip():
        return {"ok": False, "error": "没有可提交的变更"}

    add = _run(root, ["git", "add", "-A"])
    if add.returncode != 0:
        return {"ok": False, "error": "git add 失败", "stderr": (add.stderr or "")[:1000]}

    commit = _run(root, ["git", "commit", "-m", msg], timeout=90.0)
    if commit.returncode != 0:
        return {
            "ok": False,
            "error": "git commit 失败",
            "stdout": (commit.stdout or "")[-2000:],
            "stderr": (commit.stderr or "")[-2000:],
        }

    push_out: dict[str, Any] | None = None
    if do_push:
        push = _run(root, ["git", "push"], timeout=120.0)
        push_out = {
            "ok": push.returncode == 0,
            "stdout": (push.stdout or "")[-2000:],
            "stderr": (push.stderr or "")[-2000:],
            "exitCode": push.returncode,
        }
        if push.returncode != 0:
            return {
                "ok": False,
                "committed": True,
                "pushed": False,
                "error": "已 commit，但 push 失败",
                "push": push_out,
                "projectId": proj.get("id"),
            }

    return {
        "ok": True,
        "committed": True,
        "pushed": bool(do_push),
        "push": push_out,
        "projectId": proj.get("id"),
        "message": msg,
    }


def git_file_diff(project_id: str | None, path: str) -> dict[str, Any]:
    root, proj = project_root(project_id)
    rel = (path or "").strip()
    if not rel:
        raise ValueError("缺少 path")
    if not _is_git_repo(root):
        return {"ok": False, "isGit": False, "error": "不是 git 仓库"}

    # 校验路径在项目内（未跟踪文件也允许）
    try:
        resolve_under(root, rel)
    except ValueError as e:
        raise ValueError(str(e)) from e

    unstaged = _run(root, ["git", "diff", "--", rel], timeout=90.0)
    staged = _run(root, ["git", "diff", "--cached", "--", rel], timeout=90.0)
    # 未跟踪：用 /dev/null 对比
    untracked = ""
    target = root / rel
    if target.is_file():
        check = _run(root, ["git", "ls-files", "--error-unmatch", "--", rel])
        if check.returncode != 0:
            show = _run(root, ["git", "diff", "--no-index", "--", "/dev/null", rel], timeout=90.0)
            # git diff --no-index 在有差异时 exit 1
            untracked = show.stdout or ""

    parts: list[str] = []
    if (staged.stdout or "").strip():
        parts.append("### staged\n" + (staged.stdout or ""))
    if (unstaged.stdout or "").strip():
        parts.append("### unstaged\n" + (unstaged.stdout or ""))
    if untracked.strip():
        parts.append("### untracked\n" + untracked)

    diff = "\n".join(parts).strip()
    truncated = len(diff) > _MAX_DIFF
    if truncated:
        diff = diff[:_MAX_DIFF]

    if not diff:
        # 可能是删除或仅状态变化
        diff = f"（无文本 diff 可预览）\npath: {rel}\n"

    return {
        "ok": True,
        "isGit": True,
        "projectId": proj.get("id"),
        "path": rel,
        "diff": diff,
        "truncated": truncated,
    }
