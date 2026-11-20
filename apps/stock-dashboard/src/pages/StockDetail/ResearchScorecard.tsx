/**
 * 个股六维 Scorecard + 一致性 + 商业模式三态（Phase 2）
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Loading } from '@/components/common';
import styles from './ResearchScorecard.module.css';

type Dim = {
  dim?: string;
  label_zh?: string;
  mode?: string;
  enabled?: boolean;
  counts_toward_total?: boolean;
  score?: number | null;
  pill?: string;
  label?: string;
  state?: string;
  pe?: number | null;
  pb?: number | null;
  pe_percentile?: number | null;
  pb_percentile?: number | null;
  band?: string;
  metrics?: Record<string, number | null | undefined>;
  data_gap?: boolean;
  note?: string;
  source?: string;
};

type Scorecard = {
  ok?: boolean;
  symbol?: string;
  name?: string;
  total_score?: number | null;
  total_note?: string;
  business_mode_state?: string;
  can_open_trade_card?: boolean;
  dimensions?: Record<string, Dim>;
  fina_probe?: { mode?: string; fina_indicator?: boolean; hint?: string };
  data_gaps?: string[];
  disclaimer?: string;
  strategy_template?: { id?: string; name?: string };
  error?: string;
};

type Consistency = {
  ok?: boolean;
  conflict_count?: number;
  conflicts?: Array<{ id: string; severity: string; message: string; dims?: string[] }>;
  directions?: Record<string, string>;
};

const TEMPLATES = [
  { key: 'long', label: '长线' },
  { key: 'swing', label: '波段' },
  { key: 'short', label: '短线' },
];

const BIZ_STATES = [
  { key: 'unverified', label: '未验证' },
  { key: 'doubt', label: '存疑' },
  { key: 'clear', label: '清晰' },
] as const;

function modeClass(mode?: string) {
  if (mode === 'on') return styles.modeOn;
  if (mode === 'weak') return styles.modeWeak;
  return styles.modeOff;
}

export function ResearchScorecard({ code }: { code: string }) {
  const [template, setTemplate] = useState('long');
  const [card, setCard] = useState<Scorecard | null>(null);
  const [cons, setCons] = useState<Consistency | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    setErr(null);
    try {
      const q = `strategy_template_id=${encodeURIComponent(template)}`;
      const [sc, cs] = await Promise.all([
        fetch(`/api/research/stock/${encodeURIComponent(code)}/scorecard?${q}`).then((r) =>
          r.json()
        ),
        fetch(`/api/research/stock/${encodeURIComponent(code)}/consistency?${q}`).then((r) =>
          r.json()
        ),
      ]);
      setCard(sc);
      setCons(cs);
      if (!sc?.ok && sc?.error) setErr(String(sc.error));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [code, template]);

  useEffect(() => {
    void load();
  }, [load]);

  const setBiz = async (state: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/research/stock/${encodeURIComponent(code)}/business-mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, note: '' }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const dims = card?.dimensions || {};
  const dimOrder = ['business', 'fina', 'valuation', 'trend', 'volume', 'event'];

  return (
    <Card
      title="研判 Scorecard"
      extra={
        <div className={styles.extra}>
          <div className={styles.tmplRow}>
            {TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`${styles.tmplBtn} ${template === t.key ? styles.tmplActive : ''}`}
                onClick={() => setTemplate(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Link className={styles.link} to="/research">
            工作台
          </Link>
        </div>
      }
    >
      {loading ? <Loading text="加载六维…" /> : null}
      {err ? <p className={styles.err}>{err}</p> : null}

      {!loading && card?.ok ? (
        <>
          <div className={styles.headRow}>
            <div>
              <span className={styles.totalLabel}>综合分</span>
              <strong className={styles.total}>
                {card.total_score != null ? card.total_score.toFixed(0) : '—'}
              </strong>
              <span className={styles.muted}> · {card.strategy_template?.name || template}</span>
            </div>
            <div className={styles.conflictBadge} data-level={cons?.conflict_count ? 'warn' : 'ok'}>
              冲突 {cons?.conflict_count ?? 0}
            </div>
          </div>
          <p className={styles.note}>{card.total_note}</p>

          <div className={styles.pillRow}>
            {dimOrder.map((key) => {
              const d = dims[key];
              if (!d) return null;
              return (
                <div
                  key={key}
                  className={`${styles.pill} ${modeClass(d.mode)}`}
                  title={d.note || d.source || ''}
                >
                  <span className={styles.pillName}>{d.label_zh || key}</span>
                  <span className={styles.pillVal}>{d.pill ?? '—'}</span>
                </div>
              );
            })}
          </div>

          <div className={styles.bizRow}>
            <span className={styles.bizLabel}>商业模式</span>
            {BIZ_STATES.map((s) => (
              <Button
                key={s.key}
                size="sm"
                variant={card.business_mode_state === s.key ? 'primary' : 'secondary'}
                disabled={busy}
                onClick={() => void setBiz(s.key)}
              >
                {s.label}
              </Button>
            ))}
            {!card.can_open_trade_card ? (
              <span className={styles.warn}>未验证时禁止 open 交易卡片</span>
            ) : null}
          </div>

          {(cons?.conflicts || []).length ? (
            <ul className={styles.conflicts}>
              {cons!.conflicts!.map((c) => (
                <li key={c.id} data-sev={c.severity}>
                  {c.message}
                </li>
              ))}
            </ul>
          ) : null}

          <div className={styles.detailGrid}>
            {dims.valuation ? (
              <div className={styles.detail}>
                <h4>估值</h4>
                <p>
                  PE {dims.valuation.pe ?? '—'} · 分位{' '}
                  {dims.valuation.pe_percentile ?? '—'}（越高越便宜）
                </p>
                <p>
                  PB {dims.valuation.pb ?? '—'} · 分位{' '}
                  {dims.valuation.pb_percentile ?? '—'} · {dims.valuation.band || ''}
                </p>
              </div>
            ) : null}
            {dims.fina ? (
              <div className={styles.detail}>
                <h4>财务</h4>
                {dims.fina.data_gap || !dims.fina.metrics ? (
                  <p className={styles.muted}>
                    {card.fina_probe?.hint || '财务维空态（权限降级）'}
                  </p>
                ) : (
                  <p>
                    ROE {dims.fina.metrics.roe ?? '—'} · 毛利{' '}
                    {dims.fina.metrics.grossprofit_margin ?? '—'} · 负债{' '}
                    {dims.fina.metrics.debt_to_assets ?? '—'}
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <p className={styles.footer}>
            {card.disclaimer}
            {card.data_gaps?.length ? ` · gaps: ${card.data_gaps.join(',')}` : ''}
          </p>
        </>
      ) : null}
    </Card>
  );
}
