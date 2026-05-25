import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { promises as fsp } from "fs";
import { v4 as uuidv4 } from "uuid";

// ── インターフェース（db.ts と完全互換） ──

export interface Task {
  id: string;
  workspace_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  workspace_id: string;
  task_id: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  tokens_used: number;
  cost_usd: number;
  cost_jpy: number;
  created_at: string;
  providerId?: string;
  model?: string;
  modelName?: string;
}

export interface BudgetRecord {
  workspace_id: string;
  month_key: string;
  total_tokens: number;
  total_cost_usd: number;
}

// ── 内部データ構造 ──

interface TaskFile {
  id: string;
  workspace_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: MessageEntry[];
}

interface MessageEntry {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  tokens_used: number;
  cost_usd: number;
  cost_jpy: number;
  created_at: string;
  provider_id?: string;
  model?: string;
  model_name?: string;
}

interface TaskIndexEntry {
  id: string;
  workspace_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  /** メッセージ総数（list.json から全ファイルを開かずに概要把握可能） */
  message_count: number;
  /** 最後のメッセージの冒頭最大200文字（スニペット検索用） */
  last_message_snippet: string;
}

interface ListFile {
  tasks: TaskIndexEntry[];
}

interface UsageEntry {
  workspace_id: string;
  month_key: string;
  total_tokens: number;
  total_cost_usd: number;
}

interface ModelUsageEntry {
  workspace_id: string;
  provider_id: string;
  model_id: string;
  month_key: string;
  total_calls: number;
  total_cost_usd: number;
}

interface UsageFile {
  records: UsageEntry[];
  modelRecords: ModelUsageEntry[];
}

// ── 上限定数 ──

/** 1タスクに保存するメッセージの最大件数。超えたら先頭から削除 */
const MAX_MESSAGES_PER_TASK = 200;
/** 1ワークスペースに保存するタスクの最大件数。超えたら最古のタスクを削除 */
const MAX_TASKS_PER_WORKSPACE = 50;
/** usage.json に保持する月数（これより古い月は自動削除） */
const USAGE_RETAIN_MONTHS = 13;

// ── パス管理 ──

let basePath = "";

function tasksDir(): string {
  return path.join(basePath, "tasks");
}

function taskFilePath(id: string): string {
  return path.join(tasksDir(), `${id}.json`);
}

function listFilePath(): string {
  return path.join(basePath, "list.json");
}

function usageFilePath(): string {
  return path.join(basePath, "usage.json");
}

// ── ヘルパー ──

/**
 * アトミック書き込み: 一時ファイルに書き出してからリネームすることで、
 * 書き込み中のクラッシュによるファイル破損を防止する。
 */
async function atomicWriteFile(filePath: string, data: unknown): Promise<void> {
  const tmpPath = filePath + ".tmp";
  const content = JSON.stringify(data, null, 2);
  await fsp.writeFile(tmpPath, content, "utf-8");
  await fsp.rename(tmpPath, filePath);
}

/**
 * ファイルを読み込んでJSONパース。
 * - ENOENT (ファイル不在) → fallback を返す（正常系）
 * - JSONパースエラー → 壊れたファイルを .broken にバックアップし fallback を返す
 */
async function safeReadJSON<T>(filePath: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await fsp.readFile(filePath, "utf-8");
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      console.error(`[Torii] Failed to read ${filePath}:`, err);
    }
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    const brokenPath = filePath + ".broken";
    try {
      await fsp.rename(filePath, brokenPath);
      console.warn(`[Torii] Corrupted JSON backed up to ${brokenPath}`);
      vscode.window.showWarningMessage(
        `Torii: データファイルが破損していたため ${path.basename(brokenPath)} にバックアップしました。`,
      );
    } catch {
      // バックアップ失敗は無視
    }
    return fallback;
  }
}

/**
 * 先頭から maxLen 文字を切り出し、超える場合は "..." を付加。
 */
function snippet(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  return text.substring(0, maxLen) + "...";
}

function getMonthKey(date?: Date): string {
  const now = date ?? new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** 現在から retainMonths ヶ月前の月キーを返す（USAGE_RETAIN_MONTHS での trimming に使用） */
function getCutoffMonthKey(retainMonths: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - retainMonths);
  return getMonthKey(d);
}

// ── 書き込みキュー（すべてのJSON操作を逐次実行） ──

let _writeQueue: Promise<void> = Promise.resolve();

function queuedWrite<T>(fn: () => Promise<T>): Promise<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const outer = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  _writeQueue = _writeQueue
    .then(async () => {
      try { resolve(await fn()); } catch (e) { reject(e); }
    })
    .catch(() => {});
  return outer;
}

// ── 公開API ──

/**
 * ストレージの初期化。
 * globalStorageUri.fsPath 直下に tasks/ ディレクトリを作成し、
 * list.json / usage.json が存在しなければ空データで作成する。
 */
export function initStorage(context: vscode.ExtensionContext): void {
  basePath = context.globalStorageUri.fsPath;

  // ディレクトリ作成（同期的に実行）
  const dir = tasksDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 起動時に前回クラッシュで残った孤立 .tmp ファイルをクリーンアップ
  for (const scanDir of [basePath, dir]) {
    try {
      for (const f of fs.readdirSync(scanDir)) {
        if (f.endsWith(".tmp")) {
          try { fs.unlinkSync(path.join(scanDir, f)); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }

  // 初期ファイル作成（存在しない場合のみ）
  const listPath = listFilePath();
  if (!fs.existsSync(listPath)) {
    fs.writeFileSync(listPath, JSON.stringify({ tasks: [] }, null, 2), "utf-8");
  }

  const usagePath = usageFilePath();
  if (!fs.existsSync(usagePath)) {
    fs.writeFileSync(usagePath, JSON.stringify({ records: [], modelRecords: [] }, null, 2), "utf-8");
  }

  console.log(`[Torii] Storage initialized at ${basePath}`);
}

/**
 * ストレージの終了処理。書き込みキューのドレインを待ってからパスをリセット。
 */
export async function disposeStorage(): Promise<void> {
  await _writeQueue;
  basePath = "";
}

// ── Task CRUD ──

export function createTask(
  workspaceId: string,
  title: string,
): Promise<Task> {
  return queuedWrite(async () => {
    const id = uuidv4();
    const now = new Date().toISOString();

    const taskFile: TaskFile = {
      id,
      workspace_id: workspaceId,
      title,
      created_at: now,
      updated_at: now,
      messages: [],
    };

    // タスクファイルを書き込み
    await atomicWriteFile(taskFilePath(id), taskFile);

    // list.json にエントリを追加
    const list = await safeReadJSON<ListFile>(listFilePath(), { tasks: [] });
    list.tasks.push({
      id,
      workspace_id: workspaceId,
      title,
      created_at: now,
      updated_at: now,
      message_count: 0,
      last_message_snippet: "",
    });

    // ワークスペース内タスク数が上限を超えたら最古を削除
    const wsTasks = list.tasks.filter((t) => t.workspace_id === workspaceId);
    if (wsTasks.length > MAX_TASKS_PER_WORKSPACE) {
      const sorted = [...wsTasks].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const toDelete = sorted.slice(0, wsTasks.length - MAX_TASKS_PER_WORKSPACE);
      const deleteIds = new Set(toDelete.map((t) => t.id));
      for (const old of toDelete) {
        try { await fsp.unlink(taskFilePath(old.id)); } catch { /* ignore */ }
      }
      list.tasks = list.tasks.filter((t) => !deleteIds.has(t.id));
    }

    await atomicWriteFile(listFilePath(), list);

    return { id, workspace_id: workspaceId, title, created_at: now, updated_at: now };
  });
}

export async function getTasks(workspaceId: string): Promise<Task[]> {
  const list = await safeReadJSON<ListFile>(listFilePath(), { tasks: [] });
  return list.tasks
    .filter((t) => t.workspace_id === workspaceId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map(({ id, workspace_id, title, created_at, updated_at }) => ({
      id,
      workspace_id,
      title,
      created_at,
      updated_at,
    }));
}

export function deleteTask(id: string): Promise<void> {
  return queuedWrite(async () => {
    // タスクファイルを削除
    try {
      await fsp.unlink(taskFilePath(id));
    } catch {
      // ファイルが存在しない場合は無視
    }

    // list.json から該当エントリを削除
    const list = await safeReadJSON<ListFile>(listFilePath(), { tasks: [] });
    list.tasks = list.tasks.filter((t) => t.id !== id);
    await atomicWriteFile(listFilePath(), list);
  });
}

// ── Chat Messages ──

export function saveChatMessage(
  workspaceId: string,
  taskId: string | null,
  role: "user" | "assistant" | "system",
  content: string,
  tokensUsed: number,
  costUsd: number,
  costJpy?: number,
  providerId?: string,
  model?: string,
  modelName?: string,
): Promise<ChatMessage> {
  return queuedWrite(async () => {
    const id = uuidv4();
    const now = new Date().toISOString();

    const message: MessageEntry = {
      id,
      role,
      content,
      tokens_used: tokensUsed,
      cost_usd: costUsd,
      cost_jpy: costJpy || 0,
      created_at: now,
      provider_id: providerId,
      model,
      model_name: modelName,
    };

    // タスクファイルにメッセージを追加
    if (taskId) {
      const taskPath = taskFilePath(taskId);
      const task = await safeReadJSON<TaskFile>(taskPath, {
        id: taskId,
        workspace_id: workspaceId,
        title: "",
        created_at: now,
        updated_at: now,
        messages: [],
      } as TaskFile);

      task.messages.push(message);
      // 上限を超えた分は先頭（最古）から削除
      if (task.messages.length > MAX_MESSAGES_PER_TASK) {
        task.messages = task.messages.slice(task.messages.length - MAX_MESSAGES_PER_TASK);
      }
      task.updated_at = now;
      await atomicWriteFile(taskPath, task);

      // list.json のスニペットと件数を更新
      const list = await safeReadJSON<ListFile>(listFilePath(), { tasks: [] });
      const entry = list.tasks.find((t) => t.id === taskId);
      if (entry) {
        entry.message_count = task.messages.length;
        entry.last_message_snippet = snippet(content, 200);
        entry.updated_at = now;
      }
      await atomicWriteFile(listFilePath(), list);
    }

    // usage.json の月間集計を更新（1回の read-write で両方処理）
    await updateUsageRecords(workspaceId, tokensUsed, costUsd, role, providerId, model);

    return {
      id,
      workspace_id: workspaceId,
      task_id: taskId,
      role,
      content,
      tokens_used: tokensUsed,
      cost_usd: costUsd,
      cost_jpy: costJpy || 0,
      created_at: now,
      providerId: providerId,
      model: model,
      modelName: modelName,
    };
  });
}

export async function getChatHistory(
  workspaceId: string,
  taskId?: string | null,
): Promise<ChatMessage[]> {
  if (taskId) {
    // 特定タスクの履歴のみ
    const task = await safeReadJSON<TaskFile | null>(taskFilePath(taskId), null);
    if (!task) {
      return [];
    }
    return task.messages.map((m) => ({
      id: m.id,
      workspace_id: task.workspace_id,
      task_id: task.id,
      role: m.role,
      content: m.content,
      tokens_used: m.tokens_used,
      cost_usd: m.cost_usd,
      cost_jpy: m.cost_jpy || 0,
      created_at: m.created_at,
      providerId: m.provider_id,
      model: m.model,
      modelName: m.model_name,
    }));
  }

  // workspace 全体の履歴（全タスクのメッセージをマージ）
  const list = await safeReadJSON<ListFile>(listFilePath(), { tasks: [] });
  const workspaceTasks = list.tasks.filter(
    (t) => t.workspace_id === workspaceId,
  );

  const allMessages: ChatMessage[] = [];
  for (const entry of workspaceTasks) {
    const task = await safeReadJSON<TaskFile | null>(
      taskFilePath(entry.id),
      null,
    );
    if (task) {
      for (const m of task.messages) {
        allMessages.push({
          id: m.id,
          workspace_id: task.workspace_id,
          task_id: task.id,
          role: m.role,
          content: m.content,
          tokens_used: m.tokens_used,
          cost_usd: m.cost_usd,
          cost_jpy: m.cost_jpy || 0,
          created_at: m.created_at,
          providerId: m.provider_id,
          model: m.model,
          modelName: m.model_name,
        });
      }
    }
  }

  // 作成日時昇順にソート
  allMessages.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return allMessages;
}

export function clearAllHistory(workspaceId: string): Promise<void> {
  return queuedWrite(async () => {
    const list = await safeReadJSON<ListFile>(listFilePath(), { tasks: [] });
    const workspaceTasks = list.tasks.filter(
      (t) => t.workspace_id === workspaceId,
    );

    // 各タスクファイルを削除
    for (const entry of workspaceTasks) {
      try {
        await fsp.unlink(taskFilePath(entry.id));
      } catch {
        // 存在しない場合は無視
      }
    }

    // list.json から削除
    list.tasks = list.tasks.filter((t) => t.workspace_id !== workspaceId);
    await atomicWriteFile(listFilePath(), list);

    // usage.json から削除
    const usage = await safeReadJSON<UsageFile>(usageFilePath(), { records: [], modelRecords: [] });
    usage.records = usage.records.filter((r) => r.workspace_id !== workspaceId);
    if (usage.modelRecords) {
      usage.modelRecords = usage.modelRecords.filter((r) => r.workspace_id !== workspaceId);
    }
    await atomicWriteFile(usageFilePath(), usage);
  });
}

// ── Budget ──

/** usage.json の月間集計を1回の read-write で更新する（budget + model usage を統合処理） */
async function updateUsageRecords(
  workspaceId: string,
  tokensUsed: number,
  costUsd: number,
  role: string,
  providerId?: string,
  modelId?: string,
): Promise<void> {
  const hasUsage = tokensUsed !== 0 || costUsd !== 0;
  const hasModel = role === "assistant" && !!providerId && !!modelId;
  if (!hasUsage && !hasModel) return;

  const monthKey = getMonthKey();
  const usage = await safeReadJSON<UsageFile>(usageFilePath(), { records: [], modelRecords: [] });
  if (!usage.modelRecords) usage.modelRecords = [];

  if (hasUsage) {
    const rec = usage.records.find(
      (r) => r.workspace_id === workspaceId && r.month_key === monthKey,
    );
    if (rec) {
      rec.total_tokens += tokensUsed;
      rec.total_cost_usd += costUsd;
    } else {
      usage.records.push({ workspace_id: workspaceId, month_key: monthKey, total_tokens: tokensUsed, total_cost_usd: costUsd });
    }
  }

  if (hasModel) {
    const rec = usage.modelRecords.find(
      (r) => r.workspace_id === workspaceId && r.model_id === modelId && r.month_key === monthKey,
    );
    if (rec) {
      rec.total_calls += 1;
      rec.total_cost_usd += costUsd;
    } else {
      usage.modelRecords.push({ workspace_id: workspaceId, provider_id: providerId!, model_id: modelId!, month_key: monthKey, total_calls: 1, total_cost_usd: costUsd });
    }
  }

  // USAGE_RETAIN_MONTHS より古い月のレコードを削除
  const cutoff = getCutoffMonthKey(USAGE_RETAIN_MONTHS);
  usage.records = usage.records.filter((r) => r.month_key >= cutoff);
  usage.modelRecords = usage.modelRecords.filter((r) => r.month_key >= cutoff);

  await atomicWriteFile(usageFilePath(), usage);
}

export async function getMonthlyBudget(
  workspaceId: string,
): Promise<BudgetRecord | undefined> {
  const monthKey = getMonthKey();
  const usage = await safeReadJSON<UsageFile>(usageFilePath(), { records: [], modelRecords: [] });
  return usage.records.find(
    (r) => r.workspace_id === workspaceId && r.month_key === monthKey,
  );
}

/**
 * 全ワークスペース合算の月間予算を取得
 * （予算上限は Global 設定だが、使用量は workspace 単位で集計されているため全合算）
 */
/** ストレージのベースパスを返す（他モジュールから使用） */
export function getStorageBasePath(): string {
  return basePath;
}

/** 今月のモデル別使用量（呼び出し回数 + コスト）を取得 */
export async function getModelUsageThisMonth(
  workspaceId: string,
  modelId: string,
): Promise<{ calls: number; costUsd: number }> {
  const monthKey = getMonthKey();
  const usage = await safeReadJSON<UsageFile>(usageFilePath(), { records: [], modelRecords: [] });
  const entry = (usage.modelRecords || []).find(
    (r) => r.workspace_id === workspaceId && r.model_id === modelId && r.month_key === monthKey,
  );
  return { calls: entry?.total_calls ?? 0, costUsd: entry?.total_cost_usd ?? 0 };
}

/** 今月の全モデル別使用量を取得 */
export async function getAllModelUsageThisMonth(
  workspaceId: string,
): Promise<Array<{ modelId: string; providerId: string; calls: number; costUsd: number }>> {
  const monthKey = getMonthKey();
  const usage = await safeReadJSON<UsageFile>(usageFilePath(), { records: [], modelRecords: [] });
  return (usage.modelRecords || [])
    .filter((r) => r.workspace_id === workspaceId && r.month_key === monthKey)
    .map((r) => ({
      modelId: r.model_id,
      providerId: r.provider_id,
      calls: r.total_calls,
      costUsd: r.total_cost_usd,
    }));
}

export async function getGlobalMonthlyBudget(): Promise<BudgetRecord> {
  const monthKey = getMonthKey();
  const usage = await safeReadJSON<UsageFile>(usageFilePath(), { records: [], modelRecords: [] });
  const monthRecords = usage.records.filter((r) => r.month_key === monthKey);
  return {
    workspace_id: 'global',
    month_key: monthKey,
    total_tokens: monthRecords.reduce((sum, r) => sum + r.total_tokens, 0),
    total_cost_usd: monthRecords.reduce((sum, r) => sum + r.total_cost_usd, 0),
  };
}
