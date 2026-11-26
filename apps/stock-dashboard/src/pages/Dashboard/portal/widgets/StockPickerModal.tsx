/**
 * Portal 选股弹窗：市场 Tab + 搜索（sdk.search → /api/symbols 回退）
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { search as searchApi } from '@/services/sdk';
import { normalizeStockCode } from '@/utils/format';
import {
  buildCustomStockConfig,
  type CustomStockConfig,
  type CustomStockMarket,
} from '../customStock';
import styles from './StockPickerModal.module.css';

const MARKET_TABS: Array<{ id: CustomStockMarket; label: string }> = [
  { id: 'cn', label: 'A股' },
  { id: 'hk', label: '港股' },
  { id: 'us', label: '美股' },
];

const MARKET_LABEL: Record<CustomStockMarket, string> = {
  cn: 'A股',
  hk: '港股',
  us: '美股',
};

export type StockPickerHit = {
  market: CustomStockMarket;
  code: string;
  name: string;
  klineSymbol: string;
};

interface StockPickerModalProps {
  open: boolean;
  title?: string;
  confirmLabel?: string;
  initialMarket?: CustomStockMarket;
  initialCode?: string;
  onClose: () => void;
  onConfirm: (config: CustomStockConfig) => void;
}

function marketOfSdk(raw: string): CustomStockMarket | null {
  const m = (raw || '').toLowerCase();
  if (m === 'sh' || m === 'sz' || m === 'bj' || m === 'cn') return 'cn';
  if (m === 'hk') return 'hk';
  if (m === 'us') return 'us';
  return null;
}

function displayCode(code: string): string {
  return code.replace(/^(sh|sz|bj|hk|us)/i, '') || code;
}

async function fetchSymbolsApi(
  market: CustomStockMarket,
  q: string
): Promise<StockPickerHit[]> {
  const qs = new URLSearchParams({
    market,
    page: '1',
    size: '40',
    q: q.trim(),
  });
  const res = await fetch(`/api/symbols?${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok || !Array.isArray(data.items)) return [];
  return (data.items as Array<Record<string, unknown>>)
    .map((it) => {
      const code = normalizeStockCode(String(it.symbol || it.code || ''));
      if (!code) return null;
      return {
        market,
        code,
        name: String(it.name || code),
        klineSymbol: code,
      } satisfies StockPickerHit;
    })
    .filter((x): x is StockPickerHit => Boolean(x));
}

export function StockPickerModal({
  open,
  title = '选择股票',
  confirmLabel = '添加到总览',
  initialMarket = 'cn',
  initialCode,
  onClose,
  onConfirm,
}: StockPickerModalProps) {
  const [market, setMarket] = useState<CustomStockMarket>(initialMarket);
  const [keyword, setKeyword] = useState('');
  const [hits, setHits] = useState<StockPickerHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<StockPickerHit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const wasOpenRef = useRef(false);
  const initialCodeRef = useRef(initialCode);

  onCloseRef.current = onClose;
  initialCodeRef.current = initialCode;

  // 仅在弹窗从关闭→打开时重置；勿依赖 onClose（父组件轮询重渲染会换引用）
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setMarket(initialMarket);
      setKeyword('');
      setHits([]);
      setSelected(null);
      setError(null);
      const t = window.setTimeout(() => inputRef.current?.focus(), 40);
      wasOpenRef.current = true;
      return () => window.clearTimeout(t);
    }
    if (!open) wasOpenRef.current = false;
  }, [open, initialMarket]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = keyword.trim();
    if (q.length < 1) {
      setHits([]);
      setLoading(false);
      setError(null);
      return;
    }

    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const sdkRows = await searchApi(q);
          if (seqRef.current !== seq) return;
          let mapped: StockPickerHit[] = sdkRows
            .filter((r) => {
              if (r.category && r.category !== 'stock') return false;
              const m = marketOfSdk(r.market);
              return m === market;
            })
            .map((r) => {
              const code = normalizeStockCode(r.code) || r.code;
              return {
                market,
                code,
                name: r.name || code,
                klineSymbol: code,
              };
            });

          if (mapped.length < 3) {
            const apiRows = await fetchSymbolsApi(market, q);
            if (seqRef.current !== seq) return;
            const seen = new Set(mapped.map((h) => h.code.toLowerCase()));
            for (const row of apiRows) {
              const key = row.code.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              mapped.push(row);
            }
          }

          setHits(mapped.slice(0, 40));
          const seed = initialCodeRef.current;
          if (seed) {
            const want = normalizeStockCode(seed).toLowerCase();
            const hit = mapped.find((h) => h.code.toLowerCase() === want);
            if (hit) setSelected(hit);
          }
        } catch (e) {
          if (seqRef.current !== seq) return;
          try {
            const apiRows = await fetchSymbolsApi(market, q);
            if (seqRef.current !== seq) return;
            setHits(apiRows.slice(0, 40));
          } catch {
            if (seqRef.current !== seq) return;
            setHits([]);
            setError(e instanceof Error ? e.message : '搜索失败');
          }
        } finally {
          if (seqRef.current === seq) setLoading(false);
        }
      })();
    }, 200);

    return () => window.clearTimeout(timer);
  }, [keyword, market, open]);

  const emptyText = useMemo(() => {
    if (loading) return '搜索中…';
    if (error) return error;
    if (!keyword.trim()) return '输入代码或名称搜索';
    return '无匹配结果，换个关键词试试';
  }, [error, keyword, loading]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={styles.title}>{title}</div>
          <button
            type="button"
            className={styles.close}
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.tabs} role="tablist" aria-label="市场">
            {MARKET_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={market === tab.id}
                className={`${styles.tab} ${
                  market === tab.id ? styles.tabActive : ''
                }`}
                onClick={() => {
                  setMarket(tab.id);
                  setSelected(null);
                  setHits([]);
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className={styles.searchWrap}>
            <Search size={14} className={styles.searchIcon} aria-hidden />
            <input
              ref={inputRef}
              className={styles.searchInput}
              value={keyword}
              placeholder={`${MARKET_LABEL[market]}代码或名称`}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <div className={styles.hint}>
            选中后加入总览，以报价 + 日线面积图展示
          </div>

          <div className={styles.list} role="listbox" aria-label="搜索结果">
            {hits.length === 0 ? (
              <div className={styles.empty}>{emptyText}</div>
            ) : (
              hits.map((hit) => {
                const active = selected?.code === hit.code;
                return (
                  <button
                    key={hit.code}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`${styles.row} ${active ? styles.rowActive : ''}`}
                    onClick={() => setSelected(hit)}
                    onDoubleClick={() => {
                      onConfirm(
                        buildCustomStockConfig({
                          market: hit.market,
                          code: hit.code,
                          name: hit.name,
                          klineSymbol: hit.klineSymbol,
                        })
                      );
                    }}
                  >
                    <span className={styles.rowName}>{hit.name}</span>
                    <span className={styles.rowCode}>{displayCode(hit.code)}</span>
                    <span className={styles.rowMarket}>
                      {MARKET_LABEL[hit.market]}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary}`}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              onConfirm(
                buildCustomStockConfig({
                  market: selected.market,
                  code: selected.code,
                  name: selected.name,
                  klineSymbol: selected.klineSymbol,
                })
              );
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
