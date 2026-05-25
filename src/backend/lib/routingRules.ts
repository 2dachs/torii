import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { promises as fsp } from 'fs';
import { PROVIDERS, ROUTER_CONFIG, ProviderId } from '../../constants';
import { getStorageBasePath } from '../storage';

export interface RoutingRule {
  id: string;
  keyword: string;
  category: 'privacy' | 'security' | 'architecture' | 'simple' | 'custom';
  targetProvider: ProviderId;
  targetModel: string;
  reason: string;
  enabled: boolean;
  isBuiltin: boolean;
}

interface RoutingRulesFile {
  customRules: RoutingRule[];
}

function routingRulesFilePath(): string {
  return path.join(getStorageBasePath(), 'routing-rules.json');
}

export async function loadCustomRules(): Promise<RoutingRule[]> {
  try {
    const raw = await fsp.readFile(routingRulesFilePath(), 'utf-8');
    const file: RoutingRulesFile = JSON.parse(raw);
    return file.customRules || [];
  } catch {
    return [];
  }
}

async function saveCustomRules(rules: RoutingRule[]): Promise<void> {
  const file: RoutingRulesFile = { customRules: rules };
  const tmp = routingRulesFilePath() + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(file, null, 2), 'utf-8');
  await fsp.rename(tmp, routingRulesFilePath());
}

export function getBuiltinRules(): RoutingRule[] {
  const rules: RoutingRule[] = [];
  const opusModel = PROVIDERS.anthropic.models.find((m) => m.tier === 'opus');
  const flashModel = PROVIDERS.deepseek.models.find((m) => m.tier === 'flash');

  for (const kw of ROUTER_CONFIG.privacyKeywords) {
    rules.push({
      id: `builtin-privacy-${kw}`,
      keyword: kw,
      category: 'privacy',
      targetProvider: 'ollama',
      targetModel: PROVIDERS.ollama.defaultModel,
      reason: `🔒 プライバシーキーワードを検出。ローカル実行に切り替え`,
      enabled: true,
      isBuiltin: true,
    });
  }
  for (const kw of ROUTER_CONFIG.securityAuditKeywords) {
    rules.push({
      id: `builtin-security-${kw}`,
      keyword: kw,
      category: 'security',
      targetProvider: 'anthropic',
      targetModel: opusModel?.id || PROVIDERS.anthropic.defaultModel,
      reason: `🛡️ セキュリティ監査キーワードを検出。Claude Opusを選択`,
      enabled: true,
      isBuiltin: true,
    });
  }
  for (const kw of ROUTER_CONFIG.architectureKeywords) {
    rules.push({
      id: `builtin-architecture-${kw}`,
      keyword: kw,
      category: 'architecture',
      targetProvider: 'anthropic',
      targetModel: opusModel?.id || PROVIDERS.anthropic.defaultModel,
      reason: `🏗️ アーキテクチャ設計キーワードを検出。高性能モデルを選択`,
      enabled: true,
      isBuiltin: true,
    });
  }
  for (const kw of ROUTER_CONFIG.simpleTaskKeywords) {
    rules.push({
      id: `builtin-simple-${kw}`,
      keyword: kw,
      category: 'simple',
      targetProvider: 'deepseek',
      targetModel: flashModel?.id || PROVIDERS.deepseek.defaultModel,
      reason: `⚡ シンプルタスクキーワードを検出。低コストモデルを選択`,
      enabled: true,
      isBuiltin: true,
    });
  }
  return rules;
}

export async function getAllRules(): Promise<RoutingRule[]> {
  const custom = await loadCustomRules();
  const builtin = getBuiltinRules();
  return [...custom, ...builtin];
}

export async function addCustomRule(
  rule: Omit<RoutingRule, 'id' | 'isBuiltin'>,
): Promise<RoutingRule> {
  const custom = await loadCustomRules();
  const newRule: RoutingRule = { ...rule, id: uuidv4(), isBuiltin: false };
  custom.push(newRule);
  await saveCustomRules(custom);
  return newRule;
}

export async function updateCustomRule(id: string, updates: Partial<RoutingRule>): Promise<void> {
  const custom = await loadCustomRules();
  const idx = custom.findIndex((r) => r.id === id);
  if (idx !== -1) {
    custom[idx] = { ...custom[idx], ...updates, isBuiltin: false };
    await saveCustomRules(custom);
  }
}

export async function deleteCustomRule(id: string): Promise<void> {
  const custom = await loadCustomRules();
  await saveCustomRules(custom.filter((r) => r.id !== id));
}

/** カスタムルールをプロンプトに適用する（最初にマッチしたルールを返す） */
export function applyCustomRules(
  lowerPrompt: string,
  customRules: RoutingRule[],
): RoutingRule | null {
  for (const rule of customRules) {
    if (rule.enabled && lowerPrompt.includes(rule.keyword.toLowerCase())) {
      return rule;
    }
  }
  return null;
}
