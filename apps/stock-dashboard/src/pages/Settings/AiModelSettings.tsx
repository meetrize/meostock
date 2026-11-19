/**
 * 设置页：AI 模型多平台档案
 */

import { useCallback, useEffect, useState } from 'react';
import { Bot, Check, Loader2, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { useToast } from '@/components/common';
import settingsStyles from './Settings.module.css';
import styles from './AiModelSettings.module.css';

type ProviderKind = 'deepseek' | 'openai_compat';

type AiProfile = {
  id: string;
  name: string;
  provider: ProviderKind | string;
  base_url: string;
  model: string;
  has_api_key: boolean;
  api_key_masked: string;
  max_tokens?: number | null;
  timeout_sec?: number | null;
  active?: boolean;
};

type AiHealth = {
  ok?: boolean;
  error?: string;
  latency_ms?: number;
  at?: number;
  model?: string;
  provider?: string;
};

type AiConfigState = {
  configured: boolean;
  active: AiProfile | null;
  provider?: string | null;
  model?: string | null;
  base_url?: string | null;
  health?: AiHealth | null;
  profiles: AiProfile[];
  hint?: string | null;
};

type Draft = {
  id: string | null;
  name: string;
  provider: ProviderKind;
  base_url: string;
  model: string;
  api_key: string;
  replaceKey: boolean;
  max_tokens: string;
  timeout_sec: string;
  showAdvanced: boolean;
};

const DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-flash', 'deepseek-reasoner'];
const DEFAULT_DEEPSEEK_URL = 'https://api.deepseek.com';

function emptyDraft(provider: ProviderKind = 'deepseek'): Draft {
  return {
    id: null,
    name: '',
    provider,
    base_url: provider === 'deepseek' ? DEFAULT_DEEPSEEK_URL : '',
    model: provider === 'deepseek' ? 'deepseek-flash' : '',
    api_key: '',
    replaceKey: true,
    max_tokens: '',
    timeout_sec: '',
    showAdvanced: false,
  };
}

function draftFromProfile(p: AiProfile): Draft {
  return {
    id: p.id,
    name: p.name || '',
    provider: p.provider === 'deepseek' ? 'deepseek' : 'openai_compat',
    base_url: p.base_url || '',
    model: p.model || '',
    api_key: '',
    replaceKey: false,
    max_tokens: p.max_tokens != null ? String(p.max_tokens) : '',
    timeout_sec: p.timeout_sec != null ? String(p.timeout_sec) : '',
    showAdvanced: Boolean(p.max_tokens || p.timeout_sec),
  };
}

function providerLabel(p: string | undefined | null): string {
  return p === 'deepseek' ? 'DeepSeek' : 'OpenAI 兼容';
}

function fmtHealthAt(at?: number): string {
  if (!at) return '';
  try {
    return new Date(at * 1000).toLocaleString();
  } catch {
    return '';
  }
}

export function AiModelSettings() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [cfg, setCfg] = useState<AiConfigState | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const applyPayload = (data: Record<string, unknown>) => {
    setCfg({
      configured: Boolean(data.configured),
      active: (data.active as AiProfile) || null,
      provider: (data.provider as string) || null,
      model: (data.model as string) || null,
      base_url: (data.base_url as string) || null,
      health: (data.health as AiHealth) || null,
      profiles: Array.isArray(data.profiles) ? (data.profiles as AiProfile[]) : [],
      hint: (data.hint as string) || null,
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || '加载 AI 配置失败');
      }
      applyPayload(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const activate = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/profiles/${id}/activate`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || '切换失败');
      }
      applyPayload(data);
      toast.success(`已切换：${data.profile?.name || data.model || id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('确定删除该 AI 配置？')) return;
    try {
      const res = await fetch(`/api/ai/profiles/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || '删除失败');
      }
      applyPayload(data);
      if (draft?.id === id) setDraft(null);
      toast.success('已删除');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setTestMsg(null);
    try {
      const body: Record<string, unknown> = {
        name: draft.name.trim() || undefined,
        provider: draft.provider,
        base_url: draft.base_url.trim(),
        model: draft.model.trim(),
        max_tokens: draft.max_tokens ? Number(draft.max_tokens) : undefined,
        timeout_sec: draft.timeout_sec ? Number(draft.timeout_sec) : undefined,
      };
      if (draft.id) {
        if (draft.replaceKey && draft.api_key.trim()) {
          body.api_key = draft.api_key.trim();
        }
        if (!draft.max_tokens) body.clear_max_tokens = true;
        if (!draft.timeout_sec) body.clear_timeout_sec = true;
        const res = await fetch(`/api/ai/profiles/${draft.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.error || '保存失败');
        applyPayload(data);
        setDraft(draftFromProfile(data.profile as AiProfile));
        toast.success('已保存');
      } else {
        if (!draft.api_key.trim()) throw new Error('请填写 API Key');
        body.api_key = draft.api_key.trim();
        body.activate = !(cfg?.profiles?.length);
        const res = await fetch('/api/ai/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.error || '创建失败');
        applyPayload(data);
        setDraft(null);
        toast.success('已添加配置');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const testConn = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const body: Record<string, unknown> = {};
      if (draft) {
        if (draft.id && !draft.replaceKey) {
          body.profile_id = draft.id;
        }
        body.provider = draft.provider;
        body.base_url = draft.base_url.trim();
        body.model = draft.model.trim();
        if (draft.replaceKey && draft.api_key.trim()) {
          body.api_key = draft.api_key.trim();
        }
        if (draft.max_tokens) body.max_tokens = Number(draft.max_tokens);
        if (draft.timeout_sec) body.timeout_sec = Number(draft.timeout_sec);
      }
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      const result = data?.result || data;
      if (!res.ok || result?.ok === false) {
        const err = result?.error || data?.error || '连通失败';
        setTestMsg(`失败：${err}`);
        toast.error(String(err).slice(0, 120));
        return;
      }
      const ms = result?.latency_ms != null ? `${result.latency_ms} ms` : '';
      setTestMsg(`连通成功${ms ? ` · ${ms}` : ''}`);
      toast.success('连通成功');
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTestMsg(`失败：${msg}`);
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  const statusLine = (() => {
    if (loading && !cfg) return '加载中…';
    if (!cfg?.configured || !cfg.active) return '未配置';
    const h = cfg.health;
    const conn =
      h?.ok === true ? '已连通' : h?.ok === false ? '上次探测失败' : '尚未探测';
    return `当前：${providerLabel(cfg.provider)} · ${cfg.model || '—'} · ${conn}`;
  })();

  return (
    <div className={settingsStyles.section}>
      <div className={settingsStyles.sectionHeader}>
        <Bot size={18} className={settingsStyles.sectionIcon} />
        <h3>AI 模型</h3>
      </div>
      <div className={settingsStyles.sectionContent}>
        <div className={styles.statusBar}>
          <div className={styles.statusMain}>{statusLine}</div>
          <div className={styles.statusMeta}>
            {cfg?.health?.ok === false && cfg.health.error ? (
              <span className={styles.statusErr}>
                {(cfg.health.error || '').slice(0, 80)}
              </span>
            ) : null}
            {cfg?.health?.at ? (
              <span className={styles.statusAt}>探测于 {fmtHealthAt(cfg.health.at)}</span>
            ) : null}
          </div>
        </div>

        {loading && !cfg ? (
          <div className={styles.muted}>加载配置…</div>
        ) : (
          <>
            <ul className={styles.profileList}>
              {(cfg?.profiles || []).map((p) => (
                <li
                  key={p.id}
                  className={`${styles.profileRow} ${p.active ? styles.profileActive : ''}`}
                >
                  <button
                    type="button"
                    className={styles.profileMain}
                    onClick={() => void activate(p.id)}
                    title="点击设为使用中"
                  >
                    <span className={styles.badge}>
                      {p.provider === 'deepseek' ? 'DeepSeek' : '兼容'}
                    </span>
                    <span className={styles.profileBody}>
                      <span className={styles.profileName}>{p.name}</span>
                      <span className={styles.profileMeta}>
                        {p.model}
                        {p.api_key_masked ? ` · ${p.api_key_masked}` : ''}
                      </span>
                    </span>
                    {p.active ? (
                      <span className={styles.usingTag}>
                        <Check size={12} /> 使用中
                      </span>
                    ) : null}
                  </button>
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="编辑"
                      onClick={() => {
                        setDraft(draftFromProfile(p));
                        setTestMsg(null);
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="删除"
                      disabled={Boolean(p.active)}
                      onClick={() => void remove(p.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {!cfg?.profiles?.length ? (
              <div className={styles.empty}>
                <p>还没有 AI 配置。可添加 DeepSeek，或任意 OpenAI 兼容端点。</p>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => {
                    setDraft(emptyDraft('deepseek'));
                    setTestMsg(null);
                  }}
                >
                  <Plus size={14} /> 添加 DeepSeek 预设
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={styles.addBtn}
                onClick={() => {
                  setDraft(emptyDraft('deepseek'));
                  setTestMsg(null);
                }}
              >
                <Plus size={14} /> 添加配置
              </button>
            )}

            {draft ? (
              <div className={styles.editor}>
                <div className={styles.editorTitle}>
                  {draft.id ? '编辑配置' : '新建配置'}
                </div>

                <div className={styles.seg}>
                  <button
                    type="button"
                    className={
                      draft.provider === 'deepseek' ? styles.segActive : styles.segBtn
                    }
                    onClick={() =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              provider: 'deepseek',
                              base_url: d.base_url || DEFAULT_DEEPSEEK_URL,
                              model: d.model || 'deepseek-flash',
                            }
                          : d
                      )
                    }
                  >
                    DeepSeek
                  </button>
                  <button
                    type="button"
                    className={
                      draft.provider === 'openai_compat'
                        ? styles.segActive
                        : styles.segBtn
                    }
                    onClick={() =>
                      setDraft((d) => (d ? { ...d, provider: 'openai_compat' } : d))
                    }
                  >
                    OpenAI 兼容
                  </button>
                </div>

                <label className={styles.field}>
                  <span>显示名称</span>
                  <input
                    className={styles.input}
                    value={draft.name}
                    placeholder="可选，默认用平台 + 模型"
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, name: e.target.value } : d))
                    }
                  />
                </label>

                <label className={styles.field}>
                  <span>Base URL</span>
                  <input
                    className={styles.input}
                    value={draft.base_url}
                    placeholder={
                      draft.provider === 'deepseek'
                        ? DEFAULT_DEEPSEEK_URL
                        : 'https://api.siliconflow.cn/v1'
                    }
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, base_url: e.target.value } : d))
                    }
                  />
                </label>

                <label className={styles.field}>
                  <span>模型</span>
                  {draft.provider === 'deepseek' ? (
                    <div className={styles.modelRow}>
                      <select
                        className={styles.input}
                        value={
                          DEEPSEEK_MODELS.includes(draft.model)
                            ? draft.model
                            : '__custom__'
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  model: v === '__custom__' ? '' : v,
                                }
                              : d
                          );
                        }}
                      >
                        {DEEPSEEK_MODELS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                        <option value="__custom__">自定义…</option>
                      </select>
                      {!DEEPSEEK_MODELS.includes(draft.model) ? (
                        <input
                          className={styles.input}
                          value={draft.model}
                          placeholder="模型名"
                          onChange={(e) =>
                            setDraft((d) => (d ? { ...d, model: e.target.value } : d))
                          }
                        />
                      ) : null}
                    </div>
                  ) : (
                    <input
                      className={styles.input}
                      value={draft.model}
                      placeholder="如 Qwen/Qwen2.5-7B-Instruct"
                      onChange={(e) =>
                        setDraft((d) => (d ? { ...d, model: e.target.value } : d))
                      }
                    />
                  )}
                </label>

                <label className={styles.field}>
                  <span>API Key</span>
                  {draft.id && !draft.replaceKey ? (
                    <div className={styles.keyRow}>
                      <span className={styles.keyMask}>
                        {cfg?.profiles.find((x) => x.id === draft.id)?.api_key_masked ||
                          '****'}
                      </span>
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={() =>
                          setDraft((d) =>
                            d ? { ...d, replaceKey: true, api_key: '' } : d
                          )
                        }
                      >
                        更换
                      </button>
                    </div>
                  ) : (
                    <input
                      className={styles.input}
                      type="password"
                      autoComplete="off"
                      value={draft.api_key}
                      placeholder="sk-…"
                      onChange={(e) =>
                        setDraft((d) => (d ? { ...d, api_key: e.target.value } : d))
                      }
                    />
                  )}
                </label>

                <button
                  type="button"
                  className={styles.advancedToggle}
                  onClick={() =>
                    setDraft((d) => (d ? { ...d, showAdvanced: !d.showAdvanced } : d))
                  }
                >
                  {draft.showAdvanced ? '收起高级' : '高级选项'}
                </button>
                {draft.showAdvanced ? (
                  <div className={styles.advancedGrid}>
                    <label className={styles.field}>
                      <span>max_tokens</span>
                      <input
                        className={styles.input}
                        inputMode="numeric"
                        value={draft.max_tokens}
                        placeholder="默认"
                        onChange={(e) =>
                          setDraft((d) =>
                            d ? { ...d, max_tokens: e.target.value } : d
                          )
                        }
                      />
                    </label>
                    <label className={styles.field}>
                      <span>超时（秒）</span>
                      <input
                        className={styles.input}
                        inputMode="decimal"
                        value={draft.timeout_sec}
                        placeholder="180"
                        onChange={(e) =>
                          setDraft((d) =>
                            d ? { ...d, timeout_sec: e.target.value } : d
                          )
                        }
                      />
                    </label>
                  </div>
                ) : null}

                {testMsg ? (
                  <div
                    className={
                      testMsg.startsWith('连通成功')
                        ? styles.testOk
                        : styles.testFail
                    }
                  >
                    {testMsg}
                  </div>
                ) : null}

                <div className={styles.editorActions}>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    disabled={saving}
                    onClick={() => void save()}
                  >
                    {saving ? <Loader2 size={14} className={styles.spin} /> : null}
                    保存
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    disabled={testing}
                    onClick={() => void testConn()}
                  >
                    {testing ? (
                      <Loader2 size={14} className={styles.spin} />
                    ) : (
                      <Zap size={14} />
                    )}
                    测试连通
                  </button>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => {
                      setDraft(null);
                      setTestMsg(null);
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
