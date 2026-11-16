/**
 * Tushare 专题短名单
 */

import { useMemo } from 'react';
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

/** Tushare first_time/last_time → 秒数，便于排序；无效返回 -1 */
function limitTimeSeconds(raw: unknown): number {
  const s = String(raw ?? '').trim();
  if (!s) return -1;
  const colon = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (colon) {
    return Number(colon[1]) * 3600 + Number(colon[2]) * 60 + Number(colon[3] || 0);
  }
  const digits = s.replace(/\D/g, '');
  if (digits.length === 6) {
    return (
      Number(digits.slice(0, 2)) * 3600 +
      Number(digits.slice(2, 4)) * 60 +
      Number(digits.slice(4, 6))
    );
  }
  if (digits.length === 4) {
    return Number(digits.slice(0, 2)) * 3600 + Number(digits.slice(2, 4)) * 60;
  }
  return -1;
}

/** 紧凑显示 HH:MM（去掉秒） */
function formatLimitTime(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const colon = s.match(/^(\d{1,2}):(\d{2})/);
  if (colon) return `${colon[1].padStart(2, '0')}:${colon[2]}`;
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 4) {
    const hhmm = digits.length >= 6 ? digits.slice(0, 4) : digits.slice(0, 4);
    return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
  }
  return s;
}

function limitSortKey(row: Record<string, unknown>): number {
  // 优先首次封板，其次最后封板；无时间沉底
  const first = limitTimeSeconds(row.firstTime ?? row.first_time);
  if (first >= 0) return first;
  return limitTimeSeconds(row.lastTime ?? row.last_time);
}

export function TopicListWidget({ type }: Props) {
  const { topics } = usePortalMarkets();
  const topic = topics[type as PortalWidgetType];
  const rawItems = topic?.items || [];

  const items = useMemo(() => {
    if (type !== 'topic.limitList') return rawItems;
    // 涨跌停：按首次封板时间倒序（越晚越靠前）；无时间的排后
    return [...rawItems].sort((a, b) => {
      const tb = limitSortKey(b);
      const ta = limitSortKey(a);
      if (tb !== ta) return tb - ta;
      const pctB = Number(b.pctChg ?? b.changePercent ?? 0) || 0;
      const pctA = Number(a.pctChg ?? a.changePercent ?? 0) || 0;
      return pctB - pctA;
    });
  }, [rawItems, type]);

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
          <span>
            {topic.tradeDate}
            {type === 'topic.limitList' ? ' · 按首次封板' : ''}
          </span>
          {topic.syncing && <span>同步中</span>}
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
          const timeRaw = row.firstTime ?? row.first_time ?? row.lastTime ?? row.last_time;
          const timeText =
            type === 'topic.limitList' ? formatLimitTime(timeRaw) : '';
          return (
            <button
              key={`${code}-${idx}`}
              type="button"
              className={styles.topicRow}
              title={
                type === 'topic.limitList' && timeText
                  ? `首次封板 ${String(timeRaw || timeText)}`
                  : undefined
              }
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
                {timeText ? <span className={styles.topicTime}>{timeText}</span> : null}
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
