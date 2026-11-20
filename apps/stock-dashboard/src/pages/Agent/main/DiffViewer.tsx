import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import styles from '../Agent.module.css';

type Props = {
  projectId: string;
  path: string;
};

export function DiffViewer({ projectId, path }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState('');
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const q = new URLSearchParams({ projectId, path });
        const res = await fetch(`/api/agent/git/diff?${q}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        setDiff(String(data.diff || ''));
        setTruncated(Boolean(data.truncated));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, path]);

  if (loading) {
    return (
      <div className={styles.viewerStatus}>
        <Loader2 size={16} className={styles.spin} /> 加载 diff…
      </div>
    );
  }
  if (error) return <div className={styles.viewerError}>{error}</div>;

  return (
    <div className={styles.diffViewer}>
      <div className={styles.viewerHead}>
        <span className={styles.viewerPath}>{path}</span>
        {truncated ? <span className={styles.viewerMeta}>已截断</span> : null}
      </div>
      <pre className={styles.diffPre}>
        {diff.split('\n').map((line, i) => {
          let cls = styles.diffLine;
          if (line.startsWith('+') && !line.startsWith('+++')) cls = styles.diffAdd;
          else if (line.startsWith('-') && !line.startsWith('---')) cls = styles.diffDel;
          else if (line.startsWith('@@')) cls = styles.diffHunk;
          else if (line.startsWith('###')) cls = styles.diffSection;
          return (
            <div key={i} className={cls}>
              {line || ' '}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
