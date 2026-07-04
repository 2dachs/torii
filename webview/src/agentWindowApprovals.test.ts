import test from 'node:test';
import assert from 'node:assert/strict';
import { getPendingAgentWindowApprovals } from './agentWindowApprovals';
import type { AgentEvent } from './types';

test('getPendingAgentWindowApprovals returns unresolved approval events only', () => {
  const events: AgentEvent[] = [
    { type: 'tool_use', id: 'tool-1', tool: 'read_file', input: { path: 'a.ts' } },
    { type: 'approval_required', id: 'approve-1', tool: 'run_command', data: { command: 'npm test' } },
    { type: 'approval_required', id: 'approve-2', tool: 'write_file', data: { path: 'src/a.ts' } },
  ];

  const approvals = getPendingAgentWindowApprovals(events, new Set(['approve-1']));

  assert.deepEqual(approvals, [
    { id: 'approve-2', tool: 'write_file', data: { path: 'src/a.ts' } },
  ]);
});
