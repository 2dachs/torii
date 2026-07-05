export interface DeleteConfirmState {
  pendingTaskId: string | null;
}

export const initialDeleteConfirmState: DeleteConfirmState = { pendingTaskId: null };

export function beginDeleteConfirm(taskId: string): DeleteConfirmState {
  return { pendingTaskId: taskId };
}

export function cancelDeleteConfirm(): DeleteConfirmState {
  return { pendingTaskId: null };
}

export function confirmDelete(
  state: DeleteConfirmState,
  taskId: string,
): { next: DeleteConfirmState; shouldDelete: boolean } {
  return {
    next: { pendingTaskId: null },
    shouldDelete: state.pendingTaskId === taskId,
  };
}
