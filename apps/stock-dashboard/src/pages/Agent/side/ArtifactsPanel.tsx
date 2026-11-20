import { FileCode2 } from 'lucide-react';
import type { AgentArtifact } from '../types';
import styles from '../Agent.module.css';

type Props = {
  arts: AgentArtifact[];
  fallbackProjectId: string;
  onOpenFile: (path: string, projectId?: string) => void;
};

/** 仅保留可打开的文件类产物 */
function isFileArtifact(a: AgentArtifact): boolean {
  if (!a?.path) return false;
  if (a.type === 'acceptance' || a.type === 'smoke') return false;
  return a.type == null || a.type === 'file' || a.type === 'write';
}

function resolveArtifactProjectId(
  a: AgentArtifact,
  fallback: string
): string {
  if (a.projectId?.trim()) return a.projectId.trim();
  if (a.scope === 'repo') return 'meostock';
  const fromAbs = a.absPath?.match(/agent_workspaces[/\\]([^/\\]+)/);
  if (fromAbs?.[1]) return fromAbs[1];
  return fallback;
}

function dedupeFileArts(
  arts: AgentArtifact[],
  fallbackProjectId: string
): Array<AgentArtifact & { projectId: string }> {
  const map = new Map<string, AgentArtifact & { projectId: string }>();
  for (const a of arts) {
    if (!isFileArtifact(a) || !a.path) continue;
    const projectId = resolveArtifactProjectId(a, fallbackProjectId);
    const key = `${projectId}::${a.path}`;
    map.set(key, { ...a, projectId });
  }
  return Array.from(map.values()).reverse();
}

export function ArtifactsPanel({ arts, fallbackProjectId, onOpenFile }: Props) {
  const files = dedupeFileArts(arts, fallbackProjectId);

  if (!files.length) {
    return <div className={styles.sideEmpty}>本会话尚无文件产物</div>;
  }

  return (
    <div className={styles.sidePaneBody}>
      <div className={styles.sidePaneToolbar}>
        <span className={styles.sidePaneHint}>{files.length} 个文件</span>
      </div>
      <ul className={styles.artifactList}>
        {files.map((a) => (
          <li key={`${a.projectId}:${a.path}`}>
            <button
              type="button"
              className={styles.artifactRow}
              title={`在标签中打开 · ${a.path}`}
              onClick={() => onOpenFile(a.path!, a.projectId)}
            >
              <FileCode2 size={14} className={styles.artifactIcon} />
              <span className={styles.artifactMain}>
                <span className={styles.artifactName}>
                  {a.path!.split('/').pop() || a.path}
                </span>
                <span className={styles.artifactPathLink}>{a.path}</span>
              </span>
              <span className={styles.artifactScope}>
                {a.scope === 'repo' ? '仓库' : a.scope === 'workspace' ? '工作区' : a.projectId}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
