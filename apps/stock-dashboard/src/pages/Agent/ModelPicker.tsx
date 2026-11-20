/**
 * 对话框右下角的 AI 模型选择器：点击展开、向上弹出
 * 数据来自 /api/ai/config 的 profiles，切换走 POST /api/ai/profiles/{id}/activate
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Cpu, Loader2 } from 'lucide-react';
import styles from './ModelPicker.module.css';

export type ModelPickerOption = {
  id: string;
  name?: string;
  provider?: string;
  model?: string;
  active?: boolean;
};

type Props = {
  options: ModelPickerOption[];
  /** 当前使用中的 profile id */
  activeId: string;
  /** 按钮上展示的文本，如 "deepseek · deepseek-chat" */
  label: string;
  switching?: boolean;
  disabled?: boolean;
  onSelect: (id: string) => void;
  /** 「管理模型配置」跳转地址，默认 /settings */
  manageHref?: string;
};

function optionName(o: ModelPickerOption): string {
  return (o.name || o.model || o.id || '').trim();
}

function optionMeta(o: ModelPickerOption): string {
  return [o.provider, o.model].filter(Boolean).join(' · ');
}

export function ModelPicker({
  options,
  activeId,
  label,
  switching = false,
  disabled = false,
  onSelect,
  manageHref = '/settings',
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) close();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (switching) setOpen(false);
  }, [switching]);

  const empty = options.length === 0;

  const handlePick = (id: string) => {
    setOpen(false);
    if (!id || id === activeId) return;
    onSelect(id);
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.chip}${open ? ` ${styles.chipOpen}` : ''}`}
        disabled={disabled || switching}
        onClick={() => setOpen((v) => !v)}
        title={
          empty
            ? '尚未配置 AI 模型，点击选择或前往设置'
            : `当前模型：${label || '未配置'}（点击切换）`
        }
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {switching ? <Loader2 size={12} className={styles.spin} /> : <Cpu size={12} />}
        <span className={styles.chipText}>
          {switching ? '切换中…' : label || '未配置模型'}
        </span>
        <ChevronDown size={12} className={`${styles.caret}${open ? ` ${styles.caretOpen}` : ''}`} />
      </button>

      {open ? (
        <div className={styles.menu} role="listbox" aria-label="选择 AI 模型">
          <div className={styles.menuHead}>选择模型</div>
          {empty ? <div className={styles.menuEmpty}>尚未配置模型档案，请前往设置添加</div> : null}
          {options.map((o) => {
            const isActive = activeId ? o.id === activeId : !!o.active;
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`${styles.item}${isActive ? ` ${styles.itemActive}` : ''}`}
                onClick={() => handlePick(o.id)}
                title={optionMeta(o) || o.id}
              >
                <span className={styles.itemMain}>
                  <span className={styles.itemName}>{optionName(o)}</span>
                  {optionMeta(o) ? <span className={styles.itemMeta}>{optionMeta(o)}</span> : null}
                </span>
                {isActive ? <Check size={13} className={styles.itemCheck} /> : null}
              </button>
            );
          })}
          <div className={styles.menuFoot}>
            <a className={styles.manageLink} href={manageHref}>
              管理模型配置 →
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ModelPicker;
