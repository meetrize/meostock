/**
 * 登录后配置同步：localStorage 镜像 + 防抖推送 + 登录拉取合并
 */

import { fetchPrefs, importPrefs, putPrefs, type PrefItem } from './userPrefs';

const NAMESPACE = 'dashboard';

/** 与用户绑定的 key 前缀 / 精确匹配 */
const SYNC_PREFIXES = [
  'watchlist.',
  'app.settings',
  'app.theme',
  'app.sidebarCollapsed',
  'ui.',
  'end-of-day-picker-',
  'stock-dashboard:custom-workspaces:',
  'stock-dashboard:overview-portal:',
  'favorites.columns',
] as const;

/** 不同步：一次性 migration / 瞬时 */
const SKIP_EXACT = new Set([
  'app.settings.portal-local-fix-v1',
  'app.settings.network-to-auto-fix-v1',
]);

const SKIP_PREFIXES = ['kline_nav_', 'search.recent'];

type Listener = () => void;

let loggedIn = false;
let debounceTimer: number | null = null;
let lastSyncedAt: number | null = null;
const pending = new Map<string, unknown>();
const revMap = new Map<string, number>();
const listeners = new Set<Listener>();

export function isSyncableKey(key: string): boolean {
  if (!key || SKIP_EXACT.has(key)) return false;
  for (const p of SKIP_PREFIXES) {
    if (key.startsWith(p)) return false;
  }
  return SYNC_PREFIXES.some((p) => key === p || key.startsWith(p));
}

export function getLastSyncedAt(): number | null {
  return lastSyncedAt;
}

export function isPrefSyncActive(): boolean {
  return loggedIn;
}

export function subscribePrefSync(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

function parseStoredRaw(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function serializeForStorage(value: unknown): string {
  if (typeof value === 'string') {
    // 主题 / 侧栏等本就存裸字符串
    if (value === 'light' || value === 'dark' || value === '0' || value === '1') {
      return value;
    }
    // 看起来已是 JSON 字符串则原样写
    if (
      (value.startsWith('{') && value.endsWith('}')) ||
      (value.startsWith('[') && value.endsWith(']')) ||
      value === 'null' ||
      value === 'true' ||
      value === 'false' ||
      /^-?\d+(\.\d+)?$/.test(value)
    ) {
      return value;
    }
    return value;
  }
  return JSON.stringify(value);
}

export function applyPrefToLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, serializeForStorage(value));
  } catch {
    /* ignore */
  }
}

/** 本地写入后调用：登录态下加入推送队列 */
export function noteLocalWrite(key: string, value?: unknown): void {
  if (!isSyncableKey(key)) return;
  if (!loggedIn) return;
  let v = value;
  if (v === undefined) {
    try {
      v = parseStoredRaw(localStorage.getItem(key));
    } catch {
      return;
    }
  }
  pending.set(key, v);
  scheduleFlush();
}

function scheduleFlush() {
  if (debounceTimer != null) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    void flushPending();
  }, 600);
}

export async function flushPending(): Promise<void> {
  if (!loggedIn || pending.size === 0) return;
  const items = Array.from(pending.entries()).map(([key, value]) => ({
    key,
    value,
    base_rev: revMap.get(key),
  }));
  pending.clear();
  try {
    const results = await putPrefs(NAMESPACE, items);
    for (const item of results) {
      if (typeof item.rev === 'number') revMap.set(item.key, item.rev);
      if (item.conflict && item.value !== undefined) {
        applyPrefToLocal(item.key, item.value);
      }
    }
    lastSyncedAt = Date.now();
    emit();
  } catch (err) {
    // 失败放回队列，下次再试
    for (const it of items) {
      if (!pending.has(it.key)) pending.set(it.key, it.value);
    }
    console.warn('[prefSync] flush failed', err);
  }
}

export function setPrefSyncLoggedIn(active: boolean): void {
  loggedIn = active;
  if (!active) {
    pending.clear();
    revMap.clear();
    if (debounceTimer != null) {
      window.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }
  emit();
}

/** 拉取服务端并写入 localStorage；返回写入的 key 列表 */
export async function pullAndMergePrefs(): Promise<string[]> {
  const { items } = await fetchPrefs(NAMESPACE);
  const written: string[] = [];
  for (const item of items) {
    if (!item.key || !isSyncableKey(item.key)) continue;
    applyPrefToLocal(item.key, item.value);
    if (typeof item.rev === 'number') revMap.set(item.key, item.rev);
    written.push(item.key);
  }
  lastSyncedAt = Date.now();
  emit();
  return written;
}

export function collectLocalSnapshot(): PrefItem[] {
  const items: PrefItem[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !isSyncableKey(key)) continue;
      items.push({ key, value: parseStoredRaw(localStorage.getItem(key)) });
    }
  } catch {
    /* ignore */
  }
  return items;
}

export function hasLocalConfigSnapshot(): boolean {
  return collectLocalSnapshot().length > 0;
}

export async function importLocalToCloud(
  mode: 'merge' | 'overwrite' = 'merge'
): Promise<{ written: number; skipped: number }> {
  const items = collectLocalSnapshot();
  if (!items.length) return { written: 0, skipped: 0 };
  const result = await importPrefs(
    NAMESPACE,
    items.map((i) => ({ key: i.key, value: i.value })),
    mode
  );
  await pullAndMergePrefs();
  return result;
}

/** 通知订阅方（自选 / 工作区等）刷新 */
export function notifyPrefsApplied(): void {
  try {
    window.dispatchEvent(new CustomEvent('meo:prefs-applied'));
  } catch {
    /* ignore */
  }
  emit();
}
