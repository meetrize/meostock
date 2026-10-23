#!/usr/bin/env bash
# 构建 vendor/stock-dashboard → web/static/dashboard（base=/dashboard/）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/vendor/stock-dashboard"
OUT="${ROOT}/web/static/dashboard"

if [[ ! -d "${SRC}" ]]; then
  echo "缺少 ${SRC}，正在克隆…"
  mkdir -p "${ROOT}/vendor"
  git clone --depth 1 https://github.com/chengzuopeng/stock-dashboard.git "${SRC}"
fi

cd "${SRC}"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "需要 pnpm（Node >= 22）。可用: npm i -g pnpm"
  exit 1
fi

if [[ ! -d node_modules ]]; then
  pnpm install --frozen-lockfile
fi

echo "构建 stock-dashboard（base=/dashboard/）…"
VITE_BASE_URL=/dashboard/ pnpm build

rm -rf "${OUT}"
mkdir -p "${OUT}"
cp -R "${SRC}/dist/." "${OUT}/"
# 入口 HTML 加禁止缓存标记，降低「Importing a module script failed」概率
python3 -c "
from pathlib import Path
html = Path('${OUT}') / 'index.html'
text = html.read_text(encoding='utf-8')
meta = '<meta http-equiv=\"Cache-Control\" content=\"no-store\" />\n    '
if 'no-store' not in text:
    text = text.replace('<head>', '<head>\n    ' + meta, 1)
    html.write_text(text, encoding='utf-8')
"
echo "已输出 → ${OUT}"
echo "访问: http://127.0.0.1:8765/dashboard/"
