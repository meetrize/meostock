#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  echo "未找到 .venv，请先创建虚拟环境并安装 mootdx"
  exit 1
fi

# shellcheck disable=SC1091
source .venv/bin/activate
python sample_quotes.py "$@"
