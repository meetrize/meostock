/**
 * 登录 / 注册弹窗
 */

import { useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthProvider';
import styles from './AuthModal.module.css';

type Mode = 'login' | 'register';

type Props = {
  open: boolean;
  onClose: () => void;
  initialMode?: Mode;
};

export function AuthModal({ open, onClose, initialMode = 'login' }: Props) {
  const { login, register, config } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const openRegister = config?.open_register !== false;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res =
        mode === 'login'
          ? await login(username.trim(), password)
          : await register(username.trim(), password);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.panel}>
        <div className={styles.head}>
          <h2 className={styles.title}>{mode === 'login' ? '登录' : '注册'}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <p className={styles.hint}>
          游客可继续使用本机配置；登录后可将自选与设置同步到当前账号。
        </p>
        <form className={styles.form} onSubmit={submit}>
          <label className={styles.label}>
            用户名
            <input
              className={styles.input}
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={2}
            />
          </label>
          <label className={styles.label}>
            密码
            <input
              className={styles.input}
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>
          {error ? <div className={styles.error}>{error}</div> : null}
          <button type="submit" className={styles.submit} disabled={busy}>
            {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
          </button>
        </form>
        {openRegister ? (
          <button
            type="button"
            className={styles.switch}
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
            }}
          >
            {mode === 'login' ? '没有账号？注册' : '已有账号？登录'}
          </button>
        ) : mode === 'register' ? (
          <p className={styles.hint}>开放注册已关闭，请联系管理员。</p>
        ) : null}
      </div>
    </div>
  );
}
