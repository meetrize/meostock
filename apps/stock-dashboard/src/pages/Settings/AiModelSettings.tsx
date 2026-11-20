/**
 * 设置页：AI 平台 + 下属模型（可合并配置 / 拉取多选）
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Zap,
} from 'lucide-react';
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
  platform_id?: string | null;
  platform_name?: string | null;
  has_api_key: boolean;
  api_key_masked: string;
  max_tokens?: number | null;
  timeout_sec?: number | null;
  active?: boolean;
};

type AiPlatform = {
  id: string;
  name: string;
  provider: ProviderKind | string;
  base_url: string;
  has_api_key: boolean;
  api_key_masked: string;
  models?: AiProfile[];
  model_count?: number;
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
  platforms: AiPlatform[];
  standalone: AiProfile[];
  hint?: string | null;
};

type PlatformDraft = {
  id: string | null;
  name: string;
  provider: ProviderKind;
  base_url: string;
  api_key: string;
  replaceKey: boolean;
  withFirstModel: boolean;
  model: string;
  activate: boolean;
};

type ModelDraft = {
  platformId: string | null;
  id: string | null;
  name: string;
  model: string;
  /** 独立档案编辑时用 */
  provider: ProviderKind;
  base_url: string;
  api_key: string;
  replaceKey: boolean;
  max_tokens: string;
  timeout_sec: string;
  showAdvanced: boolean;
  standalone: boolean;
};

type DiscoverModel = {
  id: string;
  owned_by?: string;
  already_added?: boolean;
};

type DiscoverState = {
  platformId: string;
  platformName: string;
  loading: boolean;
  error: string | null;
  source: string;
  models: DiscoverModel[];
  selected: Set<string>;
  filter: string;
  saving: boolean;
};

const DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-flash', 'deepseek-reasoner'];
const DEFAULT_DEEPSEEK_URL = 'https://api.deepseek.com';

function emptyPlatformDraft(provider: ProviderKind = 'deepseek'): PlatformDraft {
  return {
    id: null,
    name: '',
    provider,
    base_url: provider === 'deepseek' ? DEFAULT_DEEPSEEK_URL : '',
    api_key: '',
    replaceKey: true,
    withFirstModel: true,
    model: provider === 'deepseek' ? 'deepseek-flash' : '',
    activate: true,
  };
}

function emptyModelDraft(platformId: string | null, standalone = false): ModelDraft {
  return {
    platformId,
    id: null,
    name: '',
    model: '',
    provider: 'deepseek',
    base_url: standalone ? '' : '',
    api_key: '',
    replaceKey: true,
    max_tokens: '',
    timeout_sec: '',
    showAdvanced: false,
    standalone,
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
  const [testing, setTesting] = useState<string | null>(null);
  const [cfg, setCfg] = useState<AiConfigState | null>(null);
  const [platformDraft, setPlatformDraft] = useState<PlatformDraft | null>(null);
  const [modelDraft, setModelDraft] = useState<ModelDraft | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [discover, setDiscover] = useState<DiscoverState | null>(null);
  /** platformId → 余额展示 */
  const [balances, setBalances] = useState<
    Record<string, { loading: boolean; display: string | null; error: string | null }>
  >({});

  const applyPayload = (data: Record<string, unknown>) => {
    const profiles = Array.isArray(data.profiles) ? (data.profiles as AiProfile[]) : [];
    const platforms = Array.isArray(data.platforms)
      ? (data.platforms as AiPlatform[])
      : [];
    const standalone = Array.isArray(data.standalone)
      ? (data.standalone as AiProfile[])
      : profiles.filter((p) => !p.platform_id);
    setCfg({
      configured: Boolean(data.configured),
      active: (data.active as AiProfile) || null,
      provider: (data.provider as string) || null,
      model: (data.model as string) || null,
      base_url: (data.base_url as string) || null,
      health: (data.health as AiHealth) || null,
      profiles,
      platforms,
      standalone,
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

  const fetchBalance = useCallback(async (platformId: string) => {
    setBalances((prev) => ({
      ...prev,
      [platformId]: {
        loading: true,
        display: prev[platformId]?.display ?? null,
        error: null,
      },
    }));
    try {
      const res = await fetch(`/api/ai/platforms/${platformId}/balance`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || '余额查询失败');
      }
      setBalances((prev) => ({
        ...prev,
        [platformId]: {
          loading: false,
          display: String(data.display || '—'),
          error: null,
        },
      }));
    } catch (e) {
      setBalances((prev) => ({
        ...prev,
        [platformId]: {
          loading: false,
          display: prev[platformId]?.display ?? null,
          error: e instanceof Error ? e.message : String(e),
        },
      }));
    }
  }, []);

  useEffect(() => {
    if (!cfg?.platforms?.length) return;
    for (const plat of cfg.platforms) {
      if (plat.provider === 'deepseek' && plat.has_api_key) {
        void fetchBalance(plat.id);
      }
    }
  }, [cfg?.platforms, fetchBalance]);

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

  const removeProfile = async (id: string) => {
    if (!window.confirm('确定删除该模型？')) return;
    try {
      const res = await fetch(`/api/ai/profiles/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || '删除失败');
      }
      applyPayload(data);
      if (modelDraft?.id === id) setModelDraft(null);
      toast.success('已删除');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const removePlatform = async (id: string) => {
    if (!window.confirm('确定删除该平台？')) return;
    try {
      const res = await fetch(`/api/ai/platforms/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || '删除失败');
      }
      applyPayload(data);
      if (platformDraft?.id === id) setPlatformDraft(null);
      toast.success('已删除平台');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const attachStandalone = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/profiles/${id}/attach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || '归入失败');
      }
      applyPayload(data);
      toast.success('已归入平台');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const savePlatform = async () => {
    if (!platformDraft) return;
    setSaving(true);
    setTestMsg(null);
    try {
      if (platformDraft.id) {
        const body: Record<string, unknown> = {
          name: platformDraft.name.trim() || undefined,
          provider: platformDraft.provider,
          base_url: platformDraft.base_url.trim(),
        };
        if (platformDraft.replaceKey && platformDraft.api_key.trim()) {
          body.api_key = platformDraft.api_key.trim();
        }
        const res = await fetch(`/api/ai/platforms/${platformDraft.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.error || '保存失败');
        applyPayload(data);
        setPlatformDraft(null);
        toast.success('平台已保存');
      } else {
        if (!platformDraft.api_key.trim()) throw new Error('请填写 API Key');
        const body: Record<string, unknown> = {
          name: platformDraft.name.trim() || undefined,
          provider: platformDraft.provider,
          base_url: platformDraft.base_url.trim(),
          api_key: platformDraft.api_key.trim(),
          activate: platformDraft.activate,
        };
        if (platformDraft.withFirstModel) {
          const m = platformDraft.model.trim();
          if (!m) throw new Error('请填写首个模型名');
          body.model = m;
        }
        const res = await fetch('/api/ai/platforms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.error || '创建失败');
        applyPayload(data);
        setPlatformDraft(null);
        toast.success(
          platformDraft.withFirstModel ? '已添加平台与模型' : '已添加平台'
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const saveModel = async () => {
    if (!modelDraft) return;
    setSaving(true);
    setTestMsg(null);
    try {
      if (modelDraft.id) {
        const body: Record<string, unknown> = {
          name: modelDraft.name.trim() || undefined,
          model: modelDraft.model.trim(),
        };
        if (modelDraft.standalone) {
          body.provider = modelDraft.provider;
          body.base_url = modelDraft.base_url.trim();
          if (modelDraft.replaceKey && modelDraft.api_key.trim()) {
            body.api_key = modelDraft.api_key.trim();
          }
        }
        if (!modelDraft.max_tokens) body.clear_max_tokens = true;
        else body.max_tokens = Number(modelDraft.max_tokens);
        if (!modelDraft.timeout_sec) body.clear_timeout_sec = true;
        else body.timeout_sec = Number(modelDraft.timeout_sec);
        const res = await fetch(`/api/ai/profiles/${modelDraft.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.error || '保存失败');
        applyPayload(data);
        setModelDraft(null);
        toast.success('已保存');
      } else if (modelDraft.platformId) {
        const body = {
          platform_id: modelDraft.platformId,
          name: modelDraft.name.trim() || undefined,
          model: modelDraft.model.trim(),
          max_tokens: modelDraft.max_tokens ? Number(modelDraft.max_tokens) : undefined,
          timeout_sec: modelDraft.timeout_sec
            ? Number(modelDraft.timeout_sec)
            : undefined,
          activate: !(cfg?.profiles?.length),
        };
        if (!body.model) throw new Error('请填写模型名');
        const res = await fetch('/api/ai/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.error || '创建失败');
        applyPayload(data);
        setModelDraft(null);
        toast.success('已添加模型');
      } else {
        // 独立新建
        if (!modelDraft.api_key.trim()) throw new Error('请填写 API Key');
        if (!modelDraft.base_url.trim()) throw new Error('请填写 Base URL');
        if (!modelDraft.model.trim()) throw new Error('请填写模型名');
        const res = await fetch('/api/ai/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: modelDraft.name.trim() || undefined,
            provider: modelDraft.provider,
            base_url: modelDraft.base_url.trim(),
            model: modelDraft.model.trim(),
            api_key: modelDraft.api_key.trim(),
            max_tokens: modelDraft.max_tokens
              ? Number(modelDraft.max_tokens)
              : undefined,
            timeout_sec: modelDraft.timeout_sec
              ? Number(modelDraft.timeout_sec)
              : undefined,
            activate: !(cfg?.profiles?.length),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.error || '创建失败');
        applyPayload(data);
        setModelDraft(null);
        toast.success('已添加独立配置');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const testConn = async (opts?: {
    platformId?: string;
    profileId?: string;
    draftPlatform?: boolean;
  }) => {
    const key = opts?.platformId || opts?.profileId || 'draft';
    setTesting(key);
    setTestMsg(null);
    try {
      const body: Record<string, unknown> = {};
      if (opts?.platformId) body.platform_id = opts.platformId;
      if (opts?.profileId) body.profile_id = opts.profileId;
      if (opts?.draftPlatform && platformDraft) {
        body.provider = platformDraft.provider;
        body.base_url = platformDraft.base_url.trim();
        body.model = platformDraft.model.trim() || 'deepseek-chat';
        if (platformDraft.replaceKey && platformDraft.api_key.trim()) {
          body.api_key = platformDraft.api_key.trim();
        } else if (platformDraft.id) {
          body.platform_id = platformDraft.id;
        }
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
      setTesting(null);
    }
  };

  const openDiscover = async (plat: AiPlatform) => {
    setDiscover({
      platformId: plat.id,
      platformName: plat.name,
      loading: true,
      error: null,
      source: '',
      models: [],
      selected: new Set(),
      filter: '',
      saving: false,
    });
    try {
      const res = await fetch(`/api/ai/platforms/${plat.id}/models/discover`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !data?.models?.length) {
        throw new Error(data?.error || '拉取失败');
      }
      const models = (Array.isArray(data.models) ? data.models : []) as DiscoverModel[];
      setDiscover((d) =>
        d
          ? {
              ...d,
              loading: false,
              error: data.ok === false ? String(data.error || '拉取失败') : null,
              source: String(data.source || ''),
              models,
              selected: new Set(),
            }
          : d
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDiscover((d) =>
        d ? { ...d, loading: false, error: msg, models: [], selected: new Set() } : d
      );
    }
  };

  const confirmDiscover = async () => {
    if (!discover || discover.selected.size === 0) return;
    setDiscover((d) => (d ? { ...d, saving: true } : d));
    try {
      const res = await fetch('/api/ai/profiles/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform_id: discover.platformId,
          models: Array.from(discover.selected),
          activate_first: !(cfg?.profiles?.length),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || '添加失败');
      applyPayload(data);
      toast.success(`已添加 ${data.count ?? discover.selected.size} 个模型`);
      setDiscover(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setDiscover((d) => (d ? { ...d, saving: false } : d));
    }
  };

  const filteredDiscover = useMemo(() => {
    if (!discover) return [];
    const q = discover.filter.trim().toLowerCase();
    if (!q) return discover.models;
    return discover.models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        (m.owned_by || '').toLowerCase().includes(q)
    );
  }, [discover]);

  const statusLine = (() => {
    if (loading && !cfg) return '加载中…';
    if (!cfg?.configured || !cfg.active) return '未配置';
    const h = cfg.health;
    const conn =
      h?.ok === true ? '已连通' : h?.ok === false ? '上次探测失败' : '尚未探测';
    return `当前：${providerLabel(cfg.provider)} · ${cfg.model || '—'} · ${conn}`;
  })();

  const renderModelRow = (p: AiProfile, opts?: { standalone?: boolean }) => (
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
        <span className={styles.profileBody}>
          <span className={styles.profileName}>{p.model}</span>
          <span className={styles.profileMeta}>
            {p.name && p.name !== p.model ? p.name : providerLabel(p.provider)}
            {opts?.standalone && p.api_key_masked ? ` · ${p.api_key_masked}` : ''}
          </span>
        </span>
        {p.active ? (
          <span className={styles.usingTag}>
            <Check size={12} /> 使用中
          </span>
        ) : null}
      </button>
      <div className={styles.rowActions}>
        {opts?.standalone ? (
          <button
            type="button"
            className={styles.iconBtn}
            title="归入平台"
            onClick={() => void attachStandalone(p.id)}
          >
            <Link2 size={14} />
          </button>
        ) : null}
        <button
          type="button"
          className={styles.iconBtn}
          title="编辑"
          onClick={() => {
            setPlatformDraft(null);
            setDiscover(null);
            setModelDraft({
              platformId: p.platform_id || null,
              id: p.id,
              name: p.name || '',
              model: p.model || '',
              provider: p.provider === 'deepseek' ? 'deepseek' : 'openai_compat',
              base_url: p.base_url || '',
              api_key: '',
              replaceKey: false,
              max_tokens: p.max_tokens != null ? String(p.max_tokens) : '',
              timeout_sec: p.timeout_sec != null ? String(p.timeout_sec) : '',
              showAdvanced: Boolean(p.max_tokens || p.timeout_sec),
              standalone: !p.platform_id,
            });
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
          onClick={() => void removeProfile(p.id)}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );

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
            {(cfg?.platforms || []).map((plat) => (
              <div key={plat.id} className={styles.platformCard}>
                <div className={styles.platformHead}>
                  <div className={styles.platformHeadMain}>
                    <span className={styles.badge}>
                      {plat.provider === 'deepseek' ? 'DeepSeek' : '兼容'}
                    </span>
                    <div className={styles.profileBody}>
                      <span className={styles.profileName}>{plat.name}</span>
                      <span className={styles.profileMeta}>
                        {plat.base_url}
                        {plat.api_key_masked ? ` · ${plat.api_key_masked}` : ''}
                      </span>
                    </div>
                    {plat.provider === 'deepseek' ? (
                      <button
                        type="button"
                        className={styles.balanceChip}
                        title={
                          balances[plat.id]?.error
                            ? `余额：${balances[plat.id].error}（点击重试）`
                            : 'DeepSeek 账户余额（点击刷新）'
                        }
                        disabled={balances[plat.id]?.loading}
                        onClick={() => void fetchBalance(plat.id)}
                      >
                        {balances[plat.id]?.loading ? (
                          <Loader2 size={12} className={styles.spin} />
                        ) : null}
                        <span>
                          {balances[plat.id]?.display
                            ? balances[plat.id].display
                            : balances[plat.id]?.error
                              ? '余额?'
                              : '余额'}
                        </span>
                      </button>
                    ) : null}
                  </div>
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="测试平台"
                      disabled={testing === plat.id}
                      onClick={() => void testConn({ platformId: plat.id })}
                    >
                      {testing === plat.id ? (
                        <Loader2 size={14} className={styles.spin} />
                      ) : (
                        <Zap size={14} />
                      )}
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="编辑平台"
                      onClick={() => {
                        setModelDraft(null);
                        setDiscover(null);
                        setPlatformDraft({
                          id: plat.id,
                          name: plat.name || '',
                          provider:
                            plat.provider === 'deepseek' ? 'deepseek' : 'openai_compat',
                          base_url: plat.base_url || '',
                          api_key: '',
                          replaceKey: false,
                          withFirstModel: false,
                          model: '',
                          activate: false,
                        });
                        setTestMsg(null);
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      title="删除平台"
                      disabled={(plat.models?.length || 0) > 0}
                      onClick={() => void removePlatform(plat.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <ul className={styles.profileList}>
                  {(plat.models || []).map((m) => renderModelRow(m))}
                  {!plat.models?.length ? (
                    <li className={styles.emptyModels}>该平台还没有模型</li>
                  ) : null}
                </ul>

                <div className={styles.platformActions}>
                  <button
                    type="button"
                    className={styles.addBtn}
                    onClick={() => {
                      setPlatformDraft(null);
                      setDiscover(null);
                      setModelDraft(emptyModelDraft(plat.id));
                      setTestMsg(null);
                    }}
                  >
                    <Plus size={14} /> 添加模型
                  </button>
                  <button
                    type="button"
                    className={styles.addBtn}
                    onClick={() => void openDiscover(plat)}
                  >
                    <RefreshCw size={14} /> 从平台拉取
                  </button>
                </div>
              </div>
            ))}

            {(cfg?.standalone || []).length > 0 ? (
              <div className={styles.standaloneBlock}>
                <div className={styles.standaloneTitle}>独立配置（未归入平台）</div>
                <ul className={styles.profileList}>
                  {cfg!.standalone.map((p) => renderModelRow(p, { standalone: true }))}
                </ul>
              </div>
            ) : null}

            {!cfg?.platforms?.length && !cfg?.standalone?.length ? (
              <div className={styles.empty}>
                <p>
                  还没有 AI 配置。可添加平台（一套 URL + Key），再挂多个模型；也可一次同时加首个模型。
                </p>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => {
                    setModelDraft(null);
                    setDiscover(null);
                    setPlatformDraft(emptyPlatformDraft('deepseek'));
                    setTestMsg(null);
                  }}
                >
                  <Plus size={14} /> 添加平台（可同时加首个模型）
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={styles.addBtn}
                onClick={() => {
                  setModelDraft(null);
                  setDiscover(null);
                  setPlatformDraft(
                    emptyPlatformDraft(
                      !(cfg?.profiles?.length) ? 'deepseek' : 'openai_compat'
                    )
                  );
                  setTestMsg(null);
                }}
              >
                <Plus size={14} /> 添加平台
              </button>
            )}

            {platformDraft ? (
              <div className={styles.editor}>
                <div className={styles.editorTitle}>
                  {platformDraft.id ? '编辑平台' : '新建平台'}
                </div>
                <div className={styles.seg}>
                  <button
                    type="button"
                    className={
                      platformDraft.provider === 'deepseek'
                        ? styles.segActive
                        : styles.segBtn
                    }
                    onClick={() =>
                      setPlatformDraft((d) =>
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
                      platformDraft.provider === 'openai_compat'
                        ? styles.segActive
                        : styles.segBtn
                    }
                    onClick={() =>
                      setPlatformDraft((d) =>
                        d ? { ...d, provider: 'openai_compat' } : d
                      )
                    }
                  >
                    OpenAI 兼容
                  </button>
                </div>

                <label className={styles.field}>
                  <span>显示名称</span>
                  <input
                    className={styles.input}
                    value={platformDraft.name}
                    placeholder="可选，默认用平台名"
                    onChange={(e) =>
                      setPlatformDraft((d) =>
                        d ? { ...d, name: e.target.value } : d
                      )
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>Base URL</span>
                  <input
                    className={styles.input}
                    value={platformDraft.base_url}
                    placeholder={
                      platformDraft.provider === 'deepseek'
                        ? DEFAULT_DEEPSEEK_URL
                        : 'https://api.siliconflow.cn/v1'
                    }
                    onChange={(e) =>
                      setPlatformDraft((d) =>
                        d ? { ...d, base_url: e.target.value } : d
                      )
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>API Key</span>
                  {platformDraft.id && !platformDraft.replaceKey ? (
                    <div className={styles.keyRow}>
                      <span className={styles.keyMask}>
                        {cfg?.platforms.find((x) => x.id === platformDraft.id)
                          ?.api_key_masked || '****'}
                      </span>
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={() =>
                          setPlatformDraft((d) =>
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
                      value={platformDraft.api_key}
                      placeholder="sk-…"
                      onChange={(e) =>
                        setPlatformDraft((d) =>
                          d ? { ...d, api_key: e.target.value } : d
                        )
                      }
                    />
                  )}
                </label>

                {!platformDraft.id ? (
                  <>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={platformDraft.withFirstModel}
                        onChange={(e) =>
                          setPlatformDraft((d) =>
                            d ? { ...d, withFirstModel: e.target.checked } : d
                          )
                        }
                      />
                      <span>同时添加首个模型（合并配置）</span>
                    </label>
                    {platformDraft.withFirstModel ? (
                      <label className={styles.field}>
                        <span>模型</span>
                        {platformDraft.provider === 'deepseek' ? (
                          <div className={styles.modelRow}>
                            <select
                              className={styles.input}
                              value={
                                DEEPSEEK_MODELS.includes(platformDraft.model)
                                  ? platformDraft.model
                                  : '__custom__'
                              }
                              onChange={(e) => {
                                const v = e.target.value;
                                setPlatformDraft((d) =>
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
                            {!DEEPSEEK_MODELS.includes(platformDraft.model) ? (
                              <input
                                className={styles.input}
                                value={platformDraft.model}
                                placeholder="模型名"
                                onChange={(e) =>
                                  setPlatformDraft((d) =>
                                    d ? { ...d, model: e.target.value } : d
                                  )
                                }
                              />
                            ) : null}
                          </div>
                        ) : (
                          <input
                            className={styles.input}
                            value={platformDraft.model}
                            placeholder="如 Qwen/Qwen2.5-7B-Instruct"
                            onChange={(e) =>
                              setPlatformDraft((d) =>
                                d ? { ...d, model: e.target.value } : d
                              )
                            }
                          />
                        )}
                      </label>
                    ) : null}
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={platformDraft.activate}
                        disabled={!platformDraft.withFirstModel}
                        onChange={(e) =>
                          setPlatformDraft((d) =>
                            d ? { ...d, activate: e.target.checked } : d
                          )
                        }
                      />
                      <span>保存后设为使用中</span>
                    </label>
                  </>
                ) : null}

                {testMsg ? (
                  <div
                    className={
                      testMsg.startsWith('连通成功') ? styles.testOk : styles.testFail
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
                    onClick={() => void savePlatform()}
                  >
                    {saving ? <Loader2 size={14} className={styles.spin} /> : null}
                    保存
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    disabled={Boolean(testing)}
                    onClick={() => void testConn({ draftPlatform: true })}
                  >
                    {testing === 'draft' ? (
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
                      setPlatformDraft(null);
                      setTestMsg(null);
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}

            {modelDraft ? (
              <div className={styles.editor}>
                <div className={styles.editorTitle}>
                  {modelDraft.id
                    ? modelDraft.standalone
                      ? '编辑独立配置'
                      : '编辑模型'
                    : modelDraft.platformId
                      ? '添加模型'
                      : '新建独立配置'}
                </div>

                {modelDraft.standalone || !modelDraft.platformId ? (
                  <>
                    <div className={styles.seg}>
                      <button
                        type="button"
                        className={
                          modelDraft.provider === 'deepseek'
                            ? styles.segActive
                            : styles.segBtn
                        }
                        onClick={() =>
                          setModelDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  provider: 'deepseek',
                                  base_url: d.base_url || DEFAULT_DEEPSEEK_URL,
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
                          modelDraft.provider === 'openai_compat'
                            ? styles.segActive
                            : styles.segBtn
                        }
                        onClick={() =>
                          setModelDraft((d) =>
                            d ? { ...d, provider: 'openai_compat' } : d
                          )
                        }
                      >
                        OpenAI 兼容
                      </button>
                    </div>
                    <label className={styles.field}>
                      <span>Base URL</span>
                      <input
                        className={styles.input}
                        value={modelDraft.base_url}
                        onChange={(e) =>
                          setModelDraft((d) =>
                            d ? { ...d, base_url: e.target.value } : d
                          )
                        }
                      />
                    </label>
                    <label className={styles.field}>
                      <span>API Key</span>
                      {modelDraft.id && !modelDraft.replaceKey ? (
                        <div className={styles.keyRow}>
                          <span className={styles.keyMask}>
                            {cfg?.profiles.find((x) => x.id === modelDraft.id)
                              ?.api_key_masked || '****'}
                          </span>
                          <button
                            type="button"
                            className={styles.secondaryBtn}
                            onClick={() =>
                              setModelDraft((d) =>
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
                          value={modelDraft.api_key}
                          placeholder="sk-…"
                          onChange={(e) =>
                            setModelDraft((d) =>
                              d ? { ...d, api_key: e.target.value } : d
                            )
                          }
                        />
                      )}
                    </label>
                  </>
                ) : null}

                <label className={styles.field}>
                  <span>显示名称</span>
                  <input
                    className={styles.input}
                    value={modelDraft.name}
                    placeholder="可选"
                    onChange={(e) =>
                      setModelDraft((d) => (d ? { ...d, name: e.target.value } : d))
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>模型</span>
                  <input
                    className={styles.input}
                    value={modelDraft.model}
                    placeholder="模型名"
                    onChange={(e) =>
                      setModelDraft((d) => (d ? { ...d, model: e.target.value } : d))
                    }
                  />
                </label>

                <button
                  type="button"
                  className={styles.advancedToggle}
                  onClick={() =>
                    setModelDraft((d) =>
                      d ? { ...d, showAdvanced: !d.showAdvanced } : d
                    )
                  }
                >
                  {modelDraft.showAdvanced ? '收起高级' : '高级选项'}
                </button>
                {modelDraft.showAdvanced ? (
                  <div className={styles.advancedGrid}>
                    <label className={styles.field}>
                      <span>max_tokens</span>
                      <input
                        className={styles.input}
                        inputMode="numeric"
                        value={modelDraft.max_tokens}
                        placeholder="默认"
                        onChange={(e) =>
                          setModelDraft((d) =>
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
                        value={modelDraft.timeout_sec}
                        placeholder="180"
                        onChange={(e) =>
                          setModelDraft((d) =>
                            d ? { ...d, timeout_sec: e.target.value } : d
                          )
                        }
                      />
                    </label>
                  </div>
                ) : null}

                <div className={styles.editorActions}>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    disabled={saving}
                    onClick={() => void saveModel()}
                  >
                    {saving ? <Loader2 size={14} className={styles.spin} /> : null}
                    保存
                  </button>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => {
                      setModelDraft(null);
                      setTestMsg(null);
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}

            {discover ? (
              <div className={styles.discoverPanel}>
                <div className={styles.editorTitle}>
                  从「{discover.platformName}」拉取模型
                </div>
                {discover.loading ? (
                  <div className={styles.muted}>
                    <Loader2 size={14} className={styles.spin} /> 正在查询平台模型列表…
                  </div>
                ) : (
                  <>
                    {discover.error ? (
                      <div className={styles.testFail}>
                        {discover.error}
                        {discover.source === 'preset'
                          ? '（已显示本地预设，可勾选添加）'
                          : ''}
                      </div>
                    ) : (
                      <div className={styles.muted}>
                        来源：{discover.source === 'remote' ? '上游 /models' : discover.source}
                        · 共 {discover.models.length} 个
                      </div>
                    )}
                    <input
                      className={styles.input}
                      placeholder="搜索模型…"
                      value={discover.filter}
                      onChange={(e) =>
                        setDiscover((d) =>
                          d ? { ...d, filter: e.target.value } : d
                        )
                      }
                    />
                    <div className={styles.discoverToolbar}>
                      <button
                        type="button"
                        className={styles.ghostBtn}
                        onClick={() => {
                          const next = new Set(discover.selected);
                          for (const m of filteredDiscover) {
                            if (!m.already_added) next.add(m.id);
                          }
                          setDiscover((d) => (d ? { ...d, selected: next } : d));
                        }}
                      >
                        全选当前
                      </button>
                      <button
                        type="button"
                        className={styles.ghostBtn}
                        onClick={() =>
                          setDiscover((d) =>
                            d ? { ...d, selected: new Set() } : d
                          )
                        }
                      >
                        清除
                      </button>
                    </div>
                    <ul className={styles.discoverList}>
                      {filteredDiscover.map((m) => {
                        const disabled = Boolean(m.already_added);
                        const checked = disabled || discover.selected.has(m.id);
                        return (
                          <li key={m.id} className={styles.discoverItem}>
                            <label
                              className={`${styles.checkRow} ${
                                disabled ? styles.discoverDisabled : ''
                              }`}
                            >
                              <input
                                type="checkbox"
                                disabled={disabled}
                                checked={checked}
                                onChange={(e) => {
                                  const next = new Set(discover.selected);
                                  if (e.target.checked) next.add(m.id);
                                  else next.delete(m.id);
                                  setDiscover((d) =>
                                    d ? { ...d, selected: next } : d
                                  );
                                }}
                              />
                              <span className={styles.discoverId}>{m.id}</span>
                              {m.owned_by ? (
                                <span className={styles.discoverOwned}>{m.owned_by}</span>
                              ) : null}
                              {disabled ? (
                                <span className={styles.addedTag}>已添加</span>
                              ) : null}
                            </label>
                          </li>
                        );
                      })}
                      {!filteredDiscover.length ? (
                        <li className={styles.muted}>没有匹配的模型</li>
                      ) : null}
                    </ul>
                    <div className={styles.editorActions}>
                      <button
                        type="button"
                        className={styles.primaryBtn}
                        disabled={discover.saving || discover.selected.size === 0}
                        onClick={() => void confirmDiscover()}
                      >
                        {discover.saving ? (
                          <Loader2 size={14} className={styles.spin} />
                        ) : null}
                        添加所选（{discover.selected.size}）
                      </button>
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={() => {
                          setDiscover(null);
                          setModelDraft(emptyModelDraft(discover.platformId));
                        }}
                      >
                        手动添加
                      </button>
                      <button
                        type="button"
                        className={styles.ghostBtn}
                        onClick={() => setDiscover(null)}
                      >
                        取消
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
