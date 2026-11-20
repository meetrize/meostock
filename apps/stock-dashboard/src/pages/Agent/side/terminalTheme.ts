import type { ITheme } from 'xterm';

/** 高对比深色终端主题：前景够亮，ANSI 色区分目录/可执行/链接等 */
export const AGENT_TERMINAL_THEME: ITheme = {
  background: '#1a1d24',
  foreground: '#e8eaed',
  cursor: '#e8eaed',
  cursorAccent: '#1a1d24',
  selectionBackground: '#3d4556',
  selectionForeground: '#ffffff',
  // 标准 16 色 —— brightBlack 刻意抬高，避免 \x1b[90m 在深底上看不清
  black: '#2a2e38',
  red: '#f07178',
  green: '#7fd962',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#d7dae0',
  brightBlack: '#9aa0ab',
  brightRed: '#ff8b92',
  brightGreen: '#98e87a',
  brightYellow: '#ffe082',
  brightBlue: '#8fc6ff',
  brightMagenta: '#e0b0ff',
  brightCyan: '#7ee7f0',
  brightWhite: '#ffffff',
};
