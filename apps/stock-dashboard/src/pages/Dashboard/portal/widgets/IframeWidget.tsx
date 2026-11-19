/**
 * 第三方网页 iframe 嵌入面板
 */

import { useCallback, useMemo, useState } from 'react';
import type { PortalWidgetInstance } from '../types';
import styles from './IframeWidget.module.css';

const IFRAME_SANDBOX =
  'allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox';

export function sanitizeEmbedUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function readIframeConfig(widget: PortalWidgetInstance): {
  url: string;
  pageTitle: string;
} {
  const cfg = widget.config ?? {};
  const url = typeof cfg.url === 'string' ? cfg.url : '';
  const pageTitle =
    (typeof cfg.pageTitle === 'string' && cfg.pageTitle) ||
    widget.title ||
    '';
  return { url, pageTitle };
}

interface IframeWidgetProps {
  widget: PortalWidgetInstance;
  editing: boolean;
  onUpdate?: (patch: Partial<PortalWidgetInstance>) => void;
}

export function IframeWidget({ widget, editing, onUpdate }: IframeWidgetProps) {
  const { url, pageTitle } = readIframeConfig(widget);
  const safeUrl = useMemo(() => sanitizeEmbedUrl(url), [url]);
  const [draftUrl, setDraftUrl] = useState(url);
  const [draftTitle, setDraftTitle] = useState(pageTitle);
  const [error, setError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(!safeUrl);

  const showForm = editing && (configOpen || !safeUrl);

  const apply = useCallback(() => {
    const next = sanitizeEmbedUrl(draftUrl);
    if (!next) {
      setError('请输入有效的 http(s) 网址');
      return;
    }
    setError(null);
    onUpdate?.({
      title: draftTitle.trim() || undefined,
      config: {
        ...(widget.config ?? {}),
        url: next,
        pageTitle: draftTitle.trim() || undefined,
      },
    });
    setConfigOpen(false);
  }, [draftTitle, draftUrl, onUpdate, widget.config]);

  if (showForm) {
    return (
      <div className={styles.config}>
        <div className={styles.configHint}>
          嵌入第三方页面。部分站点禁止被 iframe 打开（X-Frame-Options / CSP）。
        </div>
        <label className={styles.field}>
          <span>标题</span>
          <input
            type="text"
            value={draftTitle}
            placeholder="网页"
            onChange={(e) => setDraftTitle(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>网址</span>
          <input
            type="url"
            value={draftUrl}
            placeholder="https://…"
            onChange={(e) => {
              setDraftUrl(e.target.value);
              setError(null);
            }}
          />
        </label>
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={apply}>
            保存
          </button>
          {safeUrl && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => setConfigOpen(false)}
            >
              取消
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!safeUrl) {
    return (
      <div className={styles.empty}>
        <p>尚未配置网址</p>
        {editing ? (
          <button type="button" className={styles.primary} onClick={() => setConfigOpen(true)}>
            配置网页
          </button>
        ) : (
          <p className={styles.hint}>进入「编辑布局」后可配置</p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.frameWrap}>
      {editing && (
        <button
          type="button"
          className={styles.editFab}
          onClick={() => {
            setDraftUrl(url);
            setDraftTitle(pageTitle);
            setConfigOpen(true);
          }}
        >
          配置
        </button>
      )}
      <iframe
        className={styles.frame}
        src={safeUrl}
        title={pageTitle || widget.title || '嵌入网页'}
        sandbox={IFRAME_SANDBOX}
        referrerPolicy="no-referrer-when-downgrade"
        loading="lazy"
      />
    </div>
  );
}
