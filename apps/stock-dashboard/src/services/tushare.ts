/**
 * 本机 Tushare 网关（/api/tushare/*）
 */

export interface TushareCol {
  key: string;
  label: string;
  align?: 'left' | 'right';
}

export interface TushareNavLeaf {
  id: string;
  label: string;
  kind: 'legacy' | 'tushare' | 'placeholder';
  table: 'quote' | 'topic';
  hint?: string;
}

export interface TushareNavGroup {
  id: string;
  label: string;
  children: TushareNavLeaf[];
}

export interface TushareCatalog {
  tree: TushareNavGroup[];
  markets: Record<
    string,
    { id: string; label: string; table: string; columns: TushareCol[] }
  >;
  quoteColumns: TushareCol[];
}

export interface TushareMarketResult {
  ok: boolean;
  id?: string;
  label?: string;
  table?: 'quote' | 'topic' | string;
  columns?: TushareCol[];
  trade_date?: string | null;
  source?: string | null;
  total?: number;
  items?: Array<Record<string, unknown>>;
  error?: string;
  error_code?: string;
  hint?: string;
  placeholder?: boolean;
  meta?: Record<string, unknown>;
  cached?: boolean;
  stale?: boolean;
  syncing?: boolean;
  synced_at?: number | null;
  as_of?: number | null;
}

export interface TushareTradeDateResult {
  ok: boolean;
  trade_date?: string | null;
  last_open?: string | null;
  open_days?: string[];
  error?: string;
}

export async function fetchTushareCatalog(): Promise<TushareCatalog | null> {
  try {
    const res = await fetch('/api/tushare/catalog');
    const data = await res.json();
    if (!data.ok) return null;
    return {
      tree: data.tree || [],
      markets: data.markets || {},
      quoteColumns: data.quoteColumns || [],
    };
  } catch {
    return null;
  }
}

export async function fetchTushareTradeDate(
  preferred?: string
): Promise<TushareTradeDateResult> {
  const qs = new URLSearchParams();
  if (preferred) qs.set('date', preferred);
  const res = await fetch(`/api/tushare/trade-date?${qs}`);
  return res.json();
}

export async function fetchTushareMarket(
  id: string,
  tradeDate?: string
): Promise<TushareMarketResult> {
  const qs = new URLSearchParams({ id });
  if (tradeDate) qs.set('trade_date', tradeDate);
  const res = await fetch(`/api/tushare/market?${qs}`);
  return res.json();
}

export async function fetchTushareHealth(): Promise<{
  ok: boolean;
  configured?: boolean;
  enabled?: boolean;
}> {
  try {
    const res = await fetch('/api/tushare/health');
    return res.json();
  } catch {
    return { ok: false };
  }
}

export async function fetchTushareSchedule(): Promise<{
  ok: boolean;
  enabled?: boolean;
  cron?: string[];
  last_run?: string | null;
  last_result?: string | null;
  error?: string;
}> {
  const res = await fetch('/api/tushare/schedule');
  return res.json();
}

export async function setTushareSchedule(enabled: boolean): Promise<{
  ok: boolean;
  enabled?: boolean;
  error?: string;
}> {
  const res = await fetch('/api/tushare/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  return res.json();
}

export async function clearTushareCache(): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/tushare/cache/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return res.json();
}

export function isTushareMarketId(id: string): boolean {
  return id.startsWith('ts:');
}
