/**
 * 登录后：检测到本机配置 → 是否导入
 */

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthProvider';
import { useToast } from '@/components/common';
import styles from './AuthModal.module.css';

export function ImportPrefsDialog() {
  const { showImportPrompt, dismissImportPrompt, importLocal } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (!showImportPrompt) return null;

  const run = async (mode: 'merge' | 'overwrite') => {
    setBusy(true);
    try {
      const r = await importLocal(mode);
      toast.success(
        mode === 'overwrite'
          ? `已用本机覆盖云端（写入 ${r.written} 项）`
          : `已导入本机配置（写入 ${r.written}，跳过 ${r.skipped}）`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.panel}>
        <h2 className={styles.title}>导入本机配置？</h2>
        <p className={styles.hint}>
          检测到浏览器里已有自选、设置等工作区数据。推荐导入到当前账号，之后可在多设备间同步。
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            className={styles.submit}
            disabled={busy}
            onClick={() => void run('merge')}
          >
            {busy ? '导入中…' : '导入（推荐，云端已有则保留）'}
          </button>
          <button
            type="button"
            className={styles.switch}
            disabled={busy}
            onClick={() => void run('overwrite')}
          >
            用本机覆盖云端
          </button>
          <button
            type="button"
            className={styles.switch}
            disabled={busy}
            onClick={dismissImportPrompt}
          >
            暂不导入
          </button>
        </div>
      </div>
    </div>
  );
}
