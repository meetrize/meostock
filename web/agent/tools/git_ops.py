"""Git 状态 / diff / 受控 commit+push。"""

from __future__ import annotations

import subprocess
from typing import Any

from agent.acceptance import get_acceptance, update_acceptance
from agent.paths import repo_root


def _run(argv: list[str], *, timeout: float = 60.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        cwd=str(repo_root()),
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def git_status() -> dict[str, Any]:
    proc = _run(["git", "status", "--short", "--branch"])
    return {
        "ok": proc.returncode == 0,
        "stdout": (proc.stdout or "")[-6000:],
        "stderr": (proc.stderr or "")[-2000:],
        "exitCode": proc.returncode,
    }


def git_diff(*, staged: bool = False, max_chars: int = 12000) -> dict[str, Any]:
    argv = ["git", "diff", "--stat"]
    if staged:
        argv = ["git", "diff", "--cached", "--stat"]
    stat = _run(argv)
    argv2 = ["git", "diff"]
    if staged:
        argv2 = ["git", "diff", "--cached"]
    full = _run(argv2, timeout=90.0)
    diff = full.stdout or ""
    truncated = len(diff) > max_chars
    return {
        "ok": full.returncode == 0,
        "stat": (stat.stdout or "")[:4000],
        "diff": diff[:max_chars],
        "truncated": truncated,
        "exitCode": full.returncode,
        "stderr": (full.stderr or "")[:2000],
    }


def changed_files() -> list[str]:
    proc = _run(["git", "status", "--porcelain"])
    files: list[str] = []
    for line in (proc.stdout or "").splitlines():
        if len(line) < 4:
            continue
        path = line[3:].strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[-1].strip()
        if path:
            files.append(path)
    return files[:200]


def prepare_acceptance_bundle(
    *,
    session_id: str | None,
    summary: str,
    commit_message: str,
) -> dict[str, Any]:
    from agent.acceptance import create_acceptance

    st = git_status()
    diff = git_diff()
    files = changed_files()
    msg = (commit_message or "").strip()
    if not msg:
        msg = "chore: agent 自升级改动\n\n由 AI Agent 准备，待人工验收后提交。"
    rec = create_acceptance(
        session_id=session_id,
        summary=summary or "本仓库改动待验收",
        commit_message=msg,
        files=files,
        diff_stat=str(diff.get("stat") or st.get("stdout") or ""),
    )
    return {
        "ok": True,
        "acceptance": {
            "id": rec["id"],
            "status": rec["status"],
            "summary": rec["summary"],
            "commitMessage": rec["commitMessage"],
            "files": rec["files"],
            "diffStat": rec["diffStat"],
        },
        "hint": "请在 UI 点击「验收通过并提交」或「驳回」；未验收不可 push。",
    }


def finalize_acceptance(aid: str, *, do_push: bool = True) -> dict[str, Any]:
    rec = get_acceptance(aid)
    if not rec:
        return {"ok": False, "error": "验收单不存在"}
    if rec.get("status") == "finalized":
        return {"ok": True, "already": True, "result": rec.get("finalizeResult")}
    if rec.get("status") != "approved":
        return {"ok": False, "error": f"状态为 {rec.get('status')}，需先人工批准"}

    msg = str(rec.get("commitMessage") or "").strip()
    if not msg:
        return {"ok": False, "error": "缺少 commit message"}

    add = _run(["git", "add", "-A"])
    if add.returncode != 0:
        return {"ok": False, "error": "git add 失败", "stderr": (add.stderr or "")[:1000]}

    # 无改动
    porcelain = _run(["git", "status", "--porcelain"])
    if not (porcelain.stdout or "").strip():
        update_acceptance(aid, status="finalized", finalizeResult={"ok": True, "skipped": "无改动可提交"})
        return {"ok": True, "skipped": "无改动可提交"}

    commit = _run(["git", "commit", "-m", msg], timeout=90.0)
    if commit.returncode != 0:
        return {
            "ok": False,
            "error": "git commit 失败",
            "stdout": (commit.stdout or "")[-2000:],
            "stderr": (commit.stderr or "")[-2000:],
        }

    push_out: dict[str, Any] | None = None
    if do_push:
        push = _run(["git", "push"], timeout=120.0)
        push_out = {
            "ok": push.returncode == 0,
            "stdout": (push.stdout or "")[-2000:],
            "stderr": (push.stderr or "")[-2000:],
            "exitCode": push.returncode,
        }
        if push.returncode != 0:
            # commit 已成功，记录部分成功
            result = {
                "ok": False,
                "committed": True,
                "pushed": False,
                "commitStdout": (commit.stdout or "")[-2000:],
                "push": push_out,
            }
            update_acceptance(aid, finalizeResult=result)
            return result

    result = {
        "ok": True,
        "committed": True,
        "pushed": bool(do_push),
        "commitStdout": (commit.stdout or "")[-2000:],
        "push": push_out,
    }
    update_acceptance(aid, status="finalized", finalizeResult=result)
    return result
