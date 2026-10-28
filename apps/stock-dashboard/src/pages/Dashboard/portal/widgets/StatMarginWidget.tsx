/**
 * 两融余额 KPI（Tushare ts:margin）
 */

import { formatYuanAmount, getChangeColorClass } from '@/utils/format';
import { usePortalMarkets } from '../portalMarketsContext';
import styles from '../widgetContent.module.css';

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function StatMarginWidget() {
  const { topics } = usePortalMarkets();
  const topic = topics['stat.margin'];
  const row = topic?.items?.[0] || {};
  // 常见字段：rzye 融资余额；rzmre 融资买入；rqye 融券余额
  const balance =
    num(row.rzye) ??
    num(row.finBalance) ??
    num(row.rz_balance) ??
    num(row.balance) ??
    null;
  const net =
    num(row.rzmre) ?? num(row.netBuy) ?? num(row.finBuy) ?? null;

  return (
    <div className={styles.statCard}>
      <div className={`${styles.statValueLarge} ${getChangeColorClass(net)}`}>
        {balance != null ? formatYuanAmount(balance) : '--'}
      </div>
      <div className={styles.statMeta}>
        <span>两融余额</span>
        {topic?.tradeDate && <span>{topic.tradeDate}</span>}
      </div>
    </div>
  );
}
