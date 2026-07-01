import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_AGENT_EVENT_STRING_CHARS,
  sanitizeToolInputForAgentEvent,
  sanitizeToolOutputForAgentEvent,
  truncateForAgentEvent,
} from './agentEventPayload';

test('short strings are preserved for agent events', () => {
  const result = truncateForAgentEvent('abc');

  assert.equal(result.text, 'abc');
  assert.equal(result.truncated, false);
  assert.equal(result.originalLength, 3);
});

test('large tool output is truncated before it reaches the webview', () => {
  const large = 'x'.repeat(MAX_AGENT_EVENT_STRING_CHARS * 4);
  const result = sanitizeToolOutputForAgentEvent(large);

  assert.equal(result.output.length < large.length, true);
  assert.equal(result.outputTruncated, true);
  assert.equal(result.outputOriginalLength, large.length);
  assert.match(result.output, /Webview安定化/);
});

test('large string fields in tool input are truncated', () => {
  const large = 'x'.repeat(MAX_AGENT_EVENT_STRING_CHARS * 4);
  const result = sanitizeToolInputForAgentEvent({ path: 'a.ts', content: large, count: 1 });

  assert.equal(result.path, 'a.ts');
  assert.equal(result.count, 1);
  assert.equal(typeof result.content, 'string');
  assert.equal((result.content as string).length < large.length, true);
});
