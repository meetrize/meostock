"""通达信线上行情读取示例：获取当前股价。

用法:
  python sample_quotes.py
  python sample_quotes.py 600036
"""

import sys
from datetime import datetime

from mootdx.quotes import Quotes


def get_current_price(client: Quotes, symbol: str) -> tuple[float, str]:
    """优先实时 quotes，失败则用当日分时最后一笔价格。

    注意: client.minutes() 若不传 date，库默认是 '20191023'（历史日），
    不是今天。取现价应使用 client.minute()，或 minutes(date=今天)。
    """
    # 1) 实时行情（部分主站可能返回空）
    quotes = client.quotes(symbol=symbol)
    if quotes is not None and not quotes.empty:
        row = quotes.iloc[0]
        for col in ("price", "now", "close", "last_close"):
            if col in quotes.columns and row[col] is not None:
                return float(row[col]), f"quotes.{col}"
        print(f"[INFO] quotes 返回列: {list(quotes.columns)}")
        print(quotes.to_string(index=False))

    # 2) README 的 minute：内部用今天日期拉分时
    minute = client.minute(symbol=symbol)
    if minute is not None and not minute.empty and "price" in minute.columns:
        return float(minute.iloc[-1]["price"]), "minute.last"

    # 3) 显式传今天，避免踩默认历史日
    today = datetime.now().strftime("%Y%m%d")
    minutes = client.minutes(symbol=symbol, date=today)
    if minutes is not None and not minutes.empty and "price" in minutes.columns:
        return float(minutes.iloc[-1]["price"]), f"minutes({today}).last"

    raise RuntimeError(f"无法获取 {symbol} 的当前股价")


def main() -> None:
    symbol = sys.argv[1] if len(sys.argv) > 1 else "600036"
    today = datetime.now().strftime("%Y%m%d")
    print("=== 通达信线上行情读取示例 ===")
    print(f"标的: {symbol}")
    print(f"时间: {datetime.now()} (查询日 {today})\n")

    client = Quotes.factory(market="std", multithread=True, heartbeat=False)
    try:
        price, source = get_current_price(client, symbol)
        print(f"当前股价: {price:.2f} 元")
        print(f"数据来源: {source}")

        minutes = client.minutes(symbol=symbol, date=today)
        if minutes is not None and not minutes.empty:
            print("\n当日分时最近 5 笔:")
            print(minutes.tail(5).to_string())
    finally:
        client.close()


if __name__ == "__main__":
    main()
