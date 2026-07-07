import { useEffect, useState } from 'react';
import {
  addMentionedFile,
  getActiveFileMentionQuery,
  insertMentionToken,
  type MentionedFile,
} from './agentWindowMentions';
import {
  beginDeleteConfirm,
  cancelDeleteConfirm,
  confirmDelete,
  initialDeleteConfirmState,
  type DeleteConfirmState,
} from './agentWindowDeleteConfirm';
import { getPreviewUrlTarget } from './agentWindowPreview';
import { applyAgentWindowMessage, type AgentWindowState } from './agentWindowState';
import { beginNewAgentWindowTask } from './agentWindowTaskActions';
import {
  agentWindowModelModes,
  getAgentWindowModelIntent,
  getAgentWindowModelModeLabel,
  getAgentWindowModelModeTitle,
  type AgentWindowModelMode,
} from './agentWindowModelMode';
import { stripAgentInternalReminder } from './agentWindowMessageText';
import { MarkdownContent } from './MarkdownContent';
import { getAgentWindowProgressText } from './agentWindowProgress';
import { buildInlineDiffPreview, formatDiffLines } from './diffPreview';
import type { AgentEvent, ChatMessage, PendingApproval, VsCodeMessage } from './types';

declare const acquireVsCodeApi: undefined | (() => { postMessage(message: unknown): void });

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

interface FileMentionEntry {
  name: string;
  path: string;
}

export default function AgentWindow() {
  const [serverPort, setServerPort] = useState<number | null>(null);
  const [extensionName, setExtensionName] = useState('Torii');
  const [workspaceName, setWorkspaceName] = useState('ワークスペース確認中');
  const [workspacePath, setWorkspacePath] = useState('');
  const [input, setInput] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [resolvedApprovalIds, setResolvedApprovalIds] = useState<Set<string>>(() => new Set());
  const [fileTreePath, setFileTreePath] = useState('');
  const [fileTreeEntries, setFileTreeEntries] = useState<FileTreeEntry[]>([]);
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);
  const [rightPaneTab, setRightPaneTab] = useState<'files' | 'preview'>('files');
  const [rightPaneOpen, setRightPaneOpen] = useState(false);
  const [previewInput, setPreviewInput] = useState('3000');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewNotice, setPreviewNotice] = useState<string | null>(null);
  const [modelMode, setModelMode] = useState<AgentWindowModelMode>('auto');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionCandidates, setMentionCandidates] = useState<FileMentionEntry[]>([]);
  const [mentionError, setMentionError] = useState<string | null>(null);
  const [mentionedFiles, setMentionedFiles] = useState<MentionedFile[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>(initialDeleteConfirmState);
  const [state, setState] = useState<AgentWindowState>({
    tasks: [],
    activeTaskId: null,
    messages: [],
    tasksLoaded: false,
    tasksLoading: true,
    loading: false,
    streamingText: '',
    agentEvents: [],
    pendingApprovals: [],
  });

  useEffect(() => {
    const handleMessage = (event: MessageEvent<VsCodeMessage>) => {
      const message = event.data;
      if (message.command === 'serverPort' && typeof message.port === 'number') {
        setServerPort(message.port);
      }
      if (message.command === 'extensionName' && typeof message.name === 'string') {
        setExtensionName(message.name);
      }
      if (message.command === 'workspaceInfo') {
        setWorkspaceName(typeof (message as any).name === 'string' ? (message as any).name : 'ワークスペース未設定');
        setWorkspacePath(typeof (message as any).path === 'string' ? (message as any).path : '');
      }
      if (message.command === 'fileTree') {
        setFileTreePath(typeof (message as any).path === 'string' ? (message as any).path : '');
        setFileTreeEntries(toFileTreeEntries(message.data));
        setFileTreeError(typeof (message as any).error === 'string' ? (message as any).error : null);
      }
      if (message.command === 'previewOpenError') {
        setPreviewNotice(typeof (message as any).message === 'string' ? (message as any).message : 'プレビューURLを開けませんでした');
      }
      if (message.command === 'fileMentions') {
        setMentionCandidates(toFileMentionEntries(message.data));
        setMentionError(typeof (message as any).error === 'string' ? (message as any).error : null);
      }
      setState((current) => {
        const next = applyAgentWindowMessage(current, message);
        for (const command of next.nextCommands) {
          vscode?.postMessage(command);
        }
        const { nextCommands: _nextCommands, ...nextState } = next;
        return nextState;
      });
    };

    window.addEventListener('message', handleMessage);
    vscode?.postMessage({ command: 'webviewReady' });
    vscode?.postMessage({ command: 'loadFileTree', path: '' });
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const activeTask = state.tasks.find((task) => task.id === state.activeTaskId) ?? null;

  const handleSelectTask = (taskId: string) => {
    setState((current) => ({ ...current, activeTaskId: taskId, messages: [], historyLoading: true }));
    vscode?.postMessage({ command: 'loadChatHistory', taskId });
  };

  const handleCreateTask = () => {
    setState((current) => beginNewAgentWindowTask(current));
  };

  const handleOpenSettings = () => {
    vscode?.postMessage({ command: 'openSettings' });
  };

  const updateComposerInput = (value: string) => {
    setInput(value);
    const query = getActiveFileMentionQuery(value);
    setMentionQuery(query);
    if (query === null) {
      setMentionCandidates([]);
      setMentionError(null);
      return;
    }
    vscode?.postMessage({ command: 'searchFileMentions', query });
  };

  const handleSendAgent = () => {
    const text = input.trim();
    if (!text || state.loading) return;

    const userMessage: ChatMessage = {
      id: `local-${Date.now()}`,
      workspace_id: '',
      task_id: state.activeTaskId,
      role: 'user',
      content: text,
      tokens_used: 0,
      cost_usd: 0,
      cost_jpy: 0,
      created_at: new Date().toISOString(),
    };
    setState((current) => ({
      ...current,
      messages: [...current.messages, userMessage],
      loading: true,
      streamingText: '',
      agentEvents: [],
    }));
    setResolvedApprovalIds(new Set());
    setInput('');
    setMentionQuery(null);
    setMentionCandidates([]);
    setMentionedFiles([]);
    vscode?.postMessage({
      command: 'sendMessage',
      text,
      taskId: state.activeTaskId,
      agentMode: 'agent',
      modelIntent: getAgentWindowModelIntent(modelMode),
      mentionedFiles: mentionedFiles.map((file) => file.path),
    });
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || isComposing) return;
    event.preventDefault();
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      handleMentionSelect(mentionCandidates[0]);
      return;
    }
    handleSendAgent();
  };

  const pendingApprovals = state.pendingApprovals.filter((approval) => !resolvedApprovalIds.has(approval.id));
  const latestUserPrompt = [...state.messages].reverse().find((message) => message.role === 'user')?.content ?? input;
  const progressText = getAgentWindowProgressText({
    loading: state.loading,
    prompt: latestUserPrompt,
    streamingText: state.streamingText,
    events: state.agentEvents,
  });

  const [cancelConfirm, setCancelConfirm] = useState(false);

  const handleCancelAgent = () => {
    if (!cancelConfirm) {
      setCancelConfirm(true);
      return;
    }
    setCancelConfirm(false);
    vscode?.postMessage({ command: 'cancelAgent' });
  };

  const handleApproval = (approval: PendingApproval, approved: boolean) => {
    setResolvedApprovalIds((current) => new Set(current).add(approval.id));
    vscode?.postMessage({
      command: 'agentApprove',
      id: approval.id,
      approved,
    });
  };

  const handleOpenApprovalDiff = (approvalId: string) => {
    vscode?.postMessage({ command: 'openApprovalDiff', id: approvalId });
  };

  const handleFileTreeEntry = (entry: FileTreeEntry) => {
    if (entry.type === 'directory') {
      vscode?.postMessage({ command: 'loadFileTree', path: entry.path });
      return;
    }
    vscode?.postMessage({ command: 'openFile', path: entry.path });
  };

  const handleDeleteTask = (taskId: string) => {
    const { next, shouldDelete } = confirmDelete(deleteConfirm, taskId);
    setDeleteConfirm(next);
    if (shouldDelete) {
      vscode?.postMessage({ command: 'deleteTask', taskId });
    }
  };

  const handleFileTreeUp = () => {
    if (!fileTreePath) return;
    vscode?.postMessage({ command: 'loadFileTree', path: fileTreePath.split('/').slice(0, -1).join('/') });
  };

  const handleMentionSelect = (file: FileMentionEntry) => {
    setMentionedFiles((current) => addMentionedFile(current, file));
    setInput((current) => insertMentionToken(current, file.path));
    setMentionQuery(null);
    setMentionCandidates([]);
    setMentionError(null);
  };

  const handleMentionRemove = (pathToRemove: string) => {
    setMentionedFiles((current) => current.filter((file) => file.path !== pathToRemove));
  };

  const handlePreviewOpen = () => {
    const target = getPreviewUrlTarget(previewInput);
    if (target.kind === 'invalid') {
      setPreviewNotice('http/https URL、localhost:3000、またはポート番号を入力してください。');
      return;
    }

    setPreviewNotice(null);
    if (target.kind === 'iframe') {
      setPreviewUrl(target.url);
      return;
    }

    setPreviewUrl(null);
    setPreviewNotice('外部URLはVS Code Simple Browserで開きます。');
    vscode?.postMessage({ command: 'openPreviewUrl', url: target.url });
  };

  return (
    <main className="agent-window-shell">
      <aside className="agent-window-sidebar">
        <div className="agent-window-brand">
          <span className="agent-window-kicker">{extensionName}</span>
          <h1>Agent Window</h1>
        </div>
        <section className="agent-window-workspace">
          <span>Project</span>
          <strong>{workspaceName}</strong>
          {workspacePath && <small title={workspacePath}>{workspacePath}</small>}
        </section>
        <button className="agent-window-primary-button" type="button" onClick={handleCreateTask} title="新規タスク">
          <span className="agent-window-button-icon" aria-hidden="true">＋</span>
          <span className="agent-window-button-label">新規タスク</span>
        </button>
        <section className="agent-window-section">
          <h2>Tasks</h2>
          {state.tasksLoading && <div className="agent-window-empty">読み込み中</div>}
          {!state.tasksLoading && state.tasks.length === 0 && <div className="agent-window-empty">まだタスクがありません</div>}
          {state.tasks.length > 0 && (
            <div className="agent-window-task-list">
              {state.tasks.map((task) => (
                <div
                  key={task.id}
                  className={`agent-window-task ${task.id === state.activeTaskId ? 'is-active' : ''}`}
                >
                  <button
                    type="button"
                    className="agent-window-task-open"
                    onClick={() => handleSelectTask(task.id)}
                  >
                    <span>{task.title}</span>
                    <time>{formatTaskDate(task.updated_at)}</time>
                  </button>
                  {deleteConfirm.pendingTaskId === task.id ? (
                    <div className="agent-window-task-confirm" role="group" aria-label={`「${task.title}」を削除しますか`}>
                      <button type="button" className="is-danger" onClick={() => handleDeleteTask(task.id)}>削除する</button>
                      <button type="button" onClick={() => setDeleteConfirm(cancelDeleteConfirm())}>キャンセル</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="agent-window-task-delete"
                      title="タスクを削除（履歴も削除されます）"
                      onClick={() => setDeleteConfirm(beginDeleteConfirm(task.id))}
                    >
                      削除
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </aside>

      <section className="agent-window-main">
        <header className="agent-window-header">
          <div>
            <p className="agent-window-kicker">Torii Agent</p>
            <h2>{activeTask?.title ?? '新規タスク'}</h2>
            <p className="agent-window-workspace-line" title={workspacePath}>
              {workspaceName}{workspacePath ? ` · ${workspacePath}` : ''}
            </p>
          </div>
          <div className="agent-window-header-actions">
            <div className="agent-window-model-switch" aria-label="Model routing mode">
              {agentWindowModelModes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={modelMode === mode ? 'is-active' : ''}
                  title={getAgentWindowModelModeTitle(mode)}
                  disabled={state.loading}
                  onClick={() => setModelMode(mode)}
                >
                  {getAgentWindowModelModeLabel(mode)}
                </button>
              ))}
            </div>
            <button type="button" className="agent-window-secondary-button" onClick={handleOpenSettings}>設定</button>
            <button
              type="button"
              className="agent-window-secondary-button agent-window-right-pane-toggle"
              aria-expanded={rightPaneOpen}
              aria-label={rightPaneOpen ? 'ファイル・プレビューパネルを閉じる' : 'ファイル・プレビューパネルを開く'}
              onClick={() => setRightPaneOpen((value) => !value)}
            >
              ◧
            </button>
            <div className="agent-window-status">
              {state.blockedOwner === 'sidebar' ? 'サイドバーで実行中' : serverPort ? `Backend :${serverPort}` : 'Backend 接続中'}
            </div>
          </div>
        </header>

        {state.blockedOwner && (
          <div className="agent-window-inline-notice">
            {state.blockedOwner === 'sidebar'
              ? 'このタスクはサイドバー側でAgent実行中です。完了後にAgent Windowから再実行できます。'
              : 'このタスクは別のAgent Windowで実行中です。'}
          </div>
        )}

        {progressText && (
          <div className="agent-window-progress-status" role="status" aria-live="polite">
            <span className="agent-window-progress-dot" aria-hidden="true" />
            <span>{progressText}</span>
          </div>
        )}

        <section className="agent-window-thread" aria-label="Agent conversation">
          {state.historyLoading && state.messages.length === 0 ? (
            <article className="agent-window-message agent-window-message-assistant">
              <p className="agent-window-message-meta">Torii</p>
              <p>履歴を読み込み中…</p>
            </article>
          ) : state.messages.length === 0 ? (
            <article className="agent-window-message agent-window-message-assistant">
              <p className="agent-window-message-meta">Torii</p>
              <p>タスクを選ぶか、下の入力欄からエージェントへの依頼を送信してください。</p>
            </article>
          ) : (
            <>
              {state.messages.map((message) => <AgentMessage key={message.id} message={message} />)}
              {state.streamingText && (
                <article className="agent-window-message agent-window-message-assistant">
                  <p className="agent-window-message-meta">Torii</p>
                  <p>{state.streamingText}</p>
                </article>
              )}
              {state.agentEvents.length > 0 && (
                <div className="agent-window-event-list">
                  {state.agentEvents.map((event, index) => (
                    <div key={`${event.type}-${index}`} className="agent-window-event">
                      {describeAgentEvent(event)}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {pendingApprovals.length > 0 && (
          <section className="agent-window-approval-bar" aria-label="Pending approvals">
            {pendingApprovals.map((approval) => (
              <div key={approval.id} className="agent-window-approval-card">
                <div className="agent-window-approval-card-body">
                  <div>
                    <p className="agent-window-message-meta">承認待ち · {approval.tool}</p>
                    <strong>{approvalSummary(approval)}</strong>
                  </div>
                  {approval.tool !== 'run_command' && renderApprovalDiff(approval)}
                </div>
                <div className="agent-window-approval-actions">
                  <button type="button" onClick={() => handleApproval(approval, false)}>拒否</button>
                  {approval.tool !== 'run_command' && (
                    <button type="button" onClick={() => handleOpenApprovalDiff(approval.id)}>エディタで開く</button>
                  )}
                  <button type="button" className="is-primary" onClick={() => handleApproval(approval, true)}>承認</button>
                </div>
              </div>
            ))}
          </section>
        )}

        <footer className="agent-window-composer">
          {mentionedFiles.length > 0 && (
            <div className="agent-window-attachment-row" aria-label="Mentioned files">
              {mentionedFiles.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className="agent-window-attachment-chip"
                  aria-label={`@${file.name} を添付から外す`}
                  onClick={() => handleMentionRemove(file.path)}
                >
                  <span>@{file.name}</span>
                  <span aria-hidden="true">x</span>
                </button>
              ))}
            </div>
          )}
          {mentionQuery !== null && (
            <div className="agent-window-mention-popover">
              {mentionError && <div className="agent-window-empty">{mentionError}</div>}
              {!mentionError && mentionCandidates.length === 0 && <div className="agent-window-empty">候補がありません</div>}
              {!mentionError && mentionCandidates.map((file) => (
                <button key={file.path} type="button" onClick={() => handleMentionSelect(file)}>
                  <span>{file.name}</span>
                  <small>{file.path}</small>
                </button>
              ))}
            </div>
          )}
          <textarea
            placeholder="エージェントへの依頼を入力"
            value={input}
            onChange={(event) => updateComposerInput(event.target.value)}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onKeyDown={handleComposerKeyDown}
          />
          <div className="agent-window-composer-row">
            <span>{state.loading ? 'Agent実行中（次の依頼を入力できます）' : 'Enterで送信 / Shift+Enterで改行'}</span>
            {state.loading ? (
              <button type="button" className="agent-window-stop-button" onClick={handleCancelAgent}>停止</button>
            ) : (
              <button type="button" disabled={!input.trim()} onClick={handleSendAgent}>送信</button>
            )}
          </div>
        </footer>
      </section>

      <aside className={`agent-window-right-pane ${rightPaneOpen ? 'is-open' : ''}`}>
        <div className="agent-window-tabs">
          <button className={rightPaneTab === 'files' ? 'is-active' : ''} type="button" onClick={() => setRightPaneTab('files')}>Files</button>
          <button className={rightPaneTab === 'preview' ? 'is-active' : ''} type="button" onClick={() => setRightPaneTab('preview')}>Preview</button>
        </div>
        {rightPaneTab === 'files' ? (
          <section className="agent-window-section">
            <h2>Files</h2>
            <div className="agent-window-file-tree-header">
              <span>{fileTreePath || 'workspace'}</span>
              {fileTreePath && <button type="button" onClick={handleFileTreeUp}>上へ</button>}
            </div>
            {fileTreeError && <div className="agent-window-empty">{fileTreeError}</div>}
            {!fileTreeError && fileTreeEntries.length === 0 && <div className="agent-window-empty">表示できるファイルがありません</div>}
            {fileTreeEntries.length > 0 && (
              <div className="agent-window-file-tree">
                {fileTreeEntries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    className="agent-window-file-entry"
                    onClick={() => handleFileTreeEntry(entry)}
                  >
                    <span aria-hidden="true">{entry.type === 'directory' ? '▸' : '·'}</span>
                    <span>{entry.name}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section className="agent-window-section agent-window-preview-section">
            <h2>Preview</h2>
            <div className="agent-window-preview-controls">
              <input
                type="text"
                value={previewInput}
                placeholder="3000 / localhost:5173"
                onChange={(event) => setPreviewInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handlePreviewOpen();
                }}
              />
              <button type="button" onClick={handlePreviewOpen}>開く</button>
            </div>
            {previewNotice && <div className="agent-window-empty">{previewNotice}</div>}
            {previewUrl ? (
              <iframe
                className="agent-window-preview-frame"
                title="Localhost preview"
                src={previewUrl}
                sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts"
              />
            ) : (
              <div className="agent-window-preview-placeholder">localhost の開発サーバーを表示できます</div>
            )}
          </section>
        )}
      </aside>
    </main>
  );
}

function approvalSummary(approval: PendingApproval): string {
  const command = typeof approval.data.command === 'string' ? approval.data.command : '';
  const filePath = typeof approval.data.path === 'string' ? approval.data.path : '';
  return command || filePath || approval.tool;
}

function renderApprovalDiff(approval: PendingApproval): JSX.Element | null {
  const approvalData = approval.data as Record<string, unknown>;
  const oldContent = typeof approvalData.oldContent === 'string' ? approvalData.oldContent : null;
  const newContent = typeof approvalData.newContent === 'string' ? approvalData.newContent : null;
  const skippedReason = typeof approvalData.diffPreviewSkippedReason === 'string' ? approvalData.diffPreviewSkippedReason : null;

  if (!oldContent || !newContent) {
    if (!skippedReason) return null;
    return (
      <div className="agent-window-approval-diff agent-window-approval-diff-fallback">
        <div className="agent-window-approval-diff-summary">{skippedReason}</div>
      </div>
    );
  }

  const preview = buildInlineDiffPreview(oldContent, newContent);
  return (
    <div className="agent-window-approval-diff">
      <div className="agent-window-approval-diff-summary">
        {preview.isChanged
          ? `先頭 ${preview.prefix} 行・末尾 ${preview.suffix} 行は変更なし / ${preview.originalLineCount} → ${preview.nextLineCount} 行`
          : '差分はありません'}
      </div>
      <div className="agent-window-approval-diff-grid">
        <section className="agent-window-approval-diff-column">
          <div className="agent-window-approval-diff-column-title">変更前</div>
          <pre className="agent-window-approval-diff-pre removed">
            {formatDiffLines(preview.originalChanged, preview.prefix + 1, '- ')}
          </pre>
        </section>
        <section className="agent-window-approval-diff-column">
          <div className="agent-window-approval-diff-column-title">変更後</div>
          <pre className="agent-window-approval-diff-pre added">
            {formatDiffLines(preview.nextChanged, preview.prefix + 1, '+ ')}
          </pre>
        </section>
      </div>
    </div>
  );
}

function toFileTreeEntries(value: unknown): FileTreeEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is FileTreeEntry => (
    !!entry
    && typeof entry === 'object'
    && typeof (entry as FileTreeEntry).name === 'string'
    && typeof (entry as FileTreeEntry).path === 'string'
    && ((entry as FileTreeEntry).type === 'file' || (entry as FileTreeEntry).type === 'directory')
  ));
}

function toFileMentionEntries(value: unknown): FileMentionEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is FileMentionEntry => (
    !!entry
    && typeof entry === 'object'
    && typeof (entry as FileMentionEntry).name === 'string'
    && typeof (entry as FileMentionEntry).path === 'string'
  ));
}

function AgentMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const content = isUser ? message.content : stripAgentInternalReminder(message.content);
  return (
    <article className={`agent-window-message ${isUser ? 'agent-window-message-user' : 'agent-window-message-assistant'}`}>
      <p className="agent-window-message-meta">
        {isUser ? 'You' : 'Torii'} · {formatTaskDate(message.created_at)}
      </p>
      {isUser ? <p>{content}</p> : <MarkdownContent content={content} />}
    </article>
  );
}

function formatTaskDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function describeAgentEvent(event: AgentEvent): string {
  if (event.type === 'thinking_start') return `thinking #${event.iteration}`;
  if (event.type === 'tool_use') return `tool: ${event.tool}`;
  if (event.type === 'tool_result') return `result: ${event.tool} ${event.ok ? 'ok' : 'failed'}`;
  if (event.type === 'approval_required') return `approval: ${event.tool}`;
  if (event.type === 'done') return `done: ${event.iterations} iterations`;
  if (event.type === 'error') return `error: ${event.message}`;
  return event.type;
}
