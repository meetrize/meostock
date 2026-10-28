/**
 * 应用根组件
 */

import { AppRouter } from './router';
import { ToastProvider } from './components/common';
import {
  ThemeProvider,
  AppSettingsProvider,
  BoardDataProvider,
  SyncStatusProvider,
} from './contexts';

export function App() {
  return (
    <ThemeProvider>
      <AppSettingsProvider>
        <BoardDataProvider>
          <ToastProvider>
            <SyncStatusProvider>
              <AppRouter />
            </SyncStatusProvider>
          </ToastProvider>
        </BoardDataProvider>
      </AppSettingsProvider>
    </ThemeProvider>
  );
}
