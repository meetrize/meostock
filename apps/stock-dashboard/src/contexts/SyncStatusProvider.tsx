/**
 * 全局后台同步状态：分轨进度轮询 + 入队 API
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useToast } from '@/components/common';
import { LANE_META, LANE_ORDER, laneOf, type SourceLane } from '@/services/sourceLanes';
import {
  SyncStatusContext,
  type SyncTrack,
  type SyncStatusContextValue,
} from './syncStatusContext';

function emptyTracks(): SyncTrack[] {
  return LANE_ORDER.map((lane) => ({
    lane,
    label: LANE_META[lane].label,
    title: LANE_META[lane].title,
    active: false,
    percent: 0,
    message: '',
    okCount: 0,
    failCount: 0,
  }));
}

async function fetchCacheProgress(): Promise<Record<string, unknown>> {
  const res = await fetch('/api/cache/sync/progress');
  return res.json();
}

async function fetchTushareProgress(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch('/api/tushare/sync/progress');
    return res.json();
  } catch {
    return { ok: false };
  }
}

function mergeTracks(
  cacheProg: Record<string, unknown>,
  tsProg: Record<string, unknown>
): SyncTrack[] {
  const base = emptyTracks();
  const cacheLanes = (cacheProg.lanes || {}) as Record<string, Record<string, unknown>>;
  const tsLanes = (tsProg.lanes || {}) as Record<string, Record<string, unknown>>;

  return base.map((t) => {
    const raw =
      t.lane === 'tushare'
        ? tsLanes.tushare
        : cacheLanes[t.lane];
    if (!raw) {
      // 兼容旧 progress：整轨 active 时挂到 em-sina
      if (
        t.lane === 'em-sina' &&
        cacheProg.active &&
        !cacheLanes['em-sina'] &&
        !cacheLanes['lazy-catalog'] &&
        !cacheLanes.yfinance
      ) {
        const total = Number(cacheProg.overall_total) || Number(cacheProg.markets_total) || 1;
        const done = Number(cacheProg.overall_done) || Number(cacheProg.markets_done) || 0;
        return {
          ...t,
          active: true,
          percent: Math.min(99, Math.round((done / Math.max(total, 1)) * 100)),
          message: String(cacheProg.message || ''),
          marketId: cacheProg.market ? String(cacheProg.market) : null,
          marketLabel: cacheProg.market_label ? String(cacheProg.market_label) : null,
        };
      }
      return t;
    }
    return {
      ...t,
      active: Boolean(raw.active),
      percent: Number(raw.percent) || 0,
      message: String(raw.message || ''),
      marketId: raw.market ? String(raw.market) : null,
      marketLabel: raw.market_label ? String(raw.market_label) : null,
      okCount: Number(raw.ok_count) || 0,
      failCount: Number(raw.fail_count) || 0,
    };
  });
}

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [tracks, setTracks] = useState<SyncTrack[]>(emptyTracks);
  const [softVersion, setSoftVersion] = useState(0);
  const [completedLanes, setCompletedLanes] = useState<SourceLane[]>([]);
  const prevActive = useRef<Record<string, boolean>>({});

  const poll = useCallback(async () => {
    const [c, t] = await Promise.all([fetchCacheProgress(), fetchTushareProgress()]);
    const next = mergeTracks(c, t);
    setTracks(next);

    const finished: SourceLane[] = [];
    for (const tr of next) {
      const was = prevActive.current[tr.lane];
      if (was && !tr.active) finished.push(tr.lane);
      prevActive.current[tr.lane] = tr.active;
    }
    if (finished.length) {
      setCompletedLanes(finished);
      setSoftVersion((v) => v + 1);
      const labels = finished.map((l) => LANE_META[l].label).join('、');
      toast.success(`${labels} 同步完成`);
    }
  }, [toast]);

  const anyActive = useMemo(() => tracks.some((t) => t.active), [tracks]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        await poll();
      } catch {
        /* ignore */
      }
    };
    void tick();
    const ms = anyActive ? 600 : 4000;
    const id = window.setInterval(() => void tick(), ms);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [anyActive, poll]);

  const requestSyncMarket = useCallback(
    async (marketId: string, opts?: { tradeDate?: string }) => {
      const lane = laneOf(marketId);
      if (lane === 'placeholder') {
        toast.info('占位节点无需同步');
        return;
      }
      if (lane === 'tushare') {
        const res = await fetch('/api/tushare/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            market_id: marketId,
            trade_date: opts?.tradeDate,
            force: true,
            background: true,
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || '同步失败');
      } else {
        const res = await fetch('/api/cache/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ market: marketId, force: true, background: true }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || '同步失败');
      }
      toast.info(`已开始同步 ${LANE_META[lane].label} · ${marketId}`);
      void poll();
    },
    [poll, toast]
  );

  const requestSyncLane = useCallback(
    async (lane: SourceLane) => {
      if (lane === 'placeholder') return;
      if (lane === 'tushare') {
        const res = await fetch('/api/tushare/sync-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: true }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || '同步失败');
      } else {
        const res = await fetch('/api/cache/sync-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: true, lanes: [lane] }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || '同步失败');
      }
      toast.info(`已开始同步本轨：${LANE_META[lane].title}`);
      void poll();
    },
    [poll, toast]
  );

  const requestSyncAllSources = useCallback(async () => {
    await requestSyncLane('em-sina');
    await requestSyncLane('lazy-catalog');
    await requestSyncLane('yfinance');
    await requestSyncLane('tushare');
  }, [requestSyncLane]);

  const value: SyncStatusContextValue = {
    tracks,
    anyActive,
    softVersion,
    completedLanes,
    requestSyncMarket,
    requestSyncLane,
    requestSyncAllSources,
  };

  return (
    <SyncStatusContext.Provider value={value}>{children}</SyncStatusContext.Provider>
  );
}
