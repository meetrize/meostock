/**
 * 定时任务：同花顺概念同步等
 */

import { useCallback, useEffect, useState } from 'react';
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

type ThsProgress = {
  active?: boolean;
  phase?: string;
  done?: number;
  total?: number;
  ok_count?: number;
  failed?: number;
  tagged?: number;
  message?: string;
};

function fmtTime(ts?: number | null): string {
  if (!ts) return '—';
  try {
    return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return '—';
  }
}

export function Scheduler() {
  const toast = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<ThsProgress | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [jRes, rRes, pRes] = await Promise.all([
        fetch('/api/scheduler/jobs'),
        fetch('/api/scheduler/runs?limit=30'),
        fetch('/api/scheduler/ths-concept/progress'),
      ]);
      const jData = await jRes.json().catch(() => ({}));
      const rData = await rRes.json().catch(() => ({}));
      const pData = await pRes.json().catch(() => ({}));
      if (jData?.ok && Array.isArray(jData.jobs)) setJobs(jData.jobs);
      if (rData?.ok && Array.isArray(rData.runs)) setRuns(rData.runs);
      if (pData?.ok) setProgress(pData);
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
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
            独立调度模块。同花顺概念同步会翻遍概念目录与成分页，对照本库股票写入概念标注。
          </p>
        </div>
        <button type="button" className={styles.refreshBtn} onClick={() => void load()}>
          <RefreshCw size={14} className={progress?.active ? styles.spin : undefined} />
          刷新
        </button>
      </div>

      {progress?.active && (
        <div className={styles.progressBar}>
          <div className={styles.progressText}>
            {progress.message || '同步中…'}
            {progress.total ? ` · ${progress.done ?? 0}/${progress.total}` : ''}
            {typeof progress.tagged === 'number' ? ` · 标注 ${progress.tagged}` : ''}
          </div>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{
                width: `${
                  progress.total
                    ? Math.min(100, Math.round(((progress.done || 0) / progress.total) * 100))
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
              const running = progress?.active && job.job_type === 'ths_concept_sync';
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
                        来源 q.10jqka.com.cn/gn → 概念详情翻页成分 → 标注本库股票（ths）。未登录时深分页可能被拦截。
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
