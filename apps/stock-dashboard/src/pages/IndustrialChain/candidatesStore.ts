/**
 * 成员/变更候选箱（P1：本地；外源只写 open，人审后进图谱草稿）
 */

import { C01_CANDIDATE_SEED } from './seed/c01Candidates';
import type { ChangeProposal, IndustrialChainGraph } from './types';
import { getEditableChain, saveDraft } from './store';

const STORAGE_KEY = 'industrial-chain.c01.candidates.v1';

function clone<T>(v: T): T {
  return structuredClone(v);
}

function loadAll(): ChangeProposal[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(C01_CANDIDATE_SEED);
    const parsed = JSON.parse(raw) as ChangeProposal[];
    if (!Array.isArray(parsed)) return clone(C01_CANDIDATE_SEED);
    return parsed;
  } catch {
    return clone(C01_CANDIDATE_SEED);
  }
}

function saveAll(list: ChangeProposal[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function listProposals(chainId: string, onlyOpen = true): ChangeProposal[] {
  return loadAll().filter((p) => p.chainId === chainId && (!onlyOpen || p.status === 'open'));
}

export function rejectProposal(id: string) {
  const list = loadAll();
  const p = list.find((x) => x.id === id);
  if (!p) return;
  p.status = 'rejected';
  saveAll(list);
}

export function resetProposals() {
  saveAll(clone(C01_CANDIDATE_SEED));
}

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 采纳挂载类候选 → 写入 C01 草稿 Membership，提案标 accepted
 * @returns 更新后的草稿图；失败返回 null
 */
export function acceptMembershipProposal(id: string): IndustrialChainGraph | null {
  const list = loadAll();
  const p = list.find((x) => x.id === id);
  if (!p || p.status !== 'open' || p.kind !== 'add_membership') return null;
  if (!p.suggestedSegmentId || !p.suggestedName || !p.suggestedSymbol) return null;

  const graph = getEditableChain('C01');
  if (!graph) return null;

  const entityId = newId('ent');
  const membershipId = newId('m');
  graph.entities.push({
    id: entityId,
    name: p.suggestedName,
    symbols: [p.suggestedSymbol],
    market: 'CN',
  });
  graph.memberships.push({
    id: membershipId,
    entityId,
    segmentId: p.suggestedSegmentId,
    tier: p.suggestedTier ?? 'concept',
    status: p.suggestedStatus ?? 'candidate',
    evidenceGrade: p.suggestedEvidenceGrade ?? 'unverified',
    revenueSharePct: null,
    note: `来自候选：${p.source}${p.evidence ? `；${p.evidence}` : ''}`,
  });

  saveDraft(graph);
  p.status = 'accepted';
  saveAll(list);
  return graph;
}

export function addManualProposal(input: Omit<ChangeProposal, 'id' | 'status' | 'createdAt'>): ChangeProposal {
  const list = loadAll();
  const proposal: ChangeProposal = {
    ...input,
    id: newId('prop'),
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  list.unshift(proposal);
  saveAll(list);
  return proposal;
}

/**
 * 合并外源提议：已有同 id 且已审（accepted/rejected）则保留原状；
 * 新 id 插入队首。返回新增条数。
 */
export function ingestProposals(incoming: ChangeProposal[]): number {
  const list = loadAll();
  const byId = new Map(list.map((p) => [p.id, p]));
  let added = 0;
  for (const p of incoming) {
    const prev = byId.get(p.id);
    if (prev) {
      if (prev.status === 'accepted' || prev.status === 'rejected') continue;
      // 刷新 open 提案的摘要/证据
      Object.assign(prev, { ...p, status: 'open' });
      continue;
    }
    list.unshift(p);
    byId.set(p.id, p);
    added += 1;
  }
  saveAll(list);
  return added;
}
