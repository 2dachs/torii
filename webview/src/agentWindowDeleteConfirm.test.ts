import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginDeleteConfirm,
  cancelDeleteConfirm,
  confirmDelete,
  initialDeleteConfirmState,
} from './agentWindowDeleteConfirm';

test('beginDeleteConfirm marks the task as pending', () => {
  assert.deepEqual(beginDeleteConfirm('task-1'), { pendingTaskId: 'task-1' });
});

test('cancelDeleteConfirm clears the pending task', () => {
  assert.deepEqual(cancelDeleteConfirm(), { pendingTaskId: null });
});

test('confirmDelete deletes only the pending task', () => {
  const result = confirmDelete(beginDeleteConfirm('task-1'), 'task-1');
  assert.equal(result.shouldDelete, true);
  assert.deepEqual(result.next, { pendingTaskId: null });
});

test('confirmDelete rejects a task that is not pending', () => {
  const result = confirmDelete(beginDeleteConfirm('task-1'), 'task-2');
  assert.equal(result.shouldDelete, false);
  assert.deepEqual(result.next, { pendingTaskId: null });
});

test('confirmDelete rejects when nothing is pending', () => {
  const result = confirmDelete(initialDeleteConfirmState, 'task-1');
  assert.equal(result.shouldDelete, false);
});
