export const MAX_AGENT_EVENT_STRING_CHARS = 2_000;

export interface TruncatedString {
  text: string;
  truncated: boolean;
  originalLength: number;
}

export function truncateForAgentEvent(value: string, maxChars = MAX_AGENT_EVENT_STRING_CHARS): TruncatedString {
  if (value.length <= maxChars) {
    return { text: value, truncated: false, originalLength: value.length };
  }
  return {
    text: `${value.slice(0, maxChars)}\n\n[Torii: Webview安定化のため ${value.length - maxChars} 文字を省略しました]`,
    truncated: true,
    originalLength: value.length,
  };
}

export function sanitizeToolInputForAgentEvent(input: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      sanitized[key] = truncateForAgentEvent(value).text;
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function sanitizeToolOutputForAgentEvent(output: string): { output: string; outputTruncated: boolean; outputOriginalLength: number } {
  const truncated = truncateForAgentEvent(output);
  return {
    output: truncated.text,
    outputTruncated: truncated.truncated,
    outputOriginalLength: truncated.originalLength,
  };
}
