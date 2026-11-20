import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, File, Folder, Loader2 } from 'lucide-react';
import styles from '../Agent.module.css';

type Entry = {
  name: string;
  path: string;
  type: 'file' | 'dir' | string;
  size?: number | null;
};

type Props = {
  projectId: string;
  onOpenFile: (path: string) => void;
  onCitePath: (path: string) => void;
};

export function FilesPanel({ projectId, onOpenFile, onCitePath }: Props) {
  const [root, setRoot] = useState<Entry[]>([]);
  const [expanded, setExpanded] = useState<Record<string, Entry[]>>({});
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const loadDir = useCallback(
    async (path: string) => {
      setLoadingPath(path);
      setError(null);
      try {
        const q = new URLSearchParams({ projectId, path });
        const res = await fetch(`/api/agent/fs/tree?${q}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.error || '加载失败');
        const entries = (Array.isArray(data.entries) ? data.entries : []) as Entry[];
        if (path === '.' || path === '') setRoot(entries);
        else setExpanded((prev) => ({ ...prev, [path]: entries }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingPath(null);
      }
    },
    [projectId]
  );

  useEffect(() => {
    setExpanded({});
    setFilter('');
    void loadDir('.');
  }, [projectId, loadDir]);

  const toggleDir = (path: string) => {
    if (expanded[path]) {
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
      return;
    }
    void loadDir(path);
  };

  const q = filter.trim().toLowerCase();

  const renderList = (entries: Entry[], depth: number) =>
    entries
      .filter((e) => !q || e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q))
      .map((e) => {
        const isDir = e.type === 'dir';
        const open = Boolean(expanded[e.path]);
        return (
          <div key={e.path}>
            <div
              className={styles.treeRow}
              style={{ paddingLeft: 8 + depth * 12 }}
              onContextMenu={(ev) => {
                if (isDir) return;
                ev.preventDefault();
                onCitePath(e.path);
              }}
            >
              <button
                type="button"
                className={styles.treeMain}
                onClick={() => {
                  if (isDir) toggleDir(e.path);
                  else onOpenFile(e.path);
                }}
                title={isDir ? e.path : `${e.path}（右键引用到对话）`}
              >
                <span className={styles.treeIcon}>
                  {isDir ? (
                    open ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )
                  ) : (
                    <span style={{ width: 12 }} />
                  )}
                </span>
                {isDir ? <Folder size={13} /> : <File size={13} />}
                <span className={styles.treeName}>{e.name}</span>
              </button>
            </div>
            {isDir && open && expanded[e.path]
              ? renderList(expanded[e.path], depth + 1)
              : null}
          </div>
        );
      });

  return (
    <div className={styles.sidePaneBody}>
      <input
        className={styles.sideSearch}
        placeholder="过滤已加载文件…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {error ? <div className={styles.viewerError}>{error}</div> : null}
      {loadingPath === '.' && !root.length ? (
        <div className={styles.viewerStatus}>
          <Loader2 size={14} className={styles.spin} /> 加载目录…
        </div>
      ) : (
        <div className={styles.treeScroll}>{renderList(root, 0)}</div>
      )}
    </div>
  );
}
