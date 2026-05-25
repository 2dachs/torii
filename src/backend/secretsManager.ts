import * as vscode from 'vscode';
import { SECRET_API_KEY, CONFIG_SECTION } from '../constants';

/**
 * VS Code SecretStorage ラッパー
 * OSのキーチェーン（macOS Keychain / Windows Credential Manager）に安全に保存する
 */
export function getSecretsManager(context: vscode.ExtensionContext) {
  return {
    /**
     * シークレットを保存
     */
    async store(key: string, value: string): Promise<void> {
      await context.secrets.store(key, value);
    },

    /**
     * シークレットを取得
     */
    async get(key: string): Promise<string | undefined> {
      return context.secrets.get(key);
    },

    /**
     * シークレットを削除
     */
    async delete(key: string): Promise<void> {
      await context.secrets.delete(key);
    },

    /**
     * APIキーが設定されているか確認
     */
    async hasApiKey(): Promise<boolean> {
      const key = await context.secrets.get(SECRET_API_KEY);
      return !!key;
    },

    /**
     * 全シークレットを列挙
     */
    async listKeys(): Promise<string[]> {
      const keys: string[] = [];
      // SecretStorage API には列挙メソッドがないため、
      // 既知のキーを確認する
      const apiKey = await context.secrets.get(SECRET_API_KEY);
      if (apiKey) keys.push(SECRET_API_KEY);
      return keys;
    },
  };
}

/**
 * Extension Host → Webview 間でシークレット操作を行うメッセージハンドラ
 * provider.ts から呼び出される想定
 */
export async function handleSecretMessage(
  context: vscode.ExtensionContext,
  command: string,
  key: string,
  value?: string
): Promise<{ ok: boolean; data?: string; error?: string }> {
  const secrets = getSecretsManager(context);

  try {
    switch (command) {
      case 'store':
        if (!value) return { ok: false, error: 'value is required for store' };
        await secrets.store(key, value);
        return { ok: true };
      case 'get':
        const val = await secrets.get(key);
        return { ok: true, data: val || '' };
      case 'delete':
        await secrets.delete(key);
        return { ok: true };
      default:
        return { ok: false, error: `Unknown command: ${command}` };
    }
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}