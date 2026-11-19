/**
 * 财经日历面板：东财会议/数据，可筛选着色
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Empty, Loading, useToast } from '@/components/common';
import styles from './CalendarEventsWidget.module.css';

type RangeKey = 'today' | '7d' | '30d';

type CalEvent = {
  fe_code: string;
  start_at: string;
  end_at?: string | null;
  name: string;
  sponsor?: string | null;
  city?: string | null;
  fe_type?: string | null;
  std_type_code?: string | null;
  std_type_label?: string;
  source?: string | null;
  source_label?: string | null;
  content?: string | null;
  importance?: number | null;
  importance_reason?: string | null;
};

type FacetItem = { value: string; count: number; label: string };

type SyncProgress = {
  active?: boolean;
  phase?: string;
  done?: number;
  total?: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  rated?: number;
  failed_batches?: number;
  message?: string;
  last_error?: string | null;
};

const STD_CHIPS: { code: string; label: string }[] = [
  { code: '', label: '全部' },
  { code: '1', label: '会议' },
  { code: '2', label: '数据' },
  { code: '3', label: '其他' },
];

/** ''=全部；unrated=未评级；3/4/5=≥N 星 */
const IMPORTANCE_CHIPS: { code: string; label: string }[] = [
  { code: '', label: '全部星级' },
  { code: 'unrated', label: '未评级' },
  { code: '3', label: '≥3★' },
  { code: '4', label: '≥4★' },
  { code: '5', label: '5★' },
];

/** ''=全部；eastmoney=东财；feedgen=本系统新闻抽取 */
const SOURCE_CHIPS: { code: string; label: string }[] = [
  { code: '', label: '全部来源' },
  { code: 'eastmoney', label: '东财' },
  { code: 'feedgen', label: 'feedgen' },
];

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function rangeBounds(key: RangeKey): { from: string; to: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const from = isoDay(today);
  if (key === 'today') return { from, to: from };
  const end = new Date(today);
  end.setDate(end.getDate() + (key === '7d' ? 6 : 29));
  return { from, to: isoDay(end) };
}

function fmtWhen(startAt: string, endAt?: string | null): string {
  const s = startAt?.slice(0, 16)?.replace('T', ' ') || '--';
  const startDay = startAt?.slice(0, 10) || '';
  const endDay = endAt?.slice(0, 10) || '';
  if (endDay && endDay !== startDay) {
    return `${startAt.slice(5, 10)} ~ ${endAt!.slice(5, 10)}`;
  }
  const hm = startAt.slice(11, 16);
  if (hm && hm !== '00:00') return `${startAt.slice(5, 10)} ${hm}`;
  return startAt.slice(5, 10) || s;
}

/** 国家/地区 → 国旗；中国城市统一中国国旗 */
const REGION_FLAGS: Record<string, string> = {
  中国: '🇨🇳',
  美国: '🇺🇸',
  欧盟: '🇪🇺',
  日本: '🇯🇵',
  英国: '🇬🇧',
  加拿大: '🇨🇦',
  德国: '🇩🇪',
  澳大利亚: '🇦🇺',
  意大利: '🇮🇹',
  瑞士: '🇨🇭',
  俄罗斯: '🇷🇺',
  菲律宾: '🇵🇭',
  马来西亚: '🇲🇾',
  巴西: '🇧🇷',
  新加坡: '🇸🇬',
  泰国: '🇹🇭',
  韩国: '🇰🇷',
  法国: '🇫🇷',
  阿根廷: '🇦🇷',
  土耳其: '🇹🇷',
  安塔利亚: '🇹🇷',
  布鲁塞尔: '🇧🇪',
  旧金山: '🇺🇸',
  华盛顿: '🇺🇸',
  中国香港: '🇭🇰',
  香港: '🇭🇰',
  中国澳门: '🇲🇴',
  澳门: '🇲🇴',
  中国台湾: '🇨🇳',
  台湾: '🇨🇳',
  OPEC: '🛢️',
};

function isChinaMainlandPlace(city: string): boolean {
  const c = city.trim();
  if (!c) return false;
  if (c === '中国') return true;
  if (/香港|澳门|台湾/.test(c)) return false;
  if (c.startsWith('中国')) return true;
  if (/(市|省|自治区|特别行政区)$/.test(c)) return true;
  if (/^(北京|上海|天津|重庆|广州|深圳|杭州|成都|武汉|苏州|西安|郑州|南京|青岛|厦门|宁波|长沙|合肥|福州|济南|大连|沈阳|哈尔滨|长春|昆明|贵阳|南宁|海口|石家庄|太原|呼和浩特|兰州|西宁|银川|乌鲁木齐)/.test(c)) {
    return true;
  }
  return false;
}

function regionDisplay(city?: string | null): { flag: string; label: string } {
  const raw = (city || '').trim();
  if (!raw || raw === '-') return { flag: '🏳️', label: '—' };
  if (REGION_FLAGS[raw]) return { flag: REGION_FLAGS[raw], label: raw };
  if (isChinaMainlandPlace(raw)) return { flag: '🇨🇳', label: raw };
  return { flag: '🌍', label: raw };
}

function toneClass(code?: string | null): string {
  if (code === '1') return styles.toneMeet;
  if (code === '2') return styles.toneData;
  return styles.toneOther;
}

function typeToneClass(code?: string | null): string {
  if (code === '1') return styles.typeMeet;
  if (code === '2') return styles.typeData;
  return styles.typeOther;
}

function starLevelClass(n: number): string {
  if (n >= 5) return styles.starLv5;
  if (n === 4) return styles.starLv4;
  if (n === 3) return styles.starLv3;
  if (n === 2) return styles.starLv2;
  if (n === 1) return styles.starLv1;
  return '';
}

function Stars({ value, reason }: { value?: number | null; reason?: string | null }) {
  const n = Math.max(0, Math.min(5, Number(value) || 0));
  const onClass = `${styles.starOn} ${starLevelClass(n)}`;
  return (
    <span
      className={styles.stars}
      title={reason ? `${n} 星：${reason}` : n ? `${n} 星` : '未评级'}
      aria-label={n ? `重要性 ${n} 星` : '未评级'}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < n ? onClass : styles.starOff}>
          ★
        </span>
      ))}
    </span>
  );
}

function eventTooltip(ev: CalEvent): string {
  const parts: string[] = [];
  if (ev.sponsor) parts.push(`主办：${ev.sponsor}`);
  if (ev.city) parts.push(`地区：${ev.city}`);
  if (ev.std_type_label) parts.push(`大类：${ev.std_type_label}`);
  const srcLabel = ev.source_label || (ev.source === 'feedgen' ? 'feedgen' : '东财');
  parts.push(`来源：${srcLabel}`);
  if (ev.importance) parts.push(`重要性：${ev.importance} 星`);
  if (ev.importance_reason) parts.push(`评级：${ev.importance_reason}`);
  return parts.length ? parts.join(' · ') : ev.name;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export function CalendarEventsWidget() {
  const toast = useToast();
  const [range, setRange] = useState<RangeKey>('30d');
  const [stdType, setStdType] = useState('');
  const [importance, setImportance] = useState('');
  const [source, setSource] = useState('');
  const [feType, setFeType] = useState('');
  const [city, setCity] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<CalEvent[]>([]);
  const [feTypes, setFeTypes] = useState<FacetItem[]>([]);
  const [cities, setCities] = useState<FacetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [emptyHint, setEmptyHint] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [rating, setRating] = useState(false);
  const [rateProgress, setRateProgress] = useState<SyncProgress | null>(null);
  const [pendingRate, setPendingRate] = useState(0);
  const syncAbortRef = useRef(false);
  const rateAbortRef = useRef(false);

  const bounds = useMemo(() => rangeBounds(range), [range]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        from: bounds.from,
        to: bounds.to,
        limit: '300',
      });
      if (stdType) params.set('std_type', stdType);
      if (importance) params.set('importance', importance);
      if (source) params.set('source', source);
      if (feType) params.set('fe_type', feType);
      if (city) params.set('city', city);

      const facetParams = new URLSearchParams({
        from: bounds.from,
        to: bounds.to,
      });

      const [evRes, faRes, stRes, pendRes] = await Promise.all([
        fetch(`/api/calendar/events?${params}`),
        fetch(`/api/calendar/facets?${facetParams}`),
        fetch('/api/calendar/sync/status'),
        fetch('/api/calendar/ai-rate/pending'),
      ]);

      if (evRes.status === 404) {
        throw new Error('日历接口未就绪（请重启后端服务后刷新）');
      }

      const ev = await evRes.json().catch(() => ({}));
      const fa = await faRes.json().catch(() => ({}));
      const st = await stRes.json().catch(() => ({}));
      const pend = await pendRes.json().catch(() => ({}));

      if (!evRes.ok || !ev?.ok) {
        throw new Error(ev?.error || ev?.detail || `加载日历失败 (${evRes.status})`);
      }
      setItems(Array.isArray(ev.items) ? ev.items : []);
      setFeTypes(
        Array.isArray(fa?.fe_types)
          ? fa.fe_types.filter((x: FacetItem) => x.value !== '-')
          : []
      );
      setCities(
        Array.isArray(fa?.cities)
          ? fa.cities.filter((x: FacetItem) => x.value !== '-')
          : []
      );
      setEmptyHint(!(st?.row_count > 0));
      if (st?.progress) setProgress(st.progress as SyncProgress);
      if (pend?.ok) setPendingRate(Number(pend.pending) || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [bounds.from, bounds.to, city, feType, importance, source, stdType]);

  const filteredItems = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((ev) => {
      const name = (ev.name || '').toLowerCase();
      const sponsor = (ev.sponsor || '').toLowerCase();
      return name.includes(keyword) || sponsor.includes(keyword);
    });
  }, [items, q]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      syncAbortRef.current = true;
      rateAbortRef.current = true;
    };
  }, []);

  const pollProgressOnce = async (): Promise<SyncProgress | null> => {
    const res = await fetch('/api/scheduler/finance-calendar/progress');
    const data = await res.json().catch(() => ({}));
    if (!data?.ok) return null;
    const p: SyncProgress = {
      active: Boolean(data.active),
      phase: data.phase,
      done: data.done,
      total: data.total,
      inserted: data.inserted,
      updated: data.updated,
      unchanged: data.unchanged,
      message: data.message,
      last_error: data.last_error,
    };
    setProgress(p);
    return p;
  };

  const triggerSync = async () => {
    if (syncing) return;
    setSyncing(true);
    syncAbortRef.current = false;
    setError(null);
    try {
      const res = await fetch('/api/scheduler/jobs/finance_calendar_sync/run', {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || data?.running || '启动同步失败');
      }
      toast.success('已启动财经日历同步');

      // 轮询进度直到结束
      let final: SyncProgress | null = null;
      for (let i = 0; i < 120; i += 1) {
        if (syncAbortRef.current) break;
        await sleep(800);
        const p = await pollProgressOnce();
        if (!p) continue;
        final = p;
        if (!p.active && (p.phase === 'done' || p.phase === 'error' || p.last_error)) {
          break;
        }
        // 刚启动时可能还没 active，继续等
        if (!p.active && i > 3 && p.phase === 'done') break;
      }

      await load();

      if (final?.phase === 'error' || final?.last_error) {
        toast.error(final.last_error || final.message || '日历同步失败');
      } else {
        const ins = final?.inserted ?? 0;
        const upd = final?.updated ?? 0;
        const unc = final?.unchanged ?? 0;
        toast.success(
          final?.message || `日历同步完成：新增 ${ins}，更新 ${upd}，未变 ${unc}`
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setSyncing(false);
    }
  };

  const triggerAiRate = async () => {
    if (rating || syncing) return;
    setRating(true);
    rateAbortRef.current = false;
    try {
      const res = await fetch('/api/calendar/ai-rate', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503) {
        throw new Error(data?.error || '未配置 AI 模型（设置 → AI 模型）');
      }
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || data?.message || '启动 AI 评级失败');
      }
      if (!data.started) {
        toast.success(data.message || '没有需要评级的事件');
        await load();
        return;
      }
      toast.success(data.message || `已启动 AI 评级（${data.pending ?? 0} 条）`);

      let final: SyncProgress | null = null;
      let sawActive = false;
      for (let i = 0; i < 300; i += 1) {
        if (rateAbortRef.current) break;
        await sleep(1200);
        const pRes = await fetch('/api/calendar/ai-rate/progress');
        const pData = await pRes.json().catch(() => ({}));
        if (!pData?.ok) continue;
        const p: SyncProgress = {
          active: Boolean(pData.active),
          phase: pData.phase,
          done: pData.done,
          total: pData.total,
          rated: pData.rated,
          failed_batches: pData.failed_batches,
          message: pData.message,
          last_error: pData.last_error,
        };
        setRateProgress(p);
        if (p.active) sawActive = true;
        if (sawActive && !p.active) {
          final = p;
          break;
        }
        if (!p.active && i > 2 && (p.phase === 'done' || p.phase === 'done_with_errors')) {
          final = p;
          break;
        }
      }

      await load();
      if (final?.last_error && (final.failed_batches || 0) > 0 && !(final.rated || 0)) {
        toast.error(final.last_error || 'AI 评级失败');
      } else if ((final?.failed_batches || 0) > 0) {
        toast.error(
          final?.message ||
            `部分失败：已评级 ${final?.rated ?? 0}，失败批次 ${final?.failed_batches}`
        );
      } else {
        toast.success(final?.message || `AI 评级完成：${final?.rated ?? 0} 条`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setRating(false);
    }
  };

  const progressPct =
    progress?.total && progress.total > 0
      ? Math.min(100, Math.round(((progress.done || 0) / progress.total) * 100))
      : syncing
        ? 8
        : 0;

  const ratePct =
    rateProgress?.total && rateProgress.total > 0
      ? Math.min(
          100,
          Math.round(((rateProgress.done || 0) / rateProgress.total) * 100)
        )
      : rating
        ? 8
        : 0;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.topRow}>
          <div className={styles.chipRow} role="group" aria-label="时间范围">
            {(
              [
                ['today', '今日'],
                ['7d', '7天'],
                ['30d', '30天'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`${styles.chip} ${range === key ? styles.chipActive : ''}`}
                onClick={() => setRange(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.actionBtns}>
            <button
              type="button"
              className={styles.syncBtnInline}
              disabled={syncing || rating}
              onClick={() => void triggerSync()}
            >
              {syncing ? '同步中…' : '同步日历'}
            </button>
            <button
              type="button"
              className={styles.aiBtnInline}
              disabled={syncing || rating}
              title={
                pendingRate > 0
                  ? `待评级 ${pendingRate} 条（已有星级的会跳过）`
                  : '当前没有待评级事件'
              }
              onClick={() => void triggerAiRate()}
            >
              {rating
                ? 'AI 评级中…'
                : pendingRate > 0
                  ? `AI 重要程度评级 (${pendingRate})`
                  : 'AI 重要程度评级'}
            </button>
          </div>
        </div>

        <div className={styles.chipRow} role="group" aria-label="大类">
          {STD_CHIPS.map((c) => (
            <button
              key={c.code || 'all'}
              type="button"
              className={`${styles.chip} ${stdType === c.code ? styles.chipActive : ''} ${
                c.code === '1'
                  ? styles.chipMeet
                  : c.code === '2'
                    ? styles.chipData
                    : c.code === '3'
                      ? styles.chipOther
                      : ''
              }`}
              onClick={() => setStdType(c.code)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className={styles.chipRow} role="group" aria-label="重要程度">
          {IMPORTANCE_CHIPS.map((c) => (
            <button
              key={c.code || 'imp-all'}
              type="button"
              className={`${styles.chip} ${importance === c.code ? styles.chipActive : ''} ${
                c.code === '4' || c.code === '5' ? styles.chipImpHigh : ''
              }`}
              onClick={() => setImportance(c.code)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className={styles.chipRow} role="group" aria-label="数据来源">
          {SOURCE_CHIPS.map((c) => (
            <button
              key={c.code || 'src-all'}
              type="button"
              className={`${styles.chip} ${source === c.code ? styles.chipActive : ''} ${
                c.code === 'feedgen'
                  ? styles.chipSourceFeedgen
                  : c.code === 'eastmoney'
                    ? styles.chipSourceEastmoney
                    : ''
              }`}
              onClick={() => setSource(c.code)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className={styles.filters}>
          <select
            className={styles.select}
            value={feType}
            onChange={(e) => setFeType(e.target.value)}
            aria-label="细类"
          >
            <option value="">全部细类</option>
            {feTypes.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label} ({f.count})
              </option>
            ))}
          </select>
          <select
            className={styles.select}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            aria-label="地区"
          >
            <option value="">全部地区</option>
            {cities.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label} ({c.count})
              </option>
            ))}
          </select>
          <div className={styles.searchWrap}>
            <input
              className={styles.search}
              value={q}
              placeholder="搜索名称/主办…"
              aria-label="搜索名称或主办单位"
              onChange={(e) => setQ(e.target.value)}
            />
            {q ? (
              <button
                type="button"
                className={styles.searchClear}
                aria-label="清除搜索"
                title="清除"
                onClick={() => setQ('')}
              >
                ×
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {(syncing || progress?.active) && (
        <div className={styles.progressBox} aria-live="polite">
          <div className={styles.progressText}>
            {progress?.message || '正在同步财经日历…'}
            {progress?.total
              ? ` · ${progress.done ?? 0}/${progress.total}`
              : ''}
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {(rating || rateProgress?.active) && (
        <div className={styles.progressBox} aria-live="polite">
          <div className={styles.progressText}>
            {rateProgress?.message || 'AI 正在评级重要性…'}
            {rateProgress?.total
              ? ` · ${rateProgress.done ?? 0}/${rateProgress.total}`
              : ''}
            {typeof rateProgress?.rated === 'number'
              ? ` · 已写入 ${rateProgress.rated}`
              : ''}
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${ratePct}%` }} />
          </div>
        </div>
      )}

      {loading ? (
        <Loading text="加载日历…" />
      ) : error ? (
        <div className={styles.emptyWrap}>
          <Empty title="加载失败" description={error} />
          <button type="button" className={styles.syncBtn} onClick={() => void load()}>
            重试加载
          </button>
          <button
            type="button"
            className={styles.syncBtn}
            disabled={syncing}
            onClick={() => void triggerSync()}
          >
            {syncing ? '同步中…' : '立即同步'}
          </button>
        </div>
      ) : !filteredItems.length ? (
        <div className={styles.emptyWrap}>
          <Empty
            title="暂无事件"
            description={
              emptyHint && !items.length
                ? '本地库为空。可点「同步日历」拉取东财未来 30 天数据。'
                : q.trim()
                  ? '没有匹配的名称或主办单位'
                  : '当前筛选条件下没有事件'
            }
          />
          {emptyHint && !items.length && (
            <button
              type="button"
              className={styles.syncBtn}
              disabled={syncing}
              onClick={() => void triggerSync()}
            >
              {syncing ? '同步中…' : '立即同步'}
            </button>
          )}
          {q.trim() && items.length > 0 ? (
            <button type="button" className={styles.syncBtn} onClick={() => setQ('')}>
              清除搜索
            </button>
          ) : null}
        </div>
      ) : (
        <ul className={styles.list}>
          {filteredItems.map((ev) => {
            const open = expanded === ev.fe_code;
            const region = regionDisplay(ev.city);
            const typeLabel = ev.fe_type && ev.fe_type !== '-' ? ev.fe_type : ev.std_type_label || '—';
            const sourceLabel = ev.source_label || (ev.source === 'feedgen' ? 'feedgen' : '东财');
            const sourceCode = (ev.source || 'eastmoney').toLowerCase();
            return (
              <li key={ev.fe_code} className={`${styles.item} ${toneClass(ev.std_type_code)}`}>
                <button
                  type="button"
                  className={styles.itemMain}
                  title={eventTooltip(ev)}
                  onClick={() => setExpanded(open ? null : ev.fe_code)}
                >
                  <span className={styles.when}>{fmtWhen(ev.start_at, ev.end_at)}</span>
                  <span className={styles.region} title={region.label}>
                    <span className={styles.flag} aria-hidden>
                      {region.flag}
                    </span>
                    <span className={styles.regionText}>{region.label}</span>
                  </span>
                  <span className={styles.impCol}>
                    <Stars value={ev.importance} reason={ev.importance_reason} />
                  </span>
                  <span className={styles.name} title={eventTooltip(ev)}>
                    {ev.name}
                  </span>
                  <span
                    className={`${styles.sourceTag} ${
                      sourceCode === 'feedgen' ? styles.sourceFeedgen : styles.sourceEastmoney
                    }`}
                    title={`来源：${sourceLabel}`}
                  >
                    {sourceLabel}
                  </span>
                  <span
                    className={`${styles.typeTag} ${typeToneClass(ev.std_type_code)}`}
                    title={typeLabel}
                  >
                    {typeLabel}
                  </span>
                </button>
                {open && (
                  <div className={styles.detail}>
                    {ev.content || '暂无详情'}
                    {ev.importance_reason ? (
                      <div className={styles.rateReason}>评级理由：{ev.importance_reason}</div>
                    ) : null}
                    {ev.sponsor ? (
                      <div className={styles.rateReason}>主办：{ev.sponsor}</div>
                    ) : null}
                    <div className={styles.rateReason}>来源：{sourceLabel}</div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
