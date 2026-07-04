import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAgentWindowPromptWithFileMentions,
  toFileMentionPayload,
} from './agentWindowMentionContext';

test('toFileMentionPayload filters files by path or name and caps results', () => {
  const payload = toFileMentionPayload([
    { name: 'AgentWindow.tsx', path: 'webview/src/AgentWindow.tsx', type: 'file' },
    { name: 'agent-window.css', path: 'webview/src/agent-window.css', type: 'file' },
    { name: 'src', path: 'src', type: 'directory' },
    { name: 'README.md', path: 'README.md', type: 'file' },
  ], 'agent', { maxEntries: 1 });

  assert.deepEqual(payload, [
    { name: 'agent-window.css', path: 'webview/src/agent-window.css' },
  ]);
});

test('buildAgentWindowPromptWithFileMentions appends selected file contents with truncation notes', () => {
  const prompt = buildAgentWindowPromptWithFileMentions('修正して', [
    { path: 'src/a.ts', content: 'abcdef', truncated: true, originalLength: 6 },
  ], { maxCharsPerFile: 4 });

  assert.equal(prompt, [
    '修正して',
    '',
    '---',
    '添付ファイル:',
    '',
    '### src/a.ts',
    '```',
    'abcd',
    '```',
    '※ ファイルが大きいため先頭4文字のみ添付しています（元サイズ: 6文字）。',
  ].join('\n'));
});
