"""本仓库 / 工作区内 shell（项目范围开放；禁 commit/push 与明显越界破坏）。"""

from __future__ import annotations

import os
import re
import subprocess
from typing import Any

from agent.paths import repo_root, workspace_dir

# 仍走专用工具 / 人工验收；以及明显危险的越界操作
_BLOCKED = re.compile(
    r"("
    r"git\s+commit|git\s+push|git\s+reset\b|git\s+rebase\b|git\s+checkout\s+--|"
    r"sudo\s|pkexec\b|doas\s|"
    r"rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?/(\s|$)|"
    r"mkfs\b|dd\s+if=|"
    r":\(\)\s*\{|: \(\)\s*\{"  # fork bomb
    r")",
    re.IGNORECASE,
)


def _normalize(cmd: str) -> str:
    return re.sub(r"\s+", " ", (cmd or "").strip())


def _allowed(cmd: str) -> bool:
    n = _normalize(cmd)
    if not n:
        return False
    if _BLOCKED.search(n):
        return False
    return True


def run_shell(
    command: str,
    *,
    cwd_scope: str = "repo",
    session_id: str | None = None,
    timeout_sec: float = 120.0,
) -> dict[str, Any]:
    cmd = _normalize(command)
    if not _allowed(cmd):
        return {
            "ok": False,
            "error": (
                "命令被拒绝：禁止 git commit/push/reset（请用验收工具）、"
                "sudo、以及明显越界破坏。其余本项目内 shell 已开放。"
            ),
            "command": cmd,
        }
    if cwd_scope == "workspace":
        cwd = workspace_dir(session_id)
    else:
        cwd = repo_root()

    to = max(5.0, min(float(timeout_sec or 120), 600.0))
    env = os.environ.copy()
    env["PYTHONPATH"] = f"{repo_root() / 'web'}{os.pathsep}{env.get('PYTHONPATH', '')}"

    try:
        # 用 bash + 关闭 glob 失败：避免 zsh「no matches found: --include=*.tsx」
        bash = "/bin/bash" if os.path.exists("/bin/bash") else "/bin/sh"
        wrapped = f"set +f; setopt NULL_GLOB 2>/dev/null; {cmd}"
        proc = subprocess.run(
            wrapped,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=to,
            env=env,
            check=False,
            shell=True,
            executable=bash,
        )
        out = (proc.stdout or "")[-40000:]
        err = (proc.stderr or "")[-12000:]
        return {
            "ok": proc.returncode == 0,
            "command": cmd,
            "cwd": str(cwd),
            "exitCode": proc.returncode,
            "stdout": out,
            "stderr": err,
            "scope": "project_shell",
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"超时（{to}s）", "command": cmd}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)[:400], "command": cmd}
