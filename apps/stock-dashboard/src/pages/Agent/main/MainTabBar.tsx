import { X } from 'lucide-react';
import type { MainTab } from '../mainTabs';
import { CHAT_TAB_ID } from '../mainTabs';
import styles from '../Agent.module.css';

type Props = {
  tabs: MainTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
};

export function MainTabBar({ tabs, activeId, onSelect, onClose }: Props) {
  return (
    <div className={styles.mainTabBar} role="tablist">
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            className={`${styles.mainTab}${active ? ` ${styles.mainTabActive}` : ''}`}
            role="tab"
            aria-selected={active}
          >
            <button
              type="button"
              className={styles.mainTabBtn}
              onClick={() => onSelect(t.id)}
              title={t.path || t.title}
            >
              {t.title}
            </button>
            {t.id !== CHAT_TAB_ID ? (
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
    </div>
  );
}
