# TASKS — Agent Window Cursor化 + コミット英語化

方針: コア体験（可視化ステップ・変更集約・行diff・メーター）を優先。機能パリティ（画像添付等）はPhase 2として後回し可。
詳細は `~/.claude/plans/swirling-baking-lark.md`

## 即時（同一PR）

- [x] **T1: コミットメッセージ英語化**
  - 対象: `src/backend/systemPrompt.ts`（新規、`tools.ts`から`buildSystemPrompt`/`buildWorkspaceTree`/`SKIP_DIRS`を抽出。vscode非依存にしテスト可能化）/ `src/backend/tools.ts`（re-export） / 新規 `src/backend/toolsCommitLanguage.test.ts` / `package.json`
  - 内容: `## コマンド実行の規則` に英語コミットメッセージ規則を1行追加（Conventional Commits風 `type: summary`）
  - テスト: 新規 `test:tools-commit-language`（`npm test` 全体も確認済み）
  - 完了条件: Torii自身のエージェントに commit させると英語メッセージになる

## Phase 1（コア体験）

- [x] **T2: 可視化されたステップ/計画チェックリスト**
  - 対象: 新規 `webview/src/agentWindowSteps.ts` / 新規 `webview/src/toolLabels.ts`（`App.tsx`のツールラベル/アイコン/カテゴリを共有化） / `webview/src/agentWindowState.ts` / `webview/src/AgentWindow.tsx` / `webview/src/agent-window.css`
  - 内容: `tool_use`/`tool_result`/`file_change_applied`等をステータス付きステップへreduce。run完了後の履歴再読込でも消えないようリセットタイミングを修正（`steps`はタスク切替時のみリセット）
  - テスト: 新規 `agentWindowSteps.test.ts`

- [x] **T3: 変更ファイルの集約ビュー（Changesタブ）+ undo配線**
  - 対象: 新規 `webview/src/agentWindowChanges.ts` / `webview/src/agentWindowState.ts` / `webview/src/AgentWindow.tsx` / `src/webview/agentWindowPanel.ts` / `webview/src/agent-window.css`
  - 内容: サイドバーに既にある `undoFileCheckpoint`/`POST /api/file-change/undo` 配線をAgent Windowへ移植。右ペインに `Changes` タブ追加。承認カードと `DiffBlock` コンポーネントを共有
  - テスト: 新規 `agentWindowChanges.test.ts`

- [x] **T4: 正確な行単位diff**
  - 対象: 新規 `webview/src/lineDiff.ts`（Myers差分） / `webview/src/AgentWindow.tsx` / `webview/src/agent-window.css`
  - 内容: prefix/suffixトリム後のブロックにMyers差分を適用。800行超は従来の全置換表示にフォールバック
  - テスト: 新規 `lineDiff.test.ts`（1600行の完全不一致ケースも約30msで完了）

- [x] **T5: 予算・コンテキストウィンドウメーターの配線**
  - 対象: `src/webview/agentWindowPanel.ts`（`GET /api/budget`呼び出し追加）/ `webview/src/AgentWindow.tsx` / `src/backend/agentLoop.ts` / `webview/src/types.ts` / 新規 `src/backend/contextWindow.ts`
  - 内容: 死んでいた `.agent-window-budget` CSSを配線。`context_warning` に数値フィールド追加（`agentLoop.ts`と`types.ts`の2箇所を同期）
  - テスト: 新規 `contextWindow.test.ts`

- [x] **T6: stuck-loading 5分セーフティタイムアウト**
  - 対象: 新規 `webview/src/stuckLoadingTimeout.ts`（`App.tsx`と共有） / `webview/src/AgentWindow.tsx`
  - 内容: `App.tsx` と同じ5分タイムアウトをAgent Windowにも追加
  - テスト: 新規 `stuckLoadingTimeout.test.ts`
  - 完了条件: SSE切断後5分で `loading` が自動解除される

## Phase 2（機能パリティ・後回し可・未着手）

- [ ] **T7: 画像添付**
  - 対象: `webview/src/AgentWindow.tsx` / `src/webview/agentWindowPanel.ts`
  - 内容: `App.tsx` の drag&drop/file picker ハンドラを移植

- [ ] **T8: エディタ内容添付**
  - 対象: `webview/src/AgentWindow.tsx` / `src/webview/agentWindowPanel.ts`
  - 内容: `MSG_EDITOR_CONTENT` ハンドラを移植

- [ ] **T9: 上位モデル再実行（エスカレーション）**
  - 対象: `src/backend/server.ts`（`/api/agent` に `modelOverride` 追加）/ `src/webview/agentWindowPanel.ts` / `webview/src/AgentWindow.tsx`
  - 内容: 既存の `/api/chat/escalate` は非ストリーミング単発チャット専用のため流用不可。エージェントループ向けに再設計が必要（独立タスクとして切り出し推奨）

- [x] **T10: カスタムルーティングルールUI → 対応不要（クローズ）**
  - 判断: サイドバー/Settingsモーダルに一本化済み。Agent Windowへの複製は設定の二重管理を招くため見送る

## リリース

- [x] **T11: ドキュメント・バージョン・検証**
  - `AGENTS.md` / `DESIGN.md` 更新、`package.json` / `package-lock.json` を `0.9.1` へ更新
  - `npm test`（全テストパス）・`npx tsc --noEmit`（拡張機能本体・webview両方）・`npm run build:webview`・`npm run compile` すべて成功確認
  - 注意: Extension Development Host（F5起動）での実機目視確認はこのセッションでは未実施。型チェック・単体テスト・ビルド成功までを確認済み
