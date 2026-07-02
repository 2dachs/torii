import type { Task } from '../backend/storage';

const DEFAULT_MAX_TASKS = 20;
const DEFAULT_MAX_TITLE_CHARS = 120;

type TaskPayloadOptions = {
  maxTasks?: number;
  maxTitleChars?: number;
};

function toSafeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function isIsoLike(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function sanitizeTasksForWebview(input: unknown, options: TaskPayloadOptions = {}): Task[] {
  const maxTasks = Math.max(0, options.maxTasks ?? DEFAULT_MAX_TASKS);
  const maxTitleChars = Math.max(1, options.maxTitleChars ?? DEFAULT_MAX_TITLE_CHARS);
  if (!Array.isArray(input) || maxTasks === 0) return [];

  return input
    .map((raw) => {
      const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      const id = toSafeString(record.id);
      const workspaceId = toSafeString(record.workspace_id);
      const createdAt = toSafeString(record.created_at);
      const updatedAt = toSafeString(record.updated_at);
      if (!id || !workspaceId || !isIsoLike(createdAt) || !isIsoLike(updatedAt)) return null;

      return {
        id,
        workspace_id: workspaceId,
        title: truncate(toSafeString(record.title, '無題').trim() || '無題', maxTitleChars),
        created_at: createdAt,
        updated_at: updatedAt,
      } satisfies Task;
    })
    .filter((task): task is Task => task !== null)
    .slice(0, maxTasks);
}
