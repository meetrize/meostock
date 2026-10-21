"""测试 mootdx2 ExtQuotes.markets()：查询当前支持的扩展市场列表。"""

from mootdx2.quotes import Quotes


def main() -> None:
    print("=== mootdx2 ExtQuotes.markets() ===\n")

    client = Quotes.factory(market="ext", heartbeat=False)
    try:
        markets = client.markets()
        if markets is None or (hasattr(markets, "empty") and markets.empty):
            print("未获取到市场列表（返回为空）")
            return

        print(f"共 {len(markets)} 个市场\n")
        print(markets.to_string(index=False))

        # 若有常见列名，再摘要打印
        cols = set(getattr(markets, "columns", []))
        name_col = next((c for c in ("name", "market_name", "category") if c in cols), None)
        id_col = next((c for c in ("market", "code", "category") if c in cols), None)
        if id_col and name_col and id_col != name_col:
            print("\n--- 摘要 ---")
            for _, row in markets.iterrows():
                print(f"  {row[id_col]:>6}  {row[name_col]}")
    finally:
        client.close()


if __name__ == "__main__":
    main()
