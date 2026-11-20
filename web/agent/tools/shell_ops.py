"""受限 shell（allowlist）。"""

from __future__ import annotations

import os
import re
import shlex
import subprocess
from typing import Any

from agent.paths import repo_root, workspace_dir

# 仅允许这些「规范化后」的命令前缀（空白压缩后）
_ALLOWED_PREFIXES = (
    "git status",
    "git diff",
    "git log",
    "git add",
    "ls",
    "pwd",
    "python -m py_compile",
    "python3 -m py_compile",
    "./scripts/build_dashboard.sh",
    "./scripts/build_dapan.sh",
    "./scripts/agent_smoke_test.sh",
    "bash ./scripts/build_dashboard.sh",
    "bash ./scripts/build_dapan.sh",
    "bash ./scripts/agent_smoke_test.sh",
)

_FORBIDDEN = re.compile(
    r"(;|\||&|`|\$\(|>|>>|<|rm\s+-rf|curl\s|wget\s|ssh\s|scp\s|chmod\s|chown\s|"
    r"sudo\s|eval\s|source\s|\.\/run_web|uvicorn|kill\s|pkill|nohup)",
    re.IGNORECASE,
)


def _normalize(cmd: str) -> str:
    return re.sub(r"\s+", " ", (cmd or "").strip())


def _allowed(cmd: str) -> bool:
    n = _normalize(cmd)
    if not n or _FORBIDDEN.search(n):
        return False
    # git commit / push 走专用工具
    if n.startswith("git commit") or n.startswith("git push") or n.startswith("git reset"):
        return False
    return any(n == p or n.startswith(p + " ") for p in _ALLOWED_PREFIXES)


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
            "error": "命令不在 allowlist 或含危险字符（git commit/push 请用专用工具）",
            "command": cmd,
        }
    if cwd_scope == "workspace":
        cwd = workspace_dir(session_id)
    else:
        cwd = repo_root()

    to = max(5.0, min(float(timeout_sec or 120), 300.0))
    env = os.environ.copy()
    env["PYTHONPATH"] = f"{repo_root() / 'web'}{os.pathsep}{env.get('PYTHONPATH', '')}"

    try:
        # 用 shell=False + shlex 更安全；但脚本相对路径需要 shell 时用 list
        try:
            argv = shlex.split(cmd)
        except ValueError as exc:
            return {"ok": False, "error": f"命令解析失败: {exc}", "command": cmd}

        proc = subprocess.run(
            argv,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=to,
            env=env,
            check=False,
        )
        out = (proc.stdout or "")[-8000:]
        err = (proc.stderr or "")[-4000:]
        return {
            "ok": proc.returncode == 0,
            "command": cmd,
            "cwd": str(cwd),
            "exitCode": proc.returncode,
            "stdout": out,
            "stderr": err,
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"超时（{to}s）", "command": cmd}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)[:400], "command": cmd}
