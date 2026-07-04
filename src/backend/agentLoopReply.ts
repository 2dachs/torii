function normalizeReply(text: string): string {
  return text.trim();
}

function looksLikeCompletionSummary(text: string): boolean {
  return /完了|提示しました|実施しました|行いました|completed/i.test(text);
}

function looksLikeSubstantiveVisibleReply(text: string): boolean {
  return text.includes('\n') || /(^|\n)\s*(\d+\.|- |\* |#+\s)/.test(text);
}

export function chooseAgentLoopReply(outputText: string, fallbackReply: string, visibleAssistantText: string): string {
  const visible = normalizeReply(visibleAssistantText);
  const output = normalizeReply(outputText || fallbackReply);
  if (visible && output && looksLikeCompletionSummary(output) && looksLikeSubstantiveVisibleReply(visible)) return visible;
  if (visible && output && visible.length > output.length * 1.4) return visible;
  return output || visible || '(応答なし)';
}
