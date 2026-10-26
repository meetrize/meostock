import { Component, type ErrorInfo, type ReactNode } from 'react';
import styles from './ErrorBoundary.module.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Render error:', error, info.componentStack);
  }

  handleRetry = (): void => {
    this.setState({ error: null });
  };

  handleHardReload = (): void => {
    const url = new URL(window.location.href);
    url.searchParams.set('_r', String(Date.now()));
    window.location.replace(url.toString());
  };

  render() {
    if (this.state.error) {
      const msg = this.state.error.message || '';
      const isModuleFail = /importing a module script failed/i.test(msg);
      return (
        <div className={styles.boundary}>
          <h3 className={styles.title}>页面渲染出错</h3>
          <p className={styles.message}>{msg}</p>
          {isModuleFail && (
            <p className={styles.message}>
              多半是浏览器缓存了旧的前端资源。请点「强制刷新」，或使用 Cmd+Shift+R。
            </p>
          )}
          <button className={styles.retryBtn} onClick={this.handleRetry}>
            重试
          </button>
          <button className={styles.retryBtn} onClick={this.handleHardReload} style={{ marginLeft: 8 }}>
            强制刷新
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
