export type AgentEntity = {
  name: string;
  code: string;
  klineSymbol: string;
  klineUrl: string;
  market?: string;
};

export type ToolEvent = {
  id: string;
  tool: string;
  arguments?: string;
  result?: unknown;
  status: 'running' | 'done' | 'error';
  /** 展示用轮次（从 1 起） */
  round?: number;
};

export type AiProfileOption = {
  id: string;
  name: string;
  provider?: string;
  model?: string;
  active?: boolean;
};

export type AgentArtifact = {
  type?: string;
  path?: string;
  absPath?: string;
  scope?: string;
  /** 打开文件时使用的目标项目（相对 path 相对该项目根） */
  projectId?: string;
  ok?: boolean;
  id?: string;
  status?: string;
  summary?: string;
  commitMessage?: string;
  files?: string[];
  diffStat?: string;
};

export type AcceptanceInfo = {
  id: string;
  status: string;
  summary?: string;
  commitMessage?: string;
  files?: string[];
  diffStat?: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  contentLinked?: string;
  ts: number;
  intent?: string;
  skillId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  permission?: string;
  tools?: ToolEvent[];
  entities?: AgentEntity[];
  artifacts?: AgentArtifact[];
  acceptance?: AcceptanceInfo | null;
  error?: string;
};

export type AgentSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
};

export type CuratedPrompt = {
  id: string;
  title: string;
  category: string;
  description: string;
  prompt: string;
  skillId: string | null;
};

export type AgentProject = {
  id: string;
  name: string;
  kind: 'repo' | 'workspace' | string;
  path: string;
  description?: string;
  fileCount?: number | null;
  updatedAt?: number | null;
  source?: string;
};

export type AgentSkill = {
  id: string;
  title: string;
  description: string;
  intent: string;
  tools: string[];
  userHint?: string;
  permission?: string;
};

export const AGENT_SESSIONS_KEY = 'stock-dashboard:agent-sessions:v1';
export const AGENT_ACTIVE_KEY = 'stock-dashboard:agent-active:v1';
export const AGENT_PROJECT_KEY = 'stock-dashboard:agent-project:v1';
