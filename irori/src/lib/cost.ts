import type { Mode, ModelConfig, RouteDecision } from '../types';

export function estimateTokens(text: string): number {
  if (!text.trim()) return 0;

  let estimate = 0;
  let asciiRun = 0;

  const flushAscii = () => {
    if (asciiRun > 0) {
      estimate += asciiRun / 4;
      asciiRun = 0;
    }
  };

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const isCjk =
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af);

    if (isCjk) {
      flushAscii();
      estimate += 1.25;
    } else if (/\s/.test(char)) {
      asciiRun += 1;
    } else {
      asciiRun += 1;
    }
  }

  flushAscii();
  return Math.max(1, Math.ceil(estimate));
}

export function estimateOutputTokens(inputTokens: number, contextWindow: number): number {
  const baseline = Math.max(256, Math.ceil(inputTokens * 0.6));
  const cap = Math.max(256, Math.floor(contextWindow * 0.2));
  return Math.min(baseline, cap);
}

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  inputPricePerMillionTokens: number,
  outputPricePerMillionTokens: number,
): number {
  const inputCost = (inputTokens / 1_000_000) * inputPricePerMillionTokens;
  const outputCost = (outputTokens / 1_000_000) * outputPricePerMillionTokens;
  return inputCost + outputCost;
}

export function routeMessage(args: {
  mode: Mode;
  text: string;
  modelConfigs: Record<Mode, ModelConfig>;
  perRunCostLimit: number;
  deepConfirmationEnabled: boolean;
}): RouteDecision {
  const selectedModel = args.modelConfigs[args.mode];
  const estimatedInputTokens = estimateTokens(args.text);
  const estimatedOutputTokens = estimateOutputTokens(estimatedInputTokens, selectedModel.contextWindow);
  const estimatedCost = calculateCost(
    estimatedInputTokens,
    estimatedOutputTokens,
    selectedModel.inputPricePerMillionTokens,
    selectedModel.outputPricePerMillionTokens,
  );
  const requiresConfirmation =
    (args.mode === 'deep' && args.deepConfirmationEnabled) ||
    estimatedCost > args.perRunCostLimit;

  let reason = 'モード設定に従って選択しました';
  if (args.mode === 'quick') reason = 'Quick モードなので低コストモデルを選択';
  if (args.mode === 'standard') reason = 'Standard モードなので標準モデルを選択';
  if (args.mode === 'deep') reason = 'Deep モードなので深い思考向けモデルを選択';
  if (estimatedCost > args.perRunCostLimit) reason += '。1回あたり上限コストを超える見込みです';

  return {
    mode: args.mode,
    selectedModel,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCost,
    requiresConfirmation,
    reason,
  };
}
