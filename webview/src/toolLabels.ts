export const TOOL_JAPANESE_NAMES: Record<string, string> = {
  read_file: 'ファイル読み込み中',
  write_file: 'ファイル編集中',
  replace_in_file: 'ファイル差分更新中',
  run_command: 'コマンド実行中',
  list_dir: 'ディレクトリ確認中',
  list_directory: 'ディレクトリ確認中',
  search_files: 'ファイル検索中',
  grep: 'コード検索中',
};

export const TOOL_ICONS: Record<string, string> = {
  read_file: '📖',
  write_file: '✏️',
  replace_in_file: '📝',
  run_command: '⚡',
  list_dir: '📁',
  list_directory: '📁',
  search_files: '🔍',
  grep: '🔍',
};

export type ToolCategory = 'read' | 'write' | 'command' | 'list' | 'search' | 'other';

export const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  read_file: 'read',
  write_file: 'write',
  replace_in_file: 'write',
  run_command: 'command',
  list_dir: 'list',
  list_directory: 'list',
  search_files: 'search',
  grep: 'search',
};

export function getToolCategory(tool: string): ToolCategory {
  return TOOL_CATEGORIES[tool] || 'other';
}
