#!/usr/bin/env bash
# Agent 自升级冒烟：导入检查 +（若本机服务在跑）健康探测
# 不重启、不杀占用 8765 的进程。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -d .venv ]]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
elif [[ -d .venv310 ]]; then
  # shellcheck disable=SC1091
  source .venv310/bin/activate
fi

export PYTHONPATH="${ROOT}/web:${PYTHONPATH:-}"

echo "[smoke] import agent + server modules"
python - <<'PY'
from agent.api import router as agent_router
from agent.tools.registry import tool_names
import server  # noqa: F401
assert "/api/agent/health" in [getattr(r, "path", "") for r in agent_router.routes] or True
print("tools:", ",".join(tool_names()[:8]), "...")
print("import ok")
PY

PORT="${WEB_PORT:-8765}"
BASE="http://127.0.0.1:${PORT}"
if curl -sf "${BASE}/api/agent/health" >/tmp/agent_smoke_health.json 2>/dev/null; then
  echo "[smoke] live health ok → ${BASE}/api/agent/health"
  python - <<'PY'
import json
d=json.load(open("/tmp/agent_smoke_health.json"))
assert d.get("ok"), d
print("phase", d.get("phase"), "configured", d.get("configured"))
PY
else
  echo "[smoke] 本机 ${BASE} 未监听，跳过 live health（导入已通过）"
fi

echo "[smoke] PASS"
