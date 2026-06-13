/** VS Code Webview との通信で受け取る Task */
export interface Task {
  id: string;
  workspace_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

/** チャットメッセージ */
export interface ChatMessage {
  id: string;
  workspace_id: string;
  task_id: string | null;
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  tokens_used: number;
  cost_usd: number;
  cost_jpy: number;
  created_at: string;
  /** 応答に使用されたプロバイダー */
  providerId?: string;
  /** 応答に使用されたモデルID */
  model?: string;
  /** 応答に使用されたモデル表示名 */
  modelName?: string;
  /** 処理中に触ったファイル一覧 (server側から返却) */
  touchedFiles?: string[];
  /** 画像処理・ルーティングの理由（Gemini経由など）*/
  routingReason?: string;
  /** 添付画像のプレビュー（送信メッセージ側・UIのみ） */
  imagePreviews?: Array<{ data: string; mimeType: string; name: string }>;
}

/** モデル定義 (constants.ts と同期) */
export interface ModelDef {
  id: string;
  name: string;
  tier: 'flash' | 'pro' | 'opus';
  description: string;
  supportsImages: boolean;
  /** 入力トークン 1M あたりのコスト (USD) */
  inputCostPer1M: number;
  /** 出力トークン 1M あたりのコスト (USD) */
  outputCostPer1M: number;
}

/** 添付ファイル */
export interface Attachment {
  /** 'image' | 'text' */
  type: 'image' | 'text';
  /** base64データ (type=image) または テキスト内容 (type=text) */
  data: string;
  /** ファイル名 */
  name: string;
  /** MIMEタイプ (type=imageの場合) */
  mimeType?: string;
}

/** 処理状態（ルーティング情報含む） */
export interface ProcessingStatus {
  /** 選択されたプロバイダーID */
  providerId: string;
  /** 選択されたモデルID */
  model: string;
  /** 表示用プロバイダー名 */
  providerName: string;
  /** 表示用モデル名 */
  modelName: string;
  /** ルーティング理由 (自動ルーティング時のみ) */
  routingReason?: string;
  /** 処理中かどうか */
  loading: boolean;
  /** 触ったファイル一覧 (処理中・処理後に更新) */
  touchedFiles: string[];
  /** 進捗テキスト */
  progressText: string;
}

/** /api/chat からのレスポンス */
export interface ApiResponse {
  reply: string;
  blocked?: boolean;
  needApiKey?: boolean;
  invalidApiKey?: boolean;
  budgetExceeded?: boolean;
  provider?: string;
  model?: string;
  tokensUsed?: number;
  costUsd?: number;
  costJpy?: number;
  exchangeRate?: number;
  autoCreatedTaskId?: string;
  totalCostThisMonth?: number;
  totalCostThisMonthJpy?: number;
  monthlyBudget?: number;
  budgetPercent?: number;
  /** 処理中に触ったファイル一覧 */
  touchedFiles?: string[];
  /** ルーティング情報 */
  routingReason?: string;
  providerName?: string;
  modelName?: string;
  /** モデル上限フォールバック警告 */
  modelLimitWarning?: string;
  usedSubModel?: boolean;
  /** エスカレーション情報 */
  escalatedTier?: string;
}

/** プロバイダー設定（WebView 側） */
export interface ProviderSettings {
  id: string;
  name: string;
  description?: string;
  hasKey: boolean;
  apiKey: string;
  endpoint: string;
  model: string;
  maxTokens: number;
  /** 選択可能なモデル一覧 */
  models: ModelDef[];
  /** OpenRouter 用: 保存済みモデルスロット（最大3件） */
  modelSlots?: string[];
}

/** ルーティングルール */
export interface RoutingRule {
  id: string;
  keyword: string;
  category: 'privacy' | 'security' | 'architecture' | 'simple' | 'custom';
  targetProvider: string;
  targetModel: string;
  reason: string;
  enabled: boolean;
  isBuiltin: boolean;
}

/** モデル別使用上限 */
export interface ModelLimit {
  modelId: string;
  maxCallsPerMonth?: number;
  maxCostUsdPerMonth?: number;
}

/** セッション内モデル別統計 */
export interface SessionModelStat {
  modelId: string;
  modelName: string;
  providerId: string;
  providerName: string;
  calls: number;
  costUsd: number;
  costJpy: number;
}

/** プロジェクト設定 (.pettal) */
export interface PettalProjectConfig {
  version?: number;
  provider?: string;
  model?: string;
  mainProvider?: string;
  mainModel?: string;
  subProvider?: string;
  subModel?: string;
  autoRouting?: boolean;
  routingRules?: Array<{ keyword: string; targetProvider: string; targetModel: string; reason: string }>;
  modelLimits?: ModelLimit[];
}

/** /api/config からのレスポンス */
export interface ServerConfig {
  provider: string;
  providers: { id: string; name: string; description: string; hasKey: boolean; models: ModelDef[]; endpoint?: string; model?: string; maxTokens?: number; modelSlots?: string[] }[];
  endpoint: string;
  model: string;
  maxTokens: number;
  monthlyBudget: number;
  /** 予算スコープ: 'project' | 'global' */
  budgetScope?: string;
  /** 為替レート */
  exchangeRate: number;
  /** 自動ルーティング有効か */
  autoRouting: boolean;
  /** メイン/サブモデル設定 */
  mainProvider?: string;
  mainModel?: string;
  subProvider?: string;
  subModel?: string;
  /** モデル別使用上限 */
  modelLimits?: ModelLimit[];
  /** 上位モデル再実行スロット設定 */
  escalateProvider1?: string;
  escalateModel1?: string;
  escalateProvider2?: string;
  escalateModel2?: string;
  /** 予算バー表示通貨 */
  displayCurrency?: string;
  /** .pettal プロジェクト設定 */
  pettalConfig?: PettalProjectConfig | null;
  hasPettalFile?: boolean;
  workspaceRoot?: string;
}

/** ファイルコンテンツ（Extension Host から返却） */
export interface FileContent {
  path: string;
  content: string;
  error?: string;
}

/** エージェントモード */
export type AgentMode = 'chat' | 'agent';

/** ライセンスステータス */
export type LicenseStatus = 'valid' | 'trial' | 'trial_expired' | 'free' | 'expired' | 'invalid' | 'grace';

/** エージェントイベント（server → provider.ts → Webview） */
export type AgentEvent =
  | { type: 'task_created'; taskId: string }
  | { type: 'thinking_start'; iteration: number }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; tool: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; tool: string; ok: boolean; output: string }
  | { type: 'approval_required'; id: string; tool: 'run_command'; data: { command: string } }
  | { type: 'approval_required'; id: string; tool: 'write_file'; data: { path: string; oldContent: string; newContent: string } }
  | { type: 'approval_required'; id: string; tool: string; data: Record<string, unknown> }
  | { type: 'file_change_applied'; undoId: string; path: string; action: 'create' | 'update' }
  | { type: 'file_change_undone'; undoId: string; path: string; ok: boolean; message: string }
  | { type: 'privacy_notice'; message: string }
  | { type: 'context_warning'; message: string }
  | { type: 'model_info'; providerId: string; modelName: string; isLocal: boolean }
  | { type: 'done'; iterations: number; tokensUsed: number; costUsd: number; costJpy: number }
  | { type: 'error'; message: string };

/** 承認待ちカード（UIに表示する） */
export interface PendingApproval {
  id: string;
  tool: string;
  data: Record<string, unknown>;
}

/** Extension Host → Webview のポストメッセージ */
export interface VsCodeMessage {
  command: string;
  port?: number;
  name?: string;
  data?: Task[] | ChatMessage[] | ApiResponse | ServerConfig | FileContent[];
  key?: string;
  value?: string;
  message?: string;
  event?: AgentEvent;
  id?: string;
  approved?: boolean;
}
