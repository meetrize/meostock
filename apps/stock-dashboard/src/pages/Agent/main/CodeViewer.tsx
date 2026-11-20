import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import styles from '../Agent.module.css';

type Props = {
  projectId: string;
  path: string;
};

export function CodeViewer({ projectId, path }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [meta, setMeta] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const q = new URLSearchParams({
          projectId,
          path,
          max_chars: '120000',
        });
        const res = await fetch(`/api/agent/fs/file?${q}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        setContent(String(data.content || ''));
        const bits = [
          data.truncated ? '已截断' : null,
          typeof data.totalChars === 'number' ? `${data.totalChars} 字符` : null,
        ].filter(Boolean);
        setMeta(bits.join(' · '));
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
        <Loader2 size={16} className={styles.spin} /> 加载 {path}…
      </div>
    );
  }
  if (error) return <div className={styles.viewerError}>{error}</div>;

  return (
    <div className={styles.codeViewer}>
      <div className={styles.viewerHead}>
        <span className={styles.viewerPath}>{path}</span>
        {meta ? <span className={styles.viewerMeta}>{meta}</span> : null}
      </div>
      <pre className={styles.codePre}>
        <code>{content}</code>
      </pre>
    </div>
  );
}
