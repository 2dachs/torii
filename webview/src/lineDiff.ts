import { splitDiffLines } from './diffPreview';

export type DiffOpType = 'equal' | 'add' | 'remove';

export interface DiffOp {
  type: DiffOpType;
  line: string;
  oldLine?: number;
  newLine?: number;
}

/**
 * Myers差分（O((N+M)D)）。行単位の追加・削除・一致を復元する。
 * 呼び出し側（buildLineDiffPreview）が対象行数を上限で絞ってから呼ぶこと。
 */
export function computeLineDiff(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length;
  const m = newLines.length;
  const max = n + m;
  if (max === 0) return [];

  const offset = max;
  let v: number[] = new Array(2 * max + 1).fill(0);
  const trace: number[][] = [];

  let found = false;
  for (let d = 0; d <= max && !found; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }

  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const vPrev = trace[d];
    const k = x - y;
    const prevK = (k === -d || (k !== d && vPrev[offset + k - 1] < vPrev[offset + k + 1]))
      ? k + 1
      : k - 1;
    const prevX = vPrev[offset + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', line: oldLines[x - 1], oldLine: x, newLine: y });
      x -= 1;
      y -= 1;
    }

    if (d > 0) {
      if (x === prevX) {
        ops.push({ type: 'add', line: newLines[y - 1], newLine: y });
      } else {
        ops.push({ type: 'remove', line: oldLines[x - 1], oldLine: x });
      }
    }
    x = prevX;
    y = prevY;
  }

  ops.reverse();
  return ops;
}

export const LINE_DIFF_MYERS_MAX_BLOCK_LINES = 800;

export interface LineDiffPreview {
  originalLineCount: number;
  nextLineCount: number;
  prefix: number;
  suffix: number;
  isChanged: boolean;
  /** Myers差分結果。ブロックが大きすぎる場合は null（fallbackを使う） */
  ops: DiffOp[] | null;
  /** ops が null の場合のみ有効。旧来のブロック全置換表示用 */
  fallback: { originalChanged: string[]; nextChanged: string[] } | null;
}

export function buildLineDiffPreview(originalContent: string, nextContent: string): LineDiffPreview {
  const originalLines = splitDiffLines(originalContent);
  const nextLines = splitDiffLines(nextContent);

  let prefix = 0;
  while (
    prefix < originalLines.length
    && prefix < nextLines.length
    && originalLines[prefix] === nextLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < originalLines.length - prefix
    && suffix < nextLines.length - prefix
    && originalLines[originalLines.length - 1 - suffix] === nextLines[nextLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const originalChanged = originalLines.slice(prefix, originalLines.length - suffix);
  const nextChanged = nextLines.slice(prefix, nextLines.length - suffix);
  const isChanged = originalContent !== nextContent;

  const base = {
    originalLineCount: originalLines.length,
    nextLineCount: nextLines.length,
    prefix,
    suffix,
    isChanged,
  };

  if (originalChanged.length > LINE_DIFF_MYERS_MAX_BLOCK_LINES || nextChanged.length > LINE_DIFF_MYERS_MAX_BLOCK_LINES) {
    return { ...base, ops: null, fallback: { originalChanged, nextChanged } };
  }

  return { ...base, ops: computeLineDiff(originalChanged, nextChanged), fallback: null };
}
