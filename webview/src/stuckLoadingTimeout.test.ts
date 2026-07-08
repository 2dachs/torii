import test from 'node:test';
import assert from 'node:assert/strict';
import { STUCK_LOADING_TIMEOUT_MS } from './stuckLoadingTimeout';

test('STUCK_LOADING_TIMEOUT_MS is 5 minutes', () => {
  assert.equal(STUCK_LOADING_TIMEOUT_MS, 5 * 60 * 1000);
});
