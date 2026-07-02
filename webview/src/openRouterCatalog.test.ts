import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_OPENROUTER_MODELS_RENDERED,
  getVisibleOpenRouterModels,
} from './openRouterCatalog';

test('empty OpenRouter search renders only a small initial slice', () => {
  const models = Array.from({ length: MAX_OPENROUTER_MODELS_RENDERED + 50 }, (_, index) => ({
    id: `provider/model-${index}`,
    name: `Model ${index}`,
  }));

  const visible = getVisibleOpenRouterModels(models, '');

  assert.equal(visible.length, MAX_OPENROUTER_MODELS_RENDERED);
});

test('OpenRouter search filters before applying render limit', () => {
  const models = [
    { id: 'z-ai/glm-5.2', name: 'GLM 5.2' },
    { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
    { id: 'openai/gpt-4o', name: 'GPT-4o' },
  ];

  const visible = getVisibleOpenRouterModels(models, 'glm');

  assert.deepEqual(visible, [{ id: 'z-ai/glm-5.2', name: 'GLM 5.2' }]);
});
