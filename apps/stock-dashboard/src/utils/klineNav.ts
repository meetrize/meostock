/**
 * 行情 → K 线列表导航交接（localStorage + URL ?nav=）
 * 新标签 noopener 下 sessionStorage 不可用；全量 sorted 列表也不能塞进 query。
 */

export const KLINE_NAV_KEY_PREFIX = 'kline_nav_';
export const KLINE_NAV_TTL_MS = 24 * 60 * 60 * 1000;

export type KlineNavPayload = {
  v: 1;
  symbols: string[];
  i: number;
  ts: number;
};

function makeNavId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `q${Date.now().toString(36)}${rand}`;
}

export function klineNavStorageKey(navId: string): string {
  return `${KLINE_NAV_KEY_PREFIX}${navId}`;
}

/** 清理过期的 kline_nav_*（超过 TTL） */
export function pruneExpiredKlineNav(now = Date.now()): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KLINE_NAV_KEY_PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) {
          localStorage.removeItem(k);
          continue;
        }
        const parsed = JSON.parse(raw) as { ts?: number };
        const ts = Number(parsed?.ts);
        if (!Number.isFinite(ts) || now - ts > KLINE_NAV_TTL_MS) {
          localStorage.removeItem(k);
        }
      } catch {
        localStorage.removeItem(k);
      }
    }
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * 写入当前筛选排序列表，返回 navId。
 * localStorage + 服务端双写：局域网/跨标签 localStorage 失败时仍可靠。
 */
export function writeKlineNavList(symbols: string[], index: number): string {
  const list = symbols.map((s) => String(s || '').trim()).filter(Boolean);
  if (list.length < 2) return '';
  const i = Math.max(0, Math.min(list.length - 1, Math.floor(Number(index) || 0)));
  const navId = makeNavId();
  const payload: KlineNavPayload = { v: 1, symbols: list, i, ts: Date.now() };
  try {
    pruneExpiredKlineNav(payload.ts);
    localStorage.setItem(klineNavStorageKey(navId), JSON.stringify(payload));
  } catch {
    /* LS 失败仍继续服务端写入 */
  }
  try {
    void fetch('/api/kline-nav', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: navId, symbols: list, i }),
      keepalive: true,
    });
  } catch {
    /* ignore */
  }
  return navId;
}
