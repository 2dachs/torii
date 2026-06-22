# Torii — 要件定義 & 実装設計書

> このドキュメントはプロダクトのブラッシュアップ・実装議論の叩き台として作成。

---

## 1. プロダクトビジョン

### 一言で言うと
「日本の開発者向けに作られた、コストが見えるAIコーディングエージェント」

### ターゲット
- VS Code ユーザーの日本人エンジニア（個人・フリーランス・スタートアップ）
- AIコーディングツールに興味はあるが、月額コストが怖い人
- 社内のコードをクラウドに投げることに抵抗がある企業の開発者

### ポジショニング

| | Cline | Cursor | GitHub Copilot | **Torii** |
|--|-------|--------|---------------|------------------------|
| 価格 | 無料（OSS） | ~¥3,000/月 | ~¥1,250/月 | **無料 + Pro ¥980/月** |
| API代 | 別途 | 込み | 込み | **別途（安く使える）** |
| 日本語UI | △ | △ | △ | **◎（フル日本語）** |
| 予算管理 | なし | なし | なし | **◎（JPY表示・バー）** |
| ローカルLLM | ○ | ✗ | ✗ | **◎（自動ルーティング）** |
| エージェント | ◎ | ◎ | △ | **◎（Pro機能）** |

### 差別化の根拠（優先度順）
1. **コスト透明性** — 1回の会話でいくら使ったか、今月いくら使ったかが円で見える
2. **日本語ファーストUX** — UIだけでなく、エラーメッセージ・操作フロー全体が日本語
3. **プライバシー自動保護** — パスワードや個人情報が含まれていそうなプロンプトを自動でOllama（ローカル）にルーティング
4. **エージェントループ** — ファイル読み書き・コマンド実行を自律的に行う（Clineと同等機能）

---

## 2. 課金モデル

### フリーミアム構成

#### 無料（Free / OSS）
- マルチプロバイダー対応（OpenAI・DeepSeek・Anthropic・Ollama）
- 予算管理・JPY表示・予算バー
- 自動ルーティング（PromptRouter）
- チャットモード（会話型）
- APIキー管理（VS Code SecretStorage）

#### Pro（¥980/月・7日間Pro体験）
- **エージェントループ**（ファイル操作・コマンド実行・自律タスク）
- ストリーミング応答（逐次表示）
- ファイル自動編集（diff表示 → Apply）
- ターミナルコマンド実行（ワンクリック承認）
- 優先サポート（日本語対応）

### 課金インフラ: LemonSqueezy + ライセンスキー
- LemonSqueezyは日本向け消費税（JCT）を自動処理
- ライセンスキーを発行し、拡張機能が起動時に `api.lemonsqueezy.com/v1/licenses/validate` で検証
- 機体識別子: `vscode.env.machineId`（1ライセンス = 2デバイスまで許可予定）
- オフライン猶予期間: 最後の認証成功から7日間はキャッシュで動作

### 普及戦略
```
無料ユーザー（予算管理・チャットで満足）
  ↓ 「もっと自動化したい」
  ↓ エージェント機能を試す → Pro転換（目標転換率 3-5%）

配布チャネル:
  - VS Code Marketplace（無料版として公開）
  - GitHubオープンソース → Zenn/Qiita で取り上げられる
  - Twitter/X の日本語エンジニアコミュニティ
  - Pro版はLemonSqueezyリンク経由
```

---

## 3. 現在の実装状態（v0.5.5）

### 実装済み機能
- マルチプロバイダー: OpenAI / DeepSeek / Anthropic / Ollama / Google Gemini / OpenRouter
- OpenRouterモデル検索: 最新モデル一覧を取得して検索・スロット登録可能。GLM 5.2 / MiniMax M3 はプリセット単価込みで対応
- 価格更新: DeepSeek / Anthropic / Gemini の現行単価へ追従し、OpenRouter はAPIの current pricing を予算計算へ反映
- 予算管理: 月間USD/JPY換算・バー表示・スコープ切替（グローバル/プロジェクト）
- 為替レート: 自動取得（1時間キャッシュ）+ 手動設定フォールバック
- 自動ルーティング（PromptRouter）: プライバシー/セキュリティ/タスク難易度/予算に応じてモデル自動切替
- タスク管理: JSON形式でローカル永続化（アトミック書き込み）
- CommandGuard: 危険なコマンドパターンをブロック
- 画像添付対応（マルチモーダルモデル + Gemini自動橋渡し）
- エディタ内容の添付（現在ファイルをコンテキストに追加）
- IME対応（日本語入力中のEnter誤送信防止）
- Markdownレンダリング: メッセージ本文を見出し・箇条書き・引用・コードブロック付きで表示
- `@` メンション: 現在のファイル名を入力欄に挿入して参照可能
- タスク管理UI: 検索・リネーム・削除をタスクリストから実行可能
- **エージェントループ**: `@cline/agents` ベース。`read_file` / `write_file` / `replace_in_file` / `run_command` / `list_directory` / `search_files` / `grep`
- **ストリーミング応答**: SSEによるリアルタイム表示
- **初回オンボーディング**: 初回起動時にOllama開始 / 設定画面への導線を表示
- **承認フロー**: コマンド実行・ファイル書き込み時のワンクリック承認UI
- **run_commandタイムアウト**: 長時間コマンドは timeoutMs で延長可能
- **Webviewファイル保存**: 保存前に差分確認モーダルを表示し、ユーザーが適用を選んだ場合のみ書き込む
- **エディタ添付の巨大ファイル対策**: アクティブエディタ本文・選択範囲のWebview転送を最大20万文字に制限
- **プロジェクト起動時の安定化**: Webview初期化時は全履歴・エディタ本文を自動送信せず、必要時のみ取得
- **ビルド成果物の長行対策**: esbuild出力の行長を制限し、生成JSを開いてもVS Codeが固まりにくいように改善
- **Webview CSP対策**: VS Code内部のlocalhostアセット配信を許可し、Webview起動ログで診断可能に改善
- **履歴クリア確認**: 全履歴削除の前に確認ダイアログを表示
- **エラー再送信**: 失敗した送信をワンクリックで再試行
- **read_fileキャッシュ**: mtimeベースで古い読み取り結果を返さないように改善
- **コンテキスト表示**: 現在の会話トークン量をステータス部に常時表示
- **コマンドガード強化**: `sudo`・`su`・停止系コマンドなどの危険操作を追加でブロック
- **ライセンス認証**: LemonSqueezy連携（activate/validate）・trial/valid/grace/expired分岐・24hキャッシュ・7日間オフライン猶予
- **コンテキストウィンドウ管理**: トークン推定・上限80%超で警告・超過時に古メッセージ自動削除
- **Agent予算制御**: チャットと同じ予算判定・モデル別上限フォールバックをAgent側にも適用
- **プライバシールーティング除外ワード**: `token` 等プログラミング用語の誤検知防止
- カスタムルーティングルール（キーワード→プロバイダー指定）
- .pettal プロジェクト設定ファイル対応
- モデル別コスト上限・セッション統計
- 上位モデルでの再実行（エスカレーション）
- Ollama自動セットアップ補助

### 既知の問題・改善事項
| 問題 | 優先度 | 詳細 |
|------|--------|------|
| 予算バーの計算が文字列パースに依存 | 解消済み | `webview/src/budget.js` に数値スナップショットを切り出し、`App.tsx` の予算表示を純関数化して解消 |
| Expressセキュリティ（将来検討） | 低 | 現在は `127.0.0.1` バインドで外部アクセス不可。Extension Host直接実行への移行は中長期課題 |

---

## 4. エージェントループ — 要件定義

### 概要
ユーザーが「認証機能を追加して」と言うだけで、AIが自律的にファイルを読み・書き・コマンドを実行するループを実現する。

### 基本フロー
```
1. ユーザーがメッセージ送信（エージェントモード）
2. システムがワークスペース情報をコンテキストに追加
   - ファイルツリー（3階層、node_modules/.git除外）
   - 現在アクティブなファイル
   - プロジェクト名・使用言語の推定
3. AIにツール付きでリクエスト
4. AIが応答:
   a. テキストのみ → 表示して終了
   b. ツール呼び出し → ツール実行 → 結果をAIに返す → 3に戻る
5. 最大20イテレーションで強制終了（無限ループ防止）
```

### ツール定義（5種）

#### `read_file` — ファイル読み取り
```
入力: path (string) — ワークスペースルートからの相対パス
出力: ファイル内容（文字列）
承認: 不要（読み取り専用）
```

#### `write_file` — ファイル作成/更新
```
入力: path (string), content (string)
出力: 成功/失敗
承認: 不要（diffを画面に表示して書き込み。Applyボタンなし = 自動）
※ 「自動で書き込むが画面にdiffは見せる」でどうか要検討
```

#### `list_directory` — ディレクトリ一覧
```
入力: path (string, optional) — 省略時はルート
出力: ファイル/ディレクトリ一覧（JSON）
承認: 不要
```

#### `search_files` — ファイル内テキスト検索
```
入力: query (string), path (string, optional)
出力: マッチしたファイル・行番号・コンテキスト
承認: 不要
```

#### `run_command` — ターミナルコマンド実行
```
入力: command (string)
出力: stdout/stderr（最大10,000文字）
承認: 必須（ワンクリック承認UI）
```

### ツール対応プロバイダー
| プロバイダー | tool calling | 備考 |
|-------------|-------------|------|
| Anthropic | ✅ 完全対応 | `tool_use` / `tool_result` |
| OpenAI | ✅ 完全対応 | `function_call` |
| DeepSeek | ✅ OpenAI互換 | function calling対応 |
| Ollama | △ モデル依存 | qwen2.5-coder: 対応。非対応モデルはチャットモードへフォールバック |

### ターミナルコマンド実行の課題
現在の `terminalBridge.ts` は `terminal.sendText(command)` を使っており、**出力結果を取得できない**。
エージェントループでは実行結果をAIに返す必要があるため、`child_process.exec()` に変更が必要。
ただし、VS Code拡張のNode.js環境では利用可能。

---

## 5. エージェントループ — 技術設計

### アーキテクチャ選択肢

#### 案A: 現行のExpress経由（推奨）
```
Webview → postMessage → provider.ts → HTTP/SSE → server.ts → agentLoop.ts
```
- 既存のアーキテクチャを踏襲
- SSEでストリーミングイベントを送信
- 承認フロー: SSE → provider.ts → postMessage → Webview → postMessage → provider.ts → HTTP POST

#### 案B: Extension Host直接実行
```
Webview → postMessage → provider.ts → agentLoop.ts（直接）
```
- Expressサーバーのセキュリティリスクが消える
- よりシンプルな通信経路
- ただし既存コードの大幅リファクタリングが必要

**推奨は案B（中長期）、案A（今回の実装）**

### SSEイベント設計（案A）

```typescript
type AgentEvent =
  | { type: 'text_delta'; text: string }           // ストリーミングテキスト
  | { type: 'tool_use'; id: string; tool: string; input: object }  // ツール呼び出し開始
  | { type: 'tool_result'; id: string; ok: boolean; output: string } // ツール実行結果
  | { type: 'approval_required'; id: string; tool: string; preview: string } // 承認要求
  | { type: 'thinking'; message: string }           // 状態表示（「ファイルを読み取り中...」）
  | { type: 'done'; iterations: number; tokensUsed: number; costUsd: number }
  | { type: 'error'; message: string }
```

### 承認フロー詳細

```
agentLoop.ts → run_command ツール呼び出し
  → awaitApproval(id, "run_command", "npm run test") // Promise
  → onEvent({ type: 'approval_required', id, ... })
  → server.ts が SSEイベント送信
  → provider.ts が受信 → postMessage to Webview
  → Webview が承認UIを表示

ユーザーが [承認] or [キャンセル] をクリック
  → Webview → postMessage { command: 'agentApprove', id, approved }
  → provider.ts 受信 → POST /api/agent/approve { id, approved }
  → approvalManager.resolveApproval(id, true/false)
  → agentLoop.ts の Promise が resolve
  → ループ継続 or 中断
```

### コンテキストウィンドウ管理

シンプルな文字数ベースのアプローチ:
```typescript
function trimHistoryToFit(
  messages: ChatMessage[],
  maxChars: number = 80_000  // ~20,000トークン相当
): ChatMessage[] {
  // systemメッセージは常に保持
  // 古いメッセージから削除（最低2往復は保持）
}
```

---

## 6. ストリーミング実装

### 技術方針
- `POST /api/agent` → `text/event-stream` (SSE)
- Anthropic: `stream: true` で `text_delta` イベントを逐次受信
- OpenAI: `stream: true` で `choices[0].delta.content` を逐次受信
- DeepSeek: OpenAI互換のストリーミング

### Webviewでの表示
```
メッセージが増えるのではなく、最後のアシスタントメッセージに文字が追加される
ローディングスピナー → 最初の文字が来たらメッセージエリアに切り替わる
```

---

## 7. ライセンス認証 — 設計

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
  | 'valid'          // アクティブなPro
  | 'trial'          // 7日間Pro体験期間中
  | 'trial_expired'  // Pro体験期限切れ（未購入）
  | 'free'           // 未登録（無料版）
  | 'expired'        // サブスクリプション期限切れ
  | 'invalid'        // 無効なキー
  | 'grace'          // オフライン猶予期間（7日）
```

### 機能フラグとの連携
```typescript
// エージェント機能の起動前チェック
const license = getLicenseStatus(context);
if (license !== 'valid' && license !== 'grace' && license !== 'trial') {
  // ProアップグレードへのCTAを表示
  return;
}
// エージェントループ実行
```

---

## 8. 実装優先度とロードマップ

### v0.2.0（エージェントループ）— **完了**
- [x] `agentLoop.ts` 実装（`@cline/agents` ベース）
- [x] `POST /api/agent` SSEエンドポイント
- [x] 承認マネージャー（`approvalManager.ts`）
- [x] Webviewの承認UI（ワンクリック）
- [x] ストリーミング表示
- [x] タスク作成インラインUI（`window.prompt` 廃止）
- [x] `token` キーワード除外（プライバシールーティングの誤検知修正）

### v0.3.0（配布準備）— **完了**
- [x] ライセンス認証（LemonSqueezy連携、`licenseManager.ts`）
- [x] 機能フラグ（trial/valid/grace/expired分岐）
- [x] コンテキストウィンドウ管理（トークン推定・自動削除）
- [x] Expressセキュリティ強化（`127.0.0.1` バインド済み）
- [ ] 予算バー計算のリファクタリング（文字列パース廃止）— 継続課題

### v0.4.0（Marketplace公開）— **進行中**
- [x] Stripe審査完了確認
- [ ] アイコン差し替え（resources/icon.png）
- [ ] vsce package・publish
- [ ] VSCode Marketplaceパブリッシャー登録（publisher: pettal）
- [ ] Zennアカウント作成・記事公開

### v0.5.0以降（成長フェーズ）
- [ ] チームプラン（ライセンス管理）
- [ ] プロジェクトへの `PETTAL.md` 対応（プロジェクト固有の指示を読む）
- [ ] 日本語コメント自動付与オプション
- [ ] 管理ダッシュボード（チーム向けAPI利用量）

---

## 9. 未決事項（ブラッシュアップしたい箇所）

1. **`write_file` の承認フロー**: 自動書き込み（diffだけ表示）vs. Applyボタンで確認？
2. **チャットモードとエージェントモードの切替UI**: トグルボタン？ スラッシュコマンド（`/agent`）？
3. **ストリーミング中の予算更新タイミング**: 完了後のみでよいか？
4. **Ollamaがtool callingに対応しない場合の体験**: 無言でフォールバックか、メッセージ表示か？
5. **OSSとして公開するリポジトリ名**: `pettal-practitioner`のままでいいか？ ブランド整合性は？
6. **Proのマーケティング**: VS Code Marketplaceのbadgeに「⭐ Pro機能あり」を明示する方法
7. **価格**: ¥1,000/月が妥当か？ ¥800（GitHub Copilotより安い）にすべきか？

---

## 付録: 現在のファイル構成

```
pettal-practitioner/
├── src/
│   ├── extension.ts          # エントリポイント（activate/deactivate）
│   ├── constants.ts          # プロバイダー定義・設定キー・LicenseStatus型
│   ├── backend/
│   │   ├── agentLoop.ts      # エージェントループ（@cline/agents ベース）
│   │   ├── approvalManager.ts# 承認待ちPromise管理
│   │   ├── commandGuard.ts   # 危険コマンドのフィルタリング
│   │   ├── licenseManager.ts # LemonSqueezy連携・ライセンス検証
│   │   ├── ollamaSetup.ts    # Ollamaインストール補助
│   │   ├── secretsManager.ts # VS Code SecretStorageラッパー
│   │   ├── server.ts         # Express + SSE サーバー（127.0.0.1バインド）
│   │   ├── statusBar.ts      # ステータスバー予算表示
│   │   ├── storage.ts        # JSONベースのタスク/メッセージ/予算永続化
│   │   ├── terminalBridge.ts # VS Codeターミナル操作
│   │   ├── tools.ts          # ツール実装（read_file/write_file等）
│   │   └── lib/
│   │       ├── pettalConfig.ts   # .pettal プロジェクト設定ファイル読み書き
│   │       ├── router.ts         # PromptRouter（自動ルーティングロジック）
│   │       └── routingRules.ts   # カスタムルーティングルール管理
│   └── webview/
│       └── provider.ts       # WebviewViewProvider（Extension Host ↔ Webview橋渡し）
├── webview/
│   └── src/
│       ├── App.tsx           # メインReactコンポーネント（約1400行）
│       ├── types.ts          # 共有型定義（AgentEvent等）
│       └── styles.css        # UIスタイル（Catppuccin Mocha準拠）
└── package.json              # VS Code拡張マニフェスト・設定定義
```
