/**
 * 自定义版面（工作区）持久化类型
 */

import type {
  PortalLayoutItem,
  PortalPreset,
  PortalWidgetInstance,
} from '@/pages/Dashboard/portal/types';

export type Workspace = PortalPreset;

export interface WorkspacePersistedState {
  version: 1;
  density: 'tight' | 'comfortable';
  lastOpenedId: string | null;
  workspaces: Workspace[];
}

export const WORKSPACE_STORAGE_KEY = 'stock-dashboard:custom-workspaces:v1';

export type { PortalLayoutItem, PortalWidgetInstance };
