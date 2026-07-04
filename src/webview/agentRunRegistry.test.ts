import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRunRegistry } from './agentRunRegistry';

test('AgentRunRegistry blocks a second owner for the same task', () => {
  const registry = new AgentRunRegistry();

  const first = registry.tryStart('task-1', 'agentWindow');
  const second = registry.tryStart('task-1', 'sidebar');

  assert.equal(first.ok, true);
  assert.deepEqual(second, { ok: false, owner: 'agentWindow' });
});

test('AgentRunRegistry allows different tasks and releases only matching owners', () => {
  const registry = new AgentRunRegistry();

  assert.equal(registry.tryStart('task-1', 'agentWindow').ok, true);
  assert.equal(registry.tryStart('task-2', 'sidebar').ok, true);

  registry.finish('task-1', 'sidebar');
  assert.deepEqual(registry.tryStart('task-1', 'sidebar'), { ok: false, owner: 'agentWindow' });

  registry.finish('task-1', 'agentWindow');
  assert.equal(registry.tryStart('task-1', 'sidebar').ok, true);
});

test('AgentRunRegistry moves a new-task run to the server-created task id', () => {
  const registry = new AgentRunRegistry();

  assert.equal(registry.tryStart(null, 'agentWindow').ok, true);
  registry.move(null, 'task-created-by-server', 'agentWindow');

  assert.equal(registry.tryStart(null, 'sidebar').ok, true);
  assert.deepEqual(registry.tryStart('task-created-by-server', 'sidebar'), { ok: false, owner: 'agentWindow' });
});
