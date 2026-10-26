# meostock（行情数据实验项目）

本项目用于验证、对比多种行情数据源，并提供 Web K 线 / 看板 / 大盘云图演示。

仓库：<https://github.com/meetrize/meostock>

> 仅供学习交流，不得用于商业用途。

## 快速开始（安装 · 编译 · 部署）

### 1. 环境要求

| 组件 | 版本 | 用途 |
|------|------|------|
| Python | 3.10+（推荐） | FastAPI Web 服务、mootdx 示例 |
| Node.js | ≥ 22.12（看板）；≥ 20（大盘云图） | 前端构建 |
| pnpm | 10.x（随各 `package.json` 的 `packageManager`） | 安装/构建前端 |

```bash
git clone https://github.com/meetrize/meostock.git
cd meostock
```

### 2. 安装 Python 依赖

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

pip install -U pip
pip install -r requirements.txt
# 可选增强：pip install 'mootdx2'   # 建议 Python 3.10+
```

### 3. 编译前端（换机必做）

定制看板与大盘云图源码在 **`apps/`**（已纳入 Git），**不是**旧的 `vendor/`（已被忽略，勿再改那里）。

```bash
# 看板 → web/static/dashboard/（Vite，base=/dashboard/）
./scripts/build_dashboard.sh

# 大盘云图 → apps/a-share-heatmap/.next（Next.js，basePath=/dapan）
./scripts/build_dapan.sh
```

无 pnpm 时：`npm i -g pnpm`。

根目录还可按需安装 Node 依赖，用于打包 `web/static/stock-sdk.mjs`（`run_web.sh` 缺失时会自动处理）：

```bash
npm install
```

### 4. 本地部署 / 启动

```bash
./run_web.sh
```

| 地址 | 说明 |
|------|------|
| http://127.0.0.1:8765/ | K 线演示 |
| http://127.0.0.1:8765/dashboard/ | 股票看板（本仓库定制版） |
| http://127.0.0.1:8765/dapan/ | 大盘云图（反代到本机 :8766） |
| http://127.0.0.1:8765/dashboard/quotes | 行情列表（本地 SQLite 缓存） |
| http://127.0.0.1:8765/fupan | 涨停复盘 Demo |
| http://127.0.0.1:8765/xnge/ | 犀利插件中转 |

`run_web.sh` 会：

1. 缺 `stock-sdk.mjs` 时自动用 esbuild 打包  
2. 缺看板产物时自动跑 `build_dashboard.sh`  
3. 缺大盘云图 `.next` 时自动跑 `build_dapan.sh`  
4. 启动 Next（:8766）+ FastAPI（:8765）

**日常改看板源码后**，请重新执行 `./scripts/build_dashboard.sh` 再刷新浏览器。

### 5. 仓库目录（源码放哪）

```text
apps/
  stock-dashboard/     # 看板 React/Vite 源码（改这里）
  a-share-heatmap/     # 大盘云图 Next.js 源码（已含 /dapan 补丁）
web/
  server.py            # FastAPI 入口
  cache/               # 行情本地缓存
  static/              # 静态页与看板构建产物
scripts/
  build_dashboard.sh
  build_dapan.sh
requirements.txt
run_web.sh
```

| 路径 | 是否进 Git | 说明 |
|------|------------|------|
| `apps/stock-dashboard/` | ✅ | 定制看板源码 |
| `apps/a-share-heatmap/` | ✅ | 大盘云图源码 |
| `web/static/dashboard/` 中 `index.html` 等 | ✅ | 入口壳 |
| `web/static/dashboard/assets/` | ❌ | 构建哈希资源，需本地编译生成 |
| `apps/*/node_modules`、`dist`、`.next` | ❌ | 依赖与构建产物 |
| `vendor/` | ❌ | **已废弃**；历史本地目录，请改用 `apps/` |

---

## 数据源

| 包名 | 地址 | 简介 |
|------|------|------|
| **stock-sdk**（Web 演示主源） | [GitHub](https://github.com/chengzuopeng/stock-sdk) · [NPM](https://www.npmjs.com/package/stock-sdk) | 前端 / Node.js 零依赖股票 SDK；A / 港 / 美 / 基金。 |
| **mootdx** | [PyPI](https://pypi.org/project/mootdx/) | 通达信数据读取封装。 |
| **mootdx2** | [PyPI](https://pypi.org/project/mootdx2/) | 通达信增强版（离线优先日 K、复权等）。 |

- stock-sdk 文档：<https://stock-sdk.linkdiary.cn>
- mootdx 文档：<https://www.mootdx.com>

## mootdx 简单用法

### 线上行情

```python
from mootdx.quotes import Quotes

client = Quotes.factory(market="std", multithread=True, heartbeat=False)
client.quotes(symbol="600036")
client.minute(symbol="600036")          # 当日分时（取现价推荐）
client.bars(symbol="600036", frequency=9, offset=10)
client.close()
```

**注意：** `client.minutes(symbol=...)` 若不传 `date`，库默认历史日 `'20191023'`。取当前股价请用 `minute()`，或显式传入今天：

```python
from datetime import datetime

today = datetime.now().strftime("%Y%m%d")
client.minutes(symbol="600036", date=today)
```

离线读取（需本机通达信目录）：

```python
from mootdx.reader import Reader

reader = Reader.factory(market="std", tdxdir="/path/to/tdx")
reader.daily(symbol="600036")
```

### mootdx2 示例

```python
from mootdx2.quotes import Quotes

client = Quotes.factory(market="std")
print(client.quotes(symbol="600036"))
print(client.bars(symbol="600036", frequency=9, offset=10, adjust="qfq"))
client.close()
```

```python
from mootdx2 import DailyDataManager

manager = DailyDataManager()
df = manager.get_daily(
    symbol="600036",
    start="2024-01-01",
    end="2024-12-31",
    adjust="qfq",
    auto_download=True,
)
print(df.tail())
```

## Web 功能说明

### 犀利插件中转（`t.xnge.cn`）

通达信插件页在系统浏览器会因缺少 UA `TdxW` 被拒。本地中转会带通达信 CEF UA、替换 `##tdxbkcolor##`，并按路径透传：

**格式：** `http://127.0.0.1:8765/xnge/<路径>/?hidenav=1&bg=000000`

| 名称 | 本地中转 | 原站（通达信内） |
|------|----------|------------------|
| 强势股 | [/xnge/qsg/?hidenav=1&bg=000000](http://127.0.0.1:8765/xnge/qsg/?hidenav=1&bg=000000) | `http://t.xnge.cn/qsg/?bg=##tdxbkcolor##&hidenav=1` |
| 连板天梯 | [/xnge/jieli/?hidenav=1&bg=000000](http://127.0.0.1:8765/xnge/jieli/?hidenav=1&bg=000000) | `http://t.xnge.cn/jieli/?hidenav=1&bg=##tdxbkcolor##` |
| 人气股 | [/xnge/rank/?hidenav=1&bg=000000](http://127.0.0.1:8765/xnge/rank/?hidenav=1&bg=000000) | `http://t.xnge.cn/rank/?bg=##tdxbkcolor##&hidenav=1` |
| 涨停复盘（原站） | [/xnge/fupan/?hidenav=1&bg=000000](http://127.0.0.1:8765/xnge/fupan/?hidenav=1&bg=000000) | `http://t.xnge.cn/fupan/?hidenav=1&bg=##tdxbkcolor##` |
| 涨停复盘（本地 Demo） | [/fupan](http://127.0.0.1:8765/fupan) | — |

目录页 http://127.0.0.1:8765/xnge/ ；旧地址 `/api/zt/xnge-proxy` 会 307 到 `/xnge/fupan/`。

### 行情本地缓存

看板「行情」页由本机 **SQLite**（`data/quote_cache.db`）加速。K 线页走 L3 `kline_bar`（`GET /api/cache/kline`）。

| 模式 | 行为 |
|------|------|
| `speed` | 优先读盘 |
| `balanced`（默认） | 先出缓存，盘中约 45s 后台同步 |
| `realtime` | 更勤强制同步 |

设计见 `docs/local-quote-cache.md`。

### URL 直达

| 示例 | 说明 |
|------|------|
| `http://127.0.0.1:8765/?symbol=600036` | A 股 |
| `http://127.0.0.1:8765/?symbol=00700` | 港股 |
| `http://127.0.0.1:8765/?symbol=AAPL` | 美股 |
| `http://127.0.0.1:8765/multipanel?layout=2x2&symbols=600036,000001&period=1d` | 多面板 |
| `http://127.0.0.1:8765/?symbol=600036&period=1d` | 指定周期 |

参数别名：`symbol` / `code` / `s` / `ticker`；`period`：`1m` `5m` `15m` `1h` `1d` `1w`。

## 本仓库脚本

| 文件 | 说明 |
|------|------|
| `run_web.sh` | 启动 Web（含大盘云图子进程） |
| `scripts/build_dashboard.sh` | 编译看板 |
| `scripts/build_dapan.sh` | 编译大盘云图 |
| `sample_quotes.py` / `run_sample_quotes.sh` | mootdx 取价示例 |
| `test_600036.py` / `run_test.sh` | 连通性测试 |

```bash
./run_sample_quotes.sh          # 默认 600036
./run_sample_quotes.sh 300986
./run_test.sh
./run_web.sh
```

## 参考链接

- [stock-sdk](https://github.com/chengzuopeng/stock-sdk) · [文档](https://stock-sdk.linkdiary.cn) · [NPM](https://www.npmjs.com/package/stock-sdk)
- [stock-dashboard](https://github.com/chengzuopeng/stock-dashboard)（上游；本仓库定制在 `apps/stock-dashboard`）
- [a-share-heatmap](https://github.com/wenyuanw/a-share-heatmap) · [dapan.app](https://dapan.app)
- [mootdx · PyPI](https://pypi.org/project/mootdx/) · [mootdx2 · PyPI](https://pypi.org/project/mootdx2/)
- [KLineChart](https://github.com/klinecharts/KLineChart)
