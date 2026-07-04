import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMentionedFile,
  getActiveFileMentionQuery,
  insertMentionToken,
} from './agentWindowMentions';

test('getActiveFileMentionQuery returns the current trailing at-token query', () => {
  assert.equal(getActiveFileMentionQuery('直して @webview/src'), 'webview/src');
  assert.equal(getActiveFileMentionQuery('@src/App'), 'src/App');
  assert.equal(getActiveFileMentionQuery('直して @webview/src '), null);
  assert.equal(getActiveFileMentionQuery('メール a@example.com'), null);
});

test('insertMentionToken replaces the active trailing query with a file token', () => {
  assert.equal(
    insertMentionToken('確認して @web', 'webview/src/AgentWindow.tsx'),
    '確認して @webview/src/AgentWindow.tsx ',
  );
  assert.equal(
    insertMentionToken('確認して', 'src/extension.ts'),
    '確認して @src/extension.ts ',
  );
});

test('addMentionedFile deduplicates selected files and caps the list', () => {
  const selected = addMentionedFile(
    [
      { path: 'a.ts', name: 'a.ts' },
      { path: 'b.ts', name: 'b.ts' },
    ],
    { path: 'a.ts', name: 'a.ts' },
    2,
  );
  assert.deepEqual(selected, [
    { path: 'a.ts', name: 'a.ts' },
    { path: 'b.ts', name: 'b.ts' },
  ]);

  assert.deepEqual(addMentionedFile(selected, { path: 'c.ts', name: 'c.ts' }, 2), selected);
});
