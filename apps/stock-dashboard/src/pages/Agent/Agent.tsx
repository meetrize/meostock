/**
 * AI Agent 工作台（Phase 2/3：工作区 coding + 自升级验收）
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Bot, Loader2, Plus, Send, Trash2, CandlestickChart, FileCode2 } from 'lucide-react';
import { openKlineTool } from '@/utils/multipanel';
import { useToast } from '@/components/common';
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
  AgentSession,
  ChatMessage,
  CuratedPrompt,
  ToolEvent,
} from './types';
import styles from './Agent.module.css';

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

function renderRichText(text: string) {
  const parts: ReactNode[] = [];
  const re = /\[([^\]]+)\]\((kline:[^)]+|\/?\?symbol=[^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const label = m[1];
    const href = m[2];
    const symbol = href.startsWith('kline:')
      ? href.slice('kline:'.length)
      : new URLSearchParams(href.replace(/^\//, '').replace(/^\?/, '')).get('symbol') || '';
    parts.push(
      <button
        key={`lk-${key++}`}
        type="button"
        className={styles.inlineLink}
        onClick={() => symbol && openKline(symbol)}
      >
        {label}
      </button>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
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
  const [input, setInput] = useState('');
  const [pendingSkill, setPendingSkill] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [healthHint, setHealthHint] = useState<string | null>(null);
  const [modelLabel, setModelLabel] = useState('未配置');
  const [permLabel, setPermLabel] = useState('L0–L2');
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [busyAccept, setBusyAccept] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) || sessions[0],
    [sessions, activeId]
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

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    saveActiveId(activeId);
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [active?.messages, streaming]);

  useEffect(() => {
    void (async () => {
      try {
        const [pRes, hRes] = await Promise.all([
          fetch('/api/agent/prompts'),
          fetch('/api/agent/health'),
        ]);
        const pData = await pRes.json().catch(() => ({}));
        const hData = await hRes.json().catch(() => ({}));
        if (pData?.ok && Array.isArray(pData.prompts)) setPrompts(pData.prompts);
        if (hData?.configured) {
          setModelLabel(`${hData.provider || 'ai'} · ${hData.model || ''}`);
          setPermLabel(String(hData.permissionLevel || 'L0-L2'));
          setHealthHint(null);
        } else {
          setModelLabel('未配置');
          setHealthHint(hData?.hint || '请先在设置中配置 AI 模型');
        }
      } catch {
        setHealthHint('无法连接 Agent 服务');
      }
    })();
  }, []);

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

  const finalizeAcceptance = async (id: string, push: boolean) => {
    setBusyAccept(id);
    try {
      const res = await fetch(`/api/agent/acceptance/${id}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ push }),
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
    if (!content || streaming || !active) return;

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
    setPendingSkill(null);
    setStreaming(true);

    const history = [...active.messages, userMsg]
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: active.id,
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
          if (event === 'intent') {
            updateAssistant((m) => ({
              ...m,
              intent: String(obj.intent || ''),
              skillId: (obj.skillId as string) || m.skillId,
              permission: String(obj.permission || ''),
            }));
            if (obj.workspacePath) setWorkspacePath(String(obj.workspacePath));
            if (obj.permission) setPermLabel(String(obj.permission));
          } else if (event === 'tool_start') {
            const te: ToolEvent = {
              id: String(obj.id || obj.tool || uid()),
              tool: String(obj.tool || ''),
              arguments: String(obj.arguments || ''),
              status: 'running',
            };
            updateAssistant((m) => ({
              ...m,
              tools: [...(m.tools || []).filter((t) => t.id !== te.id), te],
            }));
          } else if (event === 'tool_result') {
            updateAssistant((m) => ({
              ...m,
              tools: (m.tools || []).map((t) =>
                t.id === String(obj.id || '') || t.tool === String(obj.tool || '')
                  ? { ...t, status: 'done', result: obj.result }
                  : t
              ),
            }));
          } else if (event === 'content') {
            updateAssistant((m) => ({
              ...m,
              content: (m.content || '') + String(obj.content || ''),
            }));
          } else if (event === 'content_linked') {
            updateAssistant((m) => ({
              ...m,
              contentLinked: String(obj.content || m.content),
            }));
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
          } else if (event === 'error') {
            updateAssistant((m) => ({ ...m, error: String(obj.error || '错误') }));
            if (obj.hint) setHealthHint(String(obj.hint));
          } else if (event === 'done') {
            if (obj.workspacePath) setWorkspacePath(String(obj.workspacePath));
            if (obj.permission) setPermLabel(String(obj.permission));
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const message = err instanceof Error ? err.message : '请求失败';
      patchActive((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === assistantId ? { ...m, error: message, content: m.content || '' } : m
        ),
      }));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const onPromptClick = (p: CuratedPrompt) => {
    setInput(p.prompt);
    setPendingSkill(p.skillId);
    void send(p.prompt, p.skillId);
  };

  const showPanel =
    panelArtifacts.arts.length > 0 || panelArtifacts.accepts.length > 0 || !!workspacePath;

  return (
    <div className={`${styles.page}${showPanel ? '' : ` ${styles.pageNoPanel}`}`}>
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
        <div className={styles.topbar}>
          <div className={styles.topTitle}>
            <h1>AI Agent</h1>
            <div className={styles.meta}>
              本机投研 / 工程副驾驶 · 权限 {permLabel}
              {workspacePath ? ` · 工作区已就绪` : ''}
            </div>
          </div>
          <span className={styles.badge}>{modelLabel}</span>
        </div>

        {healthHint && (
          <div className={styles.hintBanner}>
            {healthHint} · <a href="/dashboard/settings">去设置</a>
          </div>
        )}

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
                className={`${styles.bubble} ${
                  m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant
                }`}
              >
                {m.role === 'assistant' && (m.intent || m.permission) ? (
                  <div className={styles.intentTag}>
                    {m.intent ? `意图 · ${m.intent}` : ''}
                    {m.permission ? ` · ${m.permission}` : ''}
                  </div>
                ) : null}
                {m.role === 'assistant' && m.tools && m.tools.length > 0 ? (
                  <div className={styles.toolList}>
                    {m.tools.map((t) => (
                      <div key={t.id} className={styles.toolRow}>
                        {t.status === 'running' ? '… ' : '✓ '}
                        {t.tool}
                        {t.status === 'done' && t.result
                          ? ` · ${summarizeTool(t.result)}`
                          : ''}
                      </div>
                    ))}
                  </div>
                ) : null}
                {renderRichText(
                  m.contentLinked ||
                    m.content ||
                    (streaming && m.role === 'assistant' ? '…' : '')
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
          <textarea
            className={styles.input}
            value={input}
            placeholder="输入提示词…（Enter 发送，Shift+Enter 换行）"
            rows={2}
            disabled={streaming}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            className={styles.sendBtn}
            disabled={streaming || !input.trim()}
            onClick={() => void send()}
          >
            {streaming ? <Loader2 size={16} /> : <Send size={16} />}
            发送
          </button>
        </div>
      </section>

      {showPanel ? (
        <aside className={styles.sidePanel}>
          <div className={styles.sidePanelHead}>产物 / 验收</div>
          <div className={styles.sidePanelBody}>
            {workspacePath ? (
              <div className={styles.artifactCard}>
                <div>工作区</div>
                <div className={styles.artifactPath}>{workspacePath}</div>
              </div>
            ) : null}
            {panelArtifacts.accepts.map((a) => (
              <div key={a.id} className={styles.acceptCard}>
                <p className={styles.acceptTitle}>验收 · {a.status}</p>
                <div>{a.summary}</div>
                {a.commitMessage ? (
                  <div className={styles.diffStat}>{a.commitMessage}</div>
                ) : null}
                {a.diffStat ? <div className={styles.diffStat}>{a.diffStat}</div> : null}
                {a.status === 'pending' ? (
                  <div className={styles.acceptActions}>
                    <button
                      type="button"
                      className={styles.acceptBtn}
                      disabled={busyAccept === a.id}
                      onClick={() => void finalizeAcceptance(a.id, true)}
                    >
                      通过并 push
                    </button>
                    <button
                      type="button"
                      className={styles.rejectBtn}
                      disabled={busyAccept === a.id}
                      onClick={() => void rejectAcceptance(a.id)}
                    >
                      驳回
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
            {panelArtifacts.arts
              .filter((a) => a.type !== 'acceptance')
              .map((a, i) => (
                <div key={`${a.path || a.type}-${i}`} className={styles.artifactCard}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <FileCode2 size={14} />
                    <span>{a.type || 'file'}</span>
                    {a.scope ? <span>· {a.scope}</span> : null}
                  </div>
                  {a.path ? <div className={styles.artifactPath}>{a.path}</div> : null}
                  {a.absPath ? (
                    <div className={styles.artifactPath} title={a.absPath}>
                      {a.absPath}
                    </div>
                  ) : null}
                </div>
              ))}
            {!panelArtifacts.arts.length && !panelArtifacts.accepts.length ? (
              <div className={styles.sideEmpty}>本会话尚无产物</div>
            ) : null}
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function summarizeTool(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const r = result as Record<string, unknown>;
  if (r.ok === false) return String(r.error || '失败');
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
