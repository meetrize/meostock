export type MainTabKind = 'chat' | 'code' | 'diff';

export type MainTab = {
  id: string;
  kind: MainTabKind;
  title: string;
  path?: string;
  /** 代码/Diff 标签绑定的项目；缺省则用当前下拉选中的项目 */
  projectId?: string;
};

export const CHAT_TAB_ID = 'chat';

export function chatTab(): MainTab {
  return { id: CHAT_TAB_ID, kind: 'chat', title: '对话' };
}

export function codeTabId(path: string, projectId?: string): string {
  return projectId ? `code:${projectId}:${path}` : `code:${path}`;
}

export function diffTabId(path: string, projectId?: string): string {
  return projectId ? `diff:${projectId}:${path}` : `diff:${path}`;
}

export function openOrFocusTab(
  tabs: MainTab[],
  next: MainTab
): { tabs: MainTab[]; activeId: string } {
  const existing = tabs.find((t) => t.id === next.id);
  if (existing) return { tabs, activeId: existing.id };
  return { tabs: [...tabs, next], activeId: next.id };
}
