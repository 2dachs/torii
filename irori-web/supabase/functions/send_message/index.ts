import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { calculateCost, estimateTokens, routeMessage, type Mode, type ModelConfig } from '../_shared/core.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const SEARCH_KEYWORDS = ['検索', '調べて', '最新', 'ニュース', 'web', 'ウェブ', 'ネット', '現在', '今日', '直近'];

const MODEL_OPTIONS: Record<Mode, ModelConfig[]> = {
  quick: [
    {
      id: 'quick-deepseek-v4-flash',
      provider: 'openrouter',
      displayName: 'DeepSeek V4 Flash',
      modelSlug: 'deepseek/deepseek-v4-flash',
      inputPricePerMillionTokens: 0.09,
      outputPricePerMillionTokens: 0.18,
      contextWindow: 1048576,
      enabled: true,
    },
  ],
  standard: [
    {
      id: 'standard-deepseek-v4-pro',
      provider: 'openrouter',
      displayName: 'DeepSeek V4 Pro',
      modelSlug: 'deepseek/deepseek-v4-pro',
      inputPricePerMillionTokens: 0.435,
      outputPricePerMillionTokens: 0.87,
      contextWindow: 1048576,
      enabled: true,
    },
    {
      id: 'standard-gpt-4o',
      provider: 'openrouter',
      displayName: 'GPT-4o',
      modelSlug: 'openai/gpt-4o',
      inputPricePerMillionTokens: 2.5,
      outputPricePerMillionTokens: 10,
      contextWindow: 128000,
      enabled: true,
    },
  ],
  deep: [
    {
      id: 'deep-fugu',
      provider: 'sakana',
      displayName: 'Fugu',
      modelSlug: 'fugu',
      inputPricePerMillionTokens: 4,
      outputPricePerMillionTokens: 12,
      contextWindow: 128000,
      enabled: true,
    },
    {
      id: 'deep-fusion',
      provider: 'openrouter',
      displayName: 'OpenRouter Fusion',
      modelSlug: 'openrouter/fusion',
      inputPricePerMillionTokens: 0,
      outputPricePerMillionTokens: 0,
      contextWindow: 1000000,
      enabled: true,
    },
    {
      id: 'deep-opus-4-8',
      provider: 'openrouter',
      displayName: 'Claude Opus 4.8',
      modelSlug: 'anthropic/claude-opus-4.8',
      inputPricePerMillionTokens: 5,
      outputPricePerMillionTokens: 25,
      contextWindow: 1000000,
      enabled: true,
    },
  ],
};

function shouldSearch(text: string) {
  const lowered = text.toLowerCase();
  return SEARCH_KEYWORDS.some((keyword) => lowered.includes(keyword));
}

function resolveModelConfig(mode: Mode, modelSlug: string): ModelConfig {
  const fallback = MODEL_OPTIONS[mode][0];
  return MODEL_OPTIONS[mode].find((option) => option.modelSlug === modelSlug) ?? {
    ...fallback,
    id: `${mode}-custom`,
    displayName: modelSlug,
    modelSlug,
  };
}

function describeCaughtError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const item = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown; error?: unknown };
    const parts = [item.message, item.details, item.hint, item.code, item.error]
      .filter((value) => typeof value === 'string' && value.length > 0);
    if (parts.length > 0) return parts.join(' ');
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown object error';
    }
  }
  return 'send_message failed';
}

async function tavilySearch(apiKey: string, query: string) {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_usage: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Tavily API error (${response.status})`);
  }
  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];
  return results
    .slice(0, 5)
    .map((item: any, index: number) => `[${index + 1}] ${item.title ?? 'Untitled'}\nURL: ${item.url}\n${item.content ?? ''}`)
    .join('\n\n');
}

async function callOpenRouter(apiKey: string, model: string, messages: ChatMessage[]) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://irori.app',
      'X-Title': 'Irori Web',
    },
    body: JSON.stringify({ model, messages }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${text.slice(0, 240)}`);
  }
  return await response.json();
}

async function callFugu(apiKey: string, model: string, messages: ChatMessage[]) {
  const response = await fetch('https://api.sakana.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Fugu API error (${response.status}): ${text.slice(0, 240)}`);
  }
  return await response.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  const startedAt = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error('Supabase environment variables are missing.');
    }

    const authorization = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = userData.user.id;

    const { projectId, conversationId, mode, content } = await req.json() as {
      projectId?: string;
      conversationId?: string;
      mode?: Mode;
      content?: string;
    };
    if (!conversationId || !mode || !content?.trim()) {
      return jsonResponse({ error: 'Invalid send_message payload' }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: existingSettings, error: settingsError } = await admin
      .from('app_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (settingsError) {
      throw settingsError;
    }

    let settings = existingSettings;
    if (!settings) {
      const { data: createdSettings, error: createSettingsError } = await admin
        .from('app_settings')
        .upsert({
          user_id: userId,
          quick_model_slug: MODEL_OPTIONS.quick[0].modelSlug,
          standard_model_slug: MODEL_OPTIONS.standard[0].modelSlug,
          deep_model_slug: MODEL_OPTIONS.deep[0].modelSlug,
        }, { onConflict: 'user_id' })
        .select('*')
        .single();
      if (createSettingsError) {
        throw createSettingsError;
      }
      settings = createdSettings;
    }

    const { data: existingConversation } = await admin
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();
    let conversation = existingConversation;
    let canonicalProjectId = conversation?.project_id as string | undefined;

    if (!conversation) {
      const { data: requestedProject } = projectId
        ? await admin.from('projects').select('*').eq('id', projectId).eq('user_id', userId).maybeSingle()
        : { data: null };
      let projectForConversation = requestedProject;
      if (!projectForConversation) {
        const { data: createdProject, error: createProjectError } = await admin
          .from('projects')
          .insert({ user_id: userId, name: 'General' })
          .select('*')
          .single();
        if (createProjectError) throw createProjectError;
        projectForConversation = createdProject;
      }
      canonicalProjectId = projectForConversation.id;
      const { data: createdConversation, error: createConversationError } = await admin
        .from('conversations')
        .insert({ user_id: userId, project_id: canonicalProjectId, title: 'New chat', mode })
        .select('*')
        .single();
      if (createConversationError) throw createConversationError;
      conversation = createdConversation;
    }

    const canonicalConversationId = conversation.id as string;
    canonicalProjectId = conversation.project_id as string;

    const { data: historyRows } = await admin
      .from('messages')
      .select('role, content')
      .eq('conversation_id', canonicalConversationId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(20);

    const { data: project, error: projectError } = await admin
      .from('projects')
      .select('*')
      .eq('id', canonicalProjectId)
      .eq('user_id', userId)
      .single();
    if (projectError || !project) {
      return jsonResponse({ error: 'Conversation project was not found for this user. Please create a new chat.' }, { status: 404 });
    }

    const modelConfigs: Record<Mode, ModelConfig> = {
      quick: resolveModelConfig('quick', settings.quick_model_slug),
      standard: resolveModelConfig('standard', settings.standard_model_slug),
      deep: resolveModelConfig('deep', settings.deep_model_slug),
    };
    const decision = routeMessage({
      mode,
      text: content,
      modelConfigs,
      perRunCostLimit: Number(settings.per_run_cost_limit),
      deepConfirmationEnabled: Boolean(settings.deep_confirmation_enabled),
    });

    const selectedModel = decision.selectedModel;
    const providerKeyKind = selectedModel.provider === 'sakana' ? 'fugu' : 'openrouter';
    const { data: providerKey, error: keyError } = await admin.rpc('get_user_api_key', {
      p_user_id: userId,
      p_kind: providerKeyKind,
    });
    if (keyError || !providerKey) {
      return jsonResponse({ error: `${providerKeyKind} APIキーが未設定です。Settingsで保存してください。` }, { status: 400 });
    }

    let searchContext = '';
    if (shouldSearch(content)) {
      const { data: tavilyKey } = await admin.rpc('get_user_api_key', { p_user_id: userId, p_kind: 'tavily' });
      if (!tavilyKey) {
        return jsonResponse({ error: 'Tavily APIキーが未設定のため、Web検索は実行できません。Settingsで保存してください。' }, { status: 400 });
      }
      searchContext = await tavilySearch(String(tavilyKey), content);
    }

    const chatMessages: ChatMessage[] = [
      { role: 'system', content: 'You are Irori, a practical Japanese AI chat assistant. Begin the first assistant reply with "Iroriにようこそ。" when appropriate.' },
    ];
    if (searchContext) {
      chatMessages.push({ role: 'system', content: `Web検索結果:\n${searchContext}\n検索結果に基づく場合はURLを示してください。` });
    }
    for (const item of historyRows ?? []) {
      if (item.role === 'user' || item.role === 'assistant') {
        chatMessages.push({ role: item.role, content: item.content });
      }
    }
    chatMessages.push({ role: 'user', content });

    await admin.from('messages').insert({
      user_id: userId,
      conversation_id: canonicalConversationId,
      role: 'user',
      content,
    });

    const responseJson = selectedModel.provider === 'sakana'
      ? await callFugu(String(providerKey), selectedModel.modelSlug, chatMessages)
      : await callOpenRouter(String(providerKey), selectedModel.modelSlug, chatMessages);

    const assistantContent = responseJson.choices?.[0]?.message?.content ?? '(No response)';
    const usage = responseJson.usage ?? {};
    const inputTokens = Number(usage.prompt_tokens ?? estimateTokens(content));
    const outputTokens = Number(usage.completion_tokens ?? estimateTokens(assistantContent));
    const actualCost = calculateCost(
      inputTokens,
      outputTokens,
      selectedModel.inputPricePerMillionTokens,
      selectedModel.outputPricePerMillionTokens,
    );
    const latencyMs = Date.now() - startedAt;

    const { data: assistantMessage, error: messageError } = await admin.from('messages').insert({
      user_id: userId,
      conversation_id: canonicalConversationId,
      role: 'assistant',
      content: assistantContent,
      model: selectedModel.modelSlug,
      model_display_name: selectedModel.displayName,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost: decision.estimatedCost,
      actual_cost: actualCost,
      latency_ms: latencyMs,
    }).select('*').single();
    if (messageError) throw messageError;

    await admin.from('usage_logs').insert({
      user_id: userId,
      project_id: canonicalProjectId,
      conversation_id: canonicalConversationId,
      model: selectedModel.modelSlug,
      mode,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost: decision.estimatedCost,
      actual_cost: actualCost,
      latency_ms: latencyMs,
    });

    if (conversation.title === 'New chat') {
      await admin.from('conversations').update({ title: content.slice(0, 28), mode }).eq('id', canonicalConversationId).eq('user_id', userId);
    }
    await admin.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', canonicalProjectId).eq('user_id', userId);

    return jsonResponse({ assistantMessage, projectId: canonicalProjectId, conversationId: canonicalConversationId, decision, usage: { inputTokens, outputTokens, actualCost, latencyMs } });
  } catch (error) {
    const message = describeCaughtError(error);
    console.error('send_message failed', message);
    return jsonResponse({ error: message }, { status: 400 });
  }
});
