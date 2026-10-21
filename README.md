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

## Web K 线演示

基于 **[stock-sdk](https://github.com/chengzuopeng/stock-sdk)**（浏览器直连）+ [KLineChart](https://github.com/klinecharts/KLineChart) 的 K 线图演示。

前端在浏览器内调用 `sdk.quotes.*` / `sdk.kline.*`，本地服务只托管静态页面（无需 Python 行情后端）。

```bash
./run_web.sh
# 浏览器打开 http://127.0.0.1:8765
```

| 路径 | 说明 |
|------|------|
| `web/server.py` | 静态文件服务（FastAPI） |
| `web/static/index.html` | K 线页（MA / VOL / MACD，亮/暗主题） |
| `web/static/stock-sdk.mjs` | stock-sdk 浏览器打包 |
| `web/static/klinecharts.min.js` | KLineChart UMD |
| `run_web.sh` | 启动演示 |

支持：A 股 `600036`、港股 `00700`、美股 `AAPL` / `105.AAPL`；周期 1/5/15/60 分、日线、周线。

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
- [mootdx · PyPI](https://pypi.org/project/mootdx/) · [mootdx2 · PyPI](https://pypi.org/project/mootdx2/)
- [KLineChart](https://github.com/klinecharts/KLineChart) · [文档](https://www.klinecharts.com)
