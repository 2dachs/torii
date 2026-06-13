import * as vscode from 'vscode';

const FALLBACK_WORKSPACE_ID = 'global-workspace';

export function getCurrentWorkspaceId(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.toString() || FALLBACK_WORKSPACE_ID;
}
