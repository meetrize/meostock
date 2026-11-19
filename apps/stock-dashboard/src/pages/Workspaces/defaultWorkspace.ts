/**
 * 默认空工作区
 */

import type { Workspace, WorkspacePersistedState } from './types';

export function createEmptyWorkspace(name = '版面 1'): Workspace {
  return {
    id: `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    layout: [],
    widgets: [],
  };
}

export function createDefaultWorkspaceState(): WorkspacePersistedState {
  const ws = createEmptyWorkspace('版面 1');
  return {
    version: 1,
    density: 'tight',
    lastOpenedId: ws.id,
    workspaces: [ws],
  };
}
