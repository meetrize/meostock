/**
 * 产业链草稿 / 发布版本地持久化（多链：C01 / C05 …）
 */

import { C01_SEED } from './seed/c01Semiconductor';
import { C04_SEED } from './seed/c04DomesticAiChip';
import { C05_SEED } from './seed/c05CloudDc';
import { C06_SEED } from './seed/c06Ascend';
import { C08_SEED } from './seed/c08Robot';
import type { IndustrialChainGraph } from './types';

const STORAGE_PREFIX = 'industrial-chain.';
const STORAGE_VERSION = 'v1';

const SEEDS: Record<string, IndustrialChainGraph> = {
  C01: C01_SEED,
  C04: C04_SEED,
  C05: C05_SEED,
  C06: C06_SEED,
  C08: C08_SEED,
};

export function supportedChainIds(): string[] {
  return Object.keys(SEEDS);
}

export function isEditableChain(chainId: string): boolean {
  return chainId in SEEDS;
}

type PersistedState = {
  published: IndustrialChainGraph;
  draft: IndustrialChainGraph | null;
};

function storageKey(chainId: string): string {
  return `${STORAGE_PREFIX}${chainId.toLowerCase()}.${STORAGE_VERSION}`;
}

function cloneGraph(g: IndustrialChainGraph): IndustrialChainGraph {
  const next = structuredClone(g);
  if (!Array.isArray(next.relations)) next.relations = [];
  return next;
}

function getSeed(chainId: string): IndustrialChainGraph | null {
  const seed = SEEDS[chainId];
  return seed ? cloneGraph(seed) : null;
}

function loadRaw(chainId: string): PersistedState | null {
  try {
    const raw = localStorage.getItem(storageKey(chainId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed?.published?.id || parsed.published.id !== chainId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveRaw(chainId: string, state: PersistedState) {
  localStorage.setItem(storageKey(chainId), JSON.stringify(state));
}

function patchReportBindingFromSeed(
  published: IndustrialChainGraph,
  seed: IndustrialChainGraph
): IndustrialChainGraph {
  const next = cloneGraph(published);
  let changed = false;
  if (seed.reportId && !next.reportId) {
    next.reportId = seed.reportId;
    changed = true;
  }
  if (seed.reportUrl && !next.reportUrl) {
    next.reportUrl = seed.reportUrl;
    changed = true;
  }
  if (seed.reportSource && !next.reportSource) {
    next.reportSource = seed.reportSource;
    changed = true;
  }
  return changed ? next : published;
}

export function getPublishedChain(chainId: string): IndustrialChainGraph | null {
  if (!isEditableChain(chainId)) return null;
  const seed = getSeed(chainId);
  const stored = loadRaw(chainId);
  if (!stored) return seed;
  // 种子升版：本地仍是旧 seed 发布版且无草稿时，自动换成新种子
  if (
    seed &&
    stored.published.release.publishedBy === 'seed' &&
    !stored.draft &&
    (stored.published.release.version ?? 0) < (seed.release.version ?? 0)
  ) {
    saveRaw(chainId, { published: cloneGraph(seed), draft: null });
    return cloneGraph(seed);
  }
  const published = cloneGraph(stored.published);
  // 旧本地种子缺 reportId 时补齐（不抬版本，避免覆盖用户草稿发布）
  if (seed && published.release.publishedBy === 'seed' && !stored.draft) {
    const patched = patchReportBindingFromSeed(published, seed);
    if (patched !== published && (patched.reportId || patched.reportUrl)) {
      saveRaw(chainId, { published: patched, draft: null });
      return patched;
    }
  }
  return published;
}

export function getDraftChain(chainId: string): IndustrialChainGraph | null {
  if (!isEditableChain(chainId)) return null;
  const stored = loadRaw(chainId);
  if (stored?.draft) return cloneGraph(stored.draft);
  return null;
}

/** 当前编辑视图：有草稿用草稿，否则用发布版拷贝 */
export function getEditableChain(chainId: string): IndustrialChainGraph | null {
  if (!isEditableChain(chainId)) return null;
  const draft = getDraftChain(chainId);
  if (draft) return draft;
  return getPublishedChain(chainId);
}

export function saveDraft(chain: IndustrialChainGraph) {
  if (!isEditableChain(chain.id)) return;
  const published = getPublishedChain(chain.id)!;
  saveRaw(chain.id, { published, draft: cloneGraph(chain) });
}

export function publishDraft(chain: IndustrialChainGraph, note?: string): IndustrialChainGraph {
  if (!isEditableChain(chain.id)) return chain;
  const next = cloneGraph(chain);
  next.release = {
    version: (getPublishedChain(chain.id)?.release.version ?? 0) + 1,
    publishedAt: new Date().toISOString(),
    publishedBy: 'local-editor',
    note: note || '本地发布',
  };
  saveRaw(chain.id, { published: next, draft: null });
  return next;
}

export function discardDraft(chainId: string) {
  if (!isEditableChain(chainId)) return;
  const published = getPublishedChain(chainId);
  if (!published) return;
  saveRaw(chainId, { published, draft: null });
}

export function resetToSeed(chainId: string) {
  if (!isEditableChain(chainId)) return;
  const seed = getSeed(chainId);
  if (!seed) return;
  saveRaw(chainId, { published: seed, draft: null });
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
