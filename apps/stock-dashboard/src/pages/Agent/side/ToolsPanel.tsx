import type { ToolEvent } from '../types';
import styles from '../Agent.module.css';

export type ToolTrailItem = ToolEvent & { messageId: string };

type Props = {
  items: ToolTrailItem[];
  onJump: (messageId: string) => void;
};

export function ToolsPanel({ items, onJump }: Props) {
  if (!items.length) {
    return <div className={styles.sideEmpty}>本会话尚无工具调用</div>;
  }
  const recent = items.slice(-80).reverse();
  return (
    <div className={styles.sidePaneBody}>
      <ul className={styles.toolTrail}>
        {recent.map((t) => (
          <li key={`${t.messageId}-${t.id}`}>
            <button
              type="button"
              className={styles.toolTrailRow}
              onClick={() => onJump(t.messageId)}
              title="跳转到对话中的工具气泡"
            >
              <span className={styles.toolRound}>#{t.round ?? '·'}</span>
              <span className={styles.toolName}>
                {t.status === 'running' ? '… ' : t.status === 'error' ? '✗ ' : '✓ '}
                {t.tool}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
