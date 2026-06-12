import * as vscode from 'vscode';
import { getGlobalMonthlyBudget } from './storage';
import { EXTENSION_DISPLAY_NAME, DEFAULT_EXCHANGE_RATE } from '../constants';
import type { LicenseStatus } from '../constants';
import { getTrialDaysRemaining } from './licenseManager';

let statusBarItem: vscode.StatusBarItem | undefined;
let licenseBarItem: vscode.StatusBarItem | undefined;

export function registerStatusBar(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.name = EXTENSION_DISPLAY_NAME;
  statusBarItem.command = 'torii.openSettings';
  context.subscriptions.push(statusBarItem);
  statusBarItem.show();

  licenseBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99
  );
  licenseBarItem.name = `${EXTENSION_DISPLAY_NAME} License`;
  licenseBarItem.text = '$(unlock) Free';
  licenseBarItem.tooltip = 'Torii: Freeプラン — クリックでアップグレード';
  licenseBarItem.command = 'torii.upgradePro';
  context.subscriptions.push(licenseBarItem);
  licenseBarItem.show();
}

export async function updateBudgetDisplay(context: vscode.ExtensionContext): Promise<void> {
  if (!statusBarItem) return;

  try {
    const budget = await getGlobalMonthlyBudget();
    if (budget.total_cost_usd > 0) {
      const costJpy = budget.total_cost_usd * DEFAULT_EXCHANGE_RATE;
      statusBarItem.text = `$(credit-card) $${budget.total_cost_usd.toFixed(2)} / ¥${costJpy.toFixed(0)}`;
      statusBarItem.tooltip = `Torii — 今月のAPIコスト(全プロジェクト合計): $${budget.total_cost_usd.toFixed(2)} / ¥${costJpy.toFixed(0)} (${budget.total_tokens.toLocaleString()} tokens)`;
    } else {
      statusBarItem.text = `$(pulse) Torii`;
      statusBarItem.tooltip = 'Torii — 今月のAPIコストはまだありません';
    }
  } catch {
    statusBarItem.text = `$(pulse) Torii`;
    statusBarItem.tooltip = 'Torii';
  }
}

export async function updateLicenseBadge(context: vscode.ExtensionContext, status: LicenseStatus): Promise<void> {
  if (!licenseBarItem) return;

  switch (status) {
    case 'valid':
      licenseBarItem.text = '$(verified) Pro';
      licenseBarItem.tooltip = 'Torii: Proプラン有効';
      licenseBarItem.command = 'torii.openSettings';
      break;
    case 'grace':
      licenseBarItem.text = '$(verified) Pro (猶予中)';
      licenseBarItem.tooltip = 'Torii: オフライン猶予期間中。ネットワーク接続後に再検証されます。';
      licenseBarItem.command = 'torii.openSettings';
      break;
    case 'trial': {
      const trialDaysRemaining = await getTrialDaysRemaining(context);
      const daysLeft = Math.max(1, trialDaysRemaining ?? 1);
      licenseBarItem.text = `$(clock) Pro体験 残${daysLeft}日`;
      licenseBarItem.tooltip = `Torii: Pro体験期間中（残り${daysLeft}日）。クリックでProプランへ。`;
      licenseBarItem.command = 'torii.upgradePro';
      break;
    }
    case 'trial_expired':
      licenseBarItem.text = '$(star-empty) Pro体験終了';
      licenseBarItem.tooltip = 'Torii: Pro体験期間が終了しました — クリックしてProプランへ';
      licenseBarItem.command = 'torii.upgradePro';
      break;
    case 'expired':
      licenseBarItem.text = '$(error) 期限切れ';
      licenseBarItem.tooltip = 'Torii: ライセンス期限切れ — クリックしてプランを更新';
      licenseBarItem.command = 'torii.upgradePro';
      break;
    default: // free / invalid
      licenseBarItem.text = '$(unlock) Free';
      licenseBarItem.tooltip = 'Torii: Freeプラン — クリックでアップグレード';
      licenseBarItem.command = 'torii.upgradePro';
  }
}

export function disposeStatusBar(): void {
  statusBarItem?.dispose();
  statusBarItem = undefined;
  licenseBarItem?.dispose();
  licenseBarItem = undefined;
}
