import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppSettingsContext } from './appSettingsContext';
import { getSettings, saveSettings } from '@/services/storage';
import type { AppSettings } from '@/types';

const DEFAULT_REFRESH_INTERVALS: AppSettings['refreshInterval'] = {
  list: 15000,
  detail: 5000,
  heatmap: 10000,
};

interface AppSettingsProviderProps {
  children: ReactNode;
}

function mergeSettings(current: AppSettings, updates: Partial<AppSettings>): AppSettings {
  return {
    ...current,
    ...updates,
    refreshInterval: {
      ...current.refreshInterval,
      ...updates.refreshInterval,
    },
    heatmapConfig: {
      ...current.heatmapConfig,
      ...updates.heatmapConfig,
    },
    indicatorConfig: {
      ...current.indicatorConfig,
      ...updates.indicatorConfig,
      macd: {
        ...current.indicatorConfig.macd,
        ...updates.indicatorConfig?.macd,
      },
      boll: {
        ...current.indicatorConfig.boll,
        ...updates.indicatorConfig?.boll,
      },
      kdj: {
        ...current.indicatorConfig.kdj,
        ...updates.indicatorConfig?.kdj,
      },
      dmi: {
        ...current.indicatorConfig.dmi,
        ...updates.indicatorConfig?.dmi,
      },
      sar: {
        ...current.indicatorConfig.sar,
        ...updates.indicatorConfig?.sar,
      },
      kc: {
        ...current.indicatorConfig.kc,
        ...updates.indicatorConfig?.kc,
      },
    },
  };
}

export function AppSettingsProvider({ children }: AppSettingsProviderProps) {
  const [settings, setSettings] = useState<AppSettings>(getSettings);

  useEffect(() => {
    document.documentElement.setAttribute(
      'data-color-mode',
      settings.colorMode === 'green-rise' ? 'green-rise' : ''
    );
  }, [settings.colorMode]);

  // 启动时把本机缓存模式 / 行情源同步到 FastAPI
  useEffect(() => {
    const mode = settings.cacheMode || 'balanced';
    const source = settings.quoteSource || 'auto';
    void fetch('/api/cache/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    }).catch(() => {
      /* 服务未起时忽略 */
    });
    void fetch('/api/cache/source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    }).catch(() => {
      /* 服务未起时忽略 */
    });
    // 仅挂载时推一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const replaceSettings = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = mergeSettings(prev, updates);
      saveSettings(next);
      return next;
    });
  }, []);

  const getRefreshInterval = useCallback(
    (key: keyof AppSettings['refreshInterval']) => {
      const value = settings.refreshInterval[key];
      return value > 0 ? value : DEFAULT_REFRESH_INTERVALS[key];
    },
    [settings.refreshInterval]
  );

  const value = useMemo(
    () => ({
      settings,
      updateSettings,
      replaceSettings,
      getRefreshInterval,
    }),
    [settings, updateSettings, replaceSettings, getRefreshInterval]
  );

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}
