import { invoke } from '@tauri-apps/api/core';
import type {
  AppSettings,
  BootstrapPayload,
  SendMessageArgs,
  SendMessageResult,
  SettingsUpdate,
  Mode,
} from '../types';

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Tauri command failed';
}

export async function bootstrap(): Promise<BootstrapPayload> {
  try {
    return await invoke<BootstrapPayload>('bootstrap');
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function createProject(name: string): Promise<BootstrapPayload> {
  try {
    return await invoke<BootstrapPayload>('create_project', { name });
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function updateProjectName(projectId: string, name: string): Promise<BootstrapPayload> {
  try {
    return await invoke<BootstrapPayload>('update_project_name', { projectId, name });
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function deleteProject(projectId: string): Promise<BootstrapPayload> {
  try {
    return await invoke<BootstrapPayload>('delete_project', { projectId });
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function createConversation(projectId: string, title: string, mode: Mode): Promise<BootstrapPayload> {
  try {
    return await invoke<BootstrapPayload>('create_conversation', { projectId, title, mode });
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function updateConversationTitle(conversationId: string, title: string): Promise<BootstrapPayload> {
  try {
    return await invoke<BootstrapPayload>('update_conversation_title', { conversationId, title });
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function deleteConversation(conversationId: string): Promise<BootstrapPayload> {
  try {
    return await invoke<BootstrapPayload>('delete_conversation', { conversationId });
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function updateSettings(update: SettingsUpdate): Promise<BootstrapPayload> {
  try {
    return await invoke<BootstrapPayload>('update_settings', { update });
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function sendMessage(args: SendMessageArgs): Promise<SendMessageResult> {
  try {
    return await invoke<SendMessageResult>('send_message', { args });
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function setActiveProject(projectId: string | null): Promise<BootstrapPayload> {
  try {
    return await invoke<BootstrapPayload>('set_active_project', { projectId });
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function setActiveConversation(conversationId: string | null): Promise<BootstrapPayload> {
  try {
    return await invoke<BootstrapPayload>('set_active_conversation', { conversationId });
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function exportSettings(): Promise<AppSettings> {
  try {
    return await invoke<AppSettings>('load_settings');
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}
