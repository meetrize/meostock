"""自升级冒烟封装。"""

from __future__ import annotations

from typing import Any

from agent.tools.shell_ops import run_shell


def run_smoke_test() -> dict[str, Any]:
    result = run_shell("./scripts/agent_smoke_test.sh", cwd_scope="repo", timeout_sec=180.0)
    result["artifact"] = {
        "type": "smoke",
        "ok": bool(result.get("ok")),
        "exitCode": result.get("exitCode"),
    }
    return result
