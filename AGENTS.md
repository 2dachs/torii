# Torii — Codex 行動指針

## ドキュメント更新の原則

**コードを変更したら、関連ドキュメントを必ず同時に更新する。**

- 機能追加・修正・設定変更を行ったら、以下を確認して必要箇所を更新する：
  - `AGENTS.md` — 実装済み機能リスト、既知の課題テーブル、変更ログ
  - `DESIGN.md` — 実装状態（v0.x.x）、既知の問題テーブル、ロードマップのチェックボックス
  - `README.md` — 機能一覧に変化がある場合のみ
- 変更ログは `AGENTS.md` の「修正・変更ログ」に日付付きで追記する
- 指示されなくても行う。コード変更とドキュメント更新は一体のタスク

---

## 自律調査の原則（最重要）

**質問する前に必ずツールで調べる。**

- ファイルが存在するか不明 → `find` / `grep` で探してから答える（「存在しないかもしれない」は禁止）
- パスが曖昧 → `find . -name "*.tsx" -iname "*keyword*"` で確認する
- AGENTS.mdに書いていないことも、コードを読んで自分で把握する
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
- マルチプロバイダー対応（OpenAI / DeepSeek / Anthropic / Ollama / Gemini / OpenRouter）
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
- OpenRouterモデル検索: 最新モデル一覧を取得して検索・スロット登録可能。GLM 5.2 / DeepSeek V4 Flash / MiniMax M3 はプリセット単価込みで対応
- OpenRouter用途別ルーティング: 相談・レビュー・設計はGLM 5.2、実装・修正はDeepSeek V4 Flashへ自動/手動で切替可能
- 価格更新: DeepSeek / Anthropic / Gemini の現行単価へ追従し、OpenRouter はAPIの current pricing を予算計算へ反映
- 予算管理: 月間USD/JPY換算・バー表示・スコープ切替（グローバル/プロジェクト）
- 為替レート: 自動取得（1時間キャッシュ）+ 手動設定フォールバック
- 自動ルーティング（PromptRouter）: プライバシー/セキュリティ/難易度/予算に応じてモデル自動切替
- Irori 検索MVP: `検索` / `調べて` / `最新` などの文言を検出した場合、Tavily APIキーが設定されていればTavily Search APIを優先し、検索結果URL・スニペット・使用creditsをLLMへの外部コンテキストとして渡す。Tavily未設定時のみDuckDuckGo公開JSON API、DuckDuckGo HTML、Brave Search HTMLの順でフォールバックする。`もう一度検索して` のような短い再検索指示では直前のユーザー話題を検索語として補完する
- Irori 応答進行表示: 送信直後にユーザー発話を仮表示し、検索語を含む場合は `検索中`、それ以外は `考え中` のアシスタント仮バブルを表示。結果到着時はフェードインとスムーズスクロールで差し替える
- Irori Enter送信: 通常Enterで送信、Shift+Enterで改行。IME変換中のEnterは変換確定として扱い、誤送信しない
- Irori レスポンシブUI: デスクトップは3カラム、タブレット/スマホはチャット中心の1カラムに切替。Projects/Conversationsは左ドロワー、Routing/Usageは下部シート、Settingsはモーダルで表示
- Irori 専用アイコン: Toriiアイコン流用をやめ、囲炉裏の火・炉縁・格子をモチーフにした日本風Dark Academia寄りのアプリアイコンへ差し替え
- Irori UIポリッシュ: 作成済み囲炉裏アイコンをサイドバー/モバイルトップバーへ適用し、macOS標準フォント・小さめの文字サイズ・薄い境界線でチャット本文優先の見た目へ調整
- Irori Web版 MVP着手: `irori-web/` に Next.js App Router + TypeScript + Tailwind CSS + Supabase 構成を新設。Googleログイン、認証後チャットUI、Settings、モード別モデル候補選択、Supabase RLS/Vault/Edge Functions の初期実装を追加
- Irori 共有core: `packages/core/` に `estimateTokens` / `calculateCost` / `routeMessage` と型定義を切り出し、Web版から利用できるようにした
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

### 2026-06-26
- **0.5.8 Torii起動時フリーズ対策**:
  - **`webview/src/App.tsx`**: Webview起動直後に最新タスクを自動選択してチャット履歴を全読み込みする処理を廃止。巨大な履歴や添付コンテキストを含む最新タスクがある場合に、Toriiを開くだけでVS Code Rendererが応答不能になるリスクを削減
  - **`.vscodeignore`**: `irori/`、`irori-web/`、`packages/`、`docs/` をVSIXから除外。Torii拡張に不要なサブアプリ資産がVSIXへ混入して巨大化する問題を防止
  - **`package.json` / `package-lock.json`**: 修正版として `0.5.8` へ更新

### 2026-06-23
- **Irori MVP サブアプリ新設**:
  - **`irori/`**: Tauri + React + TypeScript + SQLite のデスクトップAIチャットMVPを新規追加。Quick / Standard / Deep の3モード、OpenRouterチャット、推定コスト、使用量ログ、プロジェクト分離の土台を実装
- **Irori macOSアプリ化**:
  - **`irori/src-tauri/tauri.conf.json`**: `bundle.active = true` / `targets = ["app"]` を有効化し、`tauri build` で `Irori.app` を生成するよう変更
  - **`irori/package.json`**: `app:open` / `app:build-open` を追加し、ビルド後に Finder から開ける導線を用意
  - **`irori/vite.config.ts`**: dev server を `127.0.0.1` に固定して Tauri dev 起動の安定性を改善
- **Irori 初期モデル更新**:
  - **`irori/src/App.tsx` / `irori/src-tauri/src/db.rs`**: Standard の既定モデルを `DeepSeek V4 Pro`（`deepseek/deepseek-chat-v4-pro`）に変更し、Quick の `DeepSeek V4 Flash` と価格を最新の公開値に合わせて更新
- **Irori APIキー保存先のKeychain移行**:
  - **`irori/src-tauri/src/keychain.rs`**: OpenRouter APIキーを macOS Keychain へ保存・読み出し・削除するラッパーを追加
  - **`irori/src-tauri/src/db.rs`**: `app_settings` の `open_router_api_key` は空欄運用に変更し、旧DB平文は初回読込時に Keychain へ移行して削除するよう変更

### 2026-06-24
- **Irori Web Project/Conversation ID検証修正**:
  - **`irori-web/src/components/irori-web-app.tsx`**: `activeProjectId` / `activeConversationId` を取得済み一覧に存在する場合だけ再利用し、存在しない場合は先頭行へ補正するよう変更。送信時も実在する `activeProject` / `activeConversation` のIDだけを送るよう修正
  - **`irori-web/supabase/functions/send_message/index.ts`**: Project / Conversation / Settings の検証エラーを個別メッセージに分け、原因を判別しやすくした
- **Irori Web送信時Project解決の堅牢化**:
  - **`irori-web/supabase/functions/send_message/index.ts`**: `send_message` でクライアント送信の `projectId` に依存せず、検証済み `conversation.project_id` からProjectを解決するよう変更。staleなProject IDが混ざっても、Conversationが正しければ送信できるようにした
- **Irori Web送信前Conversation自動復旧**:
  - **`irori-web/src/components/irori-web-app.tsx`**: 送信直前にProject / ConversationがDB上に存在するか確認し、存在しない場合は現在ユーザーで新しいProject / Conversationを作成してから送信するよう変更。staleな会話IDで送信が止まる問題を抑止
- **Irori Web Edge送信ID/Settings自動復旧**:
  - **`irori-web/supabase/functions/send_message/index.ts`**: `send_message` 側でも missing Project / Conversation / Settings を自動作成し、作成後の canonical ID をレスポンスへ返すよう変更。初回ユーザーや stale ID でも送信を継続できるようにした
  - **`irori-web/src/components/irori-web-app.tsx`**: Edge Function から返った canonical project/conversation ID をフロント状態へ同期し、以後の送信で古いIDを使い続けないよう修正
  - **`irori-web/supabase/functions/send_message/index.ts`**: Edge Function の catch で PostgREST/RPC エラーの `message` / `details` / `hint` / `code` をUIへ返すよう変更
- **Irori Web service_role権限修正**:
  - **`irori-web/supabase/migrations/202606240004_service_role_table_grants.sql`**: Edge Function の admin client が `app_settings` などを読み書きできるよう、`service_role` に必要な table 権限を付与
- **Irori Web応答進行表示追加**:
  - **`irori-web/src/components/irori-web-app.tsx` / `irori-web/src/app/globals.css`**: デスクトップ版と同じく、送信直後にユーザー発話を仮表示し、通常時は `考え中`、検索語を含む場合は `検索中` のIrori仮バブルを表示。回答到着時はフェードインと `scrollIntoView({ behavior: 'smooth' })` で回答先頭へ滑らかに移動するよう変更
- **Irori Web APIキー保存状態表示**:
  - **`irori-web/src/components/irori-web-app.tsx`**: Settings のAPIキー欄に `保存済み` / `未設定` を表示し、保存済みキーは平文再表示せず「変更する場合のみ入力」のplaceholderを出すよう変更。保存成功後はローカル状態も即時更新する
- **Irori Web Edge Functionエラー表示改善**:
  - **`irori-web/src/components/irori-web-app.tsx`**: Supabase Edge Function が non-2xx を返した場合に `FunctionsHttpError` の `context` レスポンス本文を読み、`error` / `message` をUIへ表示するよう変更。OpenRouter拒否、APIキー未設定、payload不正などの具体原因が見えるようにした
- **Irori Webモデル選択UI修正**:
  - **`irori-web/src/lib/model-configs.ts` / `irori-web/src/components/irori-web-app.tsx`**: Settings の Quick / Standard / Deep を自由入力から候補選択へ変更。Quick は DeepSeek V4 Flash、Standard は DeepSeek V4 Pro / GPT-4o、Deep は Fugu / OpenRouter Fusion / Claude Opus 4.8 から選択可能にした
  - **`irori-web/supabase/functions/send_message/index.ts`**: Edge Function 側も `app_settings` の選択slugから provider / displayName / price を解決するよう変更。Fugu選択時は Fugu APIキー、Fusion/Opus/GPT-4o/DeepSeek 選択時は OpenRouter APIキーを使う
  - **`irori-web/supabase/migrations/202606240003_model_mode_options.sql`**: 既存 `model_configs` の DeepSeek V4 Flash / Pro 価格と context window を現在の OpenRouter 値へ補正する migration を追加
- **Irori Webアカウント管理追加**:
  - **`irori-web/src/components/irori-web-app.tsx`**: Settings モーダル内に現在のログインメール、ログアウト、別アカウントでログイン導線を追加。`handleLogout` でモーダルやサイドパネルも閉じるように変更
- **Irori 検索MVP追加**:
  - **`irori/src-tauri/src/search.rs`**: `検索` / `調べて` / `最新` などの文言を検出し、DuckDuckGo公開JSON APIで軽量検索する処理を追加
  - **`irori/src-tauri/src/main.rs`**: 検索結果をOpenRouter呼び出し前のsystem messageとして差し込み、LLMがURL付きの外部コンテキストを参照できるよう変更
  - **`irori/README.md` / `DESIGN.md`**: 検索MVPの仕様と、MVPではAPIキーをアプリDB保存に戻した運用を追記
- **Irori 検索MVPの再検索修正**:
  - **`irori/src-tauri/src/search.rs`**: DuckDuckGo JSON結果が空またはパース不能の場合にDuckDuckGo HTML / Brave Search HTMLへフォールバックする処理を追加し、再検索指示の不要語を検索語から除去
  - **`irori/src-tauri/src/main.rs`**: `もう一度検索して` のような短い指示では直前のユーザー発話から検索語を補完し、検索結果をsystem messageと直近ユーザー発話の両方へ差し込むよう変更
- **Irori Tavily検索対応**:
  - **`irori/src-tauri/src/search.rs`**: Tavily Search API呼び出しを追加。Tavily APIキー設定時はTavilyを優先し、`search_depth` / `max_results` / `include_usage` を指定して検索結果とcreditsを取得
  - **`irori/src-tauri/src/db.rs` / `irori/src-tauri/src/models.rs` / `irori/src-tauri/src/main.rs`**: `tavily_api_key` / `tavily_search_depth` / `tavily_max_results` を `app_settings` に追加し、既存DBは `ALTER TABLE` で移行
  - **`irori/src/App.tsx` / `irori/src/types.ts` / `irori/src/styles.css`**: Settings画面にTavily API key、search depth、max resultsを追加
- **Irori Tavily設定保存バグ修正**:
  - **`irori/src/App.tsx`**: `settingsDirty` に `tavilyApiKey` / `tavilySearchDepth` / `tavilyMaxResults` を追加。Tavily項目だけ変更した場合も保存ボタンが有効になるよう修正
  - **`irori/src/App.tsx`**: Tavily APIキー保存済み状態が分かる補助表示を追加
- **Irori 応答進行表示追加**:
  - **`irori/src/App.tsx`**: 送信中の仮ターン状態を追加し、ユーザー発話を即時表示。検索語を含む場合は `検索中`、通常時は `考え中` のアシスタント仮バブルを表示
  - **`irori/src/styles.css`**: タイピングドット、メッセージフェードイン、スムーズスクロール、送信中ステータスピルを追加
- **Irori Standard表示名マイグレーション修正**:
  - **`irori/src-tauri/src/db.rs`**: Standard の実モデルが `deepseek/deepseek-v4-pro` に移行済みでも、既存DBの表示名だけ `GPT-4o` と残るケースを起動時に `DeepSeek V4 Pro` へ補正
  - **`irori/src-tauri/src/db.rs`**: `model_configs` を設定値から毎回同期し、既知のモデルslugは表示名も正規化するよう変更
- **Irori Enter送信対応**:
  - **`irori/src/lib/composerKeys.ts`**: ComposerのEnter送信判定を純関数として追加。IME変換中や `keyCode = 229` のEnter、Shift+Enterでは送信しない
  - **`irori/src/App.tsx`**: 入力欄の `onKeyDown` で通常Enter送信、Shift+Enter改行、送信中/空入力の抑止を実装
- **Irori Web/スマホ向けUI刷新**:
  - **`irori/src/App.tsx`**: モバイル用トップバー、Projects/Conversationsドロワー、Routing/Usage下部シート、Settingsモーダルを追加。入力欄付近に `Mode · Model · 約¥` の常時要約を表示
  - **`irori/src/styles.css`**: 生成り・墨・深緑を基調にしたClaude寄りの落ち着いた配色へ刷新。デスクトップ/タブレット/モバイルのブレークポイントを整理し、スマホではチャット領域を最優先に表示
- **Irori 専用アイコン追加**:
  - **`irori/src-tauri/icons/irori-icon.svg`**: 囲炉裏の火、暗い炉縁、格子を抽象化した日本風Dark Academia寄りのSVGアイコンを追加。白い外枠に見える明色フレームは使わない
  - **`irori/src-tauri/icons/icon.png`**: Tauriが参照するアプリアイコンPNGをIrori専用アイコンへ差し替え
- **Irori UIポリッシュ**:
  - **`irori/src/assets/irori-icon.svg` / `irori/src/App.tsx`**: フロント用アイコン資産を追加し、サイドバーの `井` テキストマークとモバイルトップバーを作成済みIroriアイコンへ差し替え
  - **`irori/src/styles.css`**: Avenir Next主体をやめ、macOS標準日本語フォント中心へ変更。Hero、サイドバー、Usage、Composer、メッセージ本文のサイズ/余白/太さを抑えて、Claude寄りの静かな読みやすさに調整
- **Irori Dark Academia UI再調整**:
  - **`irori/src/styles.css`**: 配色を黒茶・金のダークアカデミア寄りに更新し、Noto Serif JP / Garamond 系のセリフ体を前面に出すよう再調整。パネル、入力、メッセージ、Settings の境界線と密度もさらに静かな方向へ寄せた
- **Irori メッセージ対比調整**:
  - **`irori/src/styles.css`**: Irori 側の応答を独立したサーフェスカード化し、ユーザー発話は暗い金色バブル＋濃い文字に変更。左右の読み取り差を明確にして、ダーク背景上でも境界が曖昧にならないよう修正
- **Irori ユーザーバブル文字色調整**:
  - **`irori/src/styles.css`**: 右側バブルの文字色を `#1a1814` に統一し、背景の金色系は維持したまま可読性を少しだけ締めた
- **Irori ユーザーバブル明度調整**:
  - **`irori/src/styles.css`**: 右側バブルの背景を `#c9a96e` 基準の明るい金へ戻し、タイムスタンプを `#3a2e20` にして Irori 側カードとの対比を強めた
- **Irori Web版 MVP初期実装**:
  - **`packages/core/`**: `estimateTokens` / `calculateCost` / `routeMessage` と共有型を追加し、Node標準testでコスト計算・ルーティングのテストを追加
  - **`irori-web/`**: Next.js App Router + Tailwind + Supabase のWeb版を新設。Googleログイン、Projects/Conversations/Chat、Quick/Standard/Deep、Settings、モード別モデル候補選択、レスポンシブUIを実装
  - **`irori-web/supabase/`**: profiles/projects/conversations/messages/model_configs/usage_logs/app_settings/api_key_secrets のPostgres schema、RLS、Vault RPC、`save_api_key` / `send_message` Edge Functionsを追加
- **Irori Rust warning解消**:
  - **`irori/src-tauri/src/main.rs`**: Tauriコマンドに `rename_all = "camelCase"` を指定し、Rust側引数をsnake_caseへ変更。フロントのcamelCase呼び出し互換は維持
  - **`irori/src-tauri/src/db.rs` / `irori/src-tauri/src/openrouter.rs`**: 未使用の `mut`、未使用関数、未使用structを削除し、`cargo test` / `tauri build` の警告を解消

### 2026-06-22
- **0.5.7 OpenRouter用途別モデル切替**:
  - **`src/backend/lib/router.ts`**: `modelIntent` による OpenRouter 用途別ルーティングを追加。相談・レビュー・設計は `z-ai/glm-5.2`、実装・修正は `deepseek/deepseek-v4-flash` を既定で選択
  - **`src/backend/lib/router.ts`**: 手動の `相談` / `実装` 指定は現在プロバイダーがDeepSeek等でもOpenRouter用途別モデルへ切り替わるよう修正
  - **`src/backend/server.ts` / `src/webview/provider.ts`**: チャット/エージェント双方で一時的な用途指定を転送し、VS Code設定の用途別OpenRouterモデルを読み書きするよう変更
  - **`src/webview/provider.ts`**: `settingsConfig` に `model` / `endpoint` / `maxTokens` を再度含め、Webview上で `DeepSeek ()` のようにモデル名が空表示になる問題を修正
  - **`webview/src/App.tsx` / `webview/src/styles.css`**: 入力欄に `Auto` / `相談` / `実装` の今回だけ切替を追加。OpenRouter設定画面に用途別モデル入力を追加
  - **`src/backend/lib/openRouterPricing.ts`**: `response.json()` のレスポンス型を明示し、拡張機能側の `tsc --noEmit` が通るよう修正
  - **`src/constants.ts` / `package.json` / `package-lock.json`**: `torii.openrouter.planningModel` / `torii.openrouter.implementationModel` を追加し、DeepSeek V4 Flashプリセットと `0.5.7` へ更新
  - **`package.json` / `.vscode/settings.json`**: VS Code 1.85以降で不要な `onCommand:*` activationEvents を削除し、Spell Checker用のプロジェクト辞書に固有名詞を追加
  - **`src/backend/lib/routerIntent.test.ts` / `package.json`**: OpenRouter用途別ルーティングのNodeテストと `npm test` を追加。`router.ts` はVS Code APIを遅延読み込みにして単体テスト可能に変更
  - **`.gitignore`**: Irori/Tauriの `target`、生成schema、swap、ローカルcargo wrapperを除外し、未追跡一覧に生成物が混ざらないよう整理

### 2026-06-21
- **0.5.4 プロジェクトフォルダ起動時の安定化**:
  - **`src/webview/provider.ts`**: Webview初期化時の全履歴送信とアクティブエディタ本文の自動送信を廃止。エディタ本文はユーザーが添付ボタンを押した時だけ取得するよう変更
  - **`webview/src/App.tsx`**: 初期マウント時の `editorContent` 要求を削除。プロジェクトフォルダを開いた直後のWebview/Renderer負荷を削減
  - **`package.json` / `package-lock.json`**: 修正版として `0.5.5` へ更新

- **0.5.3 Webview CSP修正**:
  - **`src/webview/provider.ts`**: VS Code Webviewの内部アセット配信が `http://localhost:*` / `http://127.0.0.1:*` になる環境に備え、`script-src` / `style-src` / `connect-src` を許可。CSPでWebview JSがブロックされクリック処理が動かないリスクを修正
  - **`webview/src/main.tsx`**: DevTools ConsoleでTorii Webviewの起動を確認できるよう `[Torii Webview] boot` ログを追加
  - **`package.json` / `package-lock.json`**: 修正版として `0.5.4` へ更新

- **0.5.2 VS Code応答停止修正**:
  - **`package.json`**: esbuild の `compile` / `watch` に `--line-limit=120` を追加。バンドル済み `dist/ext/extension.js` の最大行長が数十万文字になり、VS Codeエディタ/Rendererが応答停止するリスクを解消
  - **`package.json` / `package-lock.json`**: 修正版として `0.5.3` へ更新

- **0.5.1 Webview応答停止修正**:
  - **`src/webview/provider.ts`**: アクティブエディタ本文・選択範囲をWebviewへ送る際に最大20万文字へ制限。`dist/ext/extension.js` のような巨大ファイルを開いた状態でToriiを表示しても、巨大な `postMessage` によるUI停止が起きにくいよう修正
  - **`webview/src/App.tsx`**: 添付コンテキストが切り詰められた場合にUIと送信文面へ明示するよう変更
  - **`package.json` / `package-lock.json`**: 修正版として `0.5.2` へ更新

- **0.5.0 起動ハング修正**:
  - **`src/backend/server.ts`**: 起動時に OpenRouter 価格API取得を `await` していた処理をバックグラウンド実行に変更。ネットワーク待ちで VS Code 拡張ホストが応答不能になるリスクを解消
  - **`package.json` / `package-lock.json`**: 修正版として `0.5.1` へ更新

- **予算バー表示の数値化**:
  - **`webview/src/budget.js` / `webview/src/budget.d.ts`**: 予算表示の組み立てを純関数化し、コスト・上限・percent・tooltip を数値スナップショットで管理するよう変更
  - **`webview/src/App.tsx`**: `receiveMessage` と `agentEvent.done` の予算更新を共通ヘルパーに統合。Agent完了時は単発コストではなく累計コストを表示するよう修正

- **料金テーブル更新**:
  - **`src/constants.ts`**: DeepSeek / Anthropic / Gemini の現行単価へ更新。DeepSeek は `deepseek-chat` / `deepseek-reasoner` を現行の V4 Flash / V4 Pro 相当として扱い、Anthropic Opus 4.7 は $5 / $25、Gemini 2.5 Flash は $0.30 / $2.50、Gemini 2.5 Pro は 200k tokens 以下 $1.25 / $10、超過時 $2.50 / $15 に更新
  - **`src/backend/lib/openRouterPricing.ts`**: OpenRouter の `GET /api/v1/models` を起動時に取得して価格キャッシュ化。OpenRouter経由の DeepSeek を含む任意モデルの current pricing をそのまま予算計算に反映
  - **`src/backend/server.ts`**: コスト計算をモデル別の current pricing に切り替え。OpenRouter は API キャッシュ優先、Gemini Pro は長文入力時の高価格帯を反映

- **OpenRouter最新モデル設定対応**:
  - **`src/constants.ts`**: `z-ai/glm-5.2` / `minimax/minimax-m3` をOpenRouterプリセットに追加。OpenRouter公式モデルAPIの単価に合わせ、GLM 5.2 は input $1.20 / output $4.10 per 1M、MiniMax M3 は input $0.30 / output $1.20 per 1M としてコスト計算に反映
  - **`src/webview/provider.ts` / `webview/src/App.tsx`**: 設定画面のOpenRouterモデル欄で、Extension Host経由でOpenRouterモデル一覧を取得し、モデル名・ID検索からスロット登録できるUIを追加。OpenRouterの自由入力は維持
  - **`webview/src/styles.css`**: モデル検索結果のコンパクトな一覧表示を追加

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
  - システムプロンプトの「絶対ルール」に2項目追加: 「調べます」等の宣言より先にツールを実行すること・複雑なタスクは最初に手順を整理してから実行すること
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
  - 根本チェーン: `@cline/agents` → `@cline/llms` → `ai-sdk-provider-Codex` → `@anthropic-ai/Codex-agent-sdk/sdk.mjs` (uses `import.meta.url`)
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
- **AGENTS.md**: ドキュメント更新の原則を追加

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
- ターゲット：Codex Pro + Cursorを使っている日本人個人開発者
- ビジョン：AIコーディングの入口であり、いろんなプロバイダーやモデルへのゲートウェイ
- 価格：¥980/月・7日間Pro体験
- ライセンス：MIT（完全OSS公開）
