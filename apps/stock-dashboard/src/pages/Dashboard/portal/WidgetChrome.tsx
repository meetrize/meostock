import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GripVertical, MoreVertical } from 'lucide-react';
import { WidgetHeaderSlotContext } from './widgetHeaderSlotContext';
import styles from './WidgetChrome.module.css';

interface WidgetChromeProps {
  title: string;
  editing: boolean;
  children: ReactNode;
  onRemove?: () => void;
  /** 指数等矮面板：更紧凑的内边距，禁止竖向滚动 */
  compact?: boolean;
  /** 点击标题（非编辑态）；用于打开 K 线等 */
  onTitleClick?: () => void;
  titleHint?: string;
  /** 标题行右侧额外内容（也可由子组件经 header slot portal 注入） */
  headerEnd?: ReactNode;
}

export function WidgetChrome({
  title,
  editing,
  children,
  onRemove,
  compact = false,
  onTitleClick,
  titleHint,
  headerEnd,
}: WidgetChromeProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [headerSlotEl, setHeaderSlotEl] = useState<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  return (
    <div
      className={`${styles.chrome} ${editing ? styles.chromeEditing : ''} ${
        compact ? styles.chromeCompact : ''
      }`}
    >
      <div
        className={`${styles.header} ${editing ? 'widget-drag-handle' : ''}`}
      >
        {editing && (
          <span className={styles.dragHandle} title="拖拽移动">
            <GripVertical size={14} />
          </span>
        )}
        {onTitleClick && !editing ? (
          <button
            type="button"
            className={`${styles.title} ${styles.titleClickable}`}
            title={titleHint || '打开 K 线'}
            onClick={(e) => {
              e.stopPropagation();
              onTitleClick();
            }}
          >
            {title}
          </button>
        ) : (
          <div className={styles.title}>{title}</div>
        )}
        <div
          ref={setHeaderSlotEl}
          className={styles.headerEnd}
          data-header-slot=""
        >
          {headerEnd}
        </div>
        <div className={styles.menuWrap} ref={menuRef}>
          <button
            type="button"
            className={styles.menuBtn}
            aria-label="面板菜单"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            <MoreVertical size={14} />
          </button>
          {menuOpen && (
            <div className={styles.menu} role="menu">
              {onRemove ? (
                <button
                  type="button"
                  role="menuitem"
                  className={`${styles.menuItem} ${styles.menuItemDanger}`}
                  onClick={() => {
                    setMenuOpen(false);
                    onRemove();
                  }}
                >
                  移除面板
                </button>
              ) : (
                <div className={styles.menuEmpty}>暂无操作</div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className={`${styles.body} ${compact ? styles.bodyCompact : ''}`}>
        <WidgetHeaderSlotContext.Provider value={headerSlotEl}>
          {children}
        </WidgetHeaderSlotContext.Provider>
      </div>
    </div>
  );
}
