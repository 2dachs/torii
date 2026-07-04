import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTaskReminderForToolResult, TASK_REMINDER } from './toolResultReminder';

test('appendTaskReminderForToolResult does not append internal reminder to attempt_completion output', () => {
  const result = appendTaskReminderForToolResult('attempt_completion', 'レビュー結果です');

  assert.equal(result, 'レビュー結果です');
});

test('appendTaskReminderForToolResult keeps reminder on intermediate string tool outputs', () => {
  const result = appendTaskReminderForToolResult('read_file', 'file content');

  assert.equal(result, `file content${TASK_REMINDER}`);
});
