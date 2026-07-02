import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRequestTasksOnToggle } from './taskLoading';

test('shouldRequestTasksOnToggle requests tasks only when opening an unloaded list', () => {
  assert.equal(shouldRequestTasksOnToggle(true, false, false), true);
  assert.equal(shouldRequestTasksOnToggle(true, true, false), false);
  assert.equal(shouldRequestTasksOnToggle(true, false, true), false);
  assert.equal(shouldRequestTasksOnToggle(false, false, false), false);
});
