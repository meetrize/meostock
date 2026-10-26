/**
 * 涨停复盘：AJAX 拉取本地 xnge 中转 HTML，写入右侧 iframe（可横向滚动）
 */

import { useEffect, useRef, useState } from 'react';
import styles from './FupanReview.module.css';

const FUPAN_URL = '/xnge/fupan/?hidenav=0&bg=ffffff';

const STYLE_PATCH =
  '<style id="mootdx-xnge-patch">' +
  '.fupan-tit .tab{color:#fff!important;}' +
  '#tags a{color:#fff!important;}' +
  'html,body{overflow-x:auto!important;}' +
  '</style>';

function ensurePatch(html: string): string {
  if (html.includes('mootdx-xnge-patch')) return html;
  if (html.includes('<head>')) return html.replace('<head>', `<head>${STYLE_PATCH}`);
  if (html.includes('<Head>')) return html.replace('<Head>', `<Head>${STYLE_PATCH}`);
  return STYLE_PATCH + html;
}

export function FupanReview() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    async function load() {
      setStatus('loading');
      setError('');
      try {
        const res = await fetch(FUPAN_URL, {
          headers: { Accept: 'text/html' },
          cache: 'no-store',
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = ensurePatch(await res.text());
        if (cancelled || !iframeRef.current) return;
        // 同源中转页用 srcdoc 渲染，保留脚本；横向滚动由外层 .scroll + 页内 overflow-x
        iframeRef.current.srcdoc = html;
        setStatus('ok');
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
        setStatus('error');
        setError(e instanceof Error ? e.message : String(e));
        // 回退：直接嵌同源地址
        if (iframeRef.current) iframeRef.current.src = FUPAN_URL;
      }
    }

    void load();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div>
          <h2 className={styles.title}>涨停复盘</h2>
          <p className={styles.sub}>
            AJAX 加载 {FUPAN_URL}
            {status === 'loading' ? ' · 加载中…' : null}
            {status === 'error' ? ` · 失败：${error}（已回退直链）` : null}
          </p>
        </div>
        <a className={styles.link} href={FUPAN_URL} target="_blank" rel="noopener noreferrer">
          新窗口打开
        </a>
      </div>
      <div className={styles.scroll}>
        <iframe
          ref={iframeRef}
          className={styles.frame}
          title="涨停复盘"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"
        />
      </div>
    </div>
  );
}
