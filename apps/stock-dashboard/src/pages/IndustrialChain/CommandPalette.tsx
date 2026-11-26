import { useEffect, useMemo, useRef, useState } from 'react';
import { filterCommands } from './commands';
import type { CommandAction, CommandItem } from './types';
import styles from './IndustrialChain.module.css';

export function CommandPalette({
  open,
  items,
  onClose,
  onRun,
}: {
  open: boolean;
  items: CommandItem[];
  onClose: () => void;
  onRun: (action: CommandAction) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => filterCommands(items, query), [items, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  const runIndex = (idx: number) => {
    const item = filtered[idx];
    if (!item) return;
    onRun(item.action);
    onClose();
  };

  return (
    <div
      className={styles.cmdOverlay}
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.cmdPanel}>
        <input
          ref={inputRef}
          className={styles.cmdInput}
          placeholder="搜索环节 / 公司 / 视图…（Esc 关闭）"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              runIndex(active);
            }
          }}
        />
        <ul className={styles.cmdList}>
          {filtered.map((it, idx) => (
            <li key={it.id}>
              <button
                type="button"
                className={`${styles.cmdItem} ${idx === active ? styles.cmdItemActive : ''}`}
                onMouseEnter={() => setActive(idx)}
                onClick={() => runIndex(idx)}
              >
                <span className={styles.cmdTitle}>{it.title}</span>
                {it.hint && <span className={styles.cmdHint}>{it.hint}</span>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className={styles.detailEmpty}>无匹配</li>
          )}
        </ul>
      </div>
    </div>
  );
}
