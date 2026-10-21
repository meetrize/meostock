# 行情数据实验项目

本项目用于验证、对比多种行情数据源，并提供 Web K 线演示。

> 仅供学习交流，不得用于商业用途。

## 数据源

| 包名 | 地址 | 简介 |
|------|------|------|
| **stock-sdk**（Web 演示主源） | [GitHub](https://github.com/chengzuopeng/stock-sdk) · [NPM](https://www.npmjs.com/package/stock-sdk) | 前端 / Node.js 零依赖股票 SDK，支持 A 股 / 港股 / 美股 / 基金；浏览器可直接取行情与 K 线。 |
| **mootdx** | [PyPI](https://pypi.org/project/mootdx/) | 通达信数据读取的简便封装（离线目录 / 线上行情 / 财务）。 |
| **mootdx2** | [PyPI](https://pypi.org/project/mootdx2/) | 通达信增强版（离线优先日 K、复权、巨潮公告等）。 |

- stock-sdk 文档：<https://stock-sdk.linkdiary.cn>
- mootdx 文档：<https://www.mootdx.com>

## 环境准备

```bash
cd /path/to/mootdx
python3 -m venv .venv
source .venv/bin/activate

pip install -U pip
pip install 'mootdx'
pip install 'mootdx2'
```

> 说明：`mootdx2` 部分类型注解在较新语法下编写，建议使用 **Python 3.10+**；本仓库示例目前主要基于 `mootdx`（Python 3.9 可用）。

## 简单用法

### 1. mootdx — 线上行情

```python
from mootdx.quotes import Quotes

client = Quotes.factory(market="std", multithread=True, heartbeat=False)

# 实时行情（部分主站可能返回空）
client.quotes(symbol="600036")

# 当日分时（取现价推荐用这个；内部会带上今天的日期）
client.minute(symbol="600036")

# 日 K（frequency=9 为日线）
client.bars(symbol="600036", frequency=9, offset=10)

client.close()
```

**注意：** `client.minutes(symbol=...)` 若不传 `date`，库默认是历史日 `'20191023'`，不是今天。取当前股价请用 `minute()`，或显式传入今天：

```python
from datetime import datetime

today = datetime.now().strftime("%Y%m%d")
client.minutes(symbol="600036", date=today)
```

离线读取（需本机通达信数据目录）：

```python
from mootdx.reader import Reader

reader = Reader.factory(market="std", tdxdir="/path/to/tdx")
reader.daily(symbol="600036")
```

### 2. mootdx2 — 增强能力（示例）

接口风格与 `mootdx` 相近，可按同样方式拉线上行情：

```python
from mootdx2.quotes import Quotes

client = Quotes.factory(market="std")
print(client.quotes(symbol="600036"))
print(client.bars(symbol="600036", frequency=9, offset=10, adjust="qfq"))
client.close()
```

日 K 离线优先（本地通达信目录 + 缺失时自动补齐）：

```python
from mootdx2 import DailyDataManager

manager = DailyDataManager()  # 或指定 tdxdir="..."
df = manager.get_daily(
    symbol="600036",
    start="2024-01-01",
    end="2024-12-31",
    adjust="qfq",
    auto_download=True,
)
print(df.tail())
```

## Web 演示

同一 FastAPI 服务托管前端页面，行情主源为 **[stock-sdk](https://github.com/chengzuopeng/stock-sdk)**：

| 地址 | 说明 |
|------|------|
| http://127.0.0.1:8765/ | K 线演示（[KLineChart](https://github.com/klinecharts/KLineChart)） |
| http://127.0.0.1:8765/dashboard/ | [stock-dashboard](https://github.com/chengzuopeng/stock-dashboard) 看板（自选 / 热力图 / 板块 / 选股等） |
| http://127.0.0.1:8765/quotes | 行情列表（A / 港 / 美 + yfinance） |
| http://127.0.0.1:8765/fupan | 本地涨停复盘 Demo（选股宝接口，不经通达信） |
| http://127.0.0.1:8765/xnge/ | 犀利插件通用中转入口 |

```bash
./run_web.sh
# 首次若无看板构建产物，会自动执行 scripts/build_dashboard.sh
```

### 犀利插件中转（`t.xnge.cn`）

通达信版面里的插件页（如 `http://t.xnge.cn/qsg/?bg=##tdxbkcolor##&hidenav=1`）在系统浏览器会因缺少 UA 标识 `TdxW` 被拒（常见 404 /「插件访问异常」）。本地中转会：

1. 请求上游时带上通达信 CEF 常见 UA（含 `TdxW`）
2. 把查询参数里的 `##tdxbkcolor##` 换成真实背景色（默认 `000000`）
3. 按路径透传任意插件：`/xnge/<原站路径>?…` → `http://t.xnge.cn/<路径>?…`

**通用格式：** `http://127.0.0.1:8765/xnge/<路径>/?hidenav=1&bg=000000`

| 名称 | 本地中转 | 原站（通达信内） |
|------|----------|------------------|
| 强势股 | [/xnge/qsg/?hidenav=1&bg=000000](http://127.0.0.1:8765/xnge/qsg/?hidenav=1&bg=000000) | `http://t.xnge.cn/qsg/?bg=##tdxbkcolor##&hidenav=1` |
| 连板天梯 | [/xnge/jieli/?hidenav=1&bg=000000](http://127.0.0.1:8765/xnge/jieli/?hidenav=1&bg=000000) | `http://t.xnge.cn/jieli/?hidenav=1&bg=##tdxbkcolor##` |
| 人气股 | [/xnge/rank/?hidenav=1&bg=000000](http://127.0.0.1:8765/xnge/rank/?hidenav=1&bg=000000) | `http://t.xnge.cn/rank/?bg=##tdxbkcolor##&hidenav=1` |
| 涨停复盘（原站） | [/xnge/fupan/?hidenav=1&bg=000000](http://127.0.0.1:8765/xnge/fupan/?hidenav=1&bg=000000) | `http://t.xnge.cn/fupan/?hidenav=1&bg=##tdxbkcolor##` |
| 涨停复盘（本地 Demo） | [/fupan](http://127.0.0.1:8765/fupan) | —（本仓库页面 + 选股宝 API） |

目录页 http://127.0.0.1:8765/xnge/ 还可打开跌停股、犀利宝、思维导图、时光机等其它路径；也可粘贴完整 `t.xnge.cn` URL 自动提取路径。旧地址 `/api/zt/xnge-proxy` 会 307 跳到 `/xnge/fupan/`。

手动重建看板：

```bash
./scripts/build_dashboard.sh
```

| 路径 | 说明 |
|------|------|
| `web/server.py` | FastAPI：静态页 + `/dashboard` SPA + `/xnge/{path}` 中转 |
| `web/static/index.html` | K 线页（MA / VOL / MACD，亮/暗主题） |
| `web/static/xnge.html` | 犀利插件中转目录 |
| `web/static/fupan.html` | 本地涨停复盘 Demo |
| `web/static/dashboard/` | stock-dashboard 构建产物 |
| `vendor/stock-dashboard/` | 看板源码（上游克隆） |
| `web/static/stock-sdk.mjs` | stock-sdk 浏览器打包 |
| `web/static/klinecharts.min.js` | KLineChart UMD |
| `run_web.sh` | 启动演示 |
| `scripts/build_dashboard.sh` | 构建看板到 `web/static/dashboard/` |

K 线页支持：A 股 `600036`、港股 `00700`、美股 `AAPL` / `105.AAPL`；周期 1/5/15/60 分、日线、周线。

### URL 直达查询

在地址栏传入股票代码即可直接加载对应市场行情（由 stock-sdk `normalizeSymbol` 识别市场）：

| 示例 | 说明 |
|------|------|
| `http://127.0.0.1:8765/?symbol=600036` | A 股 |
| `http://127.0.0.1:8765/?symbol=sh600519` | A 股（带交易所前缀） |
| `http://127.0.0.1:8765/?symbol=00700` | 港股 |
| `http://127.0.0.1:8765/?symbol=hk00700` | 港股 |
| `http://127.0.0.1:8765/?symbol=AAPL` | 美股 |
| `http://127.0.0.1:8765/?symbol=105.AAPL` | 美股（东财 secid 写法） |
| `http://127.0.0.1:8765/?symbol=600036&period=1d` | 同时指定周期 |

参数别名：`symbol` / `code` / `s` / `ticker` 均可；`period` 取值 `1m` `5m` `15m` `1h` `1d` `1w`。查询或切换周期后会自动同步到地址栏。

## 本仓库脚本

| 文件 | 说明 |
|------|------|
| `sample_quotes.py` | 用 **mootdx** 获取当前股价示例 |
| `run_sample_quotes.sh` | 激活 `.venv` 并运行上述示例 |
| `test_600036.py` | 600036 连通性测试（分时 / 财务） |
| `run_test.sh` | 运行连通性测试 |
| `run_web.sh` | 启动 Web K 线演示 |

```bash
./run_sample_quotes.sh          # 默认 600036
./run_sample_quotes.sh 300986   # 指定代码
./run_test.sh
./run_web.sh                    # http://127.0.0.1:8765
```

## 参考链接

- [stock-sdk](https://github.com/chengzuopeng/stock-sdk) · [文档](https://stock-sdk.linkdiary.cn) · [NPM](https://www.npmjs.com/package/stock-sdk)
- [stock-dashboard](https://github.com/chengzuopeng/stock-dashboard) · [在线体验](https://chengzuopeng.github.io/stock-dashboard/)
- [mootdx · PyPI](https://pypi.org/project/mootdx/) · [mootdx2 · PyPI](https://pypi.org/project/mootdx2/)
- [KLineChart](https://github.com/klinecharts/KLineChart) · [文档](https://www.klinecharts.com)
