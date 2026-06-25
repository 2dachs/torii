import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateCost, estimateTokens, routeMessage } from './index.js';
import type { ModelConfig } from './index.js';

const modelConfigs = {
  quick: {
    id: 'quick',
    provider: 'openrouter',
    displayName: 'DeepSeek V4 Flash',
    modelSlug: 'deepseek/deepseek-v4-flash',
    inputPricePerMillionTokens: 0.14,
    outputPricePerMillionTokens: 0.28,
    contextWindow: 64000,
    enabled: true,
  },
  standard: {
    id: 'standard',
    provider: 'openrouter',
    displayName: 'DeepSeek V4 Pro',
    modelSlug: 'deepseek/deepseek-v4-pro',
    inputPricePerMillionTokens: 1.74,
    outputPricePerMillionTokens: 3.48,
    contextWindow: 128000,
    enabled: true,
  },
  deep: {
    id: 'deep',
    provider: 'sakana',
    displayName: 'Fugu',
    modelSlug: 'fugu',
    inputPricePerMillionTokens: 4,
    outputPricePerMillionTokens: 12,
    contextWindow: 128000,
    enabled: true,
  },
} satisfies Record<'quick' | 'standard' | 'deep', ModelConfig>;

describe('estimateTokens', () => {
  it('estimates Japanese text more densely than English text', () => {
    assert.equal(estimateTokens('こんにちは'), 7);
    assert.equal(estimateTokens('hello world'), 3);
  });
});

describe('calculateCost', () => {
  it('calculates input and output cost per million tokens', () => {
    assert.equal(calculateCost(1_000_000, 500_000, 2, 6), 5);
  });
});

describe('routeMessage', () => {
  it('selects the configured model and requires confirmation for deep mode', () => {
    const decision = routeMessage({
      mode: 'deep',
      text: '設計レビューをしてください',
      modelConfigs,
      perRunCostLimit: 1,
      deepConfirmationEnabled: true,
    });

    assert.equal(decision.selectedModel.displayName, 'Fugu');
    assert.equal(decision.requiresConfirmation, true);
    assert.match(decision.reason, /Deep/);
  });
});
