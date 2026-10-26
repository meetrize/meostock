import { Loading, Tabs } from '@/components/common';
import { formatPercent, formatPrice, getChangeColorClass } from '@/utils/format';
import { useDashboardData } from '../dashboardDataContext';
import { estimateVisibleRows } from '../widgetCatalog';
import styles from '../widgetContent.module.css';

const RANKING_TABS = [
  { key: 'rise', label: '涨幅榜' },
  { key: 'fall', label: '跌幅榜' },
  { key: 'amount', label: '成交额' },
  { key: 'turnover', label: '换手率' },
];

interface Props {
  gridH: number;
  gridW: number;
}

export function MarketRankingWidget({ gridH, gridW }: Props) {
  const {
    rankingTab,
    setRankingTab,
    rankingItems,
    rankingIndustries,
    onStockClick,
  } = useDashboardData();

  const showIndustry = gridW >= 5;
  const limit = Math.max(3, estimateVisibleRows(gridH) - 1);

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <Tabs
          items={RANKING_TABS}
          activeKey={rankingTab}
          onChange={setRankingTab}
          size="sm"
        />
      </div>
      {rankingItems.length === 0 ? (
        <Loading size="md" />
      ) : (
        <div className={styles.rankingList}>
          <div
            className={`${styles.rankingHeader} ${
              showIndustry ? '' : styles.rankingHeaderNarrow
            }`}
          >
            <span>序号 / 名称 / 代码</span>
            <span>最新价</span>
            <span>涨幅</span>
            {showIndustry && <span>所属行业</span>}
          </div>
          {rankingItems.slice(0, limit).map((item, index) => {
            const pureCode = String(item.code || '').replace(/^(sh|sz|bj)/i, '');
            const industry = rankingIndustries[pureCode] || '--';
            return (
              <div
                key={item.code}
                className={`${styles.rankingItem} ${styles.rankingItemMarket} ${
                  showIndustry ? '' : styles.rankingItemMarketNarrow
                }`}
                onClick={() => onStockClick(item.code)}
              >
                <div className={styles.rankIdentity}>
                  <span className={styles.rankNum}>{index + 1}</span>
                  <div className={styles.stockInfo}>
                    <span className={styles.stockName}>{item.name}</span>
                    <span className={styles.stockCode}>{pureCode || item.code}</span>
                  </div>
                </div>
                <div className={styles.stockPrice}>
                  <span>{formatPrice(item.price)}</span>
                </div>
                <div
                  className={`${styles.stockChange} ${getChangeColorClass(item.changePercent)}`}
                >
                  {formatPercent(item.changePercent)}
                </div>
                {showIndustry && (
                  <div className={styles.stockIndustry} title={industry}>
                    {industry}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
