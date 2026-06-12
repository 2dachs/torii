# Torii — 未決事項・設計メモ

## 2026-06-12 コードレビュー結果

結論: `npm run vscode:prepublish` は成功するが、本番運用前にタスクID・予算集計・上位モデル再実行まわりの不整合を先に直すべき。

### 優先度高

1. **Agentモードの新規タスクID同期**
   - `POST /api/agent` は `taskId` 未指定時にサーバー側でタスクを作るが、Webviewへ `autoCreatedTaskId` 相当を返していない。
   - UIの `activeTaskId` が更新されず、Agentの次送信で別タスクが作られる可能性がある。
   - 対応案: SSEで `task_created` などのイベントを返し、Webview側で `activeTaskId` 更新と `loadTasks` を実行する。

2. **予算集計の workspaceId 不一致**
   - 通常の保存は `vscode.workspace.workspaceFolders[0].uri.toString()` ベース。
   - `/api/budget` は `fsPath` を使っており、プロジェクト予算表示が0扱い・ズレ表示になる可能性がある。
   - 対応案: workspaceId生成を共通関数化し、server/provider/storageで同じキーを使う。

3. **上位モデル再実行の設定反映不足**
   - `/api/chat/escalate` は `PROVIDERS` の固定 `models` と `defaultEndpoint` に寄っている。
   - OpenRouterの自由入力モデルやユーザー設定endpointが反映されにくい。
   - 対応案: `getProviderConfig` とVS Code設定から provider/model/endpoint を解決し、OpenRouterの任意モデルIDも許容する。

### 優先度中

4. **Agentモードの予算・モデル上限チェック不足**
   - チャット側には月額予算・モデル別上限チェックがあるが、Agent側はルーティング時の予算率が `0` 固定。
   - 高額モデルをAgentで長時間回すと、コスト透明性の売りとズレる。
   - 対応案: Agent実行前にも月額予算とモデル別上限をチェックし、必要ならサブモデルへフォールバックする。

5. **Webview直接ファイル書き込みが承認/diff経路を通らない**
   - Agentツールの `write_file` / `replace_in_file` はdiff承認を通る。
   - 一方、Webviewのファイルビューア編集は `MSG_WRITE_FILE` で直接書き込む。
   - 対応案: ユーザー操作由来でも、保存前に確認ダイアログまたはdiff表示を挟む。

6. **コマンドガードの過信リスク**
   - `run_command` は承認必須だが、実行は `shell: true`。
   - 正規表現ベースの危険コマンド検知なので、完全防止とは言えない。
   - 対応案: 公開説明は「代表的危険コマンドをブロック + 実行前承認」に留める。将来的には allowlist / parser ベースを検討する。

### 確認済み

- `npm run vscode:prepublish` は成功。
- 未コミット差分は `Torii-icon/` の追加のみだった。
- 古い「ライセンス認証（未実装）」メモは削除済み。

---

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

## ロードマップ

### v0.4.0以降（成長フェーズ）
- [ ] チームプラン（ライセンス管理）
- [ ] 日本語コメント自動付与オプション
- [ ] 管理ダッシュボード（チーム向けAPI利用量）
