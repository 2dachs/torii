import type { AgentEvent, ChatMessage, Task, VsCodeMessage } from './types';

type AgentRunOwner = 'sidebar' | 'agentWindow';

export interface AgentWindowState {
  tasks: Task[];
  activeTaskId: string | null;
  messages: ChatMessage[];
  tasksLoaded: boolean;
  tasksLoading: boolean;
  loading: boolean;
  streamingText: string;
  agentEvents: AgentEvent[];
  blockedOwner?: AgentRunOwner | null;
}

export type AgentWindowCommand =
  | { command: 'loadChatHistory'; taskId: string };

export type AgentWindowStateResult = AgentWindowState & {
  nextCommands: AgentWindowCommand[];
};

function isTaskArray(data: unknown): data is Task[] {
  return Array.isArray(data) && data.every((item) => item && typeof item === 'object' && typeof (item as Task).id === 'string');
}

function isMessageArray(data: unknown): data is ChatMessage[] {
  return Array.isArray(data) && data.every((item) => item && typeof item === 'object' && typeof (item as ChatMessage).content === 'string');
}

export function applyAgentWindowMessage(state: AgentWindowState, message: VsCodeMessage): AgentWindowStateResult {
  if (message.command === 'agentRunBlocked' && ((message as any).owner === 'sidebar' || (message as any).owner === 'agentWindow')) {
    return {
      ...state,
      loading: false,
      streamingText: '',
      blockedOwner: (message as any).owner,
      nextCommands: [],
    };
  }

  if (message.command === 'agentEvent' && (message as any).event) {
    const event = (message as any).event as AgentEvent;
    if (event.type === 'task_created') {
      return {
        ...state,
        activeTaskId: event.taskId,
        agentEvents: [...state.agentEvents, event].slice(-30),
        nextCommands: [{ command: 'loadChatHistory', taskId: event.taskId }],
      };
    }
    if (event.type === 'text_delta') {
      return {
        ...state,
        streamingText: `${state.streamingText}${event.text}`,
        nextCommands: [],
      };
    }
    const finished = event.type === 'done' || event.type === 'error';
    return {
      ...state,
      loading: finished ? false : state.loading,
      streamingText: finished ? '' : state.streamingText,
      agentEvents: [...state.agentEvents, event].slice(-30),
      nextCommands: event.type === 'done' && state.activeTaskId
        ? [{ command: 'loadChatHistory', taskId: state.activeTaskId }]
        : [],
    };
  }

  if (message.command === 'agentEvents' && Array.isArray((message as any).events)) {
    const events = (message as any).events as AgentEvent[];
    return {
      ...state,
      agentEvents: [...state.agentEvents, ...events].slice(-30),
      nextCommands: [],
    };
  }

  if (message.command === 'agentWindowTaskCreated' && typeof (message as any).taskId === 'string') {
    return {
      ...state,
      activeTaskId: (message as any).taskId,
      messages: [],
      streamingText: '',
      agentEvents: [],
      nextCommands: [],
    };
  }

  if (message.command === 'loadTasks' && isTaskArray(message.data)) {
    const tasks = message.data;
    const activeTaskStillExists = !!state.activeTaskId && tasks.some((task) => task.id === state.activeTaskId);
    const activeTaskId = activeTaskStillExists ? state.activeTaskId : tasks[0]?.id ?? null;
    return {
      ...state,
      tasks,
      activeTaskId,
      messages: activeTaskId ? state.messages : [],
      tasksLoaded: true,
      tasksLoading: false,
      streamingText: activeTaskId === state.activeTaskId ? state.streamingText : '',
      agentEvents: activeTaskId === state.activeTaskId ? state.agentEvents : [],
      nextCommands: activeTaskId && activeTaskId !== state.activeTaskId
        ? [{ command: 'loadChatHistory', taskId: activeTaskId }]
        : [],
    };
  }

  if (message.command === 'loadChatHistory' && isMessageArray(message.data)) {
    return {
      ...state,
      messages: message.data,
      streamingText: '',
      agentEvents: [],
      nextCommands: [],
    };
  }

  return { ...state, nextCommands: [] };
}
