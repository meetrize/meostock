import { useContext } from 'react';
import { SyncStatusContext, type SyncStatusContextValue } from './syncStatusContext';

export function useSyncStatus(): SyncStatusContextValue {
  const ctx = useContext(SyncStatusContext);
  if (!ctx) {
    throw new Error('useSyncStatus must be used within SyncStatusProvider');
  }
  return ctx;
}
