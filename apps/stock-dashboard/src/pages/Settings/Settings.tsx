/**
 * 设置页面
 */

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Palette, BarChart2, Info, Database, Layers, User } from 'lucide-react';
import { Card, NumberField, useToast } from '@/components/common';
import { useAppSettings } from '@/contexts';
import { useAuth } from '@/contexts/AuthProvider';
import { AuthModal } from '@/components/auth/AuthModal';
import type { QuoteCacheMode, QuoteSource } from '@/types';
import { syncQuoteSourceToServer } from '@/services/quoteCache';
import { AiModelSettings } from './AiModelSettings';
import { SourceLaneMatrix } from './SourceLaneMatrix';
import styles from './Settings.module.css';

type KlineBulkProgress = {
  active?: boolean;
  total?: number;
  done?: number;
  ok?: number;
  skip?: number;
  fail?: number;
  message?: string;
  current?: string | null;
  min_bars?: number;
};

function parsePeriods(value: string, fallback: number[]) {
  const periods = value
    .split(/[，,\s]+/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);

  return periods.length > 0 ? periods : fallback;
}

function IndicatorNumberInput({
  value,
  min = 1,
  step,
  onChange,
}: {
  value: number;
  min?: number;
  step?: number | string;
  onChange: (value: number) => void;
}) {
  return (
    <NumberField
      className={styles.numberInput}
      value={value}
      min={min}
      step={step}
      onCommit={(v) => {
        if (v !== null) onChange(v);
      }}
    />
  );
}

async function syncCacheModeToServer(mode: QuoteCacheMode): Promise<void> {
  const res = await fetch('/api/cache/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || '同步缓存模式失败');
  }
}

export function Settings() {
  const toast = useToast();
  const { settings, updateSettings } = useAppSettings();
  const {
    user,
    lastSyncedAt,
    logout,
    changePassword,
    importLocal,
    config,
  } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const maPeriods = Array.isArray(settings.indicatorConfig?.ma)
    ? settings.indicatorConfig.ma
    : [5, 10, 20, 60];
  const rsiPeriods = Array.isArray(settings.indicatorConfig?.rsi)
    ? settings.indicatorConfig.rsi
    : [6, 12, 24];
  const cacheMode: QuoteCacheMode =
    settings.cacheMode === 'speed' ||
    settings.cacheMode === 'balanced' ||
    settings.cacheMode === 'realtime'
      ? settings.cacheMode
      : 'balanced';
  const quoteSource: QuoteSource =
    settings.quoteSource === 'local' ||
    settings.quoteSource === 'network' ||
    settings.quoteSource === 'auto'
      ? settings.quoteSource
      : 'auto';
  const [maDraft, setMaDraft] = useState(maPeriods.join(', '));
  const [rsiDraft, setRsiDraft] = useState(rsiPeriods.join(', '));
  const [klineBulk, setKlineBulk] = useState<KlineBulkProgress | null>(null);

  const refreshKlineBulk = useCallback(async () => {
    try {
      const res = await fetch('/api/cache/kline/bulk-sync/progress');
      const data = await res.json();
      if (data?.ok) {
        setKlineBulk({
          active: Boolean(data.active),
          total: Number(data.total) || 0,
          done: Number(data.done) || 0,
          ok: Number(data.ok_count ?? data.ok) || 0,
          skip: Number(data.skip_count ?? data.skip) || 0,
          fail: Number(data.fail_count ?? data.fail) || 0,
          message: String(data.message || ''),
          current: data.current ?? null,
          min_bars: Number(data.min_bars) || 120,
        });
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshKlineBulk();
  }, [refreshKlineBulk]);

  useEffect(() => {
    if (!klineBulk?.active) return;
    const id = window.setInterval(() => void refreshKlineBulk(), 1200);
    return () => window.clearInterval(id);
  }, [klineBulk?.active, refreshKlineBulk]);

  const setCacheMode = async (mode: QuoteCacheMode) => {
    updateSettings({ cacheMode: mode });
    try {
      await syncCacheModeToServer(mode);
      toast.success(
        mode === 'speed' ? '已切换极速模式' : mode === 'realtime' ? '已切换实时模式' : '已切换均衡模式'
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const setQuoteSource = async (source: QuoteSource) => {
    updateSettings({ quoteSource: source });
    try {
      await syncQuoteSourceToServer(source);
      toast.success(
        source === 'local'
          ? '已切换仅本地'
          : source === 'network'
            ? '已切换仅联网'
            : '已切换自动（优先缓存）'
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const updateIndicatorConfig = (
    updates: Partial<typeof settings.indicatorConfig>
  ) => {
    updateSettings({
      indicatorConfig: {
        ...settings.indicatorConfig,
        ...updates,
      },
    });
  };

  return (
    <div className={styles.settings}>
      <motion.h1
        className={styles.title}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        设置
      </motion.h1>

      <Card>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <User size={18} className={styles.sectionIcon} />
            <h3>账号与同步</h3>
          </div>
          <div className={styles.sectionContent}>
            {user ? (
              <>
                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>当前账号</span>
                    <span className={styles.settingDesc}>
                      {user.username}
                      {user.role === 'admin' ? '（管理员）' : ''}
                      {lastSyncedAt
                        ? ` · 最近同步 ${new Date(lastSyncedAt).toLocaleString()}`
                        : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.select}
                    onClick={() => {
                      void logout().then(() => toast.info('已退出'));
                    }}
                  >
                    退出
                  </button>
                </div>
                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>本机配置</span>
                    <span className={styles.settingDesc}>
                      将浏览器里的自选/设置导入当前账号，或用本机覆盖云端
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className={styles.select}
                      onClick={() => {
                        void importLocal('merge')
                          .then((r) =>
                            toast.success(`已导入（写入 ${r.written}，跳过 ${r.skipped}）`)
                          )
                          .catch((e) =>
                            toast.error(e instanceof Error ? e.message : '导入失败')
                          );
                      }}
                    >
                      导入本机
                    </button>
                    <button
                      type="button"
                      className={styles.select}
                      onClick={() => {
                        void importLocal('overwrite')
                          .then((r) => toast.success(`已覆盖云端（${r.written} 项）`))
                          .catch((e) =>
                            toast.error(e instanceof Error ? e.message : '覆盖失败')
                          );
                      }}
                    >
                      本机覆盖云端
                    </button>
                  </div>
                </div>
                <div className={styles.settingItem}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>修改密码</span>
                    <span className={styles.settingDesc}>改密后其他设备会话会被踢下线</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      className={styles.select}
                      type="password"
                      placeholder="原密码"
                      value={oldPw}
                      onChange={(e) => setOldPw(e.target.value)}
                      style={{ width: 120 }}
                    />
                    <input
                      className={styles.select}
                      type="password"
                      placeholder="新密码"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      style={{ width: 120 }}
                    />
                    <button
                      type="button"
                      className={styles.select}
                      onClick={() => {
                        void changePassword(oldPw, newPw).then((r) => {
                          if (!r.ok) {
                            toast.error(r.error);
                            return;
                          }
                          toast.success('密码已更新');
                          setOldPw('');
                          setNewPw('');
                        });
                      }}
                    >
                      保存
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className={styles.settingItem}>
                <div className={styles.settingInfo}>
                  <span className={styles.settingLabel}>游客模式</span>
                  <span className={styles.settingDesc}>
                    配置仅保存在本机浏览器
                    {config?.open_register === false ? '；开放注册已关闭' : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.select}
                  onClick={() => setAuthOpen(true)}
                >
                  登录 / 注册
                </button>
              </div>
            )}
          </div>
        </div>
      </Card>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />

      <Card>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <RefreshCw size={18} className={styles.sectionIcon} />
            <h3>刷新频率</h3>
          </div>
          <div className={styles.sectionContent}>
            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>列表 / 自选</span>
                <span className={styles.settingDesc}>总览、自选、扫描等列表数据刷新间隔</span>
              </div>
              <select
                className={styles.select}
                value={settings.refreshInterval.list}
                onChange={(e) =>
                  updateSettings({
                    refreshInterval: {
                      ...settings.refreshInterval,
                      list: Number(e.target.value),
                    },
                  })
                }
              >
                <option value={0}>默认</option>
                <option value={1000}>1秒</option>
                <option value={2000}>2秒</option>
                <option value={5000}>5秒</option>
                <option value={10000}>10秒</option>
                <option value={15000}>15秒</option>
                <option value={30000}>30秒</option>
              </select>
            </div>

            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>个股详情</span>
                <span className={styles.settingDesc}>详情页行情、分时、K 线相关刷新间隔</span>
              </div>
              <select
                className={styles.select}
                value={settings.refreshInterval.detail}
                onChange={(e) =>
                  updateSettings({
                    refreshInterval: {
                      ...settings.refreshInterval,
                      detail: Number(e.target.value),
                    },
                  })
                }
              >
                <option value={5000}>5秒</option>
                <option value={10000}>10秒</option>
                <option value={15000}>15秒</option>
                <option value={30000}>30秒</option>
              </select>
            </div>

            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>热力图</span>
                <span className={styles.settingDesc}>热力图个股数据刷新间隔</span>
              </div>
              <select
                className={styles.select}
                value={settings.refreshInterval.heatmap}
                onChange={(e) =>
                  updateSettings({
                    refreshInterval: {
                      ...settings.refreshInterval,
                      heatmap: Number(e.target.value),
                    },
                  })
                }
              >
                <option value={5000}>5秒</option>
                <option value={10000}>10秒</option>
                <option value={15000}>15秒</option>
                <option value={30000}>30秒</option>
              </select>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <AiModelSettings />
      </Card>

      <Card>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Database size={18} className={styles.sectionIcon} />
            <h3>行情本地缓存</h3>
          </div>
          <div className={styles.sectionContent}>
            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>缓存模式</span>
                <span className={styles.settingDesc}>
                  极速偏读盘；均衡先出缓存再后台同步；实时尽快打网。与上方「刷新频率」相互独立。
                </span>
              </div>
              <select
                className={styles.select}
                value={cacheMode}
                onChange={(e) => void setCacheMode(e.target.value as QuoteCacheMode)}
              >
                <option value="speed">极速</option>
                <option value="balanced">均衡（推荐）</option>
                <option value="realtime">实时</option>
              </select>
            </div>
            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>行情源</span>
                <span className={styles.settingDesc}>
                  自选 / 热力自选 / 总览：自动优先本机快照；仅本地不打网；仅联网走浏览器 sdk。
                </span>
              </div>
              <select
                className={styles.select}
                value={quoteSource}
                onChange={(e) => void setQuoteSource(e.target.value as QuoteSource)}
              >
                <option value="auto">自动（优先缓存）</option>
                <option value="local">仅本地</option>
                <option value="network">仅联网</option>
              </select>
            </div>
            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>立即同步 / 清空</span>
                <span className={styles.settingDesc}>对服务端 SQLite 缓存执行维护操作</span>
              </div>
              <div className={styles.colorModeOptions}>
                <button
                  type="button"
                  className={styles.colorModeBtn}
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/cache/sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ market: 'cn', force: true, background: true }),
                      });
                      const data = await res.json();
                      if (!data.ok) throw new Error(data.error || '同步失败');
                      toast.success(data.queued ? 'A股同步已排队（见顶栏）' : `A股已同步 ${data.row_count ?? ''} 条`);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  同步 A 股
                </button>
                <button
                  type="button"
                  className={styles.colorModeBtn}
                  disabled={Boolean(klineBulk?.active)}
                  title="A股：按代码表拉取约半年日K（≥120根）入库"
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/cache/kline/bulk-sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          market: 'cn',
                          period: '1d',
                          min_bars: 120,
                          force: false,
                          concurrency: 3,
                        }),
                      });
                      const data = await res.json();
                      if (!data.ok) throw new Error(data.error || '启动失败');
                      toast.success(data.message || '日K全量入库已开始');
                      void refreshKlineBulk();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  {klineBulk?.active ? '日K入库中…' : 'A股日K全量'}
                </button>
                <button
                  type="button"
                  className={styles.colorModeBtn}
                  disabled={Boolean(klineBulk?.active)}
                  title="美股精选池：宽基ETF+大盘+近期访问，约半年日K（非全市场约1.4万只）"
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/cache/kline/bulk-sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          market: 'us',
                          period: '1d',
                          min_bars: 120,
                          force: false,
                          concurrency: 2,
                        }),
                      });
                      const data = await res.json();
                      if (!data.ok) throw new Error(data.error || '启动失败');
                      toast.success(data.message || '美股精选日K入库已开始');
                      void refreshKlineBulk();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  美股精选日K
                </button>
                {klineBulk?.active ? (
                  <button
                    type="button"
                    className={styles.colorModeBtn}
                    onClick={async () => {
                      try {
                        const res = await fetch('/api/cache/kline/bulk-sync/cancel', {
                          method: 'POST',
                        });
                        const data = await res.json();
                        toast.info(data.message || '已请求取消');
                        void refreshKlineBulk();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    取消入库
                  </button>
                ) : null}
                <button
                  type="button"
                  className={styles.colorModeBtn}
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/cache/clear', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ market: null, what: 'snapshot' }),
                      });
                      const data = await res.json();
                      if (!data.ok) throw new Error(data.error || '清空失败');
                      toast.success('已清空全部行情快照');
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  清空快照
                </button>
                <button
                  type="button"
                  className={styles.colorModeBtn}
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/cache/gc', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ max_age_days: 90, max_series: 10000 }),
                      });
                      const data = await res.json();
                      if (!data.ok) throw new Error(data.error || '清理失败');
                      toast.success(
                        `K线清理完成：删 ${data.removed_age + data.removed_lru} 组，剩 ${data.remaining_series} 组`
                      );
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  清理 K 线
                </button>
              </div>
            </div>
            {(klineBulk?.active || (klineBulk?.done ?? 0) > 0) && (
              <div className={styles.settingItem}>
                <div className={styles.settingInfo}>
                  <span className={styles.settingLabel}>日K全量入库进度</span>
                  <span className={styles.settingDesc}>
                    {klineBulk?.message ||
                      `${klineBulk?.done ?? 0}/${klineBulk?.total ?? 0} · 成功${klineBulk?.ok ?? 0} 跳过${klineBulk?.skip ?? 0} 失败${klineBulk?.fail ?? 0}`}
                    {klineBulk?.current ? ` · 当前 ${klineBulk.current}` : ''}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Layers size={18} className={styles.sectionIcon} />
            <h3>数据来源同步</h3>
          </div>
          <div className={styles.sectionContent}>
            <SourceLaneMatrix />
          </div>
        </div>
      </Card>

      <Card>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Palette size={18} className={styles.sectionIcon} />
            <h3>色彩模式</h3>
          </div>
          <div className={styles.sectionContent}>
            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>涨跌颜色</span>
                <span className={styles.settingDesc}>全局页面和热力图默认使用同一颜色模式</span>
              </div>
              <div className={styles.colorModeOptions}>
                <button
                  className={`${styles.colorModeBtn} ${settings.colorMode === 'red-rise' ? styles.active : ''}`}
                  onClick={() => updateSettings({ colorMode: 'red-rise' })}
                >
                  <span className={styles.riseRed}>涨</span>
                  <span className={styles.fallGreen}>跌</span>
                  红涨绿跌
                </button>
                <button
                  className={`${styles.colorModeBtn} ${settings.colorMode === 'green-rise' ? styles.active : ''}`}
                  onClick={() => updateSettings({ colorMode: 'green-rise' })}
                >
                  <span className={styles.riseGreen}>涨</span>
                  <span className={styles.fallRed}>跌</span>
                  绿涨红跌
                </button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <BarChart2 size={18} className={styles.sectionIcon} />
            <h3>指标参数</h3>
          </div>
          <div className={styles.sectionContent}>
            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>MA 周期</span>
                <span className={styles.settingDesc}>逗号分隔，默认用于详情页均线</span>
              </div>
              <input
                className={styles.textInput}
                value={maDraft}
                onChange={(e) => setMaDraft(e.target.value)}
                onBlur={() => {
                  const next = parsePeriods(maDraft, maPeriods);
                  setMaDraft(next.join(', '));
                  updateIndicatorConfig({ ma: next });
                }}
              />
            </div>

            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>MACD</span>
                <span className={styles.settingDesc}>短 / 长 / 信号</span>
              </div>
              <div className={styles.inlineInputs}>
                <IndicatorNumberInput
                  value={settings.indicatorConfig.macd.short}
                  onChange={(v) =>
                    updateIndicatorConfig({
                      macd: { ...settings.indicatorConfig.macd, short: v },
                    })
                  }
                />
                <IndicatorNumberInput
                  value={settings.indicatorConfig.macd.long}
                  onChange={(v) =>
                    updateIndicatorConfig({
                      macd: { ...settings.indicatorConfig.macd, long: v },
                    })
                  }
                />
                <IndicatorNumberInput
                  value={settings.indicatorConfig.macd.signal}
                  onChange={(v) =>
                    updateIndicatorConfig({
                      macd: { ...settings.indicatorConfig.macd, signal: v },
                    })
                  }
                />
              </div>
            </div>

            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>BOLL</span>
                <span className={styles.settingDesc}>周期 / 标准差</span>
              </div>
              <div className={styles.inlineInputs}>
                <IndicatorNumberInput
                  value={settings.indicatorConfig.boll.period}
                  onChange={(v) =>
                    updateIndicatorConfig({
                      boll: { ...settings.indicatorConfig.boll, period: v },
                    })
                  }
                />
                <IndicatorNumberInput
                  value={settings.indicatorConfig.boll.stdDev}
                  min={0.1}
                  step="0.1"
                  onChange={(v) =>
                    updateIndicatorConfig({
                      boll: { ...settings.indicatorConfig.boll, stdDev: v },
                    })
                  }
                />
              </div>
            </div>

            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>KDJ</span>
                <span className={styles.settingDesc}>周期 / K / D</span>
              </div>
              <div className={styles.inlineInputs}>
                <IndicatorNumberInput
                  value={settings.indicatorConfig.kdj.period}
                  onChange={(v) =>
                    updateIndicatorConfig({
                      kdj: { ...settings.indicatorConfig.kdj, period: v },
                    })
                  }
                />
                <IndicatorNumberInput
                  value={settings.indicatorConfig.kdj.kPeriod}
                  onChange={(v) =>
                    updateIndicatorConfig({
                      kdj: { ...settings.indicatorConfig.kdj, kPeriod: v },
                    })
                  }
                />
                <IndicatorNumberInput
                  value={settings.indicatorConfig.kdj.dPeriod}
                  onChange={(v) =>
                    updateIndicatorConfig({
                      kdj: { ...settings.indicatorConfig.kdj, dPeriod: v },
                    })
                  }
                />
              </div>
            </div>

            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>RSI 周期</span>
                <span className={styles.settingDesc}>逗号分隔，默认用于详情页 RSI</span>
              </div>
              <input
                className={styles.textInput}
                value={rsiDraft}
                onChange={(e) => setRsiDraft(e.target.value)}
                onBlur={() => {
                  const next = parsePeriods(rsiDraft, rsiPeriods);
                  setRsiDraft(next.join(', '));
                  updateIndicatorConfig({ rsi: next });
                }}
              />
            </div>

            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>DMI / ADX</span>
                <span className={styles.settingDesc}>默认趋势强度参数</span>
              </div>
              <div className={styles.inlineInputs}>
                <IndicatorNumberInput
                  value={settings.indicatorConfig.dmi.period}
                  onChange={(v) =>
                    updateIndicatorConfig({
                      dmi: { ...settings.indicatorConfig.dmi, period: v },
                    })
                  }
                />
                <IndicatorNumberInput
                  value={settings.indicatorConfig.dmi.adxPeriod}
                  onChange={(v) =>
                    updateIndicatorConfig({
                      dmi: { ...settings.indicatorConfig.dmi, adxPeriod: v },
                    })
                  }
                />
              </div>
            </div>

            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>SAR</span>
                <span className={styles.settingDesc}>起始 / 增量 / 最大加速</span>
              </div>
              <div className={styles.inlineInputs}>
                <IndicatorNumberInput
                  value={settings.indicatorConfig.sar.afStart}
                  min={0.01}
                  step="0.01"
                  onChange={(v) =>
                    updateIndicatorConfig({
                      sar: { ...settings.indicatorConfig.sar, afStart: v },
                    })
                  }
                />
                <IndicatorNumberInput
                  value={settings.indicatorConfig.sar.afIncrement}
                  min={0.01}
                  step="0.01"
                  onChange={(v) =>
                    updateIndicatorConfig({
                      sar: { ...settings.indicatorConfig.sar, afIncrement: v },
                    })
                  }
                />
                <IndicatorNumberInput
                  value={settings.indicatorConfig.sar.afMax}
                  min={0.01}
                  step="0.01"
                  onChange={(v) =>
                    updateIndicatorConfig({
                      sar: { ...settings.indicatorConfig.sar, afMax: v },
                    })
                  }
                />
              </div>
            </div>

            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>KC</span>
                <span className={styles.settingDesc}>EMA / ATR / 倍数</span>
              </div>
              <div className={styles.inlineInputs}>
                <IndicatorNumberInput
                  value={settings.indicatorConfig.kc.emaPeriod}
                  onChange={(v) =>
                    updateIndicatorConfig({
                      kc: { ...settings.indicatorConfig.kc, emaPeriod: v },
                    })
                  }
                />
                <IndicatorNumberInput
                  value={settings.indicatorConfig.kc.atrPeriod}
                  onChange={(v) =>
                    updateIndicatorConfig({
                      kc: { ...settings.indicatorConfig.kc, atrPeriod: v },
                    })
                  }
                />
                <IndicatorNumberInput
                  value={settings.indicatorConfig.kc.multiplier}
                  min={0.1}
                  step="0.1"
                  onChange={(v) =>
                    updateIndicatorConfig({
                      kc: { ...settings.indicatorConfig.kc, multiplier: v },
                    })
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Info size={18} className={styles.sectionIcon} />
            <h3>关于</h3>
          </div>
          <div className={styles.sectionContent}>
            <div className={styles.aboutInfo}>
              <p><strong>A 股看板</strong> v{__APP_VERSION__}</p>
              <p className={styles.aboutDesc}>
                纯前端行情看板，核心数据能力来自 <strong>stock-sdk v2</strong>。
              </p>
              <p className={styles.aboutNote}>
                <strong>数据说明：</strong>
              </p>
              <ul className={styles.noteList}>
                <li>成交量单位：手（1手=100股）</li>
                <li>成交额单位：万元</li>
                <li>资金流、北向、龙虎榜等新增数据默认使用元级展示</li>
                <li>市值单位：亿元</li>
                <li>仅 A 股详情页已完全接入，港股 / 美股 / 基金结果暂不跳详情</li>
              </ul>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
