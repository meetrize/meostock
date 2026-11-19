import {
  AGENT_ACTIVE_KEY,
  AGENT_SESSIONS_KEY,
  type AgentSession,
  type ChatMessage,
} from './types';

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newSession(title = '新对话'): AgentSession {
  const now = Date.now();
  return {
    id: uid(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function loadSessions(): AgentSession[] {
  try {
    const raw = localStorage.getItem(AGENT_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AgentSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s) => s && typeof s.id === 'string');
  } catch {
    return [];
  }
}

export function saveSessions(sessions: AgentSession[]): void {
  try {
    localStorage.setItem(AGENT_SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    /* ignore quota */
  }
}

export function loadActiveId(): string | null {
  try {
    return localStorage.getItem(AGENT_ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function saveActiveId(id: string | null): void {
  try {
    if (id) localStorage.setItem(AGENT_ACTIVE_KEY, id);
    else localStorage.removeItem(AGENT_ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

export function titleFromMessage(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return '新对话';
  return t.length > 28 ? `${t.slice(0, 28)}…` : t;
}

export function appendMessage(session: AgentSession, msg: ChatMessage): AgentSession {
  return {
    ...session,
    updatedAt: Date.now(),
    title:
      session.messages.length === 0 && msg.role === 'user'
        ? titleFromMessage(msg.content)
        : session.title,
    messages: [...session.messages, msg],
  };
}
