export type AgentRunOwner = 'sidebar' | 'agentWindow';

export type AgentRunStartResult =
  | { ok: true }
  | { ok: false; owner: AgentRunOwner };

export class AgentRunRegistry {
  private readonly runningTasks = new Map<string, AgentRunOwner>();

  tryStart(taskId: string | null | undefined, owner: AgentRunOwner): AgentRunStartResult {
    const key = taskId || '__new_task__';
    const currentOwner = this.runningTasks.get(key);
    if (currentOwner && currentOwner !== owner) {
      return { ok: false, owner: currentOwner };
    }
    this.runningTasks.set(key, owner);
    return { ok: true };
  }

  finish(taskId: string | null | undefined, owner: AgentRunOwner): void {
    const key = taskId || '__new_task__';
    if (this.runningTasks.get(key) === owner) {
      this.runningTasks.delete(key);
    }
  }

  move(fromTaskId: string | null | undefined, toTaskId: string | null | undefined, owner: AgentRunOwner): void {
    const fromKey = fromTaskId || '__new_task__';
    const toKey = toTaskId || '__new_task__';
    if (this.runningTasks.get(fromKey) !== owner) return;
    this.runningTasks.delete(fromKey);
    this.runningTasks.set(toKey, owner);
  }
}

export const agentRunRegistry = new AgentRunRegistry();
