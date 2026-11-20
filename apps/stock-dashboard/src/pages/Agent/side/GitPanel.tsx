import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { AcceptanceInfo } from '../types';
import styles from '../Agent.module.css';

type GitFile = { path: string; status: string };

type Props = {
  projectId: string;
  onOpenDiff: (path: string) => void;
  pendingAccept: AcceptanceInfo | null;
  busyAccept: string | null;
  onFinalize: (id: string, push: boolean, commitMessage: string) => void;
  onReject: (id: string) => void;
  onDirectCommit: (message: string, push: boolean) => Promise<void>;
  onCommitted?: () => void;
};

export function GitPanel({
  projectId,
  onOpenDiff,
  pendingAccept,
  busyAccept,
  onFinalize,
  onReject,
  onDirectCommit,
  onCommitted,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGit, setIsGit] = useState(true);
  const [branch, setBranch] = useState<string | null>(null);
  const [files, setFiles] = useState<GitFile[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [commitMsg, setCommitMsg] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [committing, setCommitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ projectId });
      const res = await fetch(`/api/agent/git/summary?${q}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || '加载失败');
      }
      setIsGit(Boolean(data.isGit));
      setBranch(data.branch || null);
      setFiles(Array.isArray(data.files) ? data.files : []);
      setMessage(data.message || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (pendingAccept?.commitMessage) {
      setCommitMsg(pendingAccept.commitMessage);
    }
  }, [pendingAccept?.id, pendingAccept?.commitMessage]);

  const suggest = async () => {
    setSuggesting(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/git/suggest-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || '生成失败');
      setCommitMsg(String(data.message || '').trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggesting(false);
    }
  };

  const runAccept = async (push: boolean) => {
    const msg = commitMsg.trim();
    if (!msg) {
      setError('请填写提交说明');
      return;
    }
    if (pendingAccept?.id) {
      onFinalize(pendingAccept.id, push, msg);
      return;
    }
    setCommitting(true);
    setError(null);
    try {
      await onDirectCommit(msg, push);
      setCommitMsg('');
      await load();
      onCommitted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  };

  const busy = Boolean(busyAccept) || committing;
  const hasChanges = files.length > 0;
  const canAct = isGit && (hasChanges || Boolean(pendingAccept));

  return (
    <div className={styles.sidePaneBody}>
      <div className={styles.sidePaneToolbar}>
        <span className={styles.sidePaneHint} title={branch || ''}>
          {branch || (isGit ? 'git' : '非 git')}
        </span>
        <button
          type="button"
          className={styles.iconBtn}
          title="刷新"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? <Loader2 size={14} className={styles.spin} /> : <RefreshCw size={14} />}
        </button>
      </div>
      {error ? <div className={styles.viewerError}>{error}</div> : null}
      {!isGit ? (
        <div className={styles.sideEmpty}>{message || '当前项目不是 git 仓库'}</div>
      ) : (
        <>
          {!files.length && !loading ? (
            <div className={styles.sideEmpty}>工作区干净，无变更</div>
          ) : (
            <ul className={styles.gitList}>
              {files.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    className={styles.gitRow}
                    onClick={() => onOpenDiff(f.path)}
                    title={f.path}
                  >
                    <span className={styles.gitStatus}>{f.status}</span>
                    <span className={styles.gitPath}>{f.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className={styles.gitCommitBox}>
            <div className={styles.gitCommitHead}>
              <span>提交说明</span>
              <button
                type="button"
                className={styles.gitAiBtn}
                disabled={!isGit || suggesting || busy}
                onClick={() => void suggest()}
                title="根据当前变更用 AI 生成提交说明"
              >
                {suggesting ? (
                  <Loader2 size={12} className={styles.spin} />
                ) : (
                  <Sparkles size={12} />
                )}
                AI 生成
              </button>
            </div>
            <textarea
              className={styles.gitCommitInput}
              value={commitMsg}
              rows={4}
              placeholder="简体中文 Conventional Commit…"
              disabled={busy}
              onChange={(e) => setCommitMsg(e.target.value)}
            />
            {pendingAccept ? (
              <div className={styles.gitPendingHint}>
                待验收：{pendingAccept.summary || pendingAccept.id.slice(0, 8)}
              </div>
            ) : null}
            <div className={styles.gitCommitActions}>
              <button
                type="button"
                className={styles.acceptBtn}
                disabled={!canAct || busy || !commitMsg.trim()}
                onClick={() => void runAccept(true)}
              >
                {busy ? <Loader2 size={12} className={styles.spin} /> : null}
                验收通过并提交+推送
              </button>
              <button
                type="button"
                className={styles.acceptBtn}
                disabled={!canAct || busy || !commitMsg.trim()}
                onClick={() => void runAccept(false)}
              >
                仅 commit
              </button>
              <button
                type="button"
                className={styles.rejectBtn}
                disabled={!pendingAccept || busy}
                title={pendingAccept ? '驳回当前验收单' : '无可驳回的验收单'}
                onClick={() => pendingAccept && onReject(pendingAccept.id)}
              >
                驳回
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
