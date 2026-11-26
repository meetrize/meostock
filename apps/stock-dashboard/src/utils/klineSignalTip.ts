/**
 * 公告 → K 线「信号」悬停 tip 交接（localStorage）
 * 与 web/static/kline/pattern-signal-tip.mjs 共用同一 key
 */

export const SIGNAL_TIP_STORE_KEY = 'kline_signal_tips_v1';
export const SIGNAL_TIP_TTL_MS = 24 * 60 * 60 * 1000;

export type KlineSignalTip = {
  symbol: string;
  date: string;
  title?: string;
  stockName?: string;
  level?: string;
  levelLabel?: string;
  direction?: string;
  score?: number | null;
  summary?: string;
  reasons?: string[];
  ts?: number;
};

function tipKey(symbol: string, date: string): string {
  return `${String(symbol || '').trim().toLowerCase()}|${String(date || '').trim().slice(0, 10)}`;
}

function readStore(): { v: 1; tips: Record<string, KlineSignalTip>; ts: number } {
  try {
    const raw = localStorage.getItem(SIGNAL_TIP_STORE_KEY);
    if (!raw) return { v: 1, tips: {}, ts: Date.now() };
    const parsed = JSON.parse(raw) as { tips?: Record<string, KlineSignalTip>; ts?: number };
    return {
      v: 1,
      tips: parsed?.tips && typeof parsed.tips === 'object' ? parsed.tips : {},
      ts: Number(parsed?.ts) || Date.now(),
    };
  } catch {
    return { v: 1, tips: {}, ts: Date.now() };
  }
}

function writeStore(store: { v: 1; tips: Record<string, KlineSignalTip>; ts: number }) {
  try {
    localStorage.setItem(SIGNAL_TIP_STORE_KEY, JSON.stringify(store));
  } catch {
    /* quota */
  }
}

export function writeKlineSignalTips(tips: KlineSignalTip | KlineSignalTip[]): void {
  const list = Array.isArray(tips) ? tips : [tips];
  const store = readStore();
  const now = Date.now();
  for (const tip of list) {
    const symbol = String(tip.symbol || '').trim();
    const date = String(tip.date || '').trim().slice(0, 10);
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    store.tips[tipKey(symbol, date)] = {
      symbol,
      date,
      title: String(tip.title || '').trim(),
      stockName: String(tip.stockName || '').trim(),
      level: String(tip.level || '').trim(),
      levelLabel: String(tip.levelLabel || '').trim(),
      direction: String(tip.direction || '').trim(),
      score: Number.isFinite(Number(tip.score)) ? Number(tip.score) : null,
      summary: String(tip.summary || '').trim(),
      reasons: Array.isArray(tip.reasons)
        ? tip.reasons.map((r) => String(r || '').trim()).filter(Boolean)
        : [],
      ts: now,
    };
  }
  // 清理过期
  for (const k of Object.keys(store.tips)) {
    const ts = Number(store.tips[k]?.ts) || 0;
    if (!ts || now - ts > SIGNAL_TIP_TTL_MS) delete store.tips[k];
  }
  store.ts = now;
  writeStore(store);
}
