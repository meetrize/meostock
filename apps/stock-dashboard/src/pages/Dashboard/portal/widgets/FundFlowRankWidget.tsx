import { Loading } from '@/components/common';
import { formatPrice, formatYuanAmount, getChangeColorClass } from '@/utils/format';
import { useDashboardData } from '../dashboardDataContext';
import { estimateVisibleRows } from '../widgetCatalog';
import styles from '../widgetContent.module.css';

interface Props {
  gridH: number;
}

export function FundFlowRankWidget({ gridH }: Props) {
  const { fundFlowRanks, onStockClick } = useDashboardData();
  const limit = estimateVisibleRows(gridH);

  if (fundFlowRanks.length === 0) {
    return <Loading size="md" />;
  }

  return (
    <div className={styles.rankingList}>
      {fundFlowRanks.slice(0, limit).map((item, index) => (
        <div
          key={item.code}
          className={styles.rankingItem}
          onClick={() => onStockClick(item.code)}
        >
          <span className={styles.rankNum}>{index + 1}</span>
          <div className={styles.stockInfo}>
            <span className={styles.stockName}>{item.name}</span>
            <span className={styles.stockCode}>{item.code}</span>
          </div>
          <div className={styles.stockPrice}>
            <span>{formatPrice(item.price)}</span>
          </div>
          <div className={`${styles.stockChange} ${getChangeColorClass(item.mainNetInflow)}`}>
            {formatYuanAmount(item.mainNetInflow)}
          </div>
        </div>
      ))}
    </div>
  );
}
