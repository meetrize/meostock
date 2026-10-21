"""测试 mootdx 能否获取 A 股 600036（招商银行）行情数据。"""

from datetime import datetime

from mootdx.quotes import Quotes


def main() -> None:
    symbol = "600036"
    print(f"测试标的: {symbol} 招商银行")
    print(f"时间: {datetime.now()}\n")

    client = Quotes.factory(market="std", multithread=True, heartbeat=False)
    try:
        # 1) 当日分时
        minutes = client.minutes(symbol=symbol)
        assert minutes is not None and not minutes.empty, "分时数据为空"
        print(f"[OK] 分时 minutes: {len(minutes)} 条")
        print(minutes.tail(3).to_string())
        print(f"     价格区间: {minutes['price'].min():.2f} ~ {minutes['price'].max():.2f}\n")

        # 2) 财务摘要
        finance = client.finance(symbol=symbol)
        assert finance is not None and not finance.empty, "财务数据为空"
        print("[OK] 财务 finance:")
        cols = [c for c in ["code", "liutongguben", "meigujingzichan"] if c in finance.columns]
        print(finance[cols].to_string(index=False) if cols else finance.iloc[:, :5].to_string(index=False))

        # 3) 日 K（部分主站可能返回空）
        bars = client.bars(symbol=symbol, frequency=9, offset=10)
        if bars is None or bars.empty:
            print("\n[WARN] 日线 bars: 当前主站未返回日 K")
        else:
            print(f"\n[OK] 日线 bars:\n{bars}")

        print("\n结论: 600036 行情可获取（分时/财务验证通过）")
    finally:
        client.close()


if __name__ == "__main__":
    main()
