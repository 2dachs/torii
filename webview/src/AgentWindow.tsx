import { useEffect, useState } from 'react';
import { getPendingAgentWindowApprovals } from './agentWindowApprovals';
import {
  addMentionedFile,
  getActiveFileMentionQuery,
  insertMentionToken,
  type MentionedFile,
} from './agentWindowMentions';
import { getPreviewUrlTarget } from './agentWindowPreview';
import { applyAgentWindowMessage, type AgentWindowState } from './agentWindowState';
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
  const [input, setInput] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [resolvedApprovalIds, setResolvedApprovalIds] = useState<Set<string>>(() => new Set());
  const [fileTreePath, setFileTreePath] = useState('');
  const [fileTreeEntries, setFileTreeEntries] = useState<FileTreeEntry[]>([]);
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);
  const [rightPaneTab, setRightPaneTab] = useState<'files' | 'preview'>('files');
  const [previewInput, setPreviewInput] = useState('3000');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewNotice, setPreviewNotice] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionCandidates, setMentionCandidates] = useState<FileMentionEntry[]>([]);
  const [mentionError, setMentionError] = useState<string | null>(null);
  const [mentionedFiles, setMentionedFiles] = useState<MentionedFile[]>([]);
  const [state, setState] = useState<AgentWindowState>({
    tasks: [],
    activeTaskId: null,
    messages: [],
    tasksLoaded: false,
    tasksLoading: true,
    loading: false,
    streamingText: '',
    agentEvents: [],
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
    setState((current) => ({ ...current, activeTaskId: taskId, messages: [] }));
    vscode?.postMessage({ command: 'loadChatHistory', taskId });
  };

  const handleCreateTask = () => {
    vscode?.postMessage({ command: 'createTask', title: '新規タスク' });
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
      modelIntent: 'implementation',
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

  const pendingApprovals = getPendingAgentWindowApprovals(state.agentEvents, resolvedApprovalIds);

  const handleApproval = (approval: PendingApproval, approved: boolean) => {
    setResolvedApprovalIds((current) => new Set(current).add(approval.id));
    vscode?.postMessage({
      command: 'agentApprove',
      id: approval.id,
      approved,
    });
  };

  const handleFileTreeEntry = (entry: FileTreeEntry) => {
    if (entry.type === 'directory') {
      vscode?.postMessage({ command: 'loadFileTree', path: entry.path });
      return;
    }
    vscode?.postMessage({ command: 'openFile', path: entry.path });
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
        <button className="agent-window-primary-button" type="button" onClick={handleCreateTask}>新規タスク</button>
        <section className="agent-window-section">
          <h2>Tasks</h2>
          {state.tasksLoading && <div className="agent-window-empty">読み込み中</div>}
          {!state.tasksLoading && state.tasks.length === 0 && <div className="agent-window-empty">まだタスクがありません</div>}
          {state.tasks.length > 0 && (
            <div className="agent-window-task-list">
              {state.tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className={`agent-window-task ${task.id === state.activeTaskId ? 'is-active' : ''}`}
                  onClick={() => handleSelectTask(task.id)}
                >
                  <span>{task.title}</span>
                  <time>{formatTaskDate(task.updated_at)}</time>
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="agent-window-budget">
          <span>Budget</span>
          <strong>接続待ち</strong>
        </section>
      </aside>

      <section className="agent-window-main">
        <header className="agent-window-header">
          <div>
            <p className="agent-window-kicker">Torii Agent</p>
            <h2>{activeTask?.title ?? '大画面エージェント作業タブ'}</h2>
          </div>
          <div className="agent-window-status">
            {state.blockedOwner === 'sidebar' ? 'サイドバーで実行中' : serverPort ? `Backend :${serverPort}` : 'Backend 接続中'}
          </div>
        </header>

        {state.blockedOwner && (
          <div className="agent-window-inline-notice">
            {state.blockedOwner === 'sidebar'
              ? 'このタスクはサイドバー側でAgent実行中です。完了後にAgent Windowから再実行できます。'
              : 'このタスクは別のAgent Windowで実行中です。'}
          </div>
        )}

        <section className="agent-window-thread" aria-label="Agent conversation">
          {state.messages.length === 0 ? (
            <article className="agent-window-message agent-window-message-assistant">
              <p className="agent-window-message-meta">Torii</p>
              <p>タスクを選ぶと履歴を表示します。Agent送信、進捗、承認カードは次に接続します。</p>
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
                <div>
                  <p className="agent-window-message-meta">承認待ち · {approval.tool}</p>
                  <strong>{approvalSummary(approval)}</strong>
                </div>
                <div className="agent-window-approval-actions">
                  <button type="button" onClick={() => handleApproval(approval, false)}>拒否</button>
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
                <button key={file.path} type="button" className="agent-window-attachment-chip" onClick={() => handleMentionRemove(file.path)}>
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
            disabled={state.loading}
            onChange={(event) => updateComposerInput(event.target.value)}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onKeyDown={handleComposerKeyDown}
          />
          <div className="agent-window-composer-row">
            <span>{state.loading ? 'Agent実行中' : 'Enterで送信 / Shift+Enterで改行'}</span>
            <button type="button" disabled={!input.trim() || state.loading} onClick={handleSendAgent}>送信</button>
          </div>
        </footer>
      </section>

      <aside className="agent-window-right-pane">
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
  return (
    <article className={`agent-window-message ${isUser ? 'agent-window-message-user' : 'agent-window-message-assistant'}`}>
      <p className="agent-window-message-meta">
        {isUser ? 'You' : 'Torii'} · {formatTaskDate(message.created_at)}
      </p>
      <p>{message.content}</p>
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
