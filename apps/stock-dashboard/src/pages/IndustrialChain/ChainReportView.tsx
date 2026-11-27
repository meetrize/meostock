/**
 * 产业链绑定报告：本地 HTML 保格式展示，代码可点开 K 线，TOC / io 过滤 / 图谱互跳
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { openKlineTool } from '@/utils/multipanel';
import type { IndustrialChainGraph } from './types';
import styles from './IndustrialChain.module.css';

type TocItem = { id: string; text: string; level: 2 | 3 };
type IoFilter = 'all' | 'input' | 'output' | 'both';

const CODE_RE = /\d{6}\.(?:SZ|SH|BJ)/g;
const CODE_ONLY_RE = /^(\d{6}\.(?:SZ|SH|BJ))$/;

function extractBodyAndStyle(html: string): { style: string; body: string } {
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  let style = styleMatch?.[1] ?? '';
  // scope body rules under report root; inherit dashboard background
  style = style
    .replace(/\bbody\s*\{/g, '.chainReportRoot{')
    .replace(/background\s*:\s*var\(--bg\)/g, 'background:transparent');

  let body = html;
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) body = bodyMatch[1];
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '');
  return { style, body };
}

function slugify(text: string, idx: number): string {
  const base = text
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fff\-]+/g, '')
    .slice(0, 48);
  return `rpt-${base || 'h'}-${idx}`;
}

function collectCodes(html: string): string[] {
  const found = html.match(CODE_RE) ?? [];
  return [...new Set(found)];
}

export function ChainReportView({
  graph,
  scrollToHint,
  onSelectEntity,
  onSelectSegment,
  onOpenRelations,
  onOpenGraph,
}: {
  graph: IndustrialChainGraph;
  /** 从图谱跳入时，匹配 H2/H3 文本并滚动 */
  scrollToHint?: string | null;
  onSelectEntity?: (entityId: string) => void;
  onSelectSegment?: (segmentId: string) => void;
  onOpenRelations?: (entityId: string) => void;
  onOpenGraph?: (segmentId: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [rawHtml, setRawHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [ioFilter, setIoFilter] = useState<IoFilter>('all');
  const [activeToc, setActiveToc] = useState<string | null>(null);

  const reportUrl = graph.reportUrl;

  useEffect(() => {
    if (!reportUrl) {
      setRawHtml(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);
    fetch(reportUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`加载失败 ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (!cancelled) setRawHtml(text);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || '报告加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [reportUrl]);

  const symbols = useMemo(() => (rawHtml ? collectCodes(rawHtml) : []), [rawHtml]);

  const entityBySymbol = useMemo(() => {
    const map = new Map<string, string>();
    for (const ent of graph.entities) {
      for (const s of ent.symbols) map.set(s, ent.id);
    }
    return map;
  }, [graph.entities]);

  const segmentByNameHint = useMemo(() => {
    const map: { re: RegExp; id: string }[] = [];
    for (const seg of graph.segments) {
      map.push({ re: new RegExp(seg.name.replace(/\s+/g, '\\s*')), id: seg.id });
    }
    return map;
  }, [graph.segments]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !rawHtml) return;

    const { style, body } = extractBodyAndStyle(rawHtml);
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-chain-report', '1');
    styleEl.textContent = style;

    const host = document.createElement('div');
    host.className = 'wrap';
    host.innerHTML = body;

    // strip outer wrap if present to avoid double padding
    const innerWrap = host.querySelector(':scope > .wrap');
    const content = innerWrap ? (innerWrap as HTMLElement) : host;

    // TOC + anchors
    const items: TocItem[] = [];
    content.querySelectorAll('h2, h3').forEach((el, idx) => {
      const text = (el.textContent || '').trim();
      if (!text) return;
      const id = slugify(text, idx);
      el.id = id;
      items.push({ id, text, level: el.tagName === 'H2' ? 2 : 3 });
    });
    setToc(items);

    // linkify stock codes in text nodes & code cells
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const t = n as Text;
      const parent = t.parentElement;
      if (!parent) continue;
      if (parent.closest('script, style, a, button')) continue;
      if (!CODE_RE.test(t.nodeValue || '')) continue;
      CODE_RE.lastIndex = 0;
      textNodes.push(t);
    }
    for (const t of textNodes) {
      const raw = t.nodeValue || '';
      if (!CODE_RE.test(raw)) continue;
      CODE_RE.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const m of raw.matchAll(CODE_RE)) {
        const code = m[0];
        const start = m.index ?? 0;
        if (start > last) frag.appendChild(document.createTextNode(raw.slice(last, start)));
        const a = document.createElement('button');
        a.type = 'button';
        a.className = 'chainReportCode';
        a.dataset.code = code;
        a.textContent = code;
        frag.appendChild(a);
        last = start + code.length;
      }
      if (last < raw.length) frag.appendChild(document.createTextNode(raw.slice(last)));
      t.parentNode?.replaceChild(frag, t);
    }

    // also mark td.code cells
    content.querySelectorAll('td.code').forEach((td) => {
      const text = (td.textContent || '').trim();
      if (!CODE_ONLY_RE.test(text)) return;
      if (td.querySelector('.chainReportCode')) return;
      const code = text;
      td.textContent = '';
      const a = document.createElement('button');
      a.type = 'button';
      a.className = 'chainReportCode';
      a.dataset.code = code;
      a.textContent = code;
      td.appendChild(a);
    });

    root.replaceChildren(styleEl, content);

    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const btn = t.closest('.chainReportCode') as HTMLElement | null;
      if (btn?.dataset.code) {
        e.preventDefault();
        const code = btn.dataset.code;
        const idx = symbols.indexOf(code);
        openKlineTool(code, '1d', {
          symbols: symbols.length >= 2 ? symbols : undefined,
          index: idx >= 0 ? idx : 0,
        });
        const entId = entityBySymbol.get(code);
        if (entId) onSelectEntity?.(entId);
        return;
      }
      // company name strong → try sync entity
      const strong = t.closest('strong');
      if (strong && strong.parentElement) {
        const row = strong.closest('tr');
        const codeEl = row?.querySelector('.chainReportCode, td.code');
        const code =
          (codeEl as HTMLElement)?.dataset?.code ||
          (codeEl?.textContent || '').trim().match(CODE_ONLY_RE)?.[1];
        if (code) {
          const entId = entityBySymbol.get(code);
          if (entId) onSelectEntity?.(entId);
        }
      }
    };
    root.addEventListener('click', onClick);
    return () => {
      root.removeEventListener('click', onClick);
    };
  }, [rawHtml, symbols, entityBySymbol, onSelectEntity]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll('.tag').forEach((el) => {
      const tag = el as HTMLElement;
      const isIn = tag.classList.contains('t-in');
      const isOut = tag.classList.contains('t-out');
      const isBoth = tag.classList.contains('t-both');
      let show = true;
      if (ioFilter === 'input') show = isIn || isBoth;
      else if (ioFilter === 'output') show = isOut || isBoth;
      else if (ioFilter === 'both') show = isBoth;
      const row = tag.closest('tr');
      if (row) {
        row.classList.toggle('chainReportIoDim', ioFilter !== 'all' && !show);
        row.classList.toggle('chainReportIoHit', ioFilter !== 'all' && show);
      }
    });
  }, [ioFilter, rawHtml]);

  useEffect(() => {
    if (!scrollToHint || !rootRef.current) return;
    const root = rootRef.current;
    const heads = Array.from(root.querySelectorAll('h2, h3, h4'));
    const hit = heads.find((h) => (h.textContent || '').includes(scrollToHint));
    if (hit) {
      hit.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveToc(hit.id || null);
    }
  }, [scrollToHint, rawHtml]);

  if (!reportUrl) {
    return (
      <div className={styles.p2Panel}>
        <div className={styles.detailEmpty}>本链暂无绑定报告</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.p2Panel}>
        <div className={styles.detailEmpty}>{error}</div>
      </div>
    );
  }

  if (!rawHtml) {
    return (
      <div className={styles.p2Panel}>
        <div className={styles.detailEmpty}>报告加载中…</div>
      </div>
    );
  }

  const jumpSegmentFromToc = (text: string) => {
    for (const { re, id } of segmentByNameHint) {
      if (re.test(text)) {
        onOpenGraph?.(id);
        onSelectSegment?.(id);
        return;
      }
    }
  };

  return (
    <div className={styles.reportPanel}>
      <aside className={styles.reportToc}>
        <div className={styles.reportTocTitle}>目录</div>
        <nav className={styles.reportTocNav}>
          {toc.map((it) => (
            <button
              key={it.id}
              type="button"
              className={`${styles.reportTocItem} ${it.level === 3 ? styles.reportTocH3 : ''} ${
                activeToc === it.id ? styles.reportTocActive : ''
              }`}
              onClick={() => {
                const el = rootRef.current?.querySelector(`#${CSS.escape(it.id)}`);
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setActiveToc(it.id);
                jumpSegmentFromToc(it.text);
              }}
            >
              {it.text}
            </button>
          ))}
        </nav>
        <div className={styles.reportTocTitle}>输入 / 输出</div>
        <div className={styles.chipRow}>
          {(
            [
              ['all', '全部'],
              ['input', '输入'],
              ['output', '输出'],
              ['both', '双向'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`${styles.chip} ${ioFilter === id ? styles.chipActive : ''}`}
              onClick={() => setIoFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {graph.focalEntityId && (
          <button
            type="button"
            className={styles.btn}
            style={{ marginTop: 10 }}
            onClick={() => onOpenRelations?.(graph.focalEntityId!)}
          >
            打开关系网（枢纽）
          </button>
        )}
        <p className={styles.detailP} style={{ marginTop: 8, fontSize: 12 }}>
          点击代码打开 K 线 · 共 {symbols.length} 只标的
        </p>
      </aside>
      <div className={styles.reportScroll}>
        <div ref={rootRef} className={`chainReportRoot ${styles.chainReportRoot}`} />
      </div>
    </div>
  );
}
