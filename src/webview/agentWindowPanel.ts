import * as http from 'http';
import * as path from 'path';
import * as fsSync from 'fs';
import * as vscode from 'vscode';
import { createTask, getChatHistory, getTasks } from '../backend/storage';
import { updateBudgetDisplay } from '../backend/statusBar';
import { getCurrentWorkspaceId } from '../backend/workspace';
import {
  EXTENSION_DISPLAY_NAME,
  MSG_AGENT_APPROVE,
  MSG_CREATE_TASK,
  MSG_LOAD_CHAT_HISTORY,
  MSG_LOAD_TASKS,
  MSG_SEND_MESSAGE,
  MSG_SERVER_PORT,
  ModelIntent,
} from '../constants';
import { AGENT_EVENT_BATCH_FLUSH_MS, AgentEventBatch, shouldBatchAgentEvent } from './agentEventBatch';
import { agentRunRegistry } from './agentRunRegistry';
import { FileTreeEntry, shouldIncludeFileTreeEntry, toFileTreePayload } from './fileTreePayload';
import {
  buildAgentWindowPromptWithFileMentions,
  normalizeMentionPath,
  toFileMentionPayload,
  type MentionedFileContent,
} from './agentWindowMentionContext';
import { sanitizeTasksForWebview } from './taskPayload';
import { buildWebviewHtml } from './webviewHtml';
import type { ToriiRuntime } from './provider';

const AGENT_WINDOW_MENTION_FILE_LIMIT = 20;
const AGENT_WINDOW_MENTION_SCAN_LIMIT = 700;
const AGENT_WINDOW_MENTION_READ_BYTES = 200_000;

export class AgentWindowPanel {
  private static currentPanel: AgentWindowPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private readonly runtime: ToriiRuntime;
  private readonly disposables: vscode.Disposable[] = [];
  private agentReq: ReturnType<typeof http.request> | null = null;
  private currentAgentTaskId: string | null = null;
  private agentTextDeltaBuffer = '';
  private agentTextDeltaTimer: ReturnType<typeof setTimeout> | null = null;
  private agentEventBatchTimer: ReturnType<typeof setTimeout> | null = null;
  private agentEventBatch = new AgentEventBatch((events) => {
    void this.panel.webview.postMessage({ command: 'agentEvents', events });
  });

  static open(context: vscode.ExtensionContext, runtime: ToriiRuntime): AgentWindowPanel {
    if (AgentWindowPanel.currentPanel) {
      AgentWindowPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return AgentWindowPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'torii.agentWindow',
      'Torii Agent',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, 'dist', 'webview')),
        ],
      },
    );

    AgentWindowPanel.currentPanel = new AgentWindowPanel(context, panel, runtime);
    return AgentWindowPanel.currentPanel;
  }

  private constructor(context: vscode.ExtensionContext, panel: vscode.WebviewPanel, runtime: ToriiRuntime) {
    this.context = context;
    this.panel = panel;
    this.runtime = runtime;

    this.panel.webview.html = buildWebviewHtml({
      webview: this.panel.webview,
      extensionPath: this.context.extensionPath,
      entryHtml: 'agent-window.html',
      resourceRootUri: vscode.Uri.file(path.join(this.context.extensionPath, 'dist', 'webview')),
    });

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message) => {
        void this.handleMessage(message);
      }),
      this.panel.onDidDispose(() => this.dispose()),
    );
  }

  private async handleMessage(message: any): Promise<void> {
    if (message?.command === 'webviewReady') {
      await this.sendInitialData();
      await this.sendTasks();
      return;
    }

    if (message?.command === MSG_LOAD_TASKS) {
      await this.sendTasks();
      return;
    }

    if (message?.command === MSG_LOAD_CHAT_HISTORY) {
      await this.sendChatHistory(message.taskId);
      return;
    }

    if (message?.command === MSG_CREATE_TASK) {
      await this.handleCreateTask(message.title);
      return;
    }

    if (message?.command === MSG_SEND_MESSAGE && message.agentMode === 'agent') {
      await this.handleAgentMessage(message.text, message.taskId, message.modelIntent, message.mentionedFiles);
      return;
    }

    if (message?.command === MSG_AGENT_APPROVE) {
      await this.handleAgentApprove(message.id, message.approved);
      return;
    }

    if (message?.command === 'loadFileTree') {
      await this.sendFileTree(message.path);
      return;
    }

    if (message?.command === 'openFile') {
      await this.openFile(message.path);
      return;
    }

    if (message?.command === 'openPreviewUrl') {
      await this.openPreviewUrl(message.url);
      return;
    }

    if (message?.command === 'searchFileMentions') {
      await this.sendFileMentions(message.query);
      return;
    }

    if (message?.command === 'openSettings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'torii');
    }
  }

  private async sendInitialData(): Promise<void> {
    await this.panel.webview.postMessage({
      command: MSG_SERVER_PORT,
      port: this.runtime.port,
    });
    await this.panel.webview.postMessage({
      command: 'extensionName',
      name: EXTENSION_DISPLAY_NAME,
    });
    const workspace = this.getWorkspaceInfo();
    await this.panel.webview.postMessage({
      command: 'workspaceInfo',
      name: workspace.name,
      path: workspace.path,
    });
  }

  private getWorkspaceId(): string {
    return getCurrentWorkspaceId();
  }

  private getWorkspaceRoot(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
  }

  private getWorkspaceInfo(): { name: string; path: string } {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return { name: 'ワークスペース未設定', path: '' };
    return { name: folder.name || path.basename(folder.uri.fsPath), path: folder.uri.fsPath };
  }

  private resolveWorkspacePath(relativePath?: string | null): string {
    const root = this.getWorkspaceRoot();
    if (!root) throw new Error('ワークスペースが未設定です');
    const relPath = typeof relativePath === 'string' ? relativePath : '';
    if (path.isAbsolute(relPath)) throw new Error('絶対パスは禁止されています');

    const rootReal = fsSync.realpathSync(path.resolve(root));
    const target = path.resolve(rootReal, relPath);
    if (target !== rootReal && !target.startsWith(rootReal + path.sep)) {
      throw new Error('ワークスペース外へのアクセスは禁止されています');
    }
    try {
      const targetReal = fsSync.realpathSync(target);
      if (targetReal !== rootReal && !targetReal.startsWith(rootReal + path.sep)) {
        throw new Error('シンボリックリンク経由のワークスペース外アクセスは禁止されています');
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
    return target;
  }

  private async sendTasks(): Promise<void> {
    const tasks = await getTasks(this.getWorkspaceId());
    await this.panel.webview.postMessage({
      command: MSG_LOAD_TASKS,
      data: sanitizeTasksForWebview(tasks),
    });
  }

  private async sendChatHistory(taskId?: string | null): Promise<void> {
    const history = await getChatHistory(this.getWorkspaceId(), taskId);
    await this.panel.webview.postMessage({
      command: MSG_LOAD_CHAT_HISTORY,
      data: history,
    });
  }

  private async handleCreateTask(title?: string): Promise<void> {
    const trimmed = typeof title === 'string' && title.trim() ? title.trim() : '新規タスク';
    const task = await createTask(this.getWorkspaceId(), trimmed);
    await this.panel.webview.postMessage({
      command: 'agentWindowTaskCreated',
      taskId: task.id,
    });
    await this.sendTasks();
    await this.sendChatHistory(task.id);
  }

  private async sendFileTree(relativePath?: string | null): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const target = this.resolveWorkspacePath(relativePath);
      const dirents = await fs.readdir(target, { withFileTypes: true });
      const basePath = typeof relativePath === 'string' && relativePath ? relativePath : '';
      const entries: FileTreeEntry[] = dirents
        .filter((dirent) => dirent.isDirectory() || dirent.isFile())
        .map((dirent) => ({
          name: dirent.name,
          path: basePath ? `${basePath}/${dirent.name}` : dirent.name,
          type: dirent.isDirectory() ? 'directory' : 'file',
        }));
      await this.panel.webview.postMessage({
        command: 'fileTree',
        path: basePath,
        data: toFileTreePayload(entries),
      });
    } catch (err: any) {
      await this.panel.webview.postMessage({
        command: 'fileTree',
        path: relativePath || '',
        data: [],
        error: err?.message || 'ファイルツリーを読み込めませんでした',
      });
    }
  }

  private async sendFileMentions(query?: string | null): Promise<void> {
    try {
      const root = this.getWorkspaceRoot();
      if (!root) throw new Error('ワークスペースが未設定です');
      const entries = await this.collectMentionFiles(root);
      await this.panel.webview.postMessage({
        command: 'fileMentions',
        query: typeof query === 'string' ? query : '',
        data: toFileMentionPayload(entries, typeof query === 'string' ? query : '', {
          maxEntries: AGENT_WINDOW_MENTION_FILE_LIMIT,
        }),
      });
    } catch (err: any) {
      await this.panel.webview.postMessage({
        command: 'fileMentions',
        query: typeof query === 'string' ? query : '',
        data: [],
        error: err?.message || 'ファイル候補を読み込めませんでした',
      });
    }
  }

  private async collectMentionFiles(root: string): Promise<FileTreeEntry[]> {
    const fs = await import('fs/promises');
    const rootReal = fsSync.realpathSync(path.resolve(root));
    const files: FileTreeEntry[] = [];
    const pending: string[] = [''];

    while (pending.length > 0 && files.length < AGENT_WINDOW_MENTION_SCAN_LIMIT) {
      const currentRel = pending.shift() || '';
      const currentAbs = path.resolve(rootReal, currentRel);
      let dirents: fsSync.Dirent[];
      try {
        dirents = await fs.readdir(currentAbs, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const dirent of dirents) {
        if (!shouldIncludeFileTreeEntry(dirent.name)) continue;
        const relPath = currentRel ? `${currentRel}/${dirent.name}` : dirent.name;
        if (dirent.isDirectory()) {
          pending.push(relPath);
          continue;
        }
        if (dirent.isFile()) {
          files.push({ name: dirent.name, path: relPath, type: 'file' });
          if (files.length >= AGENT_WINDOW_MENTION_SCAN_LIMIT) break;
        }
      }
    }

    return files;
  }

  private async openFile(relativePath?: string | null): Promise<void> {
    try {
      const target = this.resolveWorkspacePath(relativePath);
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (err: any) {
      await this.panel.webview.postMessage({
        command: 'fileOpenError',
        message: err?.message || 'ファイルを開けませんでした',
      });
    }
  }

  private async openPreviewUrl(rawUrl?: string | null): Promise<void> {
    try {
      if (typeof rawUrl !== 'string') throw new Error('URLが不正です');
      const url = new URL(rawUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('http/https URLのみ開けます');
      }
      try {
        await vscode.commands.executeCommand('simpleBrowser.show', vscode.Uri.parse(url.toString()));
      } catch {
        await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
      }
    } catch (err: any) {
      await this.panel.webview.postMessage({
        command: 'previewOpenError',
        message: err?.message || 'プレビューURLを開けませんでした',
      });
    }
  }

  private async readMentionedFiles(paths: unknown): Promise<MentionedFileContent[]> {
    if (!Array.isArray(paths)) return [];
    const fs = await import('fs/promises');
    const uniquePaths = [...new Set(paths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))].slice(0, 6);
    const files: MentionedFileContent[] = [];
    const root = this.getWorkspaceRoot();

    for (const relativePath of uniquePaths) {
      const target = this.resolveWorkspacePath(relativePath);
      const stat = await fs.stat(target);
      if (!stat.isFile()) continue;
      const handle = await fs.open(target, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(stat.size, AGENT_WINDOW_MENTION_READ_BYTES));
        const result = await handle.read(buffer, 0, buffer.length, 0);
        files.push({
          path: normalizeMentionPath(root, target),
          content: buffer.toString('utf8', 0, result.bytesRead),
          truncated: stat.size > AGENT_WINDOW_MENTION_READ_BYTES,
          originalLength: stat.size,
        });
      } finally {
        await handle.close();
      }
    }

    return files;
  }

  private async handleAgentMessage(text?: string, taskId?: string | null, modelIntent?: ModelIntent, mentionedFiles?: unknown): Promise<void> {
    const message = typeof text === 'string' ? text.trim() : '';
    if (!message) return;
    const runStart = agentRunRegistry.tryStart(taskId || null, 'agentWindow');
    if (!runStart.ok) {
      await this.panel.webview.postMessage({
        command: 'agentRunBlocked',
        owner: runStart.owner,
        taskId: taskId || null,
      });
      return;
    }

    const workspaceId = this.getWorkspaceId();
    let processedMessage = message;
    try {
      const fileContexts = await this.readMentionedFiles(mentionedFiles);
      processedMessage = buildAgentWindowPromptWithFileMentions(message, fileContexts, {
        maxCharsPerFile: AGENT_WINDOW_MENTION_READ_BYTES,
      });
    } catch (err: any) {
      await this.panel.webview.postMessage({
        command: 'agentEvent',
        event: { type: 'context_warning', message: err?.message || '添付ファイルを読み込めませんでした' },
      });
    }

    const payload = JSON.stringify({
      message: processedMessage,
      workspaceId,
      taskId: taskId || null,
      ...(modelIntent ? { modelIntent } : {}),
    });
    this.currentAgentTaskId = taskId || null;

    const req = http.request({
      hostname: 'localhost',
      port: this.runtime.port,
      path: '/api/agent',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-torii-token': this.runtime.token,
      },
    }, (res: any) => {
      let buffer = '';
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            this.handleAgentEvent(JSON.parse(jsonStr));
          } catch {
            // Ignore malformed SSE packets.
          }
        }
      });
      res.on('end', () => {
        this.flushAgentTextDelta();
        this.flushAgentEventBatch();
        agentRunRegistry.finish(this.currentAgentTaskId, 'agentWindow');
        this.agentReq = null;
        this.currentAgentTaskId = null;
        void updateBudgetDisplay(this.context);
        void this.sendTasks();
      });
    });

    this.agentReq = req;
    req.on('error', (err: Error) => {
      this.flushAgentTextDelta();
      this.flushAgentEventBatch();
      agentRunRegistry.finish(this.currentAgentTaskId, 'agentWindow');
      this.agentReq = null;
      this.currentAgentTaskId = null;
      if (err.message !== 'socket hang up') {
        void this.panel.webview.postMessage({ command: 'agentEvent', event: { type: 'error', message: err.message } });
      }
    });
    req.write(payload);
    req.end();
  }

  private handleAgentEvent(event: any): void {
    if (event?.type === 'task_created' && typeof event.taskId === 'string') {
      agentRunRegistry.move(this.currentAgentTaskId, event.taskId, 'agentWindow');
      this.currentAgentTaskId = event.taskId;
    }
    if (event?.type === 'text_delta' && typeof event.text === 'string') {
      this.queueAgentTextDelta(event.text);
      return;
    }

    this.flushAgentTextDelta();
    if (shouldBatchAgentEvent(event)) {
      this.queueAgentEvent(event);
      return;
    }

    this.flushAgentEventBatch();
    void this.panel.webview.postMessage({ command: 'agentEvent', event });
  }

  private async handleAgentApprove(id?: string, approved?: boolean): Promise<void> {
    if (!id) return;
    const payload = JSON.stringify({ id, approved: !!approved });
    await new Promise<void>((resolve) => {
      const req = http.request({
        hostname: 'localhost',
        port: this.runtime.port,
        path: '/api/agent/approve',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'x-torii-token': this.runtime.token,
        },
      }, (res: any) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', resolve);
      req.write(payload);
      req.end();
    });
  }

  private queueAgentTextDelta(text: string): void {
    this.agentTextDeltaBuffer += text;
    if (this.agentTextDeltaTimer) return;
    this.agentTextDeltaTimer = setTimeout(() => this.flushAgentTextDelta(), 150);
  }

  private flushAgentTextDelta(): void {
    if (this.agentTextDeltaTimer) {
      clearTimeout(this.agentTextDeltaTimer);
      this.agentTextDeltaTimer = null;
    }
    if (!this.agentTextDeltaBuffer) return;
    const text = this.agentTextDeltaBuffer;
    this.agentTextDeltaBuffer = '';
    void this.panel.webview.postMessage({ command: 'agentEvent', event: { type: 'text_delta', text } });
  }

  private queueAgentEvent(event: any): void {
    this.agentEventBatch.push(event);
    if (this.agentEventBatchTimer) return;
    this.agentEventBatchTimer = setTimeout(() => this.flushAgentEventBatch(), AGENT_EVENT_BATCH_FLUSH_MS);
  }

  private flushAgentEventBatch(): void {
    if (this.agentEventBatchTimer) {
      clearTimeout(this.agentEventBatchTimer);
      this.agentEventBatchTimer = null;
    }
    this.agentEventBatch.flush();
  }

  private dispose(): void {
    AgentWindowPanel.currentPanel = undefined;
    this.agentReq?.destroy();
    agentRunRegistry.finish(this.currentAgentTaskId, 'agentWindow');
    this.agentReq = null;
    this.currentAgentTaskId = null;
    this.flushAgentTextDelta();
    this.flushAgentEventBatch();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
