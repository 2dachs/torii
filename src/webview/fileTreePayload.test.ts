import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldIncludeFileTreeEntry, toFileTreePayload } from './fileTreePayload';

test('shouldIncludeFileTreeEntry excludes noisy directories', () => {
  assert.equal(shouldIncludeFileTreeEntry('src'), true);
  assert.equal(shouldIncludeFileTreeEntry('.git'), false);
  assert.equal(shouldIncludeFileTreeEntry('node_modules'), false);
  assert.equal(shouldIncludeFileTreeEntry('dist'), false);
});

test('toFileTreePayload sorts directories first and caps entries', () => {
  const payload = toFileTreePayload([
    { name: 'b.ts', path: 'b.ts', type: 'file' },
    { name: 'src', path: 'src', type: 'directory' },
    { name: 'a.ts', path: 'a.ts', type: 'file' },
  ], { maxEntries: 2 });

  assert.deepEqual(payload, [
    { name: 'src', path: 'src', type: 'directory' },
    { name: 'a.ts', path: 'a.ts', type: 'file' },
  ]);
});
