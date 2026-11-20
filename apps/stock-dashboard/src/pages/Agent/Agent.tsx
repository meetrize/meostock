/**
 * AI Agent 工作台（Phase 2/3：工作区 coding + 自升级验收）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Plus,
  Send,
  Square,
  Trash2,
  CandlestickChart,
} from 'lucide-react';
import { openKlineTool } from '@/utils/multipanel';
import { useToast } from '@/components/common';
import { MarkdownBody } from './MarkdownBody';
import { StreamingPlain } from './StreamingPlain';
import { ModelPicker } from './ModelPicker';
import { MainTabBar } from './main/MainTabBar';
import { CodeViewer } from './main/CodeViewer';
import { DiffViewer } from './main/DiffViewer';
import {
  SideWorkbench,
  type SideTabId,
} from './side/SideWorkbench';
import type { ToolTrailItem } from './side/ToolsPanel';
import {
  CHAT_TAB_ID,
  chatTab,
  codeTabId,
  diffTabId,
  openOrFocusTab,
  type MainTab,
} from './mainTabs';
import {
  appendMessage,
  loadActiveId,
  loadSessions,
  newSession,
  saveActiveId,
  saveSessions,
} from './sessions';
import type {
  AcceptanceInfo,
  AgentArtifact,
  AgentEntity,
  AgentProject,
  AgentSession,
  AgentSkill,
  AiProfileOption,
  ChatMessage,
  CuratedPrompt,
  ToolEvent,
} from './types';
import { AGENT_PROJECT_KEY } from './types';
import styles from './Agent.module.css';

const DEFAULT_PROJECT_ID = 'meostock';
const SIDE_WIDTH_KEY = 'meostock.agent.sideWidth';
/** 右侧工作台宽度：默认 300，可拖 240～480 */
const SIDE_WIDTH_DEFAULT = 300;
const SIDE_WIDTH_MIN = 240;
const SIDE_WIDTH_MAX = 480;

function loadSideWidth(): number {
  try {
    const n = Number(localStorage.getItem(SIDE_WIDTH_KEY));
    if (Number.isFinite(n)) {
      return Math.min(SIDE_WIDTH_MAX, Math.max(SIDE_WIDTH_MIN, Math.round(n)));
    }
  } catch {
    /* ignore */
  }
  return SIDE_WIDTH_DEFAULT;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatToolPayload(raw: unknown, limit = 4000): string {
  if (raw == null) return '（无）';
  let text: string;
  if (typeof raw === 'string') {
    text = raw;
    try {
      text = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      /* keep raw string */
    }
  } else {
    try {
      text = JSON.stringify(raw, null, 2);
    } catch {
      text = String(raw);
    }
  }
  if (text.length > limit) return `${text.slice(0, limit)}\n…(截断 ${text.length - limit} 字符)`;
  return text;
}

function ToolCallsPanel({ tools }: { tools: ToolEvent[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className={styles.toolList}>
      <div className={styles.toolListHead}>工具调用 · 共 {tools.length} 轮（点击展开详情）</div>
      {tools.map((t, i) => {
        const open = openId === t.id;
        const round = t.round ?? i + 1;
        return (
          <div
            key={t.id}
            className={`${styles.toolRow}${open ? ` ${styles.toolRowOpen}` : ''}`}
          >
            <button
              type="button"
              className={styles.toolRowBtn}
              onClick={() => setOpenId((cur) => (cur === t.id ? null : t.id))}
              aria-expanded={open}
            >
              <span className={styles.toolRound}>#{round}</span>
              <span className={styles.toolName}>
                {t.status === 'running' ? '… ' : t.status === 'error' ? '✗ ' : '✓ '}
                {t.tool}
              </span>
              <span className={styles.toolSummary} title={summarizeTool(t.result)}>
                {t.status === 'running'
                  ? '执行中…'
                  : t.result != null
                    ? summarizeTool(t.result)
                    : t.arguments
                      ? '已发起'
                      : ''}
              </span>
              <span className={styles.toolChevron}>
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </span>
            </button>
            {open ? (
              <div className={styles.toolDetail}>
                <div className={styles.toolDetailLabel}>参数</div>
                <pre className={styles.toolPre}>{formatToolPayload(t.arguments)}</pre>
                <div className={styles.toolDetailLabel}>结果</div>
                <pre className={styles.toolPre}>
                  {t.status === 'running' ? '执行中…' : formatToolPayload(t.result)}
                </pre>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function loadSavedProjectId(): string {
  try {
    const v = localStorage.getItem(AGENT_PROJECT_KEY);
    return v?.trim() || DEFAULT_PROJECT_ID;
  } catch {
    return DEFAULT_PROJECT_ID;
  }
}

function saveProjectId(id: string) {
  try {
    localStorage.setItem(AGENT_PROJECT_KEY, id);
  } catch {
    /* ignore */
  }
}

function openKline(symbol: string) {
  openKlineTool(symbol);
}

function ensureSessions(): AgentSession[] {
  const list = loadSessions();
  if (list.length) return list;
  const s = newSession();
  saveSessions([s]);
  saveActiveId(s.id);
  return [s];
}

export function Agent() {
  const toast = useToast();
  const [sessions, setSessions] = useState<AgentSession[]>(() => ensureSessions());
  const [activeId, setActiveId] = useState<string>(() => {
    const list = ensureSessions();
    const saved = loadActiveId();
    if (saved && list.some((s) => s.id === saved)) return saved;
    return list[0].id;
  });
  const [prompts, setPrompts] = useState<CuratedPrompt[]>([]);
  const [projects, setProjects] = useState<AgentProject[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [projectId, setProjectId] = useState<string>(() => loadSavedProjectId());
  const [input, setInput] = useState('');
  const [pendingSkill, setPendingSkill] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [healthHint, setHealthHint] = useState<string | null>(null);
  const [modelLabel, setModelLabel] = useState('未配置');
  const [aiProfiles, setAiProfiles] = useState<AiProfileOption[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('');
  const [switchingModel, setSwitchingModel] = useState(false);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [busyAccept, setBusyAccept] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<SideTabId>('files');
  const [sideWidth, setSideWidth] = useState(() => loadSideWidth());
  const [mainTabs, setMainTabs] = useState<MainTab[]>(() => [chatTab()]);
  const [activeMainTabId, setActiveMainTabId] = useState(CHAT_TAB_ID);
  const pageRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  /** 流式正文单独状态，避免每个 token 都改 sessions 触发整树 reconcile */
  const [liveStream, setLiveStream] = useState<{ id: string; text: string } | null>(null);
  const liveStreamAccRef = useRef('');
  const liveStreamRafRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageAnchorRef = useRef<Record<string, HTMLDivElement | null>>({});
  const abortRef = useRef<AbortController | null>(null);
  /** 请求是否仍在飞（与 UI streaming 解耦，避免停不住/连点双发） */
  const inFlightRef = useRef(false);
  /** 发送前草稿：中断/失败后写回输入框，避免发送钮因空输入一直灰掉 */
  const draftPromptRef = useRef('');
  const lastSseAtRef = useRef(0);

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) || sessions[0],
    [sessions, activeId]
  );

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projectId) || projects[0] || null,
    [projects, projectId]
  );

  const panelArtifacts = useMemo(() => {
    const arts: AgentArtifact[] = [];
    const accepts: AcceptanceInfo[] = [];
    for (const m of active?.messages || []) {
      if (m.artifacts?.length) arts.push(...m.artifacts);
      if (m.acceptance?.id) accepts.push(m.acceptance);
    }
    return { arts, accepts };
  }, [active?.messages]);

  const toolTrail = useMemo(() => {
    const items: ToolTrailItem[] = [];
    for (const m of active?.messages || []) {
      for (const t of m.tools || []) {
        items.push({ ...t, messageId: m.id });
      }
    }
    return items;
  }, [active?.messages]);

  const pendingAcceptCount = useMemo(
    () => panelArtifacts.accepts.filter((a) => a.status === 'pending').length,
    [panelArtifacts.accepts]
  );

  const activeMainTab = useMemo(
    () => mainTabs.find((t) => t.id === activeMainTabId) || mainTabs[0],
    [mainTabs, activeMainTabId]
  );

  useEffect(() => {
    // 切换项目：关掉代码/Diff 标签，回到对话
    setMainTabs([chatTab()]);
    setActiveMainTabId(CHAT_TAB_ID);
  }, [projectId]);

  useEffect(() => {
    // 流式过程中不写 localStorage，减少额外同步与重渲染
    if (streaming) return;
    saveSessions(sessions);
  }, [sessions, streaming]);

  useEffect(() => {
    saveActiveId(activeId);
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [active?.messages, streaming, liveStream?.text]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/projects');
      const data = await res.json().catch(() => ({}));
      if (data?.ok && Array.isArray(data.projects)) {
        setProjects(data.projects as AgentProject[]);
        const ids = new Set((data.projects as AgentProject[]).map((p) => p.id));
        setProjectId((cur) => {
          if (ids.has(cur)) return cur;
          return DEFAULT_PROJECT_ID;
        });
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadAiProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) return;
      const list = Array.isArray(data.profiles) ? (data.profiles as AiProfileOption[]) : [];
      setAiProfiles(list);
      const active = (data.active as AiProfileOption | null) || list.find((p) => p.active) || null;
      if (active?.id) setActiveProfileId(active.id);
      if (data.configured && (active || data.model)) {
        setModelLabel(
          `${active?.provider || data.provider || 'ai'} · ${active?.model || data.model || ''}`
        );
        setHealthHint(null);
      } else {
        setModelLabel('未配置');
        setHealthHint(data?.hint || '请先在设置中配置 AI 模型');
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [pRes, hRes, projRes, skRes] = await Promise.all([
          fetch('/api/agent/prompts'),
          fetch('/api/agent/health'),
          fetch('/api/agent/projects'),
          fetch('/api/agent/skills'),
        ]);
        const pData = await pRes.json().catch(() => ({}));
        const hData = await hRes.json().catch(() => ({}));
        const projData = await projRes.json().catch(() => ({}));
        const skData = await skRes.json().catch(() => ({}));
        if (pData?.ok && Array.isArray(pData.prompts)) setPrompts(pData.prompts);
        if (projData?.ok && Array.isArray(projData.projects)) {
          setProjects(projData.projects as AgentProject[]);
          const ids = new Set((projData.projects as AgentProject[]).map((p) => p.id));
          setProjectId((cur) => (ids.has(cur) ? cur : DEFAULT_PROJECT_ID));
        }
        if (skData?.ok && Array.isArray(skData.skills)) {
          setSkills(skData.skills as AgentSkill[]);
        }
        if (hData?.configured) {
          setModelLabel(`${hData.provider || 'ai'} · ${hData.model || ''}`);
          setHealthHint(null);
        } else {
          setModelLabel('未配置');
          setHealthHint(hData?.hint || '请先在设置中配置 AI 模型');
        }
        await loadAiProfiles();
      } catch {
        setHealthHint('无法连接 Agent 服务');
      }
    })();
  }, [loadAiProfiles]);

  const switchAiProfile = async (id: string) => {
    if (!id || id === activeProfileId || switchingModel) return;
    setSwitchingModel(true);
    try {
      const res = await fetch(`/api/ai/profiles/${id}/activate`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || '切换模型失败');
      }
      const profile = data.profile as AiProfileOption | undefined;
      setActiveProfileId(id);
      if (profile) {
        setAiProfiles((prev) =>
          prev.map((p) => ({ ...p, active: p.id === id }))
        );
        setModelLabel(`${profile.provider || 'ai'} · ${profile.model || ''}`);
      }
      toast.success(`已切换：${profile?.name || profile?.model || id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '切换模型失败');
      await loadAiProfiles();
    } finally {
      setSwitchingModel(false);
    }
  };

  useEffect(() => {
    saveProjectId(projectId);
  }, [projectId]);

  const patchActive = useCallback(
    (updater: (s: AgentSession) => AgentSession) => {
      setSessions((prev) => prev.map((s) => (s.id === activeId ? updater(s) : s)));
    },
    [activeId]
  );

  const createSession = () => {
    const s = newSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setInput('');
    setPendingSkill(null);
    setWorkspacePath(null);
  };

  const deleteSession = (id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (!next.length) {
        const s = newSession();
        setActiveId(s.id);
        return [s];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  };

  const finalizeAcceptance = async (
    id: string,
    push: boolean,
    commitMessage?: string
  ) => {
    setBusyAccept(id);
    try {
      const res = await fetch(`/api/agent/acceptance/${id}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          push,
          commitMessage: commitMessage?.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        const msg =
          data?.error ||
          (data?.pushed === false
            ? '已 commit，但 push 失败'
            : `验收提交失败 HTTP ${res.status}`);
        toast.error(msg);
        if (data?.committed) {
          toast.success('本地 commit 已完成');
        }
      } else {
        toast.success(push ? '已验收并 commit + push' : '已验收并 commit');
      }
      patchActive((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.acceptance?.id === id
            ? {
                ...m,
                acceptance: {
                  ...m.acceptance,
                  status: data?.ok ? 'finalized' : m.acceptance.status,
                  commitMessage:
                    commitMessage?.trim() || m.acceptance.commitMessage,
                },
              }
            : m
        ),
      }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '验收失败');
    } finally {
      setBusyAccept(null);
    }
  };

  const directCommit = async (message: string, push: boolean) => {
    const res = await fetch('/api/agent/git/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: projectId || DEFAULT_PROJECT_ID,
        message,
        push,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      if (data?.committed && data?.pushed === false) {
        toast.success('本地 commit 已完成');
        toast.error(data?.error || 'push 失败');
        return;
      }
      throw new Error(data?.error || '提交失败');
    }
    toast.success(push ? '已 commit + push' : '已 commit');
  };

  useEffect(() => {
    try {
      localStorage.setItem(SIDE_WIDTH_KEY, String(sideWidth));
    } catch {
      /* ignore */
    }
  }, [sideWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current || !pageRef.current) return;
      const rect = pageRef.current.getBoundingClientRect();
      const next = Math.round(rect.right - e.clientX);
      setSideWidth(Math.min(SIDE_WIDTH_MAX, Math.max(SIDE_WIDTH_MIN, next)));
    };
    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const rejectAcceptance = async (id: string) => {
    setBusyAccept(id);
    try {
      const res = await fetch(`/api/agent/acceptance/${id}/reject`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || '驳回失败');
      toast.success('已驳回，可继续让 Agent 修改');
      patchActive((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.acceptance?.id === id
            ? { ...m, acceptance: { ...m.acceptance!, status: 'rejected' } }
            : m
        ),
      }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '驳回失败');
    } finally {
      setBusyAccept(null);
    }
  };

  const send = async (text?: string, skillId?: string | null) => {
    const content = (text ?? input).trim();
    if (!content || inFlightRef.current || !active) return;

    draftPromptRef.current = content;
    inFlightRef.current = true;
    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      content,
      ts: Date.now(),
      skillId: skillId ?? pendingSkill,
    };
    const assistantId = uid();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      ts: Date.now(),
      tools: [],
      entities: [],
      artifacts: [],
    };

    patchActive((s) => {
      let next = appendMessage(s, userMsg);
      next = appendMessage(next, assistantMsg);
      return next;
    });
    setInput('');
    setStreaming(true);
    liveStreamAccRef.current = '';
    setLiveStream({ id: assistantId, text: '' });

    const history = [...active.messages, userMsg]
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    const ac = new AbortController();
    abortRef.current = ac;
    lastSseAtRef.current = Date.now();
    const streamStartedAt = Date.now();
    const STREAM_IDLE_MS = 90_000;
    const STREAM_MAX_MS = 12 * 60_000;
    const watchdog = window.setInterval(() => {
      if (abortRef.current !== ac) return;
      const now = Date.now();
      if (now - lastSseAtRef.current > STREAM_IDLE_MS) {
        ac.abort();
        return;
      }
      if (now - streamStartedAt > STREAM_MAX_MS) {
        ac.abort();
      }
    }, 4000);

    const flushLiveToMessage = (linked?: string) => {
      if (liveStreamRafRef.current != null) {
        cancelAnimationFrame(liveStreamRafRef.current);
        liveStreamRafRef.current = null;
      }
      const text = liveStreamAccRef.current;
      patchActive((s) => ({
        ...s,
        updatedAt: Date.now(),
        messages: s.messages.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: text || m.content,
                contentLinked: linked || m.contentLinked,
              }
            : m
        ),
      }));
      setLiveStream(null);
      liveStreamAccRef.current = '';
    };

    const appendLiveContent = (delta: string) => {
      if (!delta) return;
      liveStreamAccRef.current += delta;
      if (liveStreamRafRef.current != null) return;
      liveStreamRafRef.current = requestAnimationFrame(() => {
        liveStreamRafRef.current = null;
        const text = liveStreamAccRef.current;
        setLiveStream({ id: assistantId, text });
      });
    };

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: active.id,
          projectId: projectId || DEFAULT_PROJECT_ID,
          skillId: skillId ?? userMsg.skillId ?? null,
          messages: history,
        }),
        signal: ac.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || err?.hint || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('无流式响应');
      const decoder = new TextDecoder();
      let buffer = '';
      let linkedFinal: string | undefined;
      let sawDone = false;
      let sawError = false;

      const updateAssistant = (fn: (m: ChatMessage) => ChatMessage) => {
        patchActive((s) => ({
          ...s,
          updatedAt: Date.now(),
          messages: s.messages.map((m) => (m.id === assistantId ? fn(m) : m)),
        }));
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n');
        buffer = chunks.pop() || '';
        for (const line of chunks) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const raw = trimmed.slice(5).trim();
          if (raw === '[DONE]') continue;
          let obj: Record<string, unknown>;
          try {
            obj = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            continue;
          }
          const event = String(obj.event || '');
          lastSseAtRef.current = Date.now();
          if (event === 'intent') {
            updateAssistant((m) => ({
              ...m,
              intent: String(obj.intent || ''),
              skillId: (obj.skillId as string) || m.skillId,
              projectId: (obj.projectId as string) || m.projectId,
              projectName: (obj.projectName as string) || m.projectName,
              permission: String(obj.permission || ''),
            }));
            if (obj.workspacePath) setWorkspacePath(String(obj.workspacePath));
            if (obj.projectKind === 'workspace') {
              void refreshProjects();
            }
          } else if (event === 'tool_start') {
            const te: ToolEvent = {
              id: String(obj.id || obj.tool || uid()),
              tool: String(obj.tool || ''),
              arguments: String(obj.arguments || ''),
              status: 'running',
            };
            updateAssistant((m) => {
              const prev = (m.tools || []).filter((t) => t.id !== te.id);
              return {
                ...m,
                tools: [...prev, { ...te, round: prev.length + 1 }],
              };
            });
          } else if (event === 'tool_result') {
            updateAssistant((m) => ({
              ...m,
              tools: (m.tools || []).map((t) =>
                t.id === String(obj.id || '') ||
                (t.status === 'running' && t.tool === String(obj.tool || ''))
                  ? { ...t, status: 'done', result: obj.result }
                  : t
              ),
            }));
          } else if (event === 'content') {
            appendLiveContent(String(obj.content || ''));
          } else if (event === 'content_linked') {
            linkedFinal = String(obj.content || '');
          } else if (event === 'entities') {
            const items = Array.isArray(obj.items) ? (obj.items as AgentEntity[]) : [];
            updateAssistant((m) => ({ ...m, entities: items }));
          } else if (event === 'artifact') {
            const art = obj.artifact as AgentArtifact;
            updateAssistant((m) => ({
              ...m,
              artifacts: [...(m.artifacts || []), art],
            }));
          } else if (event === 'artifacts') {
            const items = Array.isArray(obj.items) ? (obj.items as AgentArtifact[]) : [];
            updateAssistant((m) => ({
              ...m,
              artifacts: [...(m.artifacts || []), ...items],
            }));
          } else if (event === 'acceptance') {
            const acc = obj.acceptance as AcceptanceInfo;
            updateAssistant((m) => ({ ...m, acceptance: acc }));
          } else if (event === 'status') {
            const tip = String(obj.message || '').trim();
            if (tip) {
              updateAssistant((m) => ({
                ...m,
                tools: [
                  ...(m.tools || []),
                  {
                    id: `status-${uid()}`,
                    tool: 'status',
                    arguments: tip,
                    status: 'done',
                    result: { ok: true, message: tip },
                  },
                ],
              }));
            }
          } else if (event === 'error') {
            sawError = true;
            updateAssistant((m) => ({ ...m, error: String(obj.error || '错误') }));
            if (obj.hint) setHealthHint(String(obj.hint));
          } else if (event === 'done') {
            sawDone = true;
            if (obj.workspacePath) setWorkspacePath(String(obj.workspacePath));
          }
        }
      }
      flushLiveToMessage(linkedFinal);
      // 仅正常 done 才清空草稿；中途断流/服务重启把提示词写回，避免发送钮因空输入灰死
      if (sawDone && !sawError) {
        draftPromptRef.current = '';
      } else if (draftPromptRef.current) {
        setInput(draftPromptRef.current);
        if (!sawDone) {
          updateAssistant((m) => ({
            ...m,
            error: m.error || '连接中断，已停止',
            content: m.content || '（连接中断）',
            tools: (m.tools || []).map((t) =>
              t.status === 'running' ? { ...t, status: 'error' as const } : t
            ),
          }));
        }
      }
    } catch (err) {
      const aborted =
        (err as Error).name === 'AbortError' ||
        (typeof DOMException !== 'undefined' &&
          err instanceof DOMException &&
          err.name === 'AbortError');
      flushLiveToMessage();
      const idle =
        aborted && Date.now() - lastSseAtRef.current > STREAM_IDLE_MS - 1000;
      const markTools = (m: ChatMessage): ChatMessage => ({
        ...m,
        tools: (m.tools || []).map((t) =>
          t.status === 'running' ? { ...t, status: 'error' as const } : t
        ),
      });
      if (aborted) {
        patchActive((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === assistantId
              ? markTools({
                  ...m,
                  error: idle ? '长时间无响应，已自动停止' : '已停止',
                  content: m.content || '（已停止本次请求）',
                })
              : m
          ),
        }));
        if (draftPromptRef.current) setInput(draftPromptRef.current);
        return;
      }
      const message = err instanceof Error ? err.message : '请求失败';
      patchActive((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === assistantId
            ? markTools({ ...m, error: message, content: m.content || '' })
            : m
        ),
      }));
      if (draftPromptRef.current) setInput(draftPromptRef.current);
    } finally {
      window.clearInterval(watchdog);
      inFlightRef.current = false;
      setStreaming(false);
      abortRef.current = null;
      if (liveStreamRafRef.current != null) {
        cancelAnimationFrame(liveStreamRafRef.current);
        liveStreamRafRef.current = null;
      }
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    // 立刻解锁 UI（后台请求随后在 catch/finally 收尾）
    setStreaming(false);
  };

  const onPromptClick = (p: CuratedPrompt) => {
    setInput(p.prompt);
    setPendingSkill(p.skillId);
    void send(p.prompt, p.skillId);
  };

  const openCodeTab = (path: string) => {
    const name = path.split('/').pop() || path;
    const next = openOrFocusTab(mainTabs, {
      id: codeTabId(path),
      kind: 'code',
      title: name,
      path,
    });
    setMainTabs(next.tabs);
    setActiveMainTabId(next.activeId);
  };

  const openDiffTab = (path: string) => {
    const name = path.split('/').pop() || path;
    const next = openOrFocusTab(mainTabs, {
      id: diffTabId(path),
      kind: 'diff',
      title: `Δ ${name}`,
      path,
    });
    setMainTabs(next.tabs);
    setActiveMainTabId(next.activeId);
  };

  const closeMainTab = (id: string) => {
    if (id === CHAT_TAB_ID) return;
    setMainTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (!next.some((t) => t.id === activeMainTabId)) {
        setActiveMainTabId(CHAT_TAB_ID);
      }
      return next.length ? next : [chatTab()];
    });
  };

  const citePath = (path: string) => {
    setInput((cur) => {
      const piece = `\`${path}\``;
      if (!cur.trim()) return piece + ' ';
      return `${cur.replace(/\s+$/, '')} ${piece} `;
    });
    setActiveMainTabId(CHAT_TAB_ID);
    toast.success(`已引用 ${path}`);
  };

  const jumpToMessage = (messageId: string) => {
    setActiveMainTabId(CHAT_TAB_ID);
    window.setTimeout(() => {
      messageAnchorRef.current[messageId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 50);
  };

  return (
    <div
      ref={pageRef}
      className={styles.page}
      style={{ ['--agent-side-w' as string]: `${sideWidth}px` }}
      translate="no"
    >
      <aside className={styles.sessions}>
        <div className={styles.sessionsHead}>
          <h2 className={styles.sessionsTitle}>会话</h2>
          <button type="button" className={styles.newBtn} onClick={createSession}>
            <Plus size={14} />
            新建
          </button>
        </div>
        <div className={styles.sessionList}>
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`${styles.sessionItem} ${
                s.id === activeId ? styles.sessionItemActive : ''
              }`}
              role="button"
              tabIndex={0}
              onClick={() => setActiveId(s.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setActiveId(s.id);
              }}
            >
              <span className={styles.sessionLabel}>{s.title}</span>
              <button
                type="button"
                className={styles.sessionDelete}
                title="删除会话"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSession(s.id);
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section className={styles.main}>
        {healthHint && (
          <div className={styles.hintBanner}>
            {healthHint} · <a href="/dashboard/settings">去设置</a>
          </div>
        )}

        <MainTabBar
          tabs={mainTabs}
          activeId={activeMainTabId}
          onSelect={setActiveMainTabId}
          onClose={closeMainTab}
        />

        {activeMainTab?.kind === 'code' && activeMainTab.path ? (
          <div className={styles.mainPane}>
            <CodeViewer projectId={projectId} path={activeMainTab.path} />
          </div>
        ) : null}

        {activeMainTab?.kind === 'diff' && activeMainTab.path ? (
          <div className={styles.mainPane}>
            <DiffViewer projectId={projectId} path={activeMainTab.path} />
          </div>
        ) : null}

        <div
          className={styles.chatPane}
          hidden={activeMainTab?.kind !== 'chat'}
        >
        <div className={styles.messages}>
          {active && active.messages.length === 0 ? (
            <div className={styles.empty}>
              <Bot className={styles.emptyIcon} size={36} />
              <h2>查库 · Coding · 自升级</h2>
              <p>
                精选提示词可直接发送。工程类任务写入隔离工作区；改本仓库需 smoke
                通过后由你验收再 commit/push。
              </p>
              <div className={styles.promptGrid}>
                {prompts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={styles.promptCard}
                    onClick={() => onPromptClick(p)}
                    disabled={streaming}
                  >
                    <span className={styles.promptCat}>{p.category}</span>
                    <span className={styles.promptTitle}>{p.title}</span>
                    {p.description ? (
                      <span className={styles.promptDesc}>{p.description}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            active?.messages.map((m) => (
              <div
                key={m.id}
                ref={(el) => {
                  messageAnchorRef.current[m.id] = el;
                }}
                className={`${styles.bubble} ${
                  m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant
                }`}
              >
                {m.role === 'assistant' && (m.intent || m.permission || m.projectName) ? (
                  <div className={styles.intentTag}>
                    <span>
                      {m.projectName ? `项目 · ${m.projectName}` : ''}
                      {m.intent ? `${m.projectName ? ' · ' : ''}意图 · ${m.intent}` : ''}
                      {m.skillId ? ` · skill · ${m.skillId}` : ''}
                      {m.permission ? ` · ${m.permission}` : ''}
                    </span>
                  </div>
                ) : null}
                {m.role === 'assistant' && m.tools && m.tools.length > 0 ? (
                  <ToolCallsPanel tools={m.tools} />
                ) : null}
                {m.role === 'assistant' ? (
                  liveStream && liveStream.id === m.id ? (
                    <StreamingPlain text={liveStream.text} />
                  ) : (
                    <MarkdownBody text={m.contentLinked || m.content || ''} />
                  )
                ) : (
                  <div className={styles.userPlain}>
                    <span>{m.content}</span>
                  </div>
                )}
                {m.entities && m.entities.length > 0 ? (
                  <div className={styles.entityRow}>
                    {m.entities.map((e) => (
                      <button
                        key={e.klineSymbol}
                        type="button"
                        className={styles.entityChip}
                        onClick={() => openKline(e.klineSymbol)}
                        title={`打开 K 线 ${e.klineSymbol}`}
                      >
                        <CandlestickChart size={12} />
                        {e.name || e.code || e.klineSymbol}
                      </button>
                    ))}
                  </div>
                ) : null}
                {m.acceptance && m.acceptance.status === 'pending' ? (
                  <div className={styles.acceptActions} style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className={styles.acceptBtn}
                      disabled={busyAccept === m.acceptance.id}
                      onClick={() => void finalizeAcceptance(m.acceptance!.id, true)}
                    >
                      验收通过并提交+推送
                    </button>
                    <button
                      type="button"
                      className={styles.acceptBtn}
                      disabled={busyAccept === m.acceptance.id}
                      onClick={() => void finalizeAcceptance(m.acceptance!.id, false)}
                    >
                      仅 commit
                    </button>
                    <button
                      type="button"
                      className={styles.rejectBtn}
                      disabled={busyAccept === m.acceptance.id}
                      onClick={() => void rejectAcceptance(m.acceptance!.id)}
                    >
                      驳回
                    </button>
                  </div>
                ) : null}
                {m.error ? <div className={styles.errorText}>{m.error}</div> : null}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <div className={styles.composer}>
          <div className={styles.composerBar}>
            <div className={styles.composerField}>
              <span className={styles.composerLabel}>目标项目</span>
              <select
                className={styles.projectSelect}
                value={selectedProject?.id || projectId}
                disabled={streaming}
                onChange={(e) => setProjectId(e.target.value)}
                title={selectedProject?.path || ''}
              >
                {(projects.length
                  ? projects
                  : [
                      {
                        id: DEFAULT_PROJECT_ID,
                        name: 'meostock（本项目）',
                        kind: 'repo',
                        path: '',
                      } as AgentProject,
                    ]
                ).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.kind === 'repo' ? '★ ' : ''}
                    {p.name}
                    {p.kind === 'workspace' && p.fileCount != null
                      ? ` · ${p.fileCount} 文件`
                      : ''}
                  </option>
                ))}
              </select>
              {selectedProject?.description ? (
                <span className={styles.projectHint} title={selectedProject.description}>
                  {selectedProject.description}
                </span>
              ) : null}
            </div>
            <div className={`${styles.composerField} ${styles.composerFieldGrow}`}>
              <span className={styles.composerLabel}>Skill（可选，发送时一并提交）</span>
              <div className={styles.skillChips}>
                <button
                  type="button"
                  className={`${styles.skillChip}${
                    !pendingSkill ? ` ${styles.skillChipActive}` : ''
                  }`}
                  disabled={streaming}
                  onClick={() => setPendingSkill(null)}
                >
                  不指定
                </button>
                {skills.map((sk) => (
                  <button
                    key={sk.id}
                    type="button"
                    className={`${styles.skillChip}${
                      pendingSkill === sk.id ? ` ${styles.skillChipActive}` : ''
                    }`}
                    disabled={streaming}
                    title={sk.description || sk.userHint || sk.id}
                    onClick={() =>
                      setPendingSkill((cur) => (cur === sk.id ? null : sk.id))
                    }
                  >
                    {sk.title}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className={styles.composerBox}>
            <textarea
              className={styles.input}
              value={input}
              placeholder={
                pendingSkill
                  ? `已选 skill · ${pendingSkill}，输入提示词…（Enter 发送）`
                  : '输入提示词…（Enter 发送，Shift+Enter 换行）'
              }
              rows={5}
              disabled={streaming}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && streaming) {
                  e.preventDefault();
                  stop();
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (streaming) stop();
                  else void send();
                }
              }}
            />
            <div className={styles.composerToolbar}>
              <ModelPicker
                options={aiProfiles}
                activeId={activeProfileId}
                label={modelLabel}
                switching={switchingModel}
                disabled={streaming}
                onSelect={(id) => void switchAiProfile(id)}
              />
              <button
                type="button"
                className={`${styles.sendBtn}${streaming ? ` ${styles.stopBtn}` : ''}`}
                disabled={!streaming && !input.trim()}
                title={
                  streaming
                    ? '停止当前请求（Esc）'
                    : input.trim()
                      ? '发送'
                      : '请输入提示词'
                }
                aria-label={streaming ? '停止' : '发送'}
                onClick={() => {
                  if (streaming) stop();
                  else void send();
                }}
              >
                {streaming ? <Square size={14} fill="currentColor" /> : <Send size={18} />}
              </button>
            </div>
          </div>
        </div>
        </div>
      </section>

      <div
        className={styles.resizeHandle}
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧栏宽度"
        title={`拖动调整侧栏（${SIDE_WIDTH_MIN}–${SIDE_WIDTH_MAX}px）`}
        onMouseDown={(e) => {
          e.preventDefault();
          resizingRef.current = true;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
        onDoubleClick={() => setSideWidth(SIDE_WIDTH_DEFAULT)}
      />

      <SideWorkbench
        sideTab={sideTab}
        onSideTab={setSideTab}
        projectId={projectId || DEFAULT_PROJECT_ID}
        workspacePath={workspacePath}
        arts={panelArtifacts.arts}
        accepts={panelArtifacts.accepts}
        busyAccept={busyAccept}
        toolItems={toolTrail}
        pendingAcceptCount={pendingAcceptCount}
        onOpenFile={openCodeTab}
        onOpenDiff={openDiffTab}
        onCitePath={citePath}
        onFinalize={(id, push, msg) => void finalizeAcceptance(id, push, msg)}
        onReject={(id) => void rejectAcceptance(id)}
        onDirectCommit={directCommit}
        onJumpTool={jumpToMessage}
      />
    </div>
  );
}

function summarizeTool(result: unknown): string {
  if (result == null) return '';
  if (typeof result !== 'object') return String(result).slice(0, 80);
  const r = result as Record<string, unknown>;
  if (r.message && typeof r.message === 'string') return r.message.slice(0, 120);
  if (r.ok === false) return String(r.error || '失败');
  if (typeof r.path === 'string') {
    const more =
      r.truncated === true
        ? ` · 截断${r.nextOffset != null ? ` next=${r.nextOffset}` : ''}`
        : typeof r.totalChars === 'number'
          ? ` · ${r.totalChars} 字符`
          : '';
    return `${r.path}${more}`;
  }
  if (typeof r.command === 'string') {
    const cmd = r.command.length > 60 ? `${r.command.slice(0, 60)}…` : r.command;
    return typeof r.exitCode === 'number' ? `${cmd} · exit ${r.exitCode}` : cmd;
  }
  if (Array.isArray(r.tables)) return `${r.tables.length} 张表`;
  if (Array.isArray(r.columns)) return `${r.columns.length} 列`;
  if (typeof r.rowCount === 'number') return `${r.rowCount} 行`;
  if (typeof r.count === 'number') return `${r.count} 条`;
  if (r.artifact && typeof r.artifact === 'object') {
    const a = r.artifact as { path?: string };
    return a.path ? `写入 ${a.path}` : '产物';
  }
  if (r.acceptance && typeof r.acceptance === 'object') return '待验收';
  if (typeof r.exitCode === 'number') return `exit ${r.exitCode}`;
  return '完成';
}
