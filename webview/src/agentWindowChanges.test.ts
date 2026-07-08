import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceFileChanges, initialFileChangesState } from './agentWindowChanges';
import type { AgentEvent } from './types';

test('file_change_applied appends an entry without a diff when no approval was snapshotted', () => {
  const event: AgentEvent = { type: 'file_change_applied', undoId: 'u1', path: 'src/a.ts', action: 'update' };
  const state = reduceFileChanges(initialFileChangesState, event);
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0].undoId, 'u1');
  assert.equal(state.entries[0].undone, false);
  assert.equal(state.entries[0].oldContent, undefined);
});

test('approval_required snapshot is attached to the matching file_change_applied entry by path', () => {
  const approval: AgentEvent = {
    type: 'approval_required',
    id: 'approve-1',
    tool: 'write_file',
    data: { path: 'src/a.ts', oldContent: 'old\n', newContent: 'new\n' },
  };
  const withSnapshot = reduceFileChanges(initialFileChangesState, approval);
  assert.deepEqual(withSnapshot.pendingDiffsByPath['src/a.ts'], { oldContent: 'old\n', newContent: 'new\n' });

  const applied: AgentEvent = { type: 'file_change_applied', undoId: 'u1', path: 'src/a.ts', action: 'update' };
  const state = reduceFileChanges(withSnapshot, applied);
  assert.equal(state.entries[0].oldContent, 'old\n');
  assert.equal(state.entries[0].newContent, 'new\n');
  assert.deepEqual(state.pendingDiffsByPath, {});
});

test('file_change_undone marks the matching entry undone without removing it', () => {
  const applied: AgentEvent = { type: 'file_change_applied', undoId: 'u1', path: 'src/a.ts', action: 'create' };
  const withEntry = reduceFileChanges(initialFileChangesState, applied);

  const undone: AgentEvent = { type: 'file_change_undone', undoId: 'u1', path: 'src/a.ts', ok: true, message: '元に戻しました' };
  const state = reduceFileChanges(withEntry, undone);
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0].undone, true);
});

test('unrelated events leave the state unchanged', () => {
  const state = reduceFileChanges(initialFileChangesState, { type: 'text_delta', text: 'hi' });
  assert.equal(state, initialFileChangesState);
});
