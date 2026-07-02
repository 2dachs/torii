import * as vscode from 'vscode';
import { PettalPractitionerProvider, ToriiRuntime } from './webview/provider';
import { initStorage, disposeStorage } from './backend/storage';
import { startServer, stopServer } from './backend/server';
import { registerStatusBar, updateBudgetDisplay, updateLicenseBadge, disposeStatusBar } from './backend/statusBar';
import { disposeTerminal } from './backend/terminalBridge';
import { runOllamaSetup } from './backend/ollamaSetup';
import * as licenseManager from './backend/licenseManager';
import { LEMONSQUEEZY_CHECKOUT_URL, CONFIG_SECTION, CONFIG_SECTION_LEGACY } from './constants';
import { resetToriiLocalData } from './backend/resetLocalData';

let provider: PettalPractitionerProvider | undefined;
let runtime: ToriiRuntime | undefined;
let startPromise: Promise<ToriiRuntime> | undefined;

/** 旧 pettalPractitioner.* 設定キーを torii.* へ移行（初回起動時のみ実行） */
async function migrateConfig() {
  const legacy = vscode.workspace.getConfiguration(CONFIG_SECTION_LEGACY);
  const current = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const keys = [
    'provider', 'autoRouting', 'monthlyBudget', 'autoApplyFileChanges',
    'commandAllowlist',
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

async function ensureToriiStarted(context: vscode.ExtensionContext): Promise<ToriiRuntime> {
  if (runtime) return runtime;
  if (startPromise) return startPromise;

  startPromise = (async () => {
    try {
      console.log('[Torii] Starting runtime by explicit user action...');

      await migrateConfig();

      initStorage(context);
      console.log('[Torii] Storage initialized');

      const result = await startServer(context);
      runtime = { port: result.port, token: result.token };
      console.log(`[Torii] Backend server started on port ${runtime.port}`);

      registerStatusBar(context);
      await updateBudgetDisplay(context);

      await licenseManager.initFreeTrial(context);
      void licenseManager.check(context).then(async (status) => {
        await updateLicenseBadge(context, status);
        const trialDaysRemaining = await licenseManager.getTrialDaysRemaining(context);
        provider?.sendLicenseStatus(status, trialDaysRemaining);
      }).catch((err) => {
        console.error('[Torii] License check failed:', err);
        provider?.sendLicenseStatus('free', null);
      });

      console.log('[Torii] Runtime started successfully');
      return runtime;
    } catch (err) {
      console.error('[Torii] Runtime start failed:', err);
      runtime = undefined;
      try { await stopServer(); } catch { /* ignore */ }
      try { await disposeStorage(); } catch { /* ignore */ }
      try { disposeStatusBar(); } catch { /* ignore */ }
      try { disposeTerminal(); } catch { /* ignore */ }
      throw err;
    } finally {
      startPromise = undefined;
    }
  })();

  return startPromise;
}

async function stopToriiRuntime(): Promise<void> {
  runtime = undefined;
  startPromise = undefined;
  await stopServer();
  await disposeStorage();
  disposeStatusBar();
  disposeTerminal();
}

export async function activate(context: vscode.ExtensionContext) {
  console.log('[Torii] Activating extension...');

  // Safe Shell版: activate時はWebview Providerとコマンドだけ登録し、
  // storage/server/status/licenseはユーザーがTorii起動ボタンを押すまで開始しない。
  provider = new PettalPractitionerProvider(context, () => ensureToriiStarted(context));
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('torii-view', provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('torii.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'torii');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('torii.clearHistory', async () => {
      await ensureToriiStarted(context);
      if (provider) {
        await provider.clearHistory();
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

      await ensureToriiStarted(context);
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

  context.subscriptions.push(
    vscode.commands.registerCommand('torii.resetLocalData', async () => {
      const choice = await vscode.window.showWarningMessage(
        'Toriiのローカルデータをtimestamp付きバックアップへ退避します。チャット履歴・使用量・ワークスペース別状態が一時的に初期化されます。',
        { modal: true },
        'バックアップして退避',
      );
      if (choice !== 'バックアップして退避') return;

      try {
        await stopToriiRuntime();
        const targets = await resetToriiLocalData(context);
        provider?.showSafeShell('ローカルデータをバックアップへ退避しました。Toriiを起動すると新しいデータで開始します。');
        if (targets.length === 0) {
          vscode.window.showInformationMessage('Torii: 退避対象のローカルデータはありませんでした');
          return;
        }
        const labels = targets.map((target) => `${target.label}: ${target.backupPath}`).join('\n');
        vscode.window.showInformationMessage(`Torii: ローカルデータをバックアップへ退避しました\n${labels}`);
      } catch (err: any) {
        console.error('[Torii] Failed to reset local data:', err);
        vscode.window.showErrorMessage(`Torii: ローカルデータ退避に失敗しました: ${err?.message || String(err)}`);
      }
    })
  );

  console.log('[Torii] Safe Shell registered successfully');
}

export async function deactivate() {
  console.log('[Torii] Deactivating extension...');

  await stopToriiRuntime();

  provider?.dispose();
  provider = undefined;

  console.log('[Torii] Extension deactivated');
}
