/**
 * C01 草稿 / 发布版本地持久化（P0：单链；后续可换后端）
 */

import { C01_SEED } from './seed/c01Semiconductor';
import type { IndustrialChainGraph } from './types';

const STORAGE_KEY = 'industrial-chain.c01.v1';

type PersistedState = {
  published: IndustrialChainGraph;
  draft: IndustrialChainGraph | null;
};

function cloneGraph(g: IndustrialChainGraph): IndustrialChainGraph {
  return structuredClone(g);
}

function loadRaw(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed?.published?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveRaw(state: PersistedState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getPublishedChain(chainId: string): IndustrialChainGraph | null {
  if (chainId !== 'C01') return null;
  const stored = loadRaw();
  return stored ? cloneGraph(stored.published) : cloneGraph(C01_SEED);
}

export function getDraftChain(chainId: string): IndustrialChainGraph | null {
  if (chainId !== 'C01') return null;
  const stored = loadRaw();
  if (stored?.draft) return cloneGraph(stored.draft);
  return null;
}

/** 当前编辑视图：有草稿用草稿，否则用发布版拷贝 */
export function getEditableChain(chainId: string): IndustrialChainGraph | null {
  if (chainId !== 'C01') return null;
  const draft = getDraftChain(chainId);
  if (draft) return draft;
  return getPublishedChain(chainId);
}

export function saveDraft(chain: IndustrialChainGraph) {
  if (chain.id !== 'C01') return;
  const published = getPublishedChain('C01')!;
  saveRaw({ published, draft: cloneGraph(chain) });
}

export function publishDraft(chain: IndustrialChainGraph, note?: string): IndustrialChainGraph {
  if (chain.id !== 'C01') return chain;
  const next = cloneGraph(chain);
  next.release = {
    version: (getPublishedChain('C01')?.release.version ?? 0) + 1,
    publishedAt: new Date().toISOString(),
    publishedBy: 'local-editor',
    note: note || '本地发布',
  };
  saveRaw({ published: next, draft: null });
  return next;
}

export function discardDraft(chainId: string) {
  if (chainId !== 'C01') return;
  const published = getPublishedChain(chainId);
  if (!published) return;
  saveRaw({ published, draft: null });
}

export function resetToSeed(chainId: string) {
  if (chainId !== 'C01') return;
  saveRaw({ published: cloneGraph(C01_SEED), draft: null });
}

export function exportChainJson(chain: IndustrialChainGraph): string {
  return JSON.stringify(chain, null, 2);
}

export function importChainJson(text: string): IndustrialChainGraph {
  const parsed = JSON.parse(text) as IndustrialChainGraph;
  if (!parsed?.id || !Array.isArray(parsed.segments)) {
    throw new Error('无效的产业链 JSON');
  }
  return parsed;
}
