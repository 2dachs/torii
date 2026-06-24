import test from 'node:test';
import assert from 'node:assert/strict';
import { PromptRouter } from './router';

test('manual planning intent routes OpenRouter to the configured planning model', () => {
  const result = PromptRouter.route('この実装案をレビューしてください', 'openrouter', 'openai/gpt-4o', 0.1, false, true, [], {
    modelIntent: 'planning',
    executionMode: 'chat',
    openRouterPlanningModel: 'z-ai/glm-5.2',
    openRouterImplementationModel: 'deepseek/deepseek-v4-flash',
    customPrivacyKeywords: [],
  });

  assert.equal(result.providerId, 'openrouter');
  assert.equal(result.modelId, 'z-ai/glm-5.2');
  assert.match(result.reason, /相談/);
});

test('agent mode implementation request routes OpenRouter to the configured implementation model', () => {
  const result = PromptRouter.route('このバグを修正して', 'openrouter', 'openai/gpt-4o', 0.1, false, true, [], {
    modelIntent: 'auto',
    executionMode: 'agent',
    openRouterPlanningModel: 'z-ai/glm-5.2',
    openRouterImplementationModel: 'deepseek/deepseek-v4-flash',
    customPrivacyKeywords: [],
  });

  assert.equal(result.providerId, 'openrouter');
  assert.equal(result.modelId, 'deepseek/deepseek-v4-flash');
  assert.match(result.reason, /実装/);
});

test('privacy keywords still route to Ollama before OpenRouter intent routing', () => {
  const result = PromptRouter.route('api keyを含む設定を修正して', 'openrouter', 'openai/gpt-4o', 0.1, false, true, [], {
    modelIntent: 'implementation',
    executionMode: 'agent',
    openRouterPlanningModel: 'z-ai/glm-5.2',
    openRouterImplementationModel: 'deepseek/deepseek-v4-flash',
    customPrivacyKeywords: [],
  });

  assert.equal(result.providerId, 'ollama');
  assert.match(result.reason, /プライバシー/);
});

test('manual planning intent routes to OpenRouter even when the current provider is DeepSeek', () => {
  const result = PromptRouter.route('相談モードで考えてください', 'deepseek', 'deepseek-chat', 0.1, false, true, [], {
    modelIntent: 'planning',
    executionMode: 'chat',
    openRouterPlanningModel: 'z-ai/glm-5.2',
    openRouterImplementationModel: 'deepseek/deepseek-v4-flash',
    customPrivacyKeywords: [],
  });

  assert.equal(result.providerId, 'openrouter');
  assert.equal(result.modelId, 'z-ai/glm-5.2');
});
