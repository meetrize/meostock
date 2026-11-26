/**
 * 定时任务：同花顺概念 / 东财板块概念 / 财经日历同步等
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Play, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react';
import { Card, Loading, Empty, useToast } from '@/components/common';
import styles from './Scheduler.module.css';

type Job = {
  id: string;
  name: string;
  job_type: string;
  enabled: boolean;
  interval_minutes: number;
  last_run_at?: number | null;
  next_run_at?: number | null;
  last_status?: string | null;
  last_error?: string | null;
  last_result?: Record<string, unknown> | null;
};

type JobRun = {
  id: number;
  job_id: string;
  started_at: number;
  finished_at?: number | null;
  status: string;
  message?: string | null;
};

type SyncProgress = {
  active?: boolean;
  phase?: string;
  done?: number;
  total?: number;
  ok_count?: number;
  failed?: number;
  tagged?: number;
  removed?: number;
  skipped?: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  current_code?: string;
  current_name?: string;
  backfill_done?: number;
  backfill_pending?: number;
  universe?: number;
  message?: string;
  last_error?: string | null;
};

function fmtTime(ts?: number | null): string {
  if (!ts) return '—';
  try {
    return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return '—';
  }
}

function jobProgressKey(jobType: string): string | null {
  if (jobType === 'ths_concept_sync') return 'ths';
  if (jobType === 'em_board_sync') return 'em';
  if (jobType === 'finance_calendar_sync') return 'cal';
  if (jobType === 'cninfo_announcement_sync') return 'cninfo';
  return null;
}

export function Scheduler() {
  const toast = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [thsProgress, setThsProgress] = useState<SyncProgress | null>(null);
  const [emProgress, setEmProgress] = useState<SyncProgress | null>(null);
  const [calProgress, setCalProgress] = useState<SyncProgress | null>(null);
  const [cninfoProgress, setCninfoProgress] = useState<SyncProgress | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // 顶部条只给其它任务用；巨潮公告进度只画在对应任务卡片内
  const activeProgress = useMemo(() => {
    if (calProgress?.active) return calProgress;
    if (emProgress?.active) return emProgress;
    if (thsProgress?.active) return thsProgress;
    return thsProgress?.message
      ? thsProgress
      : emProgress?.message
        ? emProgress
        : calProgress?.message
          ? calProgress
          : null;
  }, [calProgress, emProgress, thsProgress]);

  const load = useCallback(async () => {
    try {
      const [jRes, rRes, thsRes, emRes, calRes, cninfoRes, cninfoStatsRes] = await Promise.all([
        fetch('/api/scheduler/jobs'),
        fetch('/api/scheduler/runs?limit=30'),
        fetch('/api/scheduler/ths-concept/progress'),
        fetch('/api/scheduler/em-board/progress'),
        fetch('/api/scheduler/finance-calendar/progress'),
        fetch('/api/scheduler/cninfo-announcement/progress'),
        fetch('/api/cninfo/stats'),
      ]);
      const jData = await jRes.json().catch(() => ({}));
      const rData = await rRes.json().catch(() => ({}));
      const thsData = await thsRes.json().catch(() => ({}));
      const emData = await emRes.json().catch(() => ({}));
      const calData = await calRes.json().catch(() => ({}));
      const cninfoData = await cninfoRes.json().catch(() => ({}));
      const cninfoStats = await cninfoStatsRes.json().catch(() => ({}));
      if (jData?.ok && Array.isArray(jData.jobs)) setJobs(jData.jobs);
      if (rData?.ok && Array.isArray(rData.runs)) setRuns(rData.runs);
      if (thsData?.ok) setThsProgress(thsData);
      if (emData?.ok) setEmProgress(emData);
      if (calData?.ok) setCalProgress(calData);
      if (cninfoData?.ok) {
        const merged: SyncProgress = { ...cninfoData };
        // 用 stats 补全卡片上的全市场回填数（即使任务空闲）
        if (cninfoStats?.ok) {
          merged.universe = Number(cninfoStats.stocks) || merged.universe;
          merged.backfill_done = Number(cninfoStats.backfill_done) || merged.backfill_done;
          merged.backfill_pending =
            Number(cninfoStats.backfill_pending) || merged.backfill_pending;
        }
        setCninfoProgress(merged);
      } else if (cninfoStats?.ok) {
        setCninfoProgress({
          active: false,
          universe: Number(cninfoStats.stocks) || 0,
          backfill_done: Number(cninfoStats.backfill_done) || 0,
          backfill_pending: Number(cninfoStats.backfill_pending) || 0,
          message: '',
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(id);
  }, [load]);

  const patchJob = async (job: Job, patch: { enabled?: boolean; interval_minutes?: number }) => {
    setBusyId(job.id);
    try {
      const res = await fetch(`/api/scheduler/jobs/${encodeURIComponent(job.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || `更新失败 ${res.status}`);
      toast.success('已更新任务配置');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const runJob = async (job: Job) => {
    setBusyId(job.id);
    try {
      const res = await fetch(`/api/scheduler/jobs/${encodeURIComponent(job.id)}/run`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || data?.running || `启动失败 ${res.status}`);
      toast.success(`已启动：${job.name}`);
      await load();

      // 财经日历 / 巨潮公告：轮询进度并给出成功/失败结果提示
      if (
        job.job_type === 'finance_calendar_sync' ||
        job.job_type === 'cninfo_announcement_sync'
      ) {
        const progressUrl =
          job.job_type === 'cninfo_announcement_sync'
            ? '/api/scheduler/cninfo-announcement/progress'
            : '/api/scheduler/finance-calendar/progress';
        const maxPoll =
          job.job_type === 'cninfo_announcement_sync' ? 900 : 120; // 公告单轮可能很长
        let sawActive = false;
        for (let i = 0; i < maxPoll; i += 1) {
          await new Promise((r) => setTimeout(r, 800));
          const pRes = await fetch(progressUrl);
          const pData = await pRes.json().catch(() => ({}));
          if (pData?.ok) {
            if (job.job_type === 'cninfo_announcement_sync') setCninfoProgress(pData);
            else setCalProgress(pData);
            if (pData.active) sawActive = true;
            if (sawActive && !pData.active) {
              if (pData.phase === 'error' || pData.last_error) {
                toast.error(pData.last_error || pData.message || '同步失败');
              } else {
                toast.success(pData.message || '同步完成');
              }
              await load();
              break;
            }
          }
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const progressFor = (jobType: string): SyncProgress | null => {
    const key = jobProgressKey(jobType);
    if (key === 'ths') return thsProgress;
    if (key === 'em') return emProgress;
    if (key === 'cal') return calProgress;
    if (key === 'cninfo') return cninfoProgress;
    return null;
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>
            <Clock size={18} />
            定时任务
          </h2>
          <p className={styles.desc}>
            东财/同花顺板块概念与财经日历定时入库后，页面优先读库；日历任务默认夜间 02:00 同步。
          </p>
        </div>
        <button type="button" className={styles.refreshBtn} onClick={() => void load()}>
          <RefreshCw size={14} className={activeProgress?.active ? styles.spin : undefined} />
          刷新
        </button>
      </div>

      {activeProgress?.active && (
        <div className={styles.progressBar}>
          <div className={styles.progressText}>
            {activeProgress.current_code
              ? `当前 ${activeProgress.current_code} ${activeProgress.current_name || ''} · `
              : ''}
            {activeProgress.message || '同步中…'}
            {activeProgress.total ? ` · 本轮 ${activeProgress.done ?? 0}/${activeProgress.total}` : ''}
            {typeof activeProgress.backfill_pending === 'number' &&
            typeof activeProgress.universe === 'number' &&
            activeProgress.universe > 0
              ? ` · 全市场已回填 ${activeProgress.backfill_done ?? 0}/${activeProgress.universe}`
              : ''}
            {typeof activeProgress.tagged === 'number' ? ` · 标注 ${activeProgress.tagged}` : ''}
          </div>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{
                width: `${
                  activeProgress.total
                    ? Math.min(
                        100,
                        Math.round(((activeProgress.done || 0) / activeProgress.total) * 100)
                      )
                    : 8
                }%`,
              }}
            />
          </div>
        </div>
      )}

      <Card title="任务列表" padding="md">
        {loading ? (
          <Loading text="加载任务…" />
        ) : jobs.length === 0 ? (
          <Empty title="暂无任务" />
        ) : (
          <div className={styles.jobList}>
            {jobs.map((job, index) => {
              const p = progressFor(job.job_type);
              const running = Boolean(p?.active);
              return (
                <motion.div
                  key={job.id}
                  className={styles.jobCard}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index, 8) * 0.03 }}
                >
                  <div className={styles.jobMain}>
                    <h3 className={styles.jobName}>{job.name}</h3>
                    <div className={styles.jobMeta}>
                      <span>类型 {job.job_type}</span>
                      <span>间隔 {job.interval_minutes} 分钟</span>
                      <span>状态 {running ? 'running' : job.last_status || 'idle'}</span>
                    </div>
                    <div className={styles.jobMeta}>
                      <span>上次 {fmtTime(job.last_run_at)}</span>
                      <span>下次 {fmtTime(job.next_run_at)}</span>
                    </div>
                    {job.last_error ? (
                      <div className={styles.jobError}>{job.last_error}</div>
                    ) : null}
                    {job.job_type === 'ths_concept_sync' ? (
                      <div className={styles.jobHint}>
                        按同花顺个股概念严格对齐成份；列表/详情读库。
                      </div>
                    ) : null}
                    {job.job_type === 'em_board_sync' ? (
                      <div className={styles.jobHint}>
                        东财行业+概念目录入库，并按 F10 严格对齐个股板块标注；打开板块页优先读库。
                      </div>
                    ) : null}
                    {job.job_type === 'finance_calendar_sync' ? (
                      <div className={styles.jobHint}>
                        拉取东财未来约 30 天财经日历（会议/经济数据/其他），增量 upsert 到本地库。
                      </div>
                    ) : null}
                    {job.job_type === 'cninfo_announcement_sync' ? (
                      <div className={styles.jobHint}>
                        夜间/手动分批回填巨潮全 A 股近两年公告；单次成功≠全市场完成，看「待回填」续跑。侧栏打开未入库个股会按需即时拉取。
                      </div>
                    ) : null}
                    {job.job_type === 'cninfo_announcement_sync' ? (
                      <div className={running ? styles.jobProgressLive : styles.jobProgressIdle}>
                        {running ? (
                          <>
                            <div className={styles.jobProgressTitle}>
                              同步中
                              {p?.current_code
                                ? ` · ${p.current_code} ${p.current_name || ''}`.trim()
                                : ''}
                            </div>
                            <div className={styles.jobProgressMeta}>
                              本轮 {p?.done ?? 0}/{p?.total ?? '—'}
                              {typeof p?.inserted === 'number' ? ` · 新增 ${p.inserted}` : ''}
                            </div>
                            <div className={styles.progressTrack}>
                              <div
                                className={styles.progressFill}
                                style={{
                                  width: `${
                                    p?.total
                                      ? Math.min(
                                          100,
                                          Math.round(((p.done || 0) / p.total) * 100)
                                        )
                                      : 8
                                  }%`,
                                }}
                              />
                            </div>
                            <div className={styles.jobProgressMeta}>
                              {typeof p?.universe === 'number' && p.universe > 0
                                ? `全市场已回填 ${p.backfill_done ?? 0}/${p.universe}（待 ${p.backfill_pending ?? '—'}）`
                                : ''}
                            </div>
                            {typeof p?.universe === 'number' && p.universe > 0 ? (
                              <div className={styles.progressTrack}>
                                <div
                                  className={styles.progressFillMuted}
                                  style={{
                                    width: `${Math.min(
                                      100,
                                      Math.round(
                                        ((p.backfill_done || 0) / p.universe) * 100
                                      )
                                    )}%`,
                                  }}
                                />
                              </div>
                            ) : null}
                            <div className={styles.jobProgressMsg}>{p?.message || '…'}</div>
                          </>
                        ) : (
                          <>
                            <div className={styles.jobProgressTitle}>回填进度</div>
                            <div className={styles.jobProgressMeta}>
                              {typeof p?.universe === 'number' && p.universe > 0
                                ? `全市场已回填 ${p.backfill_done ?? 0}/${p.universe}（待 ${p.backfill_pending ?? 0}）`
                                : '尚未开始或进度未加载'}
                              {typeof p?.inserted === 'number' && p.message
                                ? ` · 上次新增 ${p.inserted}`
                                : ''}
                            </div>
                            {typeof p?.universe === 'number' && p.universe > 0 ? (
                              <div className={styles.progressTrack}>
                                <div
                                  className={styles.progressFillMuted}
                                  style={{
                                    width: `${Math.min(
                                      100,
                                      Math.round(
                                        ((p.backfill_done || 0) / p.universe) * 100
                                      )
                                    )}%`,
                                  }}
                                />
                              </div>
                            ) : null}
                            {p?.message ? (
                              <div className={styles.jobProgressMsg}>上次：{p.message}</div>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}
                    {job.job_type === 'cn_daily_eod_patch' ? (
                      <div className={styles.jobHint}>
                        A 股收盘后用全市场快照补写当日日 K（含指数），供行情与 portal 曲线读盘。
                      </div>
                    ) : null}
                    {String(job.job_type || '').startsWith('portal_kline_eod_') ? (
                      <div className={styles.jobHint}>
                        Dashboard portal 面积图日 K：按该市场盘后拉取并写入本地库（历史读盘、当日/缺口才打网）。
                      </div>
                    ) : null}
                    {job.job_type === 'finance_calendar_sync' && p?.active ? (
                      <div className={styles.jobHint}>
                        进度 {p.message || '同步中…'}
                        {p.total ? ` · ${p.done ?? 0}/${p.total}` : ''}
                      </div>
                    ) : null}
                  </div>
                  <div className={styles.jobActions}>
                    <label className={styles.intervalBox}>
                      间隔
                      <input
                        type="number"
                        min={5}
                        step={5}
                        className={styles.intervalInput}
                        value={job.interval_minutes}
                        disabled={busyId === job.id}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isFinite(v) || v < 5) return;
                          setJobs((prev) =>
                            prev.map((x) =>
                              x.id === job.id ? { ...x, interval_minutes: v } : x
                            )
                          );
                        }}
                        onBlur={() =>
                          void patchJob(job, { interval_minutes: job.interval_minutes })
                        }
                      />
                      分
                    </label>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      disabled={busyId === job.id}
                      onClick={() => void patchJob(job, { enabled: !job.enabled })}
                      title={job.enabled ? '关闭定时' : '开启定时'}
                    >
                      {job.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                      {job.enabled ? '定时开' : '定时关'}
                    </button>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      disabled={busyId === job.id || Boolean(running)}
                      onClick={() => void runJob(job)}
                    >
                      <Play size={14} />
                      {running ? '同步中' : '立即运行'}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="最近运行" padding="md">
        {runs.length === 0 ? (
          <Empty title="暂无运行记录" />
        ) : (
          <div className={styles.runTable}>
            <div className={styles.runHead}>
              <span>任务</span>
              <span>状态</span>
              <span>开始</span>
              <span>结束</span>
              <span>说明</span>
            </div>
            {runs.map((r) => (
              <div key={r.id} className={styles.runRow}>
                <span>{r.job_id}</span>
                <span>{r.status}</span>
                <span>{fmtTime(r.started_at)}</span>
                <span>{fmtTime(r.finished_at)}</span>
                <span className={styles.runMsg}>{r.message || '—'}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
