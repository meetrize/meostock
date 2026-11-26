"""Portal 日线面积图符号清单（后端单一事实源）。

与前端 ``sparkCatalog`` / ``indexCatalog`` 对齐：新增曲线面板时同步改此处，
盘后 EOD 与 /api/cache/kline/portal-symbols 都读这份表。
"""

from __future__ import annotations

from typing import Any

# eodLane → 盘后任务 lane（见 scheduler.portal_kline_eod）
CurveSpec = dict[str, Any]

PORTAL_CURVE_SPECS: list[CurveSpec] = [
    # —— A 股指数 ——
    {"type": "index.sh000001", "klineSymbol": "sh000001", "eodLane": "cn", "name": "上证指数"},
    {"type": "index.sz399001", "klineSymbol": "sz399001", "eodLane": "cn", "name": "深证成指"},
    {"type": "index.sz399006", "klineSymbol": "sz399006", "eodLane": "cn", "name": "创业板指"},
    {"type": "index.sh000688", "klineSymbol": "sh000688", "eodLane": "cn", "name": "科创50"},
    {"type": "index.sh000300", "klineSymbol": "sh000300", "eodLane": "cn", "name": "沪深300"},
    {"type": "index.sh000016", "klineSymbol": "sh000016", "eodLane": "cn", "name": "上证50"},
    # —— 全球 ——
    {"type": "spark.dji", "klineSymbol": "yf:^DJI", "eodLane": "us", "name": "道指"},
    {"type": "spark.ixic", "klineSymbol": "yf:^IXIC", "eodLane": "us", "name": "纳指"},
    {"type": "spark.gspc", "klineSymbol": "yf:^GSPC", "eodLane": "us", "name": "标普500"},
    {"type": "spark.vix", "klineSymbol": "yf:^VIX", "eodLane": "us", "name": "VIX"},
    {"type": "spark.hsi", "klineSymbol": "yf:^HSI", "eodLane": "asia", "name": "恒生"},
    {"type": "spark.n225", "klineSymbol": "yf:^N225", "eodLane": "asia", "name": "日经"},
    {"type": "spark.ks11", "klineSymbol": "yf:^KS11", "eodLane": "asia", "name": "韩国综指"},
    {"type": "spark.gdaxi", "klineSymbol": "yf:^GDAXI", "eodLane": "eu", "name": "DAX"},
    {"type": "spark.ftse", "klineSymbol": "yf:^FTSE", "eodLane": "eu", "name": "富时100"},
    {"type": "spark.stoxx50e", "klineSymbol": "yf:^STOXX50E", "eodLane": "eu", "name": "欧股50"},
    # —— 国内期货 ——
    {"type": "spark.fut.aum", "klineSymbol": "fut:AUM", "eodLane": "cn", "name": "沪金"},
    {"type": "spark.fut.agm", "klineSymbol": "fut:AGM", "eodLane": "cn", "name": "沪银"},
    {"type": "spark.fut.cum", "klineSymbol": "fut:CUM", "eodLane": "cn", "name": "沪铜"},
    {"type": "spark.fut.rbm", "klineSymbol": "fut:RBM", "eodLane": "cn", "name": "螺纹"},
    {"type": "spark.fut.scm", "klineSymbol": "fut:SCM", "eodLane": "cn", "name": "原油"},
    {"type": "spark.fut.rum", "klineSymbol": "fut:RUM", "eodLane": "cn", "name": "橡胶"},
    {"type": "spark.fut.mam", "klineSymbol": "fut:MM", "eodLane": "cn", "name": "豆粕"},
    {"type": "spark.fut.ifm", "klineSymbol": "fut:IFM", "eodLane": "cn", "name": "沪深300期"},
    {"type": "spark.fut.icm", "klineSymbol": "fut:ICM", "eodLane": "cn", "name": "中证500期"},
    {"type": "spark.fut.imm", "klineSymbol": "fut:IMM", "eodLane": "cn", "name": "中证1000期"},
    # —— 商品 ——
    {"type": "spark.gc", "klineSymbol": "yf:GC=F", "eodLane": "us", "name": "黄金"},
    {"type": "spark.si", "klineSymbol": "yf:SI=F", "eodLane": "us", "name": "白银"},
    {"type": "spark.cl", "klineSymbol": "yf:CL=F", "eodLane": "us", "name": "WTI原油"},
    {"type": "spark.bz", "klineSymbol": "yf:BZ=F", "eodLane": "us", "name": "布伦特"},
    {"type": "spark.hg", "klineSymbol": "yf:HG=F", "eodLane": "us", "name": "铜"},
    {"type": "spark.ng", "klineSymbol": "yf:NG=F", "eodLane": "us", "name": "天然气"},
    # —— 外汇 ——
    {"type": "spark.dxy", "klineSymbol": "yf:DX-Y.NYB", "eodLane": "us", "name": "美元指数"},
    {"type": "spark.usdcny", "klineSymbol": "yf:USDCNY=X", "eodLane": "us", "name": "美元人民币"},
    {"type": "spark.eurusd", "klineSymbol": "yf:EURUSD=X", "eodLane": "us", "name": "欧元美元"},
    {"type": "spark.jpy", "klineSymbol": "yf:JPY=X", "eodLane": "us", "name": "美元日元"},
    {"type": "spark.gbpusd", "klineSymbol": "yf:GBPUSD=X", "eodLane": "us", "name": "英镑美元"},
    {"type": "spark.audusd", "klineSymbol": "yf:AUDUSD=X", "eodLane": "us", "name": "澳元美元"},
    {"type": "spark.hkd", "klineSymbol": "yf:HKD=X", "eodLane": "us", "name": "美元港币"},
    # —— 加密 ——
    {"type": "spark.btc", "klineSymbol": "yf:BTC-USD", "eodLane": "crypto", "name": "比特币"},
    {"type": "spark.eth", "klineSymbol": "yf:ETH-USD", "eodLane": "crypto", "name": "以太坊"},
    {"type": "spark.sol", "klineSymbol": "yf:SOL-USD", "eodLane": "crypto", "name": "Solana"},
    {"type": "spark.bnb", "klineSymbol": "yf:BNB-USD", "eodLane": "crypto", "name": "BNB"},
    # —— 美债 ——
    {"type": "spark.irx", "klineSymbol": "yf:^IRX", "eodLane": "us", "name": "美债3月"},
    {"type": "spark.fvx", "klineSymbol": "yf:^FVX", "eodLane": "us", "name": "美债5年"},
    {"type": "spark.tnx", "klineSymbol": "yf:^TNX", "eodLane": "us", "name": "美债10年"},
    {"type": "spark.tyx", "klineSymbol": "yf:^TYX", "eodLane": "us", "name": "美债30年"},
]


def list_portal_curve_specs() -> list[CurveSpec]:
    return list(PORTAL_CURVE_SPECS)


def portal_symbols_all() -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for s in PORTAL_CURVE_SPECS:
        sym = str(s.get("klineSymbol") or "").strip()
        if sym and sym not in seen:
            seen.add(sym)
            out.append(sym)
    return out


def portal_symbols_by_lane(lane: str) -> list[str]:
    key = (lane or "").strip().lower()
    out: list[str] = []
    seen: set[str] = set()
    for s in PORTAL_CURVE_SPECS:
        if str(s.get("eodLane") or "").lower() != key:
            continue
        sym = str(s.get("klineSymbol") or "").strip()
        if sym and sym not in seen:
            seen.add(sym)
            out.append(sym)
    return out
