/**
 * 用户配置 API（namespace: dashboard | kline）
 */

export type PrefItem = {
  key: string;
  value: unknown;
  updated_at?: number;
  rev?: number;
  conflict?: boolean;
};

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function fetchPrefs(namespace = 'dashboard'): Promise<{
  items: PrefItem[];
  server_time: number;
}> {
  const res = await fetch(
    `/api/user/prefs?namespace=${encodeURIComponent(namespace)}`,
    { credentials: 'include' }
  );
  const data = await parseJson(res);
  if (!res.ok) {
    throw new Error(String(data.error || data.detail || '拉取配置失败'));
  }
  const items = Array.isArray(data.items) ? (data.items as PrefItem[]) : [];
  return {
    items,
    server_time: Number(data.server_time) || Date.now() / 1000,
  };
}

export async function putPrefs(
  namespace: string,
  items: Array<{ key: string; value: unknown; base_rev?: number }>
): Promise<PrefItem[]> {
  const res = await fetch('/api/user/prefs', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ namespace, items }),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new Error(String(data.error || data.detail || '保存配置失败'));
  }
  return Array.isArray(data.items) ? (data.items as PrefItem[]) : [];
}

export async function importPrefs(
  namespace: string,
  items: Array<{ key: string; value: unknown }>,
  mode: 'merge' | 'overwrite' = 'merge'
): Promise<{ written: number; skipped: number }> {
  const res = await fetch('/api/user/prefs/import', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ namespace, items, mode }),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new Error(String(data.error || data.detail || '导入失败'));
  }
  return {
    written: Number(data.written) || 0,
    skipped: Number(data.skipped) || 0,
  };
}
