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
