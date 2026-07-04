import * as path from 'path';
import type { FileTreeEntry } from './fileTreePayload';

export interface FileMentionPayload {
  name: string;
  path: string;
}

export interface MentionedFileContent {
  path: string;
  content: string;
  truncated?: boolean;
  originalLength?: number;
}

export function toFileMentionPayload(
  entries: FileTreeEntry[],
  query: string,
  options: { maxEntries?: number } = {},
): FileMentionPayload[] {
  const normalizedQuery = query.trim().toLowerCase();
  const maxEntries = Math.max(0, options.maxEntries ?? 20);
  return entries
    .filter((entry) => entry.type === 'file')
    .filter((entry) => {
      if (!normalizedQuery) return true;
      return entry.path.toLowerCase().includes(normalizedQuery) || entry.name.toLowerCase().includes(normalizedQuery);
    })
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, maxEntries)
    .map((entry) => ({ name: entry.name, path: entry.path }));
}

export function buildAgentWindowPromptWithFileMentions(
  message: string,
  files: MentionedFileContent[],
  options: { maxCharsPerFile?: number } = {},
): string {
  if (files.length === 0) return message;
  const maxCharsPerFile = Math.max(0, options.maxCharsPerFile ?? 200_000);
  const blocks = files.map((file) => {
    const content = file.content.slice(0, maxCharsPerFile);
    const originalLength = file.originalLength ?? file.content.length;
    const wasTruncated = file.truncated || file.content.length > maxCharsPerFile;
    const lines = [
      `### ${file.path}`,
      '```',
      content,
      '```',
    ];
    if (wasTruncated) {
      lines.push(`※ ファイルが大きいため先頭${maxCharsPerFile}文字のみ添付しています（元サイズ: ${originalLength}文字）。`);
    }
    return lines.join('\n');
  });

  return [
    message,
    '',
    '---',
    '添付ファイル:',
    '',
    ...blocks,
  ].join('\n');
}

export function normalizeMentionPath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).split(path.sep).join('/');
}
