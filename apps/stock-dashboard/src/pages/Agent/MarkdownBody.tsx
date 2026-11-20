/**
 * Agent 回复轻量 Markdown 渲染（不引入第三方依赖）
 * 支持：标题、段落、列表、表格、代码块/行内代码、粗体/斜体、链接（含 kline:）
 */

import { Fragment, type ReactNode } from 'react';
import { openKlineTool } from '@/utils/multipanel';
import styles from './Agent.module.css';

type Props = {
  text: string;
  className?: string;
};

function openKline(symbol: string) {
  openKlineTool(symbol);
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // links | bold | italic | inline code
  const re =
    /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) {
      // 裸文本包 span：避免 Safari/浏览器翻译改写文本节点后 React removeChild 崩溃
      nodes.push(<span key={`${keyPrefix}-t${i}`}>{text.slice(last, m.index)}</span>);
    }
    const key = `${keyPrefix}-${i++}`;
    if (m[1]) {
      const label = m[2];
      const href = m[3];
      if (href.startsWith('kline:')) {
        const symbol = href.slice('kline:'.length);
        nodes.push(
          <button
            key={key}
            type="button"
            className={styles.inlineLink}
            onClick={() => symbol && openKline(symbol)}
          >
            <span>{label}</span>
          </button>
        );
      } else if (href.startsWith('/?symbol=') || href.startsWith('?symbol=')) {
        const symbol = new URLSearchParams(href.replace(/^\//, '').replace(/^\?/, '')).get(
          'symbol'
        );
        nodes.push(
          <button
            key={key}
            type="button"
            className={styles.inlineLink}
            onClick={() => symbol && openKline(symbol)}
          >
            <span>{label}</span>
          </button>
        );
      } else if (/^https?:\/\//i.test(href)) {
        nodes.push(
          <a key={key} href={href} target="_blank" rel="noopener noreferrer" className={styles.mdLink}>
            <span>{label}</span>
          </a>
        );
      } else {
        nodes.push(
          <span key={key} className={styles.inlineLink}>
            {label}
          </span>
        );
      }
    } else if (m[4]) {
      nodes.push(
        <strong key={key}>
          <span>{m[5]}</span>
        </strong>
      );
    } else if (m[6]) {
      nodes.push(
        <em key={key}>
          <span>{m[7]}</span>
        </em>
      );
    } else if (m[8]) {
      nodes.push(
        <code key={key} className={styles.mdInlineCode}>
          <span>{m[9]}</span>
        </code>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    nodes.push(<span key={`${keyPrefix}-t${i}`}>{text.slice(last)}</span>);
  }
  return nodes;
}

function isTableSep(line: string): boolean {
  return /^\s*\|?[\s:-]+\|[\s|:-]*\|?\s*$/.test(line) && line.includes('-');
}

function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function parseBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let block = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      out.push(
        <pre key={`c-${block++}`} className={styles.mdPre}>
          {lang ? <div className={styles.mdCodeLang}>{lang}</div> : null}
          <code>{body.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // table: header + sep + rows
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      isTableSep(lines[i + 1])
    ) {
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      out.push(
        <div key={`t-${block++}`} className={styles.mdTableWrap}>
          <table className={styles.mdTable}>
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th key={hi}>{renderInline(h, `th-${block}-${hi}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {header.map((_, ci) => (
                    <td key={ci}>{renderInline(row[ci] ?? '', `td-${block}-${ri}-${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // blank
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // heading（固定标签，避免动态组件类型在部分环境下异常）
    const hm = /^(#{1,4})\s+(.+)$/.exec(line);
    if (hm) {
      const level = hm[1].length;
      const content = renderInline(hm[2], `h-${block}`);
      const key = `h-${block++}`;
      if (level <= 1) {
        out.push(
          <h2 key={key} className={styles.mdHeading}>
            {content}
          </h2>
        );
      } else if (level === 2) {
        out.push(
          <h3 key={key} className={styles.mdHeading}>
            {content}
          </h3>
        );
      } else if (level === 3) {
        out.push(
          <h4 key={key} className={styles.mdHeading}>
            {content}
          </h4>
        );
      } else {
        out.push(
          <h5 key={key} className={styles.mdHeading}>
            {content}
          </h5>
        );
      }
      i += 1;
      continue;
    }

    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i += 1;
      }
      out.push(
        <ul key={`ul-${block++}`} className={styles.mdList}>
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `ul-${block}-${ii}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i += 1;
      }
      out.push(
        <ol key={`ol-${block++}`} className={styles.mdList}>
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `ol-${block}-${ii}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // paragraph (merge consecutive non-special lines)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i]) &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !(
        lines[i].includes('|') &&
        i + 1 < lines.length &&
        isTableSep(lines[i + 1])
      )
    ) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(
      <p key={`p-${block++}`} className={styles.mdP}>
        {para.map((pl, pi) => (
          <Fragment key={pi}>
            {pi > 0 ? <br /> : null}
            {renderInline(pl, `p-${block}-${pi}`)}
          </Fragment>
        ))}
      </p>
    );
  }

  return out;
}

export function MarkdownBody({ text, className }: Props) {
  if (!text) return null;
  return (
    <div
      className={`${styles.mdBody}${className ? ` ${className}` : ''}`}
      translate="no"
    >
      {parseBlocks(text)}
    </div>
  );
}
