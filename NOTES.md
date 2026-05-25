# Torii — 未決事項・設計メモ

## 解決済み事項

1. **価格設定**: ¥980/月 に決定（GitHub Copilotより安いライン）。7日間無料トライアル付き
2. **`write_file` の承認フロー**: `autoApplyFiles` フラグで制御（解決済み）
3. **Ollamaがtool callingに対応しない場合の体験**: エラーメッセージ表示（解決済み）
4. **OSSとして公開するリポジトリ名**: `torii` または `torii-vscode` に変更
5. **VS Code Marketplace badge**: 説明文にPro機能を明記する方針に決定
6. **Marketplace ID**: `pettal.torii`（publisher: `pettal`、name: `torii`）
7. **LemonSqueezyアカウント**: `2dachshund`
8. **アイコン**: Variant C（鳥居＋ダックスフンドシルエット、赤）
9. **Zenn記事**: 配布と同日公開予定

---

## ライセンス認証（未実装）

### LemonSqueezy連携フロー

```typescript
// 起動時
const status = await licenseManager.check(context);
if (status === 'invalid') {
  // Webviewにライセンスキー入力画面を表示
}

// ライセンスキー入力
await licenseManager.activate(context, inputKey);
// → POST https://api.lemonsqueezy.com/v1/licenses/activate
//    { license_key: key, instance_name: vscode.env.machineId }
// → 成功: SecretStorageに保存、24時間キャッシュ

// 日次チェック（バックグラウンド）
// → POST https://api.lemonsqueezy.com/v1/licenses/validate
//    { license_key: key, instance_id: instanceId }
```

### ライセンスステータス
```typescript
type LicenseStatus =
  | 'valid'    // アクティブなPro
  | 'free'     // 未登録（無料版）
  | 'expired'  // サブスクリプション期限切れ
  | 'invalid'  // 無効なキー
  | 'grace'    // オフライン猶予期間（7日）
```

### 機能フラグとの連携
```typescript
const license = getLicenseStatus(context);
if (license !== 'valid' && license !== 'grace') {
  // ProアップグレードへのCTAを表示
  return;
}
// エージェントループ実行
```

### 実装メモ
- 機体識別子: `vscode.env.machineId`（1ライセンス = 2デバイスまで許可予定）
- オフライン猶予期間: 最後の認証成功から7日間はキャッシュで動作
- LemonSqueezyは日本向け消費税（JCT）を自動処理してくれる

---

## ロードマップ

### v0.3.0（配布準備）
- [ ] ライセンス認証（LemonSqueezy連携）
- [ ] 機能フラグ（Free/Pro分岐）
- [ ] Expressセキュリティ強化（またはExtension Host直接実行への移行）

### v0.4.0以降（成長フェーズ）
- [ ] チームプラン（ライセンス管理）
- [ ] 日本語コメント自動付与オプション
- [ ] 管理ダッシュボード（チーム向けAPI利用量）
