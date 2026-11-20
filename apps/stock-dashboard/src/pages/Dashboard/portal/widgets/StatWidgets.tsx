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

/**
 * 北向日频净买入已于 2024-08 前后停更；禁止再展示「今日净流入」。
 * 本组件仅提示停更，引导看个股北向持股等慢变量。
 */
export function StatNorthboundWidget() {
  return (
    <div
      className={styles.statCard}
      title="北向日度净买入已停更（2024-08 起改为季度披露持股）；勿当作日频信号"
    >
      <div className={styles.statValueLarge}>已停更</div>
      <div className={styles.statMeta}>
        <span>日频净买入</span>
        <span>改看季度持股</span>
      </div>
      <div className={styles.statHint}>非日频资金信号</div>
    </div>
  );
}

function openMarketFlowPage() {
  const base = String(import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
  window.open(`${base}market-flow`, '_blank', 'noopener,noreferrer');
}

export function StatMainForceWidget() {
  const { latestMarketFundFlow, marketSummary } = useDashboardData();
  return (
    <button
      type="button"
      className={`${styles.statCard} ${styles.statCardClickable}`}
      title="新页面查看主力净流入与成交量曲线"
      onClick={openMarketFlowPage}
    >
      <div
        className={`${styles.statValueLarge} ${getChangeColorClass(
          latestMarketFundFlow?.mainNetInflow
        )}`}
      >
        {formatYuanAmount(latestMarketFundFlow?.mainNetInflow)}
      </div>
      <div className={styles.statMeta}>
        <span className={getChangeColorClass(latestMarketFundFlow?.mainNetInflowPercent)}>
          {formatPercent(latestMarketFundFlow?.mainNetInflowPercent)}
        </span>
        <span>额 {formatAmount(marketSummary.totalAmount)}</span>
      </div>
      <div className={styles.statHint}>新开页看曲线</div>
    </button>
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
