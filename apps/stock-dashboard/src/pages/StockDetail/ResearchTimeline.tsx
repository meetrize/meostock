/**
 * 个股事件轴（Phase 3）：news / calendar / 龙虎榜 / 大宗
 */

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Loading } from '@/components/common';
import styles from './ResearchTimeline.module.css';

type Ev = {
  id: string;
  kind: string;
  title: string;
  summary?: string;
  at?: string;
  source?: string;
  url?: string;
};

type Timeline = {
  ok?: boolean;
  event_count?: number;
  events?: Ev[];
  data_gaps?: string[];
  disclaimer?: string;
  error?: string;
};

const KIND_LABEL: Record<string, string> = {
  news: '资讯',
  calendar: '日历',
  top_list: '龙虎榜',
  block_trade: '大宗',
};

export function ResearchTimeline({ code }: { code: string }) {
  const [data, setData] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/research/stock/${encodeURIComponent(code)}/timeline?limit=30`
      );
      const json = await res.json();
      setData(json);
      if (!json?.ok && json?.error) setErr(String(json.error));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card
      title="事件轴"
      extra={
        <Button size="sm" onClick={() => void load()} disabled={loading}>
          刷新
        </Button>
      }
    >
      {loading ? <Loading text="加载事件…" /> : null}
      {err ? <p className={styles.err}>{err}</p> : null}
      {!loading && data?.ok ? (
        <>
          <p className={styles.meta}>
            共 {data.event_count ?? 0} 条
            {data.data_gaps?.length ? ` · gaps: ${data.data_gaps.join(',')}` : ''}
          </p>
          <ul className={styles.list}>
            {(data.events || []).map((e) => (
              <li key={e.id} className={styles.item}>
                <span className={styles.kind}>{KIND_LABEL[e.kind] || e.kind}</span>
                <div className={styles.body}>
                  <div className={styles.titleRow}>
                    {e.url ? (
                      <a href={e.url} target="_blank" rel="noopener noreferrer">
                        {e.title}
                      </a>
                    ) : (
                      <strong>{e.title}</strong>
                    )}
                    <span className={styles.at}>{e.at || '—'}</span>
                  </div>
                  {e.summary ? <p className={styles.summary}>{e.summary}</p> : null}
                </div>
              </li>
            ))}
          </ul>
          {!data.events?.length ? (
            <p className={styles.empty}>暂无事件（资讯需 FEEDGEN；龙虎榜/大宗依赖专题缓存）</p>
          ) : null}
          <p className={styles.footer}>{data.disclaimer}</p>
        </>
      ) : null}
    </Card>
  );
}
