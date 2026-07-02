import test from 'node:test';
import assert from 'node:assert/strict';
import { InitialDataGate } from './initialDataGate';

test('InitialDataGate allows one initial send until reset', () => {
  const gate = new InitialDataGate();

  assert.equal(gate.shouldSend(), true);
  assert.equal(gate.shouldSend(), false);

  gate.reset();

  assert.equal(gate.shouldSend(), true);
  assert.equal(gate.shouldSend(), false);
});
