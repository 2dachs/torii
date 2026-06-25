'use client';

import { calculateCost, estimateTokens, routeMessage, type Mode, type RouteDecision } from '@irori/core';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_MODEL_CONFIGS, MODE_COPY, MODEL_OPTIONS, resolveModelConfig } from '@/lib/model-configs';
import { createClient } from '@/lib/supabase/browser';
import type { AppSettings, Conversation, Message, Project } from '@/lib/types';

const emptySettings = (userId: string): AppSettings => ({
  id: 'local',
  user_id: userId,
  quick_model_slug: DEFAULT_MODEL_CONFIGS.quick.modelSlug,
  standard_model_slug: DEFAULT_MODEL_CONFIGS.standard.modelSlug,
  deep_model_slug: DEFAULT_MODEL_CONFIGS.deep.modelSlug,
  monthly_budget_jpy: 3000,
  jpy_per_usd: 150,
  deep_confirmation_enabled: true,
  per_run_cost_limit: 0.5,
  has_openrouter_key: false,
  has_fugu_key: false,
  has_tavily_key: false,
  updated_at: new Date().toISOString(),
});

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

function formatUsd(value: number) {
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

function formatJpy(value: number) {
  return `¥${Math.round(value).toLocaleString('ja-JP')}`;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'unknown error';
  }
}

async function describeFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    const text = await context.clone().text();
    if (text) {
      try {
        const payload = JSON.parse(text) as { error?: string; message?: string };
        return payload.error ?? payload.message ?? text;
      } catch {
        return text;
      }
    }
  }
  return describeError(error);
}

export function IroriWebApp() {
  const supabase = useMemo(() => createClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('quick');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<RouteDecision | null>(null);
  const [apiKeyDrafts, setApiKeyDrafts] = useState({ openrouter: '', fugu: '', tavily: '' });
  const [pendingTurn, setPendingTurn] = useState<PendingTurn | null>(null);
  const workspaceLoadRef = useRef<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let mounted = true;
    const run = async () => {
      try {
        const code = typeof window !== 'undefined' ? new URL(window.location.href).searchParams.get('code') : null;
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          if (typeof window !== 'undefined') {
            const url = new URL(window.location.href);
            url.searchParams.delete('code');
            window.history.replaceState({}, document.title, url.toString());
          }
        }
        const { data } = await supabase.auth.getSession();
        if (mounted) setSession(data.session);
      } catch (authError) {
        console.error('auth bootstrap failed', authError);
        if (mounted) setError(`認証状態の初期化に失敗しました: ${describeError(authError)}`);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void run();
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!session?.user.id) return;
    void loadWorkspace(session.user.id);
  }, [session?.user.id]);

  async function loadWorkspace(userId: string) {
    if (!supabase) return;
    if (workspaceLoadRef.current === userId) return;
    workspaceLoadRef.current = userId;
    setLoading(true);
    try {
      const { data: projectRows, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .order('updated_at', { ascending: false });
      if (projectError) throw new Error(`projects query failed: ${projectError.message}`);

      const { data: settingRows, error: settingsSelectError } = await supabase
        .from('app_settings')
        .select('*')
        .maybeSingle();
      if (settingsSelectError) throw new Error(`app_settings query failed: ${settingsSelectError.message}`);

      let nextProjects = projectRows ?? [];
      if (nextProjects.length === 0) {
        const { data: createdProject, error: createProjectError } = await supabase
          .from('projects')
          .insert({ user_id: userId, name: 'General' })
          .select('*')
          .single();
        if (createProjectError) throw new Error(`projects seed failed: ${createProjectError.message}`);
        nextProjects = [createdProject as Project];
      }

      let nextSettings = settingRows as AppSettings | null;
      if (!nextSettings) {
        const { data: createdSettings, error: createSettingsError } = await supabase
          .from('app_settings')
          .upsert({
            user_id: userId,
            quick_model_slug: DEFAULT_MODEL_CONFIGS.quick.modelSlug,
            standard_model_slug: DEFAULT_MODEL_CONFIGS.standard.modelSlug,
            deep_model_slug: DEFAULT_MODEL_CONFIGS.deep.modelSlug,
          }, { onConflict: 'user_id' })
          .select('*')
          .single();
        if (createSettingsError) throw new Error(`app_settings seed failed: ${createSettingsError.message}`);
        nextSettings = createdSettings as AppSettings;
      }

      const projectId = nextProjects.some((project) => project.id === activeProjectId)
        ? activeProjectId
        : nextProjects[0]?.id ?? null;
      setProjects(nextProjects);
      setSettings(nextSettings ?? emptySettings(userId));
      setActiveProjectId(projectId);

      if (projectId) {
        await loadConversations(projectId);
      }
      setError(null);
    } catch (workspaceError) {
      console.error('loadWorkspace failed', workspaceError);
      setError(`ワークスペースの読み込みに失敗しました: ${describeError(workspaceError)}`);
    } finally {
      setLoading(false);
      workspaceLoadRef.current = null;
    }
  }

  async function loadConversations(projectId: string) {
    if (!supabase) return;
    const { data: conversationRows, error: conversationError } = await supabase
      .from('conversations')
      .select('*')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false });
    if (conversationError) throw conversationError;

    let nextConversations = (conversationRows ?? []) as Conversation[];
    if (nextConversations.length === 0 && session?.user.id) {
      const { data: createdConversation, error: createError } = await supabase
        .from('conversations')
        .insert({ user_id: session.user.id, project_id: projectId, title: 'New chat', mode })
        .select('*')
        .single();
      if (createError) throw createError;
      nextConversations = [createdConversation as Conversation];
    }

    setConversations(nextConversations);
    const conversationId = nextConversations.some((conversation) => conversation.id === activeConversationId)
      ? activeConversationId
      : nextConversations[0]?.id ?? null;
    setActiveConversationId(conversationId);
    if (conversationId) {
      await loadMessages(conversationId);
    }
  }

  async function loadMessages(conversationId: string) {
    if (!supabase) return;
    const { data, error: messageError } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (messageError) throw messageError;
    setMessages((data ?? []) as Message[]);
  }

  async function ensureProject(project: Project): Promise<Project> {
    if (!supabase || !session?.user.id) return project;
    const { data, error: selectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', project.id)
      .maybeSingle();
    if (selectError) throw selectError;
    if (data) return data as Project;

    const { data: createdProject, error: createError } = await supabase
      .from('projects')
      .insert({ user_id: session.user.id, name: 'General' })
      .select('*')
      .single();
    if (createError) throw createError;
    const nextProject = createdProject as Project;
    setProjects((current) => [nextProject, ...current.filter((item) => item.id !== project.id)]);
    setActiveProjectId(nextProject.id);
    return nextProject;
  }

  async function ensureConversation(project: Project, conversation: Conversation): Promise<Conversation> {
    if (!supabase || !session?.user.id) return conversation;
    const { data, error: selectError } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversation.id)
      .eq('project_id', project.id)
      .maybeSingle();
    if (selectError) throw selectError;
    if (data) return data as Conversation;

    const { data: createdConversation, error: createError } = await supabase
      .from('conversations')
      .insert({ user_id: session.user.id, project_id: project.id, title: 'New chat', mode })
      .select('*')
      .single();
    if (createError) throw createError;
    const nextConversation = createdConversation as Conversation;
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== conversation.id)]);
    setActiveConversationId(nextConversation.id);
    setMessages([]);
    return nextConversation;
  }

  async function handleLogin() {
    if (!supabase) {
      setError('Supabase環境変数が未設定です。NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。');
      return;
    }
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const { error: loginError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: siteUrl },
    });
    if (loginError) setError(loginError.message);
  }

  async function handleLogout() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setProjects([]);
    setConversations([]);
    setMessages([]);
    setSettingsOpen(false);
    setNavOpen(false);
    setUsageOpen(false);
  }

  const modelConfigs = useMemo(() => {
    const next = { ...DEFAULT_MODEL_CONFIGS };
    if (settings) {
      next.quick = resolveModelConfig('quick', settings.quick_model_slug);
      next.standard = resolveModelConfig('standard', settings.standard_model_slug);
      next.deep = resolveModelConfig('deep', settings.deep_model_slug);
    }
    return next;
  }, [settings]);

  const preview = useMemo(() => routeMessage({
    mode,
    text: input,
    modelConfigs,
    perRunCostLimit: settings?.per_run_cost_limit ?? 0.5,
    deepConfirmationEnabled: settings?.deep_confirmation_enabled ?? true,
  }), [input, mode, modelConfigs, settings?.deep_confirmation_enabled, settings?.per_run_cost_limit]);

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) ?? null;
  const selectedProviderKeyKind = preview.selectedModel.provider === 'sakana' ? 'fugu' : 'openrouter';
  const hasSelectedProviderKey = selectedProviderKeyKind === 'fugu' ? settings?.has_fugu_key : settings?.has_openrouter_key;
  const missingApiKeyMessage = `${selectedProviderKeyKind === 'fugu' ? 'Fugu' : 'OpenRouter'} APIキーが未設定です。Settingsで保存してください。`;
  const canSend = Boolean(input.trim() && activeProject && activeConversation && hasSelectedProviderKey);
  const estimatedJpy = formatJpy(preview.estimatedCost * (settings?.jpy_per_usd ?? 150));
  const progressLabel = pendingTurn?.isSearch ? '検索中' : '考え中';
  const progressCopy = pendingTurn?.isSearch
    ? 'Web検索の結果を集めています'
    : '回答を組み立てています';

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const target = pendingTurn
      ? container.querySelector(`[data-message-id="${pendingTurn.id}-assistant"]`)
      : container.querySelector(`[data-message-id="${messages[messages.length - 1]?.id}"]`);
    (target as HTMLElement | null)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [messages.length, activeConversationId, pendingTurn]);

  async function handleSend() {
    if (!supabase) return;
    if (sending || !canSend || !activeProject || !activeConversation) return;
    if (preview.requiresConfirmation && !window.confirm(`Deep/高コスト実行の確認\n推定: ${estimatedJpy} / ${formatUsd(preview.estimatedCost)}`)) {
      return;
    }

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
      const currentProject = await ensureProject(activeProject);
      const currentConversation = await ensureConversation(currentProject, activeConversation);
      const { data, error: functionError } = await supabase.functions.invoke('send_message', {
        body: { projectId: currentProject.id, conversationId: currentConversation.id, mode, content },
      });
      if (functionError) throw new Error(await describeFunctionError(functionError));
      if (data?.error) throw new Error(data.error);

      const nextProjectId = data.projectId ?? currentProject.id;
      const nextConversationId = data.conversationId ?? currentConversation.id;
      setActiveProjectId(nextProjectId);
      setActiveConversationId(nextConversationId);
      setDecision(data.decision ?? preview);
      await loadMessages(nextConversationId);
      await loadWorkspace(session!.user.id);
      setActiveProjectId(nextProjectId);
      setActiveConversationId(nextConversationId);
      setError(null);
    } catch (sendError) {
      setInput(content);
      setError(`送信に失敗しました: ${describeError(sendError)}`);
    } finally {
      setSending(false);
      setPendingTurn(null);
    }
  }

  async function saveApiKey(kind: 'openrouter' | 'fugu' | 'tavily') {
    if (!supabase) return;
    const value = apiKeyDrafts[kind].trim();
    if (!value) return;
    const { data, error: saveError } = await supabase.functions.invoke('save_api_key', {
      body: { kind, value },
    });
    if (saveError) {
      setError(await describeFunctionError(saveError));
      return;
    }
    if (data?.error) {
      setError(data.error);
      return;
    }
    setApiKeyDrafts((current) => ({ ...current, [kind]: '' }));
    setSettings((current) => {
      if (!current) return current;
      return {
        ...current,
        has_openrouter_key: kind === 'openrouter' ? true : current.has_openrouter_key,
        has_fugu_key: kind === 'fugu' ? true : current.has_fugu_key,
        has_tavily_key: kind === 'tavily' ? true : current.has_tavily_key,
        updated_at: new Date().toISOString(),
      };
    });
    setError(null);
    if (session?.user.id) await loadWorkspace(session.user.id);
  }

  async function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    if (!supabase) return;
    if (!settings) return;
    const { data, error: updateError } = await supabase
      .from('app_settings')
      .update({ [key]: value, updated_at: new Date().toISOString() })
      .eq('id', settings.id)
      .select('*')
      .single();
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setSettings(data as AppSettings);
  }

  if (loading) {
    return <main className="grid min-h-screen place-items-center bg-irori-bg text-irori-ink">読み込み中</main>;
  }

  if (!session) {
    return (
      <main className="grid min-h-screen place-items-center bg-irori-bg px-6 text-irori-ink">
        <section className="w-full max-w-md rounded-2xl border gold-border bg-irori-surface p-8 shadow-2xl">
          <div className="mb-8">
            <p className="text-sm uppercase tracking-[0.18em] text-irori-gold">Irori Web</p>
            <h1 className="mt-3 text-4xl font-semibold">AI chat workspace</h1>
            <p className="mt-4 text-sm leading-7 text-irori-muted">Googleアカウントでログインして、外でもIroriの会話を続けられるWeb版MVPです。</p>
          </div>
          <button onClick={handleLogin} className="w-full rounded-lg bg-irori-gold px-4 py-3 font-semibold text-[#1a1814]">
            Googleでログイン
          </button>
          {!supabase && <p className="mt-4 text-sm text-red-300">Supabase環境変数が未設定です。`.env.local` を設定してください。</p>}
          {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
        </section>
      </main>
    );
  }

  const sidebar = (
    <aside className="flex min-h-0 flex-col gap-4 overflow-auto border-r gold-border bg-[#1b1713] p-4">
      <div className="rounded-xl border gold-border bg-irori-surface p-4">
        <p className="text-2xl font-semibold">Irori</p>
        <p className="mt-2 text-sm leading-6 text-irori-muted">軽い質問は安く速く。重要な判断は深く。</p>
      </div>
      <section className="rounded-xl border gold-border bg-irori-surface p-4">
        <h2 className="mb-3 text-sm uppercase tracking-[0.14em] text-irori-gold">Projects</h2>
        <div className="space-y-2">
          {projects.slice(0, 6).map((project) => (
            <button
              key={project.id}
              onClick={() => {
                setActiveProjectId(project.id);
                setNavOpen(false);
                void loadConversations(project.id);
              }}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${project.id === activeProjectId ? 'border-irori-gold bg-irori-gold/10' : 'gold-border'}`}
            >
              {project.name}
            </button>
          ))}
        </div>
      </section>
      <section className="rounded-xl border gold-border bg-irori-surface p-4">
        <h2 className="mb-3 text-sm uppercase tracking-[0.14em] text-irori-gold">Conversations</h2>
        <div className="space-y-2">
          {conversations.slice(0, 8).map((conversation) => (
            <button
              key={conversation.id}
              onClick={() => {
                setActiveConversationId(conversation.id);
                setMode(conversation.mode);
                setNavOpen(false);
                void loadMessages(conversation.id);
              }}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${conversation.id === activeConversationId ? 'border-irori-gold bg-irori-gold/10' : 'gold-border'}`}
            >
              <span className="block truncate">{conversation.title}</span>
              <span className="text-xs text-irori-muted">{MODE_COPY[conversation.mode].label}</span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );

  const usage = (
    <aside className="flex min-h-0 flex-col gap-4 overflow-auto border-l gold-border bg-[#1b1713] p-4">
      <section className="rounded-xl border gold-border bg-irori-surface p-4">
        <h2 className="mb-4 text-sm uppercase tracking-[0.14em] text-irori-gold">Routing</h2>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border gold-border bg-white/5 p-3"><dt className="text-irori-muted">Mode</dt><dd>{MODE_COPY[mode].label}</dd></div>
          <div className="rounded-lg border gold-border bg-white/5 p-3"><dt className="text-irori-muted">Model</dt><dd>{preview.selectedModel.displayName}</dd></div>
          <div className="col-span-2 rounded-lg border gold-border bg-white/5 p-3"><dt className="text-irori-muted">Reason</dt><dd>{decision?.reason ?? preview.reason}</dd></div>
        </dl>
      </section>
      <section className="rounded-xl border gold-border bg-irori-surface p-4">
        <h2 className="mb-4 text-sm uppercase tracking-[0.14em] text-irori-gold">Usage</h2>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border gold-border bg-white/5 p-3"><dt className="text-irori-muted">Input</dt><dd>{preview.estimatedInputTokens.toLocaleString()}</dd></div>
          <div className="rounded-lg border gold-border bg-white/5 p-3"><dt className="text-irori-muted">Output</dt><dd>{preview.estimatedOutputTokens.toLocaleString()}</dd></div>
          <div className="col-span-2 rounded-lg border gold-border bg-white/5 p-3"><dt className="text-irori-muted">Estimated</dt><dd>{estimatedJpy} / {formatUsd(preview.estimatedCost)}</dd></div>
        </dl>
      </section>
      <button onClick={() => setSettingsOpen(true)} className="mt-auto rounded-lg bg-irori-gold px-4 py-3 font-semibold text-[#1a1814]">API key / Settings</button>
    </aside>
  );

  return (
    <main className="grid h-screen grid-cols-1 overflow-hidden bg-irori-bg text-irori-ink lg:grid-cols-[280px_minmax(0,1fr)_320px]">
      <div className={`fixed inset-y-0 left-0 z-40 w-[min(340px,calc(100vw-48px))] transition lg:static lg:block lg:w-auto ${navOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        {sidebar}
      </div>

      <section className="flex min-h-0 flex-col">
        <header className="flex items-center justify-between border-b gold-border p-4 lg:hidden">
          <button onClick={() => setNavOpen(true)} className="rounded-full border gold-border px-3 py-2">Menu</button>
          <div className="min-w-0 text-center">
            <p className="truncate font-semibold">{activeProject?.name ?? 'Irori'}</p>
            <p className="truncate text-xs text-irori-muted">{activeConversation?.title ?? 'New chat'}</p>
          </div>
          <button onClick={() => setUsageOpen(true)} className="rounded-full border gold-border px-3 py-2">Usage</button>
        </header>

        <div className="border-b gold-border p-5">
          <p className="text-sm uppercase tracking-[0.14em] text-irori-gold">Irori Web Workspace</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold">{activeProject?.name ?? 'General'}</h1>
              <p className="mt-2 text-sm text-irori-muted">{MODE_COPY[mode].description}</p>
            </div>
            <div className="flex gap-2">
              {(Object.keys(MODE_COPY) as Mode[]).map((candidate) => (
                <button key={candidate} onClick={() => setMode(candidate)} className={`rounded-full border px-4 py-2 text-sm ${candidate === mode ? 'border-irori-gold bg-irori-gold/15' : 'gold-border'}`}>
                  {MODE_COPY[candidate].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div ref={messagesContainerRef} className="min-h-0 flex-1 overflow-auto p-5 scroll-smooth">
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {messages.map((message) => (
              <article
                key={message.id}
                data-message-id={message.id}
                className={message.role === 'user' ? 'ml-auto max-w-[78%] rounded-2xl bg-[#c9a96e] p-4 text-[#1a1814]' : 'irori-message-enter mr-auto rounded-2xl border gold-border bg-irori-surface2 p-4'}
              >
                <p className={message.role === 'user' ? 'mb-2 text-xs text-[#3a2e20]' : 'mb-2 text-xs text-irori-muted'}>
                  {message.role === 'user' ? 'You' : 'Irori'} {new Date(message.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                </p>
                <p className="whitespace-pre-wrap leading-8">{message.content}</p>
              </article>
            ))}
            {pendingTurn && (
              <>
                <article data-message-id={`${pendingTurn.id}-user`} className="irori-message-pending ml-auto max-w-[78%] rounded-2xl bg-[#c9a96e] p-4 text-[#1a1814]">
                  <p className="mb-2 text-xs text-[#3a2e20]">
                    You {new Date(pendingTurn.startedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <p className="whitespace-pre-wrap leading-8">{pendingTurn.content}</p>
                </article>
                <article data-message-id={`${pendingTurn.id}-assistant`} className="irori-message-enter irori-message-pending mr-auto rounded-2xl border gold-border bg-irori-surface2 p-4">
                  <p className="mb-2 text-xs text-irori-muted">Irori {progressLabel}</p>
                  <div className="flex items-center gap-3 text-sm text-irori-muted">
                    <span>{progressCopy}</span>
                    <span className="typing-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                </article>
              </>
            )}
            {messages.length === 0 && !pendingTurn && (
              <div className="rounded-2xl border gold-border bg-irori-surface p-5 text-sm leading-7 text-irori-muted">
                {hasSelectedProviderKey ? 'メッセージを入力して会話を開始できます。' : missingApiKeyMessage}
              </div>
            )}
          </div>
        </div>

        <footer className="border-t gold-border bg-[#181513]/95 p-4">
          {!hasSelectedProviderKey && <p className="mb-3 rounded-lg border border-red-300/30 bg-red-500/10 p-3 text-sm text-red-200">{missingApiKeyMessage}</p>}
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void handleSend();
              }
            }}
            rows={4}
            className="w-full resize-none rounded-xl border gold-border bg-black/20 p-4 outline-none"
            placeholder="ここにメッセージを入力"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <button onClick={() => setUsageOpen(true)} className="text-sm text-irori-muted">{MODE_COPY[mode].label} · {preview.selectedModel.displayName} · 約{estimatedJpy}</button>
            <button disabled={!canSend || sending} onClick={() => void handleSend()} className="rounded-lg bg-irori-gold px-5 py-3 font-semibold text-[#1a1814] disabled:opacity-40">
              {sending ? '送信中' : '送信'}
            </button>
          </div>
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        </footer>
      </section>

      <div className="hidden lg:block">{usage}</div>

      {usageOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 lg:hidden" onClick={() => setUsageOpen(false)}>
          <div className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-auto rounded-t-2xl bg-irori-bg p-4" onClick={(event) => event.stopPropagation()}>
            {usage}
          </div>
        </div>
      )}

      {settingsOpen && settings && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <section className="w-full max-w-3xl rounded-2xl border gold-border bg-irori-surface p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-semibold">API key & Settings</h2>
              <button onClick={() => setSettingsOpen(false)} className="rounded-lg border gold-border px-3 py-2">Close</button>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {(['openrouter', 'fugu', 'tavily'] as const).map((kind) => {
                const isSaved =
                  kind === 'openrouter' ? settings.has_openrouter_key :
                  kind === 'fugu' ? settings.has_fugu_key :
                  settings.has_tavily_key;
                return (
                <label key={kind} className="text-sm">
                  <span className="mb-2 flex items-center justify-between gap-2 text-irori-muted">
                    <span>{kind} API key</span>
                    <span className={isSaved ? 'text-irori-gold' : 'text-red-300'}>{isSaved ? '保存済み' : '未設定'}</span>
                  </span>
                  <input
                    type="password"
                    value={apiKeyDrafts[kind]}
                    onChange={(event) => setApiKeyDrafts((current) => ({ ...current, [kind]: event.target.value }))}
                    className="mb-2 w-full rounded-lg border gold-border bg-black/20 p-3"
                    placeholder={isSaved ? '変更する場合のみ入力' : 'APIキーを入力'}
                  />
                  <button onClick={() => void saveApiKey(kind)} className="w-full rounded-lg bg-irori-gold px-3 py-2 font-semibold text-[#1a1814]">保存</button>
                </label>
                );
              })}
            </div>
            <a className="mt-4 block text-sm text-irori-gold underline" href="https://sakana.ai/" target="_blank" rel="noreferrer">Fugu APIキー取得ページを開く</a>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {([
                { mode: 'quick', key: 'quick_model_slug', label: 'Quick model', value: settings.quick_model_slug },
                { mode: 'standard', key: 'standard_model_slug', label: 'Standard model', value: settings.standard_model_slug },
                { mode: 'deep', key: 'deep_model_slug', label: 'Deep model', value: settings.deep_model_slug },
              ] as const).map((field) => (
                <label key={field.mode} className="text-sm">
                  <span className="mb-2 block text-irori-muted">{field.label}</span>
                  <select
                    value={field.value}
                    onChange={(event) => void updateSetting(field.key, event.target.value)}
                    className="w-full rounded-lg border gold-border bg-black/20 p-3"
                  >
                    {MODEL_OPTIONS[field.mode].map((option) => (
                      <option key={option.modelSlug} value={option.modelSlug}>
                        {option.displayName} · {option.provider}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs leading-5 text-irori-muted">
                    {resolveModelConfig(field.mode, field.value).modelSlug}
                  </p>
                </label>
              ))}
            </div>
            <section className="mt-6 rounded-xl border gold-border bg-white/5 p-4">
              <h3 className="text-sm uppercase tracking-[0.14em] text-irori-gold">Account</h3>
              <p className="mt-2 text-sm text-irori-muted">
                {session?.user.email ? `現在のアカウント: ${session.user.email}` : '現在のアカウント情報を取得できませんでした。'}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  onClick={handleLogout}
                  className="rounded-lg border border-red-300/40 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200"
                >
                  ログアウト
                </button>
                <button
                  onClick={handleLogout}
                  className="rounded-lg bg-irori-gold px-4 py-2 text-sm font-semibold text-[#1a1814]"
                >
                  別アカウントでログイン
                </button>
              </div>
              <p className="mt-3 text-xs leading-6 text-irori-muted">
                別アカウントで使う場合は、一度ログアウトしてから Google で再ログインしてください。
              </p>
            </section>
          </section>
        </div>
      )}

      {navOpen && <button className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setNavOpen(false)} aria-label="Close navigation" />}
      <button onClick={() => setSettingsOpen(true)} className="fixed right-4 top-4 hidden rounded-full border gold-border bg-irori-surface px-3 py-2 text-xs text-irori-muted lg:block">Settings</button>
    </main>
  );
}
