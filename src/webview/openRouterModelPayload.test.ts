import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_OPENROUTER_MODELS_FOR_WEBVIEW,
  sanitizeOpenRouterModelsForWebview,
} from './openRouterModelPayload';

test('sanitizes and caps OpenRouter model payload before posting to the webview', () => {
  const largeDescription = 'x'.repeat(50_000);
  const raw = {
    data: Array.from({ length: MAX_OPENROUTER_MODELS_FOR_WEBVIEW + 50 }, (_, index) => ({
      id: `provider/model-${index}`,
      name: `Model ${index}`,
      description: largeDescription,
      pricing: { prompt: '0.000001', completion: '0.000002', internal: largeDescription },
      architecture: { input_modalities: ['text', 'image'], tokenizer: largeDescription },
      context_length: 1000 + index,
      created: index,
    })),
  };

  const sanitized = sanitizeOpenRouterModelsForWebview(raw);

  assert.equal(sanitized.data.length, MAX_OPENROUTER_MODELS_FOR_WEBVIEW);
  assert.deepEqual(Object.keys(sanitized.data[0]).sort(), [
    'architecture',
    'context_length',
    'created',
    'id',
    'name',
    'pricing',
  ]);
  assert.deepEqual(sanitized.data[0].architecture, { input_modalities: ['text', 'image'] });
  assert.deepEqual(sanitized.data[0].pricing, { prompt: '0.000001', completion: '0.000002' });
  assert.equal(JSON.stringify(sanitized).includes(largeDescription), false);
});
