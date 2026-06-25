export const DIFF_PREVIEW_MAX_TOTAL_CHARS = 180_000;
export const DIFF_PREVIEW_MAX_TOTAL_LINES = 5_000;

export interface DiffPreviewDecision {
  openDiff: boolean;
  reason?: string;
  totalChars: number;
  totalLines: number;
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) count += 1;
  }
  return count;
}

export function getDiffPreviewDecision(oldContent: string, newContent: string): DiffPreviewDecision {
  const totalChars = oldContent.length + newContent.length;
  const totalLines = countLines(oldContent) + countLines(newContent);

  if (totalChars > DIFF_PREVIEW_MAX_TOTAL_CHARS) {
    return {
      openDiff: false,
      reason: `差分が大きいため、VS Codeの差分タブは開きません（${totalChars.toLocaleString()}文字）。`,
      totalChars,
      totalLines,
    };
  }

  if (totalLines > DIFF_PREVIEW_MAX_TOTAL_LINES) {
    return {
      openDiff: false,
      reason: `差分が大きいため、VS Codeの差分タブは開きません（${totalLines.toLocaleString()}行）。`,
      totalChars,
      totalLines,
    };
  }

  return { openDiff: true, totalChars, totalLines };
}
