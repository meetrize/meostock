import {
  formatAmount,
  formatPercent,
  formatYuanAmount,
  getChangeColorClass,
} from '@/utils/format';
import { useDashboardData } from '../dashboardDataContext';
import styles from '../widgetContent.module.css';

export function StatBreadthWidget() {
  const { marketSummary } = useDashboardData();
  return (
    <div className={styles.statCard}>
      <div className={styles.statValueRow}>
        <span className="text-rise">{marketSummary.riseCount}</span>
        <span className={styles.statDivider}>/</span>
        <span className="text-fall">{marketSummary.fallCount}</span>
      </div>
      <div className={styles.statMeta}>
        <span>{marketSummary.flatCount} 平</span>
      </div>
    </div>
  );
}

export function StatLimitWidget() {
  const { marketSummary } = useDashboardData();
  return (
    <div className={styles.statCard}>
      <div className={styles.statValueRow}>
        <span className="text-rise">{marketSummary.limitUpCount}</span>
        <span className={styles.statDivider}>/</span>
        <span className="text-fall">{marketSummary.limitDownCount}</span>
      </div>
      <div className={styles.statMeta}>
        <span>涨停 / 跌停</span>
      </div>
    </div>
  );
}

export function StatAmountWidget() {
  const { marketSummary } = useDashboardData();
  return (
    <div className={styles.statCard}>
      <div className={styles.statValueLarge}>{formatAmount(marketSummary.totalAmount)}</div>
      <div className={styles.statMeta}>
        <span>成交额</span>
      </div>
    </div>
  );
}

export function StatNorthboundWidget() {
  const { northboundSnapshot } = useDashboardData();
  return (
    <div className={styles.statCard}>
      <div
        className={`${styles.statValueLarge} ${getChangeColorClass(
          northboundSnapshot?.netInflow ?? northboundSnapshot?.netBuyAmount
        )}`}
      >
        {formatYuanAmount(
          northboundSnapshot?.netInflow ?? northboundSnapshot?.netBuyAmount
        )}
      </div>
      <div className={styles.statMeta}>
        <span>
          {northboundSnapshot?.upCount ?? '--'}/
          {northboundSnapshot?.downCount ?? '--'}
        </span>
        <span>{northboundSnapshot?.boardName ?? '北向'}</span>
      </div>
    </div>
  );
}

export function StatMainForceWidget() {
  const { latestMarketFundFlow } = useDashboardData();
  return (
    <div className={styles.statCard}>
      <div
        className={`${styles.statValueLarge} ${getChangeColorClass(
          latestMarketFundFlow?.mainNetInflow
        )}`}
      >
        {formatYuanAmount(latestMarketFundFlow?.mainNetInflow)}
      </div>
      <div className={styles.statMeta}>
        <span>{formatPercent(latestMarketFundFlow?.mainNetInflowPercent)}</span>
        <span>{latestMarketFundFlow?.date ?? '当日'}</span>
      </div>
    </div>
  );
}

export function StatStrongestBoardWidget() {
  const { strongestBoard, boardTab } = useDashboardData();
  return (
    <div className={styles.statCard}>
      <div className={styles.statValueLarge}>{strongestBoard?.name ?? '--'}</div>
      <div className={styles.statMeta}>
        <span className={getChangeColorClass(strongestBoard?.changePercent)}>
          {formatPercent(strongestBoard?.changePercent)}
        </span>
        <span>{boardTab === 'industry' ? '行业' : '概念'}</span>
      </div>
    </div>
  );
}
