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
};

export type AgentArtifact = {
  type?: string;
  path?: string;
  absPath?: string;
  scope?: string;
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

export const AGENT_SESSIONS_KEY = 'stock-dashboard:agent-sessions:v1';
export const AGENT_ACTIVE_KEY = 'stock-dashboard:agent-active:v1';
