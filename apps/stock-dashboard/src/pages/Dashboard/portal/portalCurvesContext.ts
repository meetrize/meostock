/**
 * Portal 曲线批量加载 Context
 */

import { createContext, useContext } from 'react';

export interface PortalCurveBar {
  date: string;
  close: number;
  volume: number | null;
}

export interface PortalCurvesValue {
  /** klineSymbol → bars（近 60 日） */
  bySymbol: Record<string, PortalCurveBar[]>;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export const PortalCurvesContext = createContext<PortalCurvesValue | null>(null);

export function usePortalCurves(): PortalCurvesValue {
  const ctx = useContext(PortalCurvesContext);
  if (!ctx) {
    return {
      bySymbol: {},
      loading: false,
      refreshing: false,
      error: null,
      reload: async () => undefined,
    };
  }
  return ctx;
}

/** 在 PortalCurvesProvider 内为 true（即使尚未返回 bars） */
export function useHasPortalCurvesProvider(): boolean {
  return useContext(PortalCurvesContext) != null;
}

export function usePortalCurveBars(klineSymbol: string): {
  bars: PortalCurveBar[] | null;
  loading: boolean;
  error: string | null;
  /** 是否由批量 Context 供数（勿再单票打网） */
  fromBatch: boolean;
} {
  const ctx = useContext(PortalCurvesContext);
  if (!ctx) {
    return { bars: null, loading: false, error: null, fromBatch: false };
  }
  const bars = ctx.bySymbol[klineSymbol];
  const has = Array.isArray(bars);
  return {
    bars: has ? bars : null,
    loading: ctx.loading && !has,
    error: ctx.error,
    fromBatch: true,
  };
}
