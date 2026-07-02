export type AgentEventLike = {
  type?: string;
  [key: string]: unknown;
};

export const AGENT_EVENT_BATCH_FLUSH_MS = 250;

export function shouldBatchAgentEvent(event: AgentEventLike | null | undefined): boolean {
  return event?.type === 'tool_use' || event?.type === 'tool_result';
}

export class AgentEventBatch {
  private pending: AgentEventLike[] = [];

  constructor(private readonly post: (events: AgentEventLike[]) => void) {}

  get size(): number {
    return this.pending.length;
  }

  push(event: AgentEventLike): void {
    this.pending.push(event);
  }

  flush(): void {
    if (this.pending.length === 0) return;
    const events = this.pending;
    this.pending = [];
    this.post(events);
  }
}
