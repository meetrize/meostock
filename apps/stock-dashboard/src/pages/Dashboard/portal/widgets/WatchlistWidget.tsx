import { Plus } from 'lucide-react';
import { Button, Empty } from '@/components/common';
import { formatPercent, formatPrice, getChangeColorClass } from '@/utils/format';
import { useDashboardData } from '../dashboardDataContext';
import { estimateVisibleRows } from '../widgetCatalog';
import styles from '../widgetContent.module.css';

interface Props {
  gridH: number;
}

export function WatchlistWidget({ gridH }: Props) {
  const {
    watchlistCodes,
    watchlistQuotes,
    onStockClick,
    onManageWatchlist,
  } = useDashboardData();

  const limit = estimateVisibleRows(gridH);

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
      {watchlistQuotes.slice(0, limit).map((item) => (
        <div
          key={item.code}
          className={styles.watchlistItem}
          onClick={() => onStockClick(item.code)}
        >
          <div className={styles.stockInfo}>
            <span className={styles.stockName}>{item.name}</span>
            <span className={styles.stockCode}>{item.code}</span>
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
      ))}
      <div style={{ marginTop: 8 }}>
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus size={14} />}
          onClick={onManageWatchlist}
        >
          管理
        </Button>
      </div>
    </div>
  );
}
