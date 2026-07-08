import type { AgentEvent } from './types';

export interface FileChangeEntry {
  undoId: string;
  path: string;
  action: 'create' | 'update';
  undone: boolean;
  oldContent?: string;
  newContent?: string;
}

interface PendingDiff {
  oldContent: string;
  newContent: string;
}

export interface FileChangesState {
  entries: FileChangeEntry[];
  pendingDiffsByPath: Record<string, PendingDiff>;
}

export const initialFileChangesState: FileChangesState = { entries: [], pendingDiffsByPath: {} };

function isWriteApprovalData(data: unknown): data is { path: string; oldContent: string; newContent: string } {
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;
  return typeof record.path === 'string'
    && typeof record.oldContent === 'string'
    && typeof record.newContent === 'string';
}

export function reduceFileChanges(state: FileChangesState, event: AgentEvent): FileChangesState {
  if (event.type === 'approval_required' && (event.tool === 'write_file' || event.tool === 'replace_in_file') && isWriteApprovalData(event.data)) {
    return {
      ...state,
      pendingDiffsByPath: {
        ...state.pendingDiffsByPath,
        [event.data.path]: { oldContent: event.data.oldContent, newContent: event.data.newContent },
      },
    };
  }

  if (event.type === 'file_change_applied') {
    const diff = state.pendingDiffsByPath[event.path];
    const { [event.path]: _removed, ...restPending } = state.pendingDiffsByPath;
    const entry: FileChangeEntry = {
      undoId: event.undoId,
      path: event.path,
      action: event.action,
      undone: false,
      oldContent: diff?.oldContent,
      newContent: diff?.newContent,
    };
    return {
      entries: [...state.entries, entry],
      pendingDiffsByPath: restPending,
    };
  }

  if (event.type === 'file_change_undone') {
    return {
      ...state,
      entries: state.entries.map((entry) => (entry.undoId === event.undoId ? { ...entry, undone: true } : entry)),
    };
  }

  return state;
}
