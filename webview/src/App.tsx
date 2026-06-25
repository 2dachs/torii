import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Task, ChatMessage, ApiResponse, VsCodeMessage, ProviderSettings, ServerConfig, Attachment, ModelDef, FileContent, AgentMode, ModelIntent, AgentEvent, PendingApproval, RoutingRule, ModelLimit, SessionModelStat, LicenseStatus } from './types';
import { MSG_EDITOR_CONTENT, MSG_READ_FILES, MSG_WRITE_FILE, MSG_FILE_CONTENTS, MSG_AGENT_APPROVE, MSG_UNDO_FILE_CHANGE, MSG_UPDATE_MODEL_CONFIG, MSG_LOAD_ROUTING_RULES, MSG_SAVE_ROUTING_RULE, MSG_DELETE_ROUTING_RULE, MSG_LOAD_PETTAL_CONFIG, MSG_SAVE_PETTAL_CONFIG, MSG_GET_MODEL_USAGE, MSG_MODEL_USAGE_DATA, MSG_SETUP_OLLAMA, MSG_GET_LICENSE_STATUS, MSG_ACTIVATE_LICENSE, MSG_LICENSE_STATUS, MSG_RENAME_TASK, MSG_DELETE_TASK } from '../../src/constants';
import { buildBudgetMeterState } from './budget.js';

const vscode = acquireVsCodeApi?.();
const ONBOARDING_DISMISSED_KEY = 'torii_onboarding_dismissed_v1';

const TOOL_JAPANESE_NAMES: Record<string, string> = {
  read_file: 'ファイル読み込み中',
  write_file: 'ファイル編集中',
  replace_in_file: 'ファイル差分更新中',
  run_command: 'コマンド実行中',
  list_dir: 'ディレクトリ確認中',
  list_directory: 'ディレクトリ確認中',
  search_files: 'ファイル検索中',
  grep: 'コード検索中',
};

const TOOL_ICONS: Record<string, string> = {
  read_file: '📖',
  write_file: '✏️',
  replace_in_file: '📝',
  run_command: '⚡',
  list_dir: '📁',
  list_directory: '📁',
  search_files: '🔍',
  grep: '🔍',
};

const TOOL_CATEGORIES: Record<string, string> = {
  read_file: 'read',
  write_file: 'write',
  replace_in_file: 'write',
  run_command: 'command',
  list_dir: 'list',
  list_directory: 'list',
  search_files: 'search',
  grep: 'search',
};

const CONTEXT_TOKEN_LIMITS: Record<string, number> = {
  'claude-opus': 180000,
  'claude-sonnet': 180000,
  'deepseek-chat': 60000,
  'deepseek-reasoner': 60000,
  'gpt-4o': 120000,
  'gpt-4o-mini': 120000,
  'gemini-2.5-flash': 1000000,
  'gemini-2.5-pro': 1000000,
  default: 60000,
};

function estimateContextTokens(text: string): number {
  return Math.max(0, Math.floor(text.length / 4));
}

function getContextTokenLimit(modelId: string): number {
  const lower = modelId.toLowerCase();
  const key = Object.keys(CONTEXT_TOKEN_LIMITS).find((k) => k !== 'default' && lower.includes(k));
  return key ? CONTEXT_TOKEN_LIMITS[key] : CONTEXT_TOKEN_LIMITS.default;
}

function formatOpenRouterPrice(value?: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return '?';
  return `$${(numeric * 1_000_000).toFixed(numeric * 1_000_000 < 1 ? 3 : 2)}`;
}

function ToriiIcon({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width={size} height={size} className={className} style={{ flexShrink: 0 }}>
      <g fill="none" stroke="#E8412A" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round">
        <path d="M 64 138 Q 256 96 448 138" />
        <path d="M 96 172 L 416 172" />
        <path d="M 124 232 L 388 232" />
        <path d="M 256 172 L 256 200" />
        <path d="M 148 172 L 138 432" />
        <path d="M 364 172 L 374 432" />
      </g>
      <g fill="#E8412A">
        <path d="M 196 376 q 0 -22 26 -24 l 86 0 q 22 0 28 14 l 6 14 q 4 12 -8 14 l -118 0 q -20 0 -20 -18 z" />
        <circle cx="334" cy="366" r="20" />
        <path d="M 348 370 q 18 -2 22 8 q 2 8 -8 10 l -16 -2 z" />
        <circle cx="368" cy="374" r="2.5" fill="#1a1614" />
        <path d="M 322 356 q -6 -10 2 -18 q 10 -6 16 6 q 4 14 -4 22 q -8 4 -14 -10 z" />
        <rect x="216" y="392" width="12" height="26" rx="4" />
        <rect x="246" y="394" width="12" height="24" rx="4" />
        <rect x="288" y="392" width="12" height="26" rx="4" />
        <rect x="316" y="394" width="12" height="24" rx="4" />
        <path d="M 198 370 q -16 -10 -14 -28 q 2 -10 10 -8 q 6 4 4 14 q -2 12 4 18 z" />
      </g>
    </svg>
  );
}

function formatTaskDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'たった今';
  if (diffMin < 60) return `${diffMin}分前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}時間前`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}日前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function splitDiffLines(content: string): string[] {
  if (!content) return [];
  return content.replace(/\r\n/g, '\n').split('\n');
}

function formatDiffLines(lines: string[], startLine: number, prefix: string): string {
  if (lines.length === 0) return '（なし）';
  return lines
    .map((line, idx) => `${prefix}${String(startLine + idx).padStart(4, ' ')} | ${line}`)
    .join('\n');
}

type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; lang: string; code: string };

type OpenRouterCatalogModel = {
  id: string;
  name: string;
  context_length?: number;
  created?: number;
  architecture?: {
    input_modalities?: string[];
  };
  pricing?: {
    prompt?: string;
    completion?: string;
  };
};

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;
  let key = 0;

  const pushText = (value: string) => {
    if (value) nodes.push(value);
  };

  while (index < text.length) {
    const rest = text.slice(index);
    const match = rest.match(
      /^(https?:\/\/[^\s<]+|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/
    );
    if (!match) {
      const next = rest.search(/https?:\/\/|`|\*\*|__|\*|_|\[/);
      const chunk = next === -1 ? rest : rest.slice(0, next);
      pushText(chunk);
      index += chunk.length;
      continue;
    }

    const token = match[1];
    index += token.length;

    if (token.startsWith('http://') || token.startsWith('https://')) {
      nodes.push(
        <a key={`${keyPrefix}-link-${key++}`} href={token} target="_blank" rel="noreferrer">
          {token}
        </a>
      );
      continue;
    }

    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(<code key={`${keyPrefix}-code-${key++}`}>{token.slice(1, -1)}</code>);
      continue;
    }

    if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${key++}`}>
          {token.slice(2, -2)}
        </strong>
      );
      continue;
    }

    if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) {
      nodes.push(
        <em key={`${keyPrefix}-em-${key++}`}>
          {token.slice(1, -1)}
        </em>
      );
      continue;
    }

    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      nodes.push(
        <a key={`${keyPrefix}-href-${key++}`} href={linkMatch[2]} target="_blank" rel="noreferrer">
          {linkMatch[1]}
        </a>
      );
      continue;
    }

    pushText(token);
  }

  return nodes;
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  const flushParagraph = (buffer: string[]) => {
    if (buffer.length > 0) {
      blocks.push({ type: 'paragraph', text: buffer.join(' ') });
      buffer.length = 0;
    }
  };

  const paragraphBuffer: string[] = [];

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph(paragraphBuffer);
      i += 1;
      continue;
    }

    const fence = trimmed.match(/^```([\w+-]*)\s*$/);
    if (fence) {
      flushParagraph(paragraphBuffer);
      const lang = fence[1] || '';
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) i += 1;
      blocks.push({ type: 'code', lang, code: codeLines.join('\n') });
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph(paragraphBuffer);
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      i += 1;
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph(paragraphBuffer);
      const quoteLines = [quote[1]];
      i += 1;
      while (i < lines.length) {
        const next = lines[i].trim();
        if (!next.startsWith('>')) break;
        quoteLines.push(next.replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', text: quoteLines.join('\n') });
      continue;
    }

    const listItem = trimmed.match(/^([-*+])\s+(.*)$/) || trimmed.match(/^\d+\.\s+(.*)$/);
    if (listItem) {
      flushParagraph(paragraphBuffer);
      const ordered = /^\d+\./.test(trimmed);
      const items: string[] = [ordered ? (trimmed.match(/^\d+\.\s+(.*)$/)?.[1] || '') : (listItem[2] || '')];
      i += 1;
      while (i < lines.length) {
        const next = lines[i].trim();
        if (ordered) {
          const m = next.match(/^\d+\.\s+(.*)$/);
          if (!m) break;
          items.push(m[1]);
        } else {
          const m = next.match(/^[-*+]\s+(.*)$/);
          if (!m) break;
          items.push(m[1]);
        }
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    paragraphBuffer.push(trimmed);
    i += 1;
  }

  flushParagraph(paragraphBuffer);
  return blocks;
}

function MarkdownContent({ content, className = '' }: { content: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);

  return (
    <div className={`markdown-content ${className}`.trim()}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const Tag = `h${block.level}` as const;
          return (
            <Tag key={`${block.type}-${index}`} className={`md-heading level-${block.level}`}>
              {renderInlineMarkdown(block.text, `${block.type}-${index}`)}
            </Tag>
          );
        }
        if (block.type === 'paragraph') {
          return (
            <p key={`${block.type}-${index}`} className="md-paragraph">
              {renderInlineMarkdown(block.text, `${block.type}-${index}`)}
            </p>
          );
        }
        if (block.type === 'quote') {
          return (
            <blockquote key={`${block.type}-${index}`} className="md-blockquote">
              {block.text.split('\n').map((line, lineIndex) => (
                <p key={lineIndex}>{renderInlineMarkdown(line, `${block.type}-${index}-${lineIndex}`)}</p>
              ))}
            </blockquote>
          );
        }
        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag key={`${block.type}-${index}`} className="md-list">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineMarkdown(item, `${block.type}-${index}-${itemIndex}`)}</li>
              ))}
            </ListTag>
          );
        }
        return (
          <div key={`${block.type}-${index}`} className="md-code-block">
            <div className="md-code-header">
              <span>{block.lang || 'text'}</span>
              <button
                className="md-code-copy-btn"
                onClick={() => navigator.clipboard.writeText(block.code)}
                title="コードをコピー"
              >
                コピー
              </button>
            </div>
            <pre className="md-code-pre">
              <code>{block.code || ' '}</code>
            </pre>
          </div>
        );
      })}
    </div>
  );
}

function getGitLabel(command: string): string | null {
  if (!/git/.test(command)) return null;
  const ops: string[] = [];
  if (/git\s+add/.test(command)) ops.push('ステージング');
  if (/git\s+commit/.test(command)) ops.push('コミット');
  if (/git\s+push/.test(command)) ops.push('プッシュ');
  if (/git\s+pull/.test(command)) ops.push('プル');
  if (/git\s+merge/.test(command)) ops.push('マージ');
  if (/git\s+rebase/.test(command)) ops.push('リベース');
  if (/git\s+checkout/.test(command)) ops.push('ブランチ切替');
  if (/git\s+clone/.test(command)) ops.push('クローン');
  if (ops.length === 0) ops.push('Git操作');
  return ops.join('、') + '中';
}

const DEFAULT_CONFIG: ServerConfig = {
  provider: 'deepseek',
  providers: [
    { id: 'openai', name: 'OpenAI', description: '', hasKey: false, models: [] },
    { id: 'deepseek', name: 'DeepSeek', description: '', hasKey: false, models: [] },
    { id: 'anthropic', name: 'Anthropic', description: '', hasKey: false, models: [] },
    { id: 'ollama', name: 'Ollama', description: '', hasKey: false, models: [] },
    { id: 'gemini', name: 'Google Gemini', description: '画像読み取りに最適。APIキー設定で画像を自動橋渡し', hasKey: false, models: [] },
  ],
  endpoint: '',
  model: '',
  maxTokens: 4096,
  monthlyBudget: 10,
  exchangeRate: 150,
  autoRouting: true,
  mainProvider: '',
  mainModel: '',
  subProvider: 'ollama',
  subModel: 'qwen2.5-coder',
  openRouterPlanningModel: 'z-ai/glm-5.2',
  openRouterImplementationModel: 'deepseek/deepseek-v4-flash',
  modelLimits: [],
  pettalConfig: null,
  hasPettalFile: false,
};

function App() {
  const [title, setTitle] = useState('Torii');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [serverPort, setServerPort] = useState<number | null>(null);
  const [budgetTooltip, setBudgetTooltip] = useState<string>('');
  const [budgetMeter, setBudgetMeter] = useState(() => buildBudgetMeterState({
    currentCostUsd: 0,
    monthlyBudgetUsd: 0,
    exchangeRate: 150,
    displayCurrency: 'JPY',
  }));

  // ── エージェントモード ──
  const [agentMode, setAgentMode] = useState<AgentMode>('chat');
  const [modelIntent, setModelIntent] = useState<ModelIntent>('auto');
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [streamingText, setStreamingText] = useState<string>('');
  const [agentSteps, setAgentSteps] = useState<AgentEvent[]>([]);
  const [agentPhase, setAgentPhase] = useState<'thinking' | 'executing' | 'waiting' | null>(null);
  const [currentToolName, setCurrentToolName] = useState<string | null>(null);
  const [currentToolInput, setCurrentToolInput] = useState<Record<string, unknown>>({});
  const [agentModelInfo, setAgentModelInfo] = useState<{ providerId: string; modelName: string; isLocal: boolean } | null>(null);
  const [privacyBanner, setPrivacyBanner] = useState<string | null>(null);
  // スラッシュコマンドサジェスト
  const [showSlashSuggest, setShowSlashSuggest] = useState(false);
  const [slashSuggestQuery, setSlashSuggestQuery] = useState('');

  // ── マルチプロバイダー設定状態 ──
  const [serverConfig, setServerConfig] = useState<ServerConfig>(DEFAULT_CONFIG);
  const [providerSettings, setProviderSettings] = useState<Record<string, ProviderSettings>>({});
  const [activeProviderTab, setActiveProviderTab] = useState<string>('deepseek');

  // スロット onBlur と「使用」onClick の競合防止用フラグ
  // onMouseDown（onClick より前に発火）でフラグを立て、onBlur で検知してスキップする
  const suppressSlotBlurRef = useRef<Record<string, boolean>>({});

  const [copiedIds, setCopiedIds] = useState<Set<string>>(new Set());

  // ── クイック切替 & 添付 ──
  const [showQuickSwitch, setShowQuickSwitch] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [editorInfo, setEditorInfo] = useState<{
    fileName: string;
    language: string;
    lineCount: number;
    content?: string;
    contentLength?: number;
    contentTruncated?: boolean;
    selectedText?: string;
    selectedTextLength?: number;
    selectedTextTruncated?: boolean;
  } | null>(null);
  const [showEditorContext, setShowEditorContext] = useState(false);
  const [editorAttachMode, setEditorAttachMode] = useState<'file' | 'selection'>('file');

  // ── 進捗状態 ──
  const [processingStatus, setProcessingStatus] = useState<{
    providerId: string;
    providerName: string;
    model: string;
    modelName: string;
    routingReason?: string;
    touchedFiles: string[];
  } | null>(null);

  // ── 新機能: ルーティングルール・モデル設定 ──
  const [routingRules, setRoutingRules] = useState<RoutingRule[]>([]);
  const [showRoutingRulesEditor, setShowRoutingRulesEditor] = useState(false);
  const [newRuleForm, setNewRuleForm] = useState({ keyword: '', targetProvider: 'deepseek', targetModel: '', reason: '', enabled: true });
  const [modelLimitWarning, setModelLimitWarning] = useState<string | null>(null);
  const [showSessionStats, setShowSessionStats] = useState(false);
  const [showModelLimitsEditor, setShowModelLimitsEditor] = useState(false);
  const [showPettalConfigEditor, setShowPettalConfigEditor] = useState(false);
  const [pettalConfigText, setPettalConfigText] = useState('');
  const [escalationLoading, setEscalationLoading] = useState(false);
  const [escalateDraft, setEscalateDraft] = useState<{ p1: string; m1: string; p2: string; m2: string }>({ p1: '', m1: '', p2: '', m2: '' });
  const [escalateSavedSlot, setEscalateSavedSlot] = useState<0 | 1 | 2>(0);
  const [expandedProviderConfig, setExpandedProviderConfig] = useState<string | null>(null);
  const [taskListExpanded, setTaskListExpanded] = useState(false);
  const [taskSearchQuery, setTaskSearchQuery] = useState('');
  const [openRouterModels, setOpenRouterModels] = useState<OpenRouterCatalogModel[]>([]);
  const [openRouterModelQuery, setOpenRouterModelQuery] = useState('');
  const [openRouterModelsLoading, setOpenRouterModelsLoading] = useState(false);
  const [openRouterModelsError, setOpenRouterModelsError] = useState<string | null>(null);

  const [inputAreaHeight, setInputAreaHeight] = useState(200);

  // ── ライセンス ──
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus>('free');
  const [trialDaysRemaining, setTrialDaysRemaining] = useState<number | null>(null);
  const [isBeta, setIsBeta] = useState(false);
  const [showUpgradeBanner, setShowUpgradeBanner] = useState(false);
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [licenseActivating, setLicenseActivating] = useState(false);
  const [licenseMessage, setLicenseMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const chatRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const lastRequestRef = useRef<{
    text: string;
    taskId: string | null;
    agentMode: AgentMode;
    modelIntent: ModelIntent;
    images: Array<{ data: string; mimeType: string }>;
  } | null>(null);
  // ユーザーが意図的に「新しいチャット」モードに入ったときに true。
  // loadTasks の自動タスク選択を抑止するために使う。
  const isNewChatModeRef = useRef(false);

  // ── ProviderSettings のヘルパー ──
  const getProvider = useCallback(
    (id: string): ProviderSettings => {
      const def = serverConfig.providers.find((p) => p.id === id);
      return (
        providerSettings[id] || {
          id,
          name: def?.name || id,
          description: def?.description || '',
          hasKey: def?.hasKey || false,
          apiKey: '',
          endpoint: '',
          model: '',
          maxTokens: 4096,
          models: def?.models || [],
          modelSlots: def?.modelSlots,
        }
      );
    },
    [providerSettings, serverConfig]
  );

  const updateProvider = useCallback(
    (id: string, patch: Partial<ProviderSettings>) => {
      setProviderSettings((prev) => ({
        ...prev,
        [id]: { ...getProvider(id), ...patch },
      }));
    },
    [getProvider]
  );

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(ONBOARDING_DISMISSED_KEY);
      setShowOnboarding(dismissed !== '1');
    } catch {
      setShowOnboarding(false);
    }
  }, []);

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    try {
      localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1');
    } catch {
      // localStorage が使えない環境では表示を閉じるだけにする
    }
  }, []);

  const handleStartWithOllama = useCallback(() => {
    dismissOnboarding();
    setShowSettings(true);
    vscode?.postMessage({ command: MSG_SETUP_OLLAMA });
  }, [dismissOnboarding]);

  const handleOpenSettingsFromOnboarding = useCallback(() => {
    dismissOnboarding();
    setShowSettings(true);
    vscode?.postMessage({ command: 'settingsConfig' });
  }, [dismissOnboarding]);

  // ── Extension Host からのメッセージ受信 ──
  useEffect(() => {
    const handler = (event: MessageEvent<VsCodeMessage>) => {
      const msg = event.data;
      switch (msg.command) {
        case 'extensionName':
          if (msg.name) setTitle(msg.name);
          break;
        case 'serverPort':
          if (msg.port) setServerPort(msg.port);
          break;
        case 'openRouterModels': {
          setOpenRouterModelsLoading(false);
          const openRouterMessage = msg as any;
          if (openRouterMessage.error) {
            setOpenRouterModelsError(openRouterMessage.error);
            break;
          }
          const models = Array.isArray(openRouterMessage.data?.data) ? openRouterMessage.data.data as OpenRouterCatalogModel[] : [];
          setOpenRouterModels(
            models
              .filter((model) => model.id && model.name)
              .sort((a, b) => (b.created || 0) - (a.created || 0))
          );
          break;
        }
        case 'loadTasks':
          if (Array.isArray(msg.data)) {
            const loadedTasks = msg.data as Task[];
            setTasks(loadedTasks);
          }
          break;
        case 'loadChatHistory':
          if (Array.isArray(msg.data)) setMessages(msg.data as ChatMessage[]);
          break;
        case 'receiveMessage': {
          const res = msg.data as ApiResponse | undefined;
          if (res) {
            setStreamingText('');
            const newMsg: ChatMessage = {
              id: Date.now().toString(),
              workspace_id: '',
              task_id: activeTaskId,
              role: res.blocked ? 'system' : res.needApiKey || res.invalidApiKey ? 'error' : 'assistant',
              content: res.reply,
              tokens_used: res.tokensUsed || 0,
              cost_usd: res.costUsd || 0,
              cost_jpy: res.costJpy || 0,
              created_at: new Date().toISOString(),
              providerId: res.provider,
              model: res.model,
              modelName: res.modelName,
              touchedFiles: res.touchedFiles,
              routingReason: res.routingReason,
            };
            setMessages((prev) => [...prev, newMsg]);

            // 進捗状態を更新
            setProcessingStatus({
              providerId: res.provider || serverConfig.provider,
              providerName: res.providerName || serverConfig.providers.find(p => p.id === (res.provider || serverConfig.provider))?.name || '',
              model: res.model || serverConfig.model,
              modelName: res.modelName || res.model || '',
              routingReason: res.routingReason,
              touchedFiles: res.touchedFiles || [],
            });

            // touchedFiles を自動で読み取る
            if (res.touchedFiles && res.touchedFiles.length > 0) {
              vscode?.postMessage({ command: MSG_READ_FILES, paths: res.touchedFiles });
            }

            if (res.totalCostThisMonth !== undefined) {
              setBudgetMeter(buildBudgetMeterState({
                currentCostUsd: res.totalCostThisMonth,
                monthlyBudgetUsd: res.monthlyBudget ?? serverConfig.monthlyBudget,
                exchangeRate: res.exchangeRate || serverConfig.exchangeRate || 150,
                displayCurrency: serverConfig.displayCurrency === 'USD' ? 'USD' : 'JPY',
              }));
              setBudgetTooltip('');
            }
            if (res.invalidApiKey) {
              setShowSettings(true);
            }
            if (res.modelLimitWarning) {
              setModelLimitWarning(res.modelLimitWarning);
              setTimeout(() => setModelLimitWarning(null), 8000);
            }
            // 自動作成されたタスクがあればアクティブに設定してリストを更新
            if (res.autoCreatedTaskId) {
              isNewChatModeRef.current = false;
              setActiveTaskId(res.autoCreatedTaskId);
              vscode?.postMessage({ command: 'loadTasks' });
            }
          }
          setLoading(false);
          setShowQuickSwitch(false);
          break;
        }
        case 'error':
          setStreamingText('');
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              workspace_id: '',
              task_id: activeTaskId,
              role: 'error',
              content: msg.message || '不明なエラー',
              tokens_used: 0,
              cost_usd: 0,
              cost_jpy: 0,
              created_at: new Date().toISOString(),
            },
          ]);
          setLoading(false);
          setShowQuickSwitch(false);
          break;
        case 'requestCancelled':
          setLoading(false);
          setShowQuickSwitch(false);
          setStreamingText('');
          setAgentPhase(null);
          setCurrentToolName(null);
          setAgentSteps((prev) => prev.filter(e => e.type === 'file_change_applied' || e.type === 'file_change_undone'));
          break;
        case 'chatDelta':
          if ((msg as any).text) {
            setStreamingText((prev) => prev + (msg as any).text);
          }
          break;
        case 'secretSaved':
          if (msg.key) {
            const matches = msg.key.match(/torii\.(\w+)ApiKey/);
            if (matches) {
              updateProvider(matches[1], { hasKey: true, apiKey: '' });
            }
          }
          break;
        case 'secretValue':
          if (msg.key && msg.value !== undefined) {
            const matches = msg.key.match(/torii\.(\w+)ApiKey/);
            if (matches) {
              updateProvider(matches[1], { apiKey: msg.value, hasKey: !!msg.value });
            }
          }
          break;
        case 'updateBudget':
          if (msg.message) setBudgetTooltip(msg.message);
          break;
        case 'settingsConfig':
          if (msg.data) {
            const config = msg.data as ServerConfig & { currentBudgetUsd?: number };
            setServerConfig(config);
            setActiveProviderTab(config.provider);
            setEscalateDraft({
              p1: config.escalateProvider1 || '',
              m1: config.escalateModel1 || '',
              p2: config.escalateProvider2 || '',
              m2: config.escalateModel2 || '',
            });
            const initial: Record<string, ProviderSettings> = {};
            for (const p of config.providers) {
              initial[p.id] = {
                id: p.id,
                name: p.name,
                description: p.description || '',
                hasKey: p.hasKey,
                apiKey: '',
                endpoint: (p as any).endpoint || '',
                model: (p as any).model || '',
                maxTokens: (p as any).maxTokens || 4096,
                models: p.models || [],
                modelSlots: (p as any).modelSlots,
              };
            }
            setProviderSettings(initial);
            // 初期予算表示
            setBudgetMeter(buildBudgetMeterState({
              currentCostUsd: config.currentBudgetUsd ?? 0,
              monthlyBudgetUsd: config.monthlyBudget,
              exchangeRate: config.exchangeRate || 150,
              displayCurrency: config.displayCurrency === 'USD' ? 'USD' : 'JPY',
            }));
            setBudgetTooltip('');
          }
          break;
        case 'editorContent':
          if (msg.data) {
            setEditorInfo(msg.data as any);
          }
          break;
        case 'createTask':
          // タスク作成後にタスク一覧を再取得
          vscode?.postMessage({ command: 'loadTasks' });
          break;
        case 'agentEvent': {
          const evt = msg.event as AgentEvent;
          if (!evt) break;
          setAgentSteps((prev) => [...prev, evt]);
          if (evt.type === 'task_created') {
            isNewChatModeRef.current = false;
            setActiveTaskId(evt.taskId);
            vscode?.postMessage({ command: 'loadTasks' });
          } else if (evt.type === 'thinking_start') {
            setAgentPhase('thinking');
            setCurrentToolName(null);
          } else if (evt.type === 'text_delta') {
            setAgentPhase('thinking');
            setStreamingText((prev) => prev + evt.text);
          } else if (evt.type === 'tool_use') {
            setAgentPhase('executing');
            setCurrentToolName(evt.tool);
            setCurrentToolInput(evt.input);
          } else if (evt.type === 'tool_result') {
            setAgentPhase('thinking');
            setCurrentToolName(null);
          } else if (evt.type === 'model_info') {
            setAgentModelInfo({ providerId: evt.providerId, modelName: evt.modelName, isLocal: evt.isLocal });
          } else if (evt.type === 'privacy_notice') {
            setPrivacyBanner(evt.message);
            setTimeout(() => setPrivacyBanner(null), 10000);
          } else if (evt.type === 'context_warning') {
            setPrivacyBanner(evt.message);
            setTimeout(() => setPrivacyBanner(null), 15000);
          } else if (evt.type === 'approval_required') {
            setAgentPhase('waiting');
            setPendingApprovals((prev) => [...prev, { id: evt.id, tool: evt.tool, data: evt.data as Record<string, unknown> }]);
          } else if (evt.type === 'done') {
            // done イベント: ストリーミングテキストを確定メッセージに変換
            setStreamingText((currentText) => {
              const text = currentText || '(応答なし)';
              setMessages((prev) => [
                ...prev,
                {
                  id: Date.now().toString(),
                  workspace_id: '',
                  task_id: activeTaskId,
                  role: 'assistant',
                  content: text,
                  tokens_used: evt.tokensUsed,
                  cost_usd: evt.costUsd,
                  cost_jpy: evt.costJpy,
                  created_at: new Date().toISOString(),
                  providerId: agentModelInfo?.providerId,
                  modelName: agentModelInfo?.modelName,
                },
              ]);
              return '';
            });
            setAgentSteps((prev) => prev.filter(e => e.type === 'file_change_applied' || e.type === 'file_change_undone'));
            setAgentPhase(null);
            setCurrentToolName(null);
            setCurrentToolInput({});
            setLoading(false);
            // タスクリストを更新（自動作成されたタスクを反映）
            isNewChatModeRef.current = false;
            vscode?.postMessage({ command: 'loadTasks' });
            // 予算更新（数値stateと表示文字列を両方更新）
            if (evt.costUsd > 0) {
              const rate = serverConfig.exchangeRate || 150;
              const deltaJpy = evt.costJpy ?? evt.costUsd * rate;
              setBudgetMeter((prev) => buildBudgetMeterState({
                currentCostUsd: (prev.currentCostJpy + deltaJpy) / rate,
                monthlyBudgetUsd: serverConfig.monthlyBudget,
                exchangeRate: rate,
                displayCurrency: serverConfig.displayCurrency === 'USD' ? 'USD' : 'JPY',
                prefixText: '累計',
              }));
              setBudgetTooltip('');
            }
          } else if (evt.type === 'error') {
            setMessages((prev) => [
              ...prev,
              {
                id: Date.now().toString(),
                workspace_id: '',
                task_id: activeTaskId,
                role: 'error',
                content: `❌ ${evt.message}`,
                tokens_used: 0,
                cost_usd: 0,
                cost_jpy: 0,
                created_at: new Date().toISOString(),
              },
            ]);
            setStreamingText('');
            setAgentSteps((prev) => prev.filter(e => e.type === 'file_change_applied' || e.type === 'file_change_undone'));
            setAgentPhase(null);
            setCurrentToolName(null);
            setCurrentToolInput({});
            setLoading(false);
          }
          break;
        }

        case MSG_LOAD_ROUTING_RULES:
          if ((msg as any).data?.rules) {
            setRoutingRules((msg as any).data.rules);
          }
          break;
        case MSG_LOAD_PETTAL_CONFIG:
          if ((msg as any).data) {
            const d = (msg as any).data;
            if (d.config) {
              setPettalConfigText(JSON.stringify(d.config, null, 2));
            } else {
              setPettalConfigText(JSON.stringify({ version: 1, provider: serverConfig.provider, model: serverConfig.model, mainProvider: '', mainModel: '', subProvider: 'ollama', subModel: 'qwen2.5-coder', autoRouting: true, modelLimits: [] }, null, 2));
            }
            setServerConfig(prev => ({ ...prev, pettalConfig: d.config, hasPettalFile: d.hasPettalFile }));
          }
          break;

        case MSG_FILE_CONTENTS:
          if (Array.isArray(msg.data)) {
            const files = msg.data as FileContent[];
            setFileContents(files);
            // インラインファイル表示用にキャッシュ
            setInlineFiles(prev => {
              const next = { ...prev };
              for (const fc of files) {
                next[fc.path] = fc;
              }
              return next;
            });
            // 読み取り中フラグをクリア
            setInlineLoadingPaths(new Set());
          }
          break;
        case 'fileWritten':
          if (msg.data) {
            const info = msg.data as unknown as { path: string; success: boolean; error?: string };
            setFileWriteStatus(info);
            setTimeout(() => setFileWriteStatus(null), 3000);
          }
          break;
        case 'ollamaProgress': {
          const p = (msg as any).data as { step: string; message: string };
          if (!p) break;
          const role = p.step === 'error' ? 'error' : 'system';
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              workspace_id: '',
              task_id: activeTaskId,
              role,
              content: p.message,
              tokens_used: 0,
              cost_usd: 0,
              cost_jpy: 0,
              created_at: new Date().toISOString(),
            },
          ]);
          break;
        }
        case MSG_LICENSE_STATUS: {
          const lmsg = msg as any;
          setLicenseStatus(lmsg.status as LicenseStatus);
          setTrialDaysRemaining(lmsg.trialDaysRemaining ?? null);
          setIsBeta(!!lmsg.isBeta);
          // 体験期間終了時は自動でバナーを表示
          if (lmsg.status === 'trial_expired') setShowUpgradeBanner(true);
          break;
        }
        case 'licenseActivateResult': {
          const r = msg as any;
          setLicenseActivating(false);
          setLicenseMessage({ ok: r.ok, text: r.message });
          if (r.ok) setLicenseKeyInput('');
          break;
        }
        case 'escalateResponse': {
          const data = (msg as any).data;
          if (data?.error) {
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              workspace_id: '',
              task_id: activeTaskId,
              role: 'error' as const,
              content: `⚠️ 再実行エラー: ${data.error}`,
              tokens_used: 0, cost_usd: 0, cost_jpy: 0,
              created_at: new Date().toISOString(),
            }]);
          } else if (data?.reply) {
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              workspace_id: '',
              task_id: activeTaskId,
              role: 'assistant' as const,
              content: data.reply,
              tokens_used: data.tokensUsed || 0,
              cost_usd: data.costUsd || 0,
              cost_jpy: data.costJpy || 0,
              created_at: new Date().toISOString(),
              providerId: data.provider,
              model: data.model,
              modelName: data.modelName,
              routingReason: data.routingReason,
            }]);
            vscode?.postMessage({ command: 'loadChatHistory', taskId: activeTaskId });
          }
          setEscalationLoading(false);
          break;
        }
      }
    };

    window.addEventListener('message', handler);

    vscode?.postMessage({ command: 'loadTasks' });
    if (activeTaskId !== null) {
      vscode?.postMessage({ command: 'loadChatHistory', taskId: activeTaskId });
    }
    vscode?.postMessage({ command: 'settingsConfig' });
    vscode?.postMessage({ command: MSG_GET_LICENSE_STATUS });

    return () => window.removeEventListener('message', handler);
  }, [activeTaskId]);

  // ── チャットの自動スクロール ──
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, processingStatus, agentSteps, pendingApprovals]);

  // ── メッセージ送信 ──
  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || loading) return;

    const imageAttachments = attachments.filter(a => a.type === 'image');
    const textAttachment = attachments.find(a => a.type === 'text');
    const fileMentionToken = editorInfo ? `@${editorInfo.fileName}` : '';
    const baseContent = text;
    const hasFileMention = !!fileMentionToken && baseContent.includes(fileMentionToken);

    // テキスト添付がある場合はメッセージに追加
    let content = text;
    if ((showEditorContext || hasFileMention) && editorInfo) {
      const selectedText = editorAttachMode === 'selection' && editorInfo.selectedText ? editorInfo.selectedText : '';
      const contextBody = selectedText || (editorInfo.content || textAttachment?.data || '');
      const contextLabel = selectedText ? `選択範囲: ${editorInfo.fileName}` : `現在のファイル: ${editorInfo.fileName}`;
      const truncatedNotice =
        selectedText && editorInfo.selectedTextTruncated
          ? '\n\n※ 選択範囲が大きいため先頭20万文字のみ添付しています。'
          : !selectedText && editorInfo.contentTruncated
          ? '\n\n※ ファイルが大きいため先頭20万文字のみ添付しています。'
          : '';
      content = `${baseContent.replace(fileMentionToken, '').trim()}\n\n--- ${contextLabel} ---${truncatedNotice}\n\`\`\`${editorInfo.language || ''}\n${contextBody}\n\`\`\``;
    }

    // スラッシュコマンドを処理してモードを決定（ライセンスチェックより前に確定する）
    let effectiveMode = agentMode;
    let finalContent = content;
    if (content.startsWith('/agent ') || content === '/agent') {
      effectiveMode = 'agent';
      finalContent = content.replace(/^\/agent\s*/, '').trim() || content;
      setAgentMode('agent');
    } else if (content.startsWith('/chat ') || content === '/chat') {
      effectiveMode = 'chat';
      finalContent = content.replace(/^\/chat\s*/, '').trim() || content;
      setAgentMode('chat');
    }

    // エージェントループ: trial/valid/grace は通過。それ以外はブロック + CTA表示
    // メッセージをチャットに追加する前にチェックすることでゴーストメッセージを防ぐ
    if (effectiveMode === 'agent' && licenseStatus !== 'valid' && licenseStatus !== 'grace' && licenseStatus !== 'trial') {
      setShowUpgradeBanner(true);
      return;
    }

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      workspace_id: '',
      task_id: activeTaskId,
      role: 'user',
      content,
      tokens_used: 0,
      cost_usd: 0,
      cost_jpy: 0,
      created_at: new Date().toISOString(),
      imagePreviews: imageAttachments.length > 0
        ? imageAttachments.map(a => ({ data: a.data, mimeType: a.mimeType || 'image/png', name: a.name }))
        : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setShowQuickSwitch(false);
    setStreamingText('');
    setAgentSteps([]);
    lastRequestRef.current = {
      text: finalContent,
      taskId: activeTaskId,
      agentMode: effectiveMode,
      modelIntent,
      images: imageAttachments.map(a => ({ data: a.data, mimeType: a.mimeType || 'image/png' })),
    };

    vscode?.postMessage({
      command: 'sendMessage',
      text: finalContent,
      taskId: activeTaskId,
      agentMode: effectiveMode,
      modelIntent,
      images: imageAttachments.map(a => ({ data: a.data, mimeType: a.mimeType || 'image/png' })),
    });
    setModelIntent('auto');

    // 添付をクリア（テキスト添付は保持）
    setAttachments(prev => prev.filter(a => a.type === 'text'));
  }, [input, loading, activeTaskId, attachments, editorInfo, showEditorContext, licenseStatus, agentMode, modelIntent]);

  // ── キー入力 ──
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // IME変換中はEnterで送信しない（isComposing と Ref で二重チェック）
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isComposingRef.current) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // ── 入力欄リサイズ ──
  const handleResizeDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = inputAreaHeight;
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      setInputAreaHeight(Math.max(140, Math.min(500, startHeight + delta)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ── タスク選択 ──
  const handleSelectTask = useCallback((taskId: string) => {
    setActiveTaskId(taskId);
    vscode?.postMessage({ command: 'loadChatHistory', taskId });
  }, []);

  // ── 設定を開く → 最新設定を再取得 + 各プロバイダーのAPIキーを取得 ──
  const handleOpenSettings = useCallback(() => {
    vscode?.postMessage({ command: 'settingsConfig' });
    for (const p of serverConfig.providers) {
      vscode?.postMessage({ command: 'getSecret', key: `torii.${p.id}ApiKey` });
    }
    setShowSettings(true);
    setShowQuickSwitch(false);
  }, [serverConfig.providers]);

  const loadOpenRouterModels = useCallback(async () => {
    if (openRouterModelsLoading) return;
    setOpenRouterModelsLoading(true);
    setOpenRouterModelsError(null);
    vscode?.postMessage({ command: 'loadOpenRouterModels' });
  }, [openRouterModelsLoading]);

  const useOpenRouterCatalogModel = useCallback((modelId: string) => {
    const settings = getProvider('openrouter');
    const currentSlots = settings.modelSlots || ['', '', ''];
    const emptySlotIndex = currentSlots.findIndex((slot) => !slot);
    const replacementIndex = emptySlotIndex >= 0 ? emptySlotIndex : 0;
    const normalizedSlots = currentSlots.includes(modelId)
      ? currentSlots
      : currentSlots.map((slot, index) => (index === replacementIndex ? modelId : slot));
    const currentMainProvider = serverConfig.mainProvider || serverConfig.provider;
    const isMain = currentMainProvider === 'openrouter';

    updateProvider('openrouter', { model: modelId, modelSlots: normalizedSlots });
    if (isMain) {
      setServerConfig(prev => ({ ...prev, mainModel: modelId }));
    }
    vscode?.postMessage({
      command: 'updateProviderConfig',
      providerId: 'openrouter',
      config: {
        model: modelId,
        modelSlots: normalizedSlots,
        ...(isMain ? { mainModel: modelId, mainProvider: 'openrouter' } : {}),
      },
    });
  }, [getProvider, serverConfig.mainProvider, serverConfig.provider, updateProvider]);

  // ── APIキー保存（プロバイダー別） ──
  const handleSaveApiKey = useCallback(
    (providerId: string) => {
      const p = getProvider(providerId);
      vscode?.postMessage({
        command: 'saveSecret',
        key: `torii.${providerId}ApiKey`,
        value: p.apiKey.trim(),
      });
      // 設定も更新
      if (p.endpoint) {
        vscode?.postMessage({
          command: 'updateProviderConfig',
          providerId,
          config: { endpoint: p.endpoint, model: p.model },
        });
      }
    },
    [getProvider]
  );

  // ── プロバイダー切替（クイック） ──
  const handleQuickSwitchProvider = useCallback((providerId: string) => {
    vscode?.postMessage({
      command: 'updateProviderConfig',
      providerId,
      config: { provider: providerId },
    });
    setShowQuickSwitch(false);
  }, []);

  // ── スラッシュコマンドサジェスト ──
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    if (val.startsWith('/') && !val.includes(' ')) {
      setShowSlashSuggest(true);
      setSlashSuggestQuery(val.slice(1));
    } else {
      setShowSlashSuggest(false);
    }
  }, []);

  const handleSelectSlash = useCallback((cmd: string) => {
    setInput(`/${cmd} `);
    setShowSlashSuggest(false);
    if (cmd === 'agent') setAgentMode('agent');
    if (cmd === 'chat') setAgentMode('chat');
  }, []);

  // ── 承認ハンドラ ──
  const handleApprove = useCallback((id: string, approved: boolean, options?: { allowCommand?: boolean; command?: string }) => {
    setPendingApprovals((prev) => prev.filter((p) => p.id !== id));
    vscode?.postMessage({ command: MSG_AGENT_APPROVE, id, approved, ...options });
  }, []);

  const handleUndoFileChange = useCallback((undoId: string) => {
    vscode?.postMessage({ command: MSG_UNDO_FILE_CHANGE, undoId });
  }, []);

  // ── 新しいチャット開始 ──
  const handleNewChat = useCallback(() => {
    isNewChatModeRef.current = true;
    setActiveTaskId(null);
    setMessages([]);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const handleRenameTask = useCallback((taskId: string, currentTitle: string) => {
    const nextTitle = window.prompt('タスク名を変更', currentTitle);
    if (nextTitle === null) return;
    const trimmed = nextTitle.trim();
    if (!trimmed || trimmed === currentTitle) return;
    vscode?.postMessage({ command: MSG_RENAME_TASK, taskId, title: trimmed });
  }, []);

  const handleDeleteTask = useCallback((taskId: string, title: string) => {
    const ok = window.confirm(`「${title}」を削除します。履歴も消えます。`);
    if (!ok) return;
    if (taskId === activeTaskId) {
      setActiveTaskId(null);
      setMessages([]);
    }
    vscode?.postMessage({ command: MSG_DELETE_TASK, taskId });
  }, [activeTaskId]);

  const handleRetryLastRequest = useCallback(() => {
    const last = lastRequestRef.current;
    if (!last || loading) return;
    if (last.taskId !== activeTaskId) {
      setActiveTaskId(last.taskId);
    }
    setLoading(true);
    setShowQuickSwitch(false);
    setStreamingText('');
    setAgentSteps([]);
    vscode?.postMessage({
      command: 'sendMessage',
      text: last.text,
      taskId: last.taskId,
      agentMode: last.agentMode,
      modelIntent: last.modelIntent,
      images: last.images,
    });
  }, [loading, activeTaskId]);

  // ── 履歴クリア ──
  const handleClearHistory = useCallback(() => {
    const ok = window.confirm('現在のワークスペースの履歴をすべて削除します。よろしいですか？');
    if (!ok) return;
    vscode?.postMessage({ command: 'clearHistory' });
    setMessages([]);
  }, []);

  const handleCopy = useCallback((id: string, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedIds((prev) => new Set(prev).add(id));
      setTimeout(() => {
        setCopiedIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
      }, 2000);
    });
  }, []);

  const handleCancel = useCallback(() => {
    const cmd = agentMode === 'agent' ? 'cancelAgent' : 'cancelRequest';
    vscode?.postMessage({ command: cmd });
  }, [agentMode]);

  // ── 上位モデルで再実行（機能6）──
  const handleEscalate = useCallback((slot: 1 | 2) => {
    if (escalationLoading) return;
    setEscalationLoading(true);
    const targetProviderId = slot === 1 ? serverConfig.escalateProvider1 : serverConfig.escalateProvider2;
    const targetModelId = slot === 1 ? serverConfig.escalateModel1 : serverConfig.escalateModel2;
    const targetTier = slot === 1 ? 'flash' : 'opus';
    vscode?.postMessage({
      command: 'escalate',
      slot,
      targetTier,
      targetProviderId: targetProviderId || undefined,
      targetModelId: targetModelId || undefined,
      taskId: activeTaskId,
    });
  }, [escalationLoading, activeTaskId, serverConfig]);

  // ── 画像添付 ──
  const handleAttachImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const processImageFiles = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 10 * 1024 * 1024) continue; // 10MB制限（base64 変換後 ~13MB、サーバー上限 30MB に対して余裕を持たせる）
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1] || '';
        setAttachments(prev => [...prev, { type: 'image', data: base64, name: file.name, mimeType: file.type || 'image/png' }]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processImageFiles(e.target.files);
    e.target.value = '';
  }, [processImageFiles]);

  // ── 画像添付可否（canAttachImages はドラッグハンドラでも使うため早めに計算）──
  const _effectiveModelId = serverConfig.mainModel || serverConfig.model;
  const _currentModelDef = serverConfig.providers.flatMap(p => p.models || []).find(m => m.id === _effectiveModelId);
  const _geminiHasKey = serverConfig.providers.find(p => p.id === 'gemini')?.hasKey ?? false;
  const _canAttachImages = (_currentModelDef?.supportsImages ?? false) || _geminiHasKey;

  // ── ドラッグ&ドロップ ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (_canAttachImages) setIsDraggingOver(true);
  }, [_canAttachImages]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // relatedTarget が input-area 内の子要素なら無視（チラつき防止）
    const currentTarget = e.currentTarget as HTMLElement;
    if (currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (!_canAttachImages) return;
    processImageFiles(e.dataTransfer.files);
  }, [_canAttachImages, processImageFiles]);

  const handleRemoveAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  // ── エディタ内容の添付切替 ──
  const handleToggleEditorContext = useCallback(() => {
    if (!showEditorContext) {
      vscode?.postMessage({ command: 'editorContent' });
    }
    setShowEditorContext(prev => !prev);
  }, [showEditorContext]);

  // ── ファイル読み取り・編集機能 ──
  const [fileContents, setFileContents] = useState<FileContent[]>([]);
  const [activeFileTab, setActiveFileTab] = useState(0);
  const [showFileViewer, setShowFileViewer] = useState(false);
  const [editingFile, setEditingFile] = useState<{ path: string; content: string; originalContent: string } | null>(null);
  const [fileWriteStatus, setFileWriteStatus] = useState<{ path: string; success: boolean; error?: string } | null>(null);
  const [pendingFileWrite, setPendingFileWrite] = useState<{
    path: string;
    originalContent: string;
    nextContent: string;
    closeViewer: boolean;
  } | null>(null);
  // インラインファイル表示用: パス → ファイル内容
  const [inlineFiles, setInlineFiles] = useState<Record<string, FileContent>>({});
  // 読み取り中フラグ（パスセット）
  const [inlineLoadingPaths, setInlineLoadingPaths] = useState<Set<string>>(new Set());
  // インライン編集状態: パス → 編集内容
  const [inlineEditing, setInlineEditing] = useState<Record<string, string>>({});

  // メッセージからファイルパスを抽出する
  const extractFilePaths = useCallback((content: string): string[] => {
    const patterns = [
      // backtick code blocks with language: ```typescript:src/file.ts
      /```[\w]*:([^\s`\n]+)/g,
      // explicit file paths (relative or absolute)
      /(?:^|\s)(\.{0,2}\/[\w\-./]+\.\w{1,10})(?:\s|$)/gm,
    ];
    const paths = new Set<string>();
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const p = match[1].trim();
        if (p && !p.startsWith('http') && p.includes('.')) {
          paths.add(p);
        }
      }
    }
    return [...paths];
  }, []);

  // AI応答からファイルパスを検出して自動読み取り
  const autoReadFilesFromMessages = useCallback((msgs: ChatMessage[]) => {
    const assistantMsgs = msgs.filter(m => m.role === 'assistant');
    if (!assistantMsgs.length) return;
    const lastMsg = assistantMsgs[assistantMsgs.length - 1];
    const paths = extractFilePaths(lastMsg.content);
    if (paths.length > 0) {
      vscode?.postMessage({ command: MSG_READ_FILES, paths });
    }
  }, [extractFilePaths]);

  // ファイル読み取り
  const handleReadFiles = useCallback((paths: string[]) => {
    vscode?.postMessage({ command: MSG_READ_FILES, paths });
    setShowFileViewer(true);
  }, []);

  // ファイル書き込み
  const handleWriteFile = useCallback((filePath: string, content: string, originalContent: string, closeViewer = true) => {
    setPendingFileWrite({
      path: filePath,
      originalContent,
      nextContent: content,
      closeViewer,
    });
  }, []);

  const handleConfirmWriteFile = useCallback(() => {
    if (!pendingFileWrite) return;
    vscode?.postMessage({
      command: MSG_WRITE_FILE,
      path: pendingFileWrite.path,
      content: pendingFileWrite.nextContent,
    });
    setPendingFileWrite(null);
    if (pendingFileWrite.closeViewer) {
      setEditingFile(null);
      setShowFileViewer(false);
    }
  }, [pendingFileWrite]);

  const handleCancelWriteFile = useCallback(() => {
    setPendingFileWrite(null);
  }, []);

  // 編集ペインを開く
  const openFileEditor = useCallback((filePath: string, content: string) => {
    setEditingFile({ path: filePath, content, originalContent: content });
  }, []);

  const pendingFileDiff = useMemo(() => {
    if (!pendingFileWrite) return null;
    const originalLines = splitDiffLines(pendingFileWrite.originalContent);
    const nextLines = splitDiffLines(pendingFileWrite.nextContent);
    let prefix = 0;
    while (
      prefix < originalLines.length &&
      prefix < nextLines.length &&
      originalLines[prefix] === nextLines[prefix]
    ) {
      prefix += 1;
    }

    let suffix = 0;
    while (
      suffix < originalLines.length - prefix &&
      suffix < nextLines.length - prefix &&
      originalLines[originalLines.length - 1 - suffix] === nextLines[nextLines.length - 1 - suffix]
    ) {
      suffix += 1;
    }

    const originalChanged = originalLines.slice(prefix, originalLines.length - suffix);
    const nextChanged = nextLines.slice(prefix, nextLines.length - suffix);

    return {
      originalLineCount: originalLines.length,
      nextLineCount: nextLines.length,
      prefix,
      suffix,
      originalChanged,
      nextChanged,
      isChanged: pendingFileWrite.originalContent !== pendingFileWrite.nextContent,
    };
  }, [pendingFileWrite]);

  // ── セッション内モデル別統計（機能4）──
  const sessionModelStats = useMemo((): SessionModelStat[] => {
    const statsMap: Record<string, SessionModelStat> = {};
    for (const msg of messages) {
      if (msg.role !== 'assistant' || !msg.model) continue;
      const key = `${msg.providerId}::${msg.model}`;
      if (!statsMap[key]) {
        const providerName = serverConfig.providers.find(p => p.id === msg.providerId)?.name || msg.providerId || '';
        statsMap[key] = {
          modelId: msg.model,
          modelName: msg.modelName || msg.model,
          providerId: msg.providerId || '',
          providerName,
          calls: 0,
          costUsd: 0,
          costJpy: 0,
        };
      }
      statsMap[key].calls += 1;
      statsMap[key].costUsd += msg.cost_usd || 0;
      statsMap[key].costJpy += msg.cost_jpy || 0;
    }
    return Object.values(statsMap).sort((a, b) => b.calls - a.calls);
  }, [messages, serverConfig.providers]);

  const sessionTotalCostUsd = useMemo(() => sessionModelStats.reduce((s, m) => s + m.costUsd, 0), [sessionModelStats]);
  const sessionTotalCostJpy = useMemo(() => sessionModelStats.reduce((s, m) => s + m.costJpy, 0), [sessionModelStats]);

  // 現在選択中のプロバイダー情報 ──
  const currentProvider = serverConfig.providers.find(
    p => p.id === (serverConfig.mainProvider || serverConfig.provider)
  );
  const currentProviders = serverConfig.providers;
  const filteredTasks = useMemo(() => {
    const query = taskSearchQuery.trim().toLowerCase();
    if (!query) return tasks;
    return tasks.filter((task) => task.title.toLowerCase().includes(query));
  }, [tasks, taskSearchQuery]);
  const filteredOpenRouterModels = useMemo(() => {
    const query = openRouterModelQuery.trim().toLowerCase();
    const models = query
      ? openRouterModels.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(query))
      : openRouterModels;
    return models.slice(0, 12);
  }, [openRouterModels, openRouterModelQuery]);

  // 全プロバイダー×モデルの結合オプション（節約モデル選択用）
  const allModelOptions = useMemo(() =>
    currentProviders.flatMap(p => {
      if ((p.models || []).length === 0 && p.model) {
        return [{
          value: `${p.id}::${p.model}`,
          label: `${p.name} / ${p.model}`,
        }];
      }
      return (p.models || []).map(m => ({
        value: `${p.id}::${m.id}`,
        label: `${p.name} / ${m.name} (${m.tier.toUpperCase()})`,
      }));
    }),
    [currentProviders]
  );

  // ── 画像添付可否: 現モデルが画像対応、または Gemini キーが設定済み（橋渡し可能）──
  const effectiveModelId = _effectiveModelId;
  const currentModelDef = _currentModelDef;
  const supportsImages = _currentModelDef?.supportsImages ?? false;
  const geminiHasKey = _geminiHasKey;
  const canAttachImages = _canAttachImages;

  // ── 予算バー計算 ──
  const budgetPercent = budgetMeter.budgetPercent;
  const contextTokenCount = useMemo(() => {
    const messageTokens = messages.reduce((sum, msg) => sum + estimateContextTokens(msg.content || ''), 0);
    return messageTokens + estimateContextTokens(streamingText) + estimateContextTokens(input);
  }, [messages, streamingText, input]);
  const contextTokenLimit = getContextTokenLimit(effectiveModelId || serverConfig.model);
  const contextUsagePercent = contextTokenLimit > 0 ? (contextTokenCount / contextTokenLimit) * 100 : 0;

  return (
    <div className="app-container">
      {/* ── Header ── */}
      <div className="app-header">
        <div className="app-header-title">
          <ToriiIcon size={18} />
          <span>{title}</span>
        </div>
        <div className="app-header-actions">
          <button className="icon-btn" title="Settings" onClick={handleOpenSettings}>
            ⚙️
          </button>
          <button className="icon-btn" title="Clear Chat History" onClick={handleClearHistory}>
            🗑️
          </button>
        </div>
      </div>

      {/* ── Task List ── */}
      <div className={`task-list${taskListExpanded ? ' expanded' : ''}`}>
        <div
          className="task-list-header"
          onClick={() => setTaskListExpanded(v => !v)}
          style={{ cursor: 'pointer' }}
          title={taskListExpanded ? 'タスクリストを折りたたむ' : 'タスクリストを展開'}
        >
          <span className="task-list-title">
            {taskListExpanded
              ? 'タスク'
              : (tasks.find(t => t.id === activeTaskId)?.title || (activeTaskId === null ? '新しいチャット' : 'タスク'))}
          </span>
          <div className="task-list-header-actions" onClick={e => e.stopPropagation()}>
            <button
              className="icon-btn task-add-btn"
              title="新しいチャットを開始（タスク名は最初のメッセージから自動生成）"
              onClick={handleNewChat}
            >
              ＋
            </button>
          </div>
          <span className="task-list-toggle">{taskListExpanded ? '▲' : '▼'}</span>
        </div>
        {taskListExpanded && (
          <>
            {activeTaskId === null && (
              <div className="task-item new-chat-indicator">
                ✏️ 新しいチャット
              </div>
            )}
            <div className="task-search-row">
              <input
                className="task-search-input"
                type="text"
                placeholder="タスクを検索"
                value={taskSearchQuery}
                onChange={(e) => setTaskSearchQuery(e.target.value)}
              />
              {taskSearchQuery && (
                <button className="task-search-clear" onClick={() => setTaskSearchQuery('')}>
                  ×
                </button>
              )}
            </div>
            {tasks.length === 0 ? (
              <div className="task-empty">「＋」を押してチャットを開始してください</div>
            ) : filteredTasks.length === 0 ? (
              <div className="task-empty">検索結果がありません</div>
            ) : (
              filteredTasks.map((task) => (
                <div
                  key={task.id}
                  className={`task-item${task.id === activeTaskId ? ' active' : ''}`}
                  onClick={() => { handleSelectTask(task.id); setTaskListExpanded(false); }}
                >
                  <span className="task-item-title" title={task.title}>{task.title}</span>
                  <div className="task-item-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="task-item-action"
                      title="名前を変更"
                      onClick={() => handleRenameTask(task.id, task.title)}
                    >
                      ✎
                    </button>
                    <button
                      className="task-item-action danger"
                      title="削除"
                      onClick={() => handleDeleteTask(task.id, task.title)}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* ── Chat Area ── */}
      <div className="chat-area" ref={chatRef}>
        {privacyBanner && (
          <div className="privacy-banner">
            {privacyBanner}
          </div>
        )}
        {showUpgradeBanner && (
          <div className={`upgrade-banner${licenseStatus === 'trial_expired' ? ' trial-expired' : ''}`}>
            <div className="upgrade-banner-body">
              <span className="upgrade-banner-icon">
                {licenseStatus === 'trial_expired' ? '🎉' : '🔒'}
              </span>
              <div>
                {licenseStatus === 'trial_expired' ? (
                  <>
                    <strong>気に入ってもらえましたか？</strong><br />
                    <span style={{ fontSize: '0.85em', opacity: 0.85 }}>
                      7日間のPro体験期間が終了しました。引き続きエージェント機能を使うには Proプランへどうぞ。
                    </span>
                  </>
                ) : (
                  <>
                    <strong>エージェントループはPro機能です</strong><br />
                    <span style={{ fontSize: '0.85em', opacity: 0.8 }}>¥980/月 で全機能をアンロック。</span>
                  </>
                )}
              </div>
            </div>
            <div className="upgrade-banner-actions">
              <button
                className="btn btn-primary upgrade-btn"
                onClick={() => vscode?.postMessage({ command: 'upgradePro' })}
              >
                👉 ¥980/月 — Pro にアップグレード
              </button>
              <button
                className="btn btn-ghost upgrade-dismiss"
                onClick={() => setShowUpgradeBanner(false)}
              >
                ✕
              </button>
            </div>
          </div>
        )}
        {messages.length === 0 && !loading && (
          activeTaskId === null ? (
            <div className="home-view">
              <div className="home-greeting">
                <ToriiIcon size={32} />
                <div>
                  <div className="home-greeting-title">Torii へようこそ</div>
                  <div className="home-greeting-desc">コストが見えるAIコーディングアシスタント。質問・コード生成・ファイル操作をまとめてお任せ。</div>
                </div>
              </div>
              <div className="home-section-title">最近のチャット</div>
              {tasks.length > 0 ? (
                <>
                  <div className="home-task-list">
                    {tasks.slice(0, 5).map(task => (
                      <div key={task.id} className="home-task-item" onClick={() => { handleSelectTask(task.id); setTaskListExpanded(false); }}>
                        <span className="home-task-name">{task.title}</span>
                        <span className="home-task-date">{formatTaskDate(task.updated_at)}</span>
                      </div>
                    ))}
                  </div>
                  {tasks.length > 5 && (
                    <button className="home-more-btn" onClick={() => setTaskListExpanded(true)}>
                      他のタスクを見る（{tasks.length - 5}件）
                    </button>
                  )}
                </>
              ) : (
                <div className="home-empty-hint">下の入力欄からメッセージを送ってチャットを始めましょう</div>
              )}
              {licenseStatus !== 'valid' && licenseStatus !== 'grace' && (
                isBeta ? (
                  <div className="home-pro-cta">
                    <div className="home-pro-badge">β版</div>
                    <div className="home-pro-text">
                      <strong>β版公開中 — Pro機能を開放しています</strong>
                      <span>β版終了後: エージェントモード等はPro版（¥980/月）が必要です</span>
                    </div>
                  </div>
                ) : (
                  <div className="home-pro-cta" onClick={() => vscode?.postMessage({ command: 'upgradePro' })}>
                    <div className="home-pro-badge">PRO</div>
                    <div className="home-pro-text">
                      <strong>エージェントモードをアンロック</strong>
                      <span>ファイル操作・コマンド実行・自律タスク実行</span>
                    </div>
                    <span className="home-pro-arrow">¥980/月 →</span>
                  </div>
                )
              )}
            </div>
          ) : (
            <div className="welcome-message">
              コーディングに関する質問やタスクを入力してください。<br />
              <span className="welcome-hint">⚡ {currentProvider?.name || 'AI'} ({serverConfig.model}) が応答します</span>
            </div>
          )
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}${msg.role === 'error' ? ' message-error' : ''}`}>
            {/* ユーザーメッセージ: 添付画像サムネイル */}
            {msg.role === 'user' && msg.imagePreviews && msg.imagePreviews.length > 0 && (
              <div className="message-image-thumbs">
                {msg.imagePreviews.map((img, i) => (
                  <div key={i} className="message-image-thumb-wrap">
                    <img
                      src={`data:${img.mimeType};base64,${img.data}`}
                      alt={img.name}
                      className="message-image-thumb"
                      title={img.name}
                    />
                  </div>
                ))}
              </div>
            )}
            <MarkdownContent content={msg.content} className="message-markdown" />
            {msg.role === 'error' && lastRequestRef.current && (
              <button className="message-retry-btn" onClick={handleRetryLastRequest}>
                ↻ 再試行
              </button>
            )}
            {(msg.role === 'user' || msg.role === 'assistant') && (
              <button
                className={`copy-btn${copiedIds.has(msg.id) ? ' copied' : ''}`}
                onClick={() => handleCopy(msg.id, msg.content)}
                title="コピー"
              >
                {copiedIds.has(msg.id) ? '✓' : '⎘'}
              </button>
            )}
            {/* アシスタントメッセージ: Gemini画像処理・ルーティングバッジ */}
            {msg.role === 'assistant' && msg.routingReason && (
              <div className="message-routing-badge" title={msg.routingReason}>
                {msg.routingReason}
              </div>
            )}
            {/* ファイルパスが含まれている場合、読み取りボタンを表示 */}
            {msg.role === 'assistant' && extractFilePaths(msg.content).length > 0 && (
              <button
                className="message-read-files-btn"
                onClick={() => handleReadFiles(extractFilePaths(msg.content))}
              >
                📂 ファイルを表示 ({extractFilePaths(msg.content).length}件)
              </button>
            )}
            {/* インラインファイルカード (touchedFilesから) */}
            {msg.role === 'assistant' && msg.touchedFiles && msg.touchedFiles.length > 0 && (() => {
              const loadedFiles = msg.touchedFiles.filter(p => inlineFiles[p]);
              if (loadedFiles.length === 0) return null;
              return (
                <div className="inline-files">
                  {loadedFiles.map(filePath => {
                    const fc = inlineFiles[filePath];
                    const isEditing = inlineEditing[filePath] !== undefined;
                    return (
                      <div key={filePath} className="inline-file-card">
                        <div className="inline-file-card-header">
                          <span className="inline-file-path" title={filePath}>
                            📄 {filePath.split('/').pop() || filePath}
                          </span>
                          <span className="inline-file-path-full">{filePath}</span>
                          <div className="inline-file-card-actions">
                            <button
                              className="inline-file-btn"
                              onClick={() => {
                                if (isEditing) {
                                  setInlineEditing(prev => { const n = {...prev}; delete n[filePath]; return n; });
                                } else {
                                  setInlineEditing(prev => ({ ...prev, [filePath]: fc.content }));
                                }
                              }}
                            >
                              {isEditing ? '👁 表示' : '✏️ 編集'}
                            </button>
                            <button
                              className="inline-file-btn apply"
                              onClick={() => {
                                const content = isEditing ? inlineEditing[filePath] : fc.content;
                                handleWriteFile(filePath, content, fc.content);
                              }}
                            >
                              💾 保存前に確認
                            </button>
                          </div>
                        </div>
                        {isEditing ? (
                          <textarea
                            className="inline-file-editor"
                            value={inlineEditing[filePath]}
                            onChange={e => setInlineEditing(prev => ({ ...prev, [filePath]: e.target.value }))}
                            spellCheck={false}
                            rows={Math.min(inlineEditing[filePath].split('\n').length, 20)}
                          />
                        ) : (
                          <pre className="inline-file-pre">{fc.content}</pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            <div className="message-meta">
              {msg.cost_usd > 0 && (
                <span className="message-cost">
                  {msg.tokens_used.toLocaleString()} tokens · ${msg.cost_usd.toFixed(4)}
                  {msg.cost_jpy > 0 ? ` (¥${msg.cost_jpy.toFixed(2)})` : ''}
                </span>
              )}
              {msg.providerId && (
                <span className={`message-provider${msg.providerId === 'ollama' ? ' local' : ''}`}>
                  {msg.providerId === 'ollama'
                    ? '🏠 ローカル（無料）'
                    : `☁️ ${serverConfig.providers.find(p => p.id === msg.providerId)?.name || msg.providerId}${msg.modelName ? ` · ${msg.modelName}` : msg.model ? ` · ${msg.model}` : ''}`}
                </span>
              )}
              {msg.touchedFiles && msg.touchedFiles.length > 0 && (
                <span className="message-files">
                  📁 {msg.touchedFiles.slice(0, 3).join(', ')}
                  {msg.touchedFiles.length > 3 ? ` +${msg.touchedFiles.length - 3}` : ''}
                </span>
              )}
            </div>
          </div>
        ))}
        {/* ── エージェントモード: ストリーミングテキスト + ステップ表示 ── */}
        {agentMode === 'agent' && (loading || agentSteps.some(e => e.type === 'file_change_applied' || e.type === 'file_change_undone')) && (
          <div className="agent-progress">
            {/* フェーズインジケーター */}
            {loading && (() => {
              const toolCat = TOOL_CATEGORIES[currentToolName || ''];
              const isGit = currentToolName === 'run_command' && /git/.test((currentToolInput.command as string) || '');
              const effCat = isGit ? 'git' : (toolCat || 'default');
              const gitLbl = isGit ? getGitLabel((currentToolInput.command as string) || '') : null;
              const toolLabel = gitLbl || TOOL_JAPANESE_NAMES[currentToolName || ''] || currentToolName || '';
              const toolIcon = isGit ? '🌿' : (TOOL_ICONS[currentToolName || ''] || '🔧');
              return (
                <div className={`agent-phase-bar${
                  agentPhase === 'thinking' ? ' thinking' :
                  agentPhase === 'executing' ? ` executing cat-${effCat}` :
                  agentPhase === 'waiting' ? ' waiting' : ''
                }`}>
                  {agentPhase === 'thinking' && <span className="phase-label thinking">🤔 考え中<span className="thinking-dots"></span></span>}
                  {agentPhase === 'executing' && (
                    <span className={`phase-label cat-${effCat}`}>
                      {toolIcon} {toolLabel}<span className="thinking-dots"></span>
                    </span>
                  )}
                  {agentPhase === 'waiting' && <span className="phase-label waiting">⏳ 承認を待っています<span className="waiting-dots"></span></span>}
                  {agentModelInfo && (
                    <span className={`agent-model-badge ${agentModelInfo.isLocal ? 'local' : 'cloud'}`}>
                      {agentModelInfo.isLocal ? '🏠 ローカル（無料）' : `☁️ ${agentModelInfo.modelName}`}
                    </span>
                  )}
                </div>
              );
            })()}
            {/* ツールステップ一覧 */}
            {agentSteps.filter(e => e.type === 'tool_use' || e.type === 'tool_result' || e.type === 'file_change_applied' || e.type === 'file_change_undone').map((evt, i) => {
              if (evt.type === 'tool_use') {
                return (
                  <div key={i} className="agent-step tool-use">
                    <span className="step-icon">🔄</span>
                    <span className="step-label">{TOOL_JAPANESE_NAMES[evt.tool] || evt.tool}</span>
                    <span className="step-detail">
                      {(evt.tool === 'read_file' || evt.tool === 'write_file') && (evt.input as any).path}
                      {evt.tool === 'run_command' && (evt.input as any).command}
                      {(evt.tool === 'search_files' || evt.tool === 'grep') && (evt.input as any).pattern}
                      {(evt.tool === 'list_dir' || evt.tool === 'list_directory') && ((evt.input as any).path || '.')}
                    </span>
                  </div>
                );
              }
              if (evt.type === 'tool_result') {
                return (
                  <div key={i} className={`agent-step tool-result ${evt.ok ? 'ok' : 'error'}`}>
                    <span className="step-icon">{evt.ok ? '✅' : '❌'}</span>
                    <span className="step-label">{TOOL_JAPANESE_NAMES[evt.tool] || evt.tool} 完了</span>
                  </div>
                );
              }
              if (evt.type === 'file_change_applied') {
                const undoResult = agentSteps.find(e => e.type === 'file_change_undone' && e.undoId === evt.undoId);
                return (
                  <div key={i} className="agent-step tool-result ok">
                    <span className="step-icon">↩</span>
                    <span className="step-label">{evt.path} を変更しました</span>
                    <button
                      className="inline-action-btn"
                      disabled={!!undoResult}
                      onClick={() => handleUndoFileChange(evt.undoId)}
                    >
                      {undoResult ? '元に戻し済み' : '元に戻す'}
                    </button>
                  </div>
                );
              }
              if (evt.type === 'file_change_undone') {
                return (
                  <div key={i} className={`agent-step tool-result ${evt.ok ? 'ok' : 'error'}`}>
                    <span className="step-icon">{evt.ok ? '↩' : '❌'}</span>
                    <span className="step-label">{evt.message}</span>
                  </div>
                );
              }
              return null;
            })}
            {streamingText && (
              <div className="agent-streaming-text">
                <MarkdownContent content={streamingText} className="message-markdown" />
              </div>
            )}
            {!streamingText && !agentPhase && (
              <div className="loading-dots">🤖 エージェントが起動しています...</div>
            )}
          </div>
        )}


        {/* ── 通常ローディング（チャットモード） ── */}
        {loading && agentMode === 'chat' && (
          <div className="loading-area">
            <div className="agent-phase-bar thinking">
              <span className="phase-label thinking">🤔 考え中<span className="thinking-dots"></span></span>
              {processingStatus && (
                <span className="chat-loading-badge">
                  <span className="badge-provider">{processingStatus.providerName}</span>
                  {processingStatus.modelName && <span className="badge-model"> · {processingStatus.modelName}</span>}
                  {processingStatus.routingReason && (
                    <span className="badge-routing-reason" title={processingStatus.routingReason}> 🔀</span>
                  )}
                </span>
              )}
            </div>
            {streamingText && (
              <div className="chat-streaming-preview">
                <MarkdownContent content={streamingText} className="message-markdown" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Budget Meter ── */}
      <div className="budget-meter">
        <span className="budget-meter-title">今月の予算</span>
        <div className="budget-meter-bar">
          <div
            className={`budget-meter-fill${budgetPercent >= 80 ? ' is-danger' : budgetPercent >= 60 ? ' is-warning' : ' is-ok'}`}
            style={{ width: `${Math.min(budgetPercent, 100)}%` }}
          />
        </div>
        <span className="budget-meter-label" title={budgetTooltip || budgetMeter.tooltip}>
          {budgetMeter.label}
        </span>
        {budgetPercent >= 80 && <span className="budget-meter-warn">⚠</span>}
        <button
          className="icon-btn budget-settings-btn"
          onClick={handleOpenSettings}
          title="予算設定を開く"
        >
          ⚙️
        </button>
      </div>
      <div className="context-meter">
        <span className="budget-meter-title">コンテキスト</span>
        <div className="budget-meter-bar">
          <div
            className={`budget-meter-fill${contextUsagePercent >= 80 ? ' is-danger' : contextUsagePercent >= 60 ? ' is-warning' : ' is-ok'}`}
            style={{ width: `${Math.min(contextUsagePercent, 100)}%` }}
          />
        </div>
        <span className="budget-meter-label" title={`推定 ${contextTokenCount.toLocaleString()} tokens / 上限 ${contextTokenLimit.toLocaleString()} tokens`}>
          {`${Math.min(Math.round(contextUsagePercent), 999)}% · ${contextTokenCount.toLocaleString()} / ${contextTokenLimit.toLocaleString()} tokens`}
        </span>
        {contextUsagePercent >= 80 && <span className="budget-meter-warn">⚠</span>}
      </div>

      {/* ── モデル上限警告バナー（機能3）── */}
      {modelLimitWarning && (
        <div className="model-limit-warning">
          {modelLimitWarning}
          <button className="model-limit-close" onClick={() => setModelLimitWarning(null)}>×</button>
        </div>
      )}

      {/* ── セッション内モデル統計（機能4）── */}
      {sessionModelStats.length > 0 && (
        <div className="session-stats">
          <button
            className="session-stats-toggle"
            onClick={() => setShowSessionStats(prev => !prev)}
          >
            📊 このセッション: {sessionModelStats.map(s => `${s.modelName} ${s.calls}回`).join(' | ')} · 合計 ${sessionTotalCostUsd.toFixed(4)}(¥{sessionTotalCostJpy.toFixed(0)})
            <span className="session-stats-arrow">{showSessionStats ? '▲' : '▼'}</span>
          </button>
          {showSessionStats && (
            <div className="session-stats-detail">
              <table className="session-stats-table">
                <thead>
                  <tr><th>モデル</th><th>プロバイダー</th><th>回数</th><th>コスト</th></tr>
                </thead>
                <tbody>
                  {sessionModelStats.map(s => (
                    <tr key={`${s.providerId}-${s.modelId}`}>
                      <td>{s.modelName}</td>
                      <td>{s.providerName}</td>
                      <td>{s.calls}回</td>
                      <td>${s.costUsd.toFixed(4)} (¥{s.costJpy.toFixed(0)})</td>
                    </tr>
                  ))}
                  <tr className="session-stats-total">
                    <td colSpan={2}>合計</td>
                    <td>{sessionModelStats.reduce((s, m) => s + m.calls, 0)}回</td>
                    <td>${sessionTotalCostUsd.toFixed(4)} (¥{sessionTotalCostJpy.toFixed(0)})</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── 上位モデルで再実行ボタン（機能6）── */}
      {messages.length > 0 && !loading && messages[messages.length - 1]?.role === 'assistant' && (() => {
        const slot1Model = serverConfig.providers.flatMap(p => p.models).find(m => m.id === serverConfig.escalateModel1);
        const slot2Model = serverConfig.providers.flatMap(p => p.models).find(m => m.id === serverConfig.escalateModel2);
        const slot1Label = slot1Model?.name || serverConfig.escalateModel1 || 'Flash';
        const slot2Label = slot2Model?.name || serverConfig.escalateModel2 || 'Opus';
        return (
          <div className="escalation-bar">
            <span className="escalation-label">上位モデルで再実行:</span>
            <button
              className="escalation-btn"
              onClick={() => handleEscalate(1)}
              disabled={escalationLoading}
              title={slot1Label !== 'Flash' ? `${slot1Label} で再実行` : 'Flash tierモデルで再実行（設定から変更可）'}
            >
              ⚡ {slot1Label}
            </button>
            <button
              className="escalation-btn escalation-opus"
              onClick={() => handleEscalate(2)}
              disabled={escalationLoading}
              title={slot2Label !== 'Opus' ? `${slot2Label} で再実行` : 'Opus/Pro tierモデルで再実行（設定から変更可）'}
            >
              🔮 {slot2Label}
            </button>
            {escalationLoading && <span className="escalation-loading">再実行中…</span>}
          </div>
        );
      })()}

      {/* ── Attachment Preview ── */}
      {attachments.length > 0 && (
        <div className="attachment-preview">
          {attachments
            .filter(a => a.type === 'image')
            .map((att, idx) => (
              <div key={idx} className="attachment-thumb">
                <div className="attachment-thumb-img">
                  <img src={`data:${att.mimeType || 'image/png'};base64,${att.data}`} alt={att.name} />
                </div>
                <span className="attachment-thumb-name">{att.name}</span>
                <button className="attachment-remove" onClick={() => handleRemoveAttachment(idx)}>×</button>
              </div>
            ))}
        </div>
      )}

      {/* ── 承認カード（run_command / write_file） ── */}
      {pendingApprovals.map((approval) => (
        <div key={approval.id} className="approval-card">
          {approval.tool === 'run_command' && (
            <>
              <div className="approval-header">🔧 コマンドを実行しますか？</div>
              <div className="approval-security-notice">⚠️ AIが生成したコマンドです。内容を必ず目視確認してから実行してください。</div>
              <pre className="approval-command">{(approval.data as any).command}</pre>
            </>
          )}
          {(approval.tool === 'write_file' || approval.tool === 'replace_in_file') && (
            <div className="approval-header">
              {approval.tool === 'replace_in_file' ? '✏️' : '📄'} {(approval.data as any).path} を変更しますか？
            </div>
          )}
          <div className="approval-actions">
            <button className="approval-btn approve" onClick={() => handleApprove(approval.id, true)}>
              ✅ {(approval.tool === 'write_file' || approval.tool === 'replace_in_file') ? 'Apply' : '実行'}
            </button>
            {approval.tool === 'run_command' && (
              <button
                className="approval-btn allow"
                onClick={() => handleApprove(approval.id, true, { allowCommand: true, command: (approval.data as any).command })}
              >
                ✅ 今後も許可
              </button>
            )}
            <button className="approval-btn reject" onClick={() => handleApprove(approval.id, false)}>
              ❌ キャンセル
            </button>
          </div>
        </div>
      ))}

      {/* ── Input Area ── */}
      <div
        className={`input-area${isDraggingOver ? ' drag-over' : ''}`}
        style={{ height: inputAreaHeight }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="resize-handle" onMouseDown={handleResizeDragStart} />
        {/* ── ツールバー行（モードトグル + アクションボタン）── */}
        <div className="input-toolbar">
          <button
            className={`mode-toggle-btn ${agentMode === 'chat' ? 'active' : ''}`}
            onClick={() => setAgentMode('chat')}
            title="チャットモード: 質問・相談"
          >
            ⚡ Chat
          </button>
          <button
            className={`mode-toggle-btn ${agentMode === 'agent' ? 'active agent-active' : ''}`}
            onClick={() => {
              if (licenseStatus !== 'valid' && licenseStatus !== 'grace' && licenseStatus !== 'trial') {
                setShowUpgradeBanner(true);
                setMessages(prev => [...prev, {
                  id: Date.now().toString(),
                  workspace_id: '',
                  task_id: activeTaskId,
                  role: 'system' as const,
                  content: '🔒 エージェントモードはProプランが必要です。Pro体験期間が終了しました。設定画面からライセンスキーを入力してください。',
                  tokens_used: 0, cost_usd: 0, cost_jpy: 0,
                  created_at: new Date().toISOString(),
                }]);
                return;
              }
              setAgentMode('agent');
            }}
            title="エージェントモード: ファイル操作・コマンド実行"
          >
            🤖 Agent
          </button>
          {(['auto', 'planning', 'implementation'] as const).map((intent) => (
            <button
              key={intent}
              className={`intent-toggle-btn ${modelIntent === intent ? 'active' : ''}`}
              onClick={() => setModelIntent(intent)}
              title={
                intent === 'auto'
                  ? '用途を自動判定'
                  : intent === 'planning'
                  ? '相談・レビュー・設計モデルを今回だけ使用'
                  : '実装・修正モデルを今回だけ使用'
              }
              disabled={loading}
            >
              {intent === 'auto' ? 'Auto' : intent === 'planning' ? '相談' : '実装'}
            </button>
          ))}
          <div className="input-toolbar-actions">
            {canAttachImages && (
              <button
                className={`icon-btn input-action-btn${attachments.filter(a => a.type === 'image').length > 0 ? ' active' : ''}`}
                title={
                  supportsImages
                    ? `画像を添付（${currentModelDef?.name || 'モデル'}が直接処理）`
                    : '画像を添付（Gemini 2.5 Flash で読み取り → メインモデルに橋渡し）'
                }
                onClick={handleAttachImage}
                disabled={loading}
              >
                🖼️{!supportsImages && geminiHasKey && <span className="gemini-bridge-dot" title="Gemini橋渡し">G</span>}
              </button>
            )}
            <button
              className={`icon-btn input-action-btn ${showEditorContext ? 'active' : ''}`}
              title={showEditorContext ? 'エディタ内容を添付中' : 'エディタ内容を添付'}
              onClick={handleToggleEditorContext}
              disabled={loading}
            >
              📝
            </button>
            <button
              className={`icon-btn input-action-btn ${showQuickSwitch ? 'active' : ''}`}
              title="プロバイダー切替"
              onClick={() => setShowQuickSwitch(prev => !prev)}
              disabled={loading}
            >
              🔄
            </button>
          </div>
        </div>

        {/* スラッシュコマンドサジェスト */}
        {showSlashSuggest && (
          <div className="slash-suggest">
            {[
              { cmd: 'agent', desc: 'エージェントモード（ファイル操作・コマンド実行）' },
              { cmd: 'chat', desc: 'チャットモード（質問・相談）' },
            ]
              .filter((s) => s.cmd.startsWith(slashSuggestQuery))
              .map((s) => (
                <button
                  key={s.cmd}
                  className="slash-suggest-item"
                  onMouseDown={(e) => { e.preventDefault(); handleSelectSlash(s.cmd); }}
                >
                  <span className="slash-cmd">/{s.cmd}</span>
                  <span className="slash-desc">{s.desc}</span>
                </button>
              ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder={
            agentMode === 'agent'
              ? '🤖 エージェントモード: ファイル操作・コマンド実行を自律的に行います'
              : showEditorContext && editorInfo
              ? `メッセージ入力 (${editorInfo.fileName} の内容を添付します)`
              : activeTaskId === null
              ? 'メッセージを入力して新しいチャットを開始 (Enter で送信)'
              : 'メッセージを入力 (Enter で送信, Shift+Enter で改行) | /agent でエージェントモード'
          }
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={() => { isComposingRef.current = false; }}
        />
        {loading ? (
          <button className="send-btn cancel-btn" onClick={handleCancel}>
            ⏹
          </button>
        ) : (
          <button className="send-btn" onClick={handleSend} disabled={!input.trim()}>
            送信
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>

      {/* ── Quick Switch Panel ── */}
      {showQuickSwitch && (
        <div className="quick-switch-panel">
          <div className="quick-switch-header">
            <span>⚡ プロバイダー切替</span>
            <button className="quick-switch-close" onClick={() => setShowQuickSwitch(false)}>×</button>
          </div>
          <div className="quick-switch-list">
            {currentProviders.map((p) => {
              const keyOk = p.hasKey || p.id === 'ollama';
              const isActive = p.id === serverConfig.provider;
              return (
                <button
                  key={p.id}
                  className={`quick-switch-item ${isActive ? 'active' : ''}`}
                  onClick={() => handleQuickSwitchProvider(p.id)}
                  disabled={!keyOk}
                >
                  <span className="qs-provider-name">
                    {p.name}
                    {isActive && <span className="qs-active-dot" />}
                  </span>
                  <span className="qs-provider-desc">{p.description || (keyOk ? '利用可能' : '🔑 APIキー未設定')}</span>
                  {p.models && p.models.length > 0 && (
                    <span className="qs-provider-models">
                      {p.models.slice(0, 3).map(m => m.name).join(', ')}
                      {p.models.length > 3 ? ` +${p.models.length - 3}` : ''}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {serverConfig.autoRouting && (
            <div className="quick-switch-footer">
              🔀 自動ルーティングが有効です。状況に応じて最適なプロバイダーが選択されます。
            </div>
          )}
        </div>
      )}

      {/* ── Editor Context Indicator ── */}
      {showEditorContext && editorInfo && (
        <div className="editor-context-bar">
          📝 <span className="ec-filename">{editorInfo.fileName}</span>
          <span className="ec-meta">
            {editorInfo.language} · {editorInfo.lineCount}行
            {editorInfo.contentTruncated ? ' · 先頭20万文字' : ''}
          </span>
          <button
            className={`ec-mode-btn${editorAttachMode === 'file' ? ' active' : ''}`}
            onClick={() => {
              setEditorAttachMode('file');
              setInput((prev) => {
                const token = `@${editorInfo.fileName}`;
                return prev.includes(token) ? prev : `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${token}`;
              });
              setTimeout(() => textareaRef.current?.focus(), 0);
            }}
            title="現在のファイル名を入力欄に挿入"
          >
            @
          </button>
          {editorInfo.selectedText && (
            <button
              className={`ec-mode-btn${editorAttachMode === 'selection' ? ' active' : ''}`}
              onClick={() => setEditorAttachMode('selection')}
              title="選択範囲を添付"
            >
              選択
            </button>
          )}
          <button className="ec-remove" onClick={handleToggleEditorContext}>×</button>
        </div>
      )}

      {/* ── Status Bar ── */}
      <div className="status-bar">
        <span>
          {currentProvider?.name || 'Torii'}
          {serverPort ? ` - localhost:${serverPort}` : ''}
        </span>
        <span className="status-bar-right">
          <span className={`status-tier tier-${currentModelDef?.tier || 'flash'}`}>
            {currentModelDef?.tier?.toUpperCase() || 'FLASH'}
          </span>
          <span>{currentModelDef?.name || serverConfig.model}</span>
        </span>
      </div>

      {/* ═══════════════════════ Settings Overlay ═══════════════════════ */}
      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <h3>⚙️ 設定</h3>

            {/* ── Section 1: 使用モデル ── */}
            <div className="settings-section-title">使用モデル</div>
            <span className="budget-hint" style={{display:'block', marginBottom: 4}}>
              通常使うモデル。自動ルーティング有効時はタスク内容で変わる場合があります
            </span>
            <div className="active-model-row">
              <select
                className="settings-select"
                value={serverConfig.mainProvider || serverConfig.provider}
                onChange={(e) => {
                  const pid = e.target.value;
                  const providerDef = serverConfig.providers.find(pr => pr.id === pid);
                  const firstModel = providerDef?.models[0]?.id || '';
                  setServerConfig(prev => ({ ...prev, mainProvider: pid, mainModel: firstModel }));
                  vscode?.postMessage({ command: MSG_UPDATE_MODEL_CONFIG, config: { mainProvider: pid, mainModel: firstModel } });
                }}
              >
                {currentProviders.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {(() => {
                const mainPid = serverConfig.mainProvider || serverConfig.provider;
                const mainProviderDef = serverConfig.providers.find(p => p.id === mainPid);
                const hasFreeInput = mainPid === 'openrouter' || !mainProviderDef?.models || mainProviderDef.models.length === 0;
                if (hasFreeInput) {
                  return (
                    <input
                      type="text"
                      className="settings-select"
                      placeholder="例: openai/gpt-4o"
                      value={serverConfig.mainModel || ''}
                      onChange={(e) => setServerConfig(prev => ({ ...prev, mainModel: e.target.value }))}
                      onBlur={(e) => {
                        const mid = e.target.value;
                        vscode?.postMessage({ command: MSG_UPDATE_MODEL_CONFIG, config: { mainProvider: mainPid, mainModel: mid } });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                    />
                  );
                }
                return (
                  <select
                    className="settings-select"
                    value={serverConfig.mainModel || serverConfig.model}
                    onChange={(e) => {
                      const mid = e.target.value;
                      setServerConfig(prev => ({ ...prev, mainModel: mid }));
                      vscode?.postMessage({ command: MSG_UPDATE_MODEL_CONFIG, config: { mainProvider: mainPid, mainModel: mid } });
                    }}
                  >
                    {mainProviderDef?.models.map(m => (
                      <option key={m.id} value={m.id}>{m.name} ({m.tier.toUpperCase()})</option>
                    ))}
                  </select>
                );
              })()}
            </div>

            {/* ── Section 2: APIキー設定 ── */}
            <div className="settings-divider" />
            <div className="settings-section-title">接続設定</div>
            <div className="provider-config-list">
              {currentProviders.map(p => {
                const settings = getProvider(p.id);
                const isExpanded = expandedProviderConfig === p.id;
                const isOllama = p.id === 'ollama';
                const hasKey = p.hasKey || isOllama;
                return (
                  <div key={p.id} className="provider-config-row">
                    <button
                      className="provider-config-header"
                      onClick={() => {
                        if (!isExpanded) {
                          vscode?.postMessage({ command: 'getSecret', key: `torii.${p.id}ApiKey` });
                        }
                        setExpandedProviderConfig(isExpanded ? null : p.id);
                      }}
                    >
                      <span className="provider-config-name">{p.name}</span>
                      <span className={`provider-key-status ${hasKey ? 'ok' : 'unset'}`}>
                        {isOllama ? 'ローカル' : hasKey ? '✓ 設定済' : '未設定'}
                      </span>
                      <span className="provider-config-arrow">{isExpanded ? '▲' : '▼'}</span>
                    </button>
                    {isExpanded && (
                      <div className="provider-config-body">
                        <p className="provider-desc">{p.description}</p>
                        {!isOllama && (
                          <div className="settings-field">
                            <label>API Key</label>
                            <input
                              type="password"
                              placeholder={hasKey ? '●●●●●●●● (上書きする場合のみ)' : 'APIキーを入力...'}
                              value={settings.apiKey}
                              onChange={(e) => updateProvider(p.id, { apiKey: e.target.value })}
                            />
                          </div>
                        )}
                        <div className="settings-field">
                          <label>モデル</label>
                          {p.id === 'openrouter' ? (
                            <div className="openrouter-slots">
                              <div className="openrouter-catalog">
                                <div className="openrouter-catalog-controls">
                                  <input
                                    className="settings-input"
                                    type="text"
                                    placeholder="OpenRouterモデルを検索（例: GLM 5.2 / MiniMax M3）"
                                    value={openRouterModelQuery}
                                    onChange={(e) => {
                                      setOpenRouterModelQuery(e.target.value);
                                      if (openRouterModels.length === 0 && !openRouterModelsLoading) {
                                        void loadOpenRouterModels();
                                      }
                                    }}
                                    onFocus={() => {
                                      if (openRouterModels.length === 0) void loadOpenRouterModels();
                                    }}
                                  />
                                  <button className="btn btn-secondary" onClick={() => void loadOpenRouterModels()} disabled={openRouterModelsLoading}>
                                    {openRouterModelsLoading ? '取得中' : '更新'}
                                  </button>
                                </div>
                                {openRouterModelsError && <div className="openrouter-catalog-error">{openRouterModelsError}</div>}
                                {filteredOpenRouterModels.length > 0 && (
                                  <div className="openrouter-model-list">
                                    {filteredOpenRouterModels.map((model) => {
                                      const inputPrice = formatOpenRouterPrice(model.pricing?.prompt);
                                      const outputPrice = formatOpenRouterPrice(model.pricing?.completion);
                                      const supportsImage = model.architecture?.input_modalities?.includes('image');
                                      return (
                                        <div key={model.id} className="openrouter-model-row">
                                          <div className="openrouter-model-main">
                                            <span className="openrouter-model-name">{model.name}</span>
                                            <span className="openrouter-model-id">{model.id}</span>
                                          </div>
                                          <span className="openrouter-model-meta">
                                            {supportsImage ? '画像対応 · ' : ''}
                                            {model.context_length ? `${model.context_length.toLocaleString()} ctx · ` : ''}
                                            {inputPrice}/{outputPrice}
                                          </span>
                                          <button className="slot-use-btn" onClick={() => useOpenRouterCatalogModel(model.id)}>
                                            使用
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                              {[0, 1, 2].map((i) => {
                                const slots = settings.modelSlots || ['', '', ''];
                                const slotVal = slots[i] || '';
                                const isActive = !!slotVal && settings.model === slotVal;
                                return (
                                  <div key={i} className={`openrouter-slot${isActive ? ' active' : ''}`}>
                                    <input
                                      type="text"
                                      placeholder="例: openai/gpt-4o"
                                      value={slotVal}
                                      onChange={(e) => {
                                        const newSlots = [...(settings.modelSlots || ['', '', ''])];
                                        newSlots[i] = e.target.value;
                                        updateProvider(p.id, { modelSlots: newSlots });
                                      }}
                                      onBlur={(e) => {
                                        // 「使用」ボタンのクリックで onBlur が先行発火する場合はスキップ
                                        // （onMouseDown でフラグを立て、ここで検知する）
                                        const key = `${p.id}-${i}`;
                                        if (suppressSlotBlurRef.current[key]) {
                                          delete suppressSlotBlurRef.current[key];
                                          return;
                                        }
                                        const newSlots = [...(settings.modelSlots || ['', '', ''])];
                                        newSlots[i] = e.target.value;
                                        vscode?.postMessage({ command: 'updateProviderConfig', providerId: p.id, config: { modelSlots: newSlots } });
                                      }}
                                    />
                                    <button
                                      className={`slot-use-btn${isActive ? ' active' : ''}`}
                                      onMouseDown={() => {
                                        // onClick より前に発火し、同スロット入力の onBlur をスキップさせる
                                        if (slotVal) suppressSlotBlurRef.current[`${p.id}-${i}`] = true;
                                      }}
                                      onClick={() => {
                                        if (slotVal) {
                                          const currentSlots = settings.modelSlots || ['', '', ''];
                                          const currentMainProvider = serverConfig.mainProvider || serverConfig.provider;
                                          const isMain = currentMainProvider === p.id;
                                          updateProvider(p.id, { model: slotVal, modelSlots: currentSlots });
                                          if (isMain) {
                                            setServerConfig(prev => ({ ...prev, mainModel: slotVal }));
                                          }
                                          // model / modelSlots / mainModel をまとめて1メッセージで送信（並行送信による競合を根本的に排除）
                                          vscode?.postMessage({
                                            command: 'updateProviderConfig',
                                            providerId: p.id,
                                            config: {
                                              model: slotVal,
                                              modelSlots: currentSlots,
                                              ...(isMain ? { mainModel: slotVal, mainProvider: p.id } : {}),
                                            },
                                          });
                                        }
                                      }}
                                      disabled={!slotVal}
                                      title={isActive ? '使用中' : 'このモデルを使用'}
                                    >
                                      {isActive ? '使用中' : '使用'}
                                    </button>
                                  </div>
                                );
                              })}
                              <div className="openrouter-intent-models">
                                <div className="settings-field">
                                  <label>相談・レビュー・設計</label>
                                  <input
                                    type="text"
                                    placeholder="z-ai/glm-5.2"
                                    value={serverConfig.openRouterPlanningModel || ''}
                                    onChange={(e) => setServerConfig(prev => ({ ...prev, openRouterPlanningModel: e.target.value }))}
                                    onBlur={(e) => vscode?.postMessage({
                                      command: MSG_UPDATE_MODEL_CONFIG,
                                      config: { openRouterPlanningModel: e.target.value },
                                    })}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                    }}
                                  />
                                </div>
                                <div className="settings-field">
                                  <label>実装・修正</label>
                                  <input
                                    type="text"
                                    placeholder="deepseek/deepseek-v4-flash"
                                    value={serverConfig.openRouterImplementationModel || ''}
                                    onChange={(e) => setServerConfig(prev => ({ ...prev, openRouterImplementationModel: e.target.value }))}
                                    onBlur={(e) => vscode?.postMessage({
                                      command: MSG_UPDATE_MODEL_CONFIG,
                                      config: { openRouterImplementationModel: e.target.value },
                                    })}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          ) : (p.models || settings.models) && (p.models || settings.models).length > 0 ? (
                            <select
                              className="settings-select"
                              value={settings.model}
                              onChange={(e) => {
                                updateProvider(p.id, { model: e.target.value });
                                vscode?.postMessage({ command: 'updateProviderConfig', providerId: p.id, config: { model: e.target.value } });
                              }}
                            >
                              {(p.models || settings.models).map((m: ModelDef) => (
                                <option key={m.id} value={m.id}>
                                  {m.name} ({m.tier.toUpperCase()}){m.supportsImages ? ' 🖼️' : ''}
                                  {m.inputCostPer1M + m.outputCostPer1M > 0 ? ` — $${m.inputCostPer1M.toFixed(2)}/$${m.outputCostPer1M.toFixed(2)}/1M` : ''}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              placeholder="model-id"
                              value={settings.model}
                              onChange={(e) => updateProvider(p.id, { model: e.target.value })}
                            />
                          )}
                        </div>
                        <div className="settings-field">
                          <label>Endpoint</label>
                          <input
                            type="text"
                            placeholder={isOllama ? 'http://localhost:11434' : `https://api.${p.id}.com/v1`}
                            value={settings.endpoint}
                            onChange={(e) => updateProvider(p.id, { endpoint: e.target.value })}
                          />
                        </div>
                        <div className="provider-config-actions">
                          {!isOllama && (
                            <button
                              className="btn btn-primary"
                              onClick={() => handleSaveApiKey(p.id)}
                              disabled={!settings.apiKey}
                            >
                              保存
                            </button>
                          )}
                          <button
                            className="btn btn-secondary"
                            onClick={() => vscode?.postMessage({ command: 'updateProviderConfig', providerId: p.id, config: { endpoint: settings.endpoint } })}
                          >
                            Endpoint保存
                          </button>
                          {isOllama && (
                            <button
                              className="btn btn-ollama-setup"
                              onClick={() => vscode?.postMessage({ command: MSG_SETUP_OLLAMA })}
                              title="RAM容量を自動検出し、最適なモデルをインストールします"
                            >
                              🚀 Ollamaをセットアップ
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── Section 3: 上位モデル再実行設定 ── */}
            <div className="settings-divider" />
            <div className="settings-section-title">再実行モデル</div>
            <span className="budget-hint" style={{display:'block', marginBottom: 8}}>
              必要な時だけ使う高性能モデル。チャット下部の再実行ボタンに割り当てます
            </span>
            {([1, 2] as const).map(slot => {
              const draftPid = slot === 1 ? escalateDraft.p1 : escalateDraft.p2;
              const draftMid = slot === 1 ? escalateDraft.m1 : escalateDraft.m2;
              const providerModels = serverConfig.providers.find(p => p.id === draftPid)?.models || [];
              const isOpenRouterEscalate = draftPid === 'openrouter';
              const isSaved = escalateSavedSlot === slot;
              return (
                <div key={slot} className="settings-field">
                  <label>{slot === 1 ? '⚡ スロット1（左ボタン）' : '🔮 スロット2（右ボタン）'}</label>
                  <div className="active-model-row">
                    <select
                      className="settings-select"
                      value={draftPid}
                      onChange={(e) => {
                        const pid = e.target.value;
                        const selectedProvider = serverConfig.providers.find(p => p.id === pid);
                        const firstModel = pid === 'openrouter'
                          ? selectedProvider?.model || ''
                          : selectedProvider?.models[0]?.id || '';
                        if (slot === 1) setEscalateDraft(d => ({ ...d, p1: pid, m1: firstModel }));
                        else             setEscalateDraft(d => ({ ...d, p2: pid, m2: firstModel }));
                      }}
                    >
                      <option value="">自動選択</option>
                      {currentProviders.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {isOpenRouterEscalate ? (
                      <input
                        className="settings-input"
                        value={draftMid}
                        disabled={!draftPid}
                        placeholder="例: openai/gpt-4o"
                        onChange={(e) => {
                          const mid = e.target.value.trim();
                          if (slot === 1) setEscalateDraft(d => ({ ...d, m1: mid }));
                          else             setEscalateDraft(d => ({ ...d, m2: mid }));
                        }}
                      />
                    ) : (
                      <select
                        className="settings-select"
                        value={draftMid}
                        disabled={!draftPid}
                        onChange={(e) => {
                          const mid = e.target.value;
                          if (slot === 1) setEscalateDraft(d => ({ ...d, m1: mid }));
                          else             setEscalateDraft(d => ({ ...d, m2: mid }));
                        }}
                      >
                        <option value="">モデルを選択</option>
                        {providerModels.map((m: ModelDef) => (
                          <option key={m.id} value={m.id}>{m.name} ({m.tier.toUpperCase()})</option>
                        ))}
                      </select>
                    )}
                    <button
                      className="escalate-save-btn"
                      onClick={() => {
                        const providerKey = slot === 1 ? 'escalateProvider1' : 'escalateProvider2';
                        const modelKey    = slot === 1 ? 'escalateModel1'    : 'escalateModel2';
                        setServerConfig(prev => ({ ...prev, [providerKey]: draftPid, [modelKey]: draftMid }));
                        vscode?.postMessage({ command: MSG_UPDATE_MODEL_CONFIG, config: { [providerKey]: draftPid, [modelKey]: draftMid } });
                        setEscalateSavedSlot(slot);
                        setTimeout(() => setEscalateSavedSlot(0), 2000);
                      }}
                    >
                      {isSaved ? '✓ 保存済' : '保存'}
                    </button>
                  </div>
                </div>
              );
            })}

            {/* ── Section 4: 予算・ルーティング ── */}
            <div className="settings-divider" />
            <div className="settings-section-title">予算・節約</div>

            <div className="settings-field">
              <label>予算バー表示通貨</label>
              <select
                className="settings-select"
                value={serverConfig.displayCurrency || 'JPY'}
                onChange={(e) => {
                  const val = e.target.value;
                  setServerConfig(prev => ({ ...prev, displayCurrency: val }));
                  vscode?.postMessage({ command: MSG_UPDATE_MODEL_CONFIG, config: { displayCurrency: val } });
                }}
              >
                <option value="JPY">¥ 日本円（JPY）</option>
                <option value="USD">$ 米ドル（USD）</option>
              </select>
            </div>

            <div className="settings-field">
              <label>月間予算上限</label>
              <div className="budget-input-row">
                <input
                  type="number" min="0" step="1"
                  value={serverConfig.monthlyBudget}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    setServerConfig(prev => ({ ...prev, monthlyBudget: val }));
                    vscode?.postMessage({ command: 'updateBudget', value: val });
                  }}
                />
                <span className="budget-hint">
                  0=無制限
                  {serverConfig.monthlyBudget > 0 && (
                    <> (≈¥{(serverConfig.monthlyBudget * (serverConfig.exchangeRate || 150)).toFixed(0)})</>
                  )}
                </span>
              </div>
            </div>

            <div className="settings-field">
              <label>予算の集計範囲</label>
              <div className="budget-scope-row">
                <label className="scope-radio-label">
                  <input
                    type="radio" name="budgetScope" value="global"
                    checked={serverConfig.budgetScope !== 'project'}
                    onChange={() => {
                      setServerConfig(prev => ({ ...prev, budgetScope: 'global' }));
                      vscode?.postMessage({ command: 'updateBudgetScope', scope: 'global' });
                    }}
                  />
                  🌐 全プロジェクト合算
                </label>
                <label className="scope-radio-label">
                  <input
                    type="radio" name="budgetScope" value="project"
                    checked={serverConfig.budgetScope === 'project'}
                    onChange={() => {
                      setServerConfig(prev => ({ ...prev, budgetScope: 'project' }));
                      vscode?.postMessage({ command: 'updateBudgetScope', scope: 'project' });
                    }}
                  />
                  📁 プロジェクト別
                </label>
              </div>
            </div>

            <div className="settings-field">
              <label className="settings-toggle-label">
                <input
                  type="checkbox"
                  checked={serverConfig.autoRouting}
                  onChange={(e) => {
                    setServerConfig(prev => ({ ...prev, autoRouting: e.target.checked }));
                    vscode?.postMessage({ command: 'updateProviderConfig', providerId: serverConfig.provider, config: { autoRouting: e.target.checked } });
                  }}
                />
                <span>🔀 自動ルーティング</span>
              </label>
              <span className="budget-hint">タスクの内容や予算状況に応じてモデルを切り替えます</span>
            </div>

            <div className="settings-field">
              <label>節約モデル</label>
              <select
                className="settings-select"
                value={`${serverConfig.subProvider || 'ollama'}::${serverConfig.subModel || 'qwen2.5-coder'}`}
                onChange={(e) => {
                  const [pid, mid] = e.target.value.split('::');
                  setServerConfig(prev => ({ ...prev, subProvider: pid, subModel: mid }));
                  vscode?.postMessage({ command: MSG_UPDATE_MODEL_CONFIG, config: { subProvider: pid, subModel: mid } });
                }}
              >
                {allModelOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
              <span className="budget-hint">予算・モデル上限に達した時の切り替え先。Ollamaなら無料です</span>
            </div>

            {/* ── 詳細設定（折りたたみ）── */}
            <div className="settings-divider" />
            <details className="settings-advanced">
              <summary className="settings-advanced-summary">詳細設定</summary>

              <div className="settings-section-title" style={{ marginTop: 10 }}>⚠️ モデル別コスト上限</div>
              <div className="model-limits-editor">
                {serverConfig.providers.flatMap(p => p.models || []).map(m => {
                  const existing = (serverConfig.modelLimits || []).find(l => l.modelId === m.id);
                  return (
                    <div key={m.id} className="model-limit-row">
                      <span className="model-limit-name">{m.name}</span>
                      <input
                        type="number" className="model-limit-input" placeholder="回数" min="0"
                        value={existing?.maxCallsPerMonth || ''}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || undefined;
                          const limits = [...(serverConfig.modelLimits || []).filter(l => l.modelId !== m.id)];
                          if (val || existing?.maxCostUsdPerMonth) limits.push({ modelId: m.id, maxCallsPerMonth: val, maxCostUsdPerMonth: existing?.maxCostUsdPerMonth });
                          setServerConfig(prev => ({ ...prev, modelLimits: limits }));
                          vscode?.postMessage({ command: MSG_UPDATE_MODEL_CONFIG, config: { modelLimits: limits } });
                        }}
                      />
                      <span className="model-limit-sep">回</span>
                      <input
                        type="number" className="model-limit-input" placeholder="$(USD)" min="0" step="0.5"
                        value={existing?.maxCostUsdPerMonth || ''}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || undefined;
                          const limits = [...(serverConfig.modelLimits || []).filter(l => l.modelId !== m.id)];
                          if (val || existing?.maxCallsPerMonth) limits.push({ modelId: m.id, maxCallsPerMonth: existing?.maxCallsPerMonth, maxCostUsdPerMonth: val });
                          setServerConfig(prev => ({ ...prev, modelLimits: limits }));
                          vscode?.postMessage({ command: MSG_UPDATE_MODEL_CONFIG, config: { modelLimits: limits } });
                        }}
                      />
                      <span className="model-limit-sep">USD</span>
                    </div>
                  );
                })}
                <span className="budget-hint">上限に達すると節約モデルに自動切り替え</span>
              </div>

              <div className="settings-section-title" style={{ marginTop: 10 }}>🎯 自動ルーティングルール</div>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  if (!showRoutingRulesEditor) vscode?.postMessage({ command: MSG_LOAD_ROUTING_RULES });
                  setShowRoutingRulesEditor(prev => !prev);
                }}
              >
                {showRoutingRulesEditor ? '▲ 閉じる' : '▼ カスタムルールを設定'}
              </button>
              {showRoutingRulesEditor && (
                <div className="routing-rules-editor">
                  <div className="routing-rule-add">
                    <input
                      className="routing-rule-input"
                      placeholder="キーワード（例: リリース前）"
                      value={newRuleForm.keyword}
                      onChange={(e) => setNewRuleForm(prev => ({ ...prev, keyword: e.target.value }))}
                    />
                    <select
                      className="settings-select routing-rule-select"
                      value={`${newRuleForm.targetProvider}::${newRuleForm.targetModel}`}
                      onChange={(e) => {
                        const [pid, mid] = e.target.value.split('::');
                        setNewRuleForm(prev => ({ ...prev, targetProvider: pid, targetModel: mid }));
                      }}
                    >
                      <option value="::">モデル選択</option>
                      {allModelOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                    <button
                      className="btn btn-primary routing-rule-add-btn"
                      disabled={!newRuleForm.keyword || !newRuleForm.targetModel}
                      onClick={() => {
                        if (!newRuleForm.keyword || !newRuleForm.targetModel) return;
                        vscode?.postMessage({
                          command: MSG_SAVE_ROUTING_RULE,
                          isNew: true,
                          rule: { keyword: newRuleForm.keyword, targetProvider: newRuleForm.targetProvider, targetModel: newRuleForm.targetModel, category: 'custom', reason: `🎯 カスタム: ${newRuleForm.keyword}`, enabled: true },
                        });
                        setNewRuleForm({ keyword: '', targetProvider: 'deepseek', targetModel: '', reason: '', enabled: true });
                      }}
                    >追加</button>
                  </div>
                  <div className="routing-rules-list">
                    {routingRules.filter(r => !r.isBuiltin).map(rule => (
                      <div key={rule.id} className="routing-rule-item custom">
                        <span className="rule-keyword">{rule.keyword}</span>
                        <span className="rule-arrow">→</span>
                        <span className="rule-target">{rule.targetProvider}/{rule.targetModel}</span>
                        <button className="rule-toggle" onClick={() => vscode?.postMessage({ command: MSG_SAVE_ROUTING_RULE, isNew: false, rule: { ...rule, enabled: !rule.enabled } })}>{rule.enabled ? '✅' : '⬜'}</button>
                        <button className="rule-delete" onClick={() => vscode?.postMessage({ command: MSG_DELETE_ROUTING_RULE, id: rule.id })}>🗑️</button>
                      </div>
                    ))}
                    {routingRules.filter(r => r.isBuiltin).length > 0 && (
                      <details className="builtin-rules-details">
                        <summary>組み込みルール ({routingRules.filter(r => r.isBuiltin).length}件)</summary>
                        {routingRules.filter(r => r.isBuiltin).slice(0, 10).map(rule => (
                          <div key={rule.id} className="routing-rule-item builtin">
                            <span className="rule-keyword">{rule.keyword}</span>
                            <span className="rule-arrow">→</span>
                            <span className="rule-target">{rule.targetProvider}</span>
                          </div>
                        ))}
                      </details>
                    )}
                  </div>
                </div>
              )}

              <div className="settings-section-title" style={{ marginTop: 10 }}>
                📁 プロジェクト設定 (.pettal)
                {serverConfig.hasPettalFile && <span className="pettal-active-badge">有効</span>}
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  if (!showPettalConfigEditor) vscode?.postMessage({ command: MSG_LOAD_PETTAL_CONFIG });
                  setShowPettalConfigEditor(prev => !prev);
                }}
              >
                {showPettalConfigEditor ? '▲ 閉じる' : serverConfig.hasPettalFile ? '▼ .pettalを編集' : '▼ .pettalを作成'}
              </button>
              {showPettalConfigEditor && (
                <div className="pettal-editor">
                  <textarea
                    className="pettal-textarea"
                    value={pettalConfigText}
                    onChange={(e) => setPettalConfigText(e.target.value)}
                    rows={10}
                    spellCheck={false}
                    placeholder='{"version": 1, "provider": "anthropic", "model": "claude-opus-4-20250514"}'
                  />
                  <div className="pettal-editor-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        try {
                          const cfg = JSON.parse(pettalConfigText);
                          vscode?.postMessage({ command: MSG_SAVE_PETTAL_CONFIG, config: cfg });
                          setShowPettalConfigEditor(false);
                        } catch {
                          alert('JSONの形式が正しくありません');
                        }
                      }}
                    >保存</button>
                    <span className="budget-hint">VS Code設定より優先。チーム共有可能。</span>
                  </div>
                </div>
              )}
            </details>

            {/* ── ライセンス管理 ── */}
            <div className="settings-section-title" style={{ marginTop: 10 }}>
              🔑 ライセンス
              <span style={{ marginLeft: 8, fontSize: '0.8em', opacity: 0.7 }}>
                {licenseStatus === 'valid' ? '✅ Pro'
                  : licenseStatus === 'grace' ? '✅ Pro (猶予中)'
                  : licenseStatus === 'trial' && isBeta ? '🎉 β版: Pro機能開放中'
                  : licenseStatus === 'trial' ? `⏰ Pro体験期間（残り${trialDaysRemaining ?? '?'}日）`
                  : licenseStatus === 'trial_expired' ? '⌛ Pro体験終了'
                  : '🔓 Free'}
              </span>
            </div>
            {licenseStatus === 'trial' && isBeta && (
              <div className="license-panel">
                <div className="license-cta-text">
                  🎉 <strong>β版公開中</strong> — エージェントモードを含むPro機能を開放しています。<br /><br />
                  β版終了後は、エージェントモード・ストリーミングなどのPro機能は <strong>¥980/月</strong> のProプランが必要になります。
                </div>
              </div>
            )}
            {licenseStatus === 'trial' && !isBeta && (
              <div className="license-panel">
                <div className="license-cta-text">
                  ⏰ <strong>Pro体験期間</strong>（残り{trialDaysRemaining ?? '?'}日）<br />
                  期間中はPro機能をお使いいただけます。継続利用は¥980/月です。
                </div>
                <button className="btn btn-secondary" style={{ marginTop: 6 }}
                  onClick={() => vscode?.postMessage({ command: 'upgradePro' })}>
                  👉 今すぐ Pro にアップグレード（¥980/月）
                </button>
              </div>
            )}
            {(licenseStatus === 'trial_expired' || licenseStatus === 'free' || licenseStatus === 'expired' || licenseStatus === 'invalid') && (
              <div className="license-panel">
                <div className="license-cta-text">
                  Proライセンスキーをお持ちの場合は以下に入力してください。
                </div>
                <div className="license-input-row">
                  <input
                    className="license-key-input"
                    type="text"
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                    value={licenseKeyInput}
                    onChange={(e) => setLicenseKeyInput(e.target.value)}
                    disabled={licenseActivating}
                  />
                  <button
                    className="btn btn-primary"
                    disabled={!licenseKeyInput.trim() || licenseActivating}
                    onClick={() => {
                      setLicenseActivating(true);
                      setLicenseMessage(null);
                      vscode?.postMessage({ command: MSG_ACTIVATE_LICENSE, key: licenseKeyInput.trim() });
                    }}
                  >
                    {licenseActivating ? '認証中...' : '認証する'}
                  </button>
                </div>
                {licenseMessage && (
                  <div className={`license-message ${licenseMessage.ok ? 'ok' : 'error'}`}>
                    {licenseMessage.text}
                  </div>
                )}
                <button
                  className="btn btn-secondary"
                  style={{ marginTop: 6 }}
                  onClick={() => vscode?.postMessage({ command: 'torii.upgradePro' })}
                >
                  👉 ¥980/月 — Pro にアップグレード
                </button>
              </div>
            )}
            {licenseStatus === 'valid' && (
              <div className="license-panel">
                <div className="license-cta-text">✅ Proプランが有効です。全機能をご利用いただけます。</div>
              </div>
            )}
            {licenseStatus === 'grace' && (
              <div className="license-panel">
                <div className="license-cta-text">📶 オフライン猶予期間中です。ネットワーク接続後に自動で再検証されます。</div>
              </div>
            )}

            <div className="settings-actions" style={{ marginTop: 12 }}>
              <button className="btn btn-secondary" onClick={() => setShowSettings(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
      {showOnboarding && (
        <div className="onboarding-overlay" onClick={dismissOnboarding}>
          <div className="onboarding-panel" onClick={(e) => e.stopPropagation()}>
            <div className="onboarding-hero">
              <ToriiIcon size={28} />
              <div>
                <div className="onboarding-title">はじめに</div>
                <div className="onboarding-subtitle">最初は無料のローカル環境から始めるのが無難です。</div>
              </div>
            </div>
            <div className="onboarding-body">
              <p>1. Ollama をセットアップすると、APIキーなしで試せます。</p>
              <p>2. 既存のAPIキーを使うなら、設定画面から入力できます。</p>
              <p>3. どちらでも、あとからモデルや予算は変えられます。</p>
            </div>
            <div className="onboarding-actions">
              <button className="btn btn-primary" onClick={handleStartWithOllama}>
                🚀 Ollama で開始
              </button>
              <button className="btn btn-secondary" onClick={handleOpenSettingsFromOnboarding}>
                ⚙️ 設定を開く
              </button>
              <button className="btn btn-secondary" onClick={dismissOnboarding}>
                あとで
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── File Viewer / Editor Overlay ── */}
      {showFileViewer && (
        <div className="file-viewer-overlay" onClick={() => { setShowFileViewer(false); setEditingFile(null); }}>
          <div className="file-viewer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="file-viewer-header">
              <span>📄 ファイルビューア</span>
              <div className="file-viewer-header-actions">
                {editingFile ? (
                  <>
                    <button
                      className="file-viewer-btn primary"
                      onClick={() => handleWriteFile(editingFile.path, editingFile.content, editingFile.originalContent)}
                    >
                      💾 差分を確認して保存
                    </button>
                    <button
                      className="file-viewer-btn"
                      onClick={() => setEditingFile(null)}
                    >
                      キャンセル
                    </button>
                  </>
                ) : (
                  fileContents.length > 0 && !fileContents[activeFileTab]?.error && (
                    <button
                      className="file-viewer-btn primary"
                      onClick={() => openFileEditor(
                        fileContents[activeFileTab].path,
                        fileContents[activeFileTab].content,
                      )}
                    >
                      ✏️ 編集
                    </button>
                  )
                )}
                <button
                  className="file-viewer-btn"
                  onClick={() => { setShowFileViewer(false); setEditingFile(null); }}
                >
                  × 閉じる
                </button>
              </div>
            </div>
            {fileContents.length > 1 && (
              <div className="file-viewer-tabs">
                {fileContents.map((fc, i) => (
                  <button
                    key={fc.path}
                    className={`file-viewer-tab ${i === activeFileTab ? 'active' : ''}`}
                    onClick={() => setActiveFileTab(i)}
                  >
                    {fc.path.split('/').pop() || fc.path}
                  </button>
                ))}
              </div>
            )}
            <div className="file-viewer-content">
              {editingFile ? (
                <textarea
                  className="file-editor-textarea"
                  value={editingFile.content}
                  onChange={(e) => setEditingFile({ ...editingFile, content: e.target.value })}
                  spellCheck={false}
                />
              ) : fileContents.length > 0 ? (
                fileContents[activeFileTab]?.error ? (
                  <div className="file-viewer-error">
                    ⚠️ {fileContents[activeFileTab].path}: {fileContents[activeFileTab].error}
                  </div>
                ) : (
                  <pre className="file-viewer-pre">{fileContents[activeFileTab]?.content || ''}</pre>
                )
              ) : (
                <div className="file-viewer-empty">ファイルが選択されていません</div>
              )}
            </div>
            {!editingFile && fileContents.length > 0 && (
              <div className="file-viewer-footer">
                <span>{fileContents[activeFileTab]?.path || ''}</span>
                <span>{fileContents[activeFileTab]?.content?.split('\n').length || 0} 行</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── File Write Diff Confirmation ── */}
      {pendingFileWrite && pendingFileDiff && (
        <div className="file-diff-overlay" onClick={handleCancelWriteFile}>
          <div className="file-diff-panel" onClick={(e) => e.stopPropagation()}>
            <div className="file-diff-header">
              <span>📑 保存前の差分確認</span>
              <span className="file-diff-path" title={pendingFileWrite.path}>{pendingFileWrite.path}</span>
            </div>
            <div className="file-diff-summary">
              {pendingFileDiff.isChanged
                ? `先頭 ${pendingFileDiff.prefix} 行・末尾 ${pendingFileDiff.suffix} 行は変更なし / ${pendingFileDiff.originalLineCount} → ${pendingFileDiff.nextLineCount} 行`
                : '変更はありません。保存は不要です。'}
            </div>
            <div className="file-diff-grid">
              <section className="file-diff-column">
                <div className="file-diff-column-title">変更前</div>
                <pre className="file-diff-pre removed">
                  {formatDiffLines(pendingFileDiff.originalChanged, pendingFileDiff.prefix + 1, '- ')}
                </pre>
              </section>
              <section className="file-diff-column">
                <div className="file-diff-column-title">変更後</div>
                <pre className="file-diff-pre added">
                  {formatDiffLines(pendingFileDiff.nextChanged, pendingFileDiff.prefix + 1, '+ ')}
                </pre>
              </section>
            </div>
            <div className="file-diff-actions">
              <button className="file-diff-btn" onClick={handleCancelWriteFile}>
                キャンセル
              </button>
              <button
                className="file-diff-btn primary"
                onClick={handleConfirmWriteFile}
                disabled={!pendingFileDiff.isChanged}
              >
                保存する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── File Write Status Toast ── */}
      {fileWriteStatus && (
        <div className={`file-write-status ${fileWriteStatus.success ? 'success' : 'error'}`}>
          {fileWriteStatus.success ? '✅ 保存完了' : `❌ エラー: ${fileWriteStatus.error}`}
        </div>
      )}
    </div>
  );
}

export default App;
