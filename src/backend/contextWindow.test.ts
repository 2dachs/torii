import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, getTokenLimit, buildContextWarning, WARNING_THRESHOLD } from './contextWindow';

test('estimateTokens sums text content length across messages and divides by 4', () => {
  const messages = [
    { content: [{ type: 'text', text: 'a'.repeat(40) }] },
    { content: [{ type: 'text', text: 'b'.repeat(20) }, { type: 'image', text: 'ignored' }] },
  ];
  assert.equal(estimateTokens(messages), 15);
});

test('getTokenLimit matches known model substrings and falls back to default', () => {
  assert.equal(getTokenLimit('claude-opus-4-8'), 180000);
  assert.equal(getTokenLimit('gemini-2.5-pro'), 1000000);
  assert.equal(getTokenLimit('some-unknown-model'), 60000);
});

test('buildContextWarning returns null under the warning threshold', () => {
  const limit = 1000;
  assert.equal(buildContextWarning(Math.floor(limit * WARNING_THRESHOLD) - 1, limit), null);
});

test('buildContextWarning returns numeric fields once over the warning threshold', () => {
  const limit = 1000;
  const warning = buildContextWarning(900, limit);
  assert.ok(warning);
  assert.equal(warning!.currentTokens, 900);
  assert.equal(warning!.tokenLimit, 1000);
  assert.equal(warning!.percent, 90);
  assert.match(warning!.message, /会話が長くなっています/);
});
