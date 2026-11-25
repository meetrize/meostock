/**
 * 全局登录态 + 登录后配置拉取 / 导入引导
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  changePassword as apiChangePassword,
  fetchAuthConfig,
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  type AuthConfig,
  type AuthUser,
} from '@/services/auth';
import {
  hasLocalConfigSnapshot,
  importLocalToCloud,
  notifyPrefsApplied,
  pullAndMergePrefs,
  setPrefSyncLoggedIn,
  getLastSyncedAt,
  subscribePrefSync,
} from '@/services/prefSync';
import { watchlistActions } from '@/services/watchlistStore';

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  config: AuthConfig | null;
  lastSyncedAt: number | null;
  showImportPrompt: boolean;
  dismissImportPrompt: () => void;
  login: (
    username: string,
    password: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  register: (
    username: string,
    password: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => Promise<void>;
  changePassword: (
    oldPassword: string,
    newPassword: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  importLocal: (
    mode?: 'merge' | 'overwrite'
  ) => Promise<{ written: number; skipped: number }>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function afterLoginHydrate(): Promise<boolean> {
  setPrefSyncLoggedIn(true);
  const written = await pullAndMergePrefs();
  notifyPrefsApplied();
  try {
    watchlistActions.reloadFromStorage();
  } catch {
    /* ignore */
  }
  // 云端为空且本机有配置 → 提示导入
  return written.length === 0 && hasLocalConfigSnapshot();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [showImportPrompt, setShowImportPrompt] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(getLastSyncedAt());

  useEffect(() => subscribePrefSync(() => setLastSyncedAt(getLastSyncedAt())), []);

  const refreshMe = useCallback(async () => {
    const me = await fetchMe();
    setUser(me);
    if (me) {
      setPrefSyncLoggedIn(true);
      try {
        await pullAndMergePrefs();
        notifyPrefsApplied();
        watchlistActions.reloadFromStorage();
      } catch {
        /* offline */
      }
    } else {
      setPrefSyncLoggedIn(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfg, me] = await Promise.all([
          fetchAuthConfig().catch(() => null),
          fetchMe().catch(() => null),
        ]);
        if (cancelled) return;
        if (cfg) setConfig(cfg);
        setUser(me);
        if (me) {
          setPrefSyncLoggedIn(true);
          try {
            await pullAndMergePrefs();
            notifyPrefsApplied();
            watchlistActions.reloadFromStorage();
          } catch {
            /* ignore */
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiLogin(username, password);
    if (!res.ok) return res;
    setUser(res.user);
    const needImport = await afterLoginHydrate();
    setShowImportPrompt(needImport);
    return { ok: true as const };
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const res = await apiRegister(username, password);
    if (!res.ok) return res;
    setUser(res.user);
    const needImport = await afterLoginHydrate();
    setShowImportPrompt(needImport);
    return { ok: true as const };
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setPrefSyncLoggedIn(false);
    setUser(null);
    setShowImportPrompt(false);
  }, []);

  const changePassword = useCallback(
    async (oldPassword: string, newPassword: string) =>
      apiChangePassword(oldPassword, newPassword),
    []
  );

  const importLocal = useCallback(async (mode: 'merge' | 'overwrite' = 'merge') => {
    const result = await importLocalToCloud(mode);
    notifyPrefsApplied();
    try {
      watchlistActions.reloadFromStorage();
    } catch {
      /* ignore */
    }
    setShowImportPrompt(false);
    return result;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      config,
      lastSyncedAt,
      showImportPrompt,
      dismissImportPrompt: () => setShowImportPrompt(false),
      login,
      register,
      logout,
      changePassword,
      importLocal,
      refreshMe,
    }),
    [
      user,
      loading,
      config,
      lastSyncedAt,
      showImportPrompt,
      login,
      register,
      logout,
      changePassword,
      importLocal,
      refreshMe,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
