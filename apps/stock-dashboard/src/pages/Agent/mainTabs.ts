export type MainTabKind = 'chat' | 'code' | 'diff';

export type MainTab = {
  id: string;
  kind: MainTabKind;
  title: string;
  path?: string;
};

export const CHAT_TAB_ID = 'chat';

export function chatTab(): MainTab {
  return { id: CHAT_TAB_ID, kind: 'chat', title: '对话' };
}

export function codeTabId(path: string): string {
  return `code:${path}`;
}

export function diffTabId(path: string): string {
  return `diff:${path}`;
}

export function openOrFocusTab(
  tabs: MainTab[],
  next: MainTab
): { tabs: MainTab[]; activeId: string } {
  const existing = tabs.find((t) => t.id === next.id);
  if (existing) return { tabs, activeId: existing.id };
  return { tabs: [...tabs, next], activeId: next.id };
}
