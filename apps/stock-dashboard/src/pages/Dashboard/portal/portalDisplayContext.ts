import { createContext, useContext } from 'react';
import type { IndexDisplayMode } from './types';

export type PortalDisplayValue = {
  indexDisplayMode: IndexDisplayMode;
  setIndexDisplayMode: (mode: IndexDisplayMode) => void;
};

export const PortalDisplayContext = createContext<PortalDisplayValue | null>(null);

export function usePortalDisplay(): PortalDisplayValue {
  const ctx = useContext(PortalDisplayContext);
  if (!ctx) {
    throw new Error('usePortalDisplay must be used within PortalDisplayContext');
  }
  return ctx;
}
