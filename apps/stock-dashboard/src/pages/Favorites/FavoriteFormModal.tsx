/**
 * 添加 / 编辑收藏：粘贴 URL 后自动解析标题与 favicon，可手动修改。
 */

import { useEffect, useRef, useState } from 'react';
import { Globe, Loader2, X } from 'lucide-react';
import { useToast } from '@/components/common';
import type { FavoriteItem } from './types';
import styles from './FavoriteFormModal.module.css';

type Mode = 'add' | 'edit';

type Props = {
  open: boolean;
  mode: Mode;
  initial?: FavoriteItem | null;
  onClose: () => void;
  onSaved: () => void;
};

type Draft = {
  url: string;
  title: string;
  favicon_url: string;
  note: string;
};

const emptyDraft = (): Draft => ({
  url: '',
  title: '',
  favicon_url: '',
  note: '',
});

export function FavoriteFormModal({ open, mode, initial, onClose, onSaved }: Props) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const lastParsedUrl = useRef('');
  const parseTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && initial) {
      setDraft({
        url: initial.url,
        title: initial.title,
        favicon_url: initial.favicon_url || '',
        note: initial.note || '',
      });
      lastParsedUrl.current = initial.url;
    } else {
      setDraft(emptyDraft());
      lastParsedUrl.current = '';
    }
    setParsing(false);
    setSaving(false);
  }, [open, mode, initial]);

  useEffect(() => {
    return () => {
      if (parseTimer.current) window.clearTimeout(parseTimer.current);
    };
  }, []);

  if (!open) return null;

  const runParse = async (url: string, { force = false } = {}) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!force && trimmed === lastParsedUrl.current) return;
    setParsing(true);
    try {
      const res = await fetch('/api/favorites/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || '解析失败');
      }
      lastParsedUrl.current = String(data.url || trimmed);
      setDraft((prev) => ({
        ...prev,
        url: String(data.url || prev.url),
        title: prev.title.trim() ? prev.title : String(data.title || ''),
        favicon_url: prev.favicon_url.trim()
          ? prev.favicon_url
          : String(data.favicon_url || ''),
      }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '解析失败');
    } finally {
      setParsing(false);
    }
  };

  const onUrlChange = (value: string) => {
    setDraft((prev) => ({ ...prev, url: value }));
    if (parseTimer.current) window.clearTimeout(parseTimer.current);
    parseTimer.current = window.setTimeout(() => {
      void runParse(value);
    }, 600);
  };

  const save = async () => {
    const url = draft.url.trim();
    if (!url) {
      toast.error('请填写网址');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        url,
        title: draft.title.trim() || undefined,
        favicon_url: draft.favicon_url.trim() || undefined,
        note: draft.note.trim() || undefined,
      };
      const res =
        mode === 'edit' && initial
          ? await fetch(`/api/favorites/${initial.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
          : await fetch('/api/favorites', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || '保存失败');
      }
      toast.success(mode === 'edit' ? '已更新' : '已添加收藏');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fav-form-title"
      >
        <header className={styles.header}>
          <h3 id="fav-form-title">{mode === 'edit' ? '编辑收藏' : '添加收藏'}</h3>
          <button type="button" className={styles.close} onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <div className={styles.body}>
          <p className={styles.hint}>
            粘贴网址后将自动解析网站名称与图标，也可手动修改后再保存。
          </p>

          <label className={styles.field}>
            <span>网址</span>
            <div className={styles.urlRow}>
              <input
                type="url"
                value={draft.url}
                placeholder="https://example.com"
                autoFocus={mode === 'add'}
                onChange={(e) => onUrlChange(e.target.value)}
                onBlur={() => void runParse(draft.url)}
              />
              <button
                type="button"
                className={styles.secondaryBtn}
                disabled={parsing || !draft.url.trim()}
                onClick={() => void runParse(draft.url, { force: true })}
              >
                {parsing ? <Loader2 size={14} className={styles.spin} /> : '解析'}
              </button>
            </div>
          </label>

          <div className={styles.preview}>
            {draft.favicon_url ? (
              <img src={draft.favicon_url} alt="" className={styles.previewIcon} />
            ) : (
              <span className={styles.previewFallback}>
                <Globe size={18} aria-hidden />
              </span>
            )}
            <div className={styles.previewMeta}>
              <strong>{draft.title || '未命名网站'}</strong>
              <span>{draft.url || '—'}</span>
            </div>
          </div>

          <label className={styles.field}>
            <span>名称</span>
            <input
              type="text"
              value={draft.title}
              placeholder="网站名称"
              onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
            />
          </label>

          <label className={styles.field}>
            <span>Favicon URL</span>
            <input
              type="url"
              value={draft.favicon_url}
              placeholder="可留空，自动解析"
              onChange={(e) => setDraft((p) => ({ ...p, favicon_url: e.target.value }))}
            />
          </label>

          <label className={styles.field}>
            <span>备注</span>
            <textarea
              value={draft.note}
              rows={3}
              placeholder="可选备注"
              onChange={(e) => setDraft((p) => ({ ...p, note: e.target.value }))}
            />
          </label>
        </div>

        <footer className={styles.footer}>
          <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => void save()}
            disabled={saving || parsing}
          >
            {saving ? <Loader2 size={14} className={styles.spin} /> : null}
            保存
          </button>
        </footer>
      </div>
    </div>
  );
}
