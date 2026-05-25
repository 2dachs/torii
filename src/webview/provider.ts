import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as http from 'http';
import { getChatHistory, clearAllHistory, getTasks, createTask, ChatMessage, Task, getMonthlyBudget, getGlobalMonthlyBudget } from '../backend/storage';
import { getSecretsManager } from '../backend/secretsManager';
import { updateBudgetDisplay } from '../backend/statusBar';
import { executeInTerminal } from '../backend/terminalBridge';
import * as licenseManager from '../backend/licenseManager';
import { updateLicenseBadge } from '../backend/statusBar';
import {
  EXTENSION_DISPLAY_NAME,
  MSG_LOAD_TASKS,
  MSG_LOAD_CHAT_HISTORY,
  MSG_SEND_MESSAGE,
  MSG_SAVE_SECRET,
  MSG_GET_SECRET,
  MSG_UPDATE_BUDGET,
  MSG_TERMINAL_EXEC,
  MSG_SERVER_PORT,
  MSG_SETTINGS_CONFIG,
  MSG_CLEAR_HISTORY,
  MSG_UPDATE_PROVIDER_CONFIG,
  MSG_EDITOR_CONTENT,
  MSG_CREATE_TASK,
  MSG_UPDATE_BUDGET_SCOPE,
  MSG_READ_FILES,
  MSG_WRITE_FILE,
  MSG_FILE_CONTENTS,
  MSG_AGENT_APPROVE,
  MSG_UPDATE_MODEL_CONFIG,
  MSG_LOAD_ROUTING_RULES,
  MSG_SAVE_ROUTING_RULE,
  MSG_DELETE_ROUTING_RULE,
  MSG_LOAD_PETTAL_CONFIG,
  MSG_SAVE_PETTAL_CONFIG,
  MSG_GET_MODEL_USAGE,
  MSG_MODEL_USAGE_DATA,
  MSG_SETUP_OLLAMA,
  MSG_OLLAMA_PROGRESS,
  CONFIG_BUDGET_SCOPE,
  DEFAULT_BUDGET_SCOPE,
  CONFIG_SECTION,
  CONFIG_PROVIDER,
  CONFIG_MONTHLY_BUDGET,
  CONFIG_MAIN_PROVIDER,
  CONFIG_MAIN_MODEL,
  CONFIG_SUB_PROVIDER,
  CONFIG_SUB_MODEL,
  CONFIG_MODEL_LIMITS,
  CONFIG_ESCALATE_PROVIDER_1,
  CONFIG_ESCALATE_MODEL_1,
  CONFIG_ESCALATE_PROVIDER_2,
  CONFIG_ESCALATE_MODEL_2,
  CONFIG_DISPLAY_CURRENCY,
  DEFAULT_PROVIDER,
  DEFAULT_MONTHLY_BUDGET,
  DEFAULT_EXCHANGE_RATE,
  PROVIDERS,
  ProviderId,
  MSG_GET_LICENSE_STATUS,
  MSG_ACTIVATE_LICENSE,
  MSG_LICENSE_STATUS,
  MSG_ESCALATE,
  MSG_ESCALATE_RESPONSE,
  MSG_CANCEL_REQUEST,
  MSG_CANCEL_AGENT,
} from '../constants';

export class PettalPractitionerProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _context: vscode.ExtensionContext;
  private _port: number;
  private _token: string;
  private _chatReq: ReturnType<typeof http.request> | null = null;
  private _agentReq: ReturnType<typeof http.request> | null = null;
  private _currentAgentTaskId: string | null = null;

  constructor(context: vscode.ExtensionContext, port: number, token: string) {
    this._context = context;
    this._port = port;
    this._token = token;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this._context.extensionPath, 'dist', 'webview')),
      ],
    };

    webviewView.webview.html = this._getHtmlContent(webviewView.webview);

    const disposables: vscode.Disposable[] = [];

    // Webview からのメッセージ受信
    disposables.push(webviewView.webview.onDidReceiveMessage(async (message) => {
      await this._handleMessage(message);
    }));

    // VS Code のアクティブエディタ変更を監視して webview に通知
    disposables.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && this._view) {
        this._sendEditorContent(editor);
      }
    }));

    // エディタの内容変更も監視（ドキュメント保存時）
    disposables.push(vscode.workspace.onDidSaveTextDocument((doc) => {
      if (this._view && vscode.window.activeTextEditor?.document === doc) {
        this._sendEditorContent(vscode.window.activeTextEditor);
      }
    }));

    // WebviewView 破棄時にリスナーを全解放（メモリリーク防止）
    webviewView.onDidDispose(() => {
      this._view = undefined;
      disposables.forEach(d => d.dispose());
    });

    // 初期データ送信
    this._sendInitialData();
  }

  private _getHtmlContent(webview: vscode.Webview): string {
    const indexPath = path.join(this._context.extensionPath, 'dist', 'webview', 'index.html');
    let html = fs.readFileSync(indexPath, 'utf-8');

    // CSP メタタグを動的注入
    // 全プロバイダーのAPIエンドポイント + Ollama ローカルエンドポイントを許可
    const allEndpoints = new Set<string>();
    for (const p of Object.values(PROVIDERS)) {
      try {
        allEndpoints.add(new URL(p.defaultEndpoint).origin);
      } catch { /* URL パース失敗時はスキップ */ }
    }
    // Ollama のデフォルトエンドポイントも追加（localhost:11434）
    allEndpoints.add('http://localhost:11434');

    const providerEndpointsStr = [...allEndpoints].join(' ');

    const csp = [
      `default-src 'none';`,
      `style-src ${webview.cspSource} 'unsafe-inline';`,
      `script-src ${webview.cspSource};`,
      `connect-src http://localhost:${this._port} http://127.0.0.1:${this._port} ${providerEndpointsStr} https:;`,
      `img-src ${webview.cspSource} https: data:;`,
      `font-src ${webview.cspSource};`,
      `media-src ${webview.cspSource} data:;`,
    ].join(' ');

    html = html.replace(
      '<head>',
      `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`
    );

    // webview.asWebviewUri 変換（dist/webview 内のアセットパス）
    const distWebviewUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this._context.extensionPath, 'dist', 'webview'))
    );
    html = html.replace(/(src|href)="\/([^"]+)"/g, `$1="${distWebviewUri}/$2"`);
    html = html.replace(/(src|href)="\.\/([^"]+)"/g, `$1="${distWebviewUri}/$2"`);

    return html;
  }

  private async _handleMessage(message: any) {
    switch (message.command) {
      case MSG_SEND_MESSAGE:
        if (message.agentMode === 'agent') {
          await this._handleAgentMessage(message.text, message.taskId);
        } else {
          await this._handleSendMessage(message.text, message.taskId, message.images);
        }
        break;
      case MSG_AGENT_APPROVE:
        await this._handleAgentApprove(message.id, message.approved);
        break;
      case MSG_SETUP_OLLAMA:
        await this._handleSetupOllama();
        break;
      case MSG_SAVE_SECRET:
        await this._handleSaveSecret(message.key, message.value);
        break;
      case MSG_GET_SECRET:
        await this._handleGetSecret(message.key);
        break;
      case MSG_TERMINAL_EXEC:
        await this._handleTerminalExec(message.command);
        break;
      case MSG_LOAD_TASKS:
        await this._sendTasks();
        break;
      case MSG_LOAD_CHAT_HISTORY:
        await this._sendChatHistory(message.taskId);
        break;
      case MSG_SETTINGS_CONFIG:
        await this._sendSettingsConfig();
        break;
      case MSG_CLEAR_HISTORY:
        await this.clearHistory();
        break;
      case MSG_UPDATE_PROVIDER_CONFIG:
        await this._handleUpdateProviderConfig(message.providerId, message.config);
        break;
      case MSG_EDITOR_CONTENT:
        await this._sendEditorContent(vscode.window.activeTextEditor);
        break;
      case MSG_UPDATE_BUDGET:
        await this._handleUpdateBudget(message.value);
        break;
      case MSG_CREATE_TASK:
        await this._handleCreateTask(message.title);
        break;
      case MSG_UPDATE_BUDGET_SCOPE:
        await this._handleUpdateBudgetScope(message.scope);
        break;
      case MSG_READ_FILES:
        await this._handleReadFiles(message.paths || []);
        break;
      case MSG_WRITE_FILE:
        await this._handleWriteFile(message.path, message.content);
        break;
      case MSG_UPDATE_MODEL_CONFIG:
        await this._handleUpdateModelConfig(message.config || {});
        break;
      case MSG_LOAD_ROUTING_RULES:
        await this._handleLoadRoutingRules();
        break;
      case MSG_SAVE_ROUTING_RULE:
        await this._handleSaveRoutingRule(message.rule, message.isNew);
        break;
      case MSG_DELETE_ROUTING_RULE:
        await this._handleDeleteRoutingRule(message.id);
        break;
      case MSG_LOAD_PETTAL_CONFIG:
        await this._handleLoadPettalConfig();
        break;
      case MSG_SAVE_PETTAL_CONFIG:
        await this._handleSavePettalConfig(message.config);
        break;
      case MSG_GET_MODEL_USAGE:
        await this._handleGetModelUsage();
        break;
      case MSG_GET_LICENSE_STATUS:
        await this._handleGetLicenseStatus();
        break;
      case MSG_ACTIVATE_LICENSE:
        await this._handleActivateLicense(message.key);
        break;
      case MSG_ESCALATE:
        await this._handleEscalate(message);
        break;
      case 'upgradePro':
        vscode.commands.executeCommand('torii.upgradePro');
        break;
      case MSG_CANCEL_REQUEST:
        this._handleCancelChat();
        break;
      case MSG_CANCEL_AGENT:
        await this._handleCancelAgent();
        break;
    }
  }

  private async _sendInitialData() {
    if (!this._view) return;
    // サーバーポートを通知
    this._view.webview.postMessage({
      command: MSG_SERVER_PORT,
      port: this._port,
    });
    // 拡張機能の表示名を通知
    this._view.webview.postMessage({
      command: 'extensionName',
      name: EXTENSION_DISPLAY_NAME,
    });
    // タスク一覧を送信
    await this._sendTasks();
    // チャット履歴を送信
    await this._sendChatHistory();
    // VS Code 設定を転送
    await this._sendSettingsConfig();
    // ライセンスステータスを送信
    await this._handleGetLicenseStatus();
    // 現在のエディタ内容を送信
    if (vscode.window.activeTextEditor) {
      this._sendEditorContent(vscode.window.activeTextEditor);
    }
  }

  /** アクティブエディタの内容を webview に転送 */
  private _sendEditorContent(editor: vscode.TextEditor | undefined) {
    if (!this._view || !editor) return;

    const doc = editor.document;
    const fileName = vscode.workspace.asRelativePath(doc.uri);
    const content = doc.getText();

    this._view.webview.postMessage({
      command: MSG_EDITOR_CONTENT,
      data: {
        fileName,
        language: doc.languageId,
        content,
        lineCount: doc.lineCount,
      },
    });
  }

  /** VS Code の設定とシークレット有無を WebView に転送 */
  private async _sendSettingsConfig(overrides?: Record<string, any>) {
    if (!this._view) return;

    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const providerId = config.get<ProviderId>(CONFIG_PROVIDER, DEFAULT_PROVIDER);
    const monthlyBudget = config.get<number>(CONFIG_MONTHLY_BUDGET, DEFAULT_MONTHLY_BUDGET);
    const budgetScope = config.get<string>(CONFIG_BUDGET_SCOPE, DEFAULT_BUDGET_SCOPE);
    const autoRouting = config.get<boolean>('autoRouting', true);
    const exchangeRate = config.get<number>('exchangeRate', 150);
    const useAutoExchangeRate = config.get<boolean>('useAutoExchangeRate', true);
    const mainProvider = overrides?.mainProvider ?? config.get<string>(CONFIG_MAIN_PROVIDER, '');
    const mainModel = overrides?.mainModel ?? config.get<string>(CONFIG_MAIN_MODEL, '');
    const subProvider = overrides?.subProvider ?? config.get<string>(CONFIG_SUB_PROVIDER, 'ollama');
    const subModel = overrides?.subModel ?? config.get<string>(CONFIG_SUB_MODEL, PROVIDERS.ollama.defaultModel);
    const modelLimits = overrides?.modelLimits ?? config.get<any[]>(CONFIG_MODEL_LIMITS, []);
    const escalateProvider1 = overrides?.escalateProvider1 ?? config.get<string>(CONFIG_ESCALATE_PROVIDER_1, '');
    const escalateModel1 = overrides?.escalateModel1 ?? config.get<string>(CONFIG_ESCALATE_MODEL_1, '');
    const escalateProvider2 = overrides?.escalateProvider2 ?? config.get<string>(CONFIG_ESCALATE_PROVIDER_2, '');
    const escalateModel2 = overrides?.escalateModel2 ?? config.get<string>(CONFIG_ESCALATE_MODEL_2, '');
    const displayCurrency = overrides?.displayCurrency ?? config.get<string>(CONFIG_DISPLAY_CURRENCY, 'JPY');
    const secrets = getSecretsManager(this._context);

    // .pettal ファイル読み込み
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    let pettalConfig = null;
    let hasPettalFile = false;
    if (workspaceRoot) {
      try {
        const pettalPath = require('path').join(workspaceRoot, '.pettal');
        const fs = require('fs');
        if (fs.existsSync(pettalPath)) {
          pettalConfig = JSON.parse(fs.readFileSync(pettalPath, 'utf-8'));
          hasPettalFile = true;
        }
      } catch { /* ignore */ }
    }

    // 各プロバイダーの設定
    const providerOverrides: Record<string, any> = overrides?.providerOverrides ?? {};
    const providers = await Promise.all(
      Object.values(PROVIDERS).map(async (p) => {
        const po = providerOverrides[p.id] ?? {};
        const key = await secrets.get(p.secretKey);
        const endpoint = po.endpoint ?? config.get<string>(`${p.id}.endpoint`, p.defaultEndpoint);
        const model = po.model ?? config.get<string>(`${p.id}.model`, p.defaultModel);
        const maxTokens = config.get<number>(`${p.id}.maxTokens`, 4096);
        const modelSlots = p.id === 'openrouter'
          ? (po.modelSlots ?? config.get<string[]>('openrouter.modelSlots', ['openai/gpt-4o', '', '']))
          : undefined;
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          hasKey: !!key,
          endpoint,
          model,
          maxTokens,
          models: p.models,
          ...(modelSlots !== undefined ? { modelSlots } : {}),
        };
      })
    );

    // 初期表示用に今月の使用額を取得
    const workspaceId = this._getWorkspaceId();
    let currentBudgetUsd = 0;
    try {
      if (budgetScope === 'project') {
        const budget = await getMonthlyBudget(workspaceId);
        currentBudgetUsd = budget?.total_cost_usd || 0;
      } else {
        const globalBudget = await getGlobalMonthlyBudget();
        currentBudgetUsd = globalBudget.total_cost_usd;
      }
    } catch { /* ignore */ }

    this._view.webview.postMessage({
      command: MSG_SETTINGS_CONFIG,
      data: {
        provider: providerId,
        providers,
        monthlyBudget,
        budgetScope,
        autoRouting,
        exchangeRate,
        useAutoExchangeRate,
        mainProvider,
        mainModel,
        subProvider,
        subModel,
        modelLimits,
        escalateProvider1,
        escalateModel1,
        escalateProvider2,
        escalateModel2,
        displayCurrency,
        pettalConfig,
        hasPettalFile,
        workspaceRoot,
        currentBudgetUsd,
      },
    });
  }

  private async _sendTasks() {
    if (!this._view) return;
    const workspaceId = this._getWorkspaceId();
    const tasks = await getTasks(workspaceId);
    this._view.webview.postMessage({
      command: MSG_LOAD_TASKS,
      data: tasks,
    });
  }

  private async _sendChatHistory(taskId?: string | null) {
    if (!this._view) return;
    const workspaceId = this._getWorkspaceId();
    const history = await getChatHistory(workspaceId, taskId);
    this._view.webview.postMessage({
      command: MSG_LOAD_CHAT_HISTORY,
      data: history,
    });
  }

  private async _handleSendMessage(
    text: string,
    taskId?: string,
    images?: { data: string; mimeType: string }[],
  ) {
    // Webview から送られてきたメッセージをバックエンドの Express サーバーに転送
    const workspaceId = this._getWorkspaceId();

    const payload: any = { message: text, workspaceId };
    if (taskId) payload.taskId = taskId;
    if (images && images.length > 0) payload.images = images;

    const postData = JSON.stringify(payload);

    const options = {
      hostname: 'localhost',
      port: this._port,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'x-torii-token': this._token,
      },
    };

    this._chatReq = http.request(options, (res: any) => {
      let body = '';
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => {
        this._chatReq = null;
        if (this._view) {
          try {
            this._view.webview.postMessage({
              command: 'receiveMessage',
              data: JSON.parse(body),
            });
          } catch {
            // キャンセル時など body が空の場合は無視
          }
        }
        // 予算表示を更新
        updateBudgetDisplay(this._context);
      });
    });
    this._chatReq.on('error', (e: Error) => {
      this._chatReq = null;
      if (this._view && e.message !== 'socket hang up') {
        this._view.webview.postMessage({
          command: 'error',
          message: `通信エラー: ${e.message}`,
        });
      }
    });
    this._chatReq.write(postData);
    this._chatReq.end();
  }

  private _handleCancelChat() {
    if (this._chatReq) {
      this._chatReq.destroy();
      this._chatReq = null;
    }
    this._view?.webview.postMessage({ command: 'requestCancelled' });
  }

  private async _handleCancelAgent() {
    if (this._agentReq) {
      this._agentReq.destroy();
      this._agentReq = null;
    }
    const taskId = this._currentAgentTaskId;
    this._currentAgentTaskId = null;
    if (taskId) {
      const payload = JSON.stringify({ taskId });
      const options = {
        hostname: 'localhost',
        port: this._port,
        path: '/api/agent/cancel',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'x-torii-token': this._token,
        },
      };
      const req = http.request(options, (res: any) => { res.resume(); });
      req.on('error', () => {});
      req.write(payload);
      req.end();
    }
    this._view?.webview.postMessage({ command: 'requestCancelled' });
  }

  private async _handleSaveSecret(key: string, value: string) {
    const secrets = getSecretsManager(this._context);
    await secrets.store(key, value);
    if (this._view) {
      this._view.webview.postMessage({
        command: 'secretSaved',
        key,
      });
    }
  }

  private async _handleGetSecret(key: string) {
    const secrets = getSecretsManager(this._context);
    const value = await secrets.get(key);
    if (this._view) {
      this._view.webview.postMessage({
        command: 'secretValue',
        key,
        value: value || '',
      });
    }
  }

  private async _handleTerminalExec(command: string) {
    executeInTerminal(command);
  }

  private _handleEscalate(message: any) {
    const { targetTier, targetProviderId, targetModelId, taskId } = message;
    const workspaceId = this._getWorkspaceId();
    const payload = JSON.stringify({ workspaceId, taskId, targetTier, targetProviderId, targetModelId });
    const options = {
      hostname: 'localhost',
      port: this._port,
      path: '/api/chat/escalate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'x-torii-token': this._token },
    };
    const req = http.request(options, (res: any) => {
      let body = '';
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => {
        if (!this._view) return;
        try {
          this._view.webview.postMessage({ command: MSG_ESCALATE_RESPONSE, data: JSON.parse(body) });
        } catch {
          this._view.webview.postMessage({ command: MSG_ESCALATE_RESPONSE, data: { error: '応答の解析に失敗しました' } });
        }
        updateBudgetDisplay(this._context);
      });
    });
    req.on('error', (e: Error) => {
      if (this._view) {
        this._view.webview.postMessage({ command: MSG_ESCALATE_RESPONSE, data: { error: `通信エラー: ${e.message}` } });
      }
    });
    req.write(payload);
    req.end();
  }

  private _getWorkspaceId(): string {
    // vscode.workspace.workspaceFolders からプロジェクトの一意なキーを生成
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return folders[0].uri.toString();
    }
    return 'global-workspace';
  }

  public async clearHistory() {
    const workspaceId = this._getWorkspaceId();
    await clearAllHistory(workspaceId);
    await this._sendChatHistory();
  }

  /** WebView からの月間予算更新を VS Code 設定に反映 */
  private async _handleUpdateBudget(value: number) {
    const configTarget = vscode.workspace.getConfiguration(CONFIG_SECTION);
    await configTarget.update(CONFIG_MONTHLY_BUDGET, value, vscode.ConfigurationTarget.Global);
    await this._sendSettingsConfig();
    await updateBudgetDisplay(this._context);
  }

  /** WebView からのタスク作成リクエスト */
  private async _handleCreateTask(title: string) {
    const workspaceId = this._getWorkspaceId();
    await createTask(workspaceId, title);
    await this._sendTasks();
  }

  /** WebView からの予算スコープ更新 */
  private async _handleUpdateBudgetScope(scope: string) {
    const configTarget = vscode.workspace.getConfiguration(CONFIG_SECTION);
    await configTarget.update(CONFIG_BUDGET_SCOPE, scope, vscode.ConfigurationTarget.Global);
    await this._sendSettingsConfig();
    await updateBudgetDisplay(this._context);
  }

  /** ファイル読み取り: Webview から要求されたパス一覧を読み取って返す */
  private async _handleReadFiles(paths: string[]) {
    if (!this._view || !paths.length) return;

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const rootPath = workspaceFolders && workspaceFolders.length > 0
      ? workspaceFolders[0].uri.fsPath
      : '';

    const workspaceReal = rootPath ? fs.realpathSync(path.resolve(rootPath)) : '';

    const safeResolve = (relPath: string): string => {
      if (!workspaceReal) throw new Error('ワークスペースが未設定です');
      if (path.isAbsolute(relPath)) throw new Error('絶対パスは禁止されています');
      const abs = path.resolve(workspaceReal, relPath);
      if (abs !== workspaceReal && !abs.startsWith(workspaceReal + path.sep)) {
        throw new Error('ワークスペース外へのアクセスは禁止されています');
      }
      try {
        const real = fs.realpathSync(abs);
        if (real !== workspaceReal && !real.startsWith(workspaceReal + path.sep)) {
          throw new Error('シンボリックリンク経由のワークスペース外アクセスは禁止されています');
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }
      return abs;
    };

    const results: { path: string; content: string; error?: string }[] = [];

    for (const relPath of paths) {
      try {
        const absPath = safeResolve(relPath);
        const content = await fsp.readFile(absPath, 'utf-8');
        results.push({ path: relPath, content });
      } catch (err: any) {
        results.push({ path: relPath, content: '', error: err.message || '読み取り失敗' });
      }
    }

    this._view.webview.postMessage({
      command: MSG_FILE_CONTENTS,
      data: results,
    });
  }

  /** ファイル書き込み: Webview から要求されたファイルに内容を書き込む */
  private async _handleWriteFile(filePath: string, content: string) {
    if (!this._view || !filePath) return;

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const rootPath = workspaceFolders && workspaceFolders.length > 0
      ? workspaceFolders[0].uri.fsPath
      : '';

    try {
      if (!rootPath) throw new Error('ワークスペースが未設定です');
      if (path.isAbsolute(filePath)) throw new Error('絶対パスは禁止されています');
      const workspaceReal = fs.realpathSync(path.resolve(rootPath));
      const absPath = path.resolve(workspaceReal, filePath);
      if (absPath !== workspaceReal && !absPath.startsWith(workspaceReal + path.sep)) {
        throw new Error('ワークスペース外へのアクセスは禁止されています');
      }
      await fsp.mkdir(path.dirname(absPath), { recursive: true });
      await fsp.writeFile(absPath, content, 'utf-8');

      // VS Code でファイルを開く
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
      await vscode.window.showTextDocument(doc, { preview: false });

      this._view.webview.postMessage({
        command: 'fileWritten',
        data: { path: filePath, success: true },
      });
    } catch (err: any) {
      this._view.webview.postMessage({
        command: 'fileWritten',
        data: { path: filePath, success: false, error: err.message || '書き込み失敗' },
      });
    }
  }

  /** エージェントモードでメッセージを送信（SSEストリーミング） */
  private async _handleAgentMessage(text: string, taskId?: string) {
    if (!this._view) return;
    const workspaceId = this._getWorkspaceId();

    const payload = JSON.stringify({ message: text, workspaceId, taskId: taskId || null });
    this._currentAgentTaskId = taskId || null;

    const options = {
      hostname: 'localhost',
      port: this._port,
      path: '/api/agent',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-torii-token': this._token,
      },
    };

    this._agentReq = http.request(options, (res: any) => {
      let buffer = '';
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const event = JSON.parse(jsonStr);
            this._handleAgentEvent(event);
          } catch {
            // ignore parse errors
          }
        }
      });
      res.on('end', () => {
        this._agentReq = null;
        this._currentAgentTaskId = null;
        // SSE 終了後に予算表示を更新
        updateBudgetDisplay(this._context);
      });
    });

    this._agentReq.on('error', (e: Error) => {
      this._agentReq = null;
      this._currentAgentTaskId = null;
      if (e.message !== 'socket hang up') {
        this._view?.webview.postMessage({ command: 'agentEvent', event: { type: 'error', message: e.message } });
      }
    });
    this._agentReq.write(payload);
    this._agentReq.end();
  }

  /** SSEで受信したエージェントイベントをWebviewに転送 */
  private _handleAgentEvent(event: any) {
    if (!this._view) return;
    this._view.webview.postMessage({ command: 'agentEvent', event });
  }

  /** エージェント承認応答をExpressサーバーに転送 */
  private async _handleAgentApprove(id: string, approved: boolean) {
    const payload = JSON.stringify({ id, approved });
    const options = {
      hostname: 'localhost',
      port: this._port,
      path: '/api/agent/approve',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-torii-token': this._token,
      },
    };
    await new Promise<void>((resolve) => {
      const req = http.request(options, (res: any) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', resolve);
      req.write(payload);
      req.end();
    });
  }

  private _getWorkspaceRoot(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
  }

  /** メイン/サブモデル設定更新 */
  private async _handleUpdateModelConfig(config: Record<string, string | any[]>) {
    const configTarget = vscode.workspace.getConfiguration(CONFIG_SECTION);
    if (config.mainProvider !== undefined) {
      await configTarget.update(CONFIG_MAIN_PROVIDER, config.mainProvider, vscode.ConfigurationTarget.Global);
    }
    if (config.mainModel !== undefined) {
      await configTarget.update(CONFIG_MAIN_MODEL, config.mainModel, vscode.ConfigurationTarget.Global);
    }
    if (config.subProvider !== undefined) {
      await configTarget.update(CONFIG_SUB_PROVIDER, config.subProvider, vscode.ConfigurationTarget.Global);
    }
    if (config.subModel !== undefined) {
      await configTarget.update(CONFIG_SUB_MODEL, config.subModel, vscode.ConfigurationTarget.Global);
    }
    if (config.modelLimits !== undefined) {
      await configTarget.update(CONFIG_MODEL_LIMITS, config.modelLimits, vscode.ConfigurationTarget.Global);
    }
    if (config.escalateProvider1 !== undefined) {
      await configTarget.update(CONFIG_ESCALATE_PROVIDER_1, config.escalateProvider1, vscode.ConfigurationTarget.Global);
    }
    if (config.escalateModel1 !== undefined) {
      await configTarget.update(CONFIG_ESCALATE_MODEL_1, config.escalateModel1, vscode.ConfigurationTarget.Global);
    }
    if (config.escalateProvider2 !== undefined) {
      await configTarget.update(CONFIG_ESCALATE_PROVIDER_2, config.escalateProvider2, vscode.ConfigurationTarget.Global);
    }
    if (config.escalateModel2 !== undefined) {
      await configTarget.update(CONFIG_ESCALATE_MODEL_2, config.escalateModel2, vscode.ConfigurationTarget.Global);
    }
    if (config.displayCurrency !== undefined) {
      await configTarget.update(CONFIG_DISPLAY_CURRENCY, config.displayCurrency, vscode.ConfigurationTarget.Global);
    }
    await this._sendSettingsConfig(config);
  }

  /** ルーティングルール一覧を取得して Webview に送信 */
  private async _handleLoadRoutingRules() {
    if (!this._view) return;
    try {
      const options = {
        hostname: 'localhost',
        port: this._port,
        path: '/api/routing-rules',
        method: 'GET',
        headers: { 'x-torii-token': this._token },
      };
      await new Promise<void>((resolve) => {
        const req = http.request(options, (res: any) => {
          let body = '';
          res.on('data', (chunk: string) => (body += chunk));
          res.on('end', () => {
            try {
              const data = JSON.parse(body);
              this._view?.webview.postMessage({ command: MSG_LOAD_ROUTING_RULES, data });
            } catch { /* ignore */ }
            resolve();
          });
        });
        req.on('error', resolve);
        req.end();
      });
    } catch { /* ignore */ }
  }

  /** カスタムルーティングルールを保存 */
  private async _handleSaveRoutingRule(rule: any, isNew: boolean) {
    if (!this._view || !rule) return;
    const method = isNew ? 'POST' : 'PUT';
    const rulePath = isNew ? '/api/routing-rules' : `/api/routing-rules/${rule.id}`;
    const postData = JSON.stringify(rule);
    const options = {
      hostname: 'localhost',
      port: this._port,
      path: rulePath,
      method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData), 'x-torii-token': this._token },
    };
    await new Promise<void>((resolve) => {
      const req = http.request(options, (res: any) => {
        res.resume();
        res.on('end', async () => {
          await this._handleLoadRoutingRules();
          resolve();
        });
      });
      req.on('error', resolve);
      req.write(postData);
      req.end();
    });
  }

  /** カスタムルーティングルールを削除 */
  private async _handleDeleteRoutingRule(id: string) {
    if (!this._view || !id) return;
    const options = {
      hostname: 'localhost',
      port: this._port,
      path: `/api/routing-rules/${id}`,
      method: 'DELETE',
      headers: { 'x-torii-token': this._token },
    };
    await new Promise<void>((resolve) => {
      const req = http.request(options, (res: any) => {
        res.resume();
        res.on('end', async () => {
          await this._handleLoadRoutingRules();
          resolve();
        });
      });
      req.on('error', resolve);
      req.end();
    });
  }

  /** .pettal ファイルを読み込んで Webview に送信 */
  private async _handleLoadPettalConfig() {
    if (!this._view) return;
    const root = this._getWorkspaceRoot();
    const options = {
      hostname: 'localhost',
      port: this._port,
      path: `/api/pettal-config?root=${encodeURIComponent(root)}`,
      method: 'GET',
      headers: { 'x-torii-token': this._token },
    };
    await new Promise<void>((resolve) => {
      const req = http.request(options, (res: any) => {
        let body = '';
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            this._view?.webview.postMessage({ command: MSG_LOAD_PETTAL_CONFIG, data });
          } catch { /* ignore */ }
          resolve();
        });
      });
      req.on('error', resolve);
      req.end();
    });
  }

  /** .pettal ファイルを保存 */
  private async _handleSavePettalConfig(config: any) {
    if (!this._view || !config) return;
    const postData = JSON.stringify(config);
    const options = {
      hostname: 'localhost',
      port: this._port,
      path: '/api/pettal-config',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData), 'x-torii-token': this._token },
    };
    await new Promise<void>((resolve) => {
      const req = http.request(options, (res: any) => {
        res.resume();
        res.on('end', async () => {
          await this._sendSettingsConfig();
          resolve();
        });
      });
      req.on('error', resolve);
      req.write(postData);
      req.end();
    });
  }

  /** モデル別月間使用量を取得して Webview に送信 */
  private async _handleGetModelUsage() {
    if (!this._view) return;
    const workspaceId = this._getWorkspaceId();
    const options = {
      hostname: 'localhost',
      port: this._port,
      path: `/api/model-usage?workspaceId=${encodeURIComponent(workspaceId)}`,
      method: 'GET',
      headers: { 'x-torii-token': this._token },
    };
    await new Promise<void>((resolve) => {
      const req = http.request(options, (res: any) => {
        let body = '';
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            this._view?.webview.postMessage({ command: MSG_MODEL_USAGE_DATA, data });
          } catch { /* ignore */ }
          resolve();
        });
      });
      req.on('error', resolve);
      req.end();
    });
  }

  /** WebView からのプロバイダー設定更新を VS Code 設定に反映 */
  private async _handleUpdateProviderConfig(providerId: string, config: { endpoint?: string; model?: string; provider?: string; autoRouting?: boolean; modelSlots?: string[]; mainModel?: string; mainProvider?: string }) {
    const configTarget = vscode.workspace.getConfiguration(CONFIG_SECTION);

    if (config.provider) {
      await configTarget.update(CONFIG_PROVIDER, config.provider, vscode.ConfigurationTarget.Global);
    }
    if (config.endpoint) {
      await configTarget.update(`${providerId}.endpoint`, config.endpoint, vscode.ConfigurationTarget.Global);
    }
    if (config.model) {
      await configTarget.update(`${providerId}.model`, config.model, vscode.ConfigurationTarget.Global);
    }
    if (config.autoRouting !== undefined) {
      await configTarget.update('autoRouting', config.autoRouting, vscode.ConfigurationTarget.Global);
    }
    if (config.modelSlots !== undefined) {
      await configTarget.update(`${providerId}.modelSlots`, config.modelSlots, vscode.ConfigurationTarget.Global);
    }
    // mainModel / mainProvider が同梱されている場合（スロット「使用」ボタン等）も一括で保存
    if (config.mainModel !== undefined) {
      await configTarget.update(CONFIG_MAIN_MODEL, config.mainModel, vscode.ConfigurationTarget.Global);
    }
    if (config.mainProvider !== undefined) {
      await configTarget.update(CONFIG_MAIN_PROVIDER, config.mainProvider, vscode.ConfigurationTarget.Global);
    }
    // 保存した値をすべて overrides に含めて単一の settingsConfig 送信（並行送信による競合を根本的に排除）
    const modelOverrides: Record<string, any> = {};
    if (config.mainModel !== undefined) modelOverrides.mainModel = config.mainModel;
    if (config.mainProvider !== undefined) modelOverrides.mainProvider = config.mainProvider;
    await this._sendSettingsConfig({ ...modelOverrides, providerOverrides: { [providerId]: config } });
  }

  /** Ollama自動セットアップをwebviewからのリクエストで実行 */
  private async _handleSetupOllama() {
    const { runOllamaSetup } = await import('../backend/ollamaSetup');
    const result = await runOllamaSetup((p) => this.sendOllamaProgress(p));

    // セットアップ成功時にサブモデルの設定を自動更新
    if (result.success && result.recommendedModel) {
      const configTarget = vscode.workspace.getConfiguration(CONFIG_SECTION);
      await configTarget.update(CONFIG_SUB_MODEL, result.recommendedModel, vscode.ConfigurationTarget.Global);
      await configTarget.update(CONFIG_SUB_PROVIDER, 'ollama', vscode.ConfigurationTarget.Global);
      await this._sendSettingsConfig();
    }
  }

  /** Ollamaセットアップ進捗をWebviewに送信 */
  public sendOllamaProgress(progress: { step: string; message: string; recommendedModel?: string }) {
    if (!this._view) return;
    this._view.webview.postMessage({ command: MSG_OLLAMA_PROGRESS, data: progress });
  }

  /** ライセンスステータスをWebviewに送信 */
  public sendLicenseStatus(status: string, trialDaysRemaining?: number | null) {
    if (!this._view) return;
    this._view.webview.postMessage({ command: MSG_LICENSE_STATUS, status, trialDaysRemaining, isBeta: licenseManager.BETA_FREE_PRO });
  }

  private async _handleGetLicenseStatus() {
    try {
      const status = await licenseManager.getStatus(this._context);
      const trialDaysRemaining = await licenseManager.getTrialDaysRemaining(this._context);
      this.sendLicenseStatus(status, trialDaysRemaining);
    } catch (err) {
      // 例外時はデフォルト 'free'（安全側に倒す）
      console.error('[Torii] getStatus failed:', err);
      this.sendLicenseStatus('free', null);
    }
  }

  private async _handleActivateLicense(key: string) {
    if (!this._view || !key) return;
    const result = await licenseManager.activate(this._context, key);
    if (result.ok) {
      const newStatus = await licenseManager.getStatus(this._context);
      updateLicenseBadge(this._context, newStatus);
      this.sendLicenseStatus(newStatus);
    }
    this._view.webview.postMessage({ command: 'licenseActivateResult', ok: result.ok, message: result.message });
  }

  public dispose() {
    this._view = undefined;
  }
}