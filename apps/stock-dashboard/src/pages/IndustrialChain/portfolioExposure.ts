/**
 * 自选 → C01 环节暴露映射
 */

import { normalizeStockCode } from '@/utils/format';
import type { IndustrialChainGraph, PortfolioExposureRow } from './types';

/** 将图谱符号转为可能的自选码集合 */
export function expandWatchCodes(symbol: string): string[] {
  const out = new Set<string>();
  const raw = symbol.trim();
  if (!raw) return [];
  out.add(raw);
  const n = normalizeStockCode(raw);
  if (n) out.add(n);

  const suffix = raw.match(/^(\d{6})\.(sh|sz|bj)$/i);
  if (suffix) {
    out.add(`${suffix[2].toLowerCase()}${suffix[1]}`);
    out.add(suffix[1]);
  }

  const prefix = raw.match(/^(sh|sz|bj)(\d{6})$/i);
  if (prefix) {
    out.add(`${prefix[2]}.${prefix[1].toLowerCase()}`);
    out.add(prefix[2]);
  }

  // 美股裸代码 → usXXX
  if (/^[A-Z][A-Z0-9.-]{0,9}$/i.test(raw) && !raw.includes('.')) {
    out.add(`us${raw.toUpperCase()}`);
    out.add(raw.toUpperCase());
  }

  // 港股 0981.HK
  const hk = raw.match(/^(\d{1,5})\.HK$/i);
  if (hk) {
    out.add(`hk${hk[1].padStart(5, '0')}`);
  }

  return [...out];
}

/** 自选加入时优先用的规范化代码 */
export function toWatchlistCode(symbol: string): string | null {
  const raw = symbol.trim();
  if (!raw) return null;
  const n = normalizeStockCode(raw);
  if (n && /^(sh|sz|bj|us|hk)/i.test(n)) return n;

  if (/^\d{6}\.(sh|sz|bj)$/i.test(raw)) return normalizeStockCode(raw);

  if (/^[A-Z][A-Z0-9.-]{0,9}$/i.test(raw)) {
    return normalizeStockCode(`us${raw.toUpperCase()}`) || `us${raw.toUpperCase()}`;
  }

  if (/^\d{1,5}\.HK$/i.test(raw)) {
    const m = raw.match(/^(\d{1,5})\.HK$/i)!;
    return `hk${m[1].padStart(5, '0')}`;
  }

  // 台股等暂不进默认自选
  return null;
}

export function buildPortfolioExposure(
  graph: IndustrialChainGraph,
  watchCodes: string[]
): {
  rows: PortfolioExposureRow[];
  matched: number;
  unmatched: string[];
  hiddenConcentration: string[];
} {
  const watchSet = new Set(watchCodes.map((c) => c.trim()).filter(Boolean));
  const watchLower = new Set([...watchSet].map((c) => c.toLowerCase()));

  const matchedCodes = new Set<string>();
  const bySeg = new Map<
    string,
    { codes: string[]; names: string[]; chokeRisk?: PortfolioExposureRow['chokeRisk'] }
  >();

  for (const m of graph.memberships) {
    if (m.status === 'deprecated') continue;
    const ent = graph.entities.find((e) => e.id === m.entityId);
    const seg = graph.segments.find((s) => s.id === m.segmentId);
    if (!ent || !seg) continue;

    for (const sym of ent.symbols) {
      const candidates = expandWatchCodes(sym);
      const hit = candidates.find(
        (c) => watchSet.has(c) || watchLower.has(c.toLowerCase())
      );
      if (!hit) continue;
      matchedCodes.add(
        [...watchSet].find((w) => candidates.some((c) => c.toLowerCase() === w.toLowerCase())) ??
          hit
      );
      const bucket = bySeg.get(seg.id) ?? {
        codes: [],
        names: [],
        chokeRisk: seg.chokeRisk,
      };
      const watchCode =
        [...watchSet].find((w) => candidates.some((c) => c.toLowerCase() === w.toLowerCase())) ??
        hit;
      if (!bucket.codes.includes(watchCode)) {
        bucket.codes.push(watchCode);
        bucket.names.push(ent.name);
      }
      bySeg.set(seg.id, bucket);
    }
  }

  const rows: PortfolioExposureRow[] = [...bySeg.entries()]
    .map(([segmentId, v]) => {
      const seg = graph.segments.find((s) => s.id === segmentId)!;
      return {
        segmentId,
        segmentName: seg.name,
        codes: v.codes,
        names: v.names,
        count: v.codes.length,
        chokeRisk: seg.chokeRisk,
      };
    })
    .sort((a, b) => b.count - a.count);

  const unmatched = [...watchSet].filter((c) => !matchedCodes.has(c));

  // 隐性集中：多个自选落在同一高卡脖子环节
  const hiddenConcentration = rows
    .filter((r) => r.chokeRisk === 'high' && r.count >= 2)
    .map((r) => `${r.segmentName}（${r.count} 只，高卡脖子）`);

  return {
    rows,
    matched: matchedCodes.size,
    unmatched,
    hiddenConcentration,
  };
}
