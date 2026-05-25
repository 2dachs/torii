import * as vscode from 'vscode';
import {
  PROVIDERS,
  ROUTER_CONFIG,
  IMAGE_SUPPORTED_MODELS,
  CONFIG_SECTION,
  CONFIG_CUSTOM_PRIVACY_KEYWORDS,
  type ProviderDef,
  type ModelDef,
  type ProviderId,
} from '../../constants';
import type { RoutingRule } from './routingRules';

/** ルーティング結果 */
export interface RouteResult {
  providerId: ProviderId;
  modelId: string;
  providerName: string;
  modelName: string;
  /** ルーティング理由 (ユーザー表示用) */
  reason: string;
}

/**
 * PromptRouter - プロンプト内容に応じて最適なプロバイダー・モデルを選択する
 *
 * ルーティングロジック:
 * 1. 添付画像がある → 画像対応モデル (GPT-4o, Claude等) へ
 * 2. プライバシー関連キーワード → Ollama (ローカル) へ
 * 3. セキュリティ監査キーワード → Claude Opus へ
 * 4. アーキテクチャ設計キーワード → 現在のプロバイダーのProモデル へ
 * 5. シンプルタスクキーワード → 現在のプロバイダーのFlashモデル へ
 * 6. 予算残りが閾値以下 → Ollama へフォールバック
 * 7. それ以外 → デフォルト設定を維持
 */
export class PromptRouter {
  /**
   * プロンプトを解析して最適なプロバイダー・モデルを返す
   * @param prompt ユーザーの入力テキスト
   * @param currentProviderId 現在のデフォルトプロバイダーID
   * @param currentModelId 現在のデフォルトモデルID
   * @param budgetPercent 予算使用率 (0-1)
   * @param hasImages 添付画像があるか
   * @param autoRoutingEnabled 自動ルーティングが有効か
   */
  static route(
    prompt: string,
    currentProviderId: ProviderId,
    currentModelId: string,
    budgetPercent: number,
    hasImages: boolean,
    autoRoutingEnabled: boolean,
    customRules?: RoutingRule[],
  ): RouteResult {
    const currentProvider: ProviderDef = PROVIDERS[currentProviderId];
    const currentModel: ModelDef | undefined = currentProvider.models.find(
      (m) => m.id === currentModelId,
    );

    // デフォルトの結果（変更なし）
    const defaultResult: RouteResult = {
      providerId: currentProviderId,
      modelId: currentModelId,
      providerName: currentProvider.name,
      modelName: currentModel?.name ?? currentModelId,
      reason: '',
    };

    if (!autoRoutingEnabled) {
      return defaultResult;
    }

    const lowerPrompt = prompt.toLowerCase();

    // ── 0. カスタムルール（ユーザー定義、最優先） ──
    if (customRules && customRules.length > 0) {
      for (const rule of customRules) {
        if (rule.enabled && lowerPrompt.includes(rule.keyword.toLowerCase())) {
          const target = PROVIDERS[rule.targetProvider as ProviderId];
          if (target) {
            const targetModel = target.models.find((m) => m.id === rule.targetModel) || target.models[0];
            if (targetModel) {
              return {
                providerId: rule.targetProvider as ProviderId,
                modelId: targetModel.id,
                providerName: target.name,
                modelName: targetModel.name,
                reason: rule.reason || `🎯 カスタムルール「${rule.keyword}」を検出`,
              };
            }
          }
        }
      }
    }

    // ── 1. 添付画像がある → 画像対応モデル ──
    if (hasImages) {
      const imageProvider = PromptRouter.findImageCapableProvider(currentProviderId);
      if (imageProvider) {
        return {
          providerId: imageProvider.provider.id,
          modelId: imageProvider.model.id,
          providerName: imageProvider.provider.name,
          modelName: imageProvider.model.name,
          reason: '📷 画像添付を検出。マルチモーダル対応モデルを選択しました',
        };
      }
    }

    // ── 2. プライバシー関連キーワード → Ollama ──
    const customPrivacyKeywords = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<string[]>(CONFIG_CUSTOM_PRIVACY_KEYWORDS, []);
    const allPrivacyKeywords = [...ROUTER_CONFIG.privacyKeywords, ...customPrivacyKeywords];
    // 除外ワードが含まれる場合はプライバシールーティングをスキップ（token等のプログラミング用語誤検知防止）
    const hasExcludedTerm = ROUTER_CONFIG.privacyKeywordExcludes.some(
      (ex) => lowerPrompt.includes(ex.toLowerCase()),
    );
    if (!hasExcludedTerm && PromptRouter.matchesAny(lowerPrompt, allPrivacyKeywords)) {
      const ollama = PROVIDERS.ollama;
      const ollamaModel = ollama.models[0];
      if (ollamaModel) {
        return {
          providerId: 'ollama',
          modelId: ollamaModel.id,
          providerName: ollama.name,
          modelName: ollamaModel.name,
          reason: '🔒 プライバシー関連のキーワードを検出。ローカル実行 (Ollama) に切り替えました',
        };
      }
    }

    // ── 3. セキュリティ監査キーワード → Claude Opus ──
    if (PromptRouter.matchesAny(lowerPrompt, ROUTER_CONFIG.securityAuditKeywords)) {
      const opusModel = PROVIDERS.anthropic.models.find((m) => m.tier === 'opus');
      if (opusModel) {
        return {
          providerId: 'anthropic',
          modelId: opusModel.id,
          providerName: PROVIDERS.anthropic.name,
          modelName: opusModel.name,
          reason: '🛡️ セキュリティ監査キーワードを検出。Claude Opus (最高峰) を選択しました',
        };
      }
    }

    // ── 4. アーキテクチャ設計キーワード → Pro モデル ──
    if (PromptRouter.matchesAny(lowerPrompt, ROUTER_CONFIG.architectureKeywords)) {
      const proModel = currentProvider.models.find(
        (m) => m.tier === 'pro' || m.tier === 'opus',
      );
      if (proModel && proModel.id !== currentModelId) {
        return {
          providerId: currentProviderId,
          modelId: proModel.id,
          providerName: currentProvider.name,
          modelName: proModel.name,
          reason: `🏗️ アーキテクチャ設計キーワードを検出。${proModel.name} にアップグレードしました`,
        };
      }
    }

    // ── 5. シンプルタスク → Flash モデル ──
    if (PromptRouter.matchesAny(lowerPrompt, ROUTER_CONFIG.simpleTaskKeywords)) {
      const flashModel = currentProvider.models.find((m) => m.tier === 'flash');
      if (flashModel && flashModel.id !== currentModelId) {
        return {
          providerId: currentProviderId,
          modelId: flashModel.id,
          providerName: currentProvider.name,
          modelName: flashModel.name,
          reason: `⚡ シンプルタスクを検出。低コストの ${flashModel.name} を選択しました`,
        };
      }
    }

    // ── 6. 予算残りが閾値以下 → Ollama へフォールバック ──
    if (budgetPercent >= 1 - ROUTER_CONFIG.budgetFallbackRatio) {
      const ollama = PROVIDERS.ollama;
      const ollamaModel = ollama.models[0];
      if (ollamaModel && currentProviderId !== 'ollama') {
        return {
          providerId: 'ollama',
          modelId: ollamaModel.id,
          providerName: ollama.name,
          modelName: ollamaModel.name,
          reason: `💰 月間予算の ${Math.round(budgetPercent * 100)}% を使用。Ollama (無料) にフォールバックしました`,
        };
      }
    }

    // ── 7. デフォルトのまま ──
    return defaultResult;
  }

  /**
   * コスト昇順の3段エスカレーションチェーンを生成する
   * Tier1: 無料（Ollama）, Tier2: Flash, Tier3: Pro/Opus
   */
  static buildEscalationChain(): Array<{ provider: ProviderDef; model: ModelDef; tier: string }> {
    const allModels: Array<{ provider: ProviderDef; model: ModelDef; totalCost: number }> = [];
    for (const provider of Object.values(PROVIDERS)) {
      for (const model of provider.models) {
        allModels.push({
          provider,
          model,
          totalCost: model.inputCostPer1M + model.outputCostPer1M,
        });
      }
    }
    allModels.sort((a, b) => a.totalCost - b.totalCost);

    const tier1 = allModels[0];
    const flashModels = allModels.filter((m) => m.model.tier === 'flash' && m.totalCost > 0);
    const tier2 = flashModels[0] || allModels[1];
    const opusModels = allModels.filter((m) => m.model.tier === 'opus' || m.model.tier === 'pro');
    const tier3 = opusModels[opusModels.length - 1] || allModels[allModels.length - 1];

    const chain: Array<{ provider: ProviderDef; model: ModelDef; tier: string }> = [];
    if (tier1) chain.push({ ...tier1, tier: 'local' });
    if (tier2 && tier2.model.id !== tier1?.model.id) chain.push({ ...tier2, tier: 'flash' });
    if (tier3 && tier3.model.id !== tier2?.model.id && tier3.model.id !== tier1?.model.id) {
      chain.push({ ...tier3, tier: 'opus' });
    }
    return chain;
  }

  /** キーワード配列のいずれかがテキストに含まれているか */
  static matchesAny(lowerText: string, keywords: readonly string[]): boolean {
    return keywords.some((kw) => lowerText.includes(kw));
  }

  /** 画像対応可能なプロバイダーとモデルを探す */
  private static findImageCapableProvider(
    preferredProviderId: ProviderId,
  ): { provider: ProviderDef; model: ModelDef } | null {
    // まず現在のプロバイダー内で画像対応モデルを探す
    const preferred = PROVIDERS[preferredProviderId];
    const imageModel = preferred.models.find((m) =>
      IMAGE_SUPPORTED_MODELS.includes(m.id),
    );
    if (imageModel) {
      return { provider: preferred, model: imageModel };
    }

    // 現在のプロバイダーが画像非対応の場合は null を返す。
    // server.ts 側の Gemini 橋渡しロジックに委ねる（API キー不明なプロバイダーへの
    // 誤ルーティングを防ぐ）。
    return null;
  }
}