/**
 * 横滑行情条带
 */

import { useNavigate } from 'react-router-dom';
import { formatPercent, formatPrice, getChangeColorClass } from '@/utils/format';
import { usePortalMarkets } from '../portalMarketsContext';
import type { PortalWidgetType } from '../types';
import styles from '../widgetContent.module.css';

const QUOTES_PATH: Partial<Record<PortalWidgetType, string>> = {
  'strip.globalIndices': '/quotes',
  'strip.futures': '/quotes',
  'strip.metals': '/quotes',
  'strip.fx': '/quotes',
  'strip.crypto': '/quotes',
  'strip.rates': '/quotes',
};

interface Props {
  type: PortalWidgetType;
}

export function StripWidget({ type }: Props) {
  const navigate = useNavigate();
  const { stripQuotes, loading } = usePortalMarkets();
  const items = stripQuotes[type] || [];

  if (!loading && items.length === 0) {
    return (
      <div className={styles.stripEmpty}>暂无缓存，可在顶栏同步对应来源轨</div>
    );
  }

  return (
    <div className={styles.strip}>
      {items.map((q) => {
        const pct = q.changePercent ?? 0;
        const hasPrice = Number.isFinite(q.price) && q.price !== 0;
        return (
          <button
            key={`${type}-${q.code}`}
            type="button"
            className={styles.stripCard}
            title={`${q.name} ${q.code}`}
            onClick={() => navigate(QUOTES_PATH[type] || '/quotes')}
          >
            <span className={styles.stripName}>{q.name}</span>
            <span className={`${styles.stripPrice} ${getChangeColorClass(pct)}`}>
              {hasPrice ? formatPrice(q.price) : '--'}
            </span>
            <span className={`${styles.stripPct} ${getChangeColorClass(pct)}`}>
              {hasPrice ? formatPercent(pct) : '--'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
