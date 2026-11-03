#!/usr/bin/env bash
# 一键启动 meostock 全部 Web 服务（FastAPI :8765 + 大盘云图 Next :8766）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

WEB_HOST="${WEB_HOST:-127.0.0.1}"
WEB_PORT="${WEB_PORT:-8765}"
DAPAN_PORT="${DAPAN_PORT:-8766}"
BASE="http://${WEB_HOST}:${WEB_PORT}"

print_banner() {
  cat <<EOF

══════════════════════════════════════════════════════════════
  meostock 一键启动
══════════════════════════════════════════════════════════════

  本脚本会启动：
    • FastAPI  Web 服务     → ${BASE}/
    • 大盘云图 Next.js      → http://127.0.0.1:${DAPAN_PORT}/dapan/
      （经 FastAPI 反代为 ${BASE}/dapan/）

  ── 主要地址 ──────────────────────────────────────────────
    K 线演示      ${BASE}/
    股票看板      ${BASE}/dashboard/
    行情列表      ${BASE}/dashboard/quotes
    大盘云图      ${BASE}/dapan/
    涨停复盘      ${BASE}/fupan
    犀利插件中转  ${BASE}/xnge/

  ── 用法示例 ──────────────────────────────────────────────
    K 线指定标的  ${BASE}/?symbol=600036
    指定周期      ${BASE}/?symbol=600036&period=1d
    港股 / 美股   ${BASE}/?symbol=00700
                  ${BASE}/?symbol=AAPL
    多面板        ${BASE}/multipanel?layout=2x2&symbols=600036,000001&period=1d
    犀利强势股    ${BASE}/xnge/qsg/?hidenav=1&bg=000000

  ── 常用参数 ──────────────────────────────────────────────
    symbol / code / s / ticker   标的代码
    period                       1m 5m 15m 1h 1d 1w

  ── 环境变量（可选）────────────────────────────────────────
    WEB_PORT=8765  DAPAN_PORT=8766
    复制 .env.example → .env 可配置 TUSHARE_TOKEN 等

  Ctrl+C 可同时停止全部服务
══════════════════════════════════════════════════════════════

EOF
}

print_banner

# 端口占用提示（不强制退出，交给子进程报错更直观）
if command -v lsof >/dev/null 2>&1; then
  if lsof -iTCP:"${WEB_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "警告: 端口 ${WEB_PORT} 已被占用，启动可能失败。可先: lsof -iTCP:${WEB_PORT} -sTCP:LISTEN"
  fi
  if lsof -iTCP:"${DAPAN_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "警告: 端口 ${DAPAN_PORT} 已被占用，大盘云图子进程可能失败。"
  fi
fi

# 实际启动逻辑在 run_web.sh（构建检查 + Next + uvicorn）
exec "${ROOT}/run_web.sh"
