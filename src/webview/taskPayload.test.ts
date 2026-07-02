import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTasksForWebview } from './taskPayload';

test('sanitizeTasksForWebview caps, validates, and trims task payloads', () => {
  const tasks = Array.from({ length: 30 }, (_, index) => ({
    id: `task-${index}`,
    workspace_id: 'file:///workspace',
    title: `title ${index} ${'x'.repeat(300)}`,
    created_at: `2026-07-02T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
    updated_at: `2026-07-02T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
    messages: [{ content: 'must not reach webview' }],
  }));
  tasks.push({
    id: '',
    workspace_id: 'file:///workspace',
    title: 'invalid',
    created_at: 'bad',
    updated_at: 'bad',
    messages: [],
  });

  const sanitized = sanitizeTasksForWebview(tasks, { maxTasks: 20, maxTitleChars: 80 });

  assert.equal(sanitized.length, 20);
  assert.deepEqual(Object.keys(sanitized[0]).sort(), ['created_at', 'id', 'title', 'updated_at', 'workspace_id']);
  assert.ok(sanitized.every((task) => task.title.length <= 81));
  assert.ok(sanitized.every((task) => task.id));
});
