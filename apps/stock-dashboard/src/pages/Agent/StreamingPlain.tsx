/**
 * 流式纯文本：用 textContent 写入稳定节点，避免 React 频繁增删文本节点
 * （Safari / 浏览器翻译下的 NotFoundError）。
 */

import { useEffect, useRef } from 'react';
import styles from './Agent.module.css';

type Props = {
  text: string;
};

export function StreamingPlain({ text }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.textContent = text || '…';
  }, [text]);

  return <div ref={ref} className={styles.userPlain} translate="no" />;
}
