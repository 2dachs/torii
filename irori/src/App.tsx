import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { BootstrapPayload, Mode, RouteDecision, SettingsUpdate } from './types';
import {
  bootstrap as bootstrapApp,
  createConversation,
  createProject,
  deleteConversation,
  deleteProject,
  sendMessage,
  setActiveConversation,
  setActiveProject,
  updateConversationTitle,
  updateProjectName,
  updateSettings,
} from './lib/tauri';
import { calculateCost, estimateTokens, routeMessage } from './lib/cost';
import { shouldSubmitComposer } from './lib/composerKeys';
import iroriIconUrl from './assets/irori-icon.svg';

const MODE_COPY: Record<Mode, { title: string; description: string }> = {
  quick: { title: 'Quick', description: '速く・安く回答します' },
  standard: { title: 'Standard', description: '精度とコストのバランスを取ります' },
  deep: { title: 'Deep', description: '設計・レビュー・反証など、深い思考に使います。高コストになる場合があります' },
};

const SEARCH_KEYWORDS = ['検索', '調べて', '最新', 'ニュース', 'web', 'ウェブ', 'ネット', '現在', '今日', '直近'];

interface PendingTurn {
  id: string;
  content: string;
  startedAt: string;
  isSearch: boolean;
}

function shouldShowSearchProgress(text: string): boolean {
  const lowered = text.toLowerCase();
  return SEARCH_KEYWORDS.some((keyword) => lowered.includes(keyword));
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

function formatJpy(value: number): string {
  return `¥${Math.round(value).toLocaleString('ja-JP')}`;
}

function formatMoneyPair(usd: number, jpyPerUsd: number): string {
  return `${formatJpy(usd * jpyPerUsd)} / ${formatCurrency(usd)}`;
}

function isNoResponseTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return normalized === '(no response)' || normalized === 'no response' || normalized.includes('no response');
}

function emptySnapshot(): BootstrapPayload {
  const now = new Date().toISOString();
  return {
    projects: [],
    conversations: [],
    messages: [],
    activeProjectId: null,
      activeConversationId: null,
      usageSummary: { totalInputTokens: 0, totalOutputTokens: 0, totalEstimatedCost: 0, totalActualCost: 0, totalLatencyMs: 0 },
      monthlyUsageSummary: { totalInputTokens: 0, totalOutputTokens: 0, totalEstimatedCost: 0, totalActualCost: 0, totalLatencyMs: 0 },
      settings: {
        id: 'app',
        openRouterApiKey: '',
        tavilyApiKey: '',
        tavilySearchDepth: 'basic',
        tavilyMaxResults: 5,
        quickModelSlug: 'deepseek/deepseek-v4-flash',
        standardModelSlug: 'deepseek/deepseek-v4-pro',
        deepModelSlug: 'z-ai/glm-5.2',
        monthlyBudgetJpy: 30000,
        jpyPerUsd: 150,
        quickInputPricePerMillionTokens: 0.14,
        quickOutputPricePerMillionTokens: 0.28,
        standardInputPricePerMillionTokens: 1.74,
        standardOutputPricePerMillionTokens: 3.48,
        deepInputPricePerMillionTokens: 1.2,
        deepOutputPricePerMillionTokens: 4.1,
        deepConfirmationEnabled: true,
      perRunCostLimit: 0.5,
      activeProjectId: null,
      activeConversationId: null,
      updatedAt: now,
    },
    modelConfigs: {
      quick: {
        id: 'quick',
        provider: 'openrouter',
        displayName: 'DeepSeek V4 Flash',
        modelSlug: 'deepseek/deepseek-v4-flash',
        inputPricePerMillionTokens: 0.14,
        outputPricePerMillionTokens: 0.28,
        contextWindow: 64000,
        enabled: true,
      },
      standard: {
        id: 'standard',
        provider: 'openrouter',
        displayName: 'DeepSeek V4 Pro',
        modelSlug: 'deepseek/deepseek-v4-pro',
        inputPricePerMillionTokens: 1.74,
        outputPricePerMillionTokens: 3.48,
        contextWindow: 128000,
        enabled: true,
      },
      deep: {
        id: 'deep',
        provider: 'openrouter',
        displayName: 'GLM 5.2',
        modelSlug: 'z-ai/glm-5.2',
        inputPricePerMillionTokens: 1.2,
        outputPricePerMillionTokens: 4.1,
        contextWindow: 128000,
        enabled: true,
      },
    },
  };
}

function App() {
  const [snapshot, setSnapshot] = useState<BootstrapPayload>(emptySnapshot);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('quick');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftProjectName, setDraftProjectName] = useState('');
  const [draftConversationName, setDraftConversationName] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(snapshot.settings);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const [conversationTitleDraft, setConversationTitleDraft] = useState('');
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [showAllConversations, setShowAllConversations] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [decision, setDecision] = useState<RouteDecision | null>(null);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [pendingTurn, setPendingTurn] = useState<PendingTurn | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    bootstrapApp()
      .then((data) => {
        if (!alive) return;
        setSnapshot(data);
        setMode((data.conversations.find((conversation) => conversation.id === data.activeConversationId)?.mode as Mode) || 'quick');
        setShowSettings(data.settings.openRouterApiKey.trim().length === 0);
        setError(null);
      })
      .catch((bootstrapError) => {
        if (!alive) return;
        setError(bootstrapError instanceof Error ? bootstrapError.message : '起動に失敗しました');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!snapshot.activeConversationId) return;
    const conversation = snapshot.conversations.find((item) => item.id === snapshot.activeConversationId);
    if (conversation) {
      setMode(conversation.mode);
    }
  }, [snapshot.activeConversationId, snapshot.conversations]);

  useEffect(() => {
    if (showSettings) {
      setSettingsDraft(snapshot.settings);
    }
  }, [showSettings, snapshot.settings]);

  const activeProject = useMemo(
    () => snapshot.projects.find((project) => project.id === snapshot.activeProjectId) || null,
    [snapshot.projects, snapshot.activeProjectId],
  );
  const activeConversation = useMemo(
    () => snapshot.conversations.find((conversation) => conversation.id === snapshot.activeConversationId) || null,
    [snapshot.conversations, snapshot.activeConversationId],
  );
  const activeMessages = useMemo(
    () => snapshot.messages.filter((message) => message.conversationId === snapshot.activeConversationId),
    [snapshot.messages, snapshot.activeConversationId],
  );
  const progressLabel = pendingTurn?.isSearch ? '検索中' : '考え中';
  const progressCopy = pendingTurn?.isSearch
    ? 'Web検索の結果を集めています'
    : '回答を組み立てています';
  const modeConfig = snapshot.modelConfigs[mode];
  const hasOpenRouterKey = snapshot.settings.openRouterApiKey.trim().length > 0;
  useEffect(() => {
    setProjectNameDraft(activeProject?.name || '');
  }, [activeProject?.name]);

  useEffect(() => {
    setConversationTitleDraft(activeConversation?.title || '');
  }, [activeConversation?.title]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const target = pendingTurn
      ? container.querySelector(`[data-message-id="${pendingTurn.id}-assistant"]`)
      : container.querySelector(`[data-message-id="${activeMessages[activeMessages.length - 1]?.id}"]`);
    (target as HTMLElement | null)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeMessages.length, activeConversation?.id, pendingTurn]);

  const preview = useMemo(() => routeMessage({
    mode,
    text: input,
    modelConfigs: snapshot.modelConfigs,
    perRunCostLimit: snapshot.settings.perRunCostLimit,
    deepConfirmationEnabled: snapshot.settings.deepConfirmationEnabled,
  }), [mode, input, snapshot.modelConfigs, snapshot.settings.deepConfirmationEnabled, snapshot.settings.perRunCostLimit]);

  const estimatedTextTokens = estimateTokens(input);
  const estimatedTotalCost = calculateCost(
    preview.estimatedInputTokens,
    preview.estimatedOutputTokens,
    modeConfig.inputPricePerMillionTokens,
    modeConfig.outputPricePerMillionTokens,
  );
  const latestMessage = activeMessages[activeMessages.length - 1] || null;
  const monthlyActualCostUsd = snapshot.monthlyUsageSummary.totalActualCost;
  const monthlyActualCostJpy = monthlyActualCostUsd * snapshot.settings.jpyPerUsd;
  const monthlyBudgetJpy = snapshot.settings.monthlyBudgetJpy || 0;
  const monthlyBudgetUsedPercent = monthlyBudgetJpy > 0 ? Math.min(100, (monthlyActualCostJpy / monthlyBudgetJpy) * 100) : 0;
  const monthlyBudgetWarning = monthlyBudgetJpy > 0 && monthlyBudgetUsedPercent >= 80;
  const settingsDirty = useMemo(() => (
    settingsDraft.openRouterApiKey !== snapshot.settings.openRouterApiKey
    || settingsDraft.tavilyApiKey !== snapshot.settings.tavilyApiKey
    || settingsDraft.tavilySearchDepth !== snapshot.settings.tavilySearchDepth
    || settingsDraft.tavilyMaxResults !== snapshot.settings.tavilyMaxResults
    || settingsDraft.quickModelSlug !== snapshot.settings.quickModelSlug
    || settingsDraft.standardModelSlug !== snapshot.settings.standardModelSlug
    || settingsDraft.deepModelSlug !== snapshot.settings.deepModelSlug
    || settingsDraft.monthlyBudgetJpy !== snapshot.settings.monthlyBudgetJpy
    || settingsDraft.jpyPerUsd !== snapshot.settings.jpyPerUsd
    || settingsDraft.quickInputPricePerMillionTokens !== snapshot.settings.quickInputPricePerMillionTokens
    || settingsDraft.quickOutputPricePerMillionTokens !== snapshot.settings.quickOutputPricePerMillionTokens
    || settingsDraft.standardInputPricePerMillionTokens !== snapshot.settings.standardInputPricePerMillionTokens
    || settingsDraft.standardOutputPricePerMillionTokens !== snapshot.settings.standardOutputPricePerMillionTokens
    || settingsDraft.deepInputPricePerMillionTokens !== snapshot.settings.deepInputPricePerMillionTokens
    || settingsDraft.deepOutputPricePerMillionTokens !== snapshot.settings.deepOutputPricePerMillionTokens
    || settingsDraft.deepConfirmationEnabled !== snapshot.settings.deepConfirmationEnabled
    || settingsDraft.perRunCostLimit !== snapshot.settings.perRunCostLimit
  ), [settingsDraft, snapshot.settings]);

  async function refreshAfter(action: Promise<BootstrapPayload>) {
    try {
      const data = await action;
      setSnapshot(data);
      setDecision(null);
      setConfirmationRequired(false);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : '更新に失敗しました');
    }
  }

  async function handleCreateProject() {
    const name = draftProjectName.trim();
    if (!name) return;
    setDraftProjectName('');
    await refreshAfter(createProject(name));
  }

  async function handleCreateConversation() {
    const projectId = snapshot.activeProjectId;
    if (!projectId) return;
    const title = draftConversationName.trim() || 'New chat';
    setDraftConversationName('');
    await refreshAfter(createConversation(projectId, title, mode));
  }

  async function handleSend() {
    const projectId = snapshot.activeProjectId;
    const conversationId = snapshot.activeConversationId;
    const content = input.trim();
    if (!projectId || !conversationId || !content) return;

    const routed = routeMessage({
      mode,
      text: content,
      modelConfigs: snapshot.modelConfigs,
      perRunCostLimit: snapshot.settings.perRunCostLimit,
      deepConfirmationEnabled: snapshot.settings.deepConfirmationEnabled,
    });

    setDecision(routed);
    if (routed.requiresConfirmation) {
      setConfirmationRequired(true);
      return;
    }

    setSending(true);
    setInput('');
    setPendingTurn({
      id: `pending-${Date.now()}`,
      content,
      startedAt: new Date().toISOString(),
      isSearch: shouldShowSearchProgress(content),
    });
    try {
      const result = await sendMessage({ projectId, conversationId, mode, content });
      setSnapshot(result.snapshot);
      setDecision(result.decision);
      setError(null);
    } catch (sendError) {
      setInput(content);
      setError(sendError instanceof Error ? sendError.message : '送信に失敗しました');
    } finally {
      setSending(false);
      setPendingTurn(null);
    }
  }

  async function confirmAndSend() {
    if (!snapshot.activeProjectId || !snapshot.activeConversationId || !input.trim()) return;
    const content = input.trim();
    setSending(true);
    setInput('');
    setPendingTurn({
      id: `pending-${Date.now()}`,
      content,
      startedAt: new Date().toISOString(),
      isSearch: shouldShowSearchProgress(content),
    });
    try {
      const result = await sendMessage({
        projectId: snapshot.activeProjectId,
        conversationId: snapshot.activeConversationId,
        mode,
        content,
      });
      setSnapshot(result.snapshot);
      setDecision(result.decision);
      setConfirmationRequired(false);
      setError(null);
    } catch (sendError) {
      setInput(content);
      setError(sendError instanceof Error ? sendError.message : '送信に失敗しました');
    } finally {
      setSending(false);
      setPendingTurn(null);
    }
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const nativeEvent = event.nativeEvent as globalThis.KeyboardEvent & { isComposing?: boolean; keyCode?: number };
    const shouldSubmit = shouldSubmitComposer({
      key: event.key,
      shiftKey: event.shiftKey,
      nativeIsComposing: nativeEvent.isComposing,
      keyCode: nativeEvent.keyCode,
    });

    if (!shouldSubmit) return;
    event.preventDefault();
    if (sending || !input.trim()) return;
    void handleSend();
  }

  async function handleSelectProject(projectId: string) {
    await refreshAfter(setActiveProject(projectId));
  }

  async function handleSelectConversation(conversationId: string) {
    await refreshAfter(setActiveConversation(conversationId));
  }

  async function handleSaveSettings() {
    await refreshAfter(updateSettings({
      openRouterApiKey: settingsDraft.openRouterApiKey,
      tavilyApiKey: settingsDraft.tavilyApiKey,
      tavilySearchDepth: settingsDraft.tavilySearchDepth,
      tavilyMaxResults: settingsDraft.tavilyMaxResults,
      quickModelSlug: settingsDraft.quickModelSlug,
      standardModelSlug: settingsDraft.standardModelSlug,
      deepModelSlug: settingsDraft.deepModelSlug,
      monthlyBudgetJpy: settingsDraft.monthlyBudgetJpy,
      jpyPerUsd: settingsDraft.jpyPerUsd,
      quickInputPricePerMillionTokens: settingsDraft.quickInputPricePerMillionTokens,
      quickOutputPricePerMillionTokens: settingsDraft.quickOutputPricePerMillionTokens,
      standardInputPricePerMillionTokens: settingsDraft.standardInputPricePerMillionTokens,
      standardOutputPricePerMillionTokens: settingsDraft.standardOutputPricePerMillionTokens,
      deepInputPricePerMillionTokens: settingsDraft.deepInputPricePerMillionTokens,
      deepOutputPricePerMillionTokens: settingsDraft.deepOutputPricePerMillionTokens,
      deepConfirmationEnabled: settingsDraft.deepConfirmationEnabled,
      perRunCostLimit: settingsDraft.perRunCostLimit,
    }));
  }

  async function handleRenameProject() {
    if (!snapshot.activeProjectId) return;
    const nextName = projectNameDraft.trim();
    if (!nextName || nextName === activeProject?.name) return;
    await refreshAfter(updateProjectName(snapshot.activeProjectId, nextName));
  }

  async function handleDeleteProject() {
    if (!snapshot.activeProjectId) return;
    await refreshAfter(deleteProject(snapshot.activeProjectId));
  }

  async function handleRenameConversation() {
    if (!snapshot.activeConversationId) return;
    const nextTitle = conversationTitleDraft.trim();
    if (!nextTitle || nextTitle === activeConversation?.title) return;
    await refreshAfter(updateConversationTitle(snapshot.activeConversationId, nextTitle));
  }

  async function handleDeleteConversation() {
    if (!snapshot.activeConversationId) return;
    await refreshAfter(deleteConversation(snapshot.activeConversationId));
  }

  const sidebarProjects = snapshot.projects;
  const sidebarConversations = snapshot.conversations.filter((conversation) => conversation.projectId === snapshot.activeProjectId);
  const visibleProjects = showAllProjects ? sidebarProjects : sidebarProjects.slice(0, 3);
  const visibleConversations = showAllConversations ? sidebarConversations : sidebarConversations.slice(0, 3);
  const projectOverflowCount = Math.max(0, sidebarProjects.length - visibleProjects.length);
  const conversationOverflowCount = Math.max(0, sidebarConversations.length - visibleConversations.length);
  const compactCost = formatJpy(preview.estimatedCost * snapshot.settings.jpyPerUsd);
  const latestCost = latestMessage ? formatMoneyPair(latestMessage.actualCost || latestMessage.estimatedCost, snapshot.settings.jpyPerUsd) : formatMoneyPair(preview.estimatedCost, snapshot.settings.jpyPerUsd);

  const sidebarContent = (
    <>
      <div className="brand">
        <div className="brand-mark">
          <img src={iroriIconUrl} alt="" />
        </div>
        <div className="brand-copy">
          <div className="brand-title">Irori</div>
          <div className="brand-subtitle">軽い質問は安く速く。重要な判断は深く。</div>
        </div>
      </div>

      <section className="panel navigation-panel">
        <div className="panel-head">
          <h2>Projects</h2>
        </div>
        <div className="stack">
          {visibleProjects.map((project) => (
            <button
              key={project.id}
              className={`list-item ${project.id === snapshot.activeProjectId ? 'active' : ''}`}
              onClick={() => {
                setSidebarOpen(false);
                void handleSelectProject(project.id);
              }}
            >
              <strong>{project.name}</strong>
              <span>{new Date(project.updatedAt).toLocaleDateString('ja-JP')}</span>
            </button>
          ))}
        </div>
        {projectOverflowCount > 0 && (
          <button className="secondary-trigger" onClick={() => setShowAllProjects((value) => !value)}>
            {showAllProjects ? '折りたたむ' : `さらに ${projectOverflowCount} 件`}
          </button>
        )}
        <div className="row compact-row">
          <input value={draftProjectName} onChange={(event) => setDraftProjectName(event.target.value)} placeholder="新規プロジェクト名" />
          <button onClick={() => void handleCreateProject()}>追加</button>
        </div>
        {activeProject && (
          <div className="editor-box">
            <label>Selected project</label>
            <input value={projectNameDraft} onChange={(event) => setProjectNameDraft(event.target.value)} />
            <div className="row">
              <button onClick={() => void handleRenameProject()}>保存</button>
              <button className="danger-button" onClick={() => void handleDeleteProject()}>削除</button>
            </div>
          </div>
        )}
      </section>

      <section className="panel navigation-panel">
        <div className="panel-head">
          <h2>Conversations</h2>
          <button className="ghost-button" onClick={() => void handleCreateConversation()}>New</button>
        </div>
        <div className="stack">
          {visibleConversations.map((conversation) => (
            <button
              key={conversation.id}
              className={`list-item ${conversation.id === snapshot.activeConversationId ? 'active' : ''}`}
              onClick={() => {
                setSidebarOpen(false);
                void handleSelectConversation(conversation.id);
              }}
            >
              <strong>{conversation.title}</strong>
              <span>{MODE_COPY[conversation.mode].title}</span>
            </button>
          ))}
        </div>
        {conversationOverflowCount > 0 && (
          <button className="secondary-trigger" onClick={() => setShowAllConversations((value) => !value)}>
            {showAllConversations ? '折りたたむ' : `さらに ${conversationOverflowCount} 件`}
          </button>
        )}
        <div className="row compact-row">
          <input value={draftConversationName} onChange={(event) => setDraftConversationName(event.target.value)} placeholder="新規会話名" />
          <button onClick={() => void handleCreateConversation()}>追加</button>
        </div>
        {activeConversation && (
          <div className="editor-box">
            <label>Selected conversation</label>
            <input value={conversationTitleDraft} onChange={(event) => setConversationTitleDraft(event.target.value)} />
            <div className="row">
              <button onClick={() => void handleRenameConversation()}>保存</button>
              <button className="danger-button" onClick={() => void handleDeleteConversation()}>削除</button>
            </div>
          </div>
        )}
      </section>
    </>
  );

  const usageContent = (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Routing</h2>
        </div>
        <div className="route-summary">
          <div>
            <label>Mode</label>
            <strong>{MODE_COPY[preview.mode].title}</strong>
          </div>
          <div>
            <label>Model</label>
            <strong>{preview.selectedModel.displayName}</strong>
          </div>
          <div className="wide">
            <label>Reason</label>
            <span>{decision?.reason || preview.reason}</span>
          </div>
          <div>
            <label>Confirmation</label>
            <span>{preview.requiresConfirmation ? '必要' : '不要'}</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Usage</h2>
        </div>
        <div className="metric-list">
          <div><label>Input tokens</label><strong>{(latestMessage?.inputTokens || preview.estimatedInputTokens).toLocaleString()}</strong></div>
          <div><label>Output tokens</label><strong>{(latestMessage?.outputTokens || preview.estimatedOutputTokens).toLocaleString()}</strong></div>
          <div><label>Estimated cost</label><strong>{formatMoneyPair(latestMessage?.estimatedCost || estimatedTotalCost, snapshot.settings.jpyPerUsd)}</strong></div>
          <div><label>Actual cost</label><strong>{formatMoneyPair(latestMessage?.actualCost || 0, snapshot.settings.jpyPerUsd)}</strong></div>
          <div><label>Latency</label><strong>{(latestMessage?.latencyMs || 0).toLocaleString()} ms</strong></div>
          <div><label>Text tokens</label><strong>{estimatedTextTokens.toLocaleString()}</strong></div>
          <div className="budget-block">
            <label>Monthly budget</label>
            <strong>{formatJpy(snapshot.settings.monthlyBudgetJpy)}</strong>
            <div className="budget-bar" aria-label="Monthly budget usage">
              <div className={`budget-fill ${monthlyBudgetWarning ? 'warn' : ''}`} style={{ width: `${monthlyBudgetUsedPercent}%` }} />
            </div>
            <small>
              今月 {formatJpy(monthlyActualCostJpy)} / {formatCurrency(monthlyActualCostUsd)}
              {monthlyBudgetJpy > 0 ? ` (${monthlyBudgetUsedPercent.toFixed(0)}%)` : ''}
            </small>
          </div>
        </div>
      </section>
    </>
  );

  const settingsPanel = (
    <section className="modal settings settings-modal">
      <div className="panel-head">
        <h2>API key & Settings</h2>
        <div className="settings-actions">
          <span className="settings-state">{settingsDirty ? '未保存' : '保存済み'}</span>
          <button onClick={() => void handleSaveSettings()} disabled={!settingsDirty}>保存</button>
          <button className="secondary-trigger" onClick={() => setShowSettings(false)}>Close</button>
        </div>
      </div>
      <div className="settings-scroll">
        <label>OpenRouter API key</label>
        <input
          type="password"
          value={settingsDraft.openRouterApiKey}
          onChange={(event) => setSettingsDraft((current) => ({ ...current, openRouterApiKey: event.target.value }))}
          placeholder="sk-or-..."
        />
        <div className="settings-group">
          <label>Tavily API key</label>
          <input
            type="password"
            value={settingsDraft.tavilyApiKey}
            onChange={(event) => setSettingsDraft((current) => ({ ...current, tavilyApiKey: event.target.value }))}
            placeholder="tvly-..."
          />
          <small>
            {snapshot.settings.tavilyApiKey.trim() ? 'Tavily API key は保存済みです。' : '設定するとWeb検索はTavilyを優先します。'}
            {' '}未設定時はMVP用の簡易検索に戻ります。
          </small>
        </div>
        <label>Tavily search depth</label>
        <select
          value={settingsDraft.tavilySearchDepth}
          onChange={(event) => setSettingsDraft((current) => ({ ...current, tavilySearchDepth: event.target.value }))}
        >
          <option value="basic">basic - 1 credit</option>
          <option value="fast">fast - 1 credit</option>
          <option value="ultra-fast">ultra-fast - 1 credit</option>
          <option value="advanced">advanced - 2 credits</option>
        </select>
        <label>Tavily max results</label>
        <input
          type="number"
          min="1"
          max="10"
          step="1"
          value={settingsDraft.tavilyMaxResults}
          onChange={(event) => setSettingsDraft((current) => ({ ...current, tavilyMaxResults: Number(event.target.value) }))}
        />
        <div className="settings-grid">
          <div>
            <label>Quick model</label>
            <input value={settingsDraft.quickModelSlug} onChange={(event) => setSettingsDraft((current) => ({ ...current, quickModelSlug: event.target.value }))} />
          </div>
          <div>
            <label>Standard model</label>
            <input value={settingsDraft.standardModelSlug} onChange={(event) => setSettingsDraft((current) => ({ ...current, standardModelSlug: event.target.value }))} />
          </div>
          <div>
            <label>Deep model</label>
            <input value={settingsDraft.deepModelSlug} onChange={(event) => setSettingsDraft((current) => ({ ...current, deepModelSlug: event.target.value }))} />
          </div>
          <div>
            <label>Monthly budget (JPY)</label>
            <input type="number" step="1000" value={settingsDraft.monthlyBudgetJpy} onChange={(event) => setSettingsDraft((current) => ({ ...current, monthlyBudgetJpy: Number(event.target.value) }))} />
          </div>
          <div>
            <label>JPY per USD</label>
            <input type="number" step="1" value={settingsDraft.jpyPerUsd} onChange={(event) => setSettingsDraft((current) => ({ ...current, jpyPerUsd: Number(event.target.value) }))} />
          </div>
          <div>
            <label>Per-run limit</label>
            <input type="number" step="0.01" value={settingsDraft.perRunCostLimit} onChange={(event) => setSettingsDraft((current) => ({ ...current, perRunCostLimit: Number(event.target.value) }))} />
          </div>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={settingsDraft.deepConfirmationEnabled} onChange={(event) => {
            setSettingsDraft((current) => ({ ...current, deepConfirmationEnabled: event.target.checked }));
          }} />
          <span>Deep confirmation</span>
        </label>
        <small>1回あたりの安全上限です。月額予算とは別です。</small>
      </div>
    </section>
  );

  return (
    <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : ''} ${usageOpen ? 'usage-open' : ''}`}>
      {(sidebarOpen || usageOpen) && <button className="scrim" aria-label="Close panel" onClick={() => {
        setSidebarOpen(false);
        setUsageOpen(false);
      }} />}

      <aside className="sidebar">
        {sidebarContent}
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="icon-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">☰</button>
          <div className="topbar-title">
            <img className="topbar-icon" src={iroriIconUrl} alt="" />
            <div className="topbar-copy">
              <strong>{activeProject?.name || 'Irori'}</strong>
              <span>{activeConversation?.title || 'New chat'}</span>
            </div>
          </div>
          <button className="icon-button" onClick={() => setShowSettings(true)} aria-label="Open settings">⚙</button>
        </header>

        <header className="hero">
          <div>
            <div className="eyebrow">Irori AI workspace</div>
            <h1>{activeProject?.name || 'Irori'}</h1>
            <p>{MODE_COPY[mode].description}</p>
            {!hasOpenRouterKey && (
              <div className="callout">
                OpenRouter API key がまだありません。右下の Settings で登録すると送信できます。
              </div>
            )}
          </div>
          <div className="mode-switch">
            {(Object.keys(MODE_COPY) as Mode[]).map((candidate) => (
              <button
                key={candidate}
                className={`mode-button ${candidate === mode ? 'active' : ''}`}
                onClick={() => setMode(candidate)}
              >
                <span>{MODE_COPY[candidate].title}</span>
              </button>
            ))}
          </div>
        </header>

        <section className="chat">
          <div className="chat-header">
            <div className="chat-header-copy">
              <strong>{activeConversation?.title || 'No conversation'}</strong>
              <span>{modeConfig.displayName}</span>
            </div>
            <div className={`stat-pill ${sending ? 'active' : ''}`}>{loading ? '読み込み中' : sending ? progressLabel : '準備完了'}</div>
          </div>

          <div className="messages" ref={messagesContainerRef}>
            {activeMessages.map((message) => (
              <article key={message.id} data-message-id={message.id} className={`message ${message.role}`}>
                <div className="message-meta">
                  <span>{message.role === 'user' ? 'You' : 'Irori'}</span>
                  <span>{new Date(message.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="message-body">{message.content}</div>
                {message.role === 'assistant' && (
                  <div className="message-foot">
                    <span>{message.modelDisplayName || message.model || 'unknown'}</span>
                    <span>{message.inputTokens.toLocaleString()} in / {message.outputTokens.toLocaleString()} out</span>
                    <span>{formatMoneyPair(message.actualCost || message.estimatedCost, snapshot.settings.jpyPerUsd)}</span>
                    <span>{message.latencyMs.toLocaleString()} ms</span>
                  </div>
                )}
              </article>
            ))}
            {pendingTurn && (
              <>
                <article data-message-id={`${pendingTurn.id}-user`} className="message user pending">
                  <div className="message-meta">
                    <span>You</span>
                    <span>{new Date(pendingTurn.startedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className="message-body">{pendingTurn.content}</div>
                </article>
                <article data-message-id={`${pendingTurn.id}-assistant`} className="message assistant pending thinking">
                  <div className="message-meta">
                    <span>Irori</span>
                    <span>{progressLabel}</span>
                  </div>
                  <div className="thinking-body">
                    <span className="thinking-label">{progressCopy}</span>
                    <span className="typing-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                </article>
              </>
            )}
          </div>

          <div className="composer">
            {(preview.estimatedCost > snapshot.settings.perRunCostLimit || preview.requiresConfirmation) && (
              <div className="composer-warning">
                {preview.estimatedCost > snapshot.settings.perRunCostLimit ? '1回あたり上限を超える見込みです。' : 'Deepモードは実行前に確認します。'}
              </div>
            )}
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="ここにメッセージを入力"
              rows={6}
            />
            <div className="composer-foot">
              <button className="preview compact-preview" onClick={() => setUsageOpen(true)}>
                <span>{MODE_COPY[mode].title}</span>
                <span>{preview.selectedModel.displayName}</span>
                <span>約{compactCost}</span>
                {preview.estimatedCost > snapshot.settings.perRunCostLimit && <strong>上限超過見込み</strong>}
              </button>
              <button className="send-button" onClick={() => void handleSend()} disabled={sending || !input.trim()}>
                送信
              </button>
            </div>
          </div>
        </section>
      </main>

      <aside className="inspector">
        {usageContent}
        <button className="usage-detail-trigger" onClick={() => setUsageOpen(true)}>
          詳細を開く · {latestCost}
        </button>
        <button className="settings-trigger inspector-settings-trigger" onClick={() => setShowSettings((value) => !value)}>
          API key / Settings
        </button>
      </aside>

      <section className="usage-sheet" aria-hidden={!usageOpen}>
        <div className="sheet-handle" />
        <div className="panel-head">
          <h2>Routing & Usage</h2>
          <button className="secondary-trigger" onClick={() => setUsageOpen(false)}>Close</button>
        </div>
        <div className="sheet-scroll">{usageContent}</div>
      </section>

      {showSettings && (
        <div className="modal-backdrop settings-backdrop">
          {settingsPanel}
        </div>
      )}

      {confirmationRequired && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Deep 実行確認</h2>
            <p>{preview.reason}</p>
            <p>推定コスト: {formatMoneyPair(preview.estimatedCost, snapshot.settings.jpyPerUsd)}</p>
            <div className="modal-actions">
              <button onClick={() => setConfirmationRequired(false)}>キャンセル</button>
              <button onClick={() => void confirmAndSend()}>続行</button>
            </div>
          </div>
        </div>
      )}

      {error && <div className="toast error">{error}</div>}
    </div>
  );
}

export default App;
