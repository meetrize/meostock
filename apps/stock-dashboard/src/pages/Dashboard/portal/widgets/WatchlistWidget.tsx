import { Button, Empty } from '@/components/common';
import { formatPercent, formatPrice, getChangeColorClass } from '@/utils/format';
import { useDashboardData } from '../dashboardDataContext';
import styles from '../widgetContent.module.css';

export function WatchlistWidget() {
  const {
    watchlistCodes,
    watchlistQuotes,
    onStockClick,
    onManageWatchlist,
  } = useDashboardData();

  if (watchlistCodes.length === 0) {
    return (
      <Empty
        title="暂无自选股"
        description="搜索添加股票到自选"
        action={
          <Button size="sm" onClick={onManageWatchlist}>
            添加自选
          </Button>
        }
      />
    );
  }

  return (
    <div className={styles.watchlist}>
      {watchlistQuotes.map((item) => {
        const displayCode =
          String(item.code || '').replace(/^(sh|sz|bj|hk|us)/i, '') || item.code;
        return (
          <div
            key={item.code}
            className={styles.watchlistItem}
            onClick={() => onStockClick(item.code)}
          >
            <div className={styles.stockInfo}>
              <span className={styles.stockName}>{item.name}</span>
              <span className={styles.stockCode}>{displayCode}</span>
            </div>
            <div className={styles.stockPrice}>
              <span className={getChangeColorClass(item.changePercent)}>
                {formatPrice(item.price)}
              </span>
            </div>
            <div className={`${styles.stockChange} ${getChangeColorClass(item.changePercent)}`}>
              {formatPercent(item.changePercent)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
