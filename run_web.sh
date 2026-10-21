#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# 前端依赖：stock-sdk（已打包到 web/static/stock-sdk.mjs）
if [[ ! -f web/static/stock-sdk.mjs ]]; then
  echo "缺少 web/static/stock-sdk.mjs，正在安装并打包…"
  npm install stock-sdk@2.4.6 esbuild --no-fund --no-audit
  npx esbuild node_modules/stock-sdk/dist/index.js \
    --bundle --format=esm --platform=browser \
    --outfile=web/static/stock-sdk.mjs
fi

# 静态服务可用任意带 uvicorn 的环境；优先 .venv310，其次 .venv
if [[ -d .venv310 ]]; then
  # shellcheck disable=SC1091
  source .venv310/bin/activate
elif [[ -d .venv ]]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
else
  echo "未找到虚拟环境，使用系统 Python 启动（需已安装 fastapi uvicorn）"
fi

python - <<'PY' >/dev/null 2>&1 || pip install -q fastapi uvicorn yfinance
import fastapi, uvicorn
try:
    import yfinance  # noqa: F401
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "yfinance"])
PY

export PYTHONPATH="${ROOT}/web:${PYTHONPATH:-}"
cd "${ROOT}/web"
echo "启动 Web K 线演示（stock-sdk）: http://127.0.0.1:8765"
exec python -m uvicorn server:app --host 127.0.0.1 --port 8765
