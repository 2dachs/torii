export const WARNING_THRESHOLD = 0.8;

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

export function estimateTokens(messages: { content: { type: string; text: string }[] }[]): number {
  const totalChars = messages.reduce((sum, m) =>
    sum + m.content.reduce((s, c) => s + (c.type === 'text' ? c.text.length : 0), 0), 0);
  return Math.floor(totalChars / 4);
}

export function getTokenLimit(modelId: string): number {
  const key = Object.keys(TOKEN_LIMITS).find(k => modelId.toLowerCase().includes(k));
  return key ? TOKEN_LIMITS[key] : TOKEN_LIMITS['default'];
}

export interface ContextWarning {
  message: string;
  currentTokens: number;
  tokenLimit: number;
  percent: number;
}

/** 上限の80%（WARNING_THRESHOLD）を超えた場合のみ警告を返す。超えていなければ null */
export function buildContextWarning(currentTokens: number, tokenLimit: number): ContextWarning | null {
  if (currentTokens <= tokenLimit * WARNING_THRESHOLD) return null;
  return {
    message: '⚠️ 会話が長くなっています。精度が下がる場合があります。新しいタスクの開始をお勧めします。',
    currentTokens,
    tokenLimit,
    percent: tokenLimit > 0 ? (currentTokens / tokenLimit) * 100 : 0,
  };
}
