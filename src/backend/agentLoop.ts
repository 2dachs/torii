import { v4 as uuidv4 } from 'uuid';
import type { AgentRuntimeEvent } from '@cline/agents';
import { ProviderId } from '../constants';
import { ChatMessage } from './storage';
import { buildSystemPrompt, buildClineTools } from './tools';

// ── イベント型（Extension Host → Webview へ転送される） ──

export type AgentEvent =
  | { type: 'task_created'; taskId: string }
  | { type: 'thinking_start'; iteration: number }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; tool: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; tool: string; ok: boolean; output: string }
  | { type: 'approval_required'; id: string; tool: string; data: Record<string, unknown> }
  | { type: 'file_change_applied'; undoId: string; path: string; action: 'create' | 'update' }
  | { type: 'file_change_undone'; undoId: string; path: string; ok: boolean; message: string }
  | { type: 'privacy_notice'; message: string }
  | { type: 'context_warning'; message: string }
  | { type: 'model_info'; providerId: string; modelName: string; isLocal: boolean }
  | { type: 'done'; iterations: number; tokensUsed: number; costUsd: number; costJpy: number }
  | { type: 'error'; message: string };

export interface AgentParams {
  message: string;
  workspacePath: string;
  providerId: ProviderId;
  endpoint: string;
  model: string;
  apiKey: string;
  maxTokens: number;
  history: ChatMessage[];
  maxIterations?: number;
  autoApplyFiles: boolean;
  exchangeRate: number;
  onEvent: (e: AgentEvent) => void;
  openEditorPath?: string;
  openEditorContent?: string;
  signal?: AbortSignal;
}

export interface AgentResult {
  reply: string;
  tokensUsed: number;
  costUsd: number;
  costJpy: number;
  iterations: number;
}

// ── コンテキストウィンドウ管理 ──

const TOKEN_LIMITS: Record<string, number> = {
  'claude-opus': 180000,
  'claude-sonnet': 180000,
  'deepseek-chat': 60000,
  'deepseek-reasoner': 60000,
  'gpt-4o': 120000,
  'gpt-4o-mini': 120000,
  'gemini-2.5-flash': 1000000,
  'gemini-2.5-pro': 1000000,
  'gemini-1.5-pro': 1000000,
  'default': 60000,
};
const WARNING_THRESHOLD = 0.8;

function estimateTokens(messages: { content: { type: string; text: string }[] }[]): number {
  const totalChars = messages.reduce((sum, m) =>
    sum + m.content.reduce((s, c) => s + (c.type === 'text' ? c.text.length : 0), 0), 0);
  return Math.floor(totalChars / 4);
}

function getTokenLimit(modelId: string): number {
  const key = Object.keys(TOKEN_LIMITS).find(k => modelId.toLowerCase().includes(k));
  return key ? TOKEN_LIMITS[key] : TOKEN_LIMITS['default'];
}

// ── プロバイダー ID マッピング（Torii → Cline SDK） ──

const PROVIDER_ID_MAP: Record<ProviderId, string> = {
  anthropic: 'anthropic',
  openai: 'openai-native',
  deepseek: 'deepseek',
  ollama: 'ollama',
  gemini: 'gemini',
  openrouter: 'openrouter',
};

// ── <think> タグフィルター（DeepSeek 等の推論タグを非表示） ──

function makeThinkFilter(onEvent: (e: AgentEvent) => void) {
  let buffer = '';
  let inThink = false;

  const filter = (text: string) => {
    buffer += text;
    while (true) {
      if (!inThink) {
        const startIdx = buffer.indexOf('<think>');
        if (startIdx === -1) {
          const safe = buffer.length > 7 ? buffer.slice(0, buffer.length - 7) : '';
          if (safe) onEvent({ type: 'text_delta', text: safe });
          buffer = buffer.slice(safe.length);
          break;
        }
        if (startIdx > 0) onEvent({ type: 'text_delta', text: buffer.slice(0, startIdx) });
        inThink = true;
        buffer = buffer.slice(startIdx + 7);
      } else {
        const endIdx = buffer.indexOf('</think>');
        if (endIdx === -1) break;
        inThink = false;
        buffer = buffer.slice(endIdx + 8);
      }
    }
  };

  const flush = () => {
    if (buffer && !inThink) onEvent({ type: 'text_delta', text: buffer });
    buffer = '';
    inThink = false;
  };

  return { filter, flush };
}

// ── メインのエージェントループ（Cline SDK ベース） ──

export async function runAgentLoop(params: AgentParams): Promise<AgentResult> {
  const {
    message,
    workspacePath,
    providerId,
    endpoint,
    model,
    apiKey,
    maxTokens,
    history,
    maxIterations = 100,
    autoApplyFiles,
    exchangeRate,
    onEvent,
  } = params;

  // プロバイダー情報を通知
  const isLocal = providerId === 'ollama';
  onEvent({ type: 'model_info', providerId, modelName: model, isLocal });

  const { Agent } = await import('@cline/agents');
  const systemPrompt = await buildSystemPrompt(workspacePath, params.openEditorPath, params.openEditorContent);
  const tools = await buildClineTools(workspacePath, autoApplyFiles, onEvent);
  const { filter: filterThink, flush: flushThink } = makeThinkFilter(onEvent);

  // 会話履歴を SDK の AgentMessage 形式に変換
  const initialMessages = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      id: uuidv4(),
      role: m.role as 'user' | 'assistant',
      content: [{ type: 'text' as const, text: m.content }],
      createdAt: Date.now(),
    }));

  // ── コンテキストウィンドウ管理 ──
  const tokenLimit = getTokenLimit(model);
  // 上限の80%を超えていたら先に警告（削除前に通知することでユーザーが状況を把握できる）
  if (estimateTokens(initialMessages) > tokenLimit * WARNING_THRESHOLD) {
    onEvent({
      type: 'context_warning',
      message: '⚠️ 会話が長くなっています。精度が下がる場合があります。新しいタスクの開始をお勧めします。',
    });
  }
  // 上限超過時は古いメッセージを削除（先頭から削除、最低10件は残す）
  while (estimateTokens(initialMessages) > tokenLimit && initialMessages.length > 10) {
    initialMessages.splice(1, 1);
  }

  // カスタムエンドポイントの判定（デフォルトと異なる場合のみ baseUrl を渡す）
  const defaultBaseUrls: Partial<Record<string, string>> = {
    anthropic: 'https://api.anthropic.com',
    'openai-native': 'https://api.openai.com/v1',
    deepseek: 'https://api.deepseek.com/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1beta',
    ollama: 'http://localhost:11434',
    openrouter: 'https://openrouter.ai/api/v1',
  };
  const clineProviderId = PROVIDER_ID_MAP[providerId] ?? providerId;
  const defaultBase = defaultBaseUrls[clineProviderId] ?? '';
  const isCustomEndpoint = endpoint && endpoint !== defaultBase;

  let finalReply = '';
  let iterations = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;

  const agent = new Agent({
    providerId: clineProviderId,
    modelId: model,
    apiKey: apiKey || undefined,
    ...(isCustomEndpoint ? { baseUrl: endpoint } : {}),
    systemPrompt,
    tools,
    maxIterations,
    initialMessages,
    // 全ツールの SDK レベル承認をスキップ（承認は各ツールの execute 内で処理）
    toolPolicies: Object.fromEntries(tools.map((t) => [t.name, { autoApprove: true }])),
  });

  if (params.signal) {
    params.signal.addEventListener('abort', () => agent.abort(), { once: true });
  }

  agent.subscribe((event: AgentRuntimeEvent) => {
    switch (event.type) {
      case 'turn-started':
        iterations = event.iteration;
        onEvent({ type: 'thinking_start', iteration: event.iteration });
        break;

      case 'assistant-text-delta':
        filterThink(event.text);
        break;

      case 'assistant-message':
        flushThink();
        break;

      case 'tool-started':
        onEvent({
          type: 'tool_use',
          id: event.toolCall.toolCallId,
          tool: event.toolCall.toolName,
          input: event.toolCall.input as Record<string, unknown>,
        });
        break;

      case 'tool-finished': {
        const resultPart = (event.message.content as { type: string; output?: unknown; isError?: boolean }[]).find((p) => p.type === 'tool-result') as
          | { type: 'tool-result'; output: unknown; isError?: boolean }
          | undefined;
        const output = typeof resultPart?.output === 'string'
          ? resultPart.output
          : JSON.stringify(resultPart?.output ?? '');
        onEvent({
          type: 'tool_result',
          id: event.toolCall.toolCallId,
          tool: event.toolCall.toolName,
          ok: !resultPart?.isError,
          output,
        });
        break;
      }

      case 'usage-updated':
        totalInputTokens = event.usage.inputTokens;
        totalOutputTokens = event.usage.outputTokens;
        totalCostUsd = event.usage.totalCost ?? 0;
        break;

      case 'run-finished':
        finalReply = event.result.outputText;
        iterations = event.result.iterations;
        totalInputTokens = event.result.usage.inputTokens;
        totalOutputTokens = event.result.usage.outputTokens;
        totalCostUsd = event.result.usage.totalCost ?? 0;
        onEvent({
          type: 'done',
          iterations: event.result.iterations,
          tokensUsed: event.result.usage.inputTokens + event.result.usage.outputTokens,
          costUsd: totalCostUsd,
          costJpy: totalCostUsd * exchangeRate,
        });
        break;

      case 'run-failed':
        flushThink();
        onEvent({ type: 'error', message: buildAgentErrorMessage(event.error.message, providerId, model) });
        break;
    }
  });

  try {
    const result = await agent.run(message);
    return {
      reply: result.outputText || finalReply || '(応答なし)',
      tokensUsed: result.usage.inputTokens + result.usage.outputTokens,
      costUsd: result.usage.totalCost ?? totalCostUsd,
      costJpy: (result.usage.totalCost ?? totalCostUsd) * exchangeRate,
      iterations: result.iterations || iterations,
    };
  } catch (err: any) {
    flushThink();
    if (params.signal?.aborted) {
      return {
        reply: '(キャンセルされました)',
        tokensUsed: totalInputTokens + totalOutputTokens,
        costUsd: totalCostUsd,
        costJpy: totalCostUsd * exchangeRate,
        iterations,
      };
    }
    const errMsg = buildAgentErrorMessage(err.message || '不明なエラー', providerId, model);
    onEvent({ type: 'error', message: errMsg });
    return {
      reply: `❌ エラー: ${errMsg}`,
      tokensUsed: totalInputTokens + totalOutputTokens,
      costUsd: totalCostUsd,
      costJpy: totalCostUsd * exchangeRate,
      iterations,
    };
  }
}

/** エージェントエラーを人間可読なメッセージに変換する */
function buildAgentErrorMessage(rawMessage: string, providerId: string, model: string): string {
  if (providerId === 'ollama') {
    const lc = rawMessage.toLowerCase();
    if (
      lc.includes('tool') ||
      lc.includes('function call') ||
      lc.includes('does not support') ||
      lc.includes('400')
    ) {
      return `Ollama モデル「${model}」はtool callingに対応していないため、エージェントモードを使用できません。\n\n対応モデルに切り替えてください（例: llama3.1、qwen2.5-coder、mistral-nemo 等）。\n設定（⚙️）→ サブモデルでモデルを変更できます。\n\n元のエラー: ${rawMessage}`;
    }
    if (lc.includes('connect') || lc.includes('econnrefused') || lc.includes('fetch')) {
      return `Ollama に接続できません。\`ollama serve\` で起動後、再度お試しください。\n\n元のエラー: ${rawMessage}`;
    }
  }
  return rawMessage;
}
