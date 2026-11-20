import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { MessageSquare, X } from 'lucide-react';
import type { MainTab } from '../mainTabs';
import { CHAT_TAB_ID } from '../mainTabs';
import styles from '../Agent.module.css';

type Props = {
  tabs: MainTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseToRight: (id: string) => void;
};

type MenuState = {
  tabId: string;
  x: number;
  y: number;
  index: number;
};

export function MainTabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseToRight,
}: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', () => setMenu(null), true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const openMenu = (e: ReactMouseEvent, tabId: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    const pad = 8;
    const w = 168;
    const h = 120;
    const x = Math.min(e.clientX, window.innerWidth - w - pad);
    const y = Math.min(e.clientY, window.innerHeight - h - pad);
    setMenu({ tabId, x: Math.max(pad, x), y: Math.max(pad, y), index });
  };

  const run = (fn: () => void) => {
    fn();
    setMenu(null);
  };

  const menuTabIsChat = menu?.tabId === CHAT_TAB_ID;
  const canCloseCurrent = Boolean(menu && !menuTabIsChat);
  const canCloseOthers = Boolean(
    menu && tabs.some((t) => t.id !== menu.tabId && t.id !== CHAT_TAB_ID)
  );
  const canCloseRight = Boolean(
    menu != null &&
      tabs.slice(menu.index + 1).some((t) => t.id !== CHAT_TAB_ID)
  );

  return (
    <div className={styles.mainTabBar} role="tablist">
      {tabs.map((t, index) => {
        const active = t.id === activeId;
        const isChat = t.id === CHAT_TAB_ID;
        return (
          <div
            key={t.id}
            className={[
              styles.mainTab,
              active ? styles.mainTabActive : '',
              isChat ? styles.mainTabChat : '',
              isChat && active ? styles.mainTabChatActive : '',
            ]
              .filter(Boolean)
              .join(' ')}
            role="tab"
            aria-selected={active}
            onContextMenu={(e) => openMenu(e, t.id, index)}
          >
            <button
              type="button"
              className={styles.mainTabBtn}
              onClick={() => onSelect(t.id)}
              title={t.path || t.title}
            >
              {isChat ? (
                <MessageSquare size={12} className={styles.mainTabChatIcon} />
              ) : null}
              {t.title}
            </button>
            {!isChat ? (
              <button
                type="button"
                className={styles.mainTabClose}
                title="关闭"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.id);
                }}
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
        );
      })}

      {menu ? (
        <div
          ref={menuRef}
          className={styles.mainTabMenu}
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            className={styles.mainTabMenuItem}
            disabled={!canCloseCurrent}
            onClick={() => run(() => onClose(menu.tabId))}
          >
            关闭当前
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.mainTabMenuItem}
            disabled={!canCloseOthers}
            onClick={() => run(() => onCloseOthers(menu.tabId))}
          >
            关闭其他
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.mainTabMenuItem}
            disabled={!canCloseRight}
            onClick={() => run(() => onCloseToRight(menu.tabId))}
          >
            关闭右侧
          </button>
        </div>
      ) : null}
    </div>
  );
}
