import type { ModelIntent } from './types';

export type AgentWindowModelMode = 'auto' | 'planning' | 'implementation' | 'planningImplementation';

const modeLabels: Record<AgentWindowModelMode, string> = {
  auto: 'Auto',
  planning: '相談',
  implementation: '実装',
  planningImplementation: 'GLM実装',
};

const modeTitles: Record<AgentWindowModelMode, string> = {
  auto: '用途を自動判定します',
  planning: '相談・レビュー・設計モデルを今回だけ使用します',
  implementation: '実装・修正モデルを今回だけ使用します',
  planningImplementation: '相談モデル枠を使って実装します。既定ではGLM 5.2です',
};

export function getAgentWindowModelIntent(mode: AgentWindowModelMode): ModelIntent {
  if (mode === 'planningImplementation') return 'planning';
  return mode;
}

export function getAgentWindowModelModeLabel(mode: AgentWindowModelMode): string {
  return modeLabels[mode];
}

export function getAgentWindowModelModeTitle(mode: AgentWindowModelMode): string {
  return modeTitles[mode];
}

export const agentWindowModelModes: readonly AgentWindowModelMode[] = [
  'auto',
  'planning',
  'implementation',
  'planningImplementation',
];
