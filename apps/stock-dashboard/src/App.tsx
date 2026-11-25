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
import { AuthProvider } from './contexts/AuthProvider';
import { ImportPrefsDialog } from './components/auth/ImportPrefsDialog';

export function App() {
  return (
    <ThemeProvider>
      <AppSettingsProvider>
        <BoardDataProvider>
          <ToastProvider>
            <AuthProvider>
              <SyncStatusProvider>
                <AppRouter />
                <ImportPrefsDialog />
              </SyncStatusProvider>
            </AuthProvider>
          </ToastProvider>
        </BoardDataProvider>
      </AppSettingsProvider>
    </ThemeProvider>
  );
}
