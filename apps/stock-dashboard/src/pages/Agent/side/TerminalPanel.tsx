import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';
import styles from '../Agent.module.css';

type Props = {
  projectId: string;
  active: boolean;
};

function wsUrl(projectId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const q = new URLSearchParams({ projectId });
  return `${proto}//${window.location.host}/api/agent/terminal?${q}`;
}

export function TerminalPanel({ projectId, active }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const dataSubRef = useRef<{ dispose: () => void } | null>(null);
  const genRef = useRef(0);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'open' | 'closed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const disconnect = useCallback(() => {
    dataSubRef.current?.dispose();
    dataSubRef.current = null;
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'var(--font-mono), ui-monospace, monospace',
      theme: {
        background: '#0f1115',
        foreground: '#d6d8de',
        cursor: '#d6d8de',
      },
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const onResize = () => {
      try {
        fit.fit();
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows })
          );
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [disconnect]);

  useEffect(() => {
    if (!active || !termRef.current) {
      if (!active) {
        disconnect();
        setStatus('closed');
      }
      return;
    }
    const term = termRef.current;
    const gen = ++genRef.current;
    const t = window.setTimeout(() => fitRef.current?.fit(), 40);

    setStatus('connecting');
    setError(null);
    disconnect();
    term.reset();
    term.writeln(`\r\n\x1b[90m连接终端 · ${projectId}…\x1b[0m\r\n`);

    const ws = new WebSocket(wsUrl(projectId));
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    const alive = () => genRef.current === gen && wsRef.current === ws;

    ws.onopen = () => {
      if (!alive()) return;
      setStatus('open');
      setError(null);
      try {
        fitRef.current?.fit();
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      } catch {
        /* ignore */
      }
    };

    ws.onmessage = (ev) => {
      if (!alive()) return;
      if (typeof ev.data === 'string') {
        try {
          const obj = JSON.parse(ev.data);
          if (obj.type === 'error') {
            setError(String(obj.error || '错误'));
            term.writeln(`\r\n\x1b[31m${obj.error}\x1b[0m\r\n`);
            return;
          }
          if (obj.type === 'ready') {
            term.writeln(`\x1b[90mcwd=${obj.cwd} · ${obj.shell}\x1b[0m\r\n`);
            return;
          }
        } catch {
          term.write(ev.data);
        }
        return;
      }
      term.write(new Uint8Array(ev.data as ArrayBuffer));
    };

    ws.onclose = () => {
      if (!alive()) return;
      setStatus('closed');
      term.writeln('\r\n\x1b[90m[连接已关闭]\x1b[0m\r\n');
    };
    ws.onerror = () => {
      if (!alive()) return;
      setError('WebSocket 错误');
      setStatus('closed');
    };

    dataSubRef.current = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    return () => {
      window.clearTimeout(t);
      if (wsRef.current === ws) disconnect();
    };
  }, [active, projectId, nonce, disconnect]);

  return (
    <div className={styles.terminalPane}>
      <div className={styles.sidePaneToolbar}>
        <span className={styles.termStatus}>
          <span
            className={`${styles.termDot} ${
              status === 'open'
                ? styles.termDotOn
                : status === 'connecting'
                  ? styles.termDotWait
                  : styles.termDotOff
            }`}
          />
          {status === 'open'
            ? '已连接'
            : status === 'connecting'
              ? '连接中…'
              : '已断开'}
        </span>
        <div className={styles.termActions}>
          <button
            type="button"
            className={styles.iconBtn}
            title="清屏"
            onClick={() => termRef.current?.clear()}
          >
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            title="重连"
            onClick={() => setNonce((n) => n + 1)}
          >
            {status === 'connecting' ? (
              <Loader2 size={14} className={styles.spin} />
            ) : (
              <RotateCcw size={14} />
            )}
          </button>
        </div>
      </div>
      {error ? <div className={styles.viewerError}>{error}</div> : null}
      <div ref={hostRef} className={styles.terminalHost} />
    </div>
  );
}
