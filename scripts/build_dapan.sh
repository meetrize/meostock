#!/usr/bin/env bash
# 构建 vendor/a-share-heatmap（Next.js，basePath=/dapan）
# 源码来自 https://github.com/wenyuanw/a-share-heatmap
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/vendor/a-share-heatmap"
MARKER="${SRC}/.mootdx-patched"

if [[ ! -d "${SRC}" ]]; then
  echo "缺少 ${SRC}，正在克隆…"
  mkdir -p "${ROOT}/vendor"
  git clone --depth 1 https://github.com/wenyuanw/a-share-heatmap.git "${SRC}"
fi

cd "${SRC}"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "需要 pnpm（Node >= 20）。可用: npm i -g pnpm"
  exit 1
fi

# 为本仓库挂载到 /dapan 打补丁（可重复执行）
python3 - <<'PY'
from pathlib import Path

root = Path(".").resolve()
marker = root / ".mootdx-patched"

# 1) next.config.ts → basePath
cfg = root / "next.config.ts"
text = cfg.read_text(encoding="utf-8")
if 'basePath: "/dapan"' not in text:
    needle = "const nextConfig: NextConfig = {"
    if needle not in text:
        raise SystemExit("next.config.ts: 未找到 NextConfig 入口，无法打补丁")
    text = text.replace(
        needle,
        needle + '\n  basePath: "/dapan",\n  assetPrefix: "/dapan",',
        1,
    )
    cfg.write_text(text, encoding="utf-8")
    print("patched next.config.ts (basePath=/dapan)")
else:
    print("next.config.ts already patched")

# 2) 绝对路径 fetch / 静态资源 → /dapan 前缀（幂等：跳过已含 /dapan 的）
import re

def prefix_api(s: str) -> str:
    # `/api/heatmap` → `/dapan/api/heatmap`，但不重复前缀
    return re.sub(r'(?<!/dapan)(/api/heatmap)', r'/dapan\1', s)

for path in root.rglob("*"):
    if path.suffix not in {".ts", ".tsx", ".js", ".jsx", ".mjs"}:
        continue
    if "node_modules" in path.parts or ".next" in path.parts:
        continue
    raw = path.read_text(encoding="utf-8")
    new = prefix_api(raw)
    new = new.replace('src="/icon.svg"', 'src="/dapan/icon.svg"')
    new = new.replace("src='/icon.svg'", "src='/dapan/icon.svg'")
    if new != raw:
        path.write_text(new, encoding="utf-8")
        print(f"patched {path.relative_to(root)}")

marker.write_text("basePath=/dapan\n", encoding="utf-8")
print("patch marker written")
PY

if [[ ! -d node_modules ]]; then
  echo "安装依赖…"
  pnpm install --frozen-lockfile
fi

echo "构建 a-share-heatmap（basePath=/dapan）…"
pnpm build

echo "已构建 → ${SRC}/.next"
echo "启动后访问: http://127.0.0.1:8765/dapan/"
echo "（需 run_web.sh 同时拉起 Next 子进程，或手动: PORT=8766 pnpm start）"
