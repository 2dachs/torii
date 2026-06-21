# Torii — 未決事項・設計メモ

## 現在の実装状況

### 実装済み
- エージェント変更の revert 手段を追加済み
- Markdown レンダリングを追加済み
- チャットモードの応答ストリーミングを追加済み
- 初回オンボーディングを追加済み
- `run_command` 承認に allowlist を追加済み
- モデル設定の概念を整理済み
- Webview 直保存を差分確認モーダル経由に変更済み
- Agent モードにも予算・モデル上限チェックを適用済み
- Agent の自動タスク生成はライセンス確認後に実行するよう修正済み
- 予算集計の workspaceId を統一済み
- 上位モデル再実行の設定反映を修正済み

### 未実装
- `@` ファイルメンション / 選択範囲送信
- タスクのリネーム・削除・検索 UI
- 履歴クリア時の確認ダイアログ
- エラー後のリトライ導線
- `run_command` のタイムアウト可変化
- コンテキスト使用量の常時表示
- `.torii-todo.md` のリポジトリ汚染対策
- `read_file` キャッシュとユーザー編集の競合解消
- コマンドガードの強化

## 2026-06-21 Webview直保存の差分確認化

- `webview/src/App.tsx`: ファイルビューアの保存を即時実行から差分確認モーダル経由に変更
- `webview/src/styles.css`: 変更前 / 変更後の2カラム比較表示を追加
- 直接保存時の体験を、Agent の `write_file` / `replace_in_file` と同じ「確認してから適用」に寄せた

## 2026-06-13 UX改善分析 + Codex型エージェントアプリ化の検討

コードベース全体（App.tsx / server.ts / tools.ts / agentLoop.ts / provider.ts）を精査した結果。

### UX問題点（優先度: 高）

1. **チャットモードに応答ストリーミングがない** — `callOpenAICompatible()` が全文一括返却。長い回答で「考え中…」を30秒以上見せる。Agentモード（SSE済み）より無料側が遅く感じる逆転現象
2. **初回オンボーディング不在** — キー未設定で送信→エラー→設定画面の流れ。「コストが怖い初心者」がターゲットなのに最初の体験が失敗から始まる
   - 対応案: 初回起動ウィザード（Ollama無料スタートを第一選択肢に。`ollamaSetup.ts` 流用可）

### UX問題点（優先度: 中）

6. **@ファイルメンション・選択範囲送信がない** — コンテキスト指定がアクティブエディタ全文添付のみ。スラッシュサジェストの仕組みを流用して `@` ファイルサジェスト追加可能
7. **タスクのリネーム・削除・検索がUIにない** — `storage.ts` に `deleteTask` 実装済みだがUIから呼べない
8. **履歴クリア🗑️が確認なしで全削除** — `provider.ts` で即実行。破壊的操作に確認ダイアログなし
9. **エラー後のリトライ導線がない** — 再試行ボタン・レート制限時のフォールバック提案なし
10. **run_commandタイムアウト120秒固定** — `npm install` 等で失敗。devサーバー等の常駐プロセス非対応
11. **コンテキスト使用量の常時表示がない** — 80%警告のみで、超過時は古いメッセージが黙って消える。ステータスバーにトークンゲージを
12. **`.torii-todo.md` がリポジトリを汚す** — システムプロンプトでワークスペース直下に書かせている。コミット混入事故リスク。ツール化してUI側チェックリスト表示に変えるべき
13. **read_fileキャッシュがユーザー編集と競合** — `tools.ts` のキャッシュがタスク中保持され、ユーザーがエディタで保存した変更を無視。mtimeチェックで破棄を

### UX問題点（優先度: 低）

- 絵文字アイコン → Codicons化でネイティブ感
- ユーザーメッセージの編集・再送信機能
- done時の「累計 $x」表示が実際はそのターンのコスト（文言修正）
- 画像添付不可時にボタンが消えるだけで理由提示なし

### Codex型エージェントアプリ化 — 結論: 可能、現構造は移植に有利

vscode API依存の調査結果:

| モジュール | vscode依存 | 移植性 |
|---|---|---|
| `agentLoop.ts` | ゼロ | そのまま使える |
| `tools.ts` | OutputChannel・diff表示の2箇所のみ | 注入で分離容易 |
| `commandGuard` / `routingRules` / `pettalConfig` | ほぼゼロ | そのまま |
| `router.ts` / `storage.ts` | 設定読出し・初期化パスのみ | 注入で対応 |
| `server.ts` / `provider.ts` | 濃い（UI層） | CLI版では不要 |
| `licenseManager.ts` | SecretStorage・machineId | keytar / node-machine-id で代替 |

推奨ステップ:
1. **コア抽出** — `@torii/core` パッケージ化（monorepo）。vscode依存箇所を `ToriiHost` インターフェース（requestApproval / log / readConfig / getSecret）として注入式に。既存拡張をcore利用に置き換えてリグレッション確認
2. **Ink製CLI** — ターミナル用ReactでCLIフロントエンド。承認カード→Y/n+色付きdiff、設定→`~/.torii/config.json` + 既存`.pettal`、キー→keytar。コスト円表示・予算バー・プライバシールーティングはcore側なのでそのまま生きる。**「コストが円で見えるCodex CLI」は空白ポジション**
3. **（任意）GUI** — Tauri/Electronなら既存webview Reactをほぼ再利用可（postMessage→IPCアダプタのみ）。市場優先度は CLI > GUI

注意点:
- `@cline/agents` のライセンス・再配布条件をCLI公開前に確認
- CLIのトライアル管理はファイルベースになり改ざん耐性低下（割り切り）
- CLIでは run_command のサンドボックス強化を検討

### 推奨着手順

①チャットストリーミングは実装済み → ②次は `@` ファイルメンション / 選択範囲送信 か タスク管理UI（ユーザー獲得・継続率に直結し、実装リスクが低い順）。Codex化はコア抽出（Step 1）が拡張本体のリファクタにもなるため、UX改善と並行可能。

---

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
   - 対応済み: `getCurrentWorkspaceId()` で `uri.toString()` に統一し、`/api/budget` / model usage / escalate fallback / Webview provider のキーを揃えた。

3. **上位モデル再実行の設定反映不足**
   - `/api/chat/escalate` は `PROVIDERS` の固定 `models` と `defaultEndpoint` に寄っている。
   - OpenRouterの自由入力モデルやユーザー設定endpointが反映されにくい。
   - 対応案: `getProviderConfig` とVS Code設定から provider/model/endpoint を解決し、OpenRouterの任意モデルIDも許容する。
   - 対応済み: 再実行先は設定済み provider/model を優先し、固定モデル一覧にないOpenRouter任意モデルIDも許容。endpoint/maxTokensもプロバイダー別VS Code設定から取得する。

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
- 古い「ライセンス認証（未実装）」メモは削除済み。
- Agent の自動タスク生成はライセンス確認後に行うよう修正し、拒否時に空タスクが残らないようにした。
- Agent モードにも予算・モデル上限の共通判定を入れた。

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
