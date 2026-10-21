#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

VENV="${ROOT}/.venv310"
if [[ ! -d "$VENV" ]]; then
  echo "未找到 .venv310，请先运行 ./run_web.sh 或自行创建 Python 3.10+ 虚拟环境并安装 mootdx2"
  exit 1
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"
python test_ext_markets.py
