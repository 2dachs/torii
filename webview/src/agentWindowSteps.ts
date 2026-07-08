import type { AgentEvent } from './types';
import { TOOL_JAPANESE_NAMES, getToolCategory, type ToolCategory } from './toolLabels';

export type AgentStepStatus = 'pending' | 'running' | 'done' | 'failed';
export type AgentStepKind = ToolCategory;

export interface AgentStep {
  id: string;
  kind: AgentStepKind;
  tool: string;
  label: string;
  detail?: string;
  status: AgentStepStatus;
  resultSummary?: string;
  undoId?: string;
}

export const MAX_AGENT_STEPS = 30;
const UI_DETAIL_KEYS = ['path', 'command', 'pattern'];
const RESULT_SUMMARY_MAX_CHARS = 200;

function detailFromInput(input: Record<string, unknown>): string | undefined {
  for (const key of UI_DETAIL_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

export function reduceAgentSteps(steps: AgentStep[], event: AgentEvent): AgentStep[] {
  if (event.type === 'tool_use') {
    const step: AgentStep = {
      id: event.id,
      kind: getToolCategory(event.tool),
      tool: event.tool,
      label: TOOL_JAPANESE_NAMES[event.tool] || event.tool,
      detail: detailFromInput(event.input),
      status: 'running',
    };
    return [...steps, step].slice(-MAX_AGENT_STEPS);
  }

  if (event.type === 'tool_result') {
    return steps.map((step) => (step.id === event.id
      ? {
        ...step,
        status: event.ok ? 'done' : 'failed',
        resultSummary: event.ok ? undefined : event.output.slice(0, RESULT_SUMMARY_MAX_CHARS),
      }
      : step));
  }

  if (event.type === 'file_change_applied') {
    const step: AgentStep = {
      id: event.undoId,
      kind: 'write',
      tool: event.action === 'create' ? 'write_file' : 'replace_in_file',
      label: `${event.path} を変更しました`,
      detail: event.path,
      status: 'done',
      undoId: event.undoId,
    };
    return [...steps, step].slice(-MAX_AGENT_STEPS);
  }

  if (event.type === 'file_change_undone') {
    return steps.map((step) => (step.undoId === event.undoId
      ? { ...step, resultSummary: event.message }
      : step));
  }

  return steps;
}
