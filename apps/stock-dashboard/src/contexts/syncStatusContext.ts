import { createContext } from 'react';
import type { SourceLane } from '@/services/sourceLanes';

export type SyncTrack = {
  lane: SourceLane;
  label: string;
  title: string;
  active: boolean;
  percent: number;
  message: string;
  marketId?: string | null;
  marketLabel?: string | null;
  okCount: number;
  failCount: number;
};

export type SyncStatusContextValue = {
  tracks: SyncTrack[];
  anyActive: boolean;
  softVersion: number;
  completedLanes: SourceLane[];
  requestSyncMarket: (marketId: string, opts?: { tradeDate?: string }) => Promise<void>;
  requestSyncLane: (lane: SourceLane) => Promise<void>;
  requestSyncAllSources: () => Promise<void>;
};

export const SyncStatusContext = createContext<SyncStatusContextValue | null>(null);
