import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentEventBatch, shouldBatchAgentEvent } from './agentEventBatch';

test('shouldBatchAgentEvent batches only high-frequency tool progress events', () => {
  assert.equal(shouldBatchAgentEvent({ type: 'tool_use' }), true);
  assert.equal(shouldBatchAgentEvent({ type: 'tool_result' }), true);
  assert.equal(shouldBatchAgentEvent({ type: 'approval_required' }), false);
  assert.equal(shouldBatchAgentEvent({ type: 'done' }), false);
  assert.equal(shouldBatchAgentEvent({ type: 'error' }), false);
});

test('AgentEventBatch flushes pending events as one postMessage payload', () => {
  const posted: unknown[][] = [];
  const batch = new AgentEventBatch((events) => posted.push(events));

  batch.push({ type: 'tool_use', id: '1' });
  batch.push({ type: 'tool_result', id: '1' });

  assert.equal(batch.size, 2);
  batch.flush();

  assert.equal(batch.size, 0);
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0].map((event: any) => event.type), ['tool_use', 'tool_result']);
});
