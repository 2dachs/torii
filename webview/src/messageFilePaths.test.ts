import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMessageFilePaths } from './messageFilePaths';

test('extractMessageFilePaths finds code fence paths and explicit relative paths once', () => {
  const content = [
    '```typescript:src/App.tsx',
    'const x = 1;',
    '```',
    'See ./src/App.tsx and ../README.md.',
  ].join('\n');

  assert.deepEqual(extractMessageFilePaths(content), [
    'src/App.tsx',
    './src/App.tsx',
    '../README.md',
  ]);
});

test('extractMessageFilePaths ignores long dotted strings without regex backtracking', () => {
  const content = `${'./'.repeat(5000)}not-a-file ${'a.'.repeat(5000)}`;

  assert.deepEqual(extractMessageFilePaths(content), []);
});
