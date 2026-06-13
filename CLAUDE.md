# Torii — Claude Code 行動指針

## ドキュメント更新の原則

**コードを変更したら、関連ドキュメントを必ず同時に更新する。**

- 機能追加・修正・設定変更を行ったら、以下を確認して必要箇所を更新する：
  - `CLAUDE.md` — 実装済み機能リスト、既知の課題テーブル、変更ログ
  - `DESIGN.md` — 実装状態（v0.x.x）、既知の問題テーブル、ロードマップのチェックボックス
  - `README.md` — 機能一覧に変化がある場合のみ
- 変更ログは `CLAUDE.md` の「修正・変更ログ」に日付付きで追記する
- 指示されなくても行う。コード変更とドキュメント更新は一体のタスク

---

## 自律調査の原則（最重要）

**質問する前に必ずツールで調べる。**

- ファイルが存在するか不明 → `find` / `grep` で探してから答える（「存在しないかもしれない」は禁止）
- パスが曖昧 → `find . -name "*.tsx" -iname "*keyword*"` で確認する
- CLAUDE.mdに書いていないことも、コードを読んで自分で把握する
- 「お手数ですが教えていただけますか」は、コードを見ても本当にわからない時だけ

---

## 公開情報

| 項目 | 値 |
|---|---|
| Marketplace ID | `pettal.torii`（publisher: `pettal`） |
| アイコン | Variant C（鳥居＋ダックスフンドシルエット、赤） |
| LemonSqueezy | アカウント: `2dachshund` |
| Zenn記事 | 配布と同日公開予定 |

---

## プロダクトビジョン

「日本の開発者向けに作られた、コストが見えるAIコーディングエージェント」

### ターゲット
- VSCodeを使う日本人エンジニア（個人・フリーランス・スタートアップ）
- AIコーディングツールに興味はあるが月額コストが怖い人
- 社内コードをクラウドに投げることに抵抗がある企業の開発者

### 主な差別化
1. **コスト透明性** — 1会話ごとのコストと月間合計を円で表示
2. **日本語ファーストUX** — UIもエラーメッセージも全体が日本語
3. **プライバシー自動保護** — 機密キーワードを含むプロンプトを自動でOllama（ローカル）にルーティング
4. **エージェントループ** — ファイル読み書き・コマンド実行を自律的に行う

---

## 課金モデル（フリーミアム）

### 無料（OSS）
- マルチプロバイダー対応（OpenAI / DeepSeek / Anthropic / Ollama）
- 予算管理・JPY表示・予算バー
- 自動ルーティング（PromptRouter）
- チャットモード

### Pro（¥980/月・7日間Pro体験）
- エージェントループ（ファイル操作・コマンド実行・自律タスク）
- ストリーミング応答
- 優先サポート

**課金インフラ**: LemonSqueezy（JCT自動処理）+ ライセンスキー検証。アカウント名: `2dachshund`。

---

## プロジェクト構成

```
src/                          # VSCode拡張機能（Extension Host / Node.js）
  extension.ts                # エントリーポイント
  constants.ts                # 定数・プロバイダー定義
  backend/
    agentLoop.ts              # エージェントループ（LLM呼び出し→ツール実行）
    approvalManager.ts        # 承認待ちPromise管理
    tools.ts                  # write_file / run_command / read_file 等の実装
    server.ts                 # Express + SSE サーバー（ポート自動割当）
    commandGuard.ts           # コマンドの安全チェック（危険パターンブロック）
    secretsManager.ts         # VS Code SecretStorage ラッパー（APIキー保管）
    terminalBridge.ts         # ターミナル連携
    statusBar.ts              # ステータスバー（予算表示）
    storage.ts                # JSONファイルベースの永続化（タスク・メッセージ・予算）
    ollamaSetup.ts            # Ollamaインストール補助
    lib/
      router.ts               # マルチプロバイダー自動ルーティング（PromptRouter）
      routingRules.ts         # ルーティングルール管理（カスタムルール含む）
      pettalConfig.ts         # .pettal 設定ファイル読み書き
  webview/
    provider.ts               # WebviewProvider（postMessage / SSE中継）

webview/                      # React フロントエンド（Vite）
  src/
    App.tsx                   # メインUI（全状態管理、約1400行）
    styles.css                # スタイル（Catppuccin Mocha準拠）
    types.ts                  # 型定義（AgentEvent等）
```

---

## ビルド

```bash
npm run compile          # 拡張機能本体（TypeScript → JS）
npm run build:webview    # React UIをビルド（webview/内で vite build）
npm run vscode:prepublish  # 両方まとめてビルド
```

> `npm run build` は存在しない。両方ビルドするには `vscode:prepublish` を使う。

---

## アーキテクチャの要点

- **2プロセス構成**: Extension Host（Node.js）と Webview（ブラウザ）は別プロセス
- **通信**: Extension Host ↔ Webview は `postMessage` 経由。エージェントイベントはSSE（`/api/agent`）で流れる
- **承認フロー**: `agentLoop` → `onEvent(approval_required)` → SSE → `provider.ts` → `postMessage` → `App.tsx`（`pendingApprovals`に追加）→ ユーザーがApply/キャンセル → `POST /api/agent/approve`
- **autoApplyFiles**: `false`の場合のみ `write_file` / `run_command` で承認フローが走る
- **ストレージ**: SQLiteではなくJSONファイル（`storage.ts`）。アトミック書き込みで破損防止

---

## 実装済み機能

- マルチプロバイダー: OpenAI / DeepSeek / Anthropic / Ollama / Google Gemini / OpenRouter
- 予算管理: 月間USD/JPY換算・バー表示・スコープ切替（グローバル/プロジェクト）
- 為替レート: 自動取得（1時間キャッシュ）+ 手動設定フォールバック
- 自動ルーティング（PromptRouter）: プライバシー/セキュリティ/難易度/予算に応じてモデル自動切替
- エージェントループ: `read_file` / `write_file` / `replace_in_file` / `run_command` / `list_directory` / `search_files` / `grep`
- ストリーミング表示（SSE）
- 承認フロー: コマンド実行・ファイル書き込み時のワンクリック承認UI
- タスク管理: JSON永続化、チャット履歴の複数タスク管理
- コマンドガード: 危険なコマンドパターンをブロック
- 画像添付対応（マルチモーダルモデル + Gemini自動橋渡し）
- エディタ内容の添付（現在ファイルをコンテキストに追加）
- IME対応（日本語入力中のEnter誤送信防止）
- カスタムルーティングルール（キーワード→プロバイダー指定）
- .pettal プロジェクト設定ファイル対応
- モデル別コスト上限・セッション統計
- 上位モデルでの再実行（エスカレーション）
- Ollama自動セットアップ補助
- ライセンス認証: LemonSqueezy連携（activate/validate）・trial/valid/grace/expired分岐・オフライン猶予7日
- コンテキストウィンドウ管理: トークン推定・上限80%超で警告・超過時に古メッセージ自動削除
- プライバシールーティング除外ワード: `token` 等のプログラミング用語の誤検知を防止
- エージェントエンジン: `@cline/agents` を使用（Cline SDK移行完了）

---

## 既知の課題・未実装事項

| 項目 | 状態 | 詳細 |
|------|------|------|
| ライセンス認証 | **実装済み** | `licenseManager.ts` にてLemonSqueezy連携（activate/validate）・trial/valid/grace/expired分岐・24hキャッシュ・7日間オフライン猶予を実装済み。`extension.ts` で起動時に `initFreeTrial` / `check` を呼び出し |
| Expressセキュリティ | **修正済み** | `server.ts` で `127.0.0.1` にバインド（`server.listen(port, '127.0.0.1', ...)`）済み。外部アクセス不可 |
| コンテキストウィンドウ管理 | **実装済み** | `agentLoop.ts` に `getTokenLimit` / `estimateTokens` / `WARNING_THRESHOLD` を実装。上限の80%超で `context_warning` イベント送出、超過時は古いメッセージを自動削除 |
| `token` キーワード誤検知 | **対処済み** | `router.ts` に除外ワードリストを実装。除外ワードが含まれる場合はプライバシールーティングをスキップする仕組みを追加済み |
| Cline SDK移行 | **完了** | `agentLoop.ts` で `@cline/agents` を使用中。`Agent` クラスを動的インポートして利用している |

---

## 修正・変更ログ

### 2026-06-13
- **バージョン 0.4.1 作成**:
  - **`webview/src/App.tsx` / `package.json`**: 設定画面の重複した「現在のモデル / メインモデル」を「使用モデル」に一本化し、サブモデル表記を「節約モデル」に変更。内部設定キーは互換性維持のため `main*` / `sub*` を継続利用
  - **`package.json` / `package-lock.json`**: VSIX配布用にバージョンを `0.4.1` へ更新
  - **配布物**: `torii-0.4.1.vsix` を作成済み

### 2026-06-13
- **バージョン 0.4.0 作成**:
  - **`src/backend/tools.ts` / `src/backend/server.ts` / `src/webview/provider.ts` / `webview/src/App.tsx`**: Agentのファイル変更Undo導線を追加。`write_file` / `replace_in_file` 適用後に旧内容へ戻せる
  - **`src/backend/tools.ts` / `src/webview/provider.ts` / `webview/src/App.tsx` / `package.json`**: run_command allowlistを追加。承認カードの「今後も許可」で完全一致コマンドを自動許可できる
  - **`package.json` / `package-lock.json`**: VSIX配布用にバージョンを `0.4.0` へ更新
  - **配布物**: `torii-0.4.0.vsix` を作成済み

### 2026-06-13
- **バージョン 0.3.2 作成**:
  - **`src/backend/server.ts` / `webview/src/App.tsx`**: 上位モデル再実行でOpenRouterの任意モデルIDを許容。再実行時のendpoint/maxTokensもプロバイダー別VS Code設定から取得するよう修正
  - **`src/backend/workspace.ts` / `src/webview/provider.ts`**: workspaceId生成を `uri.toString()` に統一し、プロジェクト予算表示と保存時のキー不一致を修正
  - **`src/backend/server.ts` / `webview/src/App.tsx` / `webview/src/types.ts`**: Agentモードで自動作成したタスクIDをSSEでWebviewへ同期し、次送信で別タスクが作られる問題を修正
  - **`package.json` / `package-lock.json`**: VSIX配布用にバージョンを `0.3.2` へ更新
  - **配布物**: `torii-0.3.2.vsix` を作成済み
- **Agentファイル変更Undo導線を追加**:
  - **`src/backend/tools.ts` / `src/backend/server.ts` / `src/webview/provider.ts` / `webview/src/App.tsx`**: Agentの `write_file` / `replace_in_file` 適用時に旧内容checkpointを保存し、進捗UIの「元に戻す」ボタンから復元できるよう対応
- **run_command allowlistを追加**:
  - **`src/backend/tools.ts` / `src/webview/provider.ts` / `webview/src/App.tsx` / `package.json`**: run_command承認カードに「今後も許可」を追加。完全一致コマンドを `torii.commandAllowlist` に保存し、危険コマンドはallowlist登録済みでも `commandGuard` でブロックする
- **モデル設定UIを整理**:
  - **`webview/src/App.tsx` / `package.json`**: 設定画面の重複した「現在のモデル / メインモデル」を「使用モデル」に一本化し、サブモデル表記を「節約モデル」に変更。内部設定キーは互換性維持のため `main*` / `sub*` を継続利用

### 2026-06-12
- **Proプラン本番運用への切り替え**:
  - **`src/backend/licenseManager.ts`**: LemonSqueezy審査通過に伴い `BETA_FREE_PRO` を `false` に変更。全ユーザーを強制trial扱いにするβ全開放を終了し、通常の7日間Pro体験 + Proライセンス検証へ移行
  - **`src/extension.ts`**: β期間中のPro機能開放告知を削除。起動時は `initFreeTrial` / `check` による通常ライセンス判定のみ実行
  - **`src/backend/statusBar.ts`**: Freeプランのツールチップからβ無料表記を削除。体験残日数を `SecretStorage` のインストール日時から算出するよう修正
  - **`src/webview/provider.ts`**: Webviewからの `torii.upgradePro` コマンドも購入URLを開けるよう対応。ライセンス認証後のステータスバー更新を非同期化し、Webviewへ残日数も再送信
  - **`package.json` / `package-lock.json`**: Marketplace再公開用にバージョンを `0.3.1` へ更新
  - **文言調整**: ユーザー向けの体験中表現を「Pro体験期間」に統一。起動直後にtrial扱いで表示されないようWebview初期値を `free` に変更

### 2026-05-26
- **OpenRouter Agentモード「Invalid Responses API request」修正**:
  - **根本原因**: `PROVIDER_ID_MAP['openrouter']` が `'openai-native'` にマッピングされていたため、@cline/agents が @ai-sdk/openai の Responses API（`POST /v1/responses`）を呼び出していた。OpenRouter はこのエンドポイントをサポートしていないためエラーになっていた（チャットモードは `callOpenAICompatible()` で直接 `/chat/completions` を fetch するため問題なし）
  - **`src/backend/agentLoop.ts`**: `PROVIDER_ID_MAP['openrouter']` を `'openai-native'` → `'openrouter'` に変更。@cline/llms は openrouter を組み込みプロバイダーとして持ち、Chat Completions API を使用する
  - **`src/backend/agentLoop.ts`**: `defaultBaseUrls` に `openrouter: 'https://openrouter.ai/api/v1'` を追加。`isCustomEndpoint` 判定が正しく機能し、デフォルトエンドポイントでは `baseUrl` を渡さず、カスタムエンドポイントでのみオーバーライドするようになった

### 2026-05-25
- **OpenRouterモデル保存の完全修正（バージョン 0.2.8）**:
  - **2層の競合バグを修正**:
    - **第1層**: 「使用」ボタンクリック時に `updateProviderConfig` と `MSG_UPDATE_MODEL_CONFIG` の2つのpostMessageを同時送信 → 1メッセージに統合（前回修正）
    - **第2層（今回修正）**: input の `onBlur`（フォーカス外れ）と「使用」ボタンの `onClick` が ほぼ同時に発火し、Extension Host が2つの `updateProviderConfig` を並行処理。onBlur 側のレスポンス（modelSlots のみ・model は VS Code config から stale な値で読み出し）が onClick 側の正しいレスポンスを後から上書きしていた
  - **`webview/src/App.tsx`**: `suppressSlotBlurRef = useRef<Record<string, boolean>>({})` を追加。「使用」ボタンの `onMouseDown`（onClick より前に発火）でフラグを立て、スロット入力の `onBlur` でフラグを検出してpostMessageをスキップすることで競合を排除
  - **`src/webview/provider.ts`**: `_configWriteQueue` を追加し、`MSG_UPDATE_PROVIDER_CONFIG` ハンドラをキュー経由で直列実行。たとえ並行してメッセージが届いてもシリアル処理されるため、後続ハンドラは前ハンドラの VS Code config 書き込み完了後に実行される

- **OpenRouterスロット表示消えるバグ根本修正（バージョン 0.2.7）**:
  - **根本原因**: `MSG_SETTINGS_CONFIG` 受信時の `setProviderSettings(initial)` が `modelSlots` を含めていなかったため、サーバーから返信が来るたびに `providerSettings.openrouter.modelSlots` が `undefined` にリセットされスロット表示が消えていた
  - **`webview/src/App.tsx`**: `setProviderSettings(initial)` の初期化ループに `modelSlots: (p as any).modelSlots` を追加
  - **`webview/src/App.tsx`**: スロット「使用」ボタンで `model` と `modelSlots` を一つの `postMessage` にまとめて送信するよう変更（タイミング問題を完全回避）

- **OpenRouterスロット表示消えるバグ修正（バージョン 0.2.6）**:
  - **`src/webview/provider.ts`**: `_sendSettingsConfig` に `overrides.providerOverrides` を追加。プロバイダーごとの `model` / `modelSlots` / `endpoint` を直接オーバーライドできるよう拡張
  - **`src/webview/provider.ts`**: `_handleUpdateProviderConfig` で保存した値を `providerOverrides` として `_sendSettingsConfig` に渡すよう変更。これにより VS Code 設定への非同期書き込みが完了する前に `config.get` で旧値が読まれてWebviewに返り、スロット入力が消える問題を解消
  - **根本原因**: 「使用」ボタンクリック時に input の `onBlur` が先に発火 → `postMessage` → `_handleUpdateProviderConfig` → VS Code設定書き込み（非同期）→ `_sendSettingsConfig()` が旧値を読んでWebviewに返す → ローカルステートが旧値で上書きされて表示が消えていた

- **OpenRouterモデル保存の根本修正（バージョン 0.2.5）**:
  - **`src/backend/server.ts`**: `getProviderConfig` の `mainModel` フォールバックロジックを修正。`torii.mainModel` 未設定時に `torii.openrouter.model`（mainProviderId固有モデル）にフォールバックするよう変更。これまではデフォルトプロバイダー（Anthropic等）のモデルにフォールバックしていたため、OpenRouterのスロット「使用」ボタンで保存した値が実行時に無視されていた
  - **`webview/src/App.tsx`（スロット「使用」ボタン）**: メインプロバイダーが openrouter の場合、`openrouter.model` と同時に `mainModel` も `MSG_UPDATE_MODEL_CONFIG` で更新するよう修正
  - **`webview/src/App.tsx`（メインモデルテキスト入力）**: Enter キーで `blur()` をトリガーし確実に保存されるよう修正

### 2026-05-24
- **OpenRouterモデル保存バグ修正**:
  - **メイン/サブプロバイダーのモデル入力UI**: プロバイダーが `models: []`（OpenRouter等フリー入力プロバイダー）の場合、`<select>` の代わりに `<input type="text">` を表示し、`onBlur` で `MSG_UPDATE_MODEL_CONFIG` を送信して保存するよう修正
  - **OpenRouterスロット入力**: `onChange` はローカルステートのみ更新・`onBlur` で `updateProviderConfig` を送信して確実に保存するよう追加
  - **「スロット保存」ボタン削除**: `onBlur` 保存で冗長になったため削除

### 2026-05-23 (4)
- **OpenRouterスロット保存バグ修正**: スロット入力の `onChange` で直接 `postMessage` するよう変更。「スロット保存」ボタンを削除（redundant）
- **メイン/サブモデルUIをプロバイダー+モデルの2段構成に変更**:
  - プロバイダー `<select>` + モデル入力（固定モデルあり→`<select>`、OpenRouter等モデルなし→`<input type="text">`）
  - `onBlur` で保存するためタイピング中は不要なpostMessageを送らない
  - OpenRouter をメイン・サブに設定し、それぞれ異なるモデルID（例: deepseek/deepseek-r1 / deepseek/deepseek-chat）を指定可能に
  - `allModelOptions` useMemo はルーティングルールフォーム用に残す
  - `styles.css` に `.model-selector-row` / `.model-selector-provider` / `.model-selector-model` を追加

### 2026-05-23 (3)
- **OpenRouter モデルスロット機能**:
  - `webview/src/types.ts`: `ProviderSettings` と `ServerConfig.providers` に `modelSlots?: string[]` を追加
  - `package.json`: `torii.openrouter.modelSlots`（最大3件の配列）設定を追加
  - `src/webview/provider.ts`: `_sendSettingsConfig` で openrouter の `modelSlots` を読み込んで送信。`_handleUpdateProviderConfig` で `modelSlots` の保存に対応
  - `webview/src/App.tsx`: OpenRouter の設定画面にスロットUI（3行のテキスト入力＋「使用」ボタン＋「スロット保存」ボタン）を実装。アクティブなモデルはハイライト表示
  - `webview/src/styles.css`: `.openrouter-slots` / `.openrouter-slot` / `.slot-use-btn` スタイルを追加

### 2026-05-23 (2)
- **OpenRouter プロバイダー追加**:
  - `src/constants.ts`: `ProviderId` に `'openrouter'` を追加。`PROVIDERS` に openrouter エントリを追加（endpoint: `https://openrouter.ai/api/v1`、chatPath: `/chat/completions`、authPrefix: `Bearer`、models: []でフリー入力方式）
  - `src/backend/agentLoop.ts`: `PROVIDER_ID_MAP` に `openrouter: 'openai-native'` を追加。OpenRouter はエンドポイントが異なるため `isCustomEndpoint=true` になり Cline SDK に `baseUrl` が渡る
  - `package.json`: `torii.provider` / `torii.mainProvider` / `torii.subProvider` の enum に `"openrouter"` を追加。`torii.openrouter.endpoint` / `torii.openrouter.model` / `torii.openrouter.maxTokens` 設定を追加
  - `src/backend/server.ts` / `src/webview/provider.ts` / `webview/src/App.tsx` は変更不要（既存の汎用ロジックで自動対応）

### 2026-05-23
- **エージェント自律性改善（`src/backend/tools.ts`）**:
  - システムプロンプトの「絶対ルール」に2項目追加: 「調べます」等の宣言より先にツールを実行すること・複雑なタスク（3ステップ以上）は最初に `.torii-todo.md` にステップリストを write_file で書き出すこと
  - `buildClineTools` 末尾でツール結果に `[REMINDER: 元のタスクに集中し、完了までツールを使い続けよ。attempt_completion を呼ぶまで停止するな。]` を付加するラッパーを追加
- **write_file / replace_in_file 承認時の diff 表示（`src/backend/tools.ts`）**:
  - `showDiffAndWaitApproval` 関数を追加。承認前に旧内容・新内容を OS tmpdir に一時ファイルとして書き出し、`vscode.commands.executeCommand('vscode.diff', ...)` でdiffビューを表示
  - 承認/キャンセル後に `vscode.window.tabGroups` APIでdiffタブを閉じ、一時ファイルを削除
  - 新規ファイルの場合は `oldContent = ''` のため空ファイルとのdiffが自動表示
  - `awaitApproval` は `run_command` 用に維持したまま、write_file / replace_in_file のみ `showDiffAndWaitApproval` に移行

### 2026-05-23
- **storage.ts 書き込みキュー導入**:
  - `queuedWrite<T>` ヘルパーを追加（Promise チェーンによるシリアル実行）
  - `createTask` / `deleteTask` / `saveChatMessage` / `clearAllHistory` の4関数を `queuedWrite` でラップ
  - 複数の Express リクエストが同時発生しても JSON 操作が競合しなくなった
  - `disposeStorage` を `async` に変更し `await _writeQueue` でキューをドレイン

### 2026-05-22 (8)
- **予算バー通貨切替機能追加（JPY/USD）**:
  - `package.json` に `torii.displayCurrency`（enum: JPY/USD、デフォルト JPY）を追加
  - `src/constants.ts` に `CONFIG_DISPLAY_CURRENCY` 定数を追加
  - `webview/src/types.ts` の `ServerConfig` に `displayCurrency?: string` フィールドを追加
  - `src/webview/provider.ts` の `_sendSettingsConfig` / `_handleUpdateModelConfig` で `displayCurrency` を読み書き
  - `webview/src/App.tsx` 予算バー: `isCurrencyUSD` フラグに応じて `$xx.xx / $yy` または `¥xxx / ¥yyy` を切り替え
  - `webview/src/App.tsx` 設定画面「予算・ルーティング」に通貨切替セレクトを追加
- **上位モデル再実行の設定保存バグを根本修正**:
  - 根本原因: `_handleUpdateModelConfig` で `configTarget.update()` 後に `_sendSettingsConfig()` を呼ぶ際、VS Code 設定書き込みのタイミング差で `getConfiguration().get()` が古い値（空）を返し、`escalateDraft` が上書きされていた
  - `_sendSettingsConfig(overrides?: Record<string, any>)` にオーバーライド引数を追加。`escalateProvider1/2`, `escalateModel1/2`, `mainProvider`, `mainModel`, `subProvider`, `subModel`, `modelLimits`, `displayCurrency` を `??` 演算子でオーバーライド可能に変更
  - `_handleUpdateModelConfig` の末尾で `await this._sendSettingsConfig(config)` として保存した値を直接渡すよう変更。VS Code 設定反映タイミングに依存しなくなった
- **README.md リライト**:
  - 日本語セクションを英語の前に移動（ターゲットは日本人開発者）
  - Ollamaルーティングの詳細セクションを追加（インストール手順・モデル選択・カスタムキーワード・動作確認）
  - 予算バー通貨切替機能の説明を追加

### 2026-05-22 (7)
- **設定保存バグ修正・ライセンス表示改善**:
  - `package.json` の `contributes.configuration` に `torii.escalateProvider1/2`・`torii.escalateModel1/2` が未登録だったため追加。VS Code設定のget/updateが正常化。
  - `handleOpenSettings`（`App.tsx`）設定画面を開く際に `settingsConfig` を再リクエストするよう変更。これにより上位モデル再実行設定・メインモデル・サブモデルが設定画面を開くたびに最新値で初期化される。
  - `BETA_FREE_PRO` を `licenseManager.ts` から export し、`sendLicenseStatus` 経由で webview に `isBeta` フラグを送信。
  - 設定画面ライセンスセクション: β版中はPro機能開放中の表示に変更。β版終了後はPro版（¥980/月）が必要な旨も記載。
  - ホーム画面Pro CTA: β版中はPro機能開放中のメッセージを表示。

### 2026-05-22 (6)
- **承認カードのボタン非表示バグ修正**: `styles.css` で `.approval-command` に `max-height: 180px; overflow-y: auto` を追加。コマンドが長くても最大180pxでスクロール表示になりボタンが隠れない。`.approval-card` を `flex-direction: column` に、`.approval-actions` に `flex-shrink: 0` を追加しボタン行が縮まない構造に変更。

### 2026-05-22 (5)
- **システムプロンプト強化（「答えるだけで変更しない」問題の修正）**: `buildSystemPrompt` に「絶対ルール」セクションを追加
  - 「各ターンで必ず1つ以上のツールを呼び出すこと（テキストのみの応答は禁止）」を明示
  - 「実装タスクでコードをテキストに貼って説明するだけで終わることは禁止」と ❌/✅ パターン例を追加
  - 「実装系のタスク → ファイルを変更・作成してよい（任意）」→「直接変更する（必須）」に変更
  - `<think>` セクションに「タグを閉じたら即座にツールを呼び出す・前置き説明なし」の指示を追加

### 2026-05-22 (4)
- **VSIX起動エラー修正（`import.meta.url` が `undefined`）**: esbuild がESMパッケージをCJSバンドルに変換する際に `import.meta` を `{}` にポリフィルするため `import.meta.url = undefined` となり `createRequire(undefined)` が失敗していた。`package.json` の `compile` / `watch` スクリプトに `--define:import.meta.url=__importMetaUrl` と `--banner:js=const __importMetaUrl=require('url').pathToFileURL(__filename).href;` を追加して解決。
  - 根本チェーン: `@cline/agents` → `@cline/llms` → `ai-sdk-provider-claude-code` → `@anthropic-ai/claude-agent-sdk/sdk.mjs` (uses `import.meta.url`)
  - 開発時は `new Function(...)` ハック除去（v0.1.4）により esbuild がバンドル対象にしたことで初めて顕在化

### 2026-05-22 (3)
- **VSIX起動エラー修正（`@cline/agents` not found）**: `tools.ts` の `buildClineTools` 関数で `new Function('m', 'return import(m)')` ハックが残存していたのを `await import('@cline/agents')` に変更。`agentLoop.ts` では v0.1.2 で修正済みだったが `tools.ts` が未対応だった

### 2026-05-22 (2)
- **バージョン 0.1.2 へ bump**（Marketplace に 0.1.1 が公開済みで上書き不可のため）
- **VSIX起動エラー修正**: `Cannot find module 'uuid'` を解消
  - `compile` スクリプトを `tsc` から `esbuild --bundle` に変更（全依存関係を `dist/ext/extension.js` にバンドル）
  - `agentLoop.ts` の `new Function('m', 'return import(m)')` ハックを通常の `await import('@cline/agents')` に変更（esbuild が `import()` を正しく処理するため）
  - `.vscodeignore` の `node_modules/**` 除外はそのまま維持（バンドルで不要）
  - VSIX サイズ: 1.72MB（圧縮後）

### 2026-05-22
- **ベータ期間中: 全ユーザーをtrial扱い**（LemonSqueezy審査完了後に `BETA_FREE_PRO = false` に戻す）
  - `licenseManager.ts` に `BETA_FREE_PRO` フラグを追加
  - `getStatus` / `check` の先頭で `'trial'` を即時返却
- **セキュリティ強化**: `server.ts` の `console.error` 2箇所を修正
  - API エラーメッセージを500文字でトリム（レスポンスボディ由来の情報漏洩防止）
  - Chat エラーのログを `err` オブジェクト全体から `err.message` のみに変更
- **CLAUDE.md**: ドキュメント更新の原則を追加

### 2026-05-19
- **タスクリストのレスポンシブ化**: `clamp()`/`vw`を使い、パネル幅に応じてタスク名・ボタンが拡大するよう変更
- **ローディング表示の改善**:
  - チャットモード: 「考え中…」をアニメーション付き `agent-phase-bar` スタイルに統一
  - エージェントモード: ツール種別（read/write/command/search/list/git）ごとに色分け・アイコン付きラベル
  - `currentToolInput` stateを追加し、`run_command`のコマンド内容を解析して「コミット、プッシュ中」等を自動生成

### 2026-05-18
- **承認待ちUI修正**: 承認カードを`chat-area`の外（入力欄直上）に移動し、スクロールに関係なく常に表示されるよう変更
- **自動スクロール修正**: `agentSteps`と`pendingApprovals`変化時も最下部にスクロールするよう追加
- **アニメーション改善**: `waiting-pulse`の`color-mix()`を廃止しopacity+border-widthアニメーションに変更

---

## 配布・マーケティング情報

| 項目 | 値 |
|---|---|
| GitHubリポジトリ | https://github.com/2dachs/torii |
| LemonSqueezyストア | https://torii-dev.lemonsqueezy.com |
| 購入URL | https://torii-dev.lemonsqueezy.com/checkout/buy/e01fc9a8-b44c-4664-92d7-21a0176170f7 |
| Stripe審査 | 通過済み |
| GitHubアカウント | 2dachs |
| Zennアカウント | 2dachs（未作成） |
| アイコン | Variant C（鳥居＋ダックスフンドシルエット・赤）※差し替え待ち |

---

## 配布までの残タスク

- [x] Stripe審査完了確認
- [ ] アイコン差し替え（resources/icon.png）
- [ ] vsce package（サイズ確認）
- [ ] VSCode Marketplaceパブリッシャー登録（publisher: pettal）
- [ ] vsce publish
- [ ] Zennアカウント作成（2dachs）
- [ ] Zenn記事執筆・公開（Marketplace公開と同日）

---

## ブランド・プロダクト方針

- プロダクト名：Torii（旧称: Pettal Practitioner）
- Marketplace ID：pettal.torii
- 将来的にPettalの事業のひとつとして統合予定
- ターゲット：Claude Pro + Cursorを使っている日本人個人開発者
- ビジョン：AIコーディングの入口であり、いろんなプロバイダーやモデルへのゲートウェイ
- 価格：¥980/月・7日間Pro体験
- ライセンス：MIT（完全OSS公開）
