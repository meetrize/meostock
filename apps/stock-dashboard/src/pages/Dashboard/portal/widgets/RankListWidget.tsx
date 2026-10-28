/**
 * 跨境 / 可转债等涨幅榜
 */

import { Empty } from '@/components/common';
import { formatPercent, formatPrice, getChangeColorClass } from '@/utils/format';
import { useDashboardData } from '../dashboardDataContext';
import { usePortalMarkets } from '../portalMarketsContext';
import { estimateVisibleRows } from '../widgetCatalog';
import type { PortalWidgetType } from '../types';
import styles from '../widgetContent.module.css';

interface Props {
  type: 'rank.hk' | 'rank.cb';
  gridH: number;
}

export function RankListWidget({ type, gridH }: Props) {
  const { ranks } = usePortalMarkets();
  const { onStockClick } = useDashboardData();
  const items = ranks[type as PortalWidgetType] || [];
  const limit = estimateVisibleRows(gridH);
  const rows = items.slice(0, limit);

  if (!rows.length) {
    return (
      <Empty
        title="暂无数据"
        description={type === 'rank.hk' ? '可在顶栏同步东财轨' : '可在顶栏同步 Tushare 轨'}
      />
    );
  }

  return (
    <div className={styles.watchlist}>
      {rows.map((item) => (
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
    </div>
  );
}
