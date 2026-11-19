/**
 * 自定义版面管理页（有侧栏）
 */

import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Copy,
  Download,
  Pencil,
  Plus,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import { useToast } from '@/components/common';
import { useWorkspaces } from './useWorkspaces';
import styles from './WorkspacesManage.module.css';

export function WorkspacesManage() {
  const navigate = useNavigate();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const {
    workspaces,
    lastOpenedId,
    createWorkspace,
    renameWorkspace,
    duplicateWorkspace,
    deleteWorkspace,
    setLastOpened,
    exportJson,
    importJson,
  } = useWorkspaces();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setDraftName(name);
  };

  const commitRename = () => {
    if (!editingId) return;
    const trimmed = draftName.trim();
    if (trimmed) {
      renameWorkspace(editingId, trimmed);
      toast.success('已重命名');
    }
    setEditingId(null);
  };

  const handleCreate = () => {
    const ws = createWorkspace();
    toast.success(`已新建「${ws.name}」`);
    navigate(`/workspaces/${ws.id}`);
  };

  const handleDuplicate = (id: string) => {
    const copy = duplicateWorkspace(id);
    if (copy) toast.success(`已复制为「${copy.name}」`);
  };

  const handleDelete = (id: string, name: string) => {
    if (workspaces.length <= 1) {
      toast.error('至少保留一套版面');
      return;
    }
    if (!window.confirm(`确定删除「${name}」？此操作不可撤销。`)) return;
    const ok = deleteWorkspace(id);
    if (ok) toast.success('已删除');
  };

  const handleExport = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meostock-workspaces-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('已导出');
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      if (!importJson(text)) {
        toast.error('文件格式无效');
        return;
      }
      toast.success('已导入版面');
    } catch {
      toast.error('读取文件失败');
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>自定义版面</h1>
          <p className={styles.subtitle}>
            管理多套全屏工作区。打开后无侧栏/顶栏，适合看盘拼版；支持嵌入第三方网页。
          </p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.secondaryBtn} onClick={handleExport}>
            <Download size={16} aria-hidden />
            导出
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={16} aria-hidden />
            导入
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportFile(file);
              e.target.value = '';
            }}
          />
          <button type="button" className={styles.primaryBtn} onClick={handleCreate}>
            <Plus size={16} aria-hidden />
            新建版面
          </button>
        </div>
      </header>

      <ul className={styles.list}>
        {workspaces.map((ws) => {
          const isDefault = ws.id === lastOpenedId;
          const isRenaming = editingId === ws.id;
          return (
            <li key={ws.id} className={styles.row}>
              <button
                type="button"
                className={styles.rowMain}
                onClick={() => navigate(`/workspaces/${ws.id}`)}
              >
                <span className={styles.rowName}>
                  {isRenaming ? (
                    <input
                      className={styles.renameInput}
                      value={draftName}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                    />
                  ) : (
                    ws.name
                  )}
                </span>
                <span className={styles.rowMeta}>
                  {ws.widgets.length} 个面板
                  {isDefault ? ' · 默认打开' : ''}
                </span>
              </button>
              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.iconBtn}
                  title="设为默认打开"
                  aria-label="设为默认打开"
                  disabled={isDefault}
                  onClick={() => {
                    setLastOpened(ws.id);
                    toast.success(`已设「${ws.name}」为默认打开`);
                  }}
                >
                  <Star
                    size={16}
                    fill={isDefault ? 'currentColor' : 'none'}
                    aria-hidden
                  />
                </button>
                <button
                  type="button"
                  className={styles.iconBtn}
                  title="重命名"
                  aria-label="重命名"
                  onClick={() => startRename(ws.id, ws.name)}
                >
                  <Pencil size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className={styles.iconBtn}
                  title="复制"
                  aria-label="复制"
                  onClick={() => handleDuplicate(ws.id)}
                >
                  <Copy size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className={`${styles.iconBtn} ${styles.danger}`}
                  title="删除"
                  aria-label="删除"
                  disabled={workspaces.length <= 1}
                  onClick={() => handleDelete(ws.id, ws.name)}
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
