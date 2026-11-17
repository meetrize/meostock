/**
 * Tushare 专题短名单
 */

import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Empty } from '@/components/common';
import { formatPercent, getChangeColorClass, normalizeStockCode } from '@/utils/format';
import { openKlineTool } from '@/utils/multipanel';
import { usePortalMarkets } from '../portalMarketsContext';
import { useWidgetHeaderSlot } from '../widgetHeaderSlotContext';
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

/** 归一 Tushare 时间：支持 9:55:33 / 095533 / 95533 */
function normalizeLimitTimeDigits(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const colon = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (colon) {
    const sec = (colon[3] || '00').padStart(2, '0');
    return `${colon[1].padStart(2, '0')}${colon[2]}${sec}`;
  }
  let digits = s.replace(/\D/g, '');
  if (digits.length === 5) digits = `0${digits}`; // 95533 → 095533
  if (digits.length === 3) digits = `0${digits}00`; // 935 → 093500
  if (digits.length === 4) digits = `${digits}00`;
  return digits.length === 6 ? digits : '';
}

/** Tushare first_time/last_time → 秒数，便于排序；无效返回 -1 */
function limitTimeSeconds(raw: unknown): number {
  const digits = normalizeLimitTimeDigits(raw);
  if (!digits) return -1;
  return (
    Number(digits.slice(0, 2)) * 3600 +
    Number(digits.slice(2, 4)) * 60 +
    Number(digits.slice(4, 6))
  );
}

/** 紧凑显示 HH:MM（去掉秒） */
function formatLimitTime(raw: unknown): string {
  const digits = normalizeLimitTimeDigits(raw);
  if (!digits) return '';
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
}

function limitSortKey(row: Record<string, unknown>): number {
  // 优先首次封板，其次最后封板；无时间沉底
  const first = limitTimeSeconds(row.firstTime ?? row.first_time);
  if (first >= 0) return first;
  return limitTimeSeconds(row.lastTime ?? row.last_time);
}

export function TopicListWidget({ type }: Props) {
  const headerSlot = useWidgetHeaderSlot();
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

  const headerMeta = useMemo(() => {
    if (!topic?.tradeDate) return null;
    const parts = [topic.tradeDate];
    if (type === 'topic.limitList') {
      parts.push('按首次封板');
      const src = String(topic.source || '').toLowerCase();
      if (src.includes('xuangubao')) parts.push('实时');
      else if (src) parts.push('Tushare');
    }
    if (topic.syncing) parts.push('同步中');
    return parts.join(' · ');
  }, [topic?.tradeDate, topic?.syncing, topic?.source, type]);

  const headerPortal =
    headerSlot && headerMeta
      ? createPortal(
          <span className={styles.topicHeaderMeta} title={headerMeta}>
            {headerMeta}
          </span>,
          headerSlot
        )
      : null;

  if (!items.length) {
    return (
      <>
        {headerPortal}
        <Empty
          title={topic?.error ? '加载失败' : '暂无数据'}
          description={
            topic?.error ||
            (topic?.tradeDate
              ? `${topic.tradeDate} 无记录，可稍后同步 Tushare`
              : '可在顶栏同步 Tushare 轨')
          }
        />
      </>
    );
  }

  return (
    <>
      {headerPortal}
      <div className={styles.topicList}>
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
            const timeRaw =
              row.firstTime ?? row.first_time ?? row.lastTime ?? row.last_time;
            const timeText =
              type === 'topic.limitList' ? formatLimitTime(timeRaw) : '';
            const timeInferred = Boolean(
              row.firstTimeInferred ?? row.first_time_inferred
            );
            return (
              <button
                key={`${code}-${idx}`}
                type="button"
                className={styles.topicRow}
                title={
                  type === 'topic.limitList' && timeText
                    ? timeInferred
                      ? `首次触及跌停 ${String(timeRaw || timeText)}（分时推断）`
                      : `首次封板 ${String(timeRaw || timeText)}`
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
                  {timeText ? (
                    <span className={styles.topicTime}>{timeText}</span>
                  ) : null}
                  {Number.isFinite(pct) ? (
                    <span className={getChangeColorClass(pct)}>
                      {formatPercent(pct)}
                    </span>
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
    </>
  );
}
