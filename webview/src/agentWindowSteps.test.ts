import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceAgentSteps, MAX_AGENT_STEPS, type AgentStep } from './agentWindowSteps';
import type { AgentEvent } from './types';

test('tool_use appends a running step with label/kind/detail derived from the tool', () => {
  const event: AgentEvent = { type: 'tool_use', id: 't1', tool: 'read_file', input: { path: 'src/App.tsx' } };
  const steps = reduceAgentSteps([], event);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].id, 't1');
  assert.equal(steps[0].kind, 'read');
  assert.equal(steps[0].status, 'running');
  assert.equal(steps[0].detail, 'src/App.tsx');
  assert.equal(steps[0].label, 'ファイル読み込み中');
});

test('unknown tool falls back to kind "other" and the raw tool name as label', () => {
  const event: AgentEvent = { type: 'tool_use', id: 't1', tool: 'attempt_completion', input: {} };
  const steps = reduceAgentSteps([], event);
  assert.equal(steps[0].kind, 'other');
  assert.equal(steps[0].label, 'attempt_completion');
});

test('tool_result matches by id and transitions running -> done', () => {
  const running: AgentStep[] = [{ id: 't1', kind: 'read', tool: 'read_file', label: 'x', status: 'running' }];
  const event: AgentEvent = { type: 'tool_result', id: 't1', tool: 'read_file', ok: true, output: 'contents' };
  const steps = reduceAgentSteps(running, event);
  assert.equal(steps[0].status, 'done');
  assert.equal(steps[0].resultSummary, undefined);
});

test('tool_result with ok=false transitions to failed and keeps a truncated result summary', () => {
  const running: AgentStep[] = [{ id: 't1', kind: 'command', tool: 'run_command', label: 'x', status: 'running' }];
  const event: AgentEvent = { type: 'tool_result', id: 't1', tool: 'run_command', ok: false, output: 'boom'.repeat(100) };
  const steps = reduceAgentSteps(running, event);
  assert.equal(steps[0].status, 'failed');
  assert.equal(steps[0].resultSummary?.length, 200);
});

test('file_change_applied appends a done step carrying undoId', () => {
  const event: AgentEvent = { type: 'file_change_applied', undoId: 'u1', path: 'src/foo.ts', action: 'update' };
  const steps = reduceAgentSteps([], event);
  assert.equal(steps[0].status, 'done');
  assert.equal(steps[0].undoId, 'u1');
  assert.equal(steps[0].kind, 'write');
});

test('file_change_undone updates the matching entry without removing it', () => {
  const applied: AgentStep[] = [{ id: 'u1', kind: 'write', tool: 'write_file', label: 'x', status: 'done', undoId: 'u1' }];
  const event: AgentEvent = { type: 'file_change_undone', undoId: 'u1', path: 'src/foo.ts', ok: true, message: '元に戻しました' };
  const steps = reduceAgentSteps(applied, event);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].resultSummary, '元に戻しました');
});

test('step list is capped at MAX_AGENT_STEPS', () => {
  let steps: AgentStep[] = [];
  for (let i = 0; i < MAX_AGENT_STEPS + 10; i += 1) {
    steps = reduceAgentSteps(steps, { type: 'tool_use', id: `t${i}`, tool: 'read_file', input: {} });
  }
  assert.equal(steps.length, MAX_AGENT_STEPS);
  assert.equal(steps[steps.length - 1].id, `t${MAX_AGENT_STEPS + 9}`);
});

test('events unrelated to steps leave the list unchanged', () => {
  const steps: AgentStep[] = [{ id: 't1', kind: 'read', tool: 'read_file', label: 'x', status: 'running' }];
  const next = reduceAgentSteps(steps, { type: 'text_delta', text: 'hi' });
  assert.equal(next, steps);
});
