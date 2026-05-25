import * as vscode from 'vscode';
import { PettalPractitionerProvider } from './webview/provider';
import { initStorage, disposeStorage } from './backend/storage';
import { startServer, stopServer } from './backend/server';
import { registerStatusBar, updateBudgetDisplay, updateLicenseBadge, disposeStatusBar } from './backend/statusBar';
import { disposeTerminal } from './backend/terminalBridge';
import { runOllamaSetup } from './backend/ollamaSetup';
import * as licenseManager from './backend/licenseManager';
import { LEMONSQUEEZY_CHECKOUT_URL, CONFIG_SECTION, CONFIG_SECTION_LEGACY } from './constants';

let provider: PettalPractitionerProvider | undefined;
let serverPort: number | undefined;
let serverToken: string | undefined;

/** 旧 pettalPractitioner.* 設定キーを torii.* へ移行（初回起動時のみ実行） */
async function migrateConfig() {
  const legacy = vscode.workspace.getConfiguration(CONFIG_SECTION_LEGACY);
  const current = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const keys = [
    'provider', 'autoRouting', 'monthlyBudget', 'autoApplyFileChanges',
    'mainProvider', 'mainModel', 'subProvider', 'subModel',
    'modelLimits', 'escalationEnabled', 'escalateProvider1', 'escalateModel1',
    'escalateProvider2', 'escalateModel2', 'customPrivacyKeywords',
    'budgetScope', 'exchangeRate', 'useAutoExchangeRate',
    'openai.endpoint', 'openai.model', 'openai.maxTokens',
    'deepseek.endpoint', 'deepseek.model', 'deepseek.maxTokens',
    'anthropic.endpoint', 'anthropic.model', 'anthropic.maxTokens',
    'ollama.endpoint', 'ollama.model', 'ollama.maxTokens',
    'gemini.endpoint', 'gemini.model', 'gemini.maxTokens',
  ];
  for (const key of keys) {
    const legacyValue = legacy.get(key);
    const currentValue = current.get(key);
    // 旧キーに値があり、新キーがデフォルト（undefined）の場合のみコピー
    if (legacyValue !== undefined && currentValue === undefined) {
      try {
        await current.update(key, legacyValue, vscode.ConfigurationTarget.Global);
      } catch { /* ignore */ }
    }
  }
}

export async function activate(context: vscode.ExtensionContext) {
  console.log('[Torii] Activating extension...');

  // 0. 設定キーマイグレーション（pettalPractitioner.* → torii.*）
  await migrateConfig();

  // 1. DB 初期化（storageUri を使用した絶対パス）
  try {
    initStorage(context);
    console.log('[Torii] Storage initialized');
  } catch (err) {
    console.error('[Torii] Failed to initialize storage:', err);
    vscode.window.showErrorMessage('Torii: Failed to initialize storage');
    return;
  }

  // 2. バックエンドサーバー起動（動的ポート）
  try {
    const result = await startServer(context);
    serverPort = result.port;
    serverToken = result.token;
    console.log(`[Torii] Backend server started on port ${serverPort}`);
  } catch (err) {
    console.error('[Torii] Failed to start server:', err);
    vscode.window.showErrorMessage('Torii: Failed to start backend server');
    return;
  }

  // 3. Webview Provider 登録
  provider = new PettalPractitionerProvider(context, serverPort, serverToken!);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('torii-view', provider)
  );

  // 4. ステータスバー予算表示
  registerStatusBar(context);
  await updateBudgetDisplay(context);

  // 5. コマンド登録
  context.subscriptions.push(
    vscode.commands.registerCommand('torii.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'torii');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('torii.clearHistory', () => {
      if (provider) {
        provider.clearHistory();
        vscode.window.showInformationMessage('Torii: Chat history cleared');
      }
    })
  );

  // Pro アップグレードコマンド
  context.subscriptions.push(
    vscode.commands.registerCommand('torii.upgradePro', () => {
      vscode.env.openExternal(vscode.Uri.parse(LEMONSQUEEZY_CHECKOUT_URL));
    })
  );

  // Ollama 自動セットアップコマンド
  context.subscriptions.push(
    vscode.commands.registerCommand('torii.setupOllama', async () => {
      const choice = await vscode.window.showQuickPick(
        ['はい、セットアップする', 'いいえ'],
        { title: 'Ollama ローカルLLMのセットアップ', placeHolder: 'ローカルLLM（Ollama）をセットアップしますか？' }
      );
      if (choice !== 'はい、セットアップする') return;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Ollama セットアップ', cancellable: false },
        async (progress) => {
          await runOllamaSetup((p) => {
            progress.report({ message: p.message });
            provider?.sendOllamaProgress(p);
          });
        }
      );
    })
  );

  // 無料体験期間: 初回起動日時を記録（べき等）
  await licenseManager.initFreeTrial(context);

  // ライセンス起動時チェック（バックグラウンド）
  licenseManager.check(context).then(async (status) => {
    updateLicenseBadge(context, status);
    const trialDaysRemaining = await licenseManager.getTrialDaysRemaining(context);
    provider?.sendLicenseStatus(status, trialDaysRemaining);
  }).catch((err) => {
    // 例外時はデフォルト 'free'（安全側に倒す）
    console.error('[Torii] License check failed:', err);
    provider?.sendLicenseStatus('free', null);
  });

  // β期間中の告知（Pro機能は無料で使用可能）
  const betaNoticeKey = 'pettalBetaNoticeShown';
  const alreadyShown = context.globalState.get<boolean>(betaNoticeKey);
  if (!alreadyShown) {
    vscode.window.showInformationMessage(
      '🎉 Torii β版へようこそ！β期間中はエージェントループを含むPro機能がすべて無料でご利用いただけます。現在はmacOSを優先サポートしています。Windowsは今後対応予定です。',
    );
    context.globalState.update(betaNoticeKey, true);
  }

  console.log('[Torii] Extension activated successfully');
}

export function deactivate() {
  console.log('[Torii] Deactivating extension...');

  if (serverPort !== undefined) {
    stopServer();
  }

  disposeStorage();
  disposeStatusBar();
  disposeTerminal();

  provider?.dispose();
  provider = undefined;

  console.log('[Torii] Extension deactivated');
}