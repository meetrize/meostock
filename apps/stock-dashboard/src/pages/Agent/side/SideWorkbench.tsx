import { FileCode2, FolderTree, GitBranch, TerminalSquare, Wrench } from 'lucide-react';
import type { AcceptanceInfo, AgentArtifact } from '../types';
import type { ToolTrailItem } from './ToolsPanel';
import { ArtifactsPanel } from './ArtifactsPanel';
import { FilesPanel } from './FilesPanel';
import { GitPanel } from './GitPanel';
import { TerminalPanel } from './TerminalPanel';
import { ToolsPanel } from './ToolsPanel';
import styles from '../Agent.module.css';

export type SideTabId = 'files' | 'git' | 'terminal' | 'artifacts' | 'tools';

type Props = {
  sideTab: SideTabId;
  onSideTab: (id: SideTabId) => void;
  projectId: string;
  workspacePath: string | null;
  arts: AgentArtifact[];
  accepts: AcceptanceInfo[];
  busyAccept: string | null;
  toolItems: ToolTrailItem[];
  pendingAcceptCount: number;
  onOpenFile: (path: string) => void;
  onOpenDiff: (path: string) => void;
  onCitePath: (path: string) => void;
  onFinalize: (id: string, push: boolean, commitMessage?: string) => void;
  onReject: (id: string) => void;
  onDirectCommit: (message: string, push: boolean) => Promise<void>;
  onJumpTool: (messageId: string) => void;
};

const TABS: { id: SideTabId; label: string; icon: typeof FolderTree }[] = [
  { id: 'files', label: '文件', icon: FolderTree },
  { id: 'git', label: '变更', icon: GitBranch },
  { id: 'terminal', label: '终端', icon: TerminalSquare },
  { id: 'artifacts', label: '产物', icon: FileCode2 },
  { id: 'tools', label: '工具', icon: Wrench },
];

export function SideWorkbench(props: Props) {
  const {
    sideTab,
    onSideTab,
    projectId,
    workspacePath,
    arts,
    accepts,
    busyAccept,
    toolItems,
    pendingAcceptCount,
    onOpenFile,
    onOpenDiff,
    onCitePath,
    onFinalize,
    onReject,
    onDirectCommit,
    onJumpTool,
  } = props;

  const pendingAccept =
    accepts.find((a) => a.status === 'pending') || null;

  return (
    <aside className={styles.sidePanel}>
      <div className={styles.sideTabs} role="tablist">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = sideTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`${styles.sideTab}${active ? ` ${styles.sideTabActive}` : ''}`}
              onClick={() => onSideTab(t.id)}
              title={t.label}
            >
              <Icon size={13} />
              <span className={styles.sideTabLabel}>{t.label}</span>
              {t.id === 'artifacts' && pendingAcceptCount > 0 ? (
                <span className={styles.sideTabBadge}>{pendingAcceptCount}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className={styles.sidePanelBody}>
        {sideTab === 'files' ? (
          <FilesPanel
            projectId={projectId}
            onOpenFile={onOpenFile}
            onCitePath={onCitePath}
          />
        ) : null}
        {sideTab === 'git' ? (
          <GitPanel
            projectId={projectId}
            onOpenDiff={onOpenDiff}
            pendingAccept={pendingAccept}
            busyAccept={busyAccept}
            onFinalize={onFinalize}
            onReject={onReject}
            onDirectCommit={onDirectCommit}
          />
        ) : null}
        {sideTab === 'terminal' ? (
          <TerminalPanel projectId={projectId} active={sideTab === 'terminal'} />
        ) : null}
        {sideTab === 'artifacts' ? (
          <ArtifactsPanel
            workspacePath={workspacePath}
            arts={arts}
            accepts={accepts}
            busyAccept={busyAccept}
            onFinalize={onFinalize}
            onReject={onReject}
          />
        ) : null}
        {sideTab === 'tools' ? (
          <ToolsPanel items={toolItems} onJump={onJumpTool} />
        ) : null}
      </div>
    </aside>
  );
}
