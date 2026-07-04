import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAgentWindowMessage } from './agentWindowState';
import type { ChatMessage, Task } from './types';

const task = (id: string): Task => ({
  id,
  workspace_id: 'file:///workspace',
  title: `Task ${id}`,
  created_at: '2026-07-03T00:00:00.000Z',
  updated_at: '2026-07-03T00:00:00.000Z',
});

const message = (id: string, taskId: string): ChatMessage => ({
  id,
  workspace_id: 'file:///workspace',
  task_id: taskId,
  role: 'assistant',
  content: `Message ${id}`,
  tokens_used: 0,
  cost_usd: 0,
  cost_jpy: 0,
  created_at: '2026-07-03T00:00:00.000Z',
});

const initialState = (overrides = {}) => ({
  tasks: [],
  activeTaskId: null,
  messages: [],
  tasksLoaded: false,
  tasksLoading: false,
  loading: false,
  streamingText: '',
  agentEvents: [],
  ...overrides,
});

test('applyAgentWindowMessage selects the first task when the current task is missing', () => {
  const state = applyAgentWindowMessage(
    initialState({ activeTaskId: 'missing', tasksLoading: true }),
    { command: 'loadTasks', data: [task('a'), task('b')] },
  );

  assert.equal(state.activeTaskId, 'a');
  assert.equal(state.tasksLoaded, true);
  assert.equal(state.tasksLoading, false);
  assert.deepEqual(state.nextCommands, [{ command: 'loadChatHistory', taskId: 'a' }]);
});

test('applyAgentWindowMessage keeps the current task and stores chat history', () => {
  const loadedMessage = message('m1', 'b');
  const state = applyAgentWindowMessage(
    initialState({ tasks: [task('a'), task('b')], activeTaskId: 'b', tasksLoaded: true }),
    { command: 'loadChatHistory', data: [loadedMessage] },
  );

  assert.equal(state.activeTaskId, 'b');
  assert.deepEqual(state.messages, [loadedMessage]);
  assert.deepEqual(state.nextCommands, []);
});

test('applyAgentWindowMessage selects a newly created task before the refreshed list arrives', () => {
  const state = applyAgentWindowMessage(
    initialState({ tasks: [task('a')], activeTaskId: 'a', messages: [message('m1', 'a')], tasksLoaded: true }),
    { command: 'agentWindowTaskCreated', taskId: 'new-task' } as any,
  );

  assert.equal(state.activeTaskId, 'new-task');
  assert.deepEqual(state.messages, []);
  assert.deepEqual(state.nextCommands, []);
});

test('applyAgentWindowMessage accumulates text deltas and clears loading on done', () => {
  const withDelta = applyAgentWindowMessage(
    initialState({ loading: true }),
    { command: 'agentEvent', event: { type: 'text_delta', text: 'hello' } } as any,
  );

  assert.equal(withDelta.streamingText, 'hello');
  assert.equal(withDelta.loading, true);

  const done = applyAgentWindowMessage(
    withDelta,
    { command: 'agentEvent', event: { type: 'done', iterations: 1, tokensUsed: 10, costUsd: 0.01, costJpy: 1.5 } } as any,
  );

  assert.equal(done.loading, false);
  assert.equal(done.streamingText, '');
  assert.equal(done.agentEvents[done.agentEvents.length - 1]?.type, 'done');
  assert.deepEqual(done.nextCommands, []);
});

test('applyAgentWindowMessage syncs auto-created agent task ids', () => {
  const state = applyAgentWindowMessage(
    initialState({ loading: true }),
    { command: 'agentEvent', event: { type: 'task_created', taskId: 'agent-task' } } as any,
  );

  assert.equal(state.activeTaskId, 'agent-task');
  assert.deepEqual(state.nextCommands, [{ command: 'loadChatHistory', taskId: 'agent-task' }]);
});

test('applyAgentWindowMessage reloads active task history when an agent run finishes', () => {
  const state = applyAgentWindowMessage(
    initialState({ activeTaskId: 'active-task', loading: true, streamingText: 'answer' }),
    { command: 'agentEvent', event: { type: 'done', iterations: 2, tokensUsed: 10, costUsd: 0.01, costJpy: 1.5 } } as any,
  );

  assert.equal(state.loading, false);
  assert.equal(state.streamingText, 'answer');
  assert.deepEqual(state.nextCommands, [{ command: 'loadChatHistory', taskId: 'active-task' }]);
});

test('applyAgentWindowMessage clears loading when another surface owns the agent run', () => {
  const state = applyAgentWindowMessage(
    initialState({ loading: true, streamingText: 'pending' }),
    { command: 'agentRunBlocked', owner: 'sidebar', taskId: 'task-1' } as any,
  );

  assert.equal(state.loading, false);
  assert.equal(state.streamingText, '');
  assert.equal(state.blockedOwner, 'sidebar');
});
