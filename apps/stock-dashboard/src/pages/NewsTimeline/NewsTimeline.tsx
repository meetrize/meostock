/**
 * 按标的资讯时间线：按交易日汇总，标题折叠展开
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, ExternalLink, LineChart, Newspaper, RefreshCw } from 'lucide-react';
import { Loading, useToast } from '@/components/common';
import styles from './NewsTimeline.module.css';
import {
  barYmd,
  computeImpact,
  formatPct,
  inferMarketKind,
  loadReviewMarks,
  saveReviewMark,
  sortedBars,
  type ImpactRow,
  type KlineBar,
  type MarketKind,
  type ReviewMark,
  type SessionTag,
} from './newsImpact';
import { looksLikeHtml, sanitizeArticleHtml } from './sanitizeHtml';

type FinanceInstrument = {
  id: number;
  name: string;
  symbol: string;
  chart_symbol: string;
  market: string;
  asset_type: string;
  kline_url?: string;
};

type NewsArticle = {
  id: number;
  title: string;
  title_zh: string | null;
  description: string | null;
  description_zh: string | null;
  url: string;
  author: string | null;
  pub_date: string | null;
  created_at: string;
  feed_title: string;
  reader_url: string;
  finance_instruments: FinanceInstrument[];
};

type SnapshotQuote = {
  price?: number;
  changePercent?: number;
  name?: string;
  klineSymbol?: string;
};

type EnrichedItem = {
  article: NewsArticle;
  impact: ImpactRow | null;
};

type DayGroup = {
  tradeDate: string;
  impact: ImpactRow | null;
  items: EnrichedItem[];
};

const SESSION_LABEL: Record<SessionTag, string> = {
  pre: '盘前',
  session: '盘中',
  post: '盘后',
  weekend: '休市',
};

function displayTitle(a: NewsArticle) {
  return (a.title_zh || a.title || '').trim() || '无标题';
}

function displaySummary(a: NewsArticle) {
  const zh = (a.description_zh || '').trim();
  const en = (a.description || '').trim();
  // 中文过短（多为来源备注）且英文是 HTML 正文时，用英文 HTML
  if (zh && !(looksLikeHtml(en) && !looksLikeHtml(zh) && zh.length < 48)) {
    return zh;
  }
  return en || zh;
}

function SummaryBody({ text }: { text: string }) {
  if (!text) return null;
  if (looksLikeHtml(text)) {
    const html = sanitizeArticleHtml(text);
    if (!html.trim()) return null;
    return (
      <div
        className={styles.summaryHtml}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return <p className={styles.summary}>{text}</p>;
}

function publishedAt(a: NewsArticle) {
  return a.pub_date || a.created_at;
}

function pctClass(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v) || v === 0) return '';
  return v > 0 ? styles.up : styles.down;
}

function openKline(symbol: string, date?: string) {
  const qs = new URLSearchParams({ symbol, period: '1d' });
  if (date) qs.set('date', date);
  window.open(`/?${qs.toString()}`, '_blank', 'noopener,noreferrer');
}

function inferMarket(sym: string): string {
  const s = sym.toLowerCase();
  if (s.startsWith('hk')) return 'hk';
  if (s.startsWith('us')) return 'us';
  if (s.startsWith('yf:')) return 'yf:COMMODITIES';
  if (s.startsWith('fut:')) return 'futures';
  if (/^(sh|sz|bj)\d{6}$/.test(s) || /^\d{6}$/.test(s)) return 'cn';
  if (/^[a-z][a-z0-9.\-]{0,9}$/i.test(sym)) return 'us';
  return 'cn';
}

function formatClock(iso: string | null | undefined, market: MarketKind) {
  if (!iso) return '—';
  const tz =
    market === 'us' ? 'America/New_York' : market === 'hk' ? 'Asia/Hong_Kong' : 'Asia/Shanghai';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function formatDayLabel(ymd: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const week = ['日', '一', '二', '三', '四', '五', '六'][dt.getUTCDay()];
  return `${ymd} 周${week}`;
}

function groupByTradeDate(rows: EnrichedItem[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const row of rows) {
    const key = row.impact?.tradeDate || publishedAt(row.article)?.slice(0, 10) || 'unknown';
    let g = map.get(key);
    if (!g) {
      g = { tradeDate: key, impact: row.impact, items: [] };
      map.set(key, g);
    }
    g.items.push(row);
    // 优先保留带数值的 impact 作为日头展示
    if (!g.impact?.t0 && row.impact?.t0 != null) g.impact = row.impact;
    else if (row.impact?.pending && !g.impact?.pending) g.impact = row.impact;
  }
  return [...map.values()].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
}

function MiniSpark({
  bars,
  anchorDates,
  market,
}: {
  bars: KlineBar[];
  anchorDates: Set<string>;
  market: MarketKind;
}) {
  const asc = useMemo(() => sortedBars(bars).slice(-90), [bars]);
  if (asc.length < 2) {
    return <p className={styles.sparkTitle}>日线不足，暂无走势预览</p>;
  }
  const closes = asc.map((b) => b.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const w = 880;
  const h = 56;
  const pad = 4;
  const points = asc
    .map((b, i) => {
      const x = pad + (i / (asc.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (b.close - min) / span) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(' ');
  const anchors = asc
    .map((b, i) => {
      const ymd = barYmd(b, market);
      if (!anchorDates.has(ymd)) return null;
      const x = pad + (i / (asc.length - 1)) * (w - pad * 2);
      return (
        <line
          key={ymd + i}
          x1={x}
          x2={x}
          y1={0}
          y2={h}
          stroke="rgba(105, 178, 255, 0.55)"
          strokeWidth={1}
        />
      );
    })
    .filter(Boolean);

  return (
    <div className={styles.sparkWrap}>
      <p className={styles.sparkTitle}>近 {asc.length} 日收盘 · 竖线为消息映射交易日</p>
      <svg className={styles.sparkSvg} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {anchors}
        <polyline fill="none" stroke="rgba(105, 178, 255, 0.9)" strokeWidth={1.5} points={points} />
      </svg>
    </div>
  );
}

function PctButtons({
  impact,
  symbol,
}: {
  impact: ImpactRow | null;
  symbol: string;
}) {
  const renderPct = (
    label: string,
    v: number | null | undefined,
    date?: string,
    opts?: { live?: boolean; pending?: boolean },
  ) => {
    const disabled = v == null || !date;
    const tip = opts?.live
      ? `映射日 ${date} 日线未落地，显示相对昨收的最新涨跌`
      : opts?.pending
        ? `日线待更新 ${date}`
        : date
          ? `跳转 K 线 ${date}`
          : '无日线';
    return (
      <button
        type="button"
        className={`${styles.pctBtn} ${pctClass(v)}`}
        disabled={disabled}
        title={tip}
        onClick={(e) => {
          e.stopPropagation();
          if (date) openKline(symbol, date);
        }}
      >
        {label} {formatPct(v)}
      </button>
    );
  };

  const t0Label = impact?.t0Live ? '较昨收' : 'T0';
  return (
    <div className={styles.pctGroup}>
      {renderPct(t0Label, impact?.t0, impact?.tradeDate, {
        live: impact?.t0Live,
        pending: impact?.pending,
      })}
      {renderPct('T+1', impact?.t1, impact?.tradeDate)}
      {renderPct('T+5', impact?.t5, impact?.tradeDate)}
    </div>
  );
}

export function NewsTimeline() {
  const toast = useToast();
  const [params] = useSearchParams();
  const symbol = (params.get('symbol') || '').trim();
  const nameParam = (params.get('name') || '').trim();

  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [bars, setBars] = useState<KlineBar[]>([]);
  const [quote, setQuote] = useState<SnapshotQuote | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [marks, setMarks] = useState<Record<string, ReviewMark>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (symbol) setMarks(loadReviewMarks(symbol));
  }, [symbol]);

  const loadKlineAndQuote = useCallback(async () => {
    if (!symbol) return;
    try {
      const market = inferMarket(symbol);
      const [kRes, qRes] = await Promise.all([
        fetch(
          `/api/cache/kline?symbol=${encodeURIComponent(symbol)}&period=1d&limit=400&local_first=1`,
        ),
        fetch(
          `/api/cache/snapshot?market=${encodeURIComponent(market)}&codes=${encodeURIComponent(symbol)}`,
        ),
      ]);
      if (kRes.ok) {
        const data = await kRes.json();
        const list = Array.isArray(data?.bars) ? data.bars : [];
        setBars(
          list.map((b: Record<string, number>) => ({
            timestamp: Number(b.timestamp),
            open: Number(b.open),
            high: Number(b.high),
            low: Number(b.low),
            close: Number(b.close),
            volume: Number(b.volume || 0),
          })),
        );
      }
      if (qRes.ok) {
        const data = await qRes.json();
        const items = Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data?.quotes)
            ? data.quotes
            : [];
        const hit =
          items.find(
            (it: SnapshotQuote & { code?: string; klineSymbol?: string }) =>
              String(it.klineSymbol || it.code || '') === symbol,
          ) || items[0];
        if (hit) setQuote(hit);
      }
    } catch {
      /* 行情可选 */
    }
  }, [symbol]);

  const fetchPage = useCallback(
    async (nextCursor: string | null, replace: boolean) => {
      if (!symbol) return;
      const qs = new URLSearchParams({ symbol, limit: '40' });
      if (nextCursor) qs.set('cursor', nextCursor);
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const res = await fetch(`/api/news/by-symbol?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const list = Array.isArray(data?.articles) ? (data.articles as NewsArticle[]) : [];
      setArticles((prev) => (replace ? list : [...prev, ...list]));
      setCursor(typeof data?.next_cursor === 'string' ? data.next_cursor : null);
    },
    [symbol, from, to],
  );

  const reload = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setError('');
    setExpandedId(null);
    try {
      await Promise.all([fetchPage(null, true), loadKlineAndQuote()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setArticles([]);
      setCursor(null);
    } finally {
      setLoading(false);
    }
  }, [symbol, fetchPage, loadKlineAndQuote]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const barsAsc = useMemo(() => sortedBars(bars), [bars]);
  const marketKind = useMemo(() => inferMarketKind(symbol), [symbol]);
  const livePct =
    quote?.changePercent != null && Number.isFinite(Number(quote.changePercent))
      ? Number(quote.changePercent)
      : null;

  const enriched = useMemo(() => {
    return articles.map((a) => {
      const impact = computeImpact(publishedAt(a), barsAsc, {
        market: marketKind,
        liveChangePercent: livePct,
      });
      return { article: a, impact };
    });
  }, [articles, barsAsc, marketKind, livePct]);

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const a of articles) {
      if (a.feed_title) set.add(a.feed_title);
    }
    return [...set].sort();
  }, [articles]);

  const filtered = useMemo(() => {
    if (!sourceFilter) return enriched;
    return enriched.filter(({ article }) => article.feed_title === sourceFilter);
  }, [enriched, sourceFilter]);

  const dayGroups = useMemo(() => groupByTradeDate(filtered), [filtered]);

  const anchorDates = useMemo(() => {
    const s = new Set<string>();
    for (const g of dayGroups) {
      if (g.tradeDate && g.tradeDate !== 'unknown') s.add(g.tradeDate);
    }
    return s;
  }, [dayGroups]);

  const displayName = quote?.name || nameParam || symbol;

  const onLoadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await fetchPage(cursor, false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const setMark = (articleId: number, mark: ReviewMark) => {
    if (!symbol) return;
    const cur = marks[String(articleId)] === mark ? '' : mark;
    saveReviewMark(symbol, articleId, cur);
    setMarks((prev) => {
      const next = { ...prev };
      if (!cur) delete next[String(articleId)];
      else next[String(articleId)] = cur;
      return next;
    });
  };

  const toggleExpand = (id: number) => {
    setExpandedId((cur) => (cur === id ? null : id));
  };

  if (!symbol) {
    return (
      <div className={styles.page}>
        <div className={styles.emptyHint}>缺少 symbol 参数。请从行情页资讯按钮进入。</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <h1>
            <Newspaper size={18} style={{ marginRight: 8, verticalAlign: -3 }} />
            {displayName}
          </h1>
          <p className={styles.meta}>
            {symbol}
            {quote?.price != null ? ` · 现价 ${Number(quote.price).toFixed(2)}` : ''}
            {quote?.changePercent != null ? (
              <span className={pctClass(Number(quote.changePercent))}>
                {` · 今日 ${formatPct(Number(quote.changePercent))}`}
              </span>
            ) : null}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.btn} onClick={() => openKline(symbol)}>
            <LineChart size={14} />
            打开 K 线
          </button>
          <button type="button" className={styles.btn} onClick={() => void reload()} disabled={loading}>
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
      </header>

      <div className={styles.filters}>
        <label>
          从
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          到
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          来源
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="">全部</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={styles.btn} onClick={() => void reload()}>
          应用筛选
        </button>
      </div>

      <MiniSpark bars={barsAsc} anchorDates={anchorDates} market={marketKind} />

      {loading ? <Loading text="加载资讯…" /> : null}
      {!loading && error ? (
        <div className={styles.emptyHint}>
          加载失败：{error}
          <br />
          请确认 feedgen 已启动，且两端 <code>FEEDGEN_SERVICE_TOKEN</code> 一致。
        </div>
      ) : null}
      {!loading && !error && dayGroups.length === 0 ? (
        <div className={styles.emptyHint}>
          feedgen 未匹配到与「{symbol}」相关的资讯。
          <br />
          可到{' '}
          <a href="http://127.0.0.1:3000/" target="_blank" rel="noopener noreferrer">
            feedgen
          </a>{' '}
          检查金融产品词典与打标。
        </div>
      ) : null}

      <div className={styles.timeline}>
        {dayGroups.map((group) => (
          <DaySection
            key={group.tradeDate}
            group={group}
            symbol={symbol}
            market={marketKind}
            expandedId={expandedId}
            marks={marks}
            onToggle={toggleExpand}
            onMark={setMark}
          />
        ))}
      </div>

      {cursor ? (
        <button
          type="button"
          className={`${styles.btn} ${styles.loadMore}`}
          disabled={loadingMore}
          onClick={() => void onLoadMore()}
        >
          {loadingMore ? '加载中…' : '加载更多'}
        </button>
      ) : null}
    </div>
  );
}

function DaySection({
  group,
  symbol,
  market,
  expandedId,
  marks,
  onToggle,
  onMark,
}: {
  group: DayGroup;
  symbol: string;
  market: MarketKind;
  expandedId: number | null;
  marks: Record<string, ReviewMark>;
  onToggle: (id: number) => void;
  onMark: (id: number, m: ReviewMark) => void;
}) {
  const impact = group.impact;
  return (
    <section className={styles.dayCard}>
      <header className={styles.dayHead}>
        <div className={styles.dayMeta}>
          <span className={styles.dayDate}>{formatDayLabel(group.tradeDate)}</span>
          <span className={styles.dayCount}>{group.items.length} 条</span>
          {impact?.pending ? <span className={styles.tag}>待收盘</span> : null}
          {impact?.mapLabel ? <span className={styles.tag}>{impact.mapLabel}</span> : null}
        </div>
        <PctButtons impact={impact} symbol={symbol} />
      </header>
      <div className={styles.dayList}>
        {group.items.map(({ article, impact: itemImpact }) => (
          <ArticleRow
            key={article.id}
            article={article}
            itemImpact={itemImpact}
            symbol={symbol}
            market={market}
            open={expandedId === article.id}
            mark={marks[String(article.id)] || ''}
            onToggle={() => onToggle(article.id)}
            onMark={onMark}
          />
        ))}
      </div>
    </section>
  );
}

function ArticleRow({
  article,
  itemImpact,
  symbol,
  market,
  open,
  mark,
  onToggle,
  onMark,
}: {
  article: NewsArticle;
  itemImpact: ImpactRow | null;
  symbol: string;
  market: MarketKind;
  open: boolean;
  mark: ReviewMark;
  onToggle: () => void;
  onMark: (id: number, m: ReviewMark) => void;
}) {
  const summary = displaySummary(article);
  const clock = formatClock(publishedAt(article), market);
  const session = itemImpact ? SESSION_LABEL[itemImpact.sessionTag] : '';

  return (
    <div className={styles.row}>
      <button
        type="button"
        className={`${styles.rowMain} ${open ? styles.rowOpen : ''}`}
        onClick={onToggle}
        aria-expanded={open}
      >
        <ChevronRight
          size={14}
          className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
        />
        <h3 className={styles.rowTitle}>{displayTitle(article)}</h3>
        <div className={styles.rowAside}>
          {session ? <span className={styles.sessionPill}>{session}</span> : null}
          <span>{clock}</span>
          {article.feed_title ? (
            <span className={styles.feedMuted} title={article.feed_title}>
              {article.feed_title}
            </span>
          ) : null}
        </div>
      </button>
      {open ? (
        <div className={styles.rowBody}>
          {summary ? <SummaryBody text={summary} /> : null}
          {article.finance_instruments?.length ? (
            <div className={styles.chips}>
              {article.finance_instruments.map((inst) => {
                const self =
                  inst.chart_symbol === symbol ||
                  inst.symbol === symbol ||
                  `us${inst.symbol}`.toLowerCase() === symbol.toLowerCase();
                return (
                  <a
                    key={inst.id}
                    className={`${styles.chip} ${self ? styles.chipSelf : ''}`}
                    href={`/dashboard/news?symbol=${encodeURIComponent(inst.chart_symbol)}&name=${encodeURIComponent(inst.name)}`}
                    onClick={(e) => {
                      if (self) e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    {inst.name}
                  </a>
                );
              })}
            </div>
          ) : null}
          <div className={styles.cardFoot}>
            <div className={styles.links}>
              {article.url ? (
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  原文 <ExternalLink size={11} />
                </a>
              ) : null}
              {article.reader_url ? (
                <a
                  href={article.reader_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  feedgen 阅读
                </a>
              ) : null}
            </div>
            <div className={styles.marks}>
              {(
                [
                  ['bull', '利好'],
                  ['bear', '利空'],
                  ['priced', '已计价'],
                ] as Array<[ReviewMark, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`${styles.markBtn} ${mark === key ? styles.markBtnActive : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMark(article.id, key);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
