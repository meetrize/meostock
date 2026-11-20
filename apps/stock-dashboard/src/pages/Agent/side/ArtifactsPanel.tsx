import { FileCode2 } from 'lucide-react';
import type { AcceptanceInfo, AgentArtifact } from '../types';
import styles from '../Agent.module.css';

type Props = {
  workspacePath: string | null;
  arts: AgentArtifact[];
  accepts: AcceptanceInfo[];
  busyAccept: string | null;
  onFinalize: (id: string, push: boolean, commitMessage?: string) => void;
  onReject: (id: string) => void;
};

export function ArtifactsPanel({
  workspacePath,
  arts,
  accepts,
  busyAccept,
  onFinalize,
  onReject,
}: Props) {
  return (
    <div className={styles.sidePaneBody}>
      {workspacePath ? (
        <div className={styles.artifactCard}>
          <div>工作区</div>
          <div className={styles.artifactPath}>{workspacePath}</div>
        </div>
      ) : null}
      {accepts.map((a) => (
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
                onClick={() => onFinalize(a.id, true)}
              >
                通过并 push
              </button>
              <button
                type="button"
                className={styles.rejectBtn}
                disabled={busyAccept === a.id}
                onClick={() => onReject(a.id)}
              >
                驳回
              </button>
            </div>
          ) : null}
        </div>
      ))}
      {arts
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
      {!arts.length && !accepts.length && !workspacePath ? (
        <div className={styles.sideEmpty}>本会话尚无产物</div>
      ) : null}
    </div>
  );
}
