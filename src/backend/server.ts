import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import express from 'express';
import { createServer } from 'http';
import portfinder from 'portfinder';
import { buildWorkspaceTree, undoFileCheckpoint } from './tools';
import { saveChatMessage, getChatHistory, createTask, getMonthlyBudget, getGlobalMonthlyBudget, getModelUsageThisMonth, getAllModelUsageThisMonth } from './storage';
import { getSecretsManager } from './secretsManager';
import { isCommandSafe } from './commandGuard';
import { PromptRouter } from './lib/router';
import type { RouteResult } from './lib/router';
import { loadCustomRules, getAllRules, addCustomRule, updateCustomRule, deleteCustomRule } from './lib/routingRules';
import { loadPettalConfig, savePettalConfig } from './lib/pettalConfig';
import { getOpenRouterPricing, refreshOpenRouterPricingCache } from './lib/openRouterPricing';
import { runAgentLoop } from './agentLoop';
import type { AgentEvent } from './agentLoop';
import { resolveApproval } from './approvalManager';
import * as licenseManager from './licenseManager';
import { getCurrentWorkspaceId } from './workspace';
import {
  PROVIDERS,
  ProviderId,
  ProviderDef,
  ModelDef,
  ModelLimit,
  CONFIG_SECTION,
  CONFIG_PROVIDER,
  CONFIG_MONTHLY_BUDGET,
  DEFAULT_PROVIDER,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MONTHLY_BUDGET,
  DEFAULT_EXCHANGE_RATE,
  EXCHANGE_RATE_CACHE_MS,
  CONFIG_EXCHANGE_RATE,
  CONFIG_USE_AUTO_EXCHANGE_RATE,
  EXCHANGE_RATE_API_URL,
  IMAGE_SUPPORTED_MODELS,
  CONFIG_BUDGET_SCOPE,
  DEFAULT_BUDGET_SCOPE,
  CONFIG_AUTO_APPLY_FILES,
  CONFIG_MAIN_PROVIDER,
  CONFIG_MAIN_MODEL,
  CONFIG_SUB_PROVIDER,
  CONFIG_SUB_MODEL,
  CONFIG_MODEL_LIMITS,
} from '../constants';

let server: ReturnType<typeof createServer> | undefined;
let app: express.Express | undefined;
let sessionToken = '';

const activeAgentControllers = new Map<string, AbortController>();

// ── 為替レートキャッシュ ──
let cachedExchangeRate: number | null = null;
let cachedExchangeRateTime = 0;

/**
 * 為替レートを取得（自動取得 or 手動設定 or デフォルト）
 */
async function getUsdToJpyRate(): Promise<number> {
  const now = Date.now();
  
  if (cachedExchangeRate !== null && now - cachedExchangeRateTime < EXCHANGE_RATE_CACHE_MS) {
    return cachedExchangeRate;
  }

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const useAuto = config.get<boolean>(CONFIG_USE_AUTO_EXCHANGE_RATE, true);
  const manualRate = config.get<number>(CONFIG_EXCHANGE_RATE, DEFAULT_EXCHANGE_RATE);

  if (!useAuto) {
    cachedExchangeRate = manualRate;
    cachedExchangeRateTime = now;
    return manualRate;
  }

  try {
    const response = await fetch(EXCHANGE_RATE_API_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: any = await response.json();
    const rate = data?.rates?.JPY;
    if (typeof rate === 'number' && rate > 0) {
      cachedExchangeRate = rate;
      cachedExchangeRateTime = now;
      console.log(`[Torii] Exchange rate fetched: 1 USD = ${rate} JPY`);
      return rate;
    }
    throw new Error('Invalid rate data');
  } catch (err: any) {
    console.warn(`[Torii] Failed to fetch exchange rate: ${err.message}. Using fallback.`);
    const fallback = manualRate > 0 ? manualRate : DEFAULT_EXCHANGE_RATE;
    cachedExchangeRate = fallback;
    cachedExchangeRateTime = now;
    return fallback;
  }
}

/**
 * Anthropic エンドポイントは `/v1` が必要。ユーザーが `/v1` を省略した場合に自動補完する。
 */
function normalizeEndpoint(providerId: string, endpoint: string): string {
  const url = endpoint.replace(/\/+$/, ''); // 末尾スラッシュ除去
  if (providerId === 'anthropic' && !url.endsWith('/v1')) {
    return `${url}/v1`;
  }
  return url;
}

/**
 * 現在選択されているプロバイダーの情報を VS Code 設定と SecretStorage から取得
 * workspaceRoot が指定された場合は .pettal ファイルの設定を優先する
 */
function getProviderConfig(context: vscode.ExtensionContext, workspaceRoot?: string) {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const projectConfig = workspaceRoot ? loadPettalConfig(workspaceRoot) : null;

  const providerId = (projectConfig?.provider || config.get<ProviderId>(CONFIG_PROVIDER, DEFAULT_PROVIDER)) as ProviderId;
  const provider = PROVIDERS[providerId] || PROVIDERS[DEFAULT_PROVIDER];
  const monthlyBudget = config.get<number>(CONFIG_MONTHLY_BUDGET, DEFAULT_MONTHLY_BUDGET);

  const endpoint = normalizeEndpoint(providerId, config.get<string>(`${providerId}.endpoint`, provider.defaultEndpoint)!);
  const model = projectConfig?.model || config.get<string>(`${providerId}.model`, provider.defaultModel);
  const maxTokens = config.get<number>(`${providerId}.maxTokens`, DEFAULT_MAX_TOKENS);

  // メイン/サブモデル設定（.pettal優先）
  const mainProviderId = (projectConfig?.mainProvider || config.get<ProviderId>(CONFIG_MAIN_PROVIDER, providerId)) as ProviderId;
  // mainModel: torii.mainModel → mainProviderId固有モデル(torii.openrouter.model等) → デフォルトの順でフォールバック
  const mainProviderFallbackModel = mainProviderId && mainProviderId !== providerId
    ? config.get<string>(`${mainProviderId}.model`, PROVIDERS[mainProviderId]?.defaultModel || model)
    : model;
  const mainModel = projectConfig?.mainModel || config.get<string>(CONFIG_MAIN_MODEL, '') || mainProviderFallbackModel;
  const subProviderId = (projectConfig?.subProvider || config.get<ProviderId>(CONFIG_SUB_PROVIDER, 'ollama')) as ProviderId;
  const subModel = projectConfig?.subModel || config.get<string>(CONFIG_SUB_MODEL, PROVIDERS.ollama.defaultModel);

  // モデル別使用上限
  const modelLimits: ModelLimit[] = projectConfig?.modelLimits || config.get<ModelLimit[]>(CONFIG_MODEL_LIMITS, []);

  return { provider, providerId, endpoint, model, maxTokens, monthlyBudget, mainProviderId, mainModel, subProviderId, subModel, modelLimits, projectConfig };
}

/**
 * モデル使用上限チェック。上限を超えた場合はサブモデルへのフォールバック情報を返す
 */
async function checkModelLimit(
  workspaceId: string,
  modelId: string,
  modelLimits: ModelLimit[],
  subProviderId: ProviderId,
  subModel: string,
): Promise<{ shouldFallback: boolean; reason: string }> {
  const limit = modelLimits.find((l) => l.modelId === modelId);
  if (!limit) return { shouldFallback: false, reason: '' };

  const usage = await getModelUsageThisMonth(workspaceId, modelId);
  const modelName = Object.values(PROVIDERS).flatMap(p => p.models).find(m => m.id === modelId)?.name || modelId;
  const subModelName = Object.values(PROVIDERS).flatMap(p => p.models).find(m => m.id === subModel)?.name || subModel;

  if (limit.maxCallsPerMonth && usage.calls >= limit.maxCallsPerMonth) {
    return {
      shouldFallback: true,
      reason: `⚠️ ${modelName} の月間使用回数上限 (${limit.maxCallsPerMonth}回) に達しました。${subModelName} に切り替えました`,
    };
  }
  if (limit.maxCostUsdPerMonth && usage.costUsd >= limit.maxCostUsdPerMonth) {
    return {
      shouldFallback: true,
      reason: `⚠️ ${modelName} の月間コスト上限 ($${limit.maxCostUsdPerMonth.toFixed(2)}) に達しました。${subModelName} に切り替えました`,
    };
  }
  return { shouldFallback: false, reason: '' };
}

async function getBudgetState(
  workspaceId: string,
  budgetScope: string,
  monthlyBudget: number,
): Promise<{ currentCost: number; budgetPercent: number }> {
  if (monthlyBudget <= 0) {
    return { currentCost: 0, budgetPercent: 0 };
  }

  const currentCost = budgetScope === 'project'
    ? (await getMonthlyBudget(workspaceId))?.total_cost_usd || 0
    : (await getGlobalMonthlyBudget()).total_cost_usd;

  return {
    currentCost,
    budgetPercent: currentCost / monthlyBudget,
  };
}

// ── チャットメッセージ型（image_url対応） ──
interface ChatContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'auto' | 'low' | 'high' };
}

interface ChatMessage {
  role: string;
  content: string | ChatContentPart[];
}

/**
 * 添付ファイルを ChatContentPart に変換
 */
function buildContentParts(
  textContent: string,
  images: { data: string; mimeType: string }[],
): string | ChatContentPart[] {
  if (images.length === 0) {
    return textContent;
  }
  const parts: ChatContentPart[] = [
    { type: 'text', text: textContent },
    ...images.map((img) => ({
      type: 'image_url' as const,
      image_url: {
        url: `data:${img.mimeType};base64,${img.data}`,
        detail: 'auto' as const,
      },
    })),
  ];
  return parts;
}

function toRequestMessages(
  messages: { role: string; content: string | ChatContentPart[] }[],
  isMultimodal: boolean,
): { role: string; content: string | ChatContentPart[] }[] {
  return messages.map((m) => ({
    role: m.role,
    content: isMultimodal
      ? m.content
      : (typeof m.content === 'string'
          ? m.content
          : (m.content as ChatContentPart[]).filter((p) => p.type === 'text').map((p) => p.text || '').join('\n')),
  }));
}

function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimatePromptTokens(messages: { role: string; content: string | ChatContentPart[] }[]): number {
  const text = messages.map((m) => typeof m.content === 'string' ? m.content : (m.content as ChatContentPart[]).map((p) => p.text || '').join('\n')).join('\n');
  return estimateTokensFromText(text);
}

/**
 * OpenAI/DeepSeek 互換 API (Chat Completions) へのリクエスト
 * 画像（image_url）対応
 */
async function callOpenAICompatible(
  endpoint: string,
  chatPath: string,
  apiKey: string,
  authPrefix: string,
  model: string,
  maxTokens: number,
  messages: { role: string; content: string | ChatContentPart[] }[],
  isMultimodal: boolean,
) {
  const requestMessages = messages.map((m) => ({
    role: m.role,
    content: isMultimodal ? m.content : (typeof m.content === 'string' ? m.content : (m.content as ChatContentPart[]).filter(p => p.type === 'text').map(p => p.text || '').join('\n')),
  }));

  const response = await fetch(`${endpoint}${chatPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authPrefix ? `${authPrefix} ${apiKey}` : undefined,
    } as Record<string, string>,
    body: JSON.stringify({
      model,
      messages: requestMessages,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`API エラー (${response.status}): ${errBody}`);
  }

  const data: any = await response.json();
  const reply: string = data.choices?.[0]?.message?.content || '(No response)';
  const promptTokens: number = data.usage?.prompt_tokens || 0;
  const completionTokens: number = data.usage?.completion_tokens || 0;
  const tokensUsed: number = data.usage?.total_tokens || promptTokens + completionTokens;

  return { reply, tokensUsed, promptTokens, completionTokens };
}

async function callOpenAICompatibleStream(
  endpoint: string,
  chatPath: string,
  apiKey: string,
  authPrefix: string,
  model: string,
  maxTokens: number,
  messages: { role: string; content: string | ChatContentPart[] }[],
  isMultimodal: boolean,
  onDelta: (delta: string) => void,
) {
  const requestMessages = toRequestMessages(messages, isMultimodal);

  const response = await fetch(`${endpoint}${chatPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authPrefix ? `${authPrefix} ${apiKey}` : undefined,
    } as Record<string, string>,
    body: JSON.stringify({
      model,
      messages: requestMessages,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`API エラー (${response.status}): ${errBody}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return callOpenAICompatible(endpoint, chatPath, apiKey, authPrefix, model, maxTokens, messages, isMultimodal);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let reply = '';
  let usage: any = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const chunk = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      separatorIndex = buffer.indexOf('\n\n');

      const dataLine = chunk
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.startsWith('data: '));
      if (!dataLine) continue;
      const data = dataLine.slice(6).trim();
      if (!data || data === '[DONE]') continue;
      const parsed = JSON.parse(data);
      if (parsed.usage) usage = parsed.usage;
      const delta = parsed.choices?.[0]?.delta?.content || '';
      if (delta) {
        reply += delta;
        onDelta(delta);
      }
    }
  }

  if (buffer.trim()) {
    const lines = buffer.split('\n').map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (!data || data === '[DONE]') continue;
      const parsed = JSON.parse(data);
      if (parsed.usage) usage = parsed.usage;
      const delta = parsed.choices?.[0]?.delta?.content || '';
      if (delta) {
        reply += delta;
        onDelta(delta);
      }
    }
  }

  const promptTokens = usage?.prompt_tokens ?? estimatePromptTokens(requestMessages);
  const completionTokens = usage?.completion_tokens ?? estimateTokensFromText(reply);
  const tokensUsed = usage?.total_tokens ?? (promptTokens + completionTokens);

  return { reply, tokensUsed, promptTokens, completionTokens };
}

/**
 * Anthropic Messages API へのリクエスト
 * 画像（base64埋め込み）対応
 */
async function callAnthropic(
  endpoint: string,
  chatPath: string,
  apiKey: string,
  authPrefix: string,
  model: string,
  maxTokens: number,
  messages: { role: string; content: string | ChatContentPart[] }[],
  isMultimodal: boolean,
) {
  const systemMessages = messages.filter((m) => m.role === 'system');
  const systemContent = systemMessages.length > 0
    ? systemMessages.map((m) => typeof m.content === 'string' ? m.content : '').join('\n')
    : undefined;

  // Anthropic のメッセージロールは user / assistant のみ
  const anthropicMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      if (!isMultimodal || typeof m.content === 'string') {
        return { role: m.role, content: typeof m.content === 'string' ? m.content : '' };
      }
      // マルチモーダル: Anthropic形式に変換
      const parts = (m.content as ChatContentPart[]).map((part) => {
        if (part.type === 'text') {
          return { type: 'text', text: part.text || '' };
        }
        if (part.type === 'image_url' && part.image_url) {
          const url = part.image_url.url;
          const [header, b64] = url.split(';base64,');
          const mediaType = header.replace('data:', '');
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: b64,
            },
          };
        }
        return { type: 'text', text: '' };
      });
      return { role: m.role, content: parts };
    });

  const body: any = {
    model,
    max_tokens: maxTokens,
    messages: anthropicMessages,
  };
  if (systemContent) {
    body.system = systemContent;
  }

  const response = await fetch(`${endpoint}${chatPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [authPrefix]: apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`API エラー (${response.status}): ${errBody}`);
  }

  const data: any = await response.json();
  const reply: string = data.content?.[0]?.text || '(No response)';
  const promptTokens: number = data.usage?.input_tokens || 0;
  const completionTokens: number = data.usage?.output_tokens || 0;
  const tokensUsed: number = promptTokens + completionTokens;

  return { reply, tokensUsed, promptTokens, completionTokens };
}

/**
 * Google Gemini API へのリクエスト
 * チャット補完 + 画像（inline_data）対応
 */
async function callGemini(
  endpoint: string,
  model: string,
  apiKey: string,
  maxTokens: number,
  messages: { role: string; content: string | ChatContentPart[] }[],
): Promise<{ reply: string; tokensUsed: number; promptTokens: number; completionTokens: number }> {
  // Gemini の contents 形式に変換（role は "user" | "model"）
  const systemMessages = messages.filter((m) => m.role === 'system');
  const systemText = systemMessages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');

  const contents = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const role = m.role === 'assistant' ? 'model' : 'user';
      if (typeof m.content === 'string') {
        return { role, parts: [{ text: m.content }] };
      }
      const parts = (m.content as ChatContentPart[]).map((p) => {
        if (p.type === 'text') {
          return { text: p.text || '' };
        }
        if (p.type === 'image_url' && p.image_url) {
          const [header, data] = p.image_url.url.split(';base64,');
          const mimeType = header.replace('data:', '');
          return { inline_data: { mime_type: mimeType, data } };
        }
        return { text: '' };
      });
      return { role, parts };
    });

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens },
  };
  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }

  const url = `${endpoint}/models/${model}:generateContent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Gemini API エラー (${response.status}): ${errBody}`);
  }

  const data: any = await response.json();
  const reply: string = data.candidates?.[0]?.content?.parts?.[0]?.text || '(No response)';
  const promptTokens: number = data.usageMetadata?.promptTokenCount || 0;
  const completionTokens: number = data.usageMetadata?.candidatesTokenCount || 0;
  const tokensUsed: number = promptTokens + completionTokens;

  return { reply, tokensUsed, promptTokens, completionTokens };
}

/**
 * Gemini で画像のみを読み取りテキスト説明を返す（メインモデルへの橋渡し用）
 */
async function callGeminiForImages(
  endpoint: string,
  apiKey: string,
  userQuery: string,
  images: { data: string; mimeType: string }[],
): Promise<string> {
  const parts: unknown[] = [
    { text: `以下のスクリーンショット・画像の内容を詳細に説明してください。ユーザーの質問: "${userQuery}"\n\n画像に含まれるテキスト、UI要素、コード、図表をすべて正確に書き起こしてください。` },
    ...images.map((img) => ({
      inline_data: { mime_type: img.mimeType, data: img.data },
    })),
  ];

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { maxOutputTokens: 2048 },
  };

  const url = `${endpoint}/models/gemini-2.5-flash:generateContent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Gemini 画像読み取りエラー (${response.status}): ${errBody}`);
  }

  const data: any = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '(画像の説明を取得できませんでした)';
}

/**
 * Ollama Chat API へのリクエスト
 */
async function callOllama(
  endpoint: string,
  chatPath: string,
  model: string,
  messages: { role: string; content: string }[],
) {
  const ollamaMessages = messages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : '',
  }));

  const response = await fetch(`${endpoint}${chatPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: ollamaMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Ollama API エラー (${response.status}): ${errBody}`);
  }

  const data: any = await response.json();
  const reply: string = data.message?.content || '(No response)';
  // Ollama はトークン数を返さないことがあるため推定
  const promptTokens: number = data.prompt_eval_count || data.eval_count || 0;
  const completionTokens: number = data.eval_count || 0;
  const tokensUsed: number = promptTokens + completionTokens;

  return { reply, tokensUsed, promptTokens, completionTokens };
}

async function callOllamaStream(
  endpoint: string,
  chatPath: string,
  model: string,
  messages: { role: string; content: string }[],
  onDelta: (delta: string) => void,
) {
  const ollamaMessages = messages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : '',
  }));

  const response = await fetch(`${endpoint}${chatPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: ollamaMessages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Ollama API エラー (${response.status}): ${errBody}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return callOllama(endpoint, chatPath, model, messages);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let reply = '';
  let promptTokens = 0;
  let completionTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let lineEnd = buffer.indexOf('\n');
    while (lineEnd !== -1) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      lineEnd = buffer.indexOf('\n');
      if (!line) continue;
      const parsed = JSON.parse(line);
      if (typeof parsed.message?.content === 'string' && parsed.message.content) {
        reply += parsed.message.content;
        onDelta(parsed.message.content);
      }
      if (typeof parsed.prompt_eval_count === 'number') promptTokens = parsed.prompt_eval_count;
      if (typeof parsed.eval_count === 'number') completionTokens = parsed.eval_count;
      if (parsed.done) {
        if (!promptTokens && typeof parsed.prompt_eval_count === 'number') promptTokens = parsed.prompt_eval_count;
        if (!completionTokens && typeof parsed.eval_count === 'number') completionTokens = parsed.eval_count;
      }
    }
  }

  const tokensUsed = promptTokens + completionTokens || estimatePromptTokens(ollamaMessages as any) + estimateTokensFromText(reply);
  return { reply, tokensUsed, promptTokens, completionTokens };
}

/**
 * コスト計算（プロバイダー・モデル別）
 */
function resolveModelCost(
  providerId: ProviderId,
  modelId: string,
  promptTokens: number,
): { inputCostPer1M: number; outputCostPer1M: number } {
  if (providerId === 'openrouter') {
    const dynamicPricing = getOpenRouterPricing(modelId);
    if (dynamicPricing) {
      return {
        inputCostPer1M: dynamicPricing.inputCostPer1M,
        outputCostPer1M: dynamicPricing.outputCostPer1M,
      };
    }
  }

  const provider = PROVIDERS[providerId];
  if (!provider) {
    return { inputCostPer1M: 5, outputCostPer1M: 15 };
  }

  const model = provider.models.find((m) => m.id === modelId);
  if (!model) {
    return { inputCostPer1M: 5, outputCostPer1M: 15 };
  }

  if (providerId === 'gemini' && modelId === 'gemini-2.5-pro') {
    const isLongContext = promptTokens > 200_000;
    return isLongContext
      ? { inputCostPer1M: 2.50, outputCostPer1M: 15.00 }
      : { inputCostPer1M: 1.25, outputCostPer1M: 10.00 };
  }

  return {
    inputCostPer1M: model.inputCostPer1M,
    outputCostPer1M: model.outputCostPer1M,
  };
}

function calculateCost(
  providerId: ProviderId,
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const pricing = resolveModelCost(providerId, modelId, promptTokens);
  return (promptTokens / 1_000_000) * pricing.inputCostPer1M +
         (completionTokens / 1_000_000) * pricing.outputCostPer1M;
}

function resolveConfiguredModel(provider: ProviderDef, modelId: string): ModelDef {
  if (provider.id === 'openrouter') {
    const openRouterModel = getOpenRouterPricing(modelId);
    if (openRouterModel) {
      return {
        id: openRouterModel.id,
        name: openRouterModel.name,
        tier: openRouterModel.outputCostPer1M >= 10 ? 'opus' : openRouterModel.outputCostPer1M >= 2 ? 'pro' : 'flash',
        description: 'OpenRouter catalog model',
        supportsImages: openRouterModel.supportsImages,
        inputCostPer1M: openRouterModel.inputCostPer1M,
        outputCostPer1M: openRouterModel.outputCostPer1M,
      };
    }
  }

  return provider.models.find((m) => m.id === modelId) || {
    id: modelId,
    name: modelId,
    tier: 'pro',
    description: 'Custom configured model',
    supportsImages: false,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
  };
}

function resolveEscalationTarget(
  targetProviderId?: string,
  targetModelId?: string,
  targetTier?: string,
): { provider: ProviderDef; model: ModelDef; tier: string } | undefined {
  if (targetProviderId && targetModelId) {
    const provider = PROVIDERS[targetProviderId as ProviderId];
    if (provider) {
      const model = resolveConfiguredModel(provider, targetModelId);
      return { provider, model, tier: model.tier };
    }
  }

  const chain = PromptRouter.buildEscalationChain();
  if (targetTier === 'flash') return chain[1] || chain[0];
  if (targetTier === 'local') return chain[0];
  return chain[chain.length - 1];
}

/**
 * メッセージ冒頭からタスクタイトルを生成する
 * 句読点・改行で区切り、最大40文字
 */
function generateTaskTitle(message: string): string {
  const clean = message.replace(/\n+/g, ' ').trim();
  const match = clean.match(/^.{1,40}(?=[。．.!?！？\s]|$)/);
  return (match?.[0] || clean.slice(0, 40)).trim() || 'チャット';
}

/**
 * 応答から触ったファイルを推測（簡易版）
 */
function extractTouchedFiles(reply: string): string[] {
  const patterns = [
    // コードブロック内のファイルパス: ```typescript:src/file.ts  /  ```src/file.ts
    /```[\w]*(?::)?\s*([^\s`\n]+\.[\w]{1,10})\s*```/g,
    // 相対パス・絶対パス形式: src/..., webview/..., ./..., ../...
    /(?:^|\s)((?:\.{0,2}\/)?(?:src\/|webview\/|public\/|supabase\/|tests?\/|scripts\/|config\/|resources\/)[^\s"'`\n]*\.\w{1,10})/gm,
    // バッククォートで囲まれたファイル名: `src/file.ts`
    /`([^\s`]+\.[\w]{1,10})`/g,
    // ファイルパスらしき文字列（汎用）
    /(?:^|\s)((?:\.{0,2}\/)?[a-zA-Z0-9_\-/.]+\.(?:tsx?|jsx?|css|json|sql|html|md|yml|yaml|toml|xml|svg|env|config\.\w+))(?:[\s,;:\n]|$)/gm,
  ];
  const files = new Set<string>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(reply)) !== null) {
      const p = match[1].trim();
      // URLやhttpを除外、少なくとも1つのドットを含む
      if (p && !p.startsWith('http') && !p.startsWith('data:') && p.includes('.') && p.length > 2) {
        // 前後のクォートやバッククォートを除去
        const cleaned = p.replace(/^['"`]+|['"`]+$/g, '');
        if (cleaned.includes('.') && cleaned.length > 2) {
          files.add(cleaned);
        }
      }
    }
  }
  return [...files].slice(0, 10); // 最大10件
}

const CHAT_TOKEN_LIMITS: Record<string, number> = {
  'claude-opus': 180000,
  'claude-sonnet': 180000,
  'deepseek-chat': 60000,
  'deepseek-reasoner': 60000,
  'gpt-4o': 120000,
  'gpt-4o-mini': 120000,
  'gemini-2.5-flash': 1000000,
  'gemini-2.5-pro': 1000000,
  'default': 60000,
};

function trimHistory(
  history: { role: string; content: string }[],
  modelId: string,
): { role: string; content: string }[] {
  const key = Object.keys(CHAT_TOKEN_LIMITS).find(k => modelId.toLowerCase().includes(k));
  const limit = key ? CHAT_TOKEN_LIMITS[key] : CHAT_TOKEN_LIMITS['default'];
  // システムプロンプト・新メッセージ用に30%を確保
  const safeLimit = Math.floor(limit * 0.7);
  const estimateTokens = (msgs: { content: string }[]) =>
    Math.floor(msgs.reduce((s, m) => s + m.content.length, 0) / 4);

  const trimmed = [...history];
  while (estimateTokens(trimmed) > safeLimit && trimmed.length > 4) {
    trimmed.splice(0, 1);
  }
  return trimmed;
}

export async function startServer(context: vscode.ExtensionContext): Promise<{ port: number; token: string }> {
  const port = await portfinder.getPortPromise({ port: 8000, stopPort: 9000 });
  sessionToken = crypto.randomBytes(32).toString('hex');

  app = express();
  app.use(express.json({ limit: '30mb' })); // 画像 base64 (最大 10MB → ~13MB) を考慮したサイズ上限
  void refreshOpenRouterPricingCache();

  // セキュリティ: X-Torii-Token ヘッダーによる認証
  // 起動時に生成したランダムトークンを知っているのは Extension Host のみ
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next();
    if (req.headers['x-torii-token'] !== sessionToken) {
      res.status(403).json({ error: '不正なリクエスト元からのアクセスはブロックされました' });
      return;
    }
    next();
  });

  // POST /api/chat - AIにメッセージを送信
  app.post('/api/chat', async (req, res) => {
    const wantsStream = !!req.body.stream;
    const sendChatResponse = (payload: Record<string, unknown>, status = 200) => {
      if (wantsStream) {
        if (status >= 400) {
          res.write(`data: ${JSON.stringify({ type: 'error', data: payload })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ type: 'done', data: payload })}\n\n`);
        }
        res.end();
        return;
      }
      if (status >= 400) {
        res.status(status).json(payload);
      } else {
        res.json(payload);
      }
    };
    const sendChatDelta = (text: string) => {
      if (!wantsStream || !text) return;
      res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
    };

    if (wantsStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
    }

    try {
      const { message, workspaceId, images } = req.body;
      if (!message || !workspaceId) {
        res.status(400).json({ reply: '⚠️ message と workspaceId は必須です。', error: true });
        return;
      }

      // タスク未指定なら自動作成
      let taskId: string | null = req.body.taskId || null;
      let autoCreatedTaskId: string | null = null;
      if (!taskId) {
        const newTask = await createTask(workspaceId, generateTaskTitle(message));
        taskId = newTask.id;
        autoCreatedTaskId = newTask.id;
      }

      // コマンドガードでユーザーメッセージをチェック
      const guardResult = isCommandSafe(message);
      if (!guardResult.safe) {
        await saveChatMessage(workspaceId, taskId || null, 'system', guardResult.reason || 'Command blocked', 0, 0);
        sendChatResponse({ reply: `⚠️ この操作はブロックされました: ${guardResult.reason}`, blocked: true });
        return;
      }

      // プロバイダー設定を取得（毎回最新、.pettal優先）
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      const { providerId, model, maxTokens, monthlyBudget, mainProviderId, mainModel, subProviderId, subModel, modelLimits } = getProviderConfig(context, workspaceRoot);

      // 添付画像の処理
      let attachedImages: { data: string; mimeType: string }[] = (images || []).map((img: any) => ({
        data: img.data,
        mimeType: img.mimeType || 'image/png',
      }));

      // ── 予算情報の計算（スコープ設定に応じて project / global 切替）──
      const budgetScope = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<string>(CONFIG_BUDGET_SCOPE, DEFAULT_BUDGET_SCOPE);

      const { currentCost, budgetPercent } = await getBudgetState(workspaceId, budgetScope, monthlyBudget);
      if (monthlyBudget > 0 && currentCost >= monthlyBudget) {
        sendChatResponse({
          reply: `⚠️ 今月のAPI利用予算上限 ($${monthlyBudget.toFixed(2)}) に達しました。\n現在の使用額: $${currentCost.toFixed(2)}\n来月までお待ちいただくか、設定で予算上限を引き上げてください。`,
          budgetExceeded: true,
          totalCostThisMonth: currentCost,
        });
        return;
      }

      // ── メイン/サブモデル判定 ──
      let effectiveStartProviderId = mainProviderId || providerId;
      let effectiveStartModel = mainModel || model;
      let modelLimitWarning: string | undefined;
      let usedSubModel = false;

      const mainLimitCheck = await checkModelLimit(workspaceId, effectiveStartModel, modelLimits, subProviderId, subModel);
      if (mainLimitCheck.shouldFallback) {
        effectiveStartProviderId = subProviderId;
        effectiveStartModel = subModel;
        modelLimitWarning = mainLimitCheck.reason;
        usedSubModel = true;
      }

      // ── 自動ルーティング（PromptRouter）＋カスタムルール ──
      const autoRoutingEnabled = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<boolean>('autoRouting', true);

      const customRules = await loadCustomRules();

      const routeResult: RouteResult = PromptRouter.route(
        message,
        effectiveStartProviderId,
        effectiveStartModel,
        budgetPercent,
        attachedImages.length > 0,
        autoRoutingEnabled,
        customRules,
      );

      // ルーティング後にも対象モデルの上限チェック
      if (!usedSubModel) {
        const routedLimitCheck = await checkModelLimit(workspaceId, routeResult.modelId, modelLimits, subProviderId, subModel);
        if (routedLimitCheck.shouldFallback) {
          const subProviderDef = PROVIDERS[subProviderId];
          const subModelDef = subProviderDef?.models.find((m) => m.id === subModel) || subProviderDef?.models[0];
          if (subModelDef) {
            (routeResult as any).providerId = subProviderId;
            (routeResult as any).modelId = subModelDef.id;
            (routeResult as any).providerName = subProviderDef.name;
            (routeResult as any).modelName = subModelDef.name;
          }
          modelLimitWarning = routedLimitCheck.reason;
          usedSubModel = true;
        }
      }

      const effectiveProvider: ProviderDef = PROVIDERS[routeResult.providerId];
      const effectiveModel = routeResult.modelId;
      // ルーティング先プロバイダーのエンドポイントを取得（ベースプロバイダーのendpointは使わない）
      const config2 = vscode.workspace.getConfiguration(CONFIG_SECTION);
      const effectiveEndpointChat = normalizeEndpoint(routeResult.providerId, config2.get<string>(`${routeResult.providerId}.endpoint`, effectiveProvider.defaultEndpoint)!);

      // SecretStorage からAPIキーを取得（Ollama除く）
      const secrets = getSecretsManager(context);
      let apiKey: string | undefined = '';
      if (routeResult.providerId !== 'ollama') {
        apiKey = ((await secrets.get(effectiveProvider.secretKey)) || '').trim();
        if (!apiKey) {
          res.json({
            reply: `${effectiveProvider.name} のAPIキーが設定されていません。\n設定画面（⚙️）からAPIキーを登録してください。`,
            needApiKey: true,
          });
          return;
        }
      }

      // ── Gemini 画像前処理（メインモデルが画像非対応の場合や Gemini キーが設定済みの場合）──
      let geminiImageDesc: string | undefined;
      let processedMessage = message;
      if (attachedImages.length > 0) {
        const geminiKey = ((await secrets.get(PROVIDERS.gemini.secretKey)) || '').trim();
        const mainModelSupportsImages = IMAGE_SUPPORTED_MODELS.includes(effectiveModel);
        if (geminiKey && !mainModelSupportsImages) {
          // メインモデルが画像非対応 → Gemini で先に読み取り、テキスト説明をメインモデルに渡す
          try {
            const geminiEndpoint = vscode.workspace
              .getConfiguration(CONFIG_SECTION)
              .get<string>('gemini.endpoint', PROVIDERS.gemini.defaultEndpoint);
            geminiImageDesc = await callGeminiForImages(geminiEndpoint, geminiKey, message, attachedImages);
            processedMessage = `${message}\n\n[📷 画像の内容（Gemini 2.5 Flash による読み取り結果）]\n${geminiImageDesc}`;
            attachedImages = []; // メインモデルには画像を渡さない（テキスト説明に変換済み）
          } catch (geminiErr: any) {
            console.warn('[Torii] Gemini image read failed:', geminiErr.message);
            // Gemini 失敗時はそのまま続行（画像はメインモデルに渡せないが、テキストのみで応答）
          }
        }
      }

      // チャット履歴を取得（コンテキスト上限に合わせてトリム）
      const rawHistory = await getChatHistory(workspaceId, taskId || null);
      const history = trimHistory(rawHistory, effectiveModel);

      // 画像対応モデルかチェック
      const effectiveModelDef: ModelDef | undefined = effectiveProvider.models.find(
        (m) => m.id === effectiveModel,
      );
      const isMultimodal =
        IMAGE_SUPPORTED_MODELS.includes(effectiveModel) &&
        attachedImages.length > 0;

      // プロンプトメッセージを構築（Gemini前処理後は processedMessage、それ以外は元のメッセージ）
      const userContent = buildContentParts(processedMessage, attachedImages);

      // ワークスペース・エディタ情報をシステムプロンプトに注入
      const chatWorkspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      const chatProjectName = chatWorkspaceRoot ? path.basename(chatWorkspaceRoot) : 'プロジェクト';
      const chatTree = chatWorkspaceRoot ? buildWorkspaceTree(chatWorkspaceRoot) : '（ワークスペース未設定）';
      const chatActiveEditor = vscode.window.activeTextEditor;
      const chatEditorPath = chatActiveEditor?.document.uri.fsPath;
      const chatEditorContent = chatActiveEditor?.document.getText();
      let chatEditorSection = '';
      if (chatEditorPath && chatEditorContent && chatWorkspaceRoot) {
        const relPath = path.relative(chatWorkspaceRoot, chatEditorPath);
        chatEditorSection = `\n\n## 現在エディタで開いているファイル: ${relPath}\n\`\`\`\n${chatEditorContent.slice(0, 6000)}\n\`\`\``;
      }
      const chatSystemPrompt = `あなたはToriiです。VS Codeに統合されたAIコーディングアシスタントです。
使用プロバイダー: ${effectiveProvider.name} / モデル: ${effectiveModelDef?.name || effectiveModel}

プロジェクト名: ${chatProjectName}
ワークスペース: ${chatWorkspaceRoot || '（未設定）'}

ファイル構成（主要部分）:
${chatTree}${chatEditorSection}

ガイドライン:
- ユーザーが「このファイル」「この関数」と言った場合、上記の「現在エディタで開いているファイル」を参照してください
- コードの説明・レビュー・提案を日本語で行ってください
- チャットモードではファイルを直接変更しません。変更が必要な場合はエージェントモードを使うよう案内してください`;

      const messages: { role: string; content: string | ChatContentPart[] }[] = [
        {
          role: 'system',
          content: chatSystemPrompt,
        },
        ...history.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        { role: 'user', content: userContent },
      ];

      // ユーザーメッセージを保存（元のメッセージ + 画像サマリー）
      const originalImageCount = (images || []).length;
      const imageSummary = originalImageCount > 0
        ? geminiImageDesc
          ? ` [📷 ${originalImageCount}枚の画像 → Gemini 2.5 Flash で読み取り済み]`
          : ` [📷 ${originalImageCount}枚の画像添付]`
        : '';
      await saveChatMessage(workspaceId, taskId || null, 'user', message + imageSummary, 0, 0);

      // ── プロバイダーに応じたAPI呼び出し ──
      let reply: string;
      let tokensUsed: number;
      let promptTokens: number;
      let completionTokens: number;

      try {
        if (wantsStream && (routeResult.providerId === 'ollama' || routeResult.providerId === 'openai' || routeResult.providerId === 'deepseek' || routeResult.providerId === 'openrouter')) {
          if (routeResult.providerId === 'ollama') {
            ({ reply, tokensUsed, promptTokens, completionTokens } = await callOllamaStream(
              effectiveEndpointChat,
              effectiveProvider.chatPath,
              effectiveModel,
              messages as { role: string; content: string }[],
              sendChatDelta,
            ));
          } else {
            ({ reply, tokensUsed, promptTokens, completionTokens } = await callOpenAICompatibleStream(
              effectiveEndpointChat,
              effectiveProvider.chatPath,
              apiKey,
              effectiveProvider.authPrefix,
              effectiveModel,
              maxTokens,
              messages,
              isMultimodal,
              sendChatDelta,
            ));
          }
        } else if (routeResult.providerId === 'ollama') {
          ({ reply, tokensUsed, promptTokens, completionTokens } = await callOllama(
            effectiveEndpointChat,
            effectiveProvider.chatPath,
            effectiveModel,
            messages as { role: string; content: string }[],
          ));
        } else if (routeResult.providerId === 'anthropic') {
          ({ reply, tokensUsed, promptTokens, completionTokens } = await callAnthropic(
            effectiveEndpointChat,
            effectiveProvider.chatPath,
            apiKey,
            effectiveProvider.authPrefix || '',
            effectiveModel,
            maxTokens,
            messages,
            isMultimodal,
          ));
        } else if (routeResult.providerId === 'gemini') {
          ({ reply, tokensUsed, promptTokens, completionTokens } = await callGemini(
            effectiveEndpointChat,
            effectiveModel,
            apiKey,
            maxTokens,
            messages,
          ));
        } else {
          ({ reply, tokensUsed, promptTokens, completionTokens } = await callOpenAICompatible(
            effectiveEndpointChat,
            effectiveProvider.chatPath,
            apiKey,
            effectiveProvider.authPrefix,
            effectiveModel,
            maxTokens,
            messages,
            isMultimodal,
          ));
        }
      } catch (apiError: any) {
        const errorMessage = apiError.message || 'Unknown API error';
        // レスポンスボディ由来の長いエラーメッセージを500文字でトリム（APIキー等の混入防止）
        console.error(`[Torii] API error (${effectiveProvider.name}):`, errorMessage.slice(0, 500));

        if (errorMessage.includes('401') || errorMessage.includes('403')) {
          sendChatResponse({
            reply: `❌ ${effectiveProvider.name} APIキーが無効です。\n\n設定画面（⚙️）で正しいAPIキーを登録してください。\n\nエラー詳細: ${errorMessage}`,
            invalidApiKey: true,
            provider: routeResult.providerId,
            model: effectiveModel,
            providerName: effectiveProvider.name,
            modelName: effectiveModelDef?.name || effectiveModel,
          });
          return;
        }

        // Ollama接続失敗時のフォールバック提案
        if (routeResult.providerId === 'ollama') {
          sendChatResponse({
            reply: `❌ Ollama に接続できませんでした。\n\nOllamaが起動しているか確認してください。\n\n\`ollama serve\` で起動後、\`ollama pull ${effectiveModel}\` でモデルをダウンロードしてください。\n\nエラー詳細: ${errorMessage}`,
            error: true,
            provider: routeResult.providerId,
            model: effectiveModel,
            providerName: effectiveProvider.name,
            modelName: effectiveModelDef?.name || effectiveModel,
          });
          return;
        }

        sendChatResponse({
          reply: `❌ API リクエストエラー: ${errorMessage}`,
          error: true,
          provider: routeResult.providerId,
          model: effectiveModel,
          providerName: effectiveProvider.name,
          modelName: effectiveModelDef?.name || effectiveModel,
        }, 500);
        return;
      }

      // コスト計算
      const costUsd = calculateCost(routeResult.providerId, effectiveModel, promptTokens, completionTokens);
      
      // 為替レート取得 → JPY換算
      const exchangeRate = await getUsdToJpyRate();
      const costJpy = costUsd * exchangeRate;

      // 触ったファイルを推測
      const touchedFiles = extractTouchedFiles(reply);

      // アシスタントの返答を保存
      await saveChatMessage(
        workspaceId,
        taskId || null,
        'assistant',
        reply,
        tokensUsed,
        costUsd,
        costJpy,
        routeResult.providerId,
        effectiveModel,
        effectiveModelDef?.name || effectiveModel,
      );

      const { currentCost: totalCostThisMonth } = await getBudgetState(workspaceId, budgetScope, monthlyBudget);
      const totalCostThisMonthJpy = totalCostThisMonth * exchangeRate;

      sendChatResponse({
        reply,
        tokensUsed,
        costUsd,
        costJpy,
        exchangeRate,
        totalCostThisMonth,
        totalCostThisMonthJpy,
        provider: routeResult.providerId,
        model: effectiveModel,
        providerName: effectiveProvider.name,
        modelName: effectiveModelDef?.name || effectiveModel,
        budgetPercent: monthlyBudget > 0 ? (totalCostThisMonth / monthlyBudget) * 100 : 0,
        monthlyBudget,
        touchedFiles,
        routingReason: geminiImageDesc
          ? `📷 Gemini 2.5 Flash で画像を読み取り → ${effectiveProvider.name} (${effectiveModelDef?.name || effectiveModel}) で処理`
          : routeResult.reason || undefined,
        modelLimitWarning,
        usedSubModel,
        autoCreatedTaskId,
        taskId,
      });
    } catch (err: any) {
      console.error('[Torii] Chat error:', err instanceof Error ? err.message : String(err));
      sendChatResponse({ reply: `エラーが発生しました: ${err.message}`, error: true }, 500);
    }
  });

  // GET /api/config - VS Code 設定とシークレットの有無を返す
  app.get('/api/config', async (_req, res) => {
    try {
      const { provider, providerId, endpoint, model, maxTokens, monthlyBudget } = getProviderConfig(context);
      const secrets = getSecretsManager(context);

      // 為替レート
      const exchangeRate = await getUsdToJpyRate();

      // 自動ルーティング設定
      const autoRouting = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<boolean>('autoRouting', true);

      // 各プロバイダーのAPIキー有無を確認
      const keyStatus: Record<string, boolean> = {};
      for (const [id, def] of Object.entries(PROVIDERS)) {
        const key = await secrets.get(def.secretKey);
        keyStatus[id] = !!key;
      }

      res.json({
        provider: providerId,
        providers: Object.values(PROVIDERS).map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          hasKey: keyStatus[p.id] || false,
          models: p.models,
        })),
        endpoint,
        model,
        maxTokens,
        monthlyBudget,
        exchangeRate,
        autoRouting,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/agent - エージェントループ（SSE ストリーミング）
  app.post('/api/agent', async (req, res) => {
    const { message, workspaceId } = req.body;
    if (!message || !workspaceId) {
      res.status(400).json({ error: 'message と workspaceId は必須です' });
      return;
    }

    // タスク未指定ならライセンス確認後に自動作成
    let taskId: string | null = req.body.taskId || null;
    let autoCreatedTaskId: string | null = null;

    // SSE ヘッダー
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (event: AgentEvent) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    if (autoCreatedTaskId) {
      sendEvent({ type: 'task_created', taskId: autoCreatedTaskId });
    }

    const abortController = new AbortController();
    activeAgentControllers.set(taskId!, abortController);
    req.on('close', () => {
      abortController.abort();
      activeAgentControllers.delete(taskId!);
    });

    // サーバーサイドのライセンスチェック（フロントエンドチェックのバイパスを防止）
    try {
      const licenseStatus = await licenseManager.getStatus(context);
      if (licenseStatus !== 'valid' && licenseStatus !== 'grace' && licenseStatus !== 'trial') {
        sendEvent({ type: 'error', message: '⚠️ エージェントモードはProプランまたはPro体験期間中のみ使用できます。' });
        res.end();
        return;
      }
    } catch {
      // ライセンスチェック自体が失敗した場合は安全側（拒否）に倒す
      sendEvent({ type: 'error', message: 'ライセンス確認に失敗しました。VSCodeを再起動してください。' });
      res.end();
      return;
    }

    if (!taskId) {
      const newTask = await createTask(workspaceId, generateTaskTitle(message));
      taskId = newTask.id;
      autoCreatedTaskId = newTask.id;
      sendEvent({ type: 'task_created', taskId: autoCreatedTaskId });
    }

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      const {
        provider,
        providerId,
        endpoint: defaultEndpoint,
        model,
        maxTokens,
        monthlyBudget,
        mainProviderId,
        mainModel,
        subProviderId,
        subModel,
        modelLimits,
      } = getProviderConfig(context, workspaceRoot);
      const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
      const exchangeRate = await getUsdToJpyRate();
      const autoApplyFiles = config.get<boolean>(CONFIG_AUTO_APPLY_FILES, false);
      const budgetScope = config.get<string>(CONFIG_BUDGET_SCOPE, DEFAULT_BUDGET_SCOPE);
      const { currentCost, budgetPercent } = await getBudgetState(workspaceId, budgetScope, monthlyBudget);

      if (monthlyBudget > 0 && currentCost >= monthlyBudget) {
        sendEvent({
          type: 'error',
          message: `⚠️ 今月のAPI利用予算上限 ($${monthlyBudget.toFixed(2)}) に達しました。現在の使用額: $${currentCost.toFixed(2)}。`,
        });
        res.end();
        return;
      }

      // mainProvider/mainModel を優先してルーティングの起点とする（チャットモードと同様）
      let effectiveStartProviderId = mainProviderId || providerId;
      let effectiveStartModel = mainModel || model;
      let usedSubModel = false;

      const mainLimitCheck = await checkModelLimit(workspaceId, effectiveStartModel, modelLimits, subProviderId, subModel);
      if (mainLimitCheck.shouldFallback) {
        const subProviderDef = PROVIDERS[subProviderId];
        const subModelDef = subProviderDef?.models.find((m) => m.id === subModel) || subProviderDef?.models[0];
        if (subProviderDef && subModelDef) {
          effectiveStartProviderId = subProviderId;
          effectiveStartModel = subModelDef.id;
          usedSubModel = true;
        }
      }

      // ── 自動ルーティング（チャットモードと同様） ──
      const autoRoutingEnabled = config.get<boolean>('autoRouting', true);
      const customRules = await loadCustomRules();
      const routeResult: RouteResult = PromptRouter.route(
        message,
        effectiveStartProviderId,
        effectiveStartModel,
        budgetPercent,
        false,
        autoRoutingEnabled,
        customRules,
      );

      if (!usedSubModel) {
        const routedLimitCheck = await checkModelLimit(workspaceId, routeResult.modelId, modelLimits, subProviderId, subModel);
        if (routedLimitCheck.shouldFallback) {
          const subProviderDef = PROVIDERS[subProviderId];
          const subModelDef = subProviderDef?.models.find((m) => m.id === subModel) || subProviderDef?.models[0];
          if (subProviderDef && subModelDef) {
            (routeResult as any).providerId = subProviderId;
            (routeResult as any).modelId = subModelDef.id;
            (routeResult as any).providerName = subProviderDef.name;
            (routeResult as any).modelName = subModelDef.name;
            usedSubModel = true;
          }
        }
      }

      const effectiveProviderId = routeResult.providerId;
      const effectiveModel = routeResult.modelId;
      const effectiveProvider = PROVIDERS[effectiveProviderId];
      const effectiveEndpoint = normalizeEndpoint(effectiveProviderId, config.get<string>(`${effectiveProviderId}.endpoint`, effectiveProvider.defaultEndpoint)!);

      // モデル情報イベント（UIでバッジ表示に使用）
      sendEvent({
        type: 'model_info',
        providerId: effectiveProviderId,
        modelName: routeResult.modelName,
        isLocal: effectiveProviderId === 'ollama',
      });

      // プライバシーキーワード検知通知
      if (routeResult.reason.includes('プライバシー')) {
        sendEvent({
          type: 'privacy_notice',
          message: '🔒 個人情報または機密キーワードを検知しました。ローカルモデルで安全に処理します（クラウド未送信）。',
        });
      }

      const secrets = getSecretsManager(context);
      let apiKey = '';
      if (effectiveProviderId !== 'ollama') {
        apiKey = ((await secrets.get(effectiveProvider.secretKey)) || '').trim();
        if (!apiKey) {
          sendEvent({ type: 'error', message: `${effectiveProvider.name} のAPIキーが設定されていません。` });
          res.end();
          return;
        }
      }

      const history = await getChatHistory(workspaceId, taskId || null);

      // ユーザーメッセージを保存
      await saveChatMessage(workspaceId, taskId || null, 'user', message, 0, 0);

      // 現在開いているエディタのファイルを取得
      const activeEditor = vscode.window.activeTextEditor;
      const openEditorPath = activeEditor?.document.uri.fsPath;
      const openEditorContent = activeEditor?.document.getText();

      const result = await runAgentLoop({
        message,
        workspacePath: workspaceRoot || workspaceId,
        providerId: effectiveProviderId,
        endpoint: effectiveEndpoint,
        model: effectiveModel,
        apiKey,
        maxTokens,
        history,
        autoApplyFiles,
        exchangeRate,
        onEvent: sendEvent,
        openEditorPath,
        openEditorContent,
        signal: abortController.signal,
      });
      activeAgentControllers.delete(taskId!);

      // アシスタントの返答を保存
      await saveChatMessage(
        workspaceId,
        taskId || null,
        'assistant',
        result.reply,
        result.tokensUsed,
        result.costUsd,
        result.costJpy,
        effectiveProviderId,
        effectiveModel,
        effectiveProvider.models.find((m) => m.id === effectiveModel)?.name || effectiveModel,
      );
    } catch (err: any) {
      sendEvent({ type: 'error', message: err.message || 'エージェントループエラー' });
    }

    res.end();
  });

  // POST /api/agent/approve - エージェントの承認リクエストに応答
  app.post('/api/agent/approve', (req, res) => {
    const { id, approved } = req.body;
    if (!id) {
      res.status(400).json({ error: 'id は必須です' });
      return;
    }
    resolveApproval(id, !!approved);
    res.json({ ok: true });
  });

  // POST /api/agent/cancel - エージェントループを中断
  app.post('/api/agent/cancel', (req, res) => {
    const { taskId } = req.body as { taskId?: string };
    const ctrl = taskId ? activeAgentControllers.get(taskId) : null;
    if (ctrl) {
      ctrl.abort();
      activeAgentControllers.delete(taskId!);
    }
    res.json({ ok: !!ctrl });
  });

  // POST /api/file-change/undo - エージェントが適用したファイル変更を元に戻す
  app.post('/api/file-change/undo', async (req, res) => {
    try {
      const { undoId } = req.body as { undoId?: string };
      if (!undoId) {
        res.status(400).json({ error: 'undoId は必須です' });
        return;
      }
      const result = await undoFileCheckpoint(undoId);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || '元に戻せませんでした' });
    }
  });

  // GET /api/health - ヘルスチェック
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', port });
  });

  // ── ルーティングルール CRUD ──
  app.get('/api/routing-rules', async (_req, res) => {
    try {
      const rules = await getAllRules();
      res.json({ rules });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/routing-rules', async (req, res) => {
    try {
      const rule = req.body;
      if (!rule.keyword || !rule.targetProvider || !rule.targetModel) {
        res.status(400).json({ error: 'keyword, targetProvider, targetModel は必須です' });
        return;
      }
      const created = await addCustomRule({
        keyword: rule.keyword,
        category: rule.category || 'custom',
        targetProvider: rule.targetProvider,
        targetModel: rule.targetModel,
        reason: rule.reason || `🎯 カスタムルール: ${rule.keyword}`,
        enabled: rule.enabled !== false,
      });
      res.json({ rule: created });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/routing-rules/:id', async (req, res) => {
    try {
      await updateCustomRule(req.params.id, req.body);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/routing-rules/:id', async (req, res) => {
    try {
      await deleteCustomRule(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/model-usage - モデル別月間使用量
  app.get('/api/model-usage', async (req, res) => {
    try {
      const workspaceId = (req.query.workspaceId as string) || getCurrentWorkspaceId();
      const usageList = await getAllModelUsageThisMonth(workspaceId);
      res.json({ usage: usageList });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/chat/escalate - 上位モデルで直前メッセージを再試行
  app.post('/api/chat/escalate', async (req, res) => {
    try {
      const { workspaceId: reqWorkspaceId, taskId, targetTier, targetProviderId, targetModelId } = req.body;
      const workspaceId = reqWorkspaceId || getCurrentWorkspaceId();

      const targetEntry = resolveEscalationTarget(targetProviderId, targetModelId, targetTier);

      if (!targetEntry) {
        res.status(400).json({ error: 'エスカレーション先が見つかりません' });
        return;
      }

      const escalateProvider = targetEntry.provider;
      const escalateModel = targetEntry.model;

      const rawEscHistory = await getChatHistory(workspaceId, taskId || null);
      const history = trimHistory(rawEscHistory, escalateModel?.id ?? '');
      const lastUserMsg = [...history].reverse().find((m) => m.role === 'user');
      if (!lastUserMsg) {
        res.status(400).json({ error: '再試行するユーザーメッセージが見つかりません' });
        return;
      }

      const secrets = getSecretsManager(context);
      let apiKey = '';
      if (escalateProvider.id !== 'ollama') {
        apiKey = ((await secrets.get(escalateProvider.secretKey)) || '').trim();
        if (!apiKey) {
          res.json({ error: `${escalateProvider.name} のAPIキーが設定されていません` });
          return;
        }
      }

      const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
      const maxTokens = config.get<number>(`${escalateProvider.id}.maxTokens`, DEFAULT_MAX_TOKENS);
      const endpoint = normalizeEndpoint(
        escalateProvider.id,
        config.get<string>(`${escalateProvider.id}.endpoint`, escalateProvider.defaultEndpoint)!,
      );

      const messages: { role: string; content: string }[] = [
        { role: 'system', content: `You are Torii. Current: ${escalateProvider.name} (${escalateModel.name}).` },
        ...history.map((m) => ({ role: m.role, content: m.content })),
      ];

      let result: { reply: string; tokensUsed: number; promptTokens: number; completionTokens: number };
      if (escalateProvider.id === 'ollama') {
        result = await callOllama(endpoint, escalateProvider.chatPath, escalateModel.id, messages);
      } else if (escalateProvider.id === 'anthropic') {
        result = await callAnthropic(endpoint, escalateProvider.chatPath, apiKey, escalateProvider.authPrefix, escalateModel.id, maxTokens, messages, false);
      } else if (escalateProvider.id === 'gemini') {
        result = await callGemini(endpoint, escalateModel.id, apiKey, maxTokens, messages);
      } else {
        result = await callOpenAICompatible(endpoint, escalateProvider.chatPath, apiKey, escalateProvider.authPrefix, escalateModel.id, maxTokens, messages, false);
      }

      const exchangeRate = await getUsdToJpyRate();
      const costUsd = calculateCost(escalateProvider.id, escalateModel.id, result.promptTokens, result.completionTokens);
      const costJpy = costUsd * exchangeRate;

      await saveChatMessage(workspaceId, taskId || null, 'assistant', result.reply, result.tokensUsed, costUsd, costJpy, escalateProvider.id, escalateModel.id, escalateModel.name);

      res.json({
        reply: result.reply,
        tokensUsed: result.tokensUsed,
        costUsd,
        costJpy,
        provider: escalateProvider.id,
        model: escalateModel.id,
        providerName: escalateProvider.name,
        modelName: escalateModel.name,
        escalatedTier: targetEntry.tier,
        routingReason: `⬆️ ${escalateModel.name} (${targetEntry.tier}) で再実行しました`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET/POST /api/pettal-config - プロジェクト設定
  app.get('/api/pettal-config', (req, res) => {
    try {
      const root = (req.query.root as string) || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      const cfg = loadPettalConfig(root);
      res.json({ config: cfg, hasPettalFile: cfg !== null, workspaceRoot: root });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/pettal-config', (req, res) => {
    try {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      if (!root) {
        res.status(400).json({ error: 'ワークスペースが開かれていません' });
        return;
      }
      savePettalConfig(root, req.body);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/budget - 予算情報の取得（フロントエンド初期表示用）
  app.get('/api/budget', async (_req, res) => {
    try {
      const { monthlyBudget } = getProviderConfig(context);
      const budgetScope = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<string>(CONFIG_BUDGET_SCOPE, DEFAULT_BUDGET_SCOPE);
      const exchangeRate = await getUsdToJpyRate();

      const workspaceId = getCurrentWorkspaceId();
      const { currentCost: totalCostThisMonth } = await getBudgetState(workspaceId, budgetScope || DEFAULT_BUDGET_SCOPE, monthlyBudget);
      const totalCostThisMonthJpy = totalCostThisMonth * exchangeRate;

      res.json({
        monthlyBudget,
        totalCostThisMonth,
        totalCostThisMonthJpy,
        exchangeRate,
        budgetPercent: monthlyBudget > 0 ? (totalCostThisMonth / monthlyBudget) * 100 : 0,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return new Promise((resolve, reject) => {
    server = createServer(app!);
    server.listen(port, '127.0.0.1', () => {
      console.log(`[Torii] Server started on http://127.0.0.1:${port}`);
      resolve({ port, token: sessionToken });
    });
    server.on('error', reject);
  });
}

export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        console.log('[Torii] Server stopped');
        server = undefined;
        app = undefined;
        resolve();
      });
    } else {
      resolve();
    }
  });
}
