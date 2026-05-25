import * as vscode from 'vscode';
import type { LicenseStatus } from '../constants';
import { FREE_TRIAL_DAYS } from '../constants';

// SecretStorage に保存するキー（改竄耐性のあるもの）
const SECRET_LICENSE_KEY   = 'torii_license_key';
const SECRET_INSTANCE_ID   = 'torii_instance_id';
const SECRET_VALID_UNTIL   = 'torii_license_valid_until';   // キャッシュ有効期限
const SECRET_LAST_VALIDATED = 'torii_last_validated';        // 最後のネットワーク検証時刻
const SECRET_INSTALL_DATE  = 'torii_install_date';           // トライアル開始日

const CACHE_TTL_MS    = 24 * 60 * 60 * 1000;             // 24時間キャッシュ
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;         // オフライン猶予7日
const TRIAL_MS        = FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000;

// ベータ期間フラグ: LemonSqueezy審査完了後に false に戻す
export const BETA_FREE_PRO = true;

// SecretStorage への数値読み書きヘルパー
async function getSecretNum(ctx: vscode.ExtensionContext, key: string): Promise<number> {
  const v = await ctx.secrets.get(key);
  return v ? parseInt(v, 10) || 0 : 0;
}
async function setSecretNum(ctx: vscode.ExtensionContext, key: string, val: number): Promise<void> {
  await ctx.secrets.store(key, String(val));
}

const LS_BASE = 'https://api.lemonsqueezy.com/v1/licenses';

/**
 * 初回起動時にインストール日時を SecretStorage に記録する。
 * すでに記録済みの場合は何もしない。
 */
export async function initFreeTrial(context: vscode.ExtensionContext): Promise<void> {
  const existing = await getSecretNum(context, SECRET_INSTALL_DATE);
  if (!existing) {
    await setSecretNum(context, SECRET_INSTALL_DATE, Date.now());
  }
}

/** 無料体験の残り日数を返す（0以下 = 期限切れ、null = ライセンス済みユーザー） */
export async function getTrialDaysRemaining(context: vscode.ExtensionContext): Promise<number | null> {
  const installDate = await getSecretNum(context, SECRET_INSTALL_DATE);
  if (!installDate) return null;
  const remaining = Math.ceil((installDate + TRIAL_MS - Date.now()) / (1000 * 60 * 60 * 24));
  return remaining;
}

/** 現在のライセンスステータスを返す（キャッシュ優先、ネットワーク不使用） */
export async function getStatus(context: vscode.ExtensionContext): Promise<LicenseStatus> {
  if (BETA_FREE_PRO) return 'trial';
  // ── 有効なライセンスキャッシュがある ──
  const validUntil = await getSecretNum(context, SECRET_VALID_UNTIL);
  if (Date.now() < validUntil) return 'valid';

  // ── ライセンスキーが保存されている ──
  const key = await context.secrets.get(SECRET_LICENSE_KEY);
  if (key) {
    const lastValidated = await getSecretNum(context, SECRET_LAST_VALIDATED);
    if (Date.now() - lastValidated < GRACE_PERIOD_MS) return 'grace';
    return 'expired';
  }

  // ── ライセンスなし → 無料体験期間チェック ──
  const installDate = await getSecretNum(context, SECRET_INSTALL_DATE);
  if (!installDate) return 'free'; // initFreeTrial 未呼び出し（通常は起こらない）

  const now = Date.now();
  // installDate が未来の場合は改竄とみなして期限切れ扱い
  if (installDate > now) return 'trial_expired';

  const elapsed = now - installDate;
  if (elapsed <= TRIAL_MS) return 'trial';
  return 'trial_expired';
}

/**
 * 起動時チェック: ライセンスキーがあればネットワーク検証してキャッシュを更新。
 * ライセンスがない場合は体験期間ステータスを返す。
 */
export async function check(context: vscode.ExtensionContext): Promise<LicenseStatus> {
  if (BETA_FREE_PRO) return 'trial';
  const key = await context.secrets.get(SECRET_LICENSE_KEY);
  if (!key) {
    // ライセンスなし → 体験期間ステータス
    const installDate = await getSecretNum(context, SECRET_INSTALL_DATE);
    if (!installDate) return 'free';
    const now = Date.now();
    if (installDate > now) return 'trial_expired'; // 改竄検知
    return (now - installDate) <= TRIAL_MS ? 'trial' : 'trial_expired';
  }

  const validUntil = await getSecretNum(context, SECRET_VALID_UNTIL);
  if (Date.now() < validUntil) return 'valid';

  return validate(context);
}

/** ライセンスキーを使って新規アクティベーション */
export async function activate(
  context: vscode.ExtensionContext,
  licenseKey: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${LS_BASE}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_key: licenseKey,
        instance_name: vscode.env.machineId,
      }),
    });

    const data: any = await res.json();

    if (!res.ok || data.error) {
      return { ok: false, message: data.error || `認証失敗 (${res.status})` };
    }

    await context.secrets.store(SECRET_LICENSE_KEY, licenseKey);
    await context.secrets.store(SECRET_INSTANCE_ID, data.instance?.id ?? '');
    await setSecretNum(context, SECRET_VALID_UNTIL, Date.now() + CACHE_TTL_MS);
    await setSecretNum(context, SECRET_LAST_VALIDATED, Date.now());

    return { ok: true, message: 'ライセンスを認証しました。Proプランが有効になりました。' };
  } catch (err: any) {
    return { ok: false, message: `ネットワークエラー: ${err.message}` };
  }
}

/** 保存済みキーを LemonSqueezy で再検証してキャッシュを更新 */
export async function validate(context: vscode.ExtensionContext): Promise<LicenseStatus> {
  const key = await context.secrets.get(SECRET_LICENSE_KEY);
  if (!key) return await getStatus(context);

  const instanceId = await context.secrets.get(SECRET_INSTANCE_ID);

  try {
    const res = await fetch(`${LS_BASE}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_key: key,
        ...(instanceId ? { instance_id: instanceId } : {}),
      }),
    });

    const data: any = await res.json();

    if (res.ok && data.valid) {
      await setSecretNum(context, SECRET_VALID_UNTIL, Date.now() + CACHE_TTL_MS);
      await setSecretNum(context, SECRET_LAST_VALIDATED, Date.now());
      return 'valid';
    }

    if (data.error?.includes('expired') || data.status === 'expired') return 'expired';
    return 'invalid';
  } catch {
    const lastValidated = await getSecretNum(context, SECRET_LAST_VALIDATED);
    if (Date.now() - lastValidated < GRACE_PERIOD_MS) return 'grace';
    return 'expired';
  }
}

/** ライセンスをローカルから削除（LemonSqueezy側は変更なし） */
export async function deactivateLocally(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(SECRET_LICENSE_KEY);
  await context.secrets.delete(SECRET_INSTANCE_ID);
  await context.secrets.delete(SECRET_VALID_UNTIL);
  await context.secrets.delete(SECRET_LAST_VALIDATED);
}
