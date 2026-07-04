const INTERNAL_REMINDER_PATTERN = /\n\n\[REMINDER: 元のタスクに集中し、完了までツールを使い続けよ。attempt_completion を呼ぶまで停止するな。]$/;

export function stripAgentInternalReminder(text: string): string {
  return text.replace(INTERNAL_REMINDER_PATTERN, '');
}
