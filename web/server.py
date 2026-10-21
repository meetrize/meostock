"""静态站点 + 轻量符号列表代理（东方财富 clist，供比较商品弹窗浏览）。"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title="stock-sdk K-Line Demo", version="0.3.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# 东方财富行情列表（浏览器直连常遇 CORS，由本机代理）
EM_CLIST = "https://push2.eastmoney.com/api/qt/clist/get"
MARKET_FS = {
    "cn": "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048",  # A股
    "hk": "m:128+t:3,m:128+t:4",  # 港股
    "us": "m:105,m:106,m:107",  # 美股
    "fund": "m:0+t:1",  # 场内基金近似
    "index": "m:1+t:1,m:0+t:5",  # 指数近似
}
MARKET_LABEL = {
    "cn": "A股",
    "hk": "港股",
    "us": "美股",
    "fund": "基金",
    "index": "指数",
}
# f13 → 交易所展示
EXCHANGE_BY_MKT = {
    0: "SZSE",
    1: "SSE",
    105: "NASDAQ",
    106: "NYSE",
    107: "AMEX",
    116: "HKEX",
    128: "HKEX",
}


def _http_get_json(url: str, timeout: float = 12.0) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; mootdx-kline/0.3)",
            "Referer": "https://quote.eastmoney.com/",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return json.loads(raw)


def _to_symbol(code: str, mkt: int, market: str) -> str:
    code = str(code or "").strip()
    if market == "us":
        return code.upper()
    if market == "hk":
        return code.zfill(5) if code.isdigit() else code
    # A股 / 基金 / 指数：带交易所前缀，便于 normalizeSymbol
    if mkt == 1:
        return f"sh{code}"
    if mkt == 0:
        return f"sz{code}"
    return code


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/symbols")
def symbol_list(
    market: str = Query("cn", description="cn|hk|us|fund|index"),
    page: int = Query(1, ge=1),
    size: int = Query(60, ge=1, le=100),
    q: str = Query("", description="可选：代码/名称过滤（服务端粗滤）"),
) -> JSONResponse:
    market = (market or "cn").lower().strip()
    fs = MARKET_FS.get(market)
    if not fs:
        return JSONResponse({"ok": False, "error": f"unsupported market: {market}"}, status_code=400)

    params = {
        "pn": str(page),
        "pz": str(size),
        "po": "1",
        "np": "1",
        "fltt": "2",
        "invt": "2",
        "fid": "f6",  # 成交额/量，热门股靠前
        "fs": fs,
        "fields": "f12,f13,f14",
    }
    url = f"{EM_CLIST}?{urllib.parse.urlencode(params)}"
    try:
        data = _http_get_json(url)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=502)

    diff = (((data or {}).get("data") or {}).get("diff")) or []
    total = int((((data or {}).get("data") or {}).get("total")) or 0)
    qn = q.strip().lower()
    items: list[dict[str, Any]] = []
    for row in diff:
        code = str(row.get("f12") or "")
        name = str(row.get("f14") or "")
        mkt = int(row.get("f13") or 0)
        if qn and qn not in code.lower() and qn not in name.lower():
            continue
        symbol = _to_symbol(code, mkt, market)
        items.append(
            {
                "symbol": symbol,
                "code": code,
                "name": name,
                "market": market,
                "marketLabel": MARKET_LABEL.get(market, market.upper()),
                "exchange": EXCHANGE_BY_MKT.get(mkt, MARKET_LABEL.get(market, "")),
                "category": "stock" if market in ("cn", "hk", "us") else market,
            }
        )

    return JSONResponse(
        {
            "ok": True,
            "market": market,
            "page": page,
            "size": size,
            "total": total,
            "items": items,
        }
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8765, reload=False)
