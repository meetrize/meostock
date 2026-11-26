/**
 * 公告异动：巨潮公告影响力列表
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, LayoutGrid, RefreshCw, X } from 'lucide-react';
import { Loading, useToast } from '@/components/common';
import { normalizeStockCode } from '@/utils/format';
import { openKlineTool, openMultipanelEntries } from '@/utils/multipanel';
import { writeKlineSignalTips, type KlineSignalTip } from '@/utils/klineSignalTip';
import styles from './AnnouncementImpact.module.css';

type ImpactItem = {
  announcement_id: string;
  code: string;
  stock_name?: string;
  title: string;
  announce_time?: string;
  announce_time_ms?: number;
  pdf_url?: string;
  final_level?: string;
  final_level_label?: string;
  direction?: string;
  score?: number;
  reasons?: string[];
  core_summary?: string;
  core_quotes?: string[];
  risk_flags?: string[];
  expected_gap_hint?: string;
  is_first_disclosure?: boolean;
  disclosure_stage?: string;
  confidence?: number;
  judge_status?: string;
};

const LEVEL_PRESETS: { key: string; label: string; levels: string }[] = [
  { key: 'xl_l', label: '特大+大', levels: 'XL,L' },
  { key: 'xl', label: '仅特大', levels: 'XL' },
  { key: 'all', label: '含中等', levels: 'XL,L,M' },
];

const DIR_PRESETS: { key: string; label: string; direction: string }[] = [
  { key: 'any', label: '全部方向', direction: '' },
  { key: 'bull', label: '偏多', direction: 'bullish' },
  { key: 'bear', label: '偏空', direction: 'bearish' },
];

function badgeClass(level?: string) {
  if (level === 'XL') return styles.badgeXL;
  if (level === 'L') return styles.badgeL;
  if (level === 'M') return styles.badgeM;
  return styles.badgeS;
}

function dirClass(direction?: string) {
  if (direction === 'bullish') return styles.dirBull;
  if (direction === 'bearish') return styles.dirBear;
  return styles.dirOther;
}

function dirLabel(direction?: string) {
  if (direction === 'bullish') return '偏多';
  if (direction === 'bearish') return '偏空';
  if (direction === 'mixed') return '混合';
  return '中性';
}

function toAnnounceYmd(item: ImpactItem): string {
  const raw = String(item.announce_time || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const ms = Number(item.announce_time_ms || 0);
  if (ms > 0) {
    const sec = ms > 1e12 ? ms / 1000 : ms;
    const d = new Date(sec * 1000);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  }
  return '';
}

function klineSymbolOf(code: string): string {
  return normalizeStockCode(String(code || '').trim()) || String(code || '').trim();
}

function tipFromImpact(item: ImpactItem, symbol: string, date: string): KlineSignalTip {
  return {
    symbol,
    date,
    title: item.title,
    stockName: item.stock_name,
    level: item.final_level,
    levelLabel: item.final_level_label,
    direction: item.direction,
    score: item.score,
    summary: item.core_summary,
    reasons: item.reasons,
  };
}

export function AnnouncementImpact() {
  const toast = useToast();
  const [levelKey, setLevelKey] = useState('xl_l');
  const [dirKey, setDirKey] = useState('any');
  const [days, setDays] = useState(3);
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [items, setItems] = useState<ImpactItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [multipanelBusy, setMultipanelBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ImpactItem | null>(null);
  const limit = 40;

  const levels = LEVEL_PRESETS.find((x) => x.key === levelKey)?.levels || 'XL,L';
  const direction = DIR_PRESETS.find((x) => x.key === dirKey)?.direction || '';

  const filterQs = useCallback(
    (pageLimit: number, pageOffset: number) => {
      const qs = new URLSearchParams({
        days: String(days),
        levels,
        limit: String(pageLimit),
        offset: String(pageOffset),
        hide_small: '1',
      });
      if (direction) qs.set('direction', direction);
      if (q.trim()) qs.set('q', q.trim());
      return qs;
    },
    [days, levels, direction, q]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = filterQs(limit, offset);
      const res = await fetch(`/api/cninfo/impact/list?${qs}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `加载失败 HTTP ${res.status}`);
      }
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total) || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filterQs, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageUniqueCount = useMemo(() => {
    const set = new Set(
      items.map((it) => klineSymbolOf(it.code)).filter(Boolean)
    );
    return set.size;
  }, [items]);

  const openDetail = async (item: ImpactItem) => {
    setDetail(item);
    try {
      const res = await fetch(`/api/cninfo/impact/${encodeURIComponent(item.announcement_id)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok && data.item) setDetail(data.item as ImpactItem);
    } catch {
      /* keep list item */
    }
  };

  const openStockKline = (item: ImpactItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    const sym = klineSymbolOf(item.code);
    if (!sym) {
      toast.info('无有效代码');
      return;
    }
    const date = toAnnounceYmd(item);
    if (date) writeKlineSignalTips(tipFromImpact(item, sym, date));
    openKlineTool(sym, '1d', date ? { date, bias: 'left' } : undefined);
  };

  /** 拉取当前筛选下全部公告，按股票去重后开多面板（锚定公告日） */
  const openFilteredMultipanel = async () => {
    setMultipanelBusy(true);
    try {
      const maxSymbols = 200;
      const pageSize = 200;
      const seen = new Map<string, { date: string; tip: KlineSignalTip }>();
      let pageOffset = 0;
      let reportedTotal = total;

      while (seen.size < maxSymbols) {
        const qs = filterQs(pageSize, pageOffset);
        const res = await fetch(`/api/cninfo/impact/list?${qs}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || `加载失败 HTTP ${res.status}`);
        }
        reportedTotal = Number(data.total) || reportedTotal;
        const batch: ImpactItem[] = Array.isArray(data.items) ? data.items : [];
        if (!batch.length) break;
        for (const it of batch) {
          const sym = klineSymbolOf(it.code);
          if (!sym || seen.has(sym)) continue;
          const date = toAnnounceYmd(it);
          seen.set(sym, { date, tip: tipFromImpact(it, sym, date) });
          if (seen.size >= maxSymbols) break;
        }
        pageOffset += batch.length;
        if (pageOffset >= reportedTotal || batch.length < pageSize) break;
      }

      const entries = [...seen.entries()].map(([symbol, v]) => ({
        symbol,
        date: v.date,
      }));
      if (!entries.length) {
        toast.info('当前筛选下暂无标的');
        return;
      }
      writeKlineSignalTips([...seen.values()].map((v) => v.tip).filter((t) => t.date));
      openMultipanelEntries(entries, { period: '1d', bias: 'left' });
      if (reportedTotal > pageOffset || seen.size >= maxSymbols) {
        toast.info(`已打开 ${entries.length} 只（上限 ${maxSymbols}，多面板内可翻页）`);
      } else {
        toast.success(`多面板已打开 ${entries.length} 只`);
      }
    } catch (err) {
      toast.info(err instanceof Error ? err.message : '打开多面板失败');
    } finally {
      setMultipanelBusy(false);
    }
  };

  const runJob = async () => {
    try {
      const res = await fetch('/api/scheduler/jobs/cninfo_announcement_impact/run', {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || '触发失败');
      }
      toast.success('已触发影响力评估任务');
      window.setTimeout(() => void load(), 2500);
    } catch (err) {
      toast.info(err instanceof Error ? err.message : '触发失败（可在定时任务页手动运行）');
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>公告异动</h1>
          <p className={styles.meta}>
            巨潮公告短周期影响力 · 共 {total} 条 · 近 {days} 日
            {pageUniqueCount ? ` · 本页 ${pageUniqueCount} 只` : ''}
          </p>
        </div>
        <div className={styles.actions}>
          <select
            className={styles.btn}
            value={days}
            onChange={(e) => {
              setOffset(0);
              setDays(Number(e.target.value));
            }}
            aria-label="天数"
          >
            <option value={1}>今日</option>
            <option value={3}>近 3 日</option>
            <option value={7}>近 7 日</option>
            <option value={14}>近 14 日</option>
          </select>
          <button
            type="button"
            className={styles.btn}
            disabled={multipanelBusy || total <= 0}
            title="用当前筛选结果（按股票去重）打开多面板 K 线"
            onClick={() => void openFilteredMultipanel()}
          >
            <LayoutGrid size={14} />
            {multipanelBusy ? '准备中…' : '多面板'}
          </button>
          <button type="button" className={styles.btn} onClick={() => void load()}>
            <RefreshCw size={14} />
            刷新
          </button>
          <button type="button" className={styles.btn} onClick={() => void runJob()}>
            跑评估
          </button>
        </div>
      </header>

      <div className={styles.filters}>
        {LEVEL_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`${styles.chip} ${levelKey === p.key ? styles.chipActive : ''}`}
            onClick={() => {
              setOffset(0);
              setLevelKey(p.key);
            }}
          >
            {p.label}
          </button>
        ))}
        {DIR_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`${styles.chip} ${dirKey === p.key ? styles.chipActive : ''}`}
            onClick={() => {
              setOffset(0);
              setDirKey(p.key);
            }}
          >
            {p.label}
          </button>
        ))}
        <input
          className={styles.search}
          placeholder="搜索代码/标题/摘要"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setOffset(0);
              setQ(qInput);
            }
          }}
        />
      </div>

      {loading && items.length === 0 ? (
        <Loading text="加载公告异动…" />
      ) : error ? (
        <div className={styles.error}>{error}</div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          暂无评估结果。请先同步巨潮公告，再运行「巨潮公告影响力评估」任务。
        </div>
      ) : (
        <div className={styles.list}>
          {items.map((item) => (
            <div
              key={item.announcement_id}
              role="button"
              tabIndex={0}
              className={styles.card}
              onClick={() => void openDetail(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void openDetail(item);
                }
              }}
            >
              <div>
                <span className={`${styles.badge} ${badgeClass(item.final_level)}`}>
                  {item.final_level_label || item.final_level || '—'}
                </span>
              </div>
              <div className={styles.cardMain}>
                <div className={styles.cardTop}>
                  <button
                    type="button"
                    className={styles.stockLink}
                    title="打开 K 线"
                    onClick={(e) => openStockKline(item, e)}
                  >
                    <span className={styles.code}>{item.code}</span>
                    <span className={styles.name}>{item.stock_name || '—'}</span>
                  </button>
                  <span className={dirClass(item.direction)}>{dirLabel(item.direction)}</span>
                  {!item.is_first_disclosure && (
                    <span className={styles.mutedTag}>非首次</span>
                  )}
                  {item.disclosure_stage === 'draft_revision' && (
                    <span className={styles.mutedTag}>修订稿</span>
                  )}
                </div>
                <p className={styles.title}>{item.title}</p>
                {item.core_summary ? (
                  <p className={styles.summary}>{item.core_summary}</p>
                ) : null}
                {!!item.reasons?.length && (
                  <div className={styles.reasons}>
                    {item.reasons.slice(0, 4).map((r) => (
                      <span key={r} className={styles.reason}>
                        {r}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className={styles.sideMeta}>
                <span>{item.announce_time || '—'}</span>
                <span>分 {item.score ?? '—'}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {total > limit && (
        <div className={styles.pager}>
          <button
            type="button"
            className={styles.btn}
            disabled={offset <= 0}
            onClick={() => setOffset((v) => Math.max(0, v - limit))}
          >
            上一页
          </button>
          <button
            type="button"
            className={styles.btn}
            disabled={offset + limit >= total}
            onClick={() => setOffset((v) => v + limit)}
          >
            下一页
          </button>
        </div>
      )}

      {detail && (
        <div className={styles.drawer} role="presentation" onClick={() => setDetail(null)}>
          <div
            className={styles.drawerPanel}
            role="dialog"
            aria-label="公告详情"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.cardTop}>
              <span className={`${styles.badge} ${badgeClass(detail.final_level)}`}>
                {detail.final_level_label || detail.final_level}
              </span>
              <span className={dirClass(detail.direction)}>{dirLabel(detail.direction)}</span>
              <button type="button" className={styles.btn} onClick={() => setDetail(null)}>
                <X size={14} />
                关闭
              </button>
            </div>
            <h2>
              <button
                type="button"
                className={styles.stockLink}
                title="打开 K 线"
                onClick={(e) => openStockKline(detail, e)}
              >
                <span className={styles.code}>{detail.code}</span>
                <span className={styles.name}>{detail.stock_name || ''}</span>
              </button>
            </h2>
            <p className={styles.title}>{detail.title}</p>
            <p className={styles.meta}>
              {detail.announce_time} · 分 {detail.score ?? '—'} ·{' '}
              {detail.judge_status || '—'}
            </p>
            <div className={styles.drawerActions}>
              {detail.pdf_url ? (
                <a
                  className={styles.btn}
                  href={detail.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={14} />
                  打开 PDF
                </a>
              ) : null}
              <button
                type="button"
                className={styles.btn}
                onClick={(e) => openStockKline(detail, e)}
              >
                打开 K 线
              </button>
            </div>
            {detail.core_summary ? (
              <>
                <h3>核心摘要</h3>
                <p className={styles.summary}>{detail.core_summary}</p>
              </>
            ) : null}
            {detail.expected_gap_hint ? (
              <p className={styles.meta}>预期差：{detail.expected_gap_hint}</p>
            ) : null}
            {!!detail.reasons?.length && (
              <>
                <h3>命中原因</h3>
                <div className={styles.reasons}>
                  {detail.reasons.map((r) => (
                    <span key={r} className={styles.reason}>
                      {r}
                    </span>
                  ))}
                </div>
              </>
            )}
            {!!detail.core_quotes?.length && (
              <>
                <h3>原文摘录</h3>
                {detail.core_quotes.map((quote) => (
                  <div key={quote} className={styles.quote}>
                    {quote}
                  </div>
                ))}
              </>
            )}
            {!!detail.risk_flags?.length && (
              <>
                <h3>风险标记</h3>
                <div className={styles.reasons}>
                  {detail.risk_flags.map((r) => (
                    <span key={r} className={styles.reason}>
                      {r}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
