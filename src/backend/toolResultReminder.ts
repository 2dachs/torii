export const TASK_REMINDER = '\n\n[REMINDER: 元のタスクに集中し、完了までツールを使い続けよ。attempt_completion を呼ぶまで停止するな。]';

export function appendTaskReminderForToolResult(toolName: string, result: unknown): unknown {
  if (toolName === 'attempt_completion') return result;
  return typeof result === 'string' ? result + TASK_REMINDER : result;
}
