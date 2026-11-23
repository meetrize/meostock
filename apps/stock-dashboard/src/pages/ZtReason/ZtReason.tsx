/**
 * 涨停异动原因：中转 t.xnge.cn/zt/{code}/ ，交互对齐涨停复盘页
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import styles from './ZtReason.module.css';

const STYLE_PATCH =
  '<style id="mootdx-xnge-patch">' +
  '.fupan-tit .tab{color:#fff!important;}' +
  '#tags a{color:#fff!important;}' +
  'html,body{overflow-x:auto!important;}' +
  '.help,footer{display:none!important;}' +
  '</style>';

function ensurePatch(html: string): string {
  if (html.includes('mootdx-xnge-patch')) return html;
  if (html.includes('<head>')) return html.replace('<head>', `<head>${STYLE_PATCH}`);
  if (html.includes('<Head>')) return html.replace('<Head>', `<Head>${STYLE_PATCH}`);
  return STYLE_PATCH + html;
}

function normalizeCode(raw: string | undefined | null): string {
  const s = (raw || '').trim();
  const m = s.match(/(\d{6})/);
  if (m) return m[1];
  return s.replace(/[^A-Za-z0-9_-]+/g, '');
}

function buildProxyUrl(code: string, bg: string, hidenav: string): string {
  const q = new URLSearchParams({
    hidenav: hidenav || '0',
    bg: bg || 'ffffff',
  });
  return `/zt/${encodeURIComponent(code)}?${q.toString()}`;
}

export function ZtReason() {
  const { code: routeCode } = useParams<{ code?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const bg = searchParams.get('bg') || 'ffffff';
  const hidenav = searchParams.get('hidenav') || '0';
  const code = useMemo(() => normalizeCode(routeCode), [routeCode]);

  const [inputCode, setInputCode] = useState(code);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [error, setError] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const proxyUrl = code ? buildProxyUrl(code, bg, hidenav) : '';

  useEffect(() => {
    setInputCode(code);
  }, [code]);

  useEffect(() => {
    if (!code) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    const ctrl = new AbortController();

    async function load() {
      setStatus('loading');
      setError('');
      try {
        const res = await fetch(proxyUrl, {
          headers: { Accept: 'text/html' },
          cache: 'no-store',
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = ensurePatch(await res.text());
        if (cancelled || !iframeRef.current) return;
        iframeRef.current.srcdoc = html;
        setStatus('ok');
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
        setStatus('error');
        setError(e instanceof Error ? e.message : String(e));
        if (iframeRef.current) iframeRef.current.src = proxyUrl;
      }
    }

    void load();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [code, proxyUrl]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next = normalizeCode(inputCode);
    if (!next) return;
    const q = new URLSearchParams();
    q.set('bg', bg);
    q.set('hidenav', hidenav);
    navigate(`/zt/${encodeURIComponent(next)}?${q.toString()}`);
  };

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarMain}>
          <h2 className={styles.title}>涨停异动原因</h2>
          <p className={styles.sub}>
            中转{' '}
            <code>
              t.xnge.cn/zt/{'{code}'}/?bg=ffffff
            </code>
            {' → '}
            <code>/zt/{'{code}'}?bg=ffffff</code>
            {code ? (
              <>
                {' · '}
                {proxyUrl}
                {status === 'loading' ? ' · 加载中…' : null}
                {status === 'error' ? ` · 失败：${error}（已回退直链）` : null}
              </>
            ) : (
              ' · 输入 6 位代码打开'
            )}
          </p>
          <form className={styles.form} onSubmit={onSubmit}>
            <input
              className={styles.input}
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              placeholder="如 600519"
              inputMode="numeric"
              aria-label="股票代码"
            />
            <button type="submit" className={styles.btn}>
              打开
            </button>
            <label className={styles.bgLabel}>
              背景
              <input
                className={styles.bgInput}
                value={bg}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^0-9a-fA-F#]/g, '') || 'ffffff';
                  const q = new URLSearchParams(searchParams);
                  q.set('bg', next.replace(/^#/, ''));
                  setSearchParams(q, { replace: true });
                }}
              />
            </label>
          </form>
        </div>
        {code ? (
          <a className={styles.link} href={proxyUrl} target="_blank" rel="noopener noreferrer">
            新窗口打开
          </a>
        ) : null}
      </div>
      <div className={styles.scroll}>
        {code ? (
          <iframe
            ref={iframeRef}
            className={styles.frame}
            title={`涨停异动 ${code}`}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"
          />
        ) : (
          <div className={styles.empty}>输入股票代码查看涨停异动原因（犀利 zt 中转）</div>
        )}
      </div>
    </div>
  );
}
