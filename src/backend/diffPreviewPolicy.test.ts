import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIFF_PREVIEW_MAX_TOTAL_CHARS,
  DIFF_PREVIEW_MAX_TOTAL_LINES,
  getDiffPreviewDecision,
} from './diffPreviewPolicy';

test('small file changes open the VS Code diff preview', () => {
  const decision = getDiffPreviewDecision('const a = 1;\n', 'const a = 2;\n');

  assert.equal(decision.openDiff, true);
  assert.equal(decision.reason, undefined);
});

test('large content changes skip the VS Code diff preview', () => {
  const large = 'x'.repeat(DIFF_PREVIEW_MAX_TOTAL_CHARS + 1);
  const decision = getDiffPreviewDecision('', large);

  assert.equal(decision.openDiff, false);
  assert.match(decision.reason ?? '', /差分が大きい/);
});

test('many-line changes skip the VS Code diff preview', () => {
  const manyLines = `${'x\n'.repeat(DIFF_PREVIEW_MAX_TOTAL_LINES + 1)}`;
  const decision = getDiffPreviewDecision('', manyLines);

  assert.equal(decision.openDiff, false);
  assert.match(decision.reason ?? '', /差分が大きい/);
});
