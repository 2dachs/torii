import type { Mode, ModelConfig } from '@irori/core';

export const MODEL_OPTIONS: Record<Mode, ModelConfig[]> = {
  quick: [
    {
      id: 'quick-deepseek-v4-flash',
      provider: 'openrouter',
      displayName: 'DeepSeek V4 Flash',
      modelSlug: 'deepseek/deepseek-v4-flash',
      inputPricePerMillionTokens: 0.09,
      outputPricePerMillionTokens: 0.18,
      contextWindow: 1048576,
      enabled: true,
    },
  ],
  standard: [
    {
      id: 'standard-deepseek-v4-pro',
      provider: 'openrouter',
      displayName: 'DeepSeek V4 Pro',
      modelSlug: 'deepseek/deepseek-v4-pro',
      inputPricePerMillionTokens: 0.435,
      outputPricePerMillionTokens: 0.87,
      contextWindow: 1048576,
      enabled: true,
    },
    {
      id: 'standard-gpt-4o',
      provider: 'openrouter',
      displayName: 'GPT-4o',
      modelSlug: 'openai/gpt-4o',
      inputPricePerMillionTokens: 2.5,
      outputPricePerMillionTokens: 10,
      contextWindow: 128000,
      enabled: true,
    },
  ],
  deep: [
    {
      id: 'deep-fugu',
      provider: 'sakana',
      displayName: 'Fugu',
      modelSlug: 'fugu',
      inputPricePerMillionTokens: 4,
      outputPricePerMillionTokens: 12,
      contextWindow: 128000,
      enabled: true,
    },
    {
      id: 'deep-fusion',
      provider: 'openrouter',
      displayName: 'OpenRouter Fusion',
      modelSlug: 'openrouter/fusion',
      inputPricePerMillionTokens: 0,
      outputPricePerMillionTokens: 0,
      contextWindow: 1000000,
      enabled: true,
    },
    {
      id: 'deep-opus-4-8',
      provider: 'openrouter',
      displayName: 'Claude Opus 4.8',
      modelSlug: 'anthropic/claude-opus-4.8',
      inputPricePerMillionTokens: 5,
      outputPricePerMillionTokens: 25,
      contextWindow: 1000000,
      enabled: true,
    },
  ],
};

export const DEFAULT_MODEL_CONFIGS: Record<Mode, ModelConfig> = {
  quick: MODEL_OPTIONS.quick[0],
  standard: MODEL_OPTIONS.standard[0],
  deep: MODEL_OPTIONS.deep[0],
};

export function resolveModelConfig(mode: Mode, modelSlug: string): ModelConfig {
  return MODEL_OPTIONS[mode].find((option) => option.modelSlug === modelSlug) ?? {
    ...DEFAULT_MODEL_CONFIGS[mode],
    id: `${mode}-custom`,
    displayName: modelSlug,
    modelSlug,
  };
}

export const MODE_COPY = {
  quick: { label: 'Quick', description: '速く・安く回答します' },
  standard: { label: 'Standard', description: '精度とコストのバランスを取ります' },
  deep: { label: 'Deep', description: '設計・レビュー・反証など、深い思考に使います' },
} as const satisfies Record<Mode, { label: string; description: string }>;
