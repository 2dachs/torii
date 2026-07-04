import type { AgentEvent, PendingApproval } from './types';

export function getPendingAgentWindowApprovals(
  events: AgentEvent[],
  resolvedIds: Set<string>,
): PendingApproval[] {
  return events
    .filter((event): event is Extract<AgentEvent, { type: 'approval_required' }> => event.type === 'approval_required')
    .filter((event) => !resolvedIds.has(event.id))
    .map((event) => ({
      id: event.id,
      tool: event.tool,
      data: event.data,
    }));
}
