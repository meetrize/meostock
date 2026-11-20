"""本仓库 / 工作区内 shell（项目范围开放；禁 commit/push 与明显越界破坏）。

支持 mode=build_only：自升级收尾阶段只允许构建/冒烟脚本，禁止 grep/sed 空转。
"""

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

# 收尾阶段允许的命令（整句匹配或前缀）
_BUILD_ONLY_PREFIXES = (
    "./scripts/build_dashboard.sh",
    "./scripts/build_dapan.sh",
    "./scripts/agent_smoke_test.sh",
    "bash ./scripts/build_dashboard.sh",
    "bash ./scripts/build_dapan.sh",
    "bash ./scripts/agent_smoke_test.sh",
    "git status",
    "git diff",
    "git log",
)


def _flat(cmd: str) -> str:
    """仅用于安全检查的单行视图；不用于实际执行。"""
    return re.sub(r"\s+", " ", (cmd or "").strip())


def _allowed(cmd: str) -> bool:
    n = _flat(cmd)
    if not n:
        return False
    if _BLOCKED.search(n):
        return False
    return True


def _allowed_build_only(cmd: str) -> bool:
    n = _flat(cmd)
    if not n or not _allowed(cmd):
        return False
    # 收尾禁止探索类命令
    if re.search(r"\b(grep|rg|sed|awk|find|perl)\b", n):
        return False
    if re.search(r"\bpython3?\b|\bnode\b", n):
        return False
    for p in _BUILD_ONLY_PREFIXES:
        if n == p or n.startswith(p + " ") or n.startswith(p + "|"):
            return True
        # 允许：./scripts/build_dashboard.sh 2>&1 | tail -25
        if p.startswith("./scripts/") and p in n and "./scripts/" in n:
            return True
    return False


def run_shell(
    command: str,
    *,
    cwd_scope: str = "repo",
    session_id: str | None = None,
    timeout_sec: float = 120.0,
    mode: str | None = None,
) -> dict[str, Any]:
    # 保留换行：heredoc / 多行脚本不能被压成一行
    cmd = (command or "").strip()
    if not cmd:
        return {"ok": False, "error": "空命令", "command": cmd}

    mode_l = (mode or "").strip().lower()
    if mode_l == "build_only":
        if not _allowed_build_only(cmd):
            return {
                "ok": False,
                "error": (
                    "收尾阶段 shell 仅允许："
                    "./scripts/build_dashboard.sh、agent_smoke_test.sh、git status/diff。"
                    "禁止 grep/sed/python 探索；请直接 prepare_acceptance。"
                ),
                "command": _flat(cmd),
                "mode": "build_only",
            }
    elif not _allowed(cmd):
        return {
            "ok": False,
            "error": (
                "命令被拒绝：禁止 git commit/push/reset（请用验收工具）、"
                "sudo、以及明显越界破坏。其余本项目内 shell 已开放。"
            ),
            "command": _flat(cmd),
        }

    if cwd_scope == "workspace":
        cwd = workspace_dir(session_id)
    else:
        cwd = repo_root()

    to = max(5.0, min(float(timeout_sec or 120), 600.0))
    env = os.environ.copy()
    env["PYTHONPATH"] = f"{repo_root() / 'web'}{os.pathsep}{env.get('PYTHONPATH', '')}"

    try:
        bash = "/bin/bash" if os.path.exists("/bin/bash") else "/bin/sh"
        # set +f：关闭 pathname expansion，避免 *.tsx 被吞
        wrapped = f"set +f\n{cmd}"
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
            "command": cmd if len(cmd) < 500 else cmd[:500] + "…",
            "cwd": str(cwd),
            "exitCode": proc.returncode,
            "stdout": out,
            "stderr": err,
            "scope": "project_shell",
            "mode": mode_l or "open",
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"超时（{to}s）", "command": _flat(cmd)[:200]}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)[:400], "command": _flat(cmd)[:200]}
