import test from 'node:test';
import assert from 'node:assert/strict';
import { getAgentWindowModelIntent, getAgentWindowModelModeLabel } from './agentWindowModelMode';

test('agent window high quality implementation mode uses the planning model slot', () => {
  assert.equal(getAgentWindowModelIntent('planningImplementation'), 'planning');
  assert.match(getAgentWindowModelModeLabel('planningImplementation'), /GLM/);
});

test('agent window default model mode leaves routing on auto', () => {
  assert.equal(getAgentWindowModelIntent('auto'), 'auto');
});
