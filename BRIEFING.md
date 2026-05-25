# Pettal Practitioner — 現状と今後の実装計画（壁打ち用ブリーフィング）

## プロジェクト概要

VSCode拡張機能として動作するAIコーディングアシスタント。
マルチプロバイダー対応（Anthropic / DeepSeek / OpenAI / Gemini / Ollama）。
エージェントモードでファイル操作・コマンド実行・ユーザー承認フローを持つ。

**リポジトリ**: `/Users/daisuke/Desktop/pettal-practitioner`  
**Vercel（webview公開）**: pettal-git-main-daisuke-webapps-projects.vercel.app

---

## アーキテクチャ

### 2プロセス構成

```
[Extension Host (Node.js)]              [Webview (React/Vite)]
  extension.ts                    ←→      App.tsx
  server.ts (Express + SSE)       postMessage
  agentLoop.ts                    SSE (/api/agent)
  tools.ts
  storage.ts
  lib/router.ts
```

### ディレクトリ構成

```
src/
  extension.ts              # エントリーポイント
  constants.ts              # 定数・プロバイダー定義
  backend/
    agentLoop.ts            # エージェントループ（LLM呼び出し→ツール実行）
    approvalManager.ts      # 承認待ちPromise管理
    tools.ts                # ツール定義・システムプロンプト生成
    server.ts               # Express + SSE サーバー（1280行超）
    commandGuard.ts         # コマンドの安全チェック
    terminalBridge.ts       # VSCodeターミナル連携
    statusBar.ts            # ステータスバー（予算表示）
    storage.ts              # JSONファイルベース永続化（SQLiteではない）
    lib/
      router.ts             # マルチプロバイダー自動ルーティング
      routingRules.ts       # ルーティングルール管理
      pettalConfig.ts       # .pettal 設定ファイル読み書き
  webview/
    provider.ts             # WebviewProvider（postMessage / SSE中継）

webview/                    # React フロントエンド（Vite）
  src/
    App.tsx                 # メインUI（全状態管理）
    styles.css
    types.ts                # 型定義（AgentEvent等）
```

### 通信フロー（承認あり）

```
agentLoop → onEvent(approval_required)
  → SSE → provider.ts → postMessage
  → App.tsx（pendingApprovals に追加）
  → ユーザーがApply/キャンセル
  → POST /api/agent/approve
  → approvalManager が Promise を resolve
```

---

## 現状のエージェント実装（agentLoop.ts）

### 主要なパラメータ・定数

| 定数 | 値 | 問題 |
|------|------|------|
| `DEFAULT_AGENT_MAX_ITERATIONS` | 20 | 複雑なタスクで強制終了 |
| `MAX_CONTEXT_CHARS` | 80,000固定 | maxTokensと非連動 |
| リトライ回数 | 2回（固定1.5秒待機） | 429エラーに不十分 |
| ファイル書き込み制限 | 同一ファイル3回 | 機械的ブロック |

### 完了判定

```typescript
// ツール呼び出しが0件ならループ終了（これだけ）
if (result.toolCalls.length === 0) {
  break;
}
```

LLMが「タスク完了」を自己宣言する手段がない。

### 現在の6ツール

| ツール | 機能 |
|--------|------|
| `read_file` | ファイル内容取得 |
| `write_file` | ファイル新規作成 |
| `replace_in_file` | ファイル部分置換 |
| `list_directory` | ディレクトリ一覧 |
| `search_files` | キーワード検索（全文） |
| `run_command` | シェルコマンド実行 |

**不足**: grep（正規表現）、ファイル名検索、削除、コード定義一覧、ファイルメタデータ取得

### システムプロンプトの問題

現状: 「〜してはいけない」型の命令羅列  
問題: LLMが「なぜそうするか」ではなく「ルールを守る」という動機で動く → 複雑な状況で判断できない

---

## Clineとの能力比較（現状）

| 能力 | Pettal現状 | Cline |
|------|-----------|-------|
| 自律的な調査 | 弱い | 強い（attempt_completion で自己完結） |
| ツール数 | 6個 | 15+個 |
| エラー回復 | 1.5秒後1回リトライで終了 | 複数戦略フォールバック |
| ループ上限 | 20回固定 | 100回以上、自己判定終了 |
| コンテキスト管理 | 固定80K文字 | トークン数連動 |
| プロバイダーフォールバック | なし | あり |
| MCP対応 | なし | あり |
| ストレージ | JSONファイル | SQLite |

---

## 今後の実装計画（5フェーズ）

### Phase 1: agentLoop コア自律性強化（最優先・2〜3日）

#### 1-A. `attempt_completion` ツール追加
- LLMがタスク完了を自己宣言する公式手段を追加
- `result`（作業サマリー）と `command`（確認用コマンド、省略可）を受け取る
- このツールが呼ばれたらループ終了（`shouldBreak = true`）
- 修正ファイル: `src/backend/tools.ts`

#### 1-B. イテレーション100 + attempt_completion終了検知
- `DEFAULT_AGENT_MAX_ITERATIONS`: 20 → 100
- `tc.name === 'attempt_completion'` 検知でメインループをbreak
- attempt_completion の `result` を `finalReply` として使用
- 修正ファイル: `src/constants.ts`, `src/backend/agentLoop.ts`

#### 1-C. 指数バックオフリトライ
```typescript
const RETRY_DELAYS = {
  429: [2000, 4000, 8000],   // Rate Limit
  500: [1500, 3000, 6000],   // Server Error
  503: [1500, 3000, 6000],
  default: [1000, 2000, 4000],
};
// 最大4回試行
```
- 修正ファイル: `src/backend/agentLoop.ts`（L422-447付近）

#### 1-D. プロバイダー自動フォールバック
- `AgentParams` に `subProviderId?`, `subEndpoint?`, `subModel?`, `subApiKey?` を追加
- メイン4回全失敗 → サブプロバイダーで1回試みる
- `server.ts` の既存 `subProviderId` 設定を再利用
- 修正ファイル: `src/backend/agentLoop.ts`, `src/backend/server.ts`

#### 1-E. 動的コンテキスト管理
```typescript
// 変更前
const MAX_CONTEXT_CHARS = 80_000;
// 変更後
const MAX_CONTEXT_CHARS = Math.max(Math.floor(maxTokens * 3), 20_000);
```
- 修正ファイル: `src/backend/agentLoop.ts`（L391-398）

---

### Phase 2: ツール拡張（2日）

修正ファイル: `src/backend/tools.ts`（TOOL_DEFS + executeTool の switch）

#### `grep_search` — 正規表現テキスト検索
```
Input: { pattern, path?, case_sensitive?, include_pattern? }
Output: "path:行番号: 行内容" 形式、最大200件
```
- `fs.readFileSync` + 行ループ実装
- 既存 `SKIP_DIRS` を再利用

#### `find_files` — ファイル名パターン検索
```
Input: { pattern, path? }  // *.ts, index.ts, **/*.test.* など
Output: 相対パスリスト、最大100件
```
- glob → RegExp 変換を内部で実装

#### `delete_file` — 安全なファイル削除
- autoApply設定に関わらず **必ず承認を求める**（破壊的操作）
- `approvalManager.awaitApproval` を使用
- ディレクトリは削除不可

#### `get_file_info` — ファイルメタデータ取得
```
Output: パス、サイズ(KB)、行数、更新日時、作成日時
```
- `fs.statSync` のみ（内容を読まない）

#### `list_code_definition_names` — コード定義一覧
```
Output: "L行番号: [function/class/interface/type] 名前" 形式
```
- TypeScript/JavaScript/Python に対応
- 正規表現パターンマッチ（AST不使用）

---

### Phase 3: システムプロンプト刷新（1日）

修正ファイル: `src/backend/tools.ts`（`buildSystemPrompt` 関数）

「ルール遵守型」→「自律エージェントアイデンティティ型」へ書き直し。

```
新しい構造:
1. アイデンティティ（「あなたは完全自律型AIエンジニア」）
2. タスク実行3フェーズフロー:
   探索: find_files → list_directory → grep_search → list_code_definition_names → read_file
   実行: replace_in_file / write_file → run_command（ビルド/テスト検証）
   完了: attempt_completion（全作業完了・検証済みのときだけ）
3. ツール選択優先順位（11ツール対応版）
4. 禁止事項（最小限・末尾）
```

---

### Phase 4: MCP（Model Context Protocol）対応（3〜4日）

新規ファイル: `src/backend/mcpClient.ts`  
変更ファイル: `src/backend/lib/pettalConfig.ts`, `src/backend/tools.ts`, `src/backend/server.ts`, `src/extension.ts`

#### 依存追加
```json
"@modelcontextprotocol/sdk": "^1.0.0"
```

#### .pettal 設定スキーマ拡張
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    }
  }
}
```

#### MCPClientManager クラス（新規）
```typescript
class MCPClientManager {
  connect(name, config)       // StdioClientTransport でサブプロセス起動
  connectAll(pettalConfig)    // 全サーバーに並列接続
  getMCPTools()               // 接続済みMCPツール一覧
  getAnthropicMCPTools()      // AnthropicTool[] 形式に変換して返す
  executeMCPTool(name, input) // "mcp__serverName__toolName" をパースして呼び出し
  disconnectAll()             // extension.deactivate で呼ぶ
}
```

ツール名は `mcp__${serverName}__${actualToolName}` で名前衝突を防ぐ。

#### tools.ts / agentLoop.ts への統合
- `getAnthropicTools()` 関数を新設: `[...TOOL_DEFS, ...mcpManager.getAnthropicMCPTools()]` を返す
- `executeTool` の `default` ケースで `mcp__` プレフィックス検知 → `executeMCPTool` 呼び出し

#### 注意事項
- VSCode Extension内でStdioがサブプロセスを生成 → `deactivate` で必ず `disconnectAll()`
- MCPサーバーが多いとLLMへのツール定義が肥大化 → 将来的にホワイトリスト絞り込みを追加

---

### Phase 5: SQLiteストレージ移行（3〜4日）

変更ファイル: `src/backend/storage.ts`（全面書き換え）

#### 依存追加
```json
"better-sqlite3": "^9.0.0",
"@types/better-sqlite3": "^7.6.0"
```

#### スキーマ（4テーブル）
```sql
tasks         (id, workspace_id, title, created_at, updated_at)
messages      (id, workspace_id, task_id FK, role, content, tokens, cost_usd...)
usage         (月間集計)
model_usage   (モデル別集計)
-- すべてにインデックスあり
```

#### 設計方針
- **公開APIシグネチャは変更しない**: `Task`, `ChatMessage` 型と全関数シグネチャを維持 → `server.ts` への変更不要
- **WALモード有効化**: 同時読み書き性能向上
- **初回マイグレーション**: 旧JSONファイルがあれば `db.transaction` で一括インポート

#### 注意事項
- `better-sqlite3` はネイティブモジュール → Electron バージョンに合わせたリビルドが必要
- 代替: `sql.js`（WebAssembly版）でネイティブビルド問題を回避可能（ただし非同期APIが複雑）

---

## 実装の依存関係と順序

```
Phase 1 → 独立して実装可能（最優先）
Phase 2 → Phase 1 完了後（特に attempt_completion 追加後）
Phase 3 → Phase 2 完了後（全11ツールが揃ってからプロンプトを書く）
Phase 4 → Phase 1-3 完了後（独立して並行実装可能）
Phase 5 → Phase 1-3 完了後（Phase 4 と並行可能）
```

---

## 技術的に議論したいポイント

1. **better-sqlite3 vs sql.js**: Electronネイティブモジュールの互換性問題をどう扱うか
2. **attempt_completion の設計**: LLMが途中で呼ばないようにシステムプロンプトでどう誘導するか
3. **MCPサーバーのライフサイクル管理**: VSCodeのウィンドウ開閉時のサブプロセス管理
4. **コンテキスト圧縮**: 長い会話でシステムプロンプトが失われないようにする戦略
5. **Cline SDK移行**: CLAUDE.mdに`@cline/sdk`移行検討とあるが、このSDKが実際に公開されているかどうか（自前実装との比較）
