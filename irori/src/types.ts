export type Mode = 'quick' | 'standard' | 'deep';

export type ProviderKind = 'openrouter' | 'sakana' | 'openai' | 'anthropic' | 'google' | 'local';

export interface ModelConfig {
  id: string;
  provider: ProviderKind;
  displayName: string;
  modelSlug: string;
  inputPricePerMillionTokens: number;
  outputPricePerMillionTokens: number;
  contextWindow: number;
  enabled: boolean;
}

export interface RouteDecision {
  mode: Mode;
  selectedModel: ModelConfig;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCost: number;
  requiresConfirmation: boolean;
  reason: string;
}

export interface UsageLog {
  projectId: string;
  conversationId: string;
  model: string;
  mode: Mode;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  actualCost: number;
  latencyMs: number;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  mode: Mode;
  createdAt: string;
  updatedAt: string;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  model?: string | null;
  modelDisplayName?: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  actualCost: number;
  latencyMs: number;
  createdAt: string;
}

export interface AppSettings {
  id: string;
  openRouterApiKey: string;
  tavilyApiKey: string;
  tavilySearchDepth: string;
  tavilyMaxResults: number;
  quickModelSlug: string;
  standardModelSlug: string;
  deepModelSlug: string;
  monthlyBudgetJpy: number;
  jpyPerUsd: number;
  quickInputPricePerMillionTokens: number;
  quickOutputPricePerMillionTokens: number;
  standardInputPricePerMillionTokens: number;
  standardOutputPricePerMillionTokens: number;
  deepInputPricePerMillionTokens: number;
  deepOutputPricePerMillionTokens: number;
  deepConfirmationEnabled: boolean;
  perRunCostLimit: number;
  activeProjectId: string | null;
  activeConversationId: string | null;
  updatedAt: string;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCost: number;
  totalActualCost: number;
  totalLatencyMs: number;
}

export interface BootstrapPayload {
  projects: Project[];
  conversations: Conversation[];
  messages: Message[];
  settings: AppSettings;
  modelConfigs: Record<Mode, ModelConfig>;
  activeProjectId: string | null;
  activeConversationId: string | null;
  monthlyUsageSummary: UsageSummary;
  usageSummary: UsageSummary;
}

export interface SendMessageArgs {
  projectId: string;
  conversationId: string;
  mode: Mode;
  content: string;
}

export interface SendMessageResult {
  snapshot: BootstrapPayload;
  decision: RouteDecision;
  assistantMessage: Message;
  usageLog: UsageLog;
}

export interface SettingsUpdate {
  openRouterApiKey?: string;
  tavilyApiKey?: string;
  tavilySearchDepth?: string;
  tavilyMaxResults?: number;
  quickModelSlug?: string;
  standardModelSlug?: string;
  deepModelSlug?: string;
  monthlyBudgetJpy?: number;
  jpyPerUsd?: number;
  quickInputPricePerMillionTokens?: number;
  quickOutputPricePerMillionTokens?: number;
  standardInputPricePerMillionTokens?: number;
  standardOutputPricePerMillionTokens?: number;
  deepInputPricePerMillionTokens?: number;
  deepOutputPricePerMillionTokens?: number;
  deepConfirmationEnabled?: boolean;
  perRunCostLimit?: number;
  activeProjectId?: string | null;
  activeConversationId?: string | null;
}
