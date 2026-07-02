export const MAX_OPENROUTER_MODELS_RENDERED = 12;

export interface OpenRouterCatalogListItem {
  id: string;
  name: string;
}

export function getVisibleOpenRouterModels<T extends OpenRouterCatalogListItem>(
  models: T[],
  queryText: string,
): T[] {
  const query = queryText.trim().toLowerCase();
  const filtered = query
    ? models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(query))
    : models;

  return filtered.slice(0, MAX_OPENROUTER_MODELS_RENDERED);
}
