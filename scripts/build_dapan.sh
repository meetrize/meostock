#!/usr/bin/env bash
# 构建 apps/a-share-heatmap（Next.js，basePath=/dapan）
# 上游：https://github.com/wenyuanw/a-share-heatmap（本仓库已含 /dapan 挂载补丁）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/apps/a-share-heatmap"

if [[ ! -d "${SRC}" || ! -f "${SRC}/package.json" ]]; then
  echo "缺少大盘云图源码: ${SRC}"
  echo "请从 Git 克隆完整仓库（源码在 apps/a-share-heatmap）。"
  exit 1
fi

cd "${SRC}"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "需要 pnpm（Node >= 20）。可用: npm i -g pnpm"
  exit 1
fi

# 幂等补丁：确保 basePath=/dapan（已入库源码一般已打过）
python3 - <<'PY'
from pathlib import Path
import re

root = Path(".").resolve()
marker = root / ".mootdx-patched"

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


def prefix_api(s: str) -> str:
    return re.sub(r"(?<!/dapan)(/api/heatmap)", r"/dapan\1", s)


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
