import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

let registered = false;

function ensureLanguages(): void {
  if (registered) return;
  registered = true;
  hljs.registerLanguage('bash', bash);
  hljs.registerLanguage('css', css);
  hljs.registerLanguage('dockerfile', dockerfile);
  hljs.registerLanguage('go', go);
  hljs.registerLanguage('ini', ini);
  hljs.registerLanguage('java', java);
  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('json', json);
  hljs.registerLanguage('markdown', markdown);
  hljs.registerLanguage('python', python);
  hljs.registerLanguage('rust', rust);
  hljs.registerLanguage('sql', sql);
  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('xml', xml);
  hljs.registerLanguage('yaml', yaml);
  // aliases used by path mapping
  hljs.registerLanguage('tsx', typescript);
  hljs.registerLanguage('jsx', javascript);
  hljs.registerLanguage('shell', bash);
  hljs.registerLanguage('sh', bash);
  hljs.registerLanguage('zsh', bash);
  hljs.registerLanguage('html', xml);
  hljs.registerLanguage('svg', xml);
  hljs.registerLanguage('toml', ini);
}

const EXT_LANG: Record<string, string> = {
  py: 'python',
  pyi: 'python',
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'css',
  less: 'css',
  md: 'markdown',
  mdx: 'markdown',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  conf: 'ini',
  env: 'ini',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'svg',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
  java: 'java',
  dockerfile: 'dockerfile',
};

const NAME_LANG: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'bash',
  'cmakelists.txt': 'bash',
  '.gitignore': 'ini',
  '.dockerignore': 'ini',
  '.env': 'ini',
  '.env.example': 'ini',
  '.cursorrules': 'markdown',
};

const MAX_HIGHLIGHT_CHARS = 80_000;

export function languageFromPath(path: string): string | null {
  const base = path.split('/').pop()?.toLowerCase() || '';
  if (NAME_LANG[base]) return NAME_LANG[base];
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1);
  return EXT_LANG[ext] || null;
}

export type HighlightResult = {
  language: string | null;
  html: string | null;
};

/** 返回 HTML（已转义并由 hljs 着色）；过大或未知语言则 html=null，调用方用纯文本。 */
export function highlightCode(path: string, content: string): HighlightResult {
  const language = languageFromPath(path);
  if (!language || content.length > MAX_HIGHLIGHT_CHARS) {
    return { language, html: null };
  }
  ensureLanguages();
  try {
    const result = hljs.highlight(content, {
      language,
      ignoreIllegals: true,
    });
    return { language, html: result.value };
  } catch {
    return { language, html: null };
  }
}
