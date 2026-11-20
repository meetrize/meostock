/**
 * 研判工作台 Portal 面板（Phase 1.1）
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { selectAllCodes, watchlistStore } from '@/services/watchlistStore';
import { formatPercent, getChangeColorClass } from '@/utils/format';
import styles from '../widgetContent.module.css';

type Thermo = {
  temperature?: number | null;
  stage?: string;
  stage_def?: string;
  breadth?: {
    rise?: number;
    fall?: number;
    limit_up?: number;
    limit_down?: number;
  };
  factors?: Array<{ id: string; name: string; score?: number; detail?: string }>;
  disclaimer?: string;
};

type Leader = {
  code: string;
  name: string;
  type?: string;
  changePercent?: number | null;
  stage?: string;
  leadingStock?: string | null;
  riseCount?: number | null;
  fallCount?: number | null;
};

const THEME_STAGE_LABEL: Record<string, string> = {
  seed: '萌芽',
  ferment: '发酵',
  climax: '高潮',
  ebb: '退潮',
};
const THEME_TYPE_LABEL: Record<string, string> = {
  industry: '行业',
  concept: '概念',
};

type Risk = {
  open_count?: number;
  violation_count?: number;
  max_single_weight_pct?: number;
  max_industry_weight_pct?: number;
  holdings?: Array<{
    symbol: string;
    name?: string;
    industry?: string;
    weight_pct?: number;
    has_stop?: boolean;
  }>;
  violations?: Array<{ message: string }>;
};

const STAGE_LABEL: Record<string, string> = {
  ice: '冰点',
  start: '启动',
  main: '主升',
  diverge: '分歧',
  ebb: '退潮',
  unknown: '未知',
};

function useJson<T>(url: string, intervalMs = 60_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch(url);
      const j = await res.json();
      if (!res.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${res.status}`);
      setData(j as T);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [url]);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), intervalMs);
    return () => window.clearInterval(t);
  }, [load, intervalMs]);
  return { data, error, reload: load };
}

export function ResearchRegimeWidget() {
  const { data, error } = useJson<{
    regime?: { risk_appetite?: string; position_bias?: string; label?: string };
    market?: { temperature?: number | null; stage?: string };
  }>('/api/research/regime');
  const bias = data?.regime?.position_bias || 'neutral';
  const label =
    bias === 'offensive' ? '偏进攻' : bias === 'defensive' ? '偏防守' : '中性';
  return (
    <div className={styles.statCard}>
      <div className={styles.statValueLarge}>{label}</div>
      <div className={styles.statMeta}>
        <span>Regime · {STAGE_LABEL[data?.market?.stage || ''] || data?.regime?.label || '—'}</span>
        <span>T {data?.market?.temperature ?? '—'}</span>
      </div>
      {error ? <div className={styles.statHint}>{error}</div> : null}
      <div className={styles.statHint}>宏观序列仍为占位；温度来自规则引擎</div>
    </div>
  );
}

export function ResearchMarketThermometerWidget() {
  const { data, error } = useJson<Thermo>('/api/research/market-thermometer');
  const stage = STAGE_LABEL[data?.stage || ''] || data?.stage || '—';
  return (
    <div className={styles.listPanel}>
      <div className={styles.listHeaderRow}>
        <strong>温度 {data?.temperature ?? '—'}</strong>
        <span>{stage}</span>
      </div>
      <p className={styles.listSub}>{data?.stage_def || '加载中…'}</p>
      <div className={styles.statMeta}>
        <span>
          涨{data?.breadth?.rise ?? '—'}/跌{data?.breadth?.fall ?? '—'}
        </span>
        <span>
          涨停{data?.breadth?.limit_up ?? '—'}/跌停{data?.breadth?.limit_down ?? '—'}
        </span>
      </div>
      <ul className={styles.compactList}>
        {(data?.factors || []).slice(0, 5).map((f) => (
          <li key={f.id}>
            <span>{f.name}</span>
            <span>
              {f.score ?? '—'} · {f.detail}
            </span>
          </li>
        ))}
      </ul>
      {error ? <div className={styles.statHint}>{error}</div> : null}
      <Link className={styles.inlineLink} to="/research">
        打开研判总览
      </Link>
    </div>
  );
}

export function ResearchThemeLeadersWidget({ gridH }: { gridH: number }) {
  const { data, error } = useJson<{ leaders?: Leader[] }>(
    '/api/research/themes/leaders?limit=12'
  );
  const limit = Math.max(4, Math.min(12, Math.floor(gridH * 1.2)));
  return (
    <div className={styles.listPanel}>
      <div className={styles.listHeaderRow}>
        <strong>主线板块</strong>
        <Link to="/boards">更多</Link>
      </div>
      <div className={styles.boardList}>
        {(data?.leaders || []).slice(0, limit).map((b) => (
          <Link
            key={`${b.type}-${b.code}`}
            className={styles.boardItem}
            to={`/boards/${b.type || 'concept'}/${b.code}`}
          >
            <div className={styles.boardLeft}>
              <div className={styles.boardInfo}>
                <span className={styles.boardName}>{b.name}</span>
                <span className={styles.boardLeader}>
                  {THEME_TYPE_LABEL[b.type || ''] || b.type} ·{' '}
                  {THEME_STAGE_LABEL[b.stage || ''] || b.stage || '—'} ·{' '}
                  {b.leadingStock || '—'}
                </span>
              </div>
            </div>
            <div
              className={`${styles.boardChange} ${getChangeColorClass(b.changePercent)}`}
            >
              {formatPercent(b.changePercent)}
            </div>
          </Link>
        ))}
      </div>
      {error ? <div className={styles.statHint}>{error}</div> : null}
      {!data?.leaders?.length && !error ? (
        <div className={styles.statHint}>暂无主线数据</div>
      ) : null}
    </div>
  );
}

export function ResearchRadarWatchlistWidget() {
  const [codes, setCodes] = useState(() => selectAllCodes(watchlistStore.getSnapshot()));
  useEffect(() => {
    return watchlistStore.subscribe(() => {
      setCodes(selectAllCodes(watchlistStore.getSnapshot()));
    });
  }, []);
  return (
    <div className={styles.listPanel}>
      <div className={styles.listHeaderRow}>
        <strong>自选雷达</strong>
        <Link to="/watchlist">观察池</Link>
      </div>
      <p className={styles.listSub}>观察池（非持仓）；点开个股页可看六维 Scorecard</p>
      <ul className={styles.compactList}>
        {codes.slice(0, 16).map((c) => (
          <li key={c}>
            <Link to={`/s/${c}`}>{c}</Link>
            <span className={styles.pillMuted}>Scorecard</span>
          </li>
        ))}
      </ul>
      {!codes.length ? <div className={styles.statHint}>观察池为空</div> : null}
    </div>
  );
}

export function ResearchPortfolioRiskWidget() {
  const { data, error } = useJson<Risk>('/api/research/portfolio/risk');
  return (
    <div className={styles.listPanel}>
      <div className={styles.listHeaderRow}>
        <strong>组合风控</strong>
        <span>
          open {data?.open_count ?? 0} · 违规 {data?.violation_count ?? 0}
        </span>
      </div>
      <div className={styles.statMeta}>
        <span>
          单票顶 {data?.max_single_weight_pct ?? '—'}% · 行业顶{' '}
          {data?.max_industry_weight_pct ?? '—'}%
        </span>
      </div>
      <ul className={styles.compactList}>
        {(data?.holdings || []).slice(0, 8).map((h) => (
          <li key={h.symbol}>
            <span>
              {h.symbol} {h.name || ''}
              {h.industry ? ` · ${h.industry}` : ''}
            </span>
            <span>
              {h.weight_pct ?? '—'}%
              {h.has_stop ? '' : ' · 缺止损'}
            </span>
          </li>
        ))}
      </ul>
      {(data?.violations || []).slice(0, 3).map((v, i) => (
        <div key={i} className={styles.statHint} style={{ color: 'var(--color-fall, #ef4444)' }}>
          {v.message}
        </div>
      ))}
      {error ? <div className={styles.statHint}>{error}</div> : null}
      <Link className={styles.inlineLink} to="/research">
        管理交易卡片
      </Link>
    </div>
  );
}

type Brief = {
  ok?: boolean;
  brief?: {
    direction?: string;
    confidence?: string;
    summary?: string;
    evidence_ids?: string[];
  };
  validation?: { status?: string };
  context?: { conflict_count?: number; event_count?: number };
  disclaimer?: string;
  error?: string;
};

export function ResearchAiBriefWidget() {
  const [code, setCode] = useState(() => {
    const codes = selectAllCodes(watchlistStore.getSnapshot());
    return codes[0] || '600519';
  });
  const [data, setData] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/research/ai/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: code, strategy_template_id: 'long' }),
      });
      const json = (await res.json()) as Brief;
      setData(json);
      if (!json?.ok && json?.error) setError(String(json.error));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [code]);

  useEffect(() => {
    void run();
  }, [run]);

  const b = data?.brief;
  return (
    <div className={styles.listPanel}>
      <div className={styles.listHeaderRow}>
        <strong>今日简报</strong>
        <button type="button" className={styles.inlineLink} onClick={() => void run()} disabled={busy}>
          {busy ? '生成中…' : '刷新'}
        </button>
      </div>
      <div className={styles.statMeta}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onBlur={() => void run()}
          style={{ width: '100%', fontSize: 12 }}
          aria-label="简报标的"
        />
      </div>
      <div className={styles.statMeta}>
        <span>
          {data?.validation?.status || '—'} · {b?.direction || '—'} · {b?.confidence || ''}
        </span>
      </div>
      <p className={styles.listSub}>{b?.summary || '—'}</p>
      <div className={styles.statHint}>
        evidence {b?.evidence_ids?.length ?? 0} · 冲突 {data?.context?.conflict_count ?? 0} · 事件{' '}
        {data?.context?.event_count ?? 0} · 非荐股
      </div>
      {error ? <div className={styles.statHint}>{error}</div> : null}
      <Link className={styles.inlineLink} to={`/s/${encodeURIComponent(code)}`}>
        打开个股
      </Link>
    </div>
  );
}

type TimelinePayload = {
  ok?: boolean;
  symbol?: string;
  event_count?: number;
  events?: Array<{ id: string; kind: string; title: string; at?: string }>;
  data_gaps?: string[];
  error?: string;
};

export function ResearchEventTimelineWidget() {
  const [code, setCode] = useState(() => {
    const codes = selectAllCodes(watchlistStore.getSnapshot());
    return codes[0] || '600519';
  });
  const { data, error, reload } = useJson<TimelinePayload>(
    `/api/research/stock/${encodeURIComponent(code)}/timeline?limit=12`
  );

  return (
    <div className={styles.listPanel}>
      <div className={styles.listHeaderRow}>
        <strong>事件轴</strong>
        <button type="button" className={styles.inlineLink} onClick={() => reload()}>
          刷新
        </button>
      </div>
      <div className={styles.statMeta}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          style={{ width: '100%', fontSize: 12 }}
          aria-label="事件轴标的"
        />
      </div>
      <p className={styles.listSub}>
        {data?.event_count ?? 0} 条
        {data?.data_gaps?.length ? ` · gaps ${data.data_gaps.join(',')}` : ''}
      </p>
      <ul className={styles.compactList}>
        {(data?.events || []).slice(0, 10).map((e) => (
          <li key={e.id}>
            <span>
              [{e.kind}] {e.title}
            </span>
            <span>{e.at || ''}</span>
          </li>
        ))}
      </ul>
      {!data?.events?.length && !error ? (
        <div className={styles.statHint}>暂无事件</div>
      ) : null}
      {error ? <div className={styles.statHint}>{error}</div> : null}
      <Link className={styles.inlineLink} to={`/s/${encodeURIComponent(code)}`}>
        个股详情
      </Link>
    </div>
  );
}
