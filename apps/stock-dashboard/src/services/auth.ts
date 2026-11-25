/**
 * 本机账号鉴权（cookie session，credentials: include）
 */

export type AuthUser = {
  id: string;
  username: string;
  role: string;
  created_at?: number;
  updated_at?: number;
};

export type AuthConfig = {
  open_register: boolean;
  cookie_name: string;
  oauth_providers: string[];
};

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  const res = await fetch('/api/auth/config', { credentials: 'include' });
  const data = await parseJson(res);
  return {
    open_register: Boolean(data.open_register ?? true),
    cookie_name: String(data.cookie_name || 'meo_session'),
    oauth_providers: Array.isArray(data.oauth_providers)
      ? (data.oauth_providers as string[])
      : [],
  };
}

export async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  const data = await parseJson(res);
  if (!res.ok || !data.user || typeof data.user !== 'object') return null;
  const u = data.user as Record<string, unknown>;
  if (typeof u.id !== 'string' || typeof u.username !== 'string') return null;
  return {
    id: u.id,
    username: u.username,
    role: String(u.role || 'user'),
    created_at: typeof u.created_at === 'number' ? u.created_at : undefined,
    updated_at: typeof u.updated_at === 'number' ? u.updated_at : undefined,
  };
}

export async function login(
  username: string,
  password: string
): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await parseJson(res);
  if (!res.ok || !data.ok) {
    return { ok: false, error: String(data.error || '登录失败') };
  }
  const u = data.user as Record<string, unknown>;
  return {
    ok: true,
    user: {
      id: String(u.id),
      username: String(u.username),
      role: String(u.role || 'user'),
    },
  };
}

export async function register(
  username: string,
  password: string
): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await parseJson(res);
  if (!res.ok || !data.ok) {
    return { ok: false, error: String(data.error || '注册失败') };
  }
  const u = data.user as Record<string, unknown>;
  return {
    ok: true,
    user: {
      id: String(u.id),
      username: String(u.username),
      role: String(u.role || 'user'),
    },
  };
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  }).catch(() => undefined);
}

export async function changePassword(
  oldPassword: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      old_password: oldPassword,
      new_password: newPassword,
    }),
  });
  const data = await parseJson(res);
  if (!res.ok || !data.ok) {
    return { ok: false, error: String(data.error || '修改失败') };
  }
  return { ok: true };
}
