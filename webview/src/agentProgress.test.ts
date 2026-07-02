import test from 'node:test';
import assert from 'node:assert/strict';
import { appendVisibleAgentSteps, summarizeToolInputForUi } from './agentProgress';
import type { AgentEvent } from './types';

test('appendVisibleAgentSteps keeps only visible progress events and caps count', () => {
  const events = Array.from({ length: 45 }, (_, index) => ({
    type: index % 2 === 0 ? 'tool_use' : 'tool_result',
    id: String(index),
    tool: 'read_file',
    input: { path: `/tmp/file-${index}.ts` },
    ok: true,
    output: 'ok',
  } as AgentEvent));

  const steps = appendVisibleAgentSteps([], events, 30);

  assert.equal(steps.length, 30);
  assert.equal((steps[0] as any).id, '15');
  assert.equal((steps[29] as any).id, '44');
});

test('summarizeToolInputForUi keeps only short display fields', () => {
  const input = {
    path: '/tmp/example.ts',
    command: 'npm test',
    content: 'x'.repeat(10_000),
    nested: { keep: false },
  };

  const summarized = summarizeToolInputForUi(input);

  assert.deepEqual(summarized, {
    path: '/tmp/example.ts',
    command: 'npm test',
  });
});
