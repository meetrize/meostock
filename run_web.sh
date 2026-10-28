#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

DAPAN_PORT="${DAPAN_PORT:-8766}"
DAPAN_PID=""

cleanup() {
  if [[ -n "${DAPAN_PID}" ]] && kill -0 "${DAPAN_PID}" 2>/dev/null; then
    kill "${DAPAN_PID}" 2>/dev/null || true
    wait "${DAPAN_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# 前端依赖：stock-sdk（已打包到 web/static/stock-sdk.mjs）
if [[ ! -f web/static/stock-sdk.mjs ]]; then
  echo "缺少 web/static/stock-sdk.mjs，正在安装并打包…"
  npm install stock-sdk@2.4.6 esbuild --no-fund --no-audit
  npx esbuild node_modules/stock-sdk/dist/index.js \
    --bundle --format=esm --platform=browser \
    --outfile=web/static/stock-sdk.mjs
fi

# stock-dashboard（另一页面：/dashboard/）
if [[ ! -f web/static/dashboard/index.html ]]; then
  echo "缺少 stock-dashboard 构建产物，正在构建…"
  "${ROOT}/scripts/build_dashboard.sh"
fi

# a-share-heatmap 大盘云图（/dapan/ → Next.js :8766）
DAPAN_SRC="${ROOT}/apps/a-share-heatmap"
if [[ ! -d "${DAPAN_SRC}/.next" ]]; then
  echo "缺少大盘云图构建产物，正在构建…"
  "${ROOT}/scripts/build_dapan.sh"
fi

if [[ -d "${DAPAN_SRC}/.next" ]]; then
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "警告: 未找到 pnpm，跳过大盘云图子进程（/dapan/ 将返回 503）"
  else
    echo "启动大盘云图 Next.js → http://127.0.0.1:${DAPAN_PORT}/dapan/"
    (
      cd "${DAPAN_SRC}"
      pnpm exec next start --hostname 127.0.0.1 --port "${DAPAN_PORT}"
    ) &
    DAPAN_PID=$!
    export DAPAN_UPSTREAM="http://127.0.0.1:${DAPAN_PORT}"
    # 等 Next 就绪（最多约 60s）
    for _ in $(seq 1 60); do
      if curl -sf -o /dev/null "http://127.0.0.1:${DAPAN_PORT}/dapan/" 2>/dev/null; then
        echo "大盘云图已就绪"
        break
      fi
      if ! kill -0 "${DAPAN_PID}" 2>/dev/null; then
        echo "警告: 大盘云图进程已退出，/dapan/ 将返回 503"
        DAPAN_PID=""
        break
      fi
      sleep 1
    done
  fi
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
import subprocess
import sys

import fastapi, uvicorn  # noqa: F401

try:
    import yfinance  # noqa: F401
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "yfinance"])

# Python < 3.10：Pydantic 解析 list[str] | None 需要 backport，否则 /api/cache/* 整组禁用
if sys.version_info < (3, 10):
    try:
        import eval_type_backport  # noqa: F401
    except ImportError:
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "-q", "eval_type_backport"]
        )
PY

# 加载本地 .env（TUSHARE_TOKEN 等）；不覆盖已导出变量
if [[ -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
fi

export PYTHONPATH="${ROOT}/web:${PYTHONPATH:-}"
cd "${ROOT}/web"
echo "启动 Web 演示（stock-sdk）:"
echo "  K 线:     http://127.0.0.1:8765/"
echo "  看板:     http://127.0.0.1:8765/dashboard/"
echo "  大盘云图: http://127.0.0.1:8765/dapan/"
echo "  涨停复盘: http://127.0.0.1:8765/fupan"
echo "  插件中转: http://127.0.0.1:8765/xnge/"
# 不用 exec，以便 EXIT trap 能停掉大盘云图子进程
python -m uvicorn server:app --host 127.0.0.1 --port 8765
