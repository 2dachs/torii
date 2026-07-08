import type { AgentEvent, ChatMessage, PendingApproval, Task, VsCodeMessage } from './types';
import { reduceAgentSteps, type AgentStep } from './agentWindowSteps';
import { reduceFileChanges, initialFileChangesState, type FileChangesState } from './agentWindowChanges';

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
  steps: AgentStep[];
  changes: FileChangesState;
  pendingApprovals: PendingApproval[];
  blockedOwner?: AgentRunOwner | null;
  historyLoading?: boolean;
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
      pendingApprovals: [],
      blockedOwner: (message as any).owner,
      nextCommands: [],
    };
  }

  if (message.command === 'requestCancelled') {
    return {
      ...state,
      loading: false,
      pendingApprovals: [],
      nextCommands: [],
    };
  }

  if (message.command === 'agentRunEnded' && typeof (message as any).taskId === 'string') {
    const taskId = (message as any).taskId;
    if (taskId !== state.activeTaskId) {
      return { ...state, nextCommands: [] };
    }
    return {
      ...state,
      historyLoading: true,
      nextCommands: [{ command: 'loadChatHistory', taskId }],
    };
  }

  if (message.command === 'agentEvent' && (message as any).event) {
    const event = (message as any).event as AgentEvent;
    const steps = reduceAgentSteps(state.steps, event);
    const changes = reduceFileChanges(state.changes, event);
    if (event.type === 'task_created') {
      return {
        ...state,
        activeTaskId: event.taskId,
        agentEvents: [...state.agentEvents, event].slice(-30),
        steps,
        changes,
        pendingApprovals: [],
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
    if (event.type === 'approval_required') {
      const pendingApproval = {
        id: event.id,
        tool: event.tool,
        data: event.data,
      };
      return {
        ...state,
        agentEvents: [...state.agentEvents, event].slice(-30),
        steps,
        changes,
        pendingApprovals: [...state.pendingApprovals.filter((approval) => approval.id !== event.id), pendingApproval],
        nextCommands: [],
      };
    }
    const finished = event.type === 'done' || event.type === 'error';
    const keepStreamingUntilHistoryReload = event.type === 'done' && !!state.activeTaskId;
    return {
      ...state,
      loading: finished ? false : state.loading,
      streamingText: finished && !keepStreamingUntilHistoryReload ? '' : state.streamingText,
      agentEvents: [...state.agentEvents, event].slice(-30),
      steps,
      changes,
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
      steps: events.reduce((acc, evt) => reduceAgentSteps(acc, evt), state.steps),
      changes: events.reduce((acc, evt) => reduceFileChanges(acc, evt), state.changes),
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
      steps: [],
      changes: initialFileChangesState,
      pendingApprovals: [],
      historyLoading: true,
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
      steps: activeTaskId === state.activeTaskId ? state.steps : [],
      changes: activeTaskId === state.activeTaskId ? state.changes : initialFileChangesState,
      pendingApprovals: activeTaskId === state.activeTaskId ? state.pendingApprovals : [],
      historyLoading: activeTaskId && activeTaskId !== state.activeTaskId ? true : state.historyLoading,
      nextCommands: activeTaskId && activeTaskId !== state.activeTaskId
        ? [{ command: 'loadChatHistory', taskId: activeTaskId }]
        : [],
    };
  }

  if (message.command === 'loadChatHistory' && isMessageArray(message.data)) {
    // steps/changes はタスク切替時（agentWindowTaskCreated/loadTasks）にのみリセットする。
    // run完了後の履歴再同期でもここではクリアしないことで、チェックリストとChangesが消えないようにする。
    return {
      ...state,
      messages: message.data,
      streamingText: '',
      agentEvents: [],
      historyLoading: false,
      nextCommands: [],
    };
  }

  return { ...state, nextCommands: [] };
}
