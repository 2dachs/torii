export interface OpenRouterModelPricing {
  id: string;
  name: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
  supportsImages: boolean;
  created?: number;
}

type OpenRouterApiModel = {
  id?: string;
  name?: string;
  created?: number;
  architecture?: {
    input_modalities?: string[];
  };
  pricing?: {
    prompt?: string;
    completion?: string;
  };
};

type OpenRouterModelsResponse = {
  data?: OpenRouterApiModel[];
};

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

let cachedModels = new Map<string, OpenRouterModelPricing>();
let cachedAt = 0;
let refreshPromise: Promise<void> | null = null;

function parseUsdPerToken(value?: string): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return numeric * 1_000_000;
}

export async function refreshOpenRouterPricingCache(force = false): Promise<void> {
  const now = Date.now();
  if (!force && cachedModels.size > 0 && now - cachedAt < CACHE_TTL_MS) {
    return;
  }
  if (refreshPromise) {
    await refreshPromise;
    return;
  }

  refreshPromise = (async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(OPENROUTER_MODELS_URL, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status}`);
      }

      const data = await response.json() as OpenRouterModelsResponse;
      const models = Array.isArray(data.data) ? data.data : [];
      const next = new Map<string, OpenRouterModelPricing>();

      for (const model of models) {
        if (!model.id || !model.name) continue;
        const inputCostPer1M = parseUsdPerToken(model.pricing?.prompt);
        const outputCostPer1M = parseUsdPerToken(model.pricing?.completion);
        if (inputCostPer1M === undefined || outputCostPer1M === undefined) continue;
        next.set(model.id, {
          id: model.id,
          name: model.name,
          inputCostPer1M,
          outputCostPer1M,
          supportsImages: !!model.architecture?.input_modalities?.includes('image'),
          created: model.created,
        });
      }

      if (next.size > 0) {
        cachedModels = next;
        cachedAt = now;
      }
    } catch {
      // ネットワーク失敗時は既存キャッシュを維持し、静かにフォールバックする
    } finally {
      if (timeout) clearTimeout(timeout);
      refreshPromise = null;
    }
  })();

  await refreshPromise;
}

export function getOpenRouterPricing(modelId: string): OpenRouterModelPricing | undefined {
  return cachedModels.get(modelId);
}
