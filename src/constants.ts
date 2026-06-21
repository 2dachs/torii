// ── 拡張機能の基本情報 ──
export const EXTENSION_ID = 'torii';
export const EXTENSION_DISPLAY_NAME = 'Torii';
export const EXTENSION_DESCRIPTION = 'Japanese-first AI coding agent with cost transparency and local LLM routing';

// ── ライセンス ──
export type LicenseStatus = 'valid' | 'trial' | 'trial_expired' | 'free' | 'expired' | 'invalid' | 'grace';
export const LEMONSQUEEZY_CHECKOUT_URL = 'https://torii-dev.lemonsqueezy.com/checkout/buy/e01fc9a8-b44c-4664-92d7-21a0176170f7';
export const FREE_TRIAL_DAYS = 7;

// ── Views ──
export const VIEW_CONTAINER_ID = 'torii-panel';
export const VIEW_ID = 'torii-view';

// ── Configuration Keys ──
export const CONFIG_SECTION = 'torii';
export const CONFIG_SECTION_LEGACY = 'pettalPractitioner'; // マイグレーション用（旧名）
export const CONFIG_API_ENDPOINT = 'apiEndpoint';
export const CONFIG_MODEL = 'model';
export const CONFIG_MAX_TOKENS = 'maxTokens';
export const CONFIG_PROVIDER = 'provider';
export const CONFIG_MONTHLY_BUDGET = 'monthlyBudget';

// ── Provider Definitions ──
export type ProviderId = 'openai' | 'deepseek' | 'anthropic' | 'ollama' | 'gemini' | 'openrouter';

/** モデル定義 */
export interface ModelDef {
  id: string;
  name: string;
  /** tier: Flash=低コスト高速, Pro=高機能, Opus=最高品質 */
  tier: 'flash' | 'pro' | 'opus';
  description: string;
  /** 画像（マルチモーダル）対応 */
  supportsImages: boolean;
  /** 入力トークン 1M あたりのコスト (USD) */
  inputCostPer1M: number;
  /** 出力トークン 1M あたりのコスト (USD) */
  outputCostPer1M: number;
}

export interface ProviderDef {
  id: ProviderId;
  name: string;
  defaultEndpoint: string;
  defaultModel: string;
  secretKey: string;
  /** チャット補完に使う API パス（エンドポイントからの相対） */
  chatPath: string;
  /** Authorization ヘッダーのプレフィックス */
  authPrefix: string;
  /** 選択可能なモデル一覧 */
  models: ModelDef[];
  /** プロバイダーの説明（UI表示用） */
  description: string;
}

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    defaultEndpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    secretKey: 'torii.openaiApiKey',
    chatPath: '/chat/completions',
    authPrefix: 'Bearer',
    description: '高品質なマルチモーダル対応の汎用AI',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', tier: 'pro', description: 'マルチモーダル対応のフラッグシップモデル', supportsImages: true, inputCostPer1M: 2.50, outputCostPer1M: 10 },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', tier: 'flash', description: '低コスト・高速の軽量モデル', supportsImages: true, inputCostPer1M: 0.15, outputCostPer1M: 0.60 },
    ],
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    defaultEndpoint: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    secretKey: 'torii.deepseekApiKey',
    chatPath: '/chat/completions',
    authPrefix: 'Bearer',
    description: 'コスパ最強。日常コーディングに最適',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Flash', tier: 'flash', description: '高速・低コスト、日常コーディング向け', supportsImages: false, inputCostPer1M: 0.27, outputCostPer1M: 1.10 },
      { id: 'deepseek-reasoner', name: 'DeepSeek Pro', tier: 'pro', description: '高度な推論・設計・複雑な実装向け', supportsImages: false, inputCostPer1M: 0.55, outputCostPer1M: 2.19 },
    ],
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    defaultEndpoint: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-6',
    secretKey: 'torii.anthropicApiKey',
    chatPath: '/messages',
    authPrefix: 'x-api-key',
    description: 'コードレビュー・セキュリティ監査に強み',
    models: [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', tier: 'pro', description: 'バランスの取れた高性能モデル', supportsImages: true, inputCostPer1M: 3, outputCostPer1M: 15 },
      { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', tier: 'opus', description: 'セキュリティ・アーキテクチャ設計の最高峰', supportsImages: true, inputCostPer1M: 15, outputCostPer1M: 75 },
    ],
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (ローカル)',
    defaultEndpoint: 'http://localhost:11434',
    defaultModel: 'qwen2.5-coder',
    secretKey: 'torii.ollamaApiKey',
    chatPath: '/api/chat',
    authPrefix: '',
    description: '完全ローカル実行。APIキー不要・無料・プライバシー重視',
    models: [
      { id: 'qwen2.5-coder', name: 'Qwen 2.5 Coder', tier: 'flash', description: 'ローカル実行用コーディングモデル', supportsImages: false, inputCostPer1M: 0, outputCostPer1M: 0 },
    ],
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    secretKey: 'torii.geminiApiKey',
    chatPath: '/models/{model}:generateContent',
    authPrefix: 'x-goog-api-key',
    description: '画像読み取りに最適。スクリーンショットを他モデルに渡す橋渡し役として自動利用',
    models: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', tier: 'flash', description: '画像・マルチモーダル処理に最適 (自動橋渡し)', supportsImages: true, inputCostPer1M: 0.075, outputCostPer1M: 0.30 },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', tier: 'pro', description: '高精度マルチモーダル処理', supportsImages: true, inputCostPer1M: 1.25, outputCostPer1M: 5.00 },
    ],
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o',
    secretKey: 'torii.openrouterApiKey',
    chatPath: '/chat/completions',
    authPrefix: 'Bearer',
    description: '1つのAPIキーで GPT-4o・Claude・Llama 等を使い分けられるゲートウェイ。openrouter.ai でキー取得。',
    models: [],
  },
};

export const DEFAULT_PROVIDER: ProviderId = 'deepseek';
export const DEFAULT_MODEL = 'deepseek-chat';

/** 画像（マルチモーダル）入力に対応するモデルID一覧 */
export const IMAGE_SUPPORTED_MODELS: string[] = Object.values(PROVIDERS)
  .flatMap((p) => p.models)
  .filter((m) => m.supportsImages)
  .map((m) => m.id);

// ── Prompt Router 設定 ──
export const ROUTER_CONFIG = {
  /** 自動ルーティングを有効にするか */
  enabled: true,
  /** 予算残りがこの割合を下回ったら Ollama にフォールバック */
  budgetFallbackRatio: 0.05,
  /** プライバシー関連キーワード（検出時は Ollama へ） */
  privacyKeywords: [
    'api_key', 'api key', 'password', 'パスワード',
    'credential', '認証情報', '個人情報', '秘密鍵',
    'private key', 'access key', 'secret key',
    'マイナンバー', '社会保障番号', '生年月日', '住所',
  ],
  /** セキュリティ監査キーワード（検出時は Opus へ） */
  securityAuditKeywords: [
    'セキュリティ監査', '脆弱性', 'vulnerability', 'security audit',
    'penetration test', 'ペネトレーションテスト', 'SQLインジェクション',
    'XSS', 'CSRF', '認証バイパス', '暗号化', 'encryption',
  ],
  /** アーキテクチャ設計キーワード（検出時は Pro/Opus へ） */
  architectureKeywords: [
    'アーキテクチャ', 'architecture', '設計', 'design pattern',
    'デザインパターン', 'リファクタリング', 'refactoring',
    'マイクロサービス', 'microservice', 'スケーラビリティ',
    'システム設計', 'system design',
  ],
  /** シンプルタスクキーワード（検出時は Flash/Ollama へ） */
  simpleTaskKeywords: [
    'コメント', 'comment', 'テスト', 'test', 'フォーマット',
    'format', 'リント', 'lint', 'ドキュメント', 'documentation',
    '変数名', 'rename', 'タイポ', 'typo',
  ],
  /**
   * プライバシールーティングの除外ワード
   * これらが含まれるプロンプトはプライバシーキーワードにマッチしても Ollama に飛ばさない
   * プログラミングで頻出する変数名・用語を誤検知しないよう除外する
   */
  privacyKeywordExcludes: [
    'token',          // JWTトークン・アクセストークン変数で頻出
    'access token',   // OAuth認証フロー
    'refresh token',  // トークンリフレッシュ処理
    'auth token',     // 認証トークン
    'bearer',         // Bearer認証スキーム
    'jwt',            // JSON Web Token
  ],
} as const;
export const DEFAULT_MAX_TOKENS = 4096;
export const DEFAULT_MONTHLY_BUDGET = 10; // USD

// ── Exchange Rate (USD → JPY) ──
export const DEFAULT_EXCHANGE_RATE = 150; // デフォルト為替レート (JPY/USD)
export const EXCHANGE_RATE_CACHE_MS = 60 * 60 * 1000; // 1時間キャッシュ
export const CONFIG_EXCHANGE_RATE = 'exchangeRate'; // 手動設定レート
export const CONFIG_USE_AUTO_EXCHANGE_RATE = 'useAutoExchangeRate'; // 自動取得フラグ
export const EXCHANGE_RATE_API_URL = 'https://api.exchangerate-api.com/v4/latest/USD';

// ── Secrets (legacy) ──
export const SECRET_API_KEY = 'torii.apiKey';

// ── Message Commands (Extension Host ↔ Webview) ──
export const MSG_LOAD_TASKS = 'loadTasks';
export const MSG_LOAD_CHAT_HISTORY = 'loadChatHistory';
export const MSG_SEND_MESSAGE = 'sendMessage';
export const MSG_SAVE_SECRET = 'saveSecret';
export const MSG_GET_SECRET = 'getSecret';
export const MSG_UPDATE_BUDGET = 'updateBudget';
export const MSG_TERMINAL_EXEC = 'terminalExec';
export const MSG_SERVER_PORT = 'serverPort';
export const MSG_SETTINGS_CONFIG = 'settingsConfig';
export const MSG_CLEAR_HISTORY = 'clearHistory';
export const MSG_UPDATE_PROVIDER_CONFIG = 'updateProviderConfig';
export const MSG_RENAME_TASK = 'renameTask';
export const MSG_DELETE_TASK = 'deleteTask';
export const MSG_EDITOR_CONTENT = 'editorContent';
export const MSG_CREATE_TASK = 'createTask';
export const MSG_UPDATE_BUDGET_SCOPE = 'updateBudgetScope';
export const MSG_READ_FILES = 'readFiles';
export const MSG_WRITE_FILE = 'writeFile';
export const MSG_FILE_CONTENTS = 'fileContents';

// ── Budget Scope ──
export const CONFIG_BUDGET_SCOPE = 'budgetScope';
export type BudgetScope = 'global' | 'project';
export const DEFAULT_BUDGET_SCOPE: BudgetScope = 'global';

// ── Agent Mode ──
export const MSG_AGENT_APPROVE = 'agentApprove';
export const MSG_UNDO_FILE_CHANGE = 'undoFileChange';
export type AgentMode = 'chat' | 'agent';
export const CONFIG_AUTO_APPLY_FILES = 'autoApplyFileChanges';
export const CONFIG_COMMAND_ALLOWLIST = 'commandAllowlist';
export const DEFAULT_AGENT_MAX_ITERATIONS = 20;
export const SLASH_COMMANDS = ['agent', 'chat'] as const;

// ── Main / Sub Model Config ──
export const CONFIG_MAIN_PROVIDER = 'mainProvider';
export const CONFIG_MAIN_MODEL = 'mainModel';
export const CONFIG_SUB_PROVIDER = 'subProvider';
export const CONFIG_SUB_MODEL = 'subModel';
export const CONFIG_MODEL_LIMITS = 'modelLimits';
export const CONFIG_ESCALATION_ENABLED = 'escalationEnabled';
export const CONFIG_ESCALATE_PROVIDER_1 = 'escalateProvider1';
export const CONFIG_ESCALATE_MODEL_1 = 'escalateModel1';
export const CONFIG_ESCALATE_PROVIDER_2 = 'escalateProvider2';
export const CONFIG_ESCALATE_MODEL_2 = 'escalateModel2';
export const CONFIG_DISPLAY_CURRENCY = 'displayCurrency';

/** モデル別使用上限 */
export interface ModelLimit {
  modelId: string;
  maxCallsPerMonth?: number;
  maxCostUsdPerMonth?: number;
}

// ── New Message Commands ──
export const MSG_UPDATE_MODEL_CONFIG = 'updateModelConfig';
export const MSG_LOAD_ROUTING_RULES = 'loadRoutingRules';
export const MSG_SAVE_ROUTING_RULE = 'saveRoutingRule';
export const MSG_DELETE_ROUTING_RULE = 'deleteRoutingRule';
export const MSG_LOAD_PETTAL_CONFIG = 'loadPettalConfig';
export const MSG_SAVE_PETTAL_CONFIG = 'savePettalConfig';
export const MSG_GET_MODEL_USAGE = 'getModelUsage';
export const MSG_MODEL_USAGE_DATA = 'modelUsageData';
export const MSG_SETUP_OLLAMA = 'setupOllama';
export const MSG_OLLAMA_PROGRESS = 'ollamaProgress';
export const CONFIG_CUSTOM_PRIVACY_KEYWORDS = 'customPrivacyKeywords';

// ── ライセンス関連メッセージ ──
export const MSG_GET_LICENSE_STATUS = 'getLicenseStatus';
export const MSG_ACTIVATE_LICENSE = 'activateLicense';
export const MSG_LICENSE_STATUS = 'licenseStatus';
export const MSG_ESCALATE = 'escalate';
export const MSG_ESCALATE_RESPONSE = 'escalateResponse';
export const MSG_CANCEL_REQUEST = 'cancelRequest';
export const MSG_CANCEL_AGENT = 'cancelAgent';
