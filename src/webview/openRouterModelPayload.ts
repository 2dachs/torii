export const MAX_OPENROUTER_MODELS_FOR_WEBVIEW = 300;

interface RawOpenRouterModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  created?: unknown;
  architecture?: {
    input_modalities?: unknown;
  };
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
  };
}

interface WebviewOpenRouterModel {
  id: string;
  name: string;
  context_length?: number;
  created?: number;
  architecture?: {
    input_modalities?: string[];
  };
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function sanitizeOpenRouterModelsForWebview(raw: unknown): { data: WebviewOpenRouterModel[] } {
  const rawModels = Array.isArray((raw as any)?.data) ? (raw as any).data as RawOpenRouterModel[] : [];
  const data: WebviewOpenRouterModel[] = [];

  for (const model of rawModels) {
    if (typeof model.id !== 'string' || typeof model.name !== 'string') continue;
    data.push({
      id: model.id,
      name: model.name,
      context_length: optionalNumber(model.context_length),
      created: optionalNumber(model.created),
      architecture: {
        input_modalities: Array.isArray(model.architecture?.input_modalities)
          ? model.architecture.input_modalities.filter((item): item is string => typeof item === 'string')
          : [],
      },
      pricing: {
        prompt: optionalString(model.pricing?.prompt),
        completion: optionalString(model.pricing?.completion),
      },
    });
    if (data.length >= MAX_OPENROUTER_MODELS_FOR_WEBVIEW) break;
  }

  return { data };
}
