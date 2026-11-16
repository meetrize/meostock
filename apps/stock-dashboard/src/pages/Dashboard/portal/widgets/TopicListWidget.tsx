/**
 * Tushare 专题短名单
 */

import { Empty } from '@/components/common';
import { formatPercent, getChangeColorClass, normalizeStockCode } from '@/utils/format';
import { openKlineTool } from '@/utils/multipanel';
import { usePortalMarkets } from '../portalMarketsContext';
import type { PortalWidgetType } from '../types';
import styles from '../widgetContent.module.css';

interface Props {
  type: 'topic.limitList' | 'topic.topList';
}

function cell(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  if (v == null || v === '') return '--';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '--';
  return String(v);
}

export function TopicListWidget({ type }: Props) {
  const { topics } = usePortalMarkets();
  const topic = topics[type as PortalWidgetType];
  const items = topic?.items || [];

  if (!items.length) {
    return (
      <Empty
        title={topic?.error ? '加载失败' : '暂无数据'}
        description={
          topic?.error ||
          (topic?.tradeDate
            ? `${topic.tradeDate} 无记录，可稍后同步 Tushare`
            : '可在顶栏同步 Tushare 轨')
        }
      />
    );
  }

  return (
    <div className={styles.topicList}>
      {topic?.tradeDate && (
        <div className={styles.topicMeta}>
          <span>交易日 {topic.tradeDate}</span>
          {topic.syncing && <span>后台同步中</span>}
        </div>
      )}
      <div className={styles.topicRows}>
        {items.map((row, idx) => {
          const code = cell(row, 'code');
          const name = cell(row, 'name');
          const displayCode =
            code === '--'
              ? code
              : code.replace(/^(sh|sz|bj|hk|us)/i, '') || code;
          const pct = Number(row.pctChg ?? row.changePercent ?? row.pct_chg);
          const limitFlag = cell(row, 'limit');
          const reason = cell(row, 'reason') || cell(row, 'explanation');
          return (
            <button
              key={`${code}-${idx}`}
              type="button"
              className={styles.topicRow}
              onClick={() => {
                if (!code || code === '--') return;
                openKlineTool(normalizeStockCode(code) || code);
              }}
            >
              <div className={styles.stockInfo}>
                <span className={styles.stockName}>{name}</span>
                <span className={styles.stockCode}>{displayCode}</span>
              </div>
              <div className={styles.topicRight}>
                {Number.isFinite(pct) ? (
                  <span className={getChangeColorClass(pct)}>{formatPercent(pct)}</span>
                ) : null}
                {limitFlag !== '--' && (
                  <span className={styles.topicTag}>{limitFlag}</span>
                )}
                {type === 'topic.topList' && reason !== '--' && (
                  <span className={styles.topicTag}>{reason}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
