interface NewAgentWindowTaskState {
  activeTaskId: string | null;
  messages: unknown[];
  loading: boolean;
  streamingText: string;
  agentEvents: unknown[];
  blockedOwner?: 'sidebar' | 'agentWindow' | null;
}

export function beginNewAgentWindowTask<T extends NewAgentWindowTaskState>(state: T): T {
  return {
    ...state,
    activeTaskId: null,
    messages: [],
    loading: false,
    streamingText: '',
    agentEvents: [],
    blockedOwner: null,
  };
}
