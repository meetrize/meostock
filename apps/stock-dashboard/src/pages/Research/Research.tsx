/**
 * 研判工作台总览（Phase 4：回测 / 行为偏差 / 说明书）
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Loading } from '@/components/common';
import styles from './Research.module.css';

type HealthPayload = { ok?: boolean; version?: string; phase?: string };
type ThermoPayload = {
  ok?: boolean;
  as_of?: string;
  temperature?: number | null;
  stage?: string;
  stage_def?: string;
  factors?: Array<{
    id: string;
    name: string;
    score?: number;
    detail?: string;
    caveat?: string | null;
  }>;
  breadth?: {
    rise?: number;
    fall?: number;
    flat?: number;
    limit_up?: number;
    limit_down?: number;
    one_word_up?: number;
    total_amount_wan?: number;
  };
  data_gaps?: string[];
  disclaimer?: string;
  northbound_note?: string;
  error?: string;
};
type ThemesPayload = {
  ok?: boolean;
  leaders?: Array<{
    code: string;
    name: string;
    type?: string;
    changePercent?: number | null;
    stage?: string;
    leadingStock?: string | null;
    riseCount?: number | null;
    fallCount?: number | null;
  }>;
  sources?: { industry?: string; concept?: string };
  errors?: string[];
  fund_flow_note?: string;
  disclaimer?: string;
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
type RiskPayload = {
  ok?: boolean;
  open_count?: number;
  max_single_weight_pct?: number;
  max_industry_weight_pct?: number;
  violation_count?: number;
  violations?: Array<{ code: string; symbol: string; message: string }>;
  industry_exposure?: Array<{ industry: string; weight_pct: number }>;
  rebalance_hints?: string[];
  holdings?: Array<{
    id?: string;
    symbol: string;
    name?: string;
    industry?: string;
    position_pct?: number;
    weight_pct?: number;
    has_stop?: boolean;
    stop_rule?: string | null;
    pnl_pct?: number | null;
  }>; // id 用于结案
  disclaimer?: string;
};

type ScanHit = {
  symbol: string;
  name?: string;
  pe?: number | null;
  pb?: number | null;
  pe_percentile?: number | null;
  valuation_score?: number | null;
  tradeable?: boolean;
  tradability?: { label?: string };
};

const LINKS: Array<{
  to: string;
  title: string;
  desc: string;
  meta: string;
  external?: boolean;
}> = [
  { to: '/dapan/', title: '大盘云图', desc: '全市场宽度可视化', meta: '路径 A', external: true },
  { to: '/boards', title: '板块', desc: '行业 / 概念轮动', meta: '路径 A' },
  { to: '/fupan', title: '涨停复盘', desc: '短线桌嵌入（规则分走本地）', meta: '短线' },
  { to: '/scanner', title: '扫描', desc: '含可成交标记', meta: '路径 C' },
  { to: '/watchlist', title: '观察池', desc: '非持仓', meta: '观察' },
  {
    to: '/agent?scopeType=market&scopeId=ashare',
    title: '问 Agent',
    desc: '绑定大盘 Scope',
    meta: 'Scope',
  },
];

const STAGE_LABEL: Record<string, string> = {
  ice: '冰点',
  start: '启动',
  main: '主升',
  diverge: '分歧',
  ebb: '退潮',
  unknown: '未知',
};

function fmtPct(v?: number | null) {
  if (v == null || Number.isNaN(v)) return '—';
  const s = v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
  return `${s}%`;
}

export function Research() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [thermo, setThermo] = useState<ThermoPayload | null>(null);
  const [themes, setThemes] = useState<ThemesPayload | null>(null);
  const [risk, setRisk] = useState<RiskPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cardSymbol, setCardSymbol] = useState('600036.SH');
  const [cardStop, setCardStop] = useState('跌破 MA20');
  const [cardPos, setCardPos] = useState('8');
  const [cardBusy, setCardBusy] = useState(false);
  const [cardMsg, setCardMsg] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanHits, setScanHits] = useState<ScanHit[]>([]);
  const [scanMeta, setScanMeta] = useState<string | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefText, setBriefText] = useState<string | null>(null);
  const [review, setReview] = useState<{
    closed_count?: number;
    win_rate_pct?: number | null;
    payoff_ratio?: number | null;
    max_drawdown_pct?: number | null;
    avg_excess_pct?: number | null;
    information_ratio?: number | null;
    field_completeness_avg_pct?: number | null;
    falsify?: { coverage_pct?: number | null; triggered_count?: number };
    data_gaps?: string[];
    disclaimer?: string;
  } | null>(null);
  const [closeId, setCloseId] = useState('');
  const [closeReason, setCloseReason] = useState('达到目标 / 证伪触发');
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeMsg, setCloseMsg] = useState<string | null>(null);
  const [btBusy, setBtBusy] = useState(false);
  const [btText, setBtText] = useState<string | null>(null);
  const [specText, setSpecText] = useState<string | null>(null);
  const [behavior, setBehavior] = useState<{
    triggered_count?: number;
    biases?: Array<{
      id: string;
      name: string;
      triggered?: boolean;
      detail?: string;
      severity?: string;
    }>;
    suggested_attribution_tags?: string[];
    disclaimer?: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, t, th, r, rv, bh] = await Promise.all([
        fetch('/api/research/health').then((res) => res.json()),
        fetch('/api/research/market-thermometer').then((res) => res.json()),
        fetch('/api/research/themes/leaders?limit=10').then((res) => res.json()),
        fetch('/api/research/portfolio/risk').then((res) => res.json()),
        fetch('/api/research/review/report').then((res) => res.json()),
        fetch('/api/research/behavior/report').then((res) => res.json()),
      ]);
      setHealth(h);
      setThermo(t);
      setThemes(th);
      setRisk(r);
      setReview(rv?.ok ? rv : null);
      setBehavior(bh?.ok ? bh : null);
      if (!t?.ok && t?.error) setError(String(t.error));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runBacktest = async () => {
    setBtBusy(true);
    setBtText(null);
    setSpecText(null);
    try {
      const sym = cardSymbol.trim() || '600519';
      const [btRes, spRes] = await Promise.all([
        fetch('/api/research/backtest/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: sym, template_id: 'ma_trend' }),
        }).then((r) => r.json()),
        fetch('/api/research/strategy/spec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: sym,
            strategy_template_id: 'long',
            format: 'markdown',
            include_backtest: true,
          }),
        }).then((r) => r.json()),
      ]);
      if (!btRes?.ok) {
        setBtText(btRes?.message || btRes?.error || '回测失败');
      } else {
        setBtText(
          `${btRes.experimental_label} · ${btRes.rule_version} · 样本内净 ${btRes.train?.total_net_pct ?? '—'}% / 样本外净 ${btRes.test?.total_net_pct ?? '—'}% · 成交 ${btRes.trade_count} · 跳过不可成交 ${btRes.skipped_count}`
        );
      }
      if (spRes?.markdown) setSpecText(spRes.markdown);
      else if (spRes?.experimental_label) {
        setSpecText(`【${spRes.experimental_label}】说明书已生成（无 markdown）`);
      }
    } catch (err) {
      setBtText(err instanceof Error ? err.message : String(err));
    } finally {
      setBtBusy(false);
    }
  };

  const runBrief = async () => {
    setBriefBusy(true);
    setBriefText(null);
    try {
      const res = await fetch('/api/research/ai/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: cardSymbol.trim() || '600519',
          strategy_template_id: 'long',
        }),
      });
      const data = await res.json();
      const b = data?.brief || {};
      setBriefText(
        `[${data?.validation?.status || '?'}] ${b.direction || '—'} · ${b.confidence || ''} · ${b.summary || data?.error || ''}` +
          (b.evidence_ids?.length ? ` · evidence ${b.evidence_ids.length}` : '') +
          ' · 非荐股'
      );
    } catch (err) {
      setBriefText(err instanceof Error ? err.message : String(err));
    } finally {
      setBriefBusy(false);
    }
  };

  const closeOpenCard = async () => {
    setCloseBusy(true);
    setCloseMsg(null);
    try {
      let id = closeId.trim();
      if (!id) {
        const open = (risk?.holdings || [])[0];
        id = String(open?.id || '');
      }
      if (!id) throw new Error('请填写卡片 id，或先创建 open 卡片');
      const res = await fetch(`/api/research/cards/${encodeURIComponent(id)}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exit_reason: closeReason.trim(),
          attribution_tags: ['手工结案'],
          attribution_note: 'Phase3 总览结案',
          falsify_triggered: [],
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setCloseMsg(
        `已结案 pnl ${data.pnl_pct ?? '—'}% · falsify 触发 ${data.falsify_check?.any_triggered ? '是' : '否'}`
      );
      await refresh();
    } catch (err) {
      setCloseMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCloseBusy(false);
    }
  };

  const runQualityScan = async () => {
    setScanBusy(true);
    setScanMeta(null);
    try {
      const res = await fetch('/api/research/scanner/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: 'quality_value',
          params: { limit: 20, pe_percentile_max: 30, pb_percentile_max: 40 },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setScanHits(data.results || []);
      setScanMeta(
        `扫描 ${data.scanned ?? '—'} · 命中 ${data.hit_count ?? 0} · 返回 ${data.returned ?? 0}` +
          (data.fina_probe?.hint ? ` · ${data.fina_probe.hint}` : '')
      );
    } catch (err) {
      setScanMeta(err instanceof Error ? err.message : String(err));
      setScanHits([]);
    } finally {
      setScanBusy(false);
    }
  };

  const createOpenCard = async () => {
    setCardBusy(true);
    setCardMsg(null);
    try {
      const res = await fetch('/api/research/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: cardSymbol.trim(),
          thesis: 'Phase1 最小卡片',
          position_pct: Number(cardPos) || 8,
          stop_rule: cardStop.trim(),
          status: 'open',
          business_mode_state: 'clear',
          entry_price: null,
          evidence: [],
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setCardMsg(`已创建 open 卡片 ${data.card?.id?.slice(0, 8)}…`);
      const r = await fetch('/api/research/portfolio/risk').then((x) => x.json());
      setRisk(r);
    } catch (err) {
      setCardMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCardBusy(false);
    }
  };

  const deleteHoldingCard = async (cardId: string | undefined, symbol: string) => {
    if (!cardId) {
      setCardMsg(`无法删除 ${symbol}：缺少卡片 id`);
      return;
    }
    if (!window.confirm(`确定删除持仓卡片 ${symbol}？此操作不可恢复。`)) return;
    setCardBusy(true);
    setCardMsg(null);
    try {
      const res = await fetch(`/api/research/cards/${encodeURIComponent(cardId)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setCardMsg(`已删除 ${symbol}`);
      const [r, rv, bh] = await Promise.all([
        fetch('/api/research/portfolio/risk').then((x) => x.json()),
        fetch('/api/research/review/report').then((x) => x.json()),
        fetch('/api/research/behavior/report').then((x) => x.json()),
      ]);
      setRisk(r);
      setReview(rv?.ok ? rv : null);
      setBehavior(bh?.ok ? bh : null);
    } catch (err) {
      setCardMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCardBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>研判工作台</h1>
          <p className={styles.subtitle}>
            Phase 4：回测（样本外/实验性）、行为偏差、策略说明书。证据优先；不构成投资建议。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {health?.ok ? (
            <span className={styles.badge}>
              API v{health.version ?? '?'} · P{health.phase ?? '?'}
            </span>
          ) : null}
          <Button size="sm" onClick={() => void refresh()} disabled={loading}>
            刷新
          </Button>
        </div>
      </header>

      {loading ? <Loading text="加载研判数据..." /> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      {!loading && thermo ? (
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>大盘温度</h2>
            <span className={styles.badge}>
              {STAGE_LABEL[thermo.stage || ''] || thermo.stage || '—'} ·{' '}
              {thermo.temperature != null ? `${thermo.temperature}` : '—'}
            </span>
          </div>
          <p className={styles.panelHint}>{thermo.stage_def}</p>
          <div className={styles.regimeBar}>
            <div className={styles.regimeItem}>
              <label>涨/跌/平</label>
              <strong>
                {thermo.breadth?.rise ?? '—'}/{thermo.breadth?.fall ?? '—'}/
                {thermo.breadth?.flat ?? '—'}
              </strong>
            </div>
            <div className={styles.regimeItem}>
              <label>涨停/跌停/一字</label>
              <strong>
                {thermo.breadth?.limit_up ?? '—'}/{thermo.breadth?.limit_down ?? '—'}/
                {thermo.breadth?.one_word_up ?? '—'}
              </strong>
            </div>
            <div className={styles.regimeItem}>
              <label>成交额(万)</label>
              <strong>{thermo.breadth?.total_amount_wan?.toFixed?.(0) ?? '—'}</strong>
            </div>
          </div>
          <div className={styles.factorList}>
            {(thermo.factors || []).map((f) => (
              <div key={f.id} className={styles.factorRow}>
                <span>
                  {f.name}
                  {f.caveat ? ` · ${f.caveat}` : ''}
                </span>
                <span>
                  分 {f.score ?? '—'} · {f.detail}
                </span>
              </div>
            ))}
          </div>
          <p className={styles.footerNote}>
            {thermo.northbound_note} · {thermo.disclaimer}
            {thermo.data_gaps?.length ? ` · gaps: ${thermo.data_gaps.join(',')}` : ''}
          </p>
        </section>
      ) : null}

      {!loading && themes ? (
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>主线板块 Top</h2>
            <Link className={styles.badge} to="/boards">
              打开板块页
            </Link>
          </div>
          <p className={styles.panelHint}>
            按涨幅 + 涨跌家数扩散 + 领涨股；生命周期为规则启发式。
            {themes.sources
              ? ` · 源 industry=${themes.sources.industry || '—'} / concept=${themes.sources.concept || '—'}`
              : ''}
          </p>
          <div className={styles.themeList}>
            {(themes.leaders || []).map((b) => (
              <Link
                key={`${b.type}-${b.code}`}
                className={styles.themeItem}
                to={`/boards/${b.type || 'concept'}/${encodeURIComponent(b.code)}`}
              >
                <div>
                  <strong>{b.name}</strong>
                  <span className={styles.muted}>
                    {' '}
                    {THEME_TYPE_LABEL[b.type || ''] || b.type} ·{' '}
                    {THEME_STAGE_LABEL[b.stage || ''] || b.stage || '—'}
                    {b.riseCount != null || b.fallCount != null
                      ? ` · 涨${b.riseCount ?? '—'}/跌${b.fallCount ?? '—'}`
                      : ''}
                    {' · 领涨 '}
                    {b.leadingStock || '—'}
                  </span>
                </div>
                <span
                  className={
                    (b.changePercent || 0) >= 0 ? styles.up : styles.down
                  }
                >
                  {fmtPct(b.changePercent)}
                </span>
              </Link>
            ))}
            {!themes.leaders?.length ? (
              <p className={styles.muted}>
                暂无主线数据。请先在板块页同步目录，或检查网络。
                {themes.errors?.length ? `（${themes.errors.join('; ')}）` : ''}
              </p>
            ) : null}
          </div>
          {themes.fund_flow_note ? (
            <p className={styles.footerNote}>{themes.fund_flow_note}</p>
          ) : null}
        </section>
      ) : null}

      {!loading ? (
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>回测 / 策略说明书</h2>
            <Button size="sm" loading={btBusy} onClick={() => void runBacktest()}>
              运行 MA 回测
            </Button>
          </div>
          <p className={styles.panelHint}>
            填入个股代码后点「运行 MA 回测」：用日 K 测「价&gt;MA60 且 MA20&gt;MA60」开平仓；
            遵守涨跌停不可成交、T+1、成本；时间序列前 70% 为样本内、后 30% 为样本外；未通过样本外则标「实验性」。
            成功后下方展示一行回测摘要 + Markdown 说明书（可复制）。
          </p>
          <div className={styles.cardForm}>
            <input
              value={cardSymbol}
              onChange={(e) => setCardSymbol(e.target.value)}
              placeholder="代码 如 600519 或 600036.SH"
              className={styles.input}
              aria-label="回测标的代码"
            />
          </div>
          {btText ? <p className={styles.muted}>{btText}</p> : null}
          {specText ? (
            <pre className={styles.muted} style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>
              {specText}
            </pre>
          ) : null}
        </section>
      ) : null}

      {!loading ? (
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>行为偏差</h2>
            <span className={styles.badge}>触发 {behavior?.triggered_count ?? 0}</span>
          </div>
          <div className={styles.factorList}>
            {(behavior?.biases || []).map((b) => (
              <div key={b.id} className={styles.factorRow}>
                <span>
                  {b.name}
                  {b.triggered ? ' · 触发' : ''}
                </span>
                <span>{b.detail}</span>
              </div>
            ))}
            {!behavior?.biases?.length ? (
              <p className={styles.muted}>暂无偏差样本（需结案交易卡片）</p>
            ) : null}
          </div>
          {(behavior?.suggested_attribution_tags || []).length ? (
            <p className={styles.panelHint}>
              建议 attribution_tags：{behavior!.suggested_attribution_tags!.join('、')}
            </p>
          ) : null}
          <p className={styles.footerNote}>{behavior?.disclaimer}</p>
        </section>
      ) : null}

      {!loading ? (
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>AI 简报（校验层）</h2>
            <Button size="sm" loading={briefBusy} onClick={() => void runBrief()}>
              生成简报
            </Button>
          </div>
          <p className={styles.panelHint}>
            使用上方代码框中的标的；规则组装 + 证据校验，不自动荐股。
          </p>
          {briefText ? <p className={styles.muted}>{briefText}</p> : null}
        </section>
      ) : null}

      {!loading ? (
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>复盘报表</h2>
            <span className={styles.badge}>
              结案 {review?.closed_count ?? 0} · 完整率{' '}
              {review?.field_completeness_avg_pct ?? '—'}%
            </span>
          </div>
          <div className={styles.regimeBar}>
            <div className={styles.regimeItem}>
              <label>胜率</label>
              <strong>
                {review?.win_rate_pct != null ? `${review.win_rate_pct}%` : '—'}
              </strong>
            </div>
            <div className={styles.regimeItem}>
              <label>盈亏比</label>
              <strong>{review?.payoff_ratio ?? '—'}</strong>
            </div>
            <div className={styles.regimeItem}>
              <label>最大回撤</label>
              <strong>
                {review?.max_drawdown_pct != null ? `${review.max_drawdown_pct}%` : '—'}
              </strong>
            </div>
            <div className={styles.regimeItem}>
              <label>超额 / IR</label>
              <strong>
                {review?.avg_excess_pct ?? '—'} / {review?.information_ratio ?? '—'}
              </strong>
            </div>
          </div>
          <p className={styles.footerNote}>
            falsify 覆盖 {review?.falsify?.coverage_pct ?? '—'}% · 触发{' '}
            {review?.falsify?.triggered_count ?? 0}
            {review?.data_gaps?.length ? ` · gaps: ${review.data_gaps.join(',')}` : ''}
            {review?.disclaimer ? ` · ${review.disclaimer}` : ''}
          </p>
          <div className={styles.cardForm}>
            <input
              value={closeId}
              onChange={(e) => setCloseId(e.target.value)}
              placeholder="结案卡片 id（空=第一只 open）"
              className={styles.input}
            />
            <input
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
              placeholder="exit_reason 归因"
              className={styles.input}
            />
            <Button size="sm" loading={closeBusy} onClick={() => void closeOpenCard()}>
              结案核对
            </Button>
          </div>
          {closeMsg ? <p className={styles.muted}>{closeMsg}</p> : null}
        </section>
      ) : null}

      {!loading ? (
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>质量+低估值扫描</h2>
            <Button size="sm" loading={scanBusy} onClick={() => void runQualityScan()}>
              运行扫描
            </Button>
          </div>
          {scanMeta ? <p className={styles.panelHint}>{scanMeta}</p> : null}
          <div className={styles.themeList}>
            {scanHits.map((h) => (
              <Link key={h.symbol} className={styles.themeItem} to={`/s/${h.symbol}`}>
                <div>
                  <strong>{h.name || h.symbol}</strong>
                  <span className={styles.muted}>
                    {' '}
                    {h.symbol} · PE {h.pe ?? '—'} · 分位 {h.pe_percentile ?? '—'}
                    {h.tradeable === false
                      ? ` · ${h.tradability?.label || '不可成交'}`
                      : ''}
                  </span>
                </div>
                <span className={styles.up}>{h.valuation_score ?? '—'}</span>
              </Link>
            ))}
            {!scanHits.length && !scanBusy ? (
              <p className={styles.muted}>点击「运行扫描」按 PE/PB 截面分位筛选（财务无权限则降级）</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {!loading ? (
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>组合风控</h2>
            <span className={styles.badge}>
              open {risk?.open_count ?? 0} · 违规 {risk?.violation_count ?? 0}
              {risk?.max_industry_weight_pct != null
                ? ` · 行业顶 ${risk.max_industry_weight_pct}%`
                : ''}
            </span>
          </div>
          <div className={styles.cardForm}>
            <input
              value={cardSymbol}
              onChange={(e) => setCardSymbol(e.target.value)}
              placeholder="代码 600036.SH"
              className={styles.input}
            />
            <input
              value={cardPos}
              onChange={(e) => setCardPos(e.target.value)}
              placeholder="仓位%"
              className={styles.input}
            />
            <input
              value={cardStop}
              onChange={(e) => setCardStop(e.target.value)}
              placeholder="止损规则"
              className={styles.input}
            />
            <Button size="sm" loading={cardBusy} onClick={() => void createOpenCard()}>
              创建 open 卡片
            </Button>
          </div>
          {cardMsg ? <p className={styles.muted}>{cardMsg}</p> : null}
          <div className={styles.themeList}>
            {(risk?.holdings || []).map((h) => (
              <div key={h.id || h.symbol} className={styles.themeItem}>
                <div>
                  <strong>{h.symbol}</strong>
                  <span className={styles.muted}>
                    {' '}
                    {h.name || ''} · {h.industry || '行业?'} · 仓位{' '}
                    {h.position_pct ?? '—'}% · 权重 {h.weight_pct ?? '—'}%
                    {h.has_stop ? ` · 止损: ${h.stop_rule}` : ' · 缺止损'}
                    {h.id ? ` · id ${h.id.slice(0, 8)}…` : ''}
                  </span>
                </div>
                <div className={styles.holdingActions}>
                  <span className={(h.pnl_pct || 0) >= 0 ? styles.up : styles.down}>
                    {h.pnl_pct != null ? fmtPct(h.pnl_pct) : '—'}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={cardBusy || !h.id}
                    onClick={() => void deleteHoldingCard(h.id, h.symbol)}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))}
            {!risk?.holdings?.length ? (
              <p className={styles.muted}>暂无 open 持仓卡片（观察池不计入）</p>
            ) : null}
          </div>
          {(risk?.industry_exposure || []).length ? (
            <div className={styles.factorList}>
              {risk!.industry_exposure!.map((x) => (
                <div key={x.industry} className={styles.factorRow}>
                  <span>{x.industry}</span>
                  <span>{x.weight_pct}%</span>
                </div>
              ))}
            </div>
          ) : null}
          {(risk?.rebalance_hints || []).length ? (
            <ul className={styles.violations}>
              {risk!.rebalance_hints!.map((h, i) => (
                <li key={`hint-${i}`}>{h}</li>
              ))}
            </ul>
          ) : null}
          {(risk?.violations || []).length ? (
            <ul className={styles.violations}>
              {risk!.violations!.map((v, i) => (
                <li key={`${v.code}-${v.symbol}-${i}`}>
                  {v.symbol}: {v.message}
                </li>
              ))}
            </ul>
          ) : null}
          <p className={styles.footerNote}>{risk?.disclaimer}</p>
        </section>
      ) : null}

      <div className={styles.grid}>
        {LINKS.map((item) =>
          item.external ? (
            <a
              key={item.to}
              className={styles.card}
              href={item.to}
              target="_blank"
              rel="noopener noreferrer"
            >
              <h2 className={styles.cardTitle}>{item.title}</h2>
              <p className={styles.cardDesc}>{item.desc}</p>
              <span className={styles.cardMeta}>{item.meta}</span>
            </a>
          ) : (
            <Link key={item.to} className={styles.card} to={item.to}>
              <h2 className={styles.cardTitle}>{item.title}</h2>
              <p className={styles.cardDesc}>{item.desc}</p>
              <span className={styles.cardMeta}>{item.meta}</span>
            </Link>
          )
        )}
      </div>
    </div>
  );
}
