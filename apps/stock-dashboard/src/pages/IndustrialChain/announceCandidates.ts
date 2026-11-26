/**
 * P4：公告异动 → 半导体相关候选提议
 */

import type { ChangeProposal, IndustrialChainGraph } from './types';

type ImpactItem = {
  announcement_id: string;
  code: string;
  stock_name?: string;
  title: string;
  final_level?: string;
  reasons?: string[];
  core_summary?: string;
};

const SEMI_RE =
  /半导体|芯片|晶圆|光刻|封测|存储|DRAM|NAND|HBM|EDA|硅片|刻蚀|薄膜|CMP|靶材|特气|光刻胶|先进封装|CoWoS|晶圆厂|代工|设备|集成电路|IC\b/i;

const SEGMENT_HINTS: { re: RegExp; segmentId: string }[] = [
  { re: /光刻/, segmentId: 'c01-litho' },
  { re: /刻蚀|薄膜|注入|量测|CMP|设备/, segmentId: 'c01-front-eq' },
  { re: /硅片|衬底/, segmentId: 'c01-wafer' },
  { re: /光刻胶|特气|靶材|电子材料/, segmentId: 'c01-materials' },
  { re: /EDA|IP核|设计工具/, segmentId: 'c01-eda' },
  { re: /封测|先进封装|CoWoS|通富|长电|日月光/, segmentId: 'c01-osat' },
  { re: /存储|DRAM|NAND|HBM/, segmentId: 'c01-memory' },
  { re: /晶圆|代工|中芯|华虹/, segmentId: 'c01-foundry' },
  { re: /设计|Fabless|CIS|模拟/, segmentId: 'c01-design' },
];

function guessSegment(text: string): string {
  for (const h of SEGMENT_HINTS) {
    if (h.re.test(text)) return h.segmentId;
  }
  return 'c01-front-eq';
}

function toAshareSymbol(code: string): string {
  const c = code.trim();
  if (/^(sh|sz|bj)\d{6}$/i.test(c)) {
    const m = c.match(/^(sh|sz|bj)(\d{6})$/i)!;
    return `${m[2]}.${m[1].toUpperCase()}`;
  }
  if (/^\d{6}$/.test(c)) {
    if (c.startsWith('6')) return `${c}.SH`;
    return `${c}.SZ`;
  }
  return c;
}

export async function fetchSemiImpactItems(limit = 40): Promise<ImpactItem[]> {
  const qs = new URLSearchParams({
    levels: 'XL,L,M',
    limit: String(limit),
  });
  const res = await fetch(`/api/cninfo/impact/list?${qs}`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `公告异动拉取失败 ${res.status}`);
  }
  const items: ImpactItem[] = Array.isArray(data.items) ? data.items : [];
  return items.filter((it) => {
    const blob = `${it.title} ${(it.reasons || []).join(' ')} ${it.core_summary || ''}`;
    return SEMI_RE.test(blob) || SEMI_RE.test(it.stock_name || '');
  });
}

export function impactToProposals(
  items: ImpactItem[],
  graph: IndustrialChainGraph
): ChangeProposal[] {
  const knownCodes = new Set<string>();
  for (const ent of graph.entities) {
    for (const s of ent.symbols) {
      knownCodes.add(s.replace(/\.(SH|SZ|BJ)$/i, '').replace(/^(sh|sz|bj)/i, ''));
    }
  }

  const now = new Date().toISOString();
  return items.map((it) => {
    const blob = `${it.title} ${(it.reasons || []).join(' ')}`;
    const segmentId = guessSegment(blob);
    const symbol = toAshareSymbol(it.code);
    const bare = symbol.replace(/\.(SH|SZ|BJ)$/i, '');
    const already = knownCodes.has(bare);
    const level = it.final_level || 'M';

    return {
      id: `impact-${it.announcement_id}`,
      chainId: 'C01',
      kind: 'add_membership' as const,
      source: `公告异动 ${level}`,
      createdAt: now,
      summary: `${it.stock_name || it.code}：${it.title.slice(0, 80)}`,
      evidence: it.core_summary || (it.reasons || []).slice(0, 3).join('；') || it.title,
      suggestedName: it.stock_name || it.code,
      suggestedSymbol: symbol,
      suggestedSegmentId: segmentId,
      suggestedTier: already ? 'elastic' : level === 'XL' || level === 'L' ? 'elastic' : 'concept',
      suggestedStatus: already ? 'active' : 'candidate',
      suggestedEvidenceGrade: 'disclosed' as const,
      status: 'open' as const,
    };
  });
}
