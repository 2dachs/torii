export type FileTreeEntryType = 'file' | 'directory';

export interface FileTreeEntry {
  name: string;
  path: string;
  type: FileTreeEntryType;
}

const EXCLUDED_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'coverage',
  '.next',
  '.turbo',
]);

export function shouldIncludeFileTreeEntry(name: string): boolean {
  if (!name || EXCLUDED_NAMES.has(name)) return false;
  return true;
}

export function toFileTreePayload(entries: FileTreeEntry[], options: { maxEntries?: number } = {}): FileTreeEntry[] {
  const maxEntries = Math.max(0, options.maxEntries ?? 200);
  return entries
    .filter((entry) => shouldIncludeFileTreeEntry(entry.name))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, maxEntries);
}
