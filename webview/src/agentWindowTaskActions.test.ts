import test from 'node:test';
import assert from 'node:assert/strict';
import { beginNewAgentWindowTask } from './agentWindowTaskActions';

test('beginNewAgentWindowTask clears the active task so the next send can auto-create a titled task', () => {
  const state = beginNewAgentWindowTask({
    activeTaskId: 'existing',
    messages: [{ id: 'm1', role: 'assistant', content: 'old' }],
    loading: true,
    streamingText: 'draft',
    agentEvents: [{ type: 'thinking_start', iteration: 1 }],
    blockedOwner: 'sidebar',
  });

  assert.equal(state.activeTaskId, null);
  assert.deepEqual(state.messages, []);
  assert.equal(state.loading, false);
  assert.equal(state.streamingText, '');
  assert.deepEqual(state.agentEvents, []);
  assert.equal(state.blockedOwner, null);
});
