import test from 'node:test';
import assert from 'node:assert/strict';
import { stripAgentInternalReminder } from './agentWindowMessageText';

test('stripAgentInternalReminder removes the internal reminder from stored assistant messages', () => {
  const text = 'レビュー結果です\n\n[REMINDER: 元のタスクに集中し、完了までツールを使い続けよ。attempt_completion を呼ぶまで停止するな。]';

  assert.equal(stripAgentInternalReminder(text), 'レビュー結果です');
});
