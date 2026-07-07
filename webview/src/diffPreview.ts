export interface InlineDiffPreview {
  originalLineCount: number;
  nextLineCount: number;
  prefix: number;
  suffix: number;
  originalChanged: string[];
  nextChanged: string[];
  isChanged: boolean;
}

export function splitDiffLines(content: string): string[] {
  if (!content) return [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

export function formatDiffLines(lines: string[], startLine: number, prefix: string): string {
  if (lines.length === 0) return '（なし）';
  return lines
    .map((line, idx) => `${prefix}${String(startLine + idx).padStart(4, ' ')} | ${line}`)
    .join('\n');
}

export function buildInlineDiffPreview(originalContent: string, nextContent: string): InlineDiffPreview {
  const originalLines = splitDiffLines(originalContent);
  const nextLines = splitDiffLines(nextContent);

  let prefix = 0;
  while (
    prefix < originalLines.length &&
    prefix < nextLines.length &&
    originalLines[prefix] === nextLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < originalLines.length - prefix &&
    suffix < nextLines.length - prefix &&
    originalLines[originalLines.length - 1 - suffix] === nextLines[nextLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return {
    originalLineCount: originalLines.length,
    nextLineCount: nextLines.length,
    prefix,
    suffix,
    originalChanged: originalLines.slice(prefix, originalLines.length - suffix),
    nextChanged: nextLines.slice(prefix, nextLines.length - suffix),
    isChanged: originalContent !== nextContent,
  };
}
