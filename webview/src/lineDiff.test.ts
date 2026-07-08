import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLineDiff, buildLineDiffPreview, LINE_DIFF_MYERS_MAX_BLOCK_LINES } from './lineDiff';

function applyOps(oldLines: string[], newLines: string[]): { rebuiltOld: string[]; rebuiltNew: string[] } {
  const ops = computeLineDiff(oldLines, newLines);
  const rebuiltOld: string[] = [];
  const rebuiltNew: string[] = [];
  for (const op of ops) {
    if (op.type === 'equal') { rebuiltOld.push(op.line); rebuiltNew.push(op.line); }
    if (op.type === 'remove') rebuiltOld.push(op.line);
    if (op.type === 'add') rebuiltNew.push(op.line);
  }
  return { rebuiltOld, rebuiltNew };
}

test('computeLineDiff on identical inputs produces only equal ops', () => {
  const lines = ['a', 'b', 'c'];
  const ops = computeLineDiff(lines, lines);
  assert.ok(ops.every((op) => op.type === 'equal'));
  assert.equal(ops.length, 3);
});

test('computeLineDiff on empty inputs produces no ops', () => {
  assert.deepEqual(computeLineDiff([], []), []);
});

test('computeLineDiff reconstructs both sides exactly for a single-line change in a large block', () => {
  const oldLines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
  const newLines = [...oldLines];
  newLines[100] = 'CHANGED';
  const ops = computeLineDiff(oldLines, newLines);

  const { rebuiltOld, rebuiltNew } = applyOps(oldLines, newLines);
  assert.deepEqual(rebuiltOld, oldLines);
  assert.deepEqual(rebuiltNew, newLines);

  // 全置換ではなく、変更行付近だけがadd/removeであること
  const changedOps = ops.filter((op) => op.type !== 'equal');
  assert.ok(changedOps.length <= 2, `expected a tiny diff, got ${changedOps.length} changed ops`);
});

test('computeLineDiff handles pure insertion', () => {
  const oldLines = ['a', 'c'];
  const newLines = ['a', 'b', 'c'];
  const ops = computeLineDiff(oldLines, newLines);
  assert.deepEqual(ops.map((op) => op.type), ['equal', 'add', 'equal']);
  assert.equal(ops[1].line, 'b');
});

test('computeLineDiff handles pure deletion', () => {
  const oldLines = ['a', 'b', 'c'];
  const newLines = ['a', 'c'];
  const ops = computeLineDiff(oldLines, newLines);
  assert.deepEqual(ops.map((op) => op.type), ['equal', 'remove', 'equal']);
  assert.equal(ops[1].line, 'b');
});

test('computeLineDiff completes quickly on a ~1600-line worst case (fully different content)', () => {
  const oldLines = Array.from({ length: 800 }, (_, i) => `old-${i}`);
  const newLines = Array.from({ length: 800 }, (_, i) => `new-${i}`);
  const start = Date.now();
  const ops = computeLineDiff(oldLines, newLines);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 2000, `expected < 2000ms, took ${elapsed}ms`);
  assert.equal(ops.filter((op) => op.type === 'remove').length, 800);
  assert.equal(ops.filter((op) => op.type === 'add').length, 800);
});

test('buildLineDiffPreview trims common prefix/suffix and runs Myers on the shrunk middle block', () => {
  const original = ['a', 'b', 'x', 'c', 'd'].join('\n');
  const next = ['a', 'b', 'y', 'c', 'd'].join('\n');
  const preview = buildLineDiffPreview(original, next);
  assert.equal(preview.prefix, 2);
  assert.equal(preview.suffix, 2);
  assert.ok(preview.ops);
  assert.deepEqual(preview.ops!.map((op) => op.type), ['remove', 'add']);
});

test('buildLineDiffPreview falls back to block mode when the trimmed block exceeds the Myers cap', () => {
  const big = LINE_DIFF_MYERS_MAX_BLOCK_LINES + 10;
  const original = Array.from({ length: big }, (_, i) => `old-${i}`).join('\n');
  const next = Array.from({ length: big }, (_, i) => `new-${i}`).join('\n');
  const preview = buildLineDiffPreview(original, next);
  assert.equal(preview.ops, null);
  assert.ok(preview.fallback);
  assert.equal(preview.fallback!.originalChanged.length, big);
});

test('buildLineDiffPreview reports isChanged=false for identical content', () => {
  const preview = buildLineDiffPreview('same\n', 'same\n');
  assert.equal(preview.isChanged, false);
});
