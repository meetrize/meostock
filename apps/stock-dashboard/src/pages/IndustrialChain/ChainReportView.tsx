/**
 * 产业链绑定报告：HTML 保格式内嵌展示，代码/公司名点开 K 线，TOC / io / 关系高亮
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { openKlineTool } from '@/utils/multipanel';
import { getBundledReport, resolveReportFetchUrl } from './reportRegistry';
import type { IndustrialChainGraph } from './types';
import styles from './IndustrialChain.module.css';

type TocItem = { id: string; text: string; level: 2 | 3 };
type IoFilter = 'all' | 'input' | 'output' | 'both';

const CODE_RE = /\d{6}\.(?:SZ|SH|BJ)/g;
const CODE_ONLY_RE = /^(\d{6}\.(?:SZ|SH|BJ))$/;

function extractBodyAndStyle(html: string): { style: string; body: string } {
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  let style = styleMatch?.[1] ?? '';
  style = style
    .replace(/\bbody\s*\{/g, '.chainReportRoot{')
    .replace(/background\s*:\s*var\(--bg\)/g, 'background:transparent');

  let body = html;
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) body = bodyMatch[1];
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '');
  // SPA 误返回 index.html 时快速识别
  if (/<div id="root"|vite|react/i.test(body) && !/<table/i.test(body)) {
    throw new Error('报告地址被 SPA 回退拦截，请使用内嵌报告或带 BASE_URL 的路径');
  }
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

function makeCodeButton(code: string): HTMLButtonElement {
  const a = document.createElement('button');
  a.type = 'button';
  a.className = 'chainReportCode';
  a.dataset.code = code;
  a.textContent = code;
  a.title = `打开 K 线 ${code}`;
  return a;
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
  const [focusCode, setFocusCode] = useState<string | null>(null);

  const bundled = useMemo(
    () => getBundledReport(graph.reportId),
    [graph.reportId]
  );
  const hasReport = !!(bundled || graph.reportUrl || graph.reportId);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setFocusCode(null);

    if (bundled?.html) {
      setRawHtml(bundled.html);
      return () => {
        cancelled = true;
      };
    }

    const url = resolveReportFetchUrl(graph.reportUrl);
    if (!url) {
      setRawHtml(null);
      return;
    }

    setRawHtml(null);
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`加载失败 ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (cancelled) return;
        if (text.includes('<div id="root"') && !text.includes('class="code"')) {
          throw new Error('报告静态文件未找到（被前端路由回退）。请确认已内嵌或部署到 public/reports');
        }
        setRawHtml(text);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || '报告加载失败');
      });

    return () => {
      cancelled = true;
    };
  }, [bundled, graph.reportUrl]);

  const symbols = useMemo(() => (rawHtml ? collectCodes(rawHtml) : []), [rawHtml]);

  const entityBySymbol = useMemo(() => {
    const map = new Map<string, string>();
    for (const ent of graph.entities) {
      for (const s of ent.symbols) map.set(s, ent.id);
    }
    return map;
  }, [graph.entities]);

  const relatedCodesOf = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const relations = graph.relations ?? [];
    const symOf = (eid: string) =>
      graph.entities.find((e) => e.id === eid)?.symbols[0] ?? null;
    for (const r of relations) {
      const a = symOf(r.fromEntityId);
      const b = symOf(r.toEntityId);
      if (!a && !b) continue;
      if (a) {
        if (!map.has(a)) map.set(a, new Set());
        if (b) map.get(a)!.add(b);
      }
      if (b) {
        if (!map.has(b)) map.set(b, new Set());
        if (a) map.get(b)!.add(a);
      }
    }
    return map;
  }, [graph.entities, graph.relations]);

  const segmentByNameHint = useMemo(() => {
    const map: { re: RegExp; id: string }[] = [];
    for (const seg of graph.segments) {
      map.push({ re: new RegExp(seg.name.replace(/\s+/g, '\\s*')), id: seg.id });
    }
    return map;
  }, [graph.segments]);

  const openCode = (code: string) => {
    const idx = symbols.indexOf(code);
    openKlineTool(code, '1d', {
      symbols: symbols.length >= 2 ? symbols : undefined,
      index: idx >= 0 ? idx : 0,
    });
    setFocusCode(code);
    const entId = entityBySymbol.get(code);
    if (entId) onSelectEntity?.(entId);
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !rawHtml) return;

    let styleBody: { style: string; body: string };
    try {
      styleBody = extractBodyAndStyle(rawHtml);
    } catch (e) {
      setError(e instanceof Error ? e.message : '报告解析失败');
      return;
    }
    const { style, body } = styleBody;
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-chain-report', '1');
    styleEl.textContent = [
      style,
      `.chainReportRoot .chainReportCode,.chainReportRoot .chainReportName{display:inline;margin:0;padding:0;border:none;background:transparent;color:var(--accent,#2563eb);font:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:2px}`,
      `.chainReportRoot .chainReportName{font-weight:700;text-decoration-style:dotted;white-space:nowrap}`,
      `.chainReportRoot .co-code .chainReportCode{font:inherit;color:inherit;text-decoration-color:color-mix(in srgb,var(--accent,#2563eb) 55%,transparent)}`,
      `.chainReportRoot tr.chainReportIoDim,.chainReportRoot tr.chainReportRelDim{opacity:.28}`,
      `.chainReportRoot tr.chainReportIoHit,.chainReportRoot tr.chainReportRelHit{outline:1px solid color-mix(in srgb,var(--accent,#2563eb) 40%,transparent);outline-offset:-1px;background:color-mix(in srgb,var(--accent,#2563eb) 8%,transparent)}`,
      `.chainReportRoot tr.chainReportRelFocus{outline:2px solid var(--accent,#2563eb);outline-offset:-2px}`,
    ].join('\n');

    const host = document.createElement('div');
    host.className = 'wrap';
    host.innerHTML = body;
    const innerWrap = host.querySelector(':scope > .wrap');
    const content = innerWrap ? (innerWrap as HTMLElement) : host;

    const items: TocItem[] = [];
    content.querySelectorAll('h2, h3').forEach((el, idx) => {
      const text = (el.textContent || '').trim();
      if (!text) return;
      const id = slugify(text, idx);
      el.id = id;
      items.push({ id, text, level: el.tagName === 'H2' ? 2 : 3 });
    });
    setToc(items);

    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const t = n as Text;
      const parent = t.parentElement;
      if (!parent) continue;
      if (parent.closest('script, style, a, button, .co-code, td.code')) continue;
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
        frag.appendChild(makeCodeButton(code));
        last = start + code.length;
      }
      if (last < raw.length) frag.appendChild(document.createTextNode(raw.slice(last)));
      t.parentNode?.replaceChild(frag, t);
    }

    content.querySelectorAll('.co-code, td.code').forEach((el) => {
      const text = (el.textContent || '').trim();
      if (!CODE_ONLY_RE.test(text)) return;
      if (el.querySelector('.chainReportCode')) return;
      el.textContent = '';
      el.appendChild(makeCodeButton(text));
    });

    // 表格行：公司名可点开 K 线（合并列时只包 .co-name，避免抹掉代码）
    content.querySelectorAll('tbody tr').forEach((tr) => {
      const codeEl = tr.querySelector('.co-code, td.code, .chainReportCode') as HTMLElement | null;
      const code =
        codeEl?.dataset.code ||
        (codeEl?.textContent || '').trim().match(CODE_ONLY_RE)?.[1];
      if (!code) return;
      (tr as HTMLElement).dataset.reportCode = code;
      const nameHost =
        (tr.querySelector('.co-name') as HTMLElement | null) ||
        (tr.querySelector('td.co, td:first-child') as HTMLElement | null);
      if (!nameHost || nameHost.querySelector('.chainReportName')) return;
      const nameText = (nameHost.textContent || '').trim();
      if (!nameText || nameText === '—' || nameText === '-') return;
      nameHost.textContent = '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chainReportName';
      btn.dataset.code = code;
      btn.textContent = nameText;
      btn.title = `打开 K 线 ${code}`;
      nameHost.appendChild(btn);
    });

    root.replaceChildren(styleEl, content);

    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const hit = t.closest('.chainReportCode, .chainReportName') as HTMLElement | null;
      if (hit?.dataset.code) {
        e.preventDefault();
        openCode(hit.dataset.code);
      }
    };
    root.addEventListener('click', onClick);
    return () => {
      root.removeEventListener('click', onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openCode closes over latest symbols/maps
  }, [rawHtml, symbols, entityBySymbol, onSelectEntity]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll('tr[data-report-code], tr').forEach((el) => {
      const row = el as HTMLElement;
      const tag = row.querySelector('.tag');
      if (tag) {
        const isIn = tag.classList.contains('t-in');
        const isOut = tag.classList.contains('t-out');
        const isBoth = tag.classList.contains('t-both');
        let show = true;
        if (ioFilter === 'input') show = isIn || isBoth;
        else if (ioFilter === 'output') show = isOut || isBoth;
        else if (ioFilter === 'both') show = isBoth;
        row.classList.toggle('chainReportIoDim', ioFilter !== 'all' && !show);
        row.classList.toggle('chainReportIoHit', ioFilter !== 'all' && show);
      }
    });
  }, [ioFilter, rawHtml]);

  // 选中公司后高亮本行 + 图谱关系邻居行
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const related = focusCode ? relatedCodesOf.get(focusCode) : null;
    root.querySelectorAll('tr[data-report-code]').forEach((el) => {
      const row = el as HTMLElement;
      const code = row.dataset.reportCode || '';
      const isFocus = !!focusCode && code === focusCode;
      const isRel = !!focusCode && !!related?.has(code);
      row.classList.toggle('chainReportRelFocus', isFocus);
      row.classList.toggle('chainReportRelHit', isRel);
      row.classList.toggle(
        'chainReportRelDim',
        !!focusCode && !isFocus && !isRel
      );
    });
  }, [focusCode, relatedCodesOf, rawHtml]);

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

  if (!hasReport) {
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
        {focusCode && (
          <button
            type="button"
            className={styles.btn}
            style={{ marginTop: 8 }}
            onClick={() => setFocusCode(null)}
          >
            清除关系高亮（{focusCode}）
          </button>
        )}
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
          点击公司名或代码打开 K 线 · 共 {symbols.length} 只
          {bundled ? ' · 内嵌正文' : ''}
        </p>
      </aside>
      <div className={styles.reportScroll}>
        <div ref={rootRef} className={`chainReportRoot ${styles.chainReportRoot}`} />
      </div>
    </div>
  );
}
