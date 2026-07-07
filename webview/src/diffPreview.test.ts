import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInlineDiffPreview, formatDiffLines, splitDiffLines } from './diffPreview';

test('splitDiffLines normalizes CRLF and trims terminal blank lines', () => {
  assert.deepEqual(splitDiffLines('a\r\nb\r\n'), ['a', 'b']);
});

test('buildInlineDiffPreview isolates the changed middle lines', () => {
  const preview = buildInlineDiffPreview('alpha\nbeta\ngamma\n', 'alpha\nbravo\ngamma\n');

  assert.equal(preview.isChanged, true);
  assert.equal(preview.prefix, 1);
  assert.equal(preview.suffix, 1);
  assert.deepEqual(preview.originalChanged, ['beta']);
  assert.deepEqual(preview.nextChanged, ['bravo']);
});

test('formatDiffLines numbers the preview rows', () => {
  assert.equal(formatDiffLines(['alpha', 'beta'], 12, '+ '), '+   12 | alpha\n+   13 | beta');
  assert.equal(formatDiffLines([], 1, '- '), '（なし）');
});
