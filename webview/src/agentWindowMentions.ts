export interface MentionedFile {
  path: string;
  name: string;
}

const ACTIVE_MENTION_PATTERN = /(?:^|\s)@([^\s@]*)$/;

export function getActiveFileMentionQuery(input: string): string | null {
  const match = input.match(ACTIVE_MENTION_PATTERN);
  if (!match) return null;
  const query = match[1] ?? '';
  if (query.includes('@')) return null;
  return query;
}

export function insertMentionToken(input: string, filePath: string): string {
  const token = `@${filePath} `;
  if (ACTIVE_MENTION_PATTERN.test(input)) {
    return input.replace(ACTIVE_MENTION_PATTERN, (match) => {
      const prefix = match.startsWith(' ') ? ' ' : '';
      return `${prefix}${token}`;
    });
  }
  const separator = input.trim().length > 0 && !input.endsWith(' ') ? ' ' : '';
  return `${input}${separator}${token}`;
}

export function addMentionedFile(files: MentionedFile[], file: MentionedFile, maxFiles = 6): MentionedFile[] {
  if (files.some((item) => item.path === file.path)) return files;
  if (files.length >= maxFiles) return files;
  return [...files, file];
}
