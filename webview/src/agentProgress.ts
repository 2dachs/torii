import type { AgentEvent } from './types';

export const MAX_VISIBLE_AGENT_STEPS = 30;
const MAX_UI_FIELD_CHARS = 240;
const VISIBLE_AGENT_STEP_TYPES = new Set([
  'tool_use',
  'tool_result',
  'file_change_applied',
  'file_change_undone',
]);
const UI_INPUT_KEYS = ['path', 'command', 'pattern'];

export function appendVisibleAgentSteps(
  previous: AgentEvent[],
  incoming: AgentEvent[],
  maxSteps = MAX_VISIBLE_AGENT_STEPS,
): AgentEvent[] {
  const visible = incoming.filter((event) => VISIBLE_AGENT_STEP_TYPES.has(event.type));
  if (visible.length === 0) return previous;
  return [...previous, ...visible].slice(-maxSteps);
}

function trimUiField(value: string): string {
  if (value.length <= MAX_UI_FIELD_CHARS) return value;
  return `${value.slice(0, MAX_UI_FIELD_CHARS - 3)}...`;
}

export function summarizeToolInputForUi(input: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const key of UI_INPUT_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      summary[key] = trimUiField(value);
    }
  }
  return summary;
}
